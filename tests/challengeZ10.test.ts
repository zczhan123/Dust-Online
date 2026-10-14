import { describe, it, expect } from 'vitest';
import {
  createChallengeGame,
  applyChallengeSkill,
  applyAction,
  skipInitialReroll,
} from '../src/core/engine/game';
import { virtualAttack } from '../src/core/engine/combat';
import { CHALLENGES } from '../src/core/content/challenges';
import type { Die, DiceKind, GameState } from '../src/core/model/types';

const die = (id: string, value: number, kind: DiceKind = 'meditation'): Die => ({ id, value, kind });
const Z10 = CHALLENGES.find((c) => c.id === 'Z10')!;
const SK = (id: string) => Z10.skills!.find((s) => s.id === id)!;
const make = (mode: 'manual' | 'favor' | 'against' = 'manual') =>
  createChallengeGame({ seed: 1, cardId: 'Z10', challenger: ['001', '002', '003'], settleMode: mode });
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

describe('挑战模式 · Z10 破晓之剑 · 数据', () => {
  it('生命 45 / 门槛 3 / 上限 4 / 投 6 / 7 条', () => {
    expect(Z10.life).toBe(45);
    expect(Z10.defenseMin).toBe(3);
    expect(Z10.defenseCap).toBe(4);
    expect(Z10.rollDice).toBe(6);
    expect(Z10.skills).toHaveLength(6);
    expect(SK('z10-1').passive).toBe(true);
    expect(SK('z10-1').alwaysOn).toBe('lowLife');
    expect(SK('z10-2').slots).toEqual([{ kind: 'same', count: 3 }]);
    expect(SK('z10-3').slots).toEqual([{ kind: 'straight', count: 3 }]);
    expect(SK('z10-4').slots).toEqual([{ kind: 'same', count: 2 }]);
    expect(SK('z10-5').slots).toEqual([{ kind: 'same', count: 2 }]);
    expect(SK('z10-2').slotChoice).toBe(true);
    expect(SK('z10-5').slotChoice).toBeUndefined();
  });
});

describe('挑战模式 · Z10 迟来的正义（攻击伤害 ×2）', () => {
  it('任一方生命 < 10 → 传奇攻击伤害＝点数×2（baseValue 仍是点数）', () => {
    const g = make();
    g.players.A.life = 50;
    g.players.B.life = 9;
    virtualAttack(g, 'B', 6, { skill: '测试', owner: 'B' });
    expect(g.pendingAttack?.baseValue).toBe(6);
    expect(g.pendingAttack?.value).toBe(12);
    expect(g.pendingAttack?.bonusLabel).toBe('迟来的正义');
  });

  it('双方都 ≥10 → 不翻倍（伤害＝点数）', () => {
    const g = make();
    g.players.A.life = 50;
    g.players.B.life = 50;
    virtualAttack(g, 'B', 6, { skill: '测试', owner: 'B' });
    expect(g.pendingAttack?.value).toBe(6);
  });

  it('挑战者 < 10 也触发', () => {
    const g = make();
    g.players.A.life = 5;
    g.players.B.life = 45;
    virtualAttack(g, 'B', 6, { skill: '测试', owner: 'B' });
    expect(g.pendingAttack?.value).toBe(12);
  });
});

