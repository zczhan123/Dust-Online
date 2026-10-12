import { describe, it, expect } from 'vitest';
import {
  createChallengeGame,
  applyChallengeSkill,
  resolveLegendDeferred,
  applyAction,
  skipInitialReroll,
} from '../src/core/engine/game';
import { CHALLENGES } from '../src/core/content/challenges';
import { driveLegendTurn } from './helpers';
import type { Die, DiceKind, GameState } from '../src/core/model/types';

const die = (id: string, value: number, kind: DiceKind = 'meditation'): Die => ({ id, value, kind });
const Z08 = CHALLENGES.find((c) => c.id === 'Z08')!;
const SK = (id: string) => Z08.skills!.find((s) => s.id === id)!;
const make = (mode: 'manual' | 'favor' | 'against' = 'manual') =>
  createChallengeGame({ seed: 1, cardId: 'Z08', challenger: ['001', '002', '003'], settleMode: mode });
const setA = (g: GameState, areas: { attack?: Die[]; defense?: Die[]; meditation?: Die[] }): void => {
  g.players.A.areas.attack = areas.attack ?? [];
  g.players.A.areas.defense = areas.defense ?? [];
  g.players.A.areas.meditation = areas.meditation ?? [];
};
const setB = (g: GameState, areas: { attack?: Die[]; defense?: Die[] }): void => {
  g.players.B.areas.attack = areas.attack ?? [];
  g.players.B.areas.defense = areas.defense ?? [];
  g.players.B.areas.meditation = [];
};
const vals = (ds: Die[]) => ds.map((d) => d.value);

describe('挑战模式 · Z08 黑枪 · 数据', () => {
  it('生命 50 / 门槛 3 / 投 8 / 防御骰上限 4 / 6 条', () => {
    expect(Z08.life).toBe(50);
    expect(Z08.defenseMin).toBe(3);
    expect(Z08.rollDice).toBe(8);
    expect(Z08.defenseCap).toBe(4);
    expect(Z08.skills).toHaveLength(6);
    expect(SK('z08-1').marker).toBe('∞');
    expect(SK('z08-2').slots).toEqual([{ kind: 'straight', count: 4 }]);
    expect(SK('z08-3').slots).toEqual([{ kind: 'pips', count: 2, faces: [2, 5] }]);
    expect(SK('z08-4').slots).toEqual([{ kind: 'same', count: 2 }]);
    expect(SK('z08-5').slots).toEqual([{ kind: 'pips', count: 0, faces: [3, 4], unlimited: true }]);
    expect(SK('z08-2').slotChoice).toBe(true);
    expect(SK('z08-3').slotChoice).toBe(true);
    expect(SK('z08-4').slotChoice).toBe(true);
  });
});

