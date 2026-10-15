import { describe, it, expect } from 'vitest';
import { createChallengeGame, createGame, applyChallengeSkill, applyAction, skipInitialReroll } from '../src/core/engine/game';
import { matchSlots, legendLockValue, isValueLocked } from '../src/core/engine/challenge';
import { abilityDicePool, paySlots } from '../src/core/engine/effects';
import { consumeDice } from '../src/core/engine/skills';
import { endPhase } from '../src/core/engine/phases';
import { CHALLENGES, slotPhrase } from '../src/core/content/challenges';
import type { Die, DiceKind, GameState } from '../src/core/model/types';

const die = (id: string, value: number, kind: DiceKind = 'meditation'): Die => ({ id, value, kind });
const Z12 = CHALLENGES.find((c) => c.id === 'Z12')!;
const SK = (id: string) => Z12.skills!.find((s) => s.id === id)!;
const make = (mode: 'manual' | 'favor' | 'against' = 'manual') =>
  createChallengeGame({ seed: 1, cardId: 'Z12', challenger: ['001', '002', '003'], settleMode: mode });
const setA = (g: GameState, areas: { attack?: Die[]; defense?: Die[]; meditation?: Die[] }): void => {
  g.players.A.areas.attack = areas.attack ?? [];
  g.players.A.areas.defense = areas.defense ?? [];
  g.players.A.areas.meditation = areas.meditation ?? [];
};
const setB = (g: GameState, areas: { attack?: Die[]; defense?: Die[]; meditation?: Die[] }): void => {
  g.players.B.areas.attack = areas.attack ?? [];
  g.players.B.areas.defense = areas.defense ?? [];
  g.players.B.areas.meditation = areas.meditation ?? [];
};
const aTotal = (g: GameState): number =>
  g.players.A.areas.attack.length + g.players.A.areas.defense.length + g.players.A.areas.meditation.length;

describe('挑战模式 · Z12 渡世行僧 · 数据', () => {
  it('生命 50 / 门槛 3 / 上限无 / 投 8 / 6 条', () => {
    expect(Z12.life).toBe(50);
    expect(Z12.defenseMin).toBe(3);
    expect(Z12.defenseCap).toBeUndefined();
    expect(Z12.rollDice).toBe(8);
    expect(Z12.artifacts).toEqual(['034', '035', '036']);
    expect(Z12.skills).toHaveLength(6);
    expect(SK('z12-1').marker).toBe('∞');
    expect(SK('z12-1').alwaysOn).toBe(true); // 面板常亮「生效中」
    expect(SK('z12-2').marker).toBe('怜悯*');
    expect(SK('z12-2').slots).toEqual([{ kind: 'straight', count: 6 }]);
    expect(SK('z12-3').slots).toEqual([
      { kind: 'pips', count: 1, faces: [1, 2] },
      { kind: 'pips', count: 1, faces: [3, 4] },
      { kind: 'pips', count: 1, faces: [5, 6] },
    ]);
    expect(SK('z12-4').slots).toEqual(SK('z12-3').slots);
    expect(SK('z12-3').slotChoice).toBe(true); // 多格 pips：有得挑时代决
    expect(SK('z12-4').slotChoice).toBe(true);
    expect(SK('z12-5').marker).toBeUndefined(); // 非 ∞：是"2 颗同点一组"的槽技能
    expect(SK('z12-5').slots).toEqual([{ kind: 'same', count: 2 }]);
    expect(slotPhrase(SK('z12-2').slots)).toBe('（满足6颗顺点时发动）');
    // 万象俱灭＝1–6 各一（唯一 6 连顺）
    const straight6 = [die('a', 1), die('b', 2), die('c', 3), die('d', 4), die('e', 5), die('f', 6)];
    expect(matchSlots(SK('z12-2').slots!, straight6)).not.toBeNull();
    expect(matchSlots(SK('z12-2').slots!, [die('a', 1), die('b', 2), die('c', 3), die('d', 4), die('e', 5), die('f', 5)])).toBeNull();
  });
});

