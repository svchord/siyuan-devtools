/**
 * 设备模拟：mobile 必须模拟真机，否则 dpr 停在 1。
 *
 * 这是曾经的实测缺陷：`audit` 与 `shot` 只设了视口尺寸（390x844），没有
 * 传 `--device`，于是 dpr=1、UA 是桌面 UA。结果是
 * `@media (min-resolution: 2dppx)`、`pointer: coarse` 以及依赖 UA 的样式
 * 分支全部走错，截图也只有真机 1/3 的分辨率。
 */
import { describe, expect, it } from 'vitest';
import { deviceArgsFor, MOBILE_DEVICE } from '../src/cli/commands/session.ts';

describe('deviceArgsFor', () => {
  it('mobile 默认模拟真机', () => {
    expect(deviceArgsFor('mobile')).toEqual([`--device=${MOBILE_DEVICE}`]);
  });

  it('desktop 不模拟设备', () => {
    expect(deviceArgsFor('desktop')).toEqual([]);
  });

  it('显式指定设备时以参数为准（含 desktop）', () => {
    expect(deviceArgsFor('mobile', 'Pixel 7')).toEqual(['--device=Pixel 7']);
    expect(deviceArgsFor('desktop', 'iPhone 13')).toEqual(['--device=iPhone 13']);
  });
});
