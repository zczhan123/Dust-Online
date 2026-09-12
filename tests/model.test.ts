import { describe, it, expect } from 'vitest';
import type { Die, PlayerState, GameState, DiceKind } from '../src/core/model/types';

describe('model types', () => {
  it('can build a minimal player state', () => {
    const die: Die = { id: 'd1', value: 3, kind: 'attack' };
    const kinds: DiceKind[] = ['attack', 'defense', 'meditation'];
    expect(kinds).toContain(die.kind);
    expect(die.value).toBeGreaterThanOrEqual(1);
    expect(die.value).toBeLessThanOrEqual(6);
  });

  it('player and game state shapes compile', () => {
    const p: PlayerState = {
      id: 'A',
      areas: { attack: [], defense: [], meditation: [] },
      artifacts: [],
      life: 50,
      lifeMax: 50,
      markers: 0,
      hasDustSeal: false,
      buffs: [],
    };
    const g: GameState = {
      players: { A: p, B: { ...p, id: 'B' } },
      activePlayer: 'A',
      phase: 'setup',
      dustfall: 0,
      turnIndex: 0,
      firstRound: { A: true, B: true },
      rngState: 12345,
      log: [],
      pendingAttack: null,
      pending: null,
      unblockableThisTurn: false,
      caiyuliuUsed: 0,
      dustRiseNormalUsed: false,
      dustRiseActed: false,
      freeDustRise: 0,
      rerollUsed: 0,
      skillsUsedThisTurn: [],
      winner: null,
    };
    expect(g.players.A.life).toBe(50);
  });
});

import { createDie, placeDieByDistribution, areaOf } from '../src/core/model/dice';
import type { Distribution } from '../src/core/model/types';

describe('dice helpers', () => {
  const dist: Distribution = { defense: [1, 6], attack: [3, 4], meditation: [2, 5] };

  it('areaOf maps value to kind per distribution', () => {
    expect(areaOf(1, dist)).toBe('defense');
    expect(areaOf(6, dist)).toBe('defense');
    expect(areaOf(3, dist)).toBe('attack');
    expect(areaOf(2, dist)).toBe('meditation');
  });

  it('placeDieByDistribution puts die into correct area', () => {
    const areas: Record<DiceKind, Die[]> = { attack: [], defense: [], meditation: [] };
    placeDieByDistribution(areas, createDie('x1', 5), dist);
    expect(areas.meditation.map((d) => d.value)).toEqual([5]);
  });
});
