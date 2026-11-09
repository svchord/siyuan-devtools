/**
 * 设备模拟：把「模拟某台真机」编译成 CDP 调用。
 *
 * 这一层的价值是**不用重开浏览器**就能切设备——`open --device` 只能在开会话时
 * 指定，而 `shot` 要在同一个会话里轮流截 desktop 与 mobile。
 *
 * 这里主要测纯函数（设备名解析、参数映射、脚本生成）与「不该静默出错」的边：
 * 未知设备名必须报错，而不是像 playwright-cli 那样静默忽略。
 */
import { describe, expect, it } from 'vitest';
import { captureScript, deviceNameFor, deviceProfile, deviceScript, MOBILE_DEVICE, resolveDeviceName } from '../src/cli/device.ts';

describe('resolveDeviceName', () => {
  it('精确匹配', () => {
    expect(resolveDeviceName('iPhone 13')).toBe('iPhone 13');
  });

  it('大小写不敏感', () => {
    expect(resolveDeviceName('iphone 13')).toBe('iPhone 13');
    expect(resolveDeviceName('IPHONE 13')).toBe('iPhone 13');
  });

  it('未知设备返回 null', () => {
    expect(resolveDeviceName('Not A Device')).toBeNull();
    expect(resolveDeviceName('')).toBeNull();
  });
});

describe('deviceProfile', () => {
  it('iPhone 13 的关键参数', () => {
    const profile = deviceProfile('iPhone 13');
    expect(profile).toMatchObject({
      width: 390,
      height: 664,
      screenWidth: 390,
      screenHeight: 844,
      deviceScaleFactor: 3,
      mobile: true,
      hasTouch: true,
    });
    expect(profile.userAgent).toContain('iPhone');
  });

  /**
   * 回归：playwright-cli 对未知 `--device` 是静默忽略的（`--device 'iphone 13'`
   * 直接按桌面打开，dpr=1），本 CLI 必须报错。
   */
  it('未知设备报错，不静默退回桌面', () => {
    expect(() => deviceProfile('Not A Device')).toThrow('未知设备');
  });
});

describe('deviceNameFor', () => {
  it('显式 device 优先', () => {
    expect(deviceNameFor('desktop', 'Pixel 7')).toBe('Pixel 7');
    expect(deviceNameFor('mobile', 'Pixel 7')).toBe('Pixel 7');
  });

  it('mobile 默认 iPhone 13，desktop 不模拟', () => {
    expect(deviceNameFor('mobile')).toBe(MOBILE_DEVICE);
    expect(deviceNameFor('desktop')).toBeNull();
  });

  /**
   * 回归：shot 曾经用 deviceNameFor(frontend) 忽略会话里 --device 指定的机型，
   * `open --device "Pixel 7"` 后截图仍是 iPhone 13 的尺寸。
   */
  it('会话显式设备覆盖 mobile 默认值', () => {
    expect(deviceNameFor('mobile', 'Pixel 7')).toBe('Pixel 7');
    expect(deviceNameFor('mobile', null)).toBe(MOBILE_DEVICE);
  });
});

describe('设备像素尺寸', () => {
  it('iPhone 13 截图应为 1170x1992（390x664 @3x）', () => {
    const profile = deviceProfile('iPhone 13');
    expect(profile.width * profile.deviceScaleFactor).toBe(1170);
    expect(profile.height * profile.deviceScaleFactor).toBe(1992);
  });

  it('Pixel 7 截图应为 1082x2202（412x839 @2.625x）', () => {
    const profile = deviceProfile('Pixel 7');
    expect(Math.round(profile.width * profile.deviceScaleFactor)).toBe(1082);
    expect(Math.round(profile.height * profile.deviceScaleFactor)).toBe(2202);
  });
});

describe('deviceScript', () => {
  it('移动端脚本带上 dpr、touch 与 UA', () => {
    const script = deviceScript(deviceProfile('iPhone 13'));
    expect(script).toContain('"deviceScaleFactor":3');
    expect(script).toContain('"mobile":true');
    expect(script).toContain('maxTouchPoints: 5');
    expect(script).toContain('iPhone');
    expect(() => new Function(`return (${script});`)).not.toThrow();
  });

  it('桌面脚本显式写回 dpr=1 与空 UA，而不是只 clear', () => {
    // clearDeviceMetricsOverride 不会把 dpr/UA 复原（实测清掉后 dpr 仍是 3）。
    const script = deviceScript(null, { width: 1600, height: 1000 });
    expect(script).toContain('deviceScaleFactor: 1');
    expect(script).toContain('mobile: false');
    expect(script).toContain('width: 1600');
    expect(script).not.toContain('clearDeviceMetricsOverride');
    expect(() => new Function(`return (${script});`)).not.toThrow();
  });

  it('桌面脚本用传入的视口，而不是写死 1600x1000', () => {
    expect(deviceScript(null, { width: 1280, height: 720 })).toContain('width: 1280');
  });
});

