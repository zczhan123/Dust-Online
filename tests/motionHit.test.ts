import { describe, it, expect } from 'vitest';
import { hitShrinkScale } from '../src/ui/motion';

describe('受伤血条收缩 · hitShrinkScale（起点 scaleX ＝ 旧宽/新宽）', () => {
  it('上限 50、掉 10（新宽 80%）→ 起点 100/80 = 1.25', () => {
    expect(hitShrinkScale(80, -10, 50)).toBeCloseTo(1.25, 6);
  });

  it('上限 50、掉 5（新宽 90%）→ 起点 100/90', () => {
    expect(hitShrinkScale(90, -5, 50)).toBeCloseTo(100 / 90, 6);
  });

  it('旧宽封顶 100%（不溢出轨道）：新宽 95、掉 10/上限 50 → 起点 100/95', () => {
    expect(hitShrinkScale(95, -10, 50)).toBeCloseTo(100 / 95, 6);
  });

  it('掉到空（新宽 0）→ 无收缩（返回 1）', () => {
    expect(hitShrinkScale(0, -10, 50)).toBe(1);
  });

  it('回复（delta ≥ 0）或非法上限 → 返回 1（不做）', () => {
    expect(hitShrinkScale(80, 5, 50)).toBe(1);
    expect(hitShrinkScale(80, 0, 50)).toBe(1);
    expect(hitShrinkScale(80, -10, 0)).toBe(1);
  });
});
