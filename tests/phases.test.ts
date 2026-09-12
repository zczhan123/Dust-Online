import { describe, it, expect } from 'vitest';
import { setupGame } from '../src/core/engine/setup';
import { STANDARD_PHASES, nextPhase, shouldSkipPhase } from '../src/core/engine/turnFlow';

describe('turn flow', () => {
  it('phase order is fixed', () => {
    expect(STANDARD_PHASES).toEqual(['refill', 'reroll', 'dustRise', 'main', 'end']);
  });

  it('first round skips refill and reroll', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    expect(shouldSkipPhase(g, 'A', 'refill')).toBe(true);
    expect(shouldSkipPhase(g, 'A', 'reroll')).toBe(true);
    expect(shouldSkipPhase(g, 'A', 'dustRise')).toBe(false);
  });

  it('after both players finish first rounds, no skipping', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    g.firstRound.A = false;
    g.firstRound.B = false;
    expect(shouldSkipPhase(g, 'A', 'refill')).toBe(false);
  });

  it('nextPhase advances and ends at end', () => {
    expect(nextPhase('refill')).toBe('reroll');
    expect(nextPhase('reroll')).toBe('dustRise');
    expect(nextPhase('dustRise')).toBe('main');
    expect(nextPhase('main')).toBe('end');
    expect(nextPhase('end')).toBe('end');
  });
});

import { refillPhase } from '../src/core/engine/phases';
import { totalDice, effectiveSpeed, effectiveWill } from '../src/core/engine/derive';
import { SeededRng } from '../src/core/rng/rng';

describe('refill phase', () => {
  it('adds dice equal to speed', () => {
    const g = setupGame({ seed: 3, firstPlayer: 'A' });
    g.players.A.areas = { attack: [], defense: [], meditation: [] };
    refillPhase(g, 'A', new SeededRng(3));
    expect(totalDice(g.players.A)).toBe(effectiveSpeed(g.players.A));
  });

  it('never exceeds will cap', () => {
    const g = setupGame({ seed: 3, firstPlayer: 'A' });
    g.players.A.areas = { attack: [], defense: [], meditation: [] };
    const will = effectiveWill(g.players.A);
    const speed = effectiveSpeed(g.players.A);
    g.players.A.areas.meditation.push(
      ...Array.from({ length: will - 1 }, (_, i) => ({ id: `pre${i}`, value: 2, kind: 'meditation' as const })),
    );
    refillPhase(g, 'A', new SeededRng(3));
    expect(totalDice(g.players.A)).toBe(will);
    expect(speed).toBeGreaterThan(1);
  });
});
