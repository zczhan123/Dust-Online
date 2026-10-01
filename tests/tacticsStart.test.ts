// 战术牌 T01「谨慎」/ T02「先机」引擎行为 + 显示文本
import { describe, it, expect } from 'vitest';
import { createGame, applyAction, getLegalActions } from '../src/core/engine/game';
import { emptyDistribution, effectiveWill } from '../src/core/engine/derive';
import { TACTIC_BY_ID, tacticDisplayText } from '../src/core/content/tactics';
import type { Action, GameState } from '../src/core/model/types';

const resolvePending = (g: GameState): Action => getLegalActions(g)[0];

describe('T01「谨慎」', () => {
  it('自选点数落到能力骰区，数量＝意志，且同类型不超过 4', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T01', tacticB: 'T04' });
    expect(g.phase).toBe('tactics');
    expect(g.pending?.kind).toBe('tacticDice');
    expect(g.pending && g.pending.player).toBe('A');

    const before = g.players.A.areas;
    expect(before.attack.length + before.defense.length + before.meditation.length).toBe(0);

    const will = effectiveWill(g.players.A);
    const a = resolvePending(g) as Extract<Action, { t: 'tacticDice' }>;
    expect(a.t).toBe('tacticDice');
    expect(a.values).toHaveLength(will);
    applyAction(g, a);

    const ar = g.players.A.areas;
    const total = ar.attack.length + ar.defense.length + ar.meditation.length;
    expect(total).toBe(will);
    expect(ar.attack.length).toBeLessThanOrEqual(4);
    expect(ar.defense.length).toBeLessThanOrEqual(4);
    expect(ar.meditation.length).toBeLessThanOrEqual(4);
    expect(g.pending ?? null).toBeNull();
    expect(g.phase).toBe('initialReroll');
  });

  it('同类型超过 4 个 → 抛错且不改状态', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T01', tacticB: 'T04' });
    const dist = emptyDistribution(g.players.A)!;
    const v = dist.attack[0];
    const will = effectiveWill(g.players.A);
    const values = new Array(will).fill(v); // 全部同一类 → 超过 4
    expect(() => applyAction(g, { t: 'tacticDice', values })).toThrow(/不能超过 4/);
    expect(g.pending?.kind).toBe('tacticDice'); // 状态未变
    const ar = g.players.A.areas;
    expect(ar.attack.length + ar.defense.length + ar.meditation.length).toBe(0);
  });

  it('点数数量不符（≠ 意志）→ 抛错', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T01', tacticB: 'T04' });
    expect(() => applyAction(g, { t: 'tacticDice', values: [1] })).toThrow();
  });

  it('你没有对初始能力骰的重掷步骤', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T01', tacticB: 'T04' });
    applyAction(g, resolvePending(g));
    expect(g.phase).toBe('initialReroll');
    expect(g.activePlayer).toBe('A');
    expect(() => applyAction(g, { t: 'reroll', dieIds: [] })).toThrow(/没有初始重掷/);
  });
});

describe('T02「先机」', () => {
  it('指定 B 为先手 → firstPlayer=B，尘印标记归 A；可继续进入 initialReroll', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T04', tacticB: 'T02' });
    expect(g.pending?.kind).toBe('tacticFirst');
    expect(g.pending && g.pending.player).toBe('B');

    applyAction(g, { t: 'tacticFirst', who: 'B' });
    expect(g.firstPlayer).toBe('B');
    expect(g.players.B.hasDustSeal).toBe(false);
    expect(g.players.A.hasDustSeal).toBe(true);
    expect(g.phase).toBe('initialReroll');
    expect(g.initialRerollQueue).toEqual(['B', 'A']);
  });

  it('非法先手值 → 抛错', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T04', tacticB: 'T02' });
    expect(() => applyAction(g, { t: 'tacticFirst', who: 'C' as never })).toThrow();
    expect(g.pending?.kind).toBe('tacticFirst');
  });
});

describe('战术牌显示文本（效果在前、生命修正句在后）', () => {
  it('T01：效果句以「；」接生命句、生命句以「。」收尾', () => {
    const t = tacticDisplayText(TACTIC_BY_ID.T01);
    expect(t.startsWith('当你投掷初始能力骰时')).toBe(true);
    expect(t).toMatch(/；提高你的初始生命2点。$/);
  });
  it('T02：结尾为「；降低对方初始生命2点。」', () => {
    const t = tacticDisplayText(TACTIC_BY_ID.T02);
    expect(t.startsWith('当你选择本战术卡后')).toBe(true);
    expect(t).toMatch(/；降低对方初始生命2点。$/);
  });
  it('T03 只有生命修正 → 「。」收尾（不变）', () => {
    expect(tacticDisplayText(TACTIC_BY_ID.T03)).toBe('提高你的初始生命6点。');
  });
  it('T04 无生命修正 → 只回效果文本（不变）', () => {
    expect(tacticDisplayText(TACTIC_BY_ID.T04)).toBe(TACTIC_BY_ID.T04.effectText);
  });
});
