import { describe, it, expect } from 'vitest';
import { flyingDieKind, heldReleaseOffset } from '../src/ui/motion';

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

// 裁雨流（001 / C01）收尾：停在中间的攻击骰飞回区域时的位移。
// 真实 bug：曾拿"当前位置 → 真骰"的**差值**直接当 `transform` → 少算"中间 − 原点"那一段，骰子飞偏、没落进区域。
describe('裁雨流收尾 · 攻击骰飞回区域的位移', () => {
  it('位移＝真骰中心 − 临时骰的"未平移中心(ox,oy)"，与"当前位置"无关', () => {
    // 临时骰 left/top 定在 (100,50)，被 transform 平移到中间 (400,300)；真骰最终落在 (620,520)
    const { dx, dy } = heldReleaseOffset(620, 520, 100, 50);
    expect(dx).toBe(520);
    expect(dy).toBe(470);
    // 布局原点 + 位移 ＝ 真骰中心（落点正确）
    expect(100 + dx).toBe(620);
    expect(50 + dy).toBe(520);
    // 反例（旧的错误写法）：拿"当前位置(400,300)"算差值（dx=220）却当作相对原点(100,50)的 transform
    // → 终点 ＝ 100 + 220 ＝ 320 ≠ 620（飞偏）
    const wrongDx = 620 - 400;
    const wrongDy = 520 - 300;
    expect(100 + wrongDx).not.toBe(620);
    expect(50 + wrongDy).not.toBe(520);
  });
});
