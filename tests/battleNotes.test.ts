import { describe, it, expect } from 'vitest';
import { createGame, skipInitialReroll } from '../src/core/engine/game';
import { battleNotes } from '../src/core/engine/battleNotes';
import type { DiceKind, GameState, PlayerId } from '../src/core/model/types';

/** 纯读函数测试：构造局面后直接把 phase 设成 main（不走完整流程，避免无关的尘起决策干扰） */
const mk = (heroA: [string, string, string], heroB: [string, string, string] = ['010', '011', '012']): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA, heroB });
  skipInitialReroll(g);
  g.phase = 'main';
  // 骰子清空：只读测试要精确控制「有无骰子」这一前提
  for (const who of ['A', 'B'] as PlayerId[]) {
    g.players[who].areas.attack = [];
    g.players[who].areas.defense = [];
    g.players[who].areas.meditation = [];
  }
  return g;
};
const art = (g: GameState, who: PlayerId, id: string) => g.players[who].artifacts.find((a) => a.id === id)!;
/** 直接标记某神器某侧为已激活（legacy 副本：只影响只读判定） */
const arm = (g: GameState, who: PlayerId, id: string, side: 'left' | 'right'): void => {
  const a = art(g, who, id);
  a.activeMarkerSide = side;
  a.armedSide = side;
  a.armedTurn = g.turnIndex;
};
const putDie = (g: GameState, who: PlayerId, kind: DiceKind, value: number): void => {
  g.players[who].areas[kind].push({ id: `${who}-${kind}-${value}-${g.players[who].areas[kind].length}`, value, kind });
};
const notes = (g: GameState, who: PlayerId) => battleNotes(g, who);

