/**
 * 设备模拟：把「模拟某台真机」编译成 CDP 调用。
 *
 * 为什么不用 `open --device`：那只能在开会话时指定，改不了已有会话。
 * 而 `shot` 要在同一个会话里轮流截 desktop 与 mobile，`reload` / `audit`
 * 也可能在会话中途切前端——重开浏览器虽然能换设备，但代价是：杀掉用户的
 * 页面状态、丢掉登录态、多花一次冷启动。
 *
 * CDP 的 Emulation 域可以就地切换，实测与 `open --device` 逐项一致
 * （innerWidth/dpr/screen/UA/pointer/hover/min-resolution/orientation）。
 * 唯一限制：`navigator.maxTouchPoints` 与 `'ontouchstart' in window` 在页面
 * 加载时固化，切换后需要一次 reload 才生效——所以调用方切完要重新导航。
 */
import { devices } from 'playwright-core';
import { UserError } from './errors.ts';
import type { Frontend } from './url.ts';

/** 移动端默认模拟的设备。 */
export const MOBILE_DEVICE = 'iPhone 13';

/**
 * 设备画像。
 *
 * `width` / `height` 是**设备自带**的视口；调用方通常会用 `viewportFor(frontend)`
 * 覆盖它（旧工具与 README 一直以 390x844 作为移动端 CSS 视口，截图因此是
 * 1170x2532）。设备只负责 dpr / UA / touch 这几个「不能靠 resize 得到」的维度。
 */
interface DeviceProfile {
  width: number;
  height: number;
  screenWidth: number;
  screenHeight: number;
  deviceScaleFactor: number;
  mobile: boolean;
  hasTouch: boolean;
  userAgent: string;
}

/** 设备名（大小写不敏感）→ 标准名；找不到返回 null。 */
export function resolveDeviceName(name: string): string | null {
  const exact = Object.keys(devices).find((item) => item === name);
  if (exact) return exact;
  const lower = name.trim().toLowerCase();
  return Object.keys(devices).find((item) => item.toLowerCase() === lower) ?? null;
}

/** 取某台设备的 CDP 参数；设备名不认识时报错（列出几个常见选项）。 */
export function deviceProfile(name: string): DeviceProfile {
  const resolved = resolveDeviceName(name);
  if (!resolved) {
    throw new UserError(`未知设备：${name}（可用 playwright-core 的 devices，如 "iPhone 13" / "Pixel 7"）`);
  }
  const device = devices[resolved]!;
  // 类型定义里没有 screen（运行时才有），按可选读。
  const screen = (device as { screen?: { width: number; height: number } }).screen;
  return {
    width: device.viewport.width,
    height: device.viewport.height,
    screenWidth: screen?.width ?? device.viewport.width,
    screenHeight: screen?.height ?? device.viewport.height,
    deviceScaleFactor: device.deviceScaleFactor,
    mobile: device.isMobile ?? false,
    hasTouch: device.hasTouch ?? false,
    userAgent: device.userAgent,
  };
}

/** 这台前端应该模拟哪台设备：显式 device > mobile 的默认设备 > 不模拟。 */
export function deviceNameFor(frontend: Frontend, device: string | null = null): string | null {
  if (device) return device;
  return frontend === 'mobile' ? MOBILE_DEVICE : null;
}

/**
 * 在页面里执行一段用 CDP 切设备的脚本（供 run-code 使用）。
 *
 * `viewport` 覆盖设备自带的宽高：设备只提供 dpr / UA / touch。
 * 不传 `viewport` 时才用设备自带尺寸。
 */
export function deviceScript(
  profile: DeviceProfile | null,
  viewport?: { width: number; height: number }
): string {
  if (profile === null) {
    // 不能只 clearDeviceMetricsOverride：实测它不会把 dpr 与 UA 复原
    // （清掉后 dpr 仍是 3、UA 还是 iPhone）。必须显式写回桌面参数。
    const width = viewport?.width ?? 1600;
    const height = viewport?.height ?? 1000;
    return `async (page) => {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: ${width}, height: ${height}, deviceScaleFactor: 1, mobile: false,
  });
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await session.send('Emulation.setUserAgentOverride', { userAgent: '' });
  return { emulated: false };
}`;
  }
  const metrics = {
    width: viewport?.width ?? profile.width,
    height: viewport?.height ?? profile.height,
    deviceScaleFactor: profile.deviceScaleFactor,
    mobile: profile.mobile,
    screenWidth: profile.screenWidth,
    screenHeight: profile.screenHeight,
    screenOrientation: { type: 'portraitPrimary', angle: 0 },
  };
  return `async (page) => {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setDeviceMetricsOverride', ${JSON.stringify(metrics)});
  await session.send('Emulation.setTouchEmulationEnabled', {
    enabled: ${profile.hasTouch},
    maxTouchPoints: ${profile.hasTouch ? 5 : 0},
  });
  await session.send('Emulation.setUserAgentOverride', {
    userAgent: ${JSON.stringify(profile.userAgent)},
  });
  return { emulated: true };
}`;
}

/**
 * 用 CDP 截图，返回 base64 PNG。
 *
 * 为什么不用 `cli screenshot --hires`：`--hires` 取的是**浏览器上下文**的
 * deviceScaleFactor，它在会话创建时就固定了；CDP 的 `setDeviceMetricsOverride`
 * 改不动它。实测桌面会话切到 dpr=3 后，`--hires` 仍输出 1600x1000。
 *
 * 为什么必须把「设设备 + 导航 + 截图」放在**同一次 run-code** 里：
 * `Page.captureScreenshot` 只在**设置覆盖的那个 CDP 会话**内看到设备参数。
 * 换一次调用重新 `newCDPSession`，虽然页面里 `devicePixelRatio` 仍是 3
 * （evaluate 读得到），但截图会退回 390x664 的 CSS 像素。
 */
export function captureScript(options: {
  profile: DeviceProfile | null;
  viewport: { width: number; height: number };
  url: string;
  attributes: ReadonlyArray<readonly [string, string]>;
  settleMs: number;
}): string {
  const { profile, viewport, url, attributes, settleMs } = options;
  const metrics = profile
    ? {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: profile.deviceScaleFactor,
        mobile: profile.mobile,
        screenWidth: profile.screenWidth,
        screenHeight: profile.screenHeight,
        screenOrientation: { type: 'portraitPrimary', angle: 0 },
      }
    : { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false };
  const touch = profile?.hasTouch ?? false;
  const userAgent = profile?.userAgent ?? '';
  const assignment = attributes
    .map(([name, value]) => `document.documentElement.setAttribute(${JSON.stringify(name)}, ${JSON.stringify(value)});`)
    .join(' ');

  return `async (page) => {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setDeviceMetricsOverride', ${JSON.stringify(metrics)});
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: ${touch}${touch ? ', maxTouchPoints: 5' : ''} });
  await session.send('Emulation.setUserAgentOverride', { userAgent: ${JSON.stringify(userAgent)} });
  await page.goto(${JSON.stringify(url)});
  // 等思源前端初始化完成（与 READY_FN 同条件），最多 15s。
  await page.waitForFunction(
    () => Boolean(window.siyuan?.config && document.documentElement.getAttribute('data-frontend')),
    undefined,
    { timeout: 15000 }
  );
  ${
    assignment
      ? `await page.evaluate(() => { ${assignment} });\n  await page.waitForTimeout(${settleMs});`
      : ''
  }
  const shot = await session.send('Page.captureScreenshot', { format: 'png' });
  return { data: shot.data };
}`;
}

