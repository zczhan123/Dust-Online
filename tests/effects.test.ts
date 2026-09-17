import { describe, it, expect } from 'vitest';
import {
  findDieOf,
  setDieValue,
  moveDice,
  heal,
  gainRandomDice,
  paySlots,
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

  describe('paySlots', () => {
    const setup = () => {
      const g = freshGame();
      clearAreas(g, 'A');
      return g;
    };

    it('pays an all-real slot (type must match) and returns the effective die', () => {
      const g = setup();
      g.players.A.areas.meditation = [
        { id: 'm1', value: 4, kind: 'meditation' },
        { id: 'm2', value: 2, kind: 'meditation' },
      ];
      const eff = paySlots(g, 'A', [{ kind: 'meditation' }], [{ dieIds: ['m1'] }]);
      expect(eff).toEqual([{ kind: 'meditation', value: 4, source: 'real', realIds: ['m1'] }]);
      expect(g.players.A.areas.meditation.map((d) => d.id)).toEqual(['m2']);
    });

    it('rejects a real die whose kind does not match the slot', () => {
      const g = setup();
      g.players.A.areas.attack = [{ id: 'a1', value: 3, kind: 'attack' }];
      expect(() => paySlots(g, 'A', [{ kind: 'meditation' }], [{ dieIds: ['a1'] }])).toThrow();
    });

    it('converts 2 any dice into a value-5 effective die and removes both', () => {
      const g = setup();
      g.players.A.areas.attack = [{ id: 'a1', value: 2, kind: 'attack' }];
      g.players.A.areas.defense = [{ id: 'd1', value: 6, kind: 'defense' }];
      const eff = paySlots(g, 'A', [{ kind: 'meditation' }], [{ dieIds: ['a1', 'd1'] }]);
      expect(eff).toEqual([{ kind: 'meditation', value: 5, source: 'converted', realIds: ['a1', 'd1'] }]);
      expect(g.players.A.areas.attack).toHaveLength(0);
      expect(g.players.A.areas.defense).toHaveLength(0);
    });

    it('logs a 「真实之剑」置换 line for a single converted slot', () => {
      const g = setup();
      g.players.A.areas.attack = [{ id: 'a1', value: 2, kind: 'attack' }];
      g.players.A.areas.defense = [{ id: 'd1', value: 6, kind: 'defense' }];
      paySlots(g, 'A', [{ kind: 'attack' }], [{ dieIds: ['a1', 'd1'] }]);
      const last = g.log[g.log.length - 1].text;
      expect(last).toContain('使用「真实之剑」置换');
      expect(last).toContain('消耗 2 颗能力骰（2/6）');
      expect(last).toContain('视为 1 颗攻击骰（点数按 5）');
    });

    it('logs a multi-slot 置换 summary line', () => {
      const g = setup();
      g.players.A.areas.attack = [
        { id: 'a1', value: 1, kind: 'attack' },
        { id: 'a2', value: 2, kind: 'attack' },
      ];
      g.players.A.areas.meditation = [
        { id: 'm1', value: 3, kind: 'meditation' },
        { id: 'm2', value: 4, kind: 'meditation' },
      ];
      paySlots(
        g,
        'A',
        [{ kind: 'attack' }, { kind: 'attack' }],
        [{ dieIds: ['a1', 'm1'] }, { dieIds: ['a2', 'm2'] }],
      );
      const last = g.log[g.log.length - 1].text;
      expect(last).toContain('置换 2 格');
      expect(last).toContain('另耗 4 颗任意能力骰：1/3/2/4');
      expect(last).toContain('视为 2 颗攻击骰（点数按 5）');
    });

    it('supports mixed real + converted slots', () => {
      const g = setup();
      g.players.A.areas.attack = [
        { id: 'a1', value: 2, kind: 'attack' },
        { id: 'a2', value: 3, kind: 'attack' },
      ];
      g.players.A.areas.meditation = [{ id: 'm1', value: 4, kind: 'meditation' }];
      const eff = paySlots(
        g,
        'A',
        [{ kind: 'meditation' }, { kind: 'meditation' }],
        [{ dieIds: ['m1'] }, { dieIds: ['a1', 'a2'] }],
      );
      expect(eff).toEqual([
        { kind: 'meditation', value: 4, source: 'real', realIds: ['m1'] },
        { kind: 'meditation', value: 5, source: 'converted', realIds: ['a1', 'a2'] },
      ]);
      expect(g.players.A.areas.meditation).toHaveLength(0);
      expect(g.players.A.areas.attack).toHaveLength(0);
    });

    it('removes up to 2N real dice when every slot is converted', () => {
      const g = setup();
      g.players.A.areas.attack = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((id) => ({
        id,
        value: 1,
        kind: 'attack' as const,
      }));
      const eff = paySlots(
        g,
        'A',
        Array.from({ length: 3 }, () => ({ kind: 'defense' as const })),
        [{ dieIds: ['a1', 'a2'] }, { dieIds: ['a3', 'a4'] }, { dieIds: ['a5', 'a6'] }],
      );
      expect(eff).toHaveLength(3);
      expect(eff.every((e) => e.value === 5 && e.source === 'converted')).toBe(true);
      expect(g.players.A.areas.attack).toHaveLength(0);
    });

    it('rejects a duplicate die id across slots', () => {
      const g = setup();
      g.players.A.areas.meditation = [{ id: 'm1', value: 4, kind: 'meditation' }];
      expect(() =>
        paySlots(g, 'A', [{ kind: 'meditation' }, { kind: 'meditation' }], [{ dieIds: ['m1'] }, { dieIds: ['m1'] }]),
      ).toThrow();
    });

    it('rejects the wrong number of slot fills', () => {
      const g = setup();
      g.players.A.areas.meditation = [{ id: 'm1', value: 4, kind: 'meditation' }];
      expect(() => paySlots(g, 'A', [{ kind: 'meditation' }], [])).toThrow();
      expect(() =>
        paySlots(g, 'A', [{ kind: 'meditation' }], [{ dieIds: ['m1'] }, { dieIds: ['m1'] }]),
      ).toThrow();
    });

    it('rejects a slot fill with 3 dice', () => {
      const g = setup();
      g.players.A.areas.attack = ['a1', 'a2', 'a3'].map((id) => ({ id, value: 1, kind: 'attack' as const }));
      expect(() => paySlots(g, 'A', [{ kind: 'attack' }], [{ dieIds: ['a1', 'a2', 'a3'] }])).toThrow();
    });

    it('rejects a foreign / unknown die', () => {
      const g = setup();
      expect(() => paySlots(g, 'A', [{ kind: 'meditation' }], [{ dieIds: ['nope'] }])).toThrow();
    });

    it('reports the slot count (not the real-die count) to reportConsumed', () => {
      const g = setup();
      g.players.A.areas.attack = ['a1', 'a2', 'a3'].map((id) => ({ id, value: 1, kind: 'attack' as const }));
      let reported = -1;
      paySlots(
        g,
        'A',
        [{ kind: 'attack' }, { kind: 'attack' }],
        [{ dieIds: ['a1'] }, { dieIds: ['a2', 'a3'] }],
        (n) => {
          reported = n;
        },
      );
      expect(reported).toBe(2);
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
