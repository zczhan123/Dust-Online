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

  it('龙腾万丈：得 4 能力骰 → 最大/最小各 1 进攻击区、其余 2 进防御区', () => {
    const g = make('manual');
    skipInitialReroll(g);
    g.challenge!.resumeAt = 3;
    g.challenge!.driven = [die('a2', 2), die('a2b', 2), die('a5', 5)];
    g.players.A.areas.attack = [];
    g.players.B.areas.attack = [];
    g.players.B.areas.defense = [];
    applyAction(g, { t: 'challengeStep' });
    const atk = g.players.B.areas.attack.map((d) => d.value).sort((a, b) => a - b);
    const def = g.players.B.areas.defense.map((d) => d.value).sort((a, b) => a - b);
    const all = [...atk, ...def].sort((a, b) => a - b);
    expect(all).toHaveLength(4);
    expect(atk).toEqual([all[0], all[3]]); // 最小 + 最大
    expect(def).toEqual([all[1], all[2]]); // 中间 2 个
  });
});
