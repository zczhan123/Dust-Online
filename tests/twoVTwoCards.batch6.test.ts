import { describe, it, expect } from 'vitest';
import { applyAction, createTwoVTwoGame } from '../src/core/engine/game';
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

const ctx = (g: ReturnType<typeof createTwoVTwoGame>) => ({
  g,
  player: 'A1' as const,
  artifact: g.players.A1.artifacts[0],
  params: {},
  rng: new SeededRng(1),
  endMainPhase: () => {},
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

describe('2v2 批次 6 · 任意玩家与范围', () => {
  it('A07 历王之血之印：只弃所选敌人的防御骰', () => {
    const cfg = setup();
    cfg.seats.A1 = ['001', '002', 'A07'];
    cfg.dice = {
      A1: { attack: [], defense: [], meditation: [] },
      B1: { attack: [], defense: [1], meditation: [] },
      B2: { attack: [], defense: [2, 3], meditation: [] },
    };
    const g = createTwoVTwoGame(cfg);
    const b1 = g.players.B1.areas.defense.length;
    const b2Ids = g.players.B2.areas.defense.map((d) => d.id);

    SKILL_HANDLERS['wansha.alt.ultimate'].run({
      ...ctx(g),
      params: { opponentDefenseDieIds: b2Ids },
      target: 'B2',
    });

    expect(g.players.B1.areas.defense.length).toBe(b1);
    expect(g.players.B2.areas.defense).toEqual([]);
  });

  it('C01 突破：只弃所选敌人的防御骰', () => {
    const cfg = setup();
    cfg.seats.A1 = ['001', '002', 'C01'];
    cfg.dice = {
      A1: { attack: [], defense: [], meditation: [3] },
      B1: { attack: [], defense: [1], meditation: [] },
      B2: { attack: [], defense: [2], meditation: [] },
    };
    const g = createTwoVTwoGame(cfg);
    const med = g.players.A1.areas.meditation[0];
    const b1 = g.players.B1.areas.defense.length;
    const b2Die = g.players.B2.areas.defense[0];

    SKILL_HANDLERS['c01.breakthrough'].run({
      ...ctx(g),
      params: {
        costSlots: [{ dieIds: [med.id] }],
        opponentDefenseDieIds: [b2Die.id],
      },
      target: 'B2',
    });

    expect(g.players.B1.areas.defense.length).toBe(b1);
    expect(g.players.B2.areas.defense.some((d) => d.id === b2Die.id)).toBe(false);
  });

  it('024 凶弹业舞充能：可选自己或敌人，不能选队友', () => {
    const cfg = setup();
    cfg.seats.A1 = ['001', '002', '024'];
    cfg.dice = {
      A2: { attack: [2], defense: [], meditation: [] },
      B2: { attack: [3], defense: [], meditation: [] },
    };
    const g = createTwoVTwoGame(cfg);
    const b2Die = g.players.B2.areas.attack[0];
    SKILL_HANDLERS['kuangwu.charge'].run({
      ...ctx(g),
      params: { dieId: b2Die.id, toKind: 'defense' },
      target: 'B2',
    });
    expect(g.players.B2.areas.defense.some((d) => d.id === b2Die.id)).toBe(true);

    const bad = createTwoVTwoGame(cfg);
    expect(() =>
      SKILL_HANDLERS['kuangwu.charge'].run({
        ...ctx(bad),
        params: { dieId: bad.players.A2.areas.attack[0].id, toKind: 'defense' },
        target: 'A2',
      }),
    ).toThrow();
  });

  it('024 必杀 / 026 威压：2v2 目标不包含队友', () => {
    const g = createTwoVTwoGame(setup());
    const ult = SKILL_SELECTION['kuangwu.ultimate'].steps(args(g, 'B2'));
    expect(ult[0]).toMatchObject({ kind: 'seat', candidates: ['B1', 'B2'] });

    const weiya = SKILL_SELECTION['@weiyaPick'].steps(args(g, 'B2'));
    expect(weiya[0]).toMatchObject({ kind: 'seat', candidates: ['A1', 'B1', 'B2'] });
  });

  it('026 威压：改用所选敌人的 1 颗骰', () => {
    const cfg = setup();
    cfg.seats.A1 = ['001', '002', '026'];
    cfg.dice = {
      B1: { attack: [3], defense: [], meditation: [] },
      B2: { attack: [3], defense: [], meditation: [] },
    };
    const g = createTwoVTwoGame(cfg);
    const b1 = g.players.B1.areas.attack[0];
    const b2 = g.players.B2.areas.attack[0];
    g.pending = { kind: 'weiyaPick', player: 'A1', value: 4, reason: 'skill' };

    applyAction(g, { t: 'weiyaPick', owner: 'opp', dieId: b2.id, target: 'B2' });
    expect(g.players.B2.areas.attack.find((d) => d.id === b2.id)?.value).toBe(4);
    expect(g.players.B1.areas.attack.find((d) => d.id === b1.id)?.value).toBe(3);
  });

  it('A07 / C01 / 024 / 026 的 2v2 选择器返回目标座位步', () => {
    const g = createTwoVTwoGame(setup());
    for (const key of ['wansha.alt.ultimate', 'c01.breakthrough', 'kuangwu.charge', 'kuangwu.ultimate', '@weiyaPick']) {
      const steps = SKILL_SELECTION[key].steps(args(g, 'B2'));
      expect(steps[0]).toMatchObject({ kind: 'seat' });
      const seat = steps[0] as Extract<SelectStep, { kind: 'seat' }>;
      expect(seat.candidates).toContain('B2');
    }
  });
});