describe('挑战模式 · Z10 效果', () => {
  it('白昼之火：3 次 6 点（只能用冥想骰挡）+ 获得 2 防御骰', () => {
    const g = make();
    setA(g, {});
    setB(g, {});
    applyChallengeSkill(g, Z10, SK('z10-2'), [die('a', 1), die('b', 1), die('c', 1)]);
    expect(g.pendingAttack?.attacker).toBe('B');
    expect(g.pendingAttack?.baseValue).toBe(6);
    expect(g.pendingAttack?.blockKind).toBe('meditation');
    expect(g.virtualQueue).toHaveLength(2); // 3 段：1 发 + 2 待
    expect(g.players.B.areas.defense).toHaveLength(2);
  });

  it('陨落：3 次 6 点（只能用攻击骰挡）+ 获得 2 防御骰', () => {
    const g = make();
    setA(g, {});
    setB(g, {});
    applyChallengeSkill(g, Z10, SK('z10-3'), [die('a', 1), die('b', 2), die('c', 3)]);
    expect(g.pendingAttack?.baseValue).toBe(6);
    expect(g.pendingAttack?.blockKind).toBe('attack');
    expect(g.players.B.areas.defense).toHaveLength(2);
  });

  it('涤罪大剑术：回复 10 + 3 次 4 点 + 2 防御骰 + 攻击区有骰则全体攻击', () => {
    const g = make();
    setA(g, {});
    g.players.B.life = 30;
    setB(g, { attack: [die('k1', 5, 'attack')] });
    applyChallengeSkill(g, Z10, SK('z10-4'), [die('a', 2), die('b', 2)]);
    expect(g.players.B.life).toBe(40); // 回复 10
    expect(g.players.B.areas.defense).toHaveLength(2);
    // 队列 = 其余 2 段 4 点 + 攻击区那颗 5 点；首段已发起（4 点）
    expect(g.pendingAttack?.baseValue).toBe(4);
    expect(g.virtualQueue).toHaveLength(3);
  });

  it('救赎：设置"下一回合 override"（投 5、攻击 +1）', () => {
    const g = make();
    applyChallengeSkill(g, Z10, SK('z10-5'), [die('a', 2), die('b', 2)]);
    expect(g.challenge!.nextTurnOverride).toEqual({ rollDice: 5, atkBonus: 1 });
  });
});

describe('挑战模式 · Z10 救赎 · 真·新回合', () => {
  it('触发后立刻进入新回合：T+1、投 5 驱动骰、攻击 +1', () => {
    const g = make();
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.turn = 1;
    g.challenge!.resumeAt = 5; // z10-5 救赎
    g.challenge!.driven = [die('a', 2), die('b', 2)]; // 2 同点 → 救赎可发动
    setA(g, {});
    g.players.B.areas.attack = [];
    g.players.B.areas.defense = [];
    const t0 = g.turnIndex;
    applyAction(g, { t: 'challengeStep' }); // 救赎发动 → 设 override
    expect(g.challenge!.nextTurnOverride).toEqual({ rollDice: 5, atkBonus: 1 });
    applyAction(g, { t: 'challengeStep' }); // 回合收尾 → 新回合
    expect(g.turnIndex).toBe(t0 + 1); // 真·新回合（T+1）
    expect(g.activePlayer).toBe('B');
    expect(g.challenge!.driven).toHaveLength(5); // 该回合投 5 驱动骰
    expect(g.players.B.buffs.some((b) => b.source === '救赎' && b.add === 1)).toBe(true);
  });
});

describe('挑战模式 · Z10 链式代决（后瞻）', () => {
  // 驱动骰 [1,1,1, 3,3,3, 4,5]：白昼之火
  //  · 吃 {3,3,3} → 剩 [1,1,1,4,5] → 陨落(345) 断、涤罪(1,1,1) 发 → 后续发动 1
  //  · 吃 {1,1,1} → 剩 [3,3,3,4,5] → 陨落(345) 发、涤罪(3,3) 发 → 后续发动 2
  const drive = (mode: 'favor' | 'against'): GameState => {
    const g = make(mode);
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.turn = 1;
    g.challenge!.resumeAt = 2; // z10-2 白昼之火
    g.challenge!.driven = [
      die('a1', 1), die('a2', 1), die('a3', 1),
      die('b1', 3), die('b2', 3), die('b3', 3),
      die('c1', 4), die('c2', 5),
    ];
    setA(g, {});
    setB(g, {});
    applyAction(g, { t: 'challengeStep' });
    return g;
  };

  it('有利＝后续发动少（吃 {3,3,3}，剩 [1,1,1,4,5]）', () => {
    const g = drive('favor');
    expect(vals(g.challenge!.driven).sort((x, y) => x - y)).toEqual([1, 1, 1, 4, 5]);
  });

  it('不利＝后续发动多（吃 {1,1,1}，剩 [3,3,3,4,5]）', () => {
    const g = drive('against');
    expect(vals(g.challenge!.driven).sort((x, y) => x - y)).toEqual([3, 3, 3, 4, 5]);
  });
});

describe('挑战模式 · Z10 整回合跑通', () => {
  it('从头驱动整个传奇回合 → 不报错、正常交还（或终局）', async () => {
    const { driveLegendTurn } = await import('./helpers');
    const g = make('favor');
    skipInitialReroll(g);
    expect(g.activePlayer).toBe('B');
    driveLegendTurn(g);
    expect(g.phase === 'gameOver' || g.activePlayer === 'A').toBe(true);
  });
});