describe('挑战模式 · Z08 效果', () => {
  it('填弹：点数最高的 1 个驱动骰 → 攻击骰区（并列取第一个）', () => {
    const g = make();
    setA(g, {});
    setB(g, {});
    g.challenge!.driven = [die('a', 2), die('b', 5), die('c', 5), die('d', 1)];
    applyChallengeSkill(g, Z08, SK('z08-1'), []);
    expect(g.challenge!.driven.map((d) => d.value)).toEqual([2, 5, 1]); // 去掉第一个 5
    expect(vals(g.players.B.areas.attack)).toEqual([5]);
  });

  it('凶弹业舞：挑战者 防→黑枪攻区、攻→黑枪防区（受上限 4）', () => {
    const g = make();
    setA(g, {
      defense: [die('d1', 4, 'defense'), die('d2', 6, 'defense')],
      attack: [die('a1', 3, 'attack'), die('a2', 3, 'attack'), die('a3', 5, 'attack')],
    });
    setB(g, {});
    applyChallengeSkill(g, Z08, SK('z08-2'), []);
    // ① 防御骰 → 黑枪攻击骰区
    expect(vals(g.players.B.areas.attack)).toEqual([4, 6]);
    expect(g.players.A.areas.defense).toEqual([]);
    expect(g.challenge!.deferred).toMatchObject({ skillId: 'z08-2' });
    // ② 攻击骰 → 黑枪防御骰区（延后一步）
    resolveLegendDeferred(g, Z08);
    expect(vals(g.players.B.areas.defense)).toEqual([3, 3, 5]);
    expect(g.players.A.areas.attack).toEqual([]);
  });

  it('凶弹业舞：攻击骰 → 防御骰区放不下时**走代决**（上限 4）', () => {
    const g = make();
    setA(g, { attack: [die('a1', 1, 'attack'), die('a2', 2, 'attack'), die('a3', 3, 'attack'), die('a4', 4, 'attack'), die('a5', 5, 'attack')] });
    setB(g, { defense: [die('x1', 6, 'defense'), die('x2', 6, 'defense'), die('x3', 6, 'defense')] }); // room 1
    applyChallengeSkill(g, Z08, SK('z08-2'), []);
    resolveLegendDeferred(g, Z08);
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    expect(g.pending.prompt).toContain('防御骰区还能放 1 颗');
    expect(g.pending.pick?.n).toBe(1);
  });

  it('共振：挑战者能力骰 ≥4 → 双方各得 2 个随机攻击骰', () => {
    const g = make();
    setA(g, { meditation: [die('m1', 1), die('m2', 2), die('m3', 3), die('m4', 4)] });
    setB(g, {});
    applyChallengeSkill(g, Z08, SK('z08-3'), []);
    expect(g.players.A.areas.attack).toHaveLength(2); // A 得 2
    expect(g.players.B.areas.attack).toHaveLength(2); // 黑枪得 2
    expect(g.challenge!.deferred).toBeUndefined();
  });

  it('共振：挑战者能力骰 <4 → 双方各弃 2 个防御骰（代决"弃哪几颗"）', () => {
    const g = make();
    setA(g, { defense: [die('d1', 1, 'defense'), die('d2', 2, 'defense'), die('d3', 3, 'defense')] });
    setB(g, { defense: [die('x1', 1, 'defense'), die('x2', 2, 'defense'), die('x3', 3, 'defense')] });
    applyChallengeSkill(g, Z08, SK('z08-3'), []);
    expect(g.challenge!.deferred).toMatchObject({ skillId: 'z08-3' });
    resolveLegendDeferred(g, Z08); // ① 黑枪侧 → 弹面板
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    expect(g.pending.prompt).toContain('「黑枪」');
    applyAction(g, { t: 'challengePick', id: g.pending.options[0].id });
    resolveLegendDeferred(g, Z08); // ② 挑战者侧 → 弹面板
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    applyAction(g, { t: 'challengePick', id: g.pending.options[0].id });
    resolveLegendDeferred(g, Z08); // 结算
    expect(g.players.B.areas.defense).toHaveLength(1);
    expect(g.players.A.areas.defense).toHaveLength(1);
    expect(g.challenge!.deferred).toBeUndefined();
  });

  it('处刑通牒：攻击骰数 > 挑战者防御骰数 → 本回合 +5，并用攻击骰逐个攻击', () => {
    const g = make();
    setA(g, { defense: [die('d1', 2, 'defense')] }); // A 防 1
    setB(g, { attack: [die('b1', 5, 'attack'), die('b2', 6, 'attack')] }); // 2 > 1
    applyChallengeSkill(g, Z08, SK('z08-4'), []);
    expect(g.players.B.buffs.some((b) => b.source === '处刑通牒' && b.add === 5)).toBe(true);
    expect(g.pendingAttack?.attacker).toBe('B');
    expect(g.pendingAttack?.baseValue).toBe(5); // 攻击点数
    expect(g.pendingAttack?.value).toBe(10); // 伤害 = 点数 5 + 加成 5
    expect(g.pendingAttack?.unblockable).toBe(false); // +5 分支：可抵挡
    expect(g.virtualQueue).toHaveLength(1); // 2 段：1 发出 + 1 待
  });

  it('处刑通牒：攻击骰数 ≤ 挑战者防御骰数 → +1 且**不可抵挡**', () => {
    const g = make();
    setA(g, { defense: [die('d1', 2, 'defense'), die('d2', 3, 'defense'), die('d3', 4, 'defense')] }); // A 防 3
    setB(g, { attack: [die('b1', 5, 'attack')] }); // 1 ≤ 3
    applyChallengeSkill(g, Z08, SK('z08-4'), []);
    expect(g.players.B.buffs.some((b) => b.source === '处刑通牒' && b.add === 1)).toBe(true);
    expect(g.pendingAttack?.value).toBe(6); // 伤害 = 5 + 1
    expect(g.pendingAttack?.unblockable).toBe(true); // 不可抵挡
  });

  it('蛇蝎之泪：本技能驱动骰（3/4）全部 → 防御骰区', () => {
    const g = make();
    setB(g, {});
    applyChallengeSkill(g, Z08, SK('z08-5'), [die('x', 3), die('y', 4)]);
    expect(g.challenge!.deferred).toMatchObject({ skillId: 'z08-5' });
    resolveLegendDeferred(g, Z08);
    expect(vals(g.players.B.areas.defense)).toEqual([3, 4]);
  });
});

