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

const ctx = (g: ReturnType<typeof createTwoVTwoGame>) => ({
  g,
  player: 'A1' as const,
  artifact: g.players.A1.artifacts[0],
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

describe('2v2 批次 3 · 目标选择', () => {
  it('031 清算：2v2 先选敌人，骰子归属所选座位', () => {
    const cfg = setup();
    cfg.seats.A1 = ['031', '002', '003'];
    const g = createTwoVTwoGame(cfg);
    const steps = SKILL_SELECTION['ezhao.qingsuan'].steps(args(g, 'B2'));
    expect(steps[0]).toMatchObject({ kind: 'seat', candidates: ['B1', 'B2'] });
    const dice = steps.filter((s): s is Extract<SelectStep, { kind: 'dice' }> => s.kind === 'dice');
    expect(dice.every((s) => s.ownerSeat === 'B2')).toBe(true);
  });

  it('031 清算：弃骰与真伤目标按所选敌人结算', () => {
    const cfg = setup();
    cfg.seats.A1 = ['031', '002', '003'];
    const g = createTwoVTwoGame(cfg);
    const artifact = g.players.A1.artifacts.find((a) => a.id === '031')!;
    artifact.count = 2;
    const b1Attack = g.players.B1.areas.attack.length;
    const b2Ids = [
      g.players.B2.areas.attack[0]?.id,
      g.players.B2.areas.defense[0]?.id,
    ].filter((id): id is string => id !== undefined);
    const b2Before = ['attack', 'defense', 'meditation'].reduce(
      (n, k) => n + g.players.B2.areas[k as 'attack' | 'defense' | 'meditation'].length,
      0,
    );

    SKILL_HANDLERS['ezhao.qingsuan'].run({
      ...ctx(g),
      artifact,
      params: { dieIds: b2Ids },
      target: 'B2',
    });

    const b2After = ['attack', 'defense', 'meditation'].reduce(
      (n, k) => n + g.players.B2.areas[k as 'attack' | 'defense' | 'meditation'].length,
      0,
    );
    expect(b2After).toBe(b2Before - b2Ids.length);
    expect(g.players.B1.areas.attack.length).toBe(b1Attack);
    expect(artifact.count).toBe(1);
  });

  it('035 超度：真伤目标与重掷目标可分别选择', () => {
    const cfg = setup();
    cfg.seats.A1 = ['035', '002', '003'];
    const g = createTwoVTwoGame(cfg);
    const steps = SKILL_SELECTION['qianjie.chaodu'].steps(args(g, 'B1'));
    expect(steps[0]).toMatchObject({ kind: 'seat', candidates: ['B1', 'B2'] });
    expect(steps[1]).toMatchObject({ kind: 'seat', candidates: ['A1', 'A2', 'B1', 'B2'] });
    const params = SKILL_SELECTION['qianjie.chaodu'].buildParams({
      ...args(g, 'B1'),
      chosenDice: [[], []],
      options: ['B1', 'B2', 'attack'],
    });
    expect(params).toMatchObject({ target: 'B1', rerollTarget: 'B2', targetKind: 'attack' });
  });

  it('036 充能：2v2 只能选自己/敌人，不能选队友', () => {
    const g = createTwoVTwoGame(setup());
    const b1Dice = g.players.B1.areas.defense.length;
    const die = g.players.B1.areas.defense[0];
    SKILL_HANDLERS['wuxiang.charge'].run({
      ...ctx(g),
      params: { dieId: die.id },
      target: 'B1',
    });
    expect(g.players.B1.areas.defense.length).toBe(b1Dice - 1);

    const bad = createTwoVTwoGame(setup());
    const mateDie = bad.players.A2.areas.defense[0];
    expect(() =>
      SKILL_HANDLERS['wuxiang.charge'].run({
        ...ctx(bad),
        params: { dieId: mateDie.id },
        target: 'A2',
      }),
    ).toThrow();
  });

  it('036 充能选择器：2v2 候选不含队友', () => {
    const g = createTwoVTwoGame(setup());
    const steps = SKILL_SELECTION['wuxiang.charge'].steps(args(g, 'B1'));
    expect(steps[0]).toMatchObject({ kind: 'seat', candidates: ['A1', 'B1', 'B2'] });
  });

  it('036 必杀：2v2 只统计自己与所选敌人的 6 个区域', () => {
    const cfg = setup();
    cfg.dice = {
      A1: { attack: [], defense: [], meditation: [1, 2, 3] },
      B1: { attack: [1], defense: [], meditation: [] },
      B2: { attack: [], defense: [4, 5, 6], meditation: [] },
    };
    const g = createTwoVTwoGame(cfg);
    const keepIds = [
      ...g.players.A1.areas.meditation.map((d) => d.id),
      ...g.players.B2.areas.defense.map((d) => d.id),
    ];
    const b1Attack = g.players.B1.areas.attack.length;
    SKILL_HANDLERS['wuxiang.wanxiang.ultimate'].run({
      ...ctx(g),
      params: { keepIds },
      target: 'B2',
    });
    expect(g.players.B1.areas.attack.length).toBe(b1Attack);
  });

  it('A02 哀悼：显式选择弃置目标，伤害目标可另选', () => {
    const cfg = setup();
    cfg.seats.A1 = ['A02', '002', '003'];
    const g = createTwoVTwoGame(cfg);
    const b2Defense = g.players.B2.areas.defense.length;
    const die = g.players.B2.areas.defense[0];
    const beforeLife = g.teams!.B!.life;
    g.pending = { kind: 'aidao', player: 'A1' };

    applyAction(g, {
      t: 'aidao',
      accept: true,
      target: 'B2',
      damageTarget: 'B1',
      defenseDieId: die.id,
    });

    expect(g.players.B2.areas.defense.length).toBe(b2Defense - 1);
    expect(g.teams?.B?.life).toBe(beforeLife - 2);
  });

  it('A02 哀悼：2v2 不能弃队友的防御骰', () => {
    const cfg = setup();
    cfg.seats.A1 = ['A02', '002', '003'];
    const g = createTwoVTwoGame(cfg);
    g.pending = { kind: 'aidao', player: 'A1' };
    const die = g.players.A2.areas.defense[0];
    expect(() =>
      applyAction(g, {
        t: 'aidao',
        accept: true,
        target: 'A2',
        defenseDieId: die.id,
      }),
    ).toThrow();
    expect(g.pending?.kind).toBe('aidao');
  });

  it('031 / 035 / 036 在 1v1 不返回 seat 步', () => {
    const g = createGame({ seed: 7, firstPlayer: 'A' });
    for (const key of ['ezhao.qingsuan', 'qianjie.chaodu', 'wuxiang.charge', 'wuxiang.wanxiang.ultimate']) {
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