describe('挑战模式 · Z12 效果（批 1）', () => {
  it('万象俱灭：弃置挑战者全部能力骰，真伤 = 点数总和', () => {
    const g = make();
    setA(g, { attack: [die('a1', 2, 'attack')], defense: [die('d1', 5, 'defense')], meditation: [die('m1', 6, 'meditation')] });
    const life0 = g.players.A.life;
    applyChallengeSkill(g, Z12, SK('z12-2'), [die('x', 1), die('y', 2), die('z', 3), die('p', 4), die('q', 5), die('r', 6)]);
    expect(aTotal(g)).toBe(0);
    expect(g.players.A.life).toBe(life0 - (2 + 5 + 6)); // 13
  });

  it('超度：重掷挑战者"最大区域"全部骰并按分布落区；造成 5 真伤', () => {
    const g = make();
    setA(g, { meditation: [die('m1', 1, 'meditation'), die('m2', 2, 'meditation'), die('m3', 3, 'meditation')] });
    const life0 = g.players.A.life;
    applyChallengeSkill(g, Z12, SK('z12-3'), [die('x', 1), die('y', 3), die('z', 5)]);
    expect(aTotal(g)).toBe(3); // 重掷不改变总数
    expect(g.players.A.life).toBe(life0 - 5);
  });

  it('破障：5 次 4 点攻击 + 用攻击区全部骰逐个攻击（不移动驱动骰）', () => {
    const g = make();
    setA(g, {});
    setB(g, { attack: [die('k', 5, 'attack')] });
    applyChallengeSkill(g, Z12, SK('z12-4'), [die('x', 1), die('y', 3), die('z', 5)]);
    // 卡面只"进行 5 次 4 点攻击 + 若攻击区有骰也一并攻击" → 驱动骰**不移入**攻击区
    expect(g.pendingAttack?.attacker).toBe('B');
    expect(g.pendingAttack?.baseValue).toBe(4);
    expect(g.virtualQueue).toHaveLength(5); // 其余 4 段 4 点 + 1 颗 5 点
    expect(g.players.B.areas.attack.map((d) => d.value)).toEqual([5]);
  });

  it('万丈明光：补随机防御骰至 3 + 回复 3 点生命', () => {
    const g = make();
    setB(g, { defense: [] });
    g.players.B.life = 40;
    applyChallengeSkill(g, Z12, SK('z12-5'), []);
    expect(g.players.B.areas.defense).toHaveLength(3);
    expect(g.players.B.life).toBe(43);

    // 已有 ≥3 颗 → 不补
    const g2 = make();
    setB(g2, {
      defense: [die('d1', 1, 'defense'), die('d2', 2, 'defense'), die('d3', 3, 'defense'), die('d4', 4, 'defense')],
    });
    applyChallengeSkill(g2, Z12, SK('z12-5'), []);
    expect(g2.players.B.areas.defense).toHaveLength(4);
  });

  it('不动菩提：发动只"置封锁"，不动驱动骰', () => {
    const g = make();
    g.challenge!.driven = [die('a', 1), die('b', 2), die('c', 3)];
    const before = JSON.stringify(g.challenge!.driven);
    applyChallengeSkill(g, Z12, SK('z12-1'), []);
    expect(JSON.stringify(g.challenge!.driven)).toBe(before);
  });
});

