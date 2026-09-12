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
    };
    expect(g.players.A.life).toBe(50);
  });
});
