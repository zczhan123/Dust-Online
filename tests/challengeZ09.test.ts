import { describe, it, expect } from 'vitest';
import {
  createChallengeGame,
  applyChallengeSkill,
  resolveLegendDeferred,
  applyAction,
  skipInitialReroll,
} from '../src/core/engine/game';
import { resolveBlock, settleAttack } from '../src/core/engine/combat';
import { battleNotes } from '../src/core/engine/battleNotes';
import { fxTake, type FxEvent } from '../src/core/engine/fx';
import { CHALLENGES } from '../src/core/content/challenges';
import { driveLegendTurn } from './helpers';
import type { Die, DiceKind, GameState } from '../src/core/model/types';

const die = (id: string, value: number, kind: DiceKind = 'meditation'): Die => ({ id, value, kind });
const Z09 = CHALLENGES.find((c) => c.id === 'Z09')!;
const SK = (id: string) => Z09.skills!.find((s) => s.id === id)!;
const make = (mode: 'manual' | 'favor' | 'against' = 'manual') =>
  createChallengeGame({ seed: 1, cardId: 'Z09', challenger: ['001', '002', '003'], settleMode: mode });
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

describe('挑战模式 · Z09 天殇的战鬼 · 数据', () => {
  it('生命 50 / 门槛 2 / 投 7 / 无防御骰上限 / 威压封顶 4 / 7 条', () => {
    expect(Z09.life).toBe(50);
    expect(Z09.defenseMin).toBe(2);
    expect(Z09.rollDice).toBe(7);
    expect(Z09.defenseCap).toBeUndefined(); // 无上限
    expect(Z09.damageCapPerHit).toBe(4);
    expect(Z09.skills).toHaveLength(7);
    expect(SK('z09-2').slots).toEqual([{ kind: 'straight', count: 4 }]);
    expect(SK('z09-3').slots).toEqual([{ kind: 'straight', count: 3 }]);
    expect(SK('z09-4').slots).toEqual([{ kind: 'same', count: 2 }]);
    expect(SK('z09-5').slots).toEqual([{ kind: 'pips', count: 0, faces: [3, 5], unlimited: true }]);
    expect(SK('z09-x').unordered).toBe(true);
  });
});