describe('挑战模式 · Z12 超度 / 破障 · 多格 pips 槽代决', () => {
  it('超度：多种填法 → 自选弹面板（候选取自 1/2、3/4、5/6 各一颗）', () => {
    const g = make();
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.turn = 2;
    g.challenge!.resumeAt = 3; // 超度
    g.challenge!.driven = [die('a', 1), die('b', 2), die('c', 3), die('d', 5)];
    setA(g, {});
    applyAction(g, { t: 'challengeStep' });
    const pd = g.pending as { kind?: string; options?: { id?: string }[] } | null;
    expect(pd?.kind).toBe('challengePick');
    expect(pd!.options!.length).toBeGreaterThan(1); // 2×1×1 之外另有 (1|2) 之分 → 多组
  });

  it('超度（有利）：自动选组后本步照常结算（不弹面板）', () => {
    const g = make('favor');
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.turn = 2;
    g.challenge!.resumeAt = 3;
    g.challenge!.driven = [die('a', 1), die('b', 2), die('c', 3), die('d', 5)];
    setA(g, { meditation: [die('m', 4, 'meditation')] });
    const life0 = g.players.A.life;
    applyAction(g, { t: 'challengeStep' });
    expect(g.pending).toBeNull(); // 自动选组，不弹面板
    expect(g.players.A.life).toBe(life0 - 5); // 超度照常造成 5 真伤
  });

  it('链式后瞻：超度吃法不同 → 影响「万丈明光（2 同点）」能否发动（有利＝让后续少发动）', () => {
    // driven = 2,2,4,4,5,5,6,6
    //  · 超度吃 2,4,5 → 剩 [2,4,5,6,6]（破障最优吃完后凑不出同点 → 万丈明光发不动）→ 后续共 1
    //  · 超度吃 2,4,6 → 剩 [2,4,5,5,6]（破障可留 [5,5] → 万丈明光发动）→ 后续共 2
    const run = (mode: 'favor' | 'against'): number[] => {
      const g = make(mode);
      skipInitialReroll(g);
      g.phase = 'main';
      g.activePlayer = 'B';
      g.challenge!.turn = 2;
      g.challenge!.resumeAt = 3; // 超度
      g.challenge!.driven = [
        die('a1', 2), die('a2', 2), die('b1', 4), die('b2', 4),
        die('c1', 5), die('c2', 5), die('d1', 6), die('d2', 6),
      ];
      setA(g, {});
      applyAction(g, { t: 'challengeStep' });
      return g.challenge!.driven.map((d) => d.value).sort((x, y) => x - y);
    };
    expect(run('favor')).toEqual([2, 4, 5, 6, 6]); // 吃 2、4、5
    expect(run('against')).toEqual([2, 4, 5, 5, 6]); // 吃 2、4、6
  });
});

describe('挑战模式 · Z12 整回合跑通', () => {
  it('从头驱动整个传奇回合 → 不报错、正常交还（或终局）', async () => {
    const { driveLegendTurn } = await import('./helpers');
    const g = make('favor');
    skipInitialReroll(g);
    expect(g.activePlayer).toBe('B');
    driveLegendTurn(g);
    expect(g.phase === 'gameOver' || g.activePlayer === 'A').toBe(true);
  });
});

describe('挑战模式 · Z12 破障 · 顺序代决（前置问）', () => {
  it('攻击区 >1 颗 → 发动时先弹"顺序"面板（自选）', () => {
    const g = make();
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.turn = 2;
    g.challenge!.resumeAt = 4; // z12-4 破障
    g.challenge!.driven = [die('a', 1), die('b', 3), die('c', 5)];
    setA(g, {});
    setB(g, { attack: [die('k', 6, 'attack'), die('j', 2, 'attack')] });
    applyAction(g, { t: 'challengeStep' });
    expect(g.pending?.kind).toBe('challengePick');
    const pd = g.pending as { options: { id: string }[] } | null;
    expect(pd!.options.map((o) => o.id).sort()).toEqual(['asc', 'desc']);
  });
});

