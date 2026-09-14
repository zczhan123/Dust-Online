import { describe, it, expect } from 'vitest';
import {
  findDieOf,
  setDieValue,
  moveDice,
  heal,
  gainRandomDice,
} from '../src/core/engine/effects';
import { createGame, endMainPhase, applyAction, skipInitialReroll } from '../src/core/engine/game';
import { SeededRng } from '../src/core/rng/rng';
import type { Die } from '../src/core/model/types';

function freshGame() {
  return createGame({ seed: 1, firstPlayer: 'A' });
}

function clearAreas(g: ReturnType<typeof freshGame>, player: 'A' | 'B') {
  g.players[player].areas = { attack: [], defense: [], meditation: [] };
}

describe('effects primitives', () => {
  describe('findDieOf', () => {
    it('returns the area and die reference for an existing die', () => {
      const g = freshGame();
      const die: Die = { id: 'x1', value: 3, kind: 'attack' };
      g.players.A.areas.attack.push(die);
      const found = findDieOf(g, 'A', 'x1');
      expect(found).not.toBeNull();
      expect(found!.kind).toBe('attack');
      expect(found!.die).toBe(die);
    });

    it('returns null for an unknown die', () => {
      const g = freshGame();
      expect(findDieOf(g, 'A', 'nope')).toBeNull();
    });
  });

  describe('setDieValue', () => {
    it('changes the value in place (area preserved) and returns the old value', () => {
      const g = freshGame();
      const die: Die = { id: 's1', value: 2, kind: 'defense' };
      clearAreas(g, 'A');
      g.players.A.areas.defense.push(die);
      const old = setDieValue(g, 'A', 's1', 5);
      expect(old).toBe(2);
      expect(g.players.A.areas.defense[0].value).toBe(5);
      expect(g.players.A.areas.defense[0].kind).toBe('defense');
      expect(g.players.A.areas.defense[0]).toBe(die);
    });

    it('throws on an unknown die', () => {
      const g = freshGame();
      expect(() => setDieValue(g, 'A', 'missing', 4)).toThrow();
    });

    it('throws on an out-of-range value', () => {
      const g = freshGame();
      clearAreas(g, 'A');
      g.players.A.areas.attack.push({ id: 's2', value: 3, kind: 'attack' });
      expect(() => setDieValue(g, 'A', 's2', 0)).toThrow();
      expect(() => setDieValue(g, 'A', 's2', 7)).toThrow();
      expect(() => setDieValue(g, 'A', 's2', 2.5)).toThrow();
      expect(g.players.A.areas.attack.find((d) => d.id === 's2')!.value).toBe(3);
    });
  });

  describe('moveDice', () => {
    it('moves dice to the target area, preserving value and removing from the old area', () => {
      const g = freshGame();
      clearAreas(g, 'A');
      g.players.A.areas.attack = [
        { id: 'm1', value: 4, kind: 'attack' },
        { id: 'm2', value: 6, kind: 'attack' },
      ];
      g.players.A.areas.meditation = [{ id: 'm3', value: 1, kind: 'meditation' }];
      moveDice(g, 'A', ['m1', 'm2', 'm3'], 'defense');
      expect(g.players.A.areas.attack).toHaveLength(0);
      expect(g.players.A.areas.meditation).toHaveLength(0);
      expect(g.players.A.areas.defense.map((d) => d.id).sort()).toEqual(['m1', 'm2', 'm3']);
      expect(g.players.A.areas.defense.every((d) => d.kind === 'defense')).toBe(true);
      expect(g.players.A.areas.defense.find((d) => d.id === 'm1')!.value).toBe(4);
      expect(g.players.A.areas.defense.find((d) => d.id === 'm3')!.value).toBe(1);
    });

    it('throws on an unknown die', () => {
      const g = freshGame();
      expect(() => moveDice(g, 'A', ['missing'], 'attack')).toThrow();
    });
  });

  describe('heal', () => {
    it('clamps at lifeMax and returns the actual healed amount', () => {
      const g = freshGame();
      g.players.A.lifeMax = 50;
      g.players.A.life = 48;
      const healed = heal(g, 'A', 5);
      expect(g.players.A.life).toBe(50);
      expect(healed).toBe(2);
    });

    it('returns the full amount when below the cap', () => {
      const g = freshGame();
      g.players.A.lifeMax = 50;
      g.players.A.life = 30;
      expect(heal(g, 'A', 7)).toBe(7);
      expect(g.players.A.life).toBe(37);
    });
  });

  describe('gainRandomDice', () => {
    it('adds N dice to the target area with random values', () => {
      const g = freshGame();
      const rng = new SeededRng(42);
      g.players.A.areas.meditation = [];
      const gained = gainRandomDice(g, 'A', 'meditation', 3, rng);
      expect(gained).toHaveLength(3);
      expect(g.players.A.areas.meditation).toHaveLength(3);
      for (const d of gained) {
        expect(d.kind).toBe('meditation');
        expect(d.value).toBeGreaterThanOrEqual(1);
        expect(d.value).toBeLessThanOrEqual(6);
        expect(Number.isInteger(d.value)).toBe(true);
      }
      expect(g.players.A.areas.meditation.map((d) => d.id)).toEqual(gained.map((d) => d.id));
      expect(new Set(gained.map((d) => d.id)).size).toBe(3);
    });

    it('adds no dice when count is 0', () => {
      const g = freshGame();
      const before = g.players.A.areas.attack.length;
      const gained = gainRandomDice(g, 'A', 'attack', 0, new SeededRng(7));
      expect(gained).toHaveLength(0);
      expect(g.players.A.areas.attack).toHaveLength(before);
    });
  });

  describe('endMainPhase', () => {
    it('from main: ends the turn and switches the active player', () => {
      const g = freshGame();
      skipInitialReroll(g);
      applyAction(g, { t: 'advance' });
      expect(g.phase).toBe('main');
      expect(g.activePlayer).toBe('A');
      endMainPhase(g);
      expect(g.activePlayer).toBe('B');
      expect(g.phase).not.toBe('main');
    });

    it('from a non-main phase: no-op', () => {
      const g = freshGame();
      skipInitialReroll(g);
      expect(g.phase).toBe('dustRise');
      const phaseBefore = g.phase;
      const activeBefore = g.activePlayer;
      endMainPhase(g);
      expect(g.phase).toBe(phaseBefore);
      expect(g.activePlayer).toBe(activeBefore);
    });
  });
});
