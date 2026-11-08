import { describe, it, expect } from 'vitest';
import { applyAction, canTreatAsAttack, createTwoVTwoGame } from '../src/core/engine/game';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';

const setup = (): TwoVTwoSetup => ({
  seats: {
    A1: ['001', '002', '003'],
    A2: ['004', '005', '006'],
    B1: ['007', '008', '009'],
    B2: ['010', '011', '012'],
  },
  firstTeam: 'A',
  seed: 7,
});

describe('2v2 批次 7 · 来源与 025', () => {
  it('025 奇袭：任一敌人没有该点数即可视为攻击骰', () => {
    const cfg = setup();
    cfg.seats.A1 = ['025', '002', '003'];
    cfg.dice = {
      A1: { attack: [], defense: [4, 5], meditation: [] },
      B1: { attack: [4, 5], defense: [], meditation: [] },
      B2: { attack: [5], defense: [], meditation: [] },
    };
    const g = createTwoVTwoGame(cfg);
    g.players.A1.artifacts.find((a) => a.id === '025')!.activeMarkerSide = 'left';
    const d4 = g.players.A1.areas.defense.find((d) => d.value === 4)!;
    const d5 = g.players.A1.areas.defense.find((d) => d.value === 5)!;
    expect(canTreatAsAttack(g, 'A1', d4.id)).toBe(true); // B2 没有 4
    expect(canTreatAsAttack(g, 'A1', d5.id)).toBe(false); // B1/B2 都有 5
  });

  it('025 横贯：待决策锁定本次攻击的防守者', () => {
    const cfg = setup();
    cfg.dice = {
      B1: { attack: [3], defense: [], meditation: [] },
      B2: { attack: [3], defense: [], meditation: [] },
    };
    const g = createTwoVTwoGame(cfg);
    const b1 = g.players.B1.areas.attack[0];
    const b2 = g.players.B2.areas.attack[0];
    g.pending = { kind: 'hengguan', player: 'A1', value: 5, target: 'B2' };

    applyAction(g, { t: 'hengguan', dieId: b2.id });
    expect(g.players.B2.areas.attack.some((d) => d.id === b2.id)).toBe(false);
    expect(g.players.B1.areas.attack.some((d) => d.id === b1.id)).toBe(true);
  });

  it('004 锋芒：被抵挡后追伤记录本次防守者', () => {
    const cfg = setup();
    cfg.seats.A1 = ['001', '002', '004'];
    cfg.dice = {
      A1: { attack: [3], defense: [], meditation: [] },
      B2: { attack: [], defense: [2], meditation: [] },
    };
    const g = createTwoVTwoGame(cfg);
    const a = g.players.A1.artifacts.find((a) => a.id === '004')!;
    a.activeMarkerSide = 'right';
    const atk = g.players.A1.areas.attack[0];
    const def = g.players.B2.areas.defense[0];

    applyAction(g, {
      t: 'attack',
      costSlots: [{ dieIds: [atk.id] }],
      target: 'B2',
    });
    applyAction(g, {
      t: 'block',
      by: 'B2',
      costSlots: [{ dieIds: [def.id] }],
    });

    expect(g.pending).toMatchObject({ kind: 'fengmang', player: 'A1', defenderId: 'B2' });
  });
});
