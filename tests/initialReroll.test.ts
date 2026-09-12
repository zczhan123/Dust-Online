import { describe, it, expect } from 'vitest';
import { createGame, applyAction } from '../src/core/engine/game';
import { totalDice } from '../src/core/engine/derive';

describe('initial reroll (setup step 3)', () => {
  it('starts in initialReroll with the first player active', () => {
    const g = createGame({ seed: 1, firstPlayer: 'B' });
    expect(g.phase).toBe('initialReroll');
    expect(g.activePlayer).toBe('B');
  });

  it('first player may reroll ANY number (no speed limit), then the second player takes their step', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    const all = [...g.players.A.areas.attack, ...g.players.A.areas.defense, ...g.players.A.areas.meditation].map((d) => d.id);
    expect(all.length).toBeGreaterThan(4); // > speed(4), proving no cap
    applyAction(g, { t: 'reroll', dieIds: all });
    expect(g.activePlayer).toBe('B');
    expect(g.phase).toBe('initialReroll');
  });

  it('after both players, the first player begins their first turn (dustRise)', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    applyAction(g, { t: 'advance' }); // A skip
    applyAction(g, { t: 'advance' }); // B skip
    expect(g.activePlayer).toBe('A');
    expect(g.phase).toBe('dustRise');
  });

  it('re-places rerolled dice by distribution', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    const ids = g.players.A.areas.attack.map((d) => d.id);
    applyAction(g, { t: 'reroll', dieIds: ids });
    const dist = g.players.A.artifacts.find((a) => a.column === 2)!.distribution!;
    for (const d of g.players.A.areas.attack) expect(dist.attack).toContain(d.value);
    for (const d of g.players.A.areas.defense) expect(dist.defense).toContain(d.value);
    for (const d of g.players.A.areas.meditation) expect(dist.meditation).toContain(d.value);
    expect(totalDice(g.players.A)).toBe(7);
  });

  it('rejects rerolling a die you do not own', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    expect(() => applyAction(g, { t: 'reroll', dieIds: ['nope'] })).toThrow();
  });
});