describe('挑战模式 · Z08 链式代决（后瞻）', () => {
  it('凶弹业舞：选哪段顺点会影响共振能否发动——有利＝少发动后续（选 2345 挤断共振）', () => {
    const g = make('favor');
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.turn = 1;
    g.challenge!.resumeAt = 2; // z08-2 凶弹业舞
    g.challenge!.driven = [die('a', 1), die('b', 2), die('c', 3), die('d', 4), die('e', 2), die('f', 5)];
    setA(g, {});
    setB(g, {});
    applyAction(g, { t: 'challengeStep' });
    // 选 2345（吃掉 2/3/4/5）→ 剩 [1,2]：共振凑不出 2 颗 {2,5} → 不发动
    expect(g.challenge!.driven.map((d) => d.value)).toEqual([1, 2]);
  });

  it('凶弹业舞：不利＝多发动后续（选 1234 让共振发动）', () => {
    const g = make('against');
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.turn = 1;
    g.challenge!.resumeAt = 2;
    g.challenge!.driven = [die('a', 1), die('b', 2), die('c', 3), die('d', 4), die('e', 2), die('f', 5)];
    setA(g, {});
    setB(g, {});
    applyAction(g, { t: 'challengeStep' });
    // 选 1234 → 剩 [2,5]：共振可发动
    expect(g.challenge!.driven.map((d) => d.value)).toEqual([2, 5]);
  });

  it('共振：选哪两颗会影响处刑通牒能否发动（有利＝选 {2,5} 挤断处刑通牒）', () => {
    const g = make('favor');
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.turn = 1;
    g.challenge!.resumeAt = 3; // z08-3 共振
    g.challenge!.driven = [die('a', 2), die('b', 2), die('c', 5), die('d', 5)];
    setA(g, {}); // 能力骰 0 <4 → 弃置分支（无关后续发动）
    setB(g, {});
    applyAction(g, { t: 'challengeStep' });
    // favor 选 {2,5} → 剩 [2,5]：处刑通牒凑不出同点 → 不发动
    expect(g.challenge!.driven.map((d) => d.value)).toEqual([2, 5]);
  });

  it('处刑通牒：选哪一对会影响蛇蝎之泪防骰数（有利＝吃 3,3 让蛇蝎之泪无 3/4 可搬）', () => {
    const g = make('favor');
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.turn = 1;
    g.challenge!.resumeAt = 4; // z08-4 处刑通牒
    g.challenge!.driven = [die('a', 5), die('b', 5), die('c', 3), die('d', 3)];
    setA(g, {});
    setB(g, {});
    applyAction(g, { t: 'challengeStep' });
    // favor 选 3,3 → 剩 [5,5]：蛇蝎之泪无 3/4 → 不发动
    expect(g.challenge!.driven.map((d) => d.value)).toEqual([5, 5]);
  });

  it('处刑通牒：不利＝吃 5,5 把 3,3 留给蛇蝎之泪', () => {
    const g = make('against');
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.turn = 1;
    g.challenge!.resumeAt = 4;
    g.challenge!.driven = [die('a', 5), die('b', 5), die('c', 3), die('d', 3)];
    setA(g, {});
    setB(g, {});
    applyAction(g, { t: 'challengeStep' });
    expect(g.challenge!.driven.map((d) => d.value)).toEqual([3, 3]);
  });

  it('共振：多候选组（{2,2}/{2,5}/{5,5}）手动模式 → 弹"用哪一组"面板', () => {
    const g = make('manual');
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.turn = 1;
    g.challenge!.resumeAt = 3;
    g.challenge!.driven = [die('a', 2), die('b', 2), die('c', 5), die('d', 5)];
    setA(g, {});
    setB(g, {});
    applyAction(g, { t: 'challengeStep' });
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    expect(g.pending.prompt).toContain('用哪一组驱动骰');
    // 选项按集合匹配（点击顺序无关）
    expect(g.pending.options.map((o) => o.id).sort()).toEqual(['2,2', '2,5', '5,5'].sort());
  });
});

describe('挑战模式 · Z08 整回合跑通', () => {
  it('从头驱动整个传奇回合 → 不报错、正常交还（或终局）', () => {
    const g = make('favor');
    skipInitialReroll(g); // 结束初始重掷 → 首个回合＝传奇回合
    expect(g.activePlayer).toBe('B');
    driveLegendTurn(g);
    expect(g.phase === 'gameOver' || g.activePlayer === 'A').toBe(true);
  });
});