describe('挑战模式 · Z12 不动菩提（封锁）', () => {
  it('众数唯一 → 置 lockValue（封锁该点数）', () => {
    const g = make();
    g.challenge!.driven = [die('a', 3), die('b', 3), die('c', 3), die('d', 1)];
    applyChallengeSkill(g, Z12, SK('z12-1'), []);
    expect(g.challenge!.lockValue).toBe(3);
  });

  it('并列众数 → 代决（自选弹面板；auto 复用 Z05 口径）', () => {
    const g = make();
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.turn = 2;
    g.challenge!.resumeAt = 1; // z12-1 不动菩提
    g.challenge!.driven = [die('a', 2), die('b', 2), die('c', 5), die('d', 5)];
    applyAction(g, { t: 'challengeStep' });
    const pd = g.pending as { kind?: string; options?: { id?: string; label?: string }[] } | null;
    expect(pd?.kind).toBe('challengePick');
    expect(pd!.options!.map((o) => o.id)).toEqual(['2', '5']);

    // auto 有利＝挑战者**该点数骰更少**者（同 Z05 不可饶恕口径）：A 有 [2,2,5] → 锁 5
    const g2 = make('favor');
    skipInitialReroll(g2);
    g2.phase = 'main';
    g2.activePlayer = 'B';
    g2.challenge!.turn = 2;
    g2.challenge!.resumeAt = 1;
    g2.challenge!.driven = [die('a', 2), die('b', 2), die('c', 5), die('d', 5)];
    setA(g2, { attack: [die('x2a', 2, 'attack'), die('x2b', 2, 'attack'), die('x5', 5, 'attack')] });
    applyAction(g2, { t: 'challengeStep' });
    expect(g2.challenge!.lockValue).toBe(5);

    // 并列且 A 无该点数骰 → 再比点值：有利＝取小
    const g3 = make('favor');
    skipInitialReroll(g3);
    g3.phase = 'main';
    g3.activePlayer = 'B';
    g3.challenge!.turn = 2;
    g3.challenge!.resumeAt = 1;
    g3.challenge!.driven = [die('a', 2), die('b', 2), die('c', 5), die('d', 5)];
    setA(g3, {});
    applyAction(g3, { t: 'challengeStep' });
    expect(g3.challenge!.lockValue).toBe(2);
  });

  it('封锁：被锁点数的骰不可使用/消耗（paySlots 抛错）、不可弃置（consumeDice 抛错）、不在可支付池', () => {
    const g = make();
    g.challenge!.lockValue = 3;
    setA(g, { attack: [die('a3', 3, 'attack'), die('a5', 5, 'attack')] });
    expect(abilityDicePool(g, 'A').map((d) => d.id)).toEqual(['a5']); // 池已排除 a3
    expect(() => paySlots(g, 'A', [{ kind: 'attack' }], [{ dieIds: ['a3'] }])).toThrow();
    expect(() => consumeDice(g, g.players.A, 'attack', ['a3'])).toThrow();
    // 5 点不受影响
    expect(() => paySlots(g, 'A', [{ kind: 'attack' }], [{ dieIds: ['a5'] }])).not.toThrow();
  });

  it('封锁不挡"传奇强制弃置"（byLegend）与"意志上限弃骰"（豁免）', () => {
    const g = make();
    g.challenge!.lockValue = 3;
    setA(g, { defense: [die('d3', 3, 'defense')] });
    expect(() => consumeDice(g, g.players.A, 'defense', ['d3'], { byLegend: true })).not.toThrow();
    expect(g.players.A.areas.defense).toHaveLength(0);

    const g2 = make();
    g2.challenge!.lockValue = 3;
    g2.players.A.areas = { attack: [], defense: [], meditation: [] };
    for (let i = 0; i < 12; i++) g2.players.A.areas.meditation.push(die(`m${i}`, 3, 'meditation'));
    expect(endPhase(g2, 'A')).toBeGreaterThan(0); // 超上限弃骰＝豁免（不被封锁卡死）
  });

  it('标准模式不受影响（无 lockValue 概念）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
    expect(legendLockValue(g)).toBeNull();
    expect(isValueLocked(g, 'A', 3)).toBe(false);
  });

  it('传奇下个回合开始时清除封锁', async () => {
    const { driveLegendTurn } = await import('./helpers');
    const g = make();
    skipInitialReroll(g);
    driveLegendTurn(g); // 传奇第 1 回合跑完 → 交还 A
    expect(g.activePlayer).toBe('A');
    g.challenge!.lockValue = 3; // 手动置位
    let guard = 0;
    while (g.activePlayer === 'A' && guard++ < 10) applyAction(g, { t: 'advance' }); // A 回合跑完
    expect(g.activePlayer).toBe('B'); // 传奇下一回合已开始
    expect(g.challenge!.lockValue).toBeUndefined(); // runLegendTurn 清除
  });
});
