import { describe, it, expect } from 'vitest';
import {
  createChallengeGame,
  applyChallengeSkill,
  resolveLegendDeferred,
  applyAction,
  skipInitialReroll,
  beginTurn,
} from '../src/core/engine/game';
import { matchGroupsPartial } from '../src/core/engine/challenge';
import { CHALLENGES } from '../src/core/content/challenges';
import type { Die, DiceKind, GameState } from '../src/core/model/types';

const die = (id: string, value: number, kind: DiceKind = 'meditation'): Die => ({ id, value, kind });
const Z05 = CHALLENGES.find((c) => c.id === 'Z05')!;
const SK = (id: string) => Z05.skills!.find((s) => s.id === id)!;
const make = (mode: 'manual' | 'favor' | 'against' = 'manual') =>
  createChallengeGame({ seed: 1, cardId: 'Z05', challenger: ['001', '002', '003'], settleMode: mode });
const setA = (g: GameState, areas: { attack?: Die[]; defense?: Die[]; meditation?: Die[] }): void => {
  g.players.A.areas.attack = areas.attack ?? [];
  g.players.A.areas.defense = areas.defense ?? [];
  g.players.A.areas.meditation = areas.meditation ?? [];
};
const vals = (ds: Die[]) => ds.map((d) => d.value);

describe('挑战模式 · Z05 轰鸣审判官 · 数据', () => {
  it('生命 50 / 门槛 3 / 投 8 / 防御骰上限 4 / 6 条技能', () => {
    expect(Z05.life).toBe(50);
    expect(Z05.defenseMin).toBe(3);
    expect(Z05.rollDice).toBe(8);
    expect(Z05.defenseCap).toBe(4);
    expect(Z05.rollDiceBonusOnDamage).toBe(2);
    expect(Z05.attackBonusPer10MissingLife).toBe(1);
    expect(Z05.skills).toHaveLength(6);
  });

  it('槽：数罪并罚＝3 组 {1,1}/{1,6}/{6,6}（逐组）；电刑＝2 组 2颗3/4（逐组）；净化＝2颗2/5', () => {
    expect(SK('z05-3').perGroup).toBe(true);
    expect(SK('z05-3').slots!.map((s) => s.faces)).toEqual([[1, 1], [1, 6], [6, 6]]);
    expect(SK('z05-4').perGroup).toBe(true);
    expect(SK('z05-4').slots).toEqual([
      { kind: 'pips', count: 2, faces: [3, 4] },
      { kind: 'pips', count: 2, faces: [3, 4] },
    ]);
    expect(SK('z05-5').slots).toEqual([{ kind: 'pips', count: 2, faces: [2, 5] }]);
  });
});

describe('挑战模式 · Z05 逐组匹配（matchGroupsPartial）', () => {
  it('数罪并罚：{1,6} 一组；[1,6] → 1 组', () => {
    const driven = [die('a', 1), die('b', 6)];
    const m = matchGroupsPartial(SK('z05-3').slots!, driven);
    expect(m).toHaveLength(1);
    expect(m[0].slot).toBe(1); // {1,6}
  });

  it('数罪并罚：[1,1,6,6] → 2 组；缺一组不匹配（可部分）', () => {
    const m = matchGroupsPartial(SK('z05-3').slots!, [die('a', 1), die('b', 1), die('c', 6), die('d', 6)]);
    expect(m).toHaveLength(2);
  });

  it('电刑：2 组 2颗3/4（33/34/43/44 皆可）', () => {
    const m = matchGroupsPartial(SK('z05-4').slots!, [die('a', 3), die('b', 4), die('c', 4), die('d', 3), die('e', 1)]);
    expect(m).toHaveLength(2);
  });
});

