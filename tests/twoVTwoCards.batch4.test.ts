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

describe('2v2 批次 4 · 敌方骰目标', () => {
  it('001 中央突破：2v2 先选敌人，弃置目标座位的防御骰', () => {
    const cfg = setup();
    cfg.seats.A1 = ['001', '002', '003'];
    cfg.dice = {
      A1: { attack: [], defense: [], meditation: [2, 5] },
      B1: { attack: [], defense: [1], meditation: [] },
      B2: { attack: [], defense: [2, 3], meditation: [] },
    };
    const g = createTwoVTwoGame(cfg);
    const med = g.players.A1.areas.meditation.map((d) => d.id);
    const b1 = g.players.B1.areas.defense.length;
    const b2 = g.players.B2.areas.defense.length;

    SKILL_HANDLERS['yuqie.breakthrough'].run({
      ...ctx(g),
      params: {
        costSlots: [{ dieIds: [med[0]] }, { dieIds: [med[1]] }],
        opponentDefenseDieIds: g.players.B2.areas.defense.map((d) => d.id),
      },
      target: 'B2',
    });

    expect(g.players.B1.areas.defense.length).toBe(b1);
    expect(g.players.B2.areas.defense.length).toBe(b2 - 2);
  });

  it('006 零时枭首：目标座位决定弃防御骰与后续获得', () => {
    const cfg = setup();
    cfg.seats.A1 = ['001', '002', '006'];
    cfg.dice = {
      A1: { attack: [3], defense: [], meditation: [] },
      B1: { attack: [], defense: [1], meditation: [] },
      B2: { attack: [], defense: [2, 3], meditation: [] },
    };
    const g = createTwoVTwoGame(cfg);
    const atk = g.players.A1.areas.attack[0];
    const b1 = g.players.B1.areas.defense.length;
    const b2 = g.players.B2.areas.defense.length;

    SKILL_HANDLERS['wansha.ultimate'].run({
      ...ctx(g),
      params: {
        costSlots: [{ dieIds: [atk.id] }],
        opponentDefenseDieIds: g.players.B2.areas.defense.map((d) => d.id),
      },
      target: 'B2',
    });

    expect(g.players.B1.areas.defense.length).toBe(b1);
    expect(g.players.B2.areas.defense.length).toBe(b2 - 2);
  });

  it('009 高塔铁幕：充能待决策锁定所选敌人的攻击骰', () => {
    const cfg = setup();
    cfg.seats.A1 = ['001', '002', '009'];
    cfg.dice = {
      B1: { attack: [5], defense: [], meditation: [] },
      B2: { attack: [3], defense: [], meditation: [] },
    };
    const g = createTwoVTwoGame(cfg);
    const b1 = g.players.B1.areas.attack[0];
    const b2 = g.players.B2.areas.attack[0];

    SKILL_HANDLERS['guwang.charge'].run({ ...ctx(g), target: 'B2' });
    expect(g.pending).toMatchObject({ kind: 'guwangCharge', target: 'B2' });
    applyAction(g, { t: 'guwangCharge', dieId: b2.id });

    expect(g.players.B2.areas.attack.find((d) => d.id === b2.id)?.value).toBe(1);
    expect(g.players.B1.areas.attack.find((d) => d.id === b1.id)?.value).toBe(5);
  });

  it('014 净化：只改所选敌人的 1 点骰', () => {
    const cfg = setup();
    cfg.seats.A1 = ['001', '002', '014'];
    cfg.dice = {
      B1: { attack: [1], defense: [], meditation: [] },
      B2: { attack: [1], defense: [], meditation: [] },
    };
    const g = createTwoVTwoGame(cfg);
    const b1 = g.players.B1.areas.attack[0];
    const b2 = g.players.B2.areas.attack[0];

    SKILL_HANDLERS['chengjie.jinghua'].run({
      ...ctx(g),
      params: { targetDieIds: [b2.id] },
      target: 'B2',
    });

    expect(g.players.B1.areas.attack.find((d) => d.id === b1.id)?.value).toBe(1);
    const changed = ['attack', 'defense', 'meditation'].some((k) =>
      g.players.B2.areas[k as 'attack' | 'defense' | 'meditation'].some(
        (d) => d.id === b2.id && d.value === 6,
      ),
    );
    expect(changed).toBe(true);
  });

  it('001 / 006 / 014 的 2v2 选择器先返回目标座位步', () => {
    const g = createTwoVTwoGame(setup());
    for (const key of ['yuqie.breakthrough', 'wansha.ultimate', 'chengjie.jinghua']) {
      const steps = SKILL_SELECTION[key].steps(args(g, 'B2'));
      expect(steps[0]).toMatchObject({ kind: 'seat', candidates: ['B1', 'B2'] });
      const dice = steps.filter(
        (s): s is Extract<SelectStep, { kind: 'dice' }> => s.kind === 'dice',
      );
      expect(dice.filter((s) => s.owner === 'opponent').every((s) => s.ownerSeat === 'B2')).toBe(
        true,
      );
    }
  });

  it('001 / 006 / 014 在 1v1 不返回 seat 步', () => {
    const g = createGame({ seed: 7, firstPlayer: 'A' });
    for (const key of ['yuqie.breakthrough', 'wansha.ultimate', 'chengjie.jinghua']) {
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
