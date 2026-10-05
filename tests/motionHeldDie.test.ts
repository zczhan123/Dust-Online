import { describe, it, expect } from 'vitest';
import { flyingDieKind } from '../src/ui/motion';

// 存放骰（灰）飞向中间时的外观：**必须保持灰色**，不能被染成玩家色。
// （真实 bug：034/A03 的存放骰用于尘起/技能/攻击/抵挡支付时，飞行动效曾用玩家色新建元素。）
describe('存放骰飞行动效 · 外观种类选择', () => {
  it('held（存放骰）→ held（灰），且优先于 virtual / 实体', () => {
    expect(flyingDieKind({ held: true })).toBe('held');
    expect(flyingDieKind({ held: true, virtual: true })).toBe('held');
  });

  it('virtual（虚拟攻击）→ virtual（玩家色描边）', () => {
    expect(flyingDieKind({ virtual: true })).toBe('virtual');
  });

  it('实体骰 → solid（玩家色填充）', () => {
    expect(flyingDieKind({})).toBe('solid');
    expect(flyingDieKind({ held: false, virtual: false })).toBe('solid');
  });
});
