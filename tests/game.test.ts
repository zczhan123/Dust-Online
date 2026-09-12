import { describe, it, expect } from 'vitest';
import { createGame, getLegalActions, applyAction } from '../src/core/engine/game';
import { totalDice } from '../src/core/engine/derive';

describe('game actions and turn flow', () => {
  it('first turn skips refill and starts at dustRise', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    expect(g.phase).toBe('dustRise');
  });

  it('dust rise consumes a meditation die and activates', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    const before = g.players.A.areas.meditation.length;
    applyAction(g, { t: 'dustRise', artifactId: '001', side: 'left' });
    expect(g.players.A.artifacts.find((a) => a.id === '001')!.activeMarkerSide).toBe('left');
    expect(g.players.A.areas.meditation.length).toBe(before - 1);
    expect(g.dustRiseDecided).toBe(true);
  });

  it('passing dust rise increments dustfall', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    applyAction(g, { t: 'passDustRise' });
    expect(g.dustfall).toBe(1);
  });

  it('advances dustRise -> main', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    applyAction(g, { t: 'passDustRise' });
    applyAction(g, { t: 'advance' });
    expect(g.phase).toBe('main');
  });

  it('main phase attack produces a block decision for the opponent', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    applyAction(g, { t: 'passDustRise' });
    applyAction(g, { t: 'advance' });
    const atk = g.players.A.areas.attack[0];
    applyAction(g, { t: 'attack', dieId: atk.id });
    const actions = getLegalActions(g);
    expect(actions.some((a) => a.t === 'block' && a.dieId === undefined)).toBe(true);
    expect(actions.some((a) => a.t === 'block' && a.dieId !== undefined)).toBe(true);
  });

  it('ending main starts the opponent turn (still first round -> dustRise, no refill)', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    applyAction(g, { t: 'passDustRise' });
    applyAction(g, { t: 'advance' }); // -> main
    const bBefore = totalDice(g.players.B);
    applyAction(g, { t: 'advance' }); // end main -> B
    expect(g.activePlayer).toBe('B');
    expect(g.phase).toBe('dustRise');
    expect(totalDice(g.players.B)).toBe(bBefore);
  });

  it('second turn of A refills (no longer first round)', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    applyAction(g, { t: 'passDustRise' });
    applyAction(g, { t: 'advance' });
    applyAction(g, { t: 'advance' }); // -> B
    applyAction(g, { t: 'passDustRise' });
    applyAction(g, { t: 'advance' });
    const aBefore = totalDice(g.players.A);
    applyAction(g, { t: 'advance' }); // -> A second turn (should refill)
    expect(g.activePlayer).toBe('A');
    expect(g.phase).toBe('reroll');
    expect(totalDice(g.players.A)).toBeGreaterThanOrEqual(aBefore);
  });

  it('getLegalActions returns [] when game over', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    g.phase = 'gameOver';
    expect(getLegalActions(g)).toEqual([]);
  });
});
