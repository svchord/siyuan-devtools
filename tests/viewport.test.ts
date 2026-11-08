/** 视口参数：正数校验与前端预设。 */
import { describe, expect, it } from 'vitest';
import { DESKTOP_VIEWPORT, MOBILE_VIEWPORT, parseViewport, viewportFor } from '../src/cli/viewport.ts';

describe('parseViewport', () => {
  it('解析宽x高', () => {
    expect(parseViewport('390x844')).toEqual({ width: 390, height: 844 });
    expect(parseViewport(' 1280x720 ')).toEqual({ width: 1280, height: 720 });
  });

  it('拒绝零宽高（旧实现会得到 512x6 的异常视口）', () => {
    expect(() => parseViewport('0x0')).toThrow('正整数');
    expect(() => parseViewport('390x0')).toThrow('正整数');
    expect(() => parseViewport('0x844')).toThrow('正整数');
  });

  it('拒绝非数字/非法格式', () => {
    expect(() => parseViewport('abc')).toThrow('格式');
    expect(() => parseViewport('390x')).toThrow('格式');
    expect(() => parseViewport('390x844x2')).toThrow('格式');
  });
});

describe('viewportFor', () => {
  it('桌面与移动端使用各自的预设', () => {
    expect(viewportFor('desktop')).toEqual(DESKTOP_VIEWPORT);
    expect(viewportFor('mobile')).toEqual(MOBILE_VIEWPORT);
  });
});
