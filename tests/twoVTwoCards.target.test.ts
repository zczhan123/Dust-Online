import { describe, it, expect } from 'vitest';
import { applyAction, createGame, createTwoVTwoGame } from '../src/core/engine/game';
import { SKILL_HANDLERS } from '../src/core/engine/skills';
import { SeededRng } from '../src/core/rng/rng';
import { SKILL_SELECTION, type SelectStep } from '../src/ui/skillSelection';
import type { PlayerId } from '../src/core/model/types';
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

const args = (state: ReturnType<typeof createTwoVTwoGame>, target?: PlayerId) => ({
  state,
  player: 'A1' as const,
  chosenDice: [],
  options: [],
  numbers: [],
  slots: [],
  target,
});

describe('2v2 批次 2 · 目标选择', () => {
  it('003 斩神切：2v2 先选敌人座位，之后骰子归属该座位', () => {
    const g = createTwoVTwoGame(setup());
    const steps = SKILL_SELECTION['mingjing.ultimate'].steps(args(g, 'B2'));
    expect(steps[0]).toMatchObject({ kind: 'seat', candidates: ['B1', 'B2'] });
    const dice = steps.filter((s): s is Extract<SelectStep, { kind: 'dice' }> => s.kind === 'dice');
    expect(dice.every((s) => s.ownerSeat === 'B2')).toBe(true);
    expect(SKILL_SELECTION['mingjing.ultimate'].buildParams(args(g, 'B2'))).toMatchObject({ target: 'B2' });
  });

  it('007 战争横扫 / 震荡斩击：目标座位写入后续骰步', () => {
    const g = createTwoVTwoGame(setup());
    const sweep = SKILL_SELECTION['zhuzai.sweep'].steps(args(g, 'B1'));
    expect(sweep[0]).toMatchObject({ kind: 'seat', candidates: ['B1', 'B2'] });
    const sweepDice = sweep.filter((s): s is Extract<SelectStep, { kind: 'dice' }> => s.kind === 'dice');
    expect(sweepDice.filter((s) => s.owner === 'opponent').every((s) => s.ownerSeat === 'B1')).toBe(true);

    const smash = SKILL_SELECTION['zhuzai.smash'].steps({
      ...args(g, 'B2'),
      options: ['B2', 'defense'],
    });
    expect(smash[0]).toMatchObject({ kind: 'seat', candidates: ['B1', 'B2'] });
    const smashOpp = smash.filter(
      (s): s is Extract<SelectStep, { kind: 'dice' }> => s.kind === 'dice' && s.owner === 'opponent',
    );
    expect(smashOpp[0]?.ownerSeat).toBe('B2');
  });

  it('003 斩神切：实际弃置与真伤落在所选敌人身上', () => {
    const cfg = setup();
    cfg.seats.A1 = ['001', '002', '003'];
    cfg.dice = { A1: { attack: [1], defense: [], meditation: [] } };
    const g = createTwoVTwoGame(cfg);
    const b1Attack = g.players.B1.areas.attack.length;
    const b2Attack = g.players.B2.areas.attack.length;
    const artifact = g.players.A1.artifacts.find((a) => a.id === '003')!;
    const beforeLife = g.teams!.B!.life;

    SKILL_HANDLERS['mingjing.ultimate'].run({
      g,
      player: 'A1',
      artifact,
      rng: new SeededRng(1),
      params: {},
      target: 'B2',
      endMainPhase: () => {},
    });

    expect(g.players.B1.areas.attack.length).toBe(b1Attack);
    expect(g.players.B2.areas.attack.length).toBe(b2Attack - 1);
    expect(g.teams?.B?.life).toBe(beforeLife - 2);
  });

  it('010 杀意：2v2 显式选敌，非法队友目标被拒', () => {
    const g = createTwoVTwoGame(setup());
    g.pending = { kind: 'shenhongKill', player: 'A1' };
    applyAction(g, { t: 'shenhongKill', accept: true, target: 'B2' });
    expect(g.teams?.B?.life).toBe(87);
    expect(g.teams?.A?.life).toBe(100);

    const bad = createTwoVTwoGame(setup());
    bad.pending = { kind: 'shenhongKill', player: 'A1' };
    expect(() => applyAction(bad, { t: 'shenhongKill', accept: true, target: 'A2' })).toThrow();
    expect(bad.pending?.kind).toBe('shenhongKill');
  });

  it('011 灵能脉冲：2v2 显式选敌并写入团队生命', () => {
    const g = createTwoVTwoGame(setup());
    g.pending = { kind: 'dunwuPulse', player: 'A1', amount: 4 };
    applyAction(g, { t: 'dunwuPulse', accept: true, target: 'B1' });
    expect(g.teams?.B?.life).toBe(86);
    expect(g.dunwuPulseUsed.A1).toBe(true);
  });

  it('1v1 的同一批选择器不返回 seat 步', () => {
    const g = createGame({ seed: 7, firstPlayer: 'A' });
    for (const key of ['mingjing.ultimate', 'zhuzai.sweep', 'zhuzai.smash']) {
      const steps = SKILL_SELECTION[key].steps({
        state: g,
        player: 'A',
        chosenDice: [],
        options: [],
        numbers: [],
        slots: [],
      });
      expect(steps.some((s) => s.kind === 'seat')).toBe(false);
    }
  });
});
