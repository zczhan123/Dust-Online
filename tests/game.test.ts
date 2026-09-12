import { describe, it, expect } from 'vitest';
import { createGame, getLegalActions, applyAction, skipInitialReroll } from '../src/core/engine/game';
import { totalDice } from '../src/core/engine/derive';

describe('game actions and turn flow', () => {
  it('first turn skips refill and starts at dustRise', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    expect(g.phase).toBe('dustRise');
  });

  it('dust rise consumes a meditation die and activates', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    const before = g.players.A.areas.meditation.length;
    applyAction(g, { t: 'dustRise', artifactId: '001', side: 'left' });
    expect(g.players.A.artifacts.find((a) => a.id === '001')!.activeMarkerSide).toBe('left');
    expect(g.players.A.areas.meditation.length).toBe(before - 1);
    expect(g.dustRiseActed).toBe(true);
    expect(g.dustRiseNormalUsed).toBe(true);
  });

  it('advancing without a dust rise action increments dustfall', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' });
    expect(g.dustfall).toBe(1);
    expect(g.phase).toBe('main');
  });

  it('advancing after a dust rise action does not increment dustfall', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    applyAction(g, { t: 'dustRise', artifactId: '001', side: 'left' });
    applyAction(g, { t: 'advance' });
    expect(g.dustfall).toBe(0);
    expect(g.phase).toBe('main');
  });

  it('seal can be used after a normal dust rise in the same phase', () => {
    const g = createGame({ seed: 1, firstPlayer: 'B' });
    skipInitialReroll(g);
    g.players.B.hasDustSeal = true; // B 持有尘印
    applyAction(g, { t: 'dustRise', artifactId: '004', side: 'left' });
    applyAction(g, { t: 'dustRise', artifactId: '005', side: 'left', useSeal: true });
    expect(g.players.B.hasDustSeal).toBe(false);
    expect(g.players.B.artifacts.find((a) => a.id === '005')!.activeMarkerSide).toBe('left');
  });

  it('seal-only use prevents dustfall on advance', () => {
    const g = createGame({ seed: 1, firstPlayer: 'B' });
    skipInitialReroll(g);
    g.players.B.hasDustSeal = true; // B 持有尘印
    g.players.B.areas.meditation = [];
    applyAction(g, { t: 'dustRise', artifactId: '004', side: 'left', useSeal: true });
    applyAction(g, { t: 'advance' });
    expect(g.dustfall).toBe(0);
    expect(g.phase).toBe('main');
  });

  it('main phase attack produces a block decision for the opponent', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' });
    const atk = g.players.A.areas.attack[0];
    applyAction(g, { t: 'attack', dieId: atk.id });
    const actions = getLegalActions(g);
    expect(actions.some((a) => a.t === 'block' && a.dieId === undefined)).toBe(true);
    expect(actions.some((a) => a.t === 'block' && a.dieId !== undefined)).toBe(true);
  });

  it('attack outside main phase throws', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    const atk = g.players.A.areas.attack[0];
    expect(() => applyAction(g, { t: 'attack', dieId: atk.id })).toThrow();
  });

  it('ending main starts the opponent turn (still first round -> dustRise, no refill)', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' }); // -> main
    const bBefore = totalDice(g.players.B);
    applyAction(g, { t: 'advance' }); // end main -> B
    expect(g.activePlayer).toBe('B');
    expect(g.phase).toBe('dustRise');
    expect(totalDice(g.players.B)).toBe(bBefore);
  });

  it('second turn of A refills (no longer first round)', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' }); // A: dustRise -> main
    applyAction(g, { t: 'advance' }); // end A -> B
    applyAction(g, { t: 'advance' }); // B: dustRise -> main
    const aBefore = totalDice(g.players.A);
    applyAction(g, { t: 'advance' }); // end B -> A second turn (should refill)
    expect(g.activePlayer).toBe('A');
    expect(g.phase).toBe('reroll');
    expect(totalDice(g.players.A)).toBeGreaterThanOrEqual(aBefore);
  });

  it('reroll rejects foreign, duplicate, or too-many ids', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    g.activePlayer = 'A';
    g.phase = 'reroll';
    g.rerollUsed = 0;
    const die = g.players.A.areas.attack[0];
    expect(() => applyAction(g, { t: 'reroll', dieIds: ['nope'] })).toThrow();
    expect(() => applyAction(g, { t: 'reroll', dieIds: [die.id, die.id] })).toThrow();
    const all = [...g.players.A.areas.attack, ...g.players.A.areas.defense, ...g.players.A.areas.meditation].map((d) => d.id);
    expect(() => applyAction(g, { t: 'reroll', dieIds: all })).toThrow();
  });

  it('thisTurn buffs expire at end of turn', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    g.players.A.buffs.push({ attr: 'attackDamage', add: 5, duration: 'thisTurn' });
    g.players.A.buffs.push({ attr: 'will', add: 1, duration: 'permanent' });
    applyAction(g, { t: 'advance' }); // -> main
    applyAction(g, { t: 'advance' }); // end A turn
    expect(g.players.A.buffs.some((b) => b.duration === 'thisTurn')).toBe(false);
    expect(g.players.A.buffs.some((b) => b.duration === 'permanent')).toBe(true);
  });

  it('getLegalActions returns [] when game over', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    g.phase = 'gameOver';
    expect(getLegalActions(g)).toEqual([]);
  });
});
