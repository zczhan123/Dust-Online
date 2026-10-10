import { describe, it, expect } from 'vitest';
import { createChallengeGame, applyAction, skipInitialReroll } from '../src/core/engine/game';
import { CHALLENGES, slotPhrase } from '../src/core/content/challenges';
import type { Die, DiceKind } from '../src/core/model/types';

const die = (id: string, value: number, kind: DiceKind = 'meditation'): Die => ({ id, value, kind });
const make = (mode: 'manual' | 'favor' | 'against' = 'manual') =>
  createChallengeGame({ seed: 1, cardId: 'Z01', challenger: ['001', '002', '003'], settleMode: mode });

describe('挑战模式 · Z01 雨中剑圣（批1：数据 / 龙游万象 / 雨落狂流）', () => {
  it('数据：投 7 驱动骰；裁雨流＝无限 3/4 点槽', () => {
    const z1 = CHALLENGES.find((c) => c.id === 'Z01')!;
    expect(z1.rollDice).toBe(7);
    expect(z1.life).toBe(50);
    expect(z1.defenseCap).toBe(5);
    expect(z1.defenseMin).toBe(2);
    expect(z1.skills![5].slots).toEqual([{ kind: 'pips', count: 0, faces: [3, 4], unlimited: true }]);
    expect(slotPhrase(z1.skills![5].slots)).toBe('（满足无限颗3/4点时发动）');
    expect(z1.skills![1].marker).toBe('∞');
    expect(z1.skills![2].marker).toBe('怜悯*');
    expect(z1.skills![2].endsTurn).toBe(true);
  });

  it('龙游万象：重掷 1/6 点驱动骰（其余不动）', () => {
    const g = make('manual');
    skipInitialReroll(g);
    g.challenge!.resumeAt = 1; // z01-1
    g.challenge!.driven = [die('d1', 1), die('d6', 6), die('d2', 2), die('d3', 3)];
    const rngBefore = g.rngState;
    applyAction(g, { t: 'challengeStep' });
    const v = g.challenge!.driven.map((d) => d.value);
    expect(v[2]).toBe(2); // 2 点未重掷
    expect(v[3]).toBe(3); // 3 点未重掷
    expect(g.rngState).not.toBe(rngBefore); // 发生了重掷随机
    for (const x of [v[0], v[1]]) {
      expect(x).toBeGreaterThanOrEqual(1);
      expect(x).toBeLessThanOrEqual(6);
    }
  });

  it('雨落狂流：不符合分布每 3 个弃挑战者 1 防御骰（有利弃小 / 不利弃大）', () => {
    for (const [mode, kept] of [
      ['favor', 5],
      ['against', 2],
    ] as const) {
      const g = make(mode);
      skipInitialReroll(g);
      g.challenge!.resumeAt = 4; // z01-4
      g.challenge!.driven = [];
      // 002 游龙 攻击分布＝[3,4] → 5/5/2 都不符合 → off=3 → k=1
      g.players.B.areas.attack = [die('b5a', 5, 'attack'), die('b5b', 5, 'attack'), die('b2', 2, 'attack')];
      g.players.A.areas.defense = [die('ad2', 2, 'defense'), die('ad5', 5, 'defense')];
      applyAction(g, { t: 'challengeStep' });
      expect(g.players.A.areas.defense.map((d) => d.value)).toEqual([kept]);
    }
  });

  it('雨落狂流·自选：有得挑时弹面板（选项＝可弃的组合）', () => {
    const g = make('manual');
    skipInitialReroll(g);
    g.challenge!.resumeAt = 4;
    g.challenge!.driven = [];
    g.players.B.areas.attack = [die('b5a', 5, 'attack'), die('b5b', 5, 'attack'), die('b2', 2, 'attack')];
    g.players.A.areas.defense = [die('ad2', 2, 'defense'), die('ad5', 5, 'defense')];
    applyAction(g, { t: 'challengeStep' });
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    expect(g.pending.options.map((o) => o.label)).toEqual(['防2', '防5']);
    applyAction(g, { t: 'challengePick', id: g.pending.options[1].id }); // 选 防5
    applyAction(g, { t: 'challengeStep' });
    expect(g.players.A.areas.defense.map((d) => d.value)).toEqual([2]);
  });

  it('断斩一斩：弃双方全部区域骰 + 对挑战者 10 真伤 + 昔传得 3 防御骰 + 立即结束回合', () => {
    const g = make('manual');
    skipInitialReroll(g);
    g.challenge!.turn = 1; // 非首回合（怜悯* 只在首回合跳过）
    g.challenge!.resumeAt = 2;
    g.challenge!.driven = [die('a2', 2), die('a2b', 2), die('a5', 5), die('a5b', 5), die('a5c', 5)];
    g.players.A.areas = {
      attack: [die('aa', 3, 'attack')],
      defense: [die('ad', 4, 'defense')],
      meditation: [die('am', 1, 'meditation')],
    };
    g.players.B.areas.attack = [die('ba', 6, 'attack')];
    const life0 = g.players.A.life;
    applyAction(g, { t: 'challengeStep' });
    expect(g.players.A.areas.attack).toEqual([]);
    expect(g.players.A.areas.defense).toEqual([]);
    expect(g.players.A.areas.meditation).toEqual([]);
    expect(g.players.B.areas.attack).toEqual([]); // 昔传的骰也全弃
    expect(g.players.A.life).toBe(life0 - 10);
    expect(g.players.B.areas.defense).toHaveLength(3); // 之后获得 3 随机防御骰
    expect(g.activePlayer).toBe('A'); // 立即结束回合 → 交还挑战者
  });

  it('龙腾万丈：得 4 能力骰 → 最大/最小各 1 进攻击区、其余 2（移入步）进防御区', () => {
    const g = make('manual');
    skipInitialReroll(g);
    g.challenge!.resumeAt = 3;
    g.challenge!.driven = [die('a2', 2), die('a2b', 2), die('a5', 5)];
    g.players.A.areas.attack = [];
    g.players.B.areas.attack = [];
    g.players.B.areas.defense = [];
    applyAction(g, { t: 'challengeStep' }); // roll 4 + 最大/最小 → 攻击区；防御移入延后
    expect(g.players.B.areas.attack).toHaveLength(2);
    expect(g.players.B.areas.defense).toHaveLength(0); // 防御尚未移入
    applyAction(g, { t: 'challengeStep' }); // 移入中间 2 颗 → 防御区（room 足 → 不弹）
    expect(g.pending).toBeNull();
    const atk = g.players.B.areas.attack.map((d) => d.value).sort((a, b) => a - b);
    const def = g.players.B.areas.defense.map((d) => d.value).sort((a, b) => a - b);
    const all = [...atk, ...def].sort((a, b) => a - b);
    expect(all).toHaveLength(4);
    expect(atk).toEqual([all[0], all[3]]); // 最小 + 最大
    expect(def).toEqual([all[1], all[2]]); // 中间 2 个
  });

  it('龙腾万丈：防御区剩 1 位（满 4）→ 挑战者代决哪颗进（选后按所选进）', () => {
    const g = make('manual');
    skipInitialReroll(g);
    g.challenge!.resumeAt = 3;
    g.challenge!.driven = [die('a2', 2), die('a2b', 2), die('a5', 5)];
    g.players.B.areas.attack = [];
    g.players.B.areas.defense = [1, 2, 3, 4].map((v, i) => die(`bd${i}`, v, 'defense'));
    applyAction(g, { t: 'challengeStep' }); // roll + 攻击；防御移入延后
    applyAction(g, { t: 'challengeStep' }); // 移入步（room 1 < 2）
    if (g.pending?.kind === 'challengePick') {
      const opt = g.pending.options[0];
      const val = Number(opt.label.replace(/[^\d]/g, ''));
      applyAction(g, { t: 'challengePick', id: opt.id });
      applyAction(g, { t: 'challengeStep' }); // 移入所选
      expect(g.players.B.areas.defense).toHaveLength(5);
      expect(g.players.B.areas.defense[4].value).toBe(val);
    } else {
      // 两颗中间骰恰好同点 → 等价，无需代决
      expect(g.players.B.areas.defense).toHaveLength(5);
    }
    expect(g.challenge!.deferred).toBeUndefined();
  });

  it('龙腾万丈·有利/不利：剩 1 位时自动——有利进小、不利进大', () => {
    const entered = (mode: 'favor' | 'against'): number => {
      const g = make(mode);
      skipInitialReroll(g);
      g.challenge!.resumeAt = 3;
      g.challenge!.driven = [die('a2', 2), die('a2b', 2), die('a5', 5)];
      g.players.B.areas.attack = [];
      g.players.B.areas.defense = [1, 2, 3, 4].map((v, i) => die(`bd${i}`, v, 'defense'));
      applyAction(g, { t: 'challengeStep' });
      applyAction(g, { t: 'challengeStep' });
      expect(g.pending).toBeNull(); // 自动，不弹面板
      return g.players.B.areas.defense[4].value;
    };
    // 同种子 → 中间两颗相同；有利取小、不利取大
    expect(entered('favor')).toBeLessThanOrEqual(entered('against'));
  });

  it('裁雨流：驱骰（无限 3/4）全部进攻击区并逐个攻击；前 3 次造成伤害的攻击骰移防御区', () => {
    const g = make('favor'); // 自动（免去顺序选择）
    skipInitialReroll(g);
    g.challenge!.resumeAt = 5;
    g.challenge!.driven = [die('d3a', 3), die('d3b', 3), die('d4a', 4), die('d4b', 4), die('d4c', 4)];
    g.players.A.areas.defense = []; // 挑战者不抵挡 → 全部造成伤害
    applyAction(g, { t: 'challengeStep' }); // 发动裁雨流 → 先把驱动骰移入攻击骰区（本步不攻击）
    expect(g.pendingAttack).toBeNull();
    applyAction(g, { t: 'challengeStep' }); // 移入之后 → 自动定顺序 + 第一次攻击
    expect(g.pendingAttack).toBeTruthy();
    let guard = 0;
    while (g.pendingAttack && guard++ < 20) applyAction(g, { t: 'block' }); // 逐段承受（不抵挡）
    // 5 颗攻击骰：前 3 颗（有利=由大到小 → 4/4/4）造成伤害 → 防御区；后 2 颗被移走
    expect(g.players.B.areas.defense.map((d) => d.value)).toEqual([4, 4, 4]);
    expect(g.players.B.areas.attack).toHaveLength(0);
  });

  it('裁雨流·上限：防御骰已达 5 → "造成伤害的攻击骰"不进展防御区、直接弃置（防御仍 5）', () => {
    const g = make('favor');
    skipInitialReroll(g);
    g.challenge!.resumeAt = 5;
    g.challenge!.driven = [die('d3a', 3), die('d3b', 3), die('d4a', 4), die('d4b', 4), die('d4c', 4)];
    g.players.A.areas.defense = []; // 挑战者不抵挡 → 全部造成伤害
    g.players.B.areas.defense = [1, 2, 3, 4].map((v, i) => die(`bd${i}`, v, 'defense')); // 已 4 → room 1
    g.players.B.areas.attack = [];
    applyAction(g, { t: 'challengeStep' }); // 移入攻击骰区
    applyAction(g, { t: 'challengeStep' }); // 自动定顺序 + 逐个攻击
    let guard = 0;
    while (g.pendingAttack && guard++ < 20) applyAction(g, { t: 'block' });
    expect(g.players.B.areas.defense).toHaveLength(5); // 旧 4 + 仅 1 颗进；其余"造成伤害的攻击骰"直接弃置
    expect(g.players.B.areas.attack).toHaveLength(0);
    expect(g.challenge!.deferred).toBeUndefined();
  });

  it('裁雨流·自选：攻击骰 >1 颗时弹面板定攻击顺序', () => {
    const g = make('manual');
    skipInitialReroll(g);
    g.challenge!.resumeAt = 5;
    g.challenge!.driven = [die('d3a', 3), die('d4a', 4)];
    g.players.A.areas.defense = [];
    applyAction(g, { t: 'challengeStep' }); // 先把驱动骰移入攻击骰区
    applyAction(g, { t: 'challengeStep' }); // 移入之后 → 弹顺序面板
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    expect(g.pending.options.map((o) => o.id)).toEqual(['asc', 'desc']);
  });
});