describe('captureScript', () => {
  /** 默认的桌面截图入参；单个用例只覆盖关心的维度。 */
  function capture(options: Partial<Parameters<typeof captureScript>[0]> = {}): string {
    return captureScript({
      profile: null,
      viewport: { width: 1600, height: 1000 },
      url: 'http://x/',
      mode: null,
      density: null,
      settleMs: 0,
      ...options,
    });
  }

  it('把设设备、导航、设主题、截图放在同一个 run-code 里', () => {
    const script = capture({
      profile: deviceProfile('iPhone 13'),
      viewport: { width: 390, height: 844 },
      url: 'http://127.0.0.1:8899/stage/build/mobile/',
      mode: 'dark',
      settleMs: 0,
    });
    expect(script).toContain('setDeviceMetricsOverride');
    expect(script).toContain('http://127.0.0.1:8899/stage/build/mobile/');
    expect(script).toContain('data-theme-mode');
    expect(script).toContain('Page.captureScreenshot');
    expect(() => new Function(`return (${script});`)).not.toThrow();
  });

  /**
   * 回归：弱就绪条件（`window.siyuan?.config`）在启动 ~78 ms 就为真，`shot`
   * 因此截到只有 logo 的闪屏，且退出码 0。必须等 `isReady`。
   */
  it('等 isReady，而不是启动早期就为真的 config', () => {
    const script = capture();
    expect(script).toContain('window.siyuan?.isReady === true');
    expect(script).not.toContain('window.siyuan?.config');
  });

  /**
   * 回归：稳定化等待曾经只在传了维度时才发生，`shot`（无参数）直接截到
   * 未绘制的首帧。两帧 rAF 必须无条件存在，且不能用固定 waitForTimeout 代替。
   */
  it('无论有没有维度都等两帧 rAF 并读一次布局', () => {
    for (const script of [capture(), capture({ mode: 'dark' }), capture({ density: 'compact' })]) {
      expect(script).toContain('requestAnimationFrame');
      // 只等 rAF 不够：读布局才会强制算完挂起的样式与排版。
      expect(script).toContain('getBoundingClientRect');
      expect(script).toContain('Page.captureScreenshot');
    }
  });

  it('没有主题/密度时不生成多余的 waitForTimeout', () => {
    expect(capture({ settleMs: 500 })).not.toContain('waitForTimeout');
  });

  it('有维度时按 settleMs 等重排落定', () => {
    expect(capture({ mode: 'light', settleMs: 200 })).toContain('waitForTimeout(200)');
    expect(capture({ density: 'compact', settleMs: 200 })).toContain('waitForTimeout(200)');
  });

  /**
   * 回归：只改 `data-theme-mode` 对内置 daylight/midnight 无效（配色是两张
   * 独立 CSS），必须同时换主题 `<link>`，所以走 THEME_FN 而不是裸 setAttribute。
   */
  it('主题走 THEME_FN（换样式表），而不是只改属性', () => {
    const script = capture({ mode: 'dark' });
    expect(script).toContain('page.evaluate');
    expect(script).toContain('"dark"');
    expect(script).toContain('/appearance/themes/');
    expect(script).toContain('themeDefaultStyle');
    expect(() => new Function(`return (${script});`)).not.toThrow();
  });

  it('不传主题时不注入 THEME_FN', () => {
    expect(capture()).not.toContain('/appearance/themes/');
  });

  /**
   * 回归：run-code 的脚本体跑在 Node 里，没有 `document`。密度必须经
   * `page.evaluate` 进页面改，否则截图脚本在设置密度那一步直接抛错。
   */
  it('density compact 设属性，default 删属性（都在页面里执行）', () => {
    const compact = capture({ density: 'compact' });
    expect(compact).toContain(`setAttribute('data-ui-density', 'compact')`);
    expect(compact).toContain('page.evaluate');

    const plain = capture({ density: 'default' });
    expect(plain).toContain(`removeAttribute('data-ui-density')`);
    expect(plain).not.toContain(`setAttribute('data-ui-density'`);
    expect(plain).toContain('page.evaluate');
  });

  it('不传密度时不动 data-ui-density', () => {
    expect(capture()).not.toContain('data-ui-density');
  });

  it('返回 data 与 applied，让调用方知道实际生效的维度', () => {
    const script = capture({ mode: 'dark', density: 'compact' });
    expect(script).toContain('applied:');
    expect(script).toContain('density: densityValue');
    expect(script).toContain('changed: themeChanged');
  });

  it('desktop 截图用桌面参数（dpr=1）', () => {
    expect(capture()).toContain('"deviceScaleFactor":1');
  });

  /**
   * 回归：captureScript 曾经写死桌面 1600x1000，导致 `open --viewport 1280x720`
   * 之后 shot 的截图还是 1600x1000。
   */
  it('截图视口用传入值，不写死', () => {
    const script = capture({ viewport: { width: 1280, height: 720 } });
    expect(script).toContain('"width":1280');
    expect(script).toContain('"height":720');
  });

  /**
   * 回归：设备自带视口是 390x664（不含浏览器 chrome），而本工具一直以
   * 390x844 作为移动端 CSS 视口。设备只该提供 dpr/UA/touch。
   */
  it('mobile 用 390x844 而不是设备自带的 390x664', () => {
    const script = capture({ profile: deviceProfile('iPhone 13'), viewport: { width: 390, height: 844 } });
    expect(script).toContain('"width":390');
    expect(script).toContain('"height":844');
    expect(script).not.toContain('"height":664');
    expect(script).toContain('"deviceScaleFactor":3');
  });
});
