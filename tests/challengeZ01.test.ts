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
});
