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