describe('挑战模式 · Z09 效果', () => {
  it('陷阵：重掷挑战者选的那 1 颗驱动骰（其余不动）', () => {
    const g = make();
    setA(g, {});
    setB(g, {});
    g.challenge!.driven = [die('a', 3), die('b', 5)];
    g.challenge!.decisions = { 'z09-1': ['b'] };
    applyChallengeSkill(g, Z09, SK('z09-1'), []);
    expect(g.challenge!.driven.find((d) => d.id === 'a')!.value).toBe(3); // 未选 → 不变
    const b = g.challenge!.driven.find((d) => d.id === 'b')!.value;
    expect(b).toBeGreaterThanOrEqual(1);
    expect(b).toBeLessThanOrEqual(6);
  });

  it('陷阵：**favor/against 也弹面板**（挑战者亲自选，非代决、不被自动）', () => {
    const g = make('favor');
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.turn = 1;
    g.challenge!.resumeAt = 1; // z09-1 陷阵
    g.challenge!.driven = [die('a', 3), die('b', 5)];
    setA(g, {});
    setB(g, {});
    applyAction(g, { t: 'challengeStep' });
    expect(g.pending?.kind).toBe('challengePick'); // ★ 自动模式下仍弹面板
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    expect(g.pending.prompt).toContain('陷阵');
    expect(g.pending.options.map((o) => o.id).sort()).toEqual(['a', 'b']);
    applyAction(g, { t: 'challengePick', id: 'b' });
    applyAction(g, { t: 'challengeStep' });
    expect(g.challenge!.driven.find((d) => d.id === 'a')!.value).toBe(3); // 未选的 a 不变
  });

  it('战鬼的残杀：驱骰移入攻击区；随后用「攻击区+防御区」全部骰逐个攻击', () => {
    const g = make();
    setA(g, {});
    setB(g, { attack: [die('b1', 5, 'attack')], defense: [die('b2', 6, 'defense')] });
    applyChallengeSkill(g, Z09, SK('z09-2'), [die('x', 2), die('y', 3), die('z', 4), die('w', 1)]);
    expect(g.challenge!.deferred).toMatchObject({ skillId: 'z09-2' });
    expect(vals(g.players.B.areas.attack)).toEqual([5, 2, 3, 4, 1]); // b1 + 移入的 4 颗
    expect(vals(g.players.B.areas.defense)).toEqual([6]); // 防御区不动
    resolveLegendDeferred(g, Z09); // 6 颗 → 弹顺序面板
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    expect(g.pending.options.map((o) => o.id)).toEqual(['asc', 'desc']);
    applyAction(g, { t: 'challengePick', id: 'desc' });
    resolveLegendDeferred(g, Z09); // 入队 + 发起第一段（最大＝防御区的 6）
    expect(g.pendingAttack?.attacker).toBe('B');
    expect(g.pendingAttack?.baseValue).toBe(6);
  });

  it('奇袭：只把驱动骰移入攻击区（不攻击）', () => {
    const g = make();
    setA(g, {});
    setB(g, { attack: [] });
    applyChallengeSkill(g, Z09, SK('z09-3'), [die('x', 1), die('y', 2), die('z', 3)]);
    expect(vals(g.players.B.areas.attack)).toEqual([1, 2, 3]);
    expect(g.pendingAttack).toBeNull();
    expect(g.virtualQueue).toBeNull();
  });

  it('凛冽之音：补"缺失的点数"各 1 颗（指定点数、≤6、确定性）', () => {
    const g = make();
    setA(g, {});
    setB(g, { defense: [] });
    applyChallengeSkill(g, Z09, SK('z09-4'), [die('x', 2), die('y', 2)]);
    // 空防御区 → 补 1–6 各 1 颗（恰好 6 颗，不再随机重掷）
    expect(g.players.B.areas.defense.map((d) => d.value).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);

    const g2 = make();
    setA(g2, {});
    setB(g2, { defense: [die('d1', 1, 'defense'), die('d3', 3, 'defense')] });
    applyChallengeSkill(g2, Z09, SK('z09-4'), [die('x', 2), die('y', 2)]);
    // 已有 1/3 → 只补缺的 2/4/5/6
    expect(g2.players.B.areas.defense.map((d) => d.value).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(g2.players.B.areas.defense).toHaveLength(6);
  });

  it('威压：主要阶段提示挑战者（`battleNotes`，按 B 上色、文案含"最多造成 4 点伤害"）', () => {
    const g = make();
    g.phase = 'main';
    g.activePlayer = 'A';
    const note = battleNotes(g, 'A').find((n) => n.label === '威压');
    expect(note).toBeTruthy();
    expect(note!.color).toBe('B');
    expect(note!.text).toContain('每次攻击最多造成 4 点伤害');
    // 非 Z09 卡（无 damageCapPerHit）→ 不出现
    const g2 = createChallengeGame({ seed: 1, cardId: 'Z01', challenger: ['001', '002', '003'] });
    g2.phase = 'main';
    g2.activePlayer = 'A';
    expect(battleNotes(g2, 'A').some((n) => n.label === '威压')).toBe(false);
  });

  it('横贯：驱骰移入攻击区 + 置"抵挡后必弃骰"标记 + 延后逐个攻击', () => {
    const g = make();
    setA(g, {});
    setB(g, { attack: [] });
    applyChallengeSkill(g, Z09, SK('z09-5'), [die('x', 3), die('y', 5)]);
    expect(g.challenge!.hengguan).toBe(true);
    expect(vals(g.players.B.areas.attack)).toEqual([3, 5]);
    expect(g.challenge!.deferred).toMatchObject({ skillId: 'z09-5' });
  });
});

describe('挑战模式 · Z09 威压（卡面规则）', () => {
  const attack = (g: GameState, dmg: number): void => {
    settleAttack(
      g,
      { attacker: 'A', value: dmg, baseValue: dmg, sourceValue: dmg, unblockable: false, physical: true },
      { blocked: false, blockedForTriggers: false, damageDealt: dmg, applyDamage: true },
    );
  };

  it('原始伤害 > 4 → 封顶为 4 并弹「威压」名', () => {
    const g = make();
    g.players.B.life = 30;
    fxTake();
    attack(g, 8);
    expect(g.players.B.life).toBe(26); // 8 → 4
    const ev = fxTake().find(
      (e): e is Extract<FxEvent, { kind: 'legendSkill' }> => e.kind === 'legendSkill' && e.skillKey === 'z09-x',
    );
    expect(ev?.skillName).toBe('威压');
    expect(ev?.announce).toBe(true);
  });

  it('原始伤害 ≤ 4 → 原样、不弹「威压」名', () => {
    const g = make();
    g.players.B.life = 30;
    fxTake();
    attack(g, 3);
    expect(g.players.B.life).toBe(27);
    expect(fxTake().some((e) => e.kind === 'legendSkill' && e.skillKey === 'z09-x')).toBe(false);
  });

  it('只对挑战者(A)→传奇 的攻击封顶（传奇自己/打挑战者 不受影响）', () => {
    const g = make();
    g.players.A.life = 30;
    settleAttack(
      g,
      { attacker: 'B', value: 8, baseValue: 8, unblockable: false, physical: true },
      { blocked: false, blockedForTriggers: false, damageDealt: 8, applyDamage: true },
    );
    expect(g.players.A.life).toBe(22); // 传奇打挑战者：不封顶
  });
});

describe('挑战模式 · Z09 链式代决（后瞻）', () => {
  const drive = (mode: 'favor' | 'against'): GameState => {
    const g = make(mode);
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.turn = 1;
    g.challenge!.resumeAt = 2; // z09-2 战鬼的残杀
    g.challenge!.driven = [
      die('a', 1), die('b', 2), die('c', 3), die('d', 4), die('e', 5), die('f', 6),
    ];
    setA(g, {});
    setB(g, {});
    applyAction(g, { t: 'challengeStep' });
    return g;
  };

  it('有利＝少发动后续（选 2345，剩 [1,6] 后续全不发动）', () => {
    const g = drive('favor');
    expect(vals(g.challenge!.driven).sort((x, y) => x - y)).toEqual([1, 6]);
  });

  it('不利＝多发动后续（选 1234，剩 [5,6] 让横贯能发动）', () => {
    const g = drive('against');
    expect(vals(g.challenge!.driven).sort((x, y) => x - y)).toEqual([5, 6]);
  });
});

describe('挑战模式 · Z09 横贯 · 挑战者抵挡后必弃骰', () => {
  it('横贯生效期间：挑战者抵挡 → 弹「横贯」名 + 排队弃 1 个任意能力骰', () => {
    const g = make();
    g.challenge!.hengguan = true;
    setA(g, { defense: [die('d1', 5, 'defense')], meditation: [die('m1', 2), die('m2', 3)] });
    fxTake();
    g.pendingAttack = { attacker: 'B', value: 5, baseValue: 5, unblockable: false, physical: true };
    resolveBlock(g, [{ dieIds: ['d1'] }]);
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    expect(g.pending.tag).toBe('hengguan');
    expect(g.pending.pick?.n).toBe(1);
    expect(fxTake().some((e) => e.kind === 'legendSkill' && e.skillKey === 'z09-5')).toBe(true);
    // 抵挡已消耗 d1 → 剩 2 颗冥想骰；选出 1 颗 → 弃置 → 剩 1
    const id = g.pending.options[0].id;
    applyAction(g, { t: 'challengePick', id });
    const left = g.players.A.areas.defense.length + g.players.A.areas.meditation.length;
    expect(left).toBe(1);
  });

  it('无「横贯」标记时：挑战者抵挡 → 不排队弃骰', () => {
    const g = make();
    g.challenge!.hengguan = false;
    setA(g, { defense: [die('d1', 5, 'defense')] });
    g.pendingAttack = { attacker: 'B', value: 5, baseValue: 5, unblockable: false, physical: true };
    resolveBlock(g, [{ dieIds: ['d1'] }]);
    expect(g.pending).toBeNull();
  });
});

describe('挑战模式 · Z09 整回合跑通', () => {
  it('从头驱动整个传奇回合 → 不报错、正常交还（或终局）', () => {
    const g = make('favor');
    skipInitialReroll(g);
    expect(g.activePlayer).toBe('B');
    driveLegendTurn(g);
    expect(g.phase === 'gameOver' || g.activePlayer === 'A').toBe(true);
  });
});
