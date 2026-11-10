/**
 * 设备模拟：把「模拟某台真机」编译成 CDP 调用。
 *
 * 这一层的价值是**不用重开浏览器**就能切设备——`open --device` 只能在开会话时
 * 指定，而 `reload --frontend mobile` 要在同一个会话里切过去。
 *
 * 这里主要测纯函数（设备名解析、参数映射、脚本生成）与「不该静默出错」的边：
 * 未知设备名必须报错，而不是像 playwright-cli 那样静默忽略。
 */
import { describe, expect, it } from 'vitest';
import { deviceNameFor, deviceProfile, deviceScript, MOBILE_DEVICE, resolveDeviceName } from '../src/cli/device.ts';

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

  it('会话显式设备覆盖 mobile 默认值', () => {
    expect(deviceNameFor('mobile', 'Pixel 7')).toBe('Pixel 7');
    expect(deviceNameFor('mobile', null)).toBe(MOBILE_DEVICE);
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
