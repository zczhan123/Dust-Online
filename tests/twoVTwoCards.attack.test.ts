import { describe, it, expect } from 'vitest';
import { applyAction, createTwoVTwoGame } from '../src/core/engine/game';
import { pumpAttackQueue, resolveBlock } from '../src/core/engine/combat';
import { SKILL_HANDLERS } from '../src/core/engine/skills';
import { SeededRng } from '../src/core/rng/rng';
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

describe('2v2 批次 1 · 攻击类神器', () => {
  it('005 影袭：显式目标写入本次攻击的防守座位', () => {
    const cfg = setup();
    cfg.seats.A1 = ['001', '005', '003'];
    cfg.dice = { A1: { attack: [3], defense: [], meditation: [] } };
    const g = createTwoVTwoGame(cfg);
    g.players.A1.artifacts.find((a) => a.id === '005')!.activeMarkerSide = 'left';
    const die = g.players.A1.areas.attack[0];

    applyAction(g, {
      t: 'skill',
      artifactId: '005',
      side: 'left',
      params: { dieId: die.id, x: 2 },
      target: 'B2',
    });

    expect(g.pendingAttack?.defender).toBe('B2');
    expect(g.pendingAttack?.attacker).toBe('A1');
  });

  it('005 影袭：2v2 不能把队友当攻击目标', () => {
    const cfg = setup();
    cfg.seats.A1 = ['001', '005', '003'];
    cfg.dice = { A1: { attack: [6], defense: [], meditation: [] } };
    const g = createTwoVTwoGame(cfg);
    g.players.A1.artifacts.find((a) => a.id === '005')!.activeMarkerSide = 'left';
    const die = g.players.A1.areas.attack[0];

    expect(() =>
      applyAction(g, {
        t: 'skill',
        artifactId: '005',
        side: 'left',
        params: { dieId: die.id, x: 2 },
        target: 'A2',
      }),
    ).toThrow();
    expect(g.pendingAttack).toBeNull();
  });

  it('013 电刑：每一段攻击携带自己的防守座位', () => {
    const cfg = setup();
    cfg.seats.A1 = ['013', '002', '003'];
    cfg.dice = { A1: { attack: [], defense: [], meditation: [2, 5] } };
    const g = createTwoVTwoGame(cfg);
    const ids = g.players.A1.areas.meditation.map((d) => d.id);
    g.pending = { kind: 'dianxing', player: 'A1', values: [1, 2, 3] };

    applyAction(g, { t: 'dianxing', dieIds: ids, targets: ['B1', 'B2', 'B1'] });
    expect(g.pendingAttack?.defender).toBe('B1');
    expect(g.attackQueue?.defenders).toEqual(['B2', 'B1']);

    resolveBlock(g, undefined, 'B1');
    pumpAttackQueue(g);
    expect(g.pendingAttack?.defender).toBe('B2');
  });

  it('A08 将至的电刑：使用 1/3/6 点，目标仍逐段生效', () => {
    const cfg = setup();
    cfg.seats.A1 = ['013', '002', 'A08'];
    cfg.dice = { A1: { attack: [], defense: [], meditation: [2, 5] } };
    const g = createTwoVTwoGame(cfg);
    const ids = g.players.A1.areas.meditation.map((d) => d.id);
    g.pending = { kind: 'dianxing', player: 'A1', values: [1, 3, 6] };

    applyAction(g, { t: 'dianxing', dieIds: ids, targets: ['B2', 'B1', 'B2'] });
    expect(g.pendingAttack?.defender).toBe('B2');
    expect(g.attackQueue?.defenders).toEqual(['B1', 'B2']);
  });

  it('A01 不败之王：第一段选敌，后两段锁定持有者', () => {
    const cfg = setup();
    cfg.seats.A1 = ['001', '002', 'A01'];
    const g = createTwoVTwoGame(cfg);
    const artifact = g.players.A1.artifacts.find((a) => a.id === 'A01')!;

    SKILL_HANDLERS['guwang.alt.charge'].run({
      g,
      player: 'A1',
      artifact,
      rng: new SeededRng(1),
      params: {},
      target: 'B1',
      endMainPhase: () => {},
    });

    expect(g.pendingAttack?.defender).toBe('B1');
    expect(g.virtualQueue?.map((q) => q.defender)).toEqual(['A1', 'A1']);
  });
});
