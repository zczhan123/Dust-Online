import { describe, it, expect } from 'vitest';
import { phaseBannerSegs } from '../src/ui/render';
import type { Phase, PlayerId } from '../src/core/model/types';

const nameOf = (p: PlayerId): string => (p === 'A' ? '玩家A' : '玩家B');
const snap = (active: PlayerId, phase: Phase): { active: PlayerId; phase: Phase } => ({ active, phase });

describe('阶段横幅序列（「没得做就自动翻页」时依次补播，绝不重叠）', () => {
  it('正常经过：尘起 → 主要，只弹「主要阶段」（正常停留）', () => {
    expect(phaseBannerSegs(snap('A', 'dustRise'), snap('A', 'main'), nameOf)).toEqual([
      { text: '主要阶段', transient: false },
    ]);
  });

  it('跨过尘起（重掷 → 主要）：先「尘起阶段」(过渡段) 再「主要阶段」', () => {
    expect(phaseBannerSegs(snap('A', 'reroll'), snap('A', 'main'), nameOf)).toEqual([
      { text: '尘起阶段', transient: true },
      { text: '主要阶段', transient: false },
    ]);
  });

  it('换手且下家尘起被跳过：三段齐（回合开始 → 尘起阶段(过渡) → 主要阶段）', () => {
    expect(phaseBannerSegs(snap('A', 'main'), snap('B', 'main'), nameOf)).toEqual([
      { text: '玩家B · 回合开始', transient: false },
      { text: '尘起阶段', transient: true },
      { text: '主要阶段', transient: false },
    ]);
  });

  it('换手停在下家尘起（未跳过）：回合开始 + 尘起阶段（正常停留）', () => {
    expect(phaseBannerSegs(snap('A', 'main'), snap('B', 'dustRise'), nameOf)).toEqual([
      { text: '玩家B · 回合开始', transient: false },
      { text: '尘起阶段', transient: false },
    ]);
  });

  it('首帧 / 同阶段重绘 / 非标准阶段（gameOver、tactics）→ 不弹', () => {
    expect(phaseBannerSegs(null, snap('A', 'dustRise'), nameOf)).toEqual([]);
    expect(phaseBannerSegs(snap('A', 'dustRise'), snap('A', 'dustRise'), nameOf)).toEqual([]);
    expect(phaseBannerSegs(snap('A', 'main'), snap('A', 'gameOver'), nameOf)).toEqual([]);
    expect(phaseBannerSegs(snap('A', 'tactics'), snap('A', 'tactics'), nameOf)).toEqual([]);
  });

  it('传奇回合（legendActor）：只保留「回合开始」，不弹尘起/主要', () => {
    expect(phaseBannerSegs(snap('A', 'main'), snap('B', 'main'), nameOf, { legendActor: true })).toEqual([
      { text: '玩家B · 回合开始', transient: false },
    ]);
    // 同一位（视角/重绘）→ 什么都不弹
    expect(phaseBannerSegs(snap('B', 'main'), snap('B', 'main'), nameOf, { legendActor: true })).toEqual([]);
  });

  it('首回合直接进尘起（本无重掷阶段）→ 不产生「重掷」段', () => {
    expect(phaseBannerSegs(snap('B', 'initialReroll'), snap('A', 'dustRise'), nameOf)).toEqual([
      { text: '玩家A · 回合开始', transient: false },
      { text: '尘起阶段', transient: false },
    ]);
  });
});