describe('挑战模式 · Z05 效果', () => {
  it('绝境天神：上个挑战者回合受过伤 → 额外投 2 个驱动骰（共 10）', () => {
    const g = make();
    g.challenge!.damagedDuringChallengerTurn = true;
    g.activePlayer = 'B';
    beginTurn(g);
    expect(g.challenge!.driven).toHaveLength(10);
    expect(g.challenge!.damagedDuringChallengerTurn).toBe(false); // 用掉即清
    // 战报：额外那 2 颗**带点数**；总数行写**实际颗数**（8+2=10，不是 8）
    const texts = g.log.map((l) => l.text);
    const extraVals = g.challenge!.driven.slice(-2).map((d) => d.value).sort((a, b) => a - b);
    expect(texts.some((t) => t.includes(`额外投掷 2 个驱动骰（${extraVals.join('/')}）`))).toBe(true);
    expect(texts.some((t) => /投掷 10 个驱动骰（/.test(t))).toBe(true);
    expect(texts.some((t) => /投掷 8 个驱动骰（/.test(t))).toBe(false);
  });

  it('绝境天神：当前生命每比初始低 10 点 → 攻击伤害 +（仅传奇自己的攻击）', () => {
    const g = make();
    setA(g, {});
    g.players.B.life = 25; // 50 − 25 = 25 → floor(2.5) = 2
    applyChallengeSkill(g, Z05, SK('z05-3'), [die('d1', 1), die('d2', 1)]); // 1 组 → 2 次 6 点
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', baseValue: 6, bonusValue: 2, bonusLabel: '绝境天神' });
    expect(g.pendingAttack?.value).toBe(8); // 6 + 2
  });

  it('不可饶恕：弃置挑战者所有 X 点能力骰（X＝驱动骰众数）', () => {
    const g = make();
    g.challenge!.driven = [die('d1', 3), die('d2', 3), die('d3', 3), die('d4', 5)];
    setA(g, { attack: [die('a1', 3, 'attack')], meditation: [die('m1', 5, 'meditation'), die('m2', 3, 'meditation')] });
    applyChallengeSkill(g, Z05, SK('z05-2'), []);
    expect(vals(g.players.A.areas.attack)).toEqual([]); // 3 点攻击骰被弃
    expect(vals(g.players.A.areas.meditation)).toEqual([5]); // 5 留下、3 弃掉
  });

  it('不可饶恕·并列（3 与 5 各 2 个）→ 挑战者代决用哪个 X', () => {
    const g = make();
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.turn = 1;
    g.challenge!.resumeAt = 2;
    g.challenge!.driven = [die('d1', 3), die('d2', 3), die('d5', 5), die('d6', 5)];
    setA(g, { attack: [die('a1', 3, 'attack')] });
    applyAction(g, { t: 'challengeStep' });
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    expect(g.pending.options.map((o) => o.id).sort()).toEqual(['3', '5']);
  });

  it('不可饶恕·自动（有利＝颗数优先）：选"被弃颗数更少"的 X（宁可弃冥也不弃多颗）', () => {
    const g = make('favor');
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.turn = 1;
    g.challenge!.resumeAt = 2;
    g.challenge!.driven = [die('dv1', 3), die('dv2', 3), die('dv5', 5), die('dv6', 5)];
    setA(g, {
      attack: [die('a1', 3, 'attack'), die('a2', 3, 'attack'), die('a3', 3, 'attack')], // 3 点：3 颗攻击（n=3,w=1）
      defense: [die('f1', 5, 'defense')],
      meditation: [die('m1', 5, 'meditation')], // 5 点：1 防+1 冥（n=2,w=6）
    });
    applyAction(g, { t: 'challengeStep' });
    expect(g.pending).toBeNull(); // 自动、不弹面板
    expect(vals(g.players.A.areas.attack)).toEqual([3, 3, 3]); // 3 点保留（选 n 更小的 5 点）
    expect(g.players.A.areas.defense).toEqual([]);
    expect(g.players.A.areas.meditation).toEqual([]);
  });

  it('不可饶恕·自动（不利＝取反）：选"被弃颗数更多"的 X', () => {
    const g = make('against');
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.turn = 1;
    g.challenge!.resumeAt = 2;
    g.challenge!.driven = [die('dv1', 3), die('dv2', 3), die('dv5', 5), die('dv6', 5)];
    setA(g, {
      attack: [die('a1', 3, 'attack'), die('a2', 3, 'attack'), die('a3', 3, 'attack')],
      defense: [die('f1', 5, 'defense')],
      meditation: [die('m1', 5, 'meditation')],
    });
    applyAction(g, { t: 'challengeStep' });
    expect(g.pending).toBeNull();
    expect(vals(g.players.A.areas.attack)).toEqual([]); // 不利＝取反 → 弃 3 点（3 颗）
    expect(vals(g.players.A.areas.defense)).toEqual([5]);
    expect(vals(g.players.A.areas.meditation)).toEqual([5]);
  });

  it('数罪并罚：匹配 2 组 → 4 次 6 点攻击 + 自伤 6 点', () => {
    const g = make();
    setA(g, {});
    const life0 = g.players.B.life;
    applyChallengeSkill(g, Z05, SK('z05-3'), [die('d1', 1), die('d2', 1), die('d3', 6), die('d4', 6)]);
    expect(g.virtualQueue).toHaveLength(3); // 4 段：1 发出 + 3 待
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', baseValue: 6 });
    // 多组提示：第 1 组 · 本组第 1 / 2 次
    expect(g.pendingAttack?.legendGroup).toEqual({ index: 1, total: 2, sub: 1, subTotal: 2 });
    expect(g.players.B.life).toBe(life0 - 6); // 2 组 × 3
  });

  it('电刑：匹配 2 组 → 1/2/3 各两次；末尾再加"攻击骰区的攻击骰"', () => {
    const g = make();
    setA(g, {});
    g.players.B.areas.attack = [die('ba', 5, 'attack')];
    applyChallengeSkill(g, Z05, SK('z05-4'), [die('d1', 3), die('d2', 4), die('d3', 4), die('d4', 3)]);
    // 2 组 ×（1,2,3）=6 + 攻击区 1 = 7 段 → 1 发出 + 6 待
    expect(g.virtualQueue).toHaveLength(6);
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', baseValue: 1 });
    // 多组提示：第 1 组 · 本组第 1 / 3 次
    expect(g.pendingAttack?.legendGroup).toEqual({ index: 1, total: 2, sub: 1, subTotal: 3 });
  });

  it('净化：把本技能上的 2 颗驱动骰移入防御骰区', () => {
    const g = make();
    setA(g, {});
    g.players.B.areas.defense = [];
    g.challenge!.deferred = { skillId: 'z05-5', step: 0, dice: [{ id: 'x1', value: 2 }, { id: 'x2', value: 5 }] };
    resolveLegendDeferred(g, Z05);
    expect(vals(g.players.B.areas.defense)).toEqual([2, 5]);
    expect(g.challenge!.deferred).toBeUndefined();
  });

  it('净化·上限：防御骰已有 3 → 只能放 1 颗 → 挑战者代决"哪颗进"', () => {
    const g = make();
    g.players.B.areas.defense = [die('bd0', 1, 'defense'), die('bd1', 1, 'defense'), die('bd2', 1, 'defense')];
    g.challenge!.deferred = { skillId: 'z05-5', step: 0, dice: [{ id: 'x1', value: 2 }, { id: 'x2', value: 5 }] };
    resolveLegendDeferred(g, Z05);
    expect(g.pending?.kind).toBe('challengePick');
    expect(g.players.B.areas.defense).toHaveLength(3); // 尚未移入
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    expect(g.pending.pick?.owner).toBe('B'); // ★ 骰子是传奇自己的 → 骰片按 B 上色（不是代决者 A）
  });

  it('净化·上限：确认"哪颗进"（选项 id ＝**骰子 id**）→ 移入所选（回归：不再非法选项）', () => {
    const g = make();
    g.players.B.areas.defense = [die('bd0', 1, 'defense'), die('bd1', 1, 'defense'), die('bd2', 1, 'defense')];
    g.challenge!.deferred = { skillId: 'z05-5', step: 0, dice: [{ id: 'x1', value: 2 }, { id: 'x2', value: 5 }] };
    resolveLegendDeferred(g, Z05);
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    expect(g.pending.options.map((o) => o.id)).toEqual(['x1', 'x2']); // 选项 id ＝骰子 id（非下标）
    expect(g.pending.pick?.pool.map((x) => x.id)).toEqual(['x1', 'x2']);
    expect(g.pending.pick?.owner).toBe('B');
    expect(() => applyAction(g, { t: 'challengePick', id: 'x2' })).not.toThrow();
    resolveLegendDeferred(g, Z05);
    expect(g.players.B.areas.defense.map((d) => d.value)).toEqual([1, 1, 1, 5]); // 移入 5
  });
});