describe('战斗提示 battleNotes（主要阶段、只读状态）', () => {
  it('非主要阶段 / 无任何攻击相关效果 → 空', () => {
    const g = mk(['001', '002', '003']);
    expect(notes(g, 'A')).toEqual([]);
    g.phase = 'refill';
    expect(notes(g, 'A')).toEqual([]);
  });

  it('A：攻击伤害加成（004 锋芒计数 3）→ 精确一条', () => {
    const g = mk(['004', '005', '006']);
    arm(g, 'A', '004', 'right');
    art(g, 'A', '004').count = 3;
    // 无骰时不影响 A 类显示（A 类只看加成本身）
    expect(notes(g, 'A')).toEqual([{ label: '锋芒', text: '攻击伤害 +3' }]);
  });

  it('A：015 绝境天神 / 020 熊之心 / 021 野火燎原 的加成文案（同属性取最大，只显示实际生效的那条）', () => {
    const g1 = mk(['013', '014', '015']);
    arm(g1, 'A', '015', 'right');
    art(g1, 'A', '015').count = 2;
    expect(notes(g1, 'A')).toEqual([{ label: '绝境天神', text: '攻击伤害 +2' }]);

    // 020 熊之心（左，+2）与 021 野火燎原（+1）并存 → 取最大，只显示 +2
    const g2 = mk(['019', '020', '021']);
    arm(g2, 'A', '020', 'left');
    art(g2, 'A', '020').count = 2;
    arm(g2, 'A', '021', 'left');
    art(g2, 'A', '021').count = 1;
    expect(notes(g2, 'A')).toEqual([{ label: '熊之心', text: '攻击伤害 +2' }]);
  });

  it('A：带来源的本回合 Buff（如「献祭」②）也会显示', () => {
    const g = mk(['016', '017', '018']);
    g.players.A.buffs.push({ attr: 'attackDamage', add: 2, duration: 'thisTurn', source: '献祭' });
    expect(notes(g, 'A')).toEqual([{ label: '献祭', text: '攻击伤害 +2' }]);
  });

  it('B：004 锋芒·触发 —— 需 1 攻击骰 + 1 冥想骰，缺一不显示', () => {
    const g = mk(['004', '005', '006']);
    arm(g, 'A', '004', 'right');
    putDie(g, 'A', 'attack', 3);
    putDie(g, 'A', 'meditation', 2);
    expect(notes(g, 'A')).toEqual([{ label: '锋芒', text: '攻击被抵挡时，可追加 2 真实伤害' }]);

    const g2 = mk(['004', '005', '006']);
    arm(g2, 'A', '004', 'right');
    putDie(g2, 'A', 'attack', 3); // 只有攻击骰 → 支付不起
    expect(notes(g2, 'A')).toEqual([]);

    const g3 = mk(['004', '005', '006']); // 未激活 → 不显示
    putDie(g3, 'A', 'attack', 3);
    putDie(g3, 'A', 'meditation', 2);
    expect(notes(g3, 'A')).toEqual([]);
  });

  it('B：013 雷暴·触发 —— 需 1 冥想骰；021 满计数（=5）才显示半伤', () => {
    const g = mk(['013', '014', '015']);
    arm(g, 'A', '013', 'right');
    expect(notes(g, 'A')).toEqual([]); // 无冥想骰
    putDie(g, 'A', 'meditation', 4);
    expect(notes(g, 'A')).toEqual([{ label: '雷暴', text: '攻击被抵挡时，可将最多 2 个冥想骰移到攻击骰区' }]);

    const g2 = mk(['019', '020', '021']);
    arm(g2, 'A', '021', 'left');
    art(g2, 'A', '021').count = 4;
    // 计数 1+ 的「攻击伤害 +1」在计数 4 时就已生效（半伤要到 5 才生效）
    expect(notes(g2, 'A')).toEqual([{ label: '野火燎原', text: '攻击伤害 +1' }]);
    art(g2, 'A', '021').count = 5;
    expect(notes(g2, 'A')).toEqual([
      { label: '野火燎原', text: '攻击伤害 +1' },
      { label: '野火燎原', text: '攻击被抵挡时，仍造成一半伤害（向下取整）' },
    ]);
  });

  it('C：017 冥界行走（含取整字样）/ 001 中央突破不可抵挡', () => {
    const g = mk(['016', '017', '018']);
    arm(g, 'A', '017', 'right');
    expect(notes(g, 'A')).toEqual([
      {
        label: '冥界行走',
        text: '攻击造成伤害后，回复该点数一半的生命（向上取整）；若攻击点数为 6，则受 3 真实伤害',
      },
    ]);

    const g2 = mk(['001', '002', '003']);
    g2.unblockableThisTurn = true;
    expect(notes(g2, 'A')).toEqual([{ label: '中央突破', text: '本回合攻击不可抵挡' }]);
  });

  it('D：022 处刑通牒 —— 计数 ≥1 才显示', () => {
    const g = mk(['022', '023', '024']);
    arm(g, 'A', '022', 'right');
    expect(notes(g, 'A')).toEqual([]);
    art(g, 'A', '022').count = 1;
    expect(notes(g, 'A')).toEqual([
      { label: '处刑通牒', text: '使用攻击骰前，可令本次伤害 +1 且不可抵挡，或 +5' },
    ]);
  });

  it('E：023 畏惧（本回合攻击减半）', () => {
    const g = mk(['022', '023', '024']);
    g.players.A.attackHalvedNextTurn = true;
    expect(notes(g, 'A')).toEqual([{ label: '畏惧', text: '本回合攻击伤害减半' }]);
    // 只影响被标记的一方
    expect(notes(g, 'B')).toEqual([]);
  });

  it('综合：条目顺序按攻击时间线（加成 → 攻击前选择 → 被抵挡 → 伤害后 → 负面）', () => {
    const g = mk(['022', '023', '024']);
    arm(g, 'A', '022', 'right');
    art(g, 'A', '022').count = 2;
    g.players.A.attackHalvedNextTurn = true;
    expect(notes(g, 'A')).toEqual([
      { label: '处刑通牒', text: '使用攻击骰前，可令本次伤害 +1 且不可抵挡，或 +5' },
      { label: '畏惧', text: '本回合攻击伤害减半' },
    ]);
  });
});
