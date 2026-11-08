import { describe, it, expect } from 'vitest';
import { applyAction, createTwoVTwoGame } from '../src/core/engine/game';
import { pumpPending, queueRerollEndTriggers } from '../src/core/engine/pending';
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

describe('2v2 批次 5 · 敌方座位', () => {
  it('017 帷幕：重掷结束时锁定重掷者，而非另一名敌人', () => {
    const cfg = setup();
    cfg.seats.A1 = ['017', '002', '003'];
    cfg.dice = {
      B1: { attack: [4], defense: [], meditation: [] },
      B2: { attack: [4], defense: [], meditation: [] },
    };
    const g = createTwoVTwoGame(cfg);
    g.players.A1.artifacts.find((a) => a.id === '017')!.activeMarkerSide = 'left';
    queueRerollEndTriggers(g, 'B2');
    pumpPending(g);
    expect(g.pending).toMatchObject({ kind: 'weimu', player: 'A1', target: 'B2' });

    const b1 = g.players.B1.areas.attack.length;
    const die = g.players.B2.areas.attack[0];
    applyAction(g, { t: 'weimu', accept: true, dieId: die.id });
    expect(g.players.B1.areas.attack.length).toBe(b1);
    expect(g.players.B2.areas.attack.some((d) => d.id === die.id)).toBe(false);
  });

  it('019 蛮王之牙：① 弃骰目标按所选敌人结算', () => {
    const cfg = setup();
    cfg.seats.A1 = ['019', '002', '003'];
    cfg.dice = {
      A1: { attack: [3], defense: [], meditation: [] },
      B1: { attack: [], defense: [2], meditation: [] },
      B2: { attack: [], defense: [4], meditation: [] },
    };
    const g = createTwoVTwoGame(cfg);
    const artifact = g.players.A1.artifacts.find((a) => a.id === '019')!;
    const aDie = g.players.A1.areas.attack[0];
    const b1 = g.players.B1.areas.defense.length;
    const b2Die = g.players.B2.areas.defense[0];

    SKILL_HANDLERS['chenai.fang'].run({
      ...ctx(g),
      artifact,
      params: {
        costSlots: [{ dieIds: [aDie.id] }],
        picks: ['discard'],
        discardIds: [b2Die.id],
        target: 'B2',
      },
      target: 'B2',
    });

    expect(g.players.B1.areas.defense.length).toBe(b1);
    expect(g.players.B2.areas.defense.some((d) => d.id === b2Die.id)).toBe(false);
  });

  it('023 畏惧：目标敌人支付并比较点数', () => {
    const cfg = setup();
    cfg.seats.A1 = ['023', '002', '003'];
    cfg.dice = {
      A1: { attack: [5], defense: [], meditation: [] },
      B2: { attack: [2], defense: [], meditation: [] },
    };
    const g = createTwoVTwoGame(cfg);
    const mine = g.players.A1.areas.attack[0];
    const theirs = g.players.B2.areas.attack[0];

    SKILL_HANDLERS['shexie.weiju'].run({
      ...ctx(g),
      params: { dieId: mine.id },
      target: 'B2',
    });
    expect(g.pending).toMatchObject({ kind: 'weijuPay', player: 'B2' });
    applyAction(g, { t: 'weijuPay', dieId: theirs.id });
    expect(g.players.B2.attackHalvedNextTurn).toBe(true);
  });

  it('023 共振：只与所选敌人各执行一次', () => {
    const cfg = setup();
    cfg.seats.A1 = ['023', '002', '003'];
    cfg.dice = {
      A1: { attack: [3], defense: [], meditation: [] },
      B1: { defense: [1], attack: [], meditation: [] },
      B2: { attack: [3], defense: [], meditation: [] },
    };
    const g = createTwoVTwoGame(cfg);
    const die = g.players.A1.areas.attack[0];

    SKILL_HANDLERS['shexie.gongzhen'].run({
      ...ctx(g),
      params: { dieId: die.id },
      target: 'B2',
    });
    expect(g.pending).toMatchObject({ kind: 'gongzhenPick', target: 'B2' });
    const kind = g.pending && g.pending.kind === 'gongzhenPick' ? g.pending.areaKind : 'attack';
    const b1 = g.players.B1.areas[kind].length;

    applyAction(g, { t: 'gongzhenResolve', pick: 'gain' });
    expect(g.players.B1.areas[kind].length).toBe(b1);
  });

  it('027 凛冽之音：使用攻击时锁定攻击目标来弃同点骰', () => {
    const cfg = setup();
    cfg.seats.A1 = ['001', '002', '027'];
    cfg.dice = {
      A1: { attack: [2], defense: [], meditation: [] },
      B1: { attack: [], defense: [3], meditation: [] },
      B2: { attack: [], defense: [3], meditation: [] },
    };
    const g = createTwoVTwoGame(cfg);
    const card = g.players.A1.artifacts.find((a) => a.id === '027')!;
    card.heldDice = [{ id: 'A1-027-held-3', value: 3 }];
    const atk = g.players.A1.areas.attack[0];
    const b1 = g.players.B1.areas.defense.length;
    const b2Die = g.players.B2.areas.defense[0];

    applyAction(g, {
      t: 'attack',
      costSlots: [{ dieIds: [atk.id] }],
      target: 'B2',
    });
    expect(g.pending).toMatchObject({ kind: 'hanguangPick', target: 'B2' });
    applyAction(g, {
      t: 'hanguangPick',
      pick: 'discard',
      dieId: 'A1-027-held-3',
      targetDieId: b2Die.id,
    });
    expect(g.players.B1.areas.defense.length).toBe(b1);
    expect(g.players.B2.areas.defense.some((d) => d.id === b2Die.id)).toBe(false);
  });

  it('017 / 019 / 023 / 027 的 2v2 选择器先选敌人', () => {
    const g = createTwoVTwoGame(setup());
    for (const key of ['@weimu', 'chenai.fang', 'shexie.weiju', 'shexie.gongzhen']) {
      const steps = SKILL_SELECTION[key].steps(args(g, 'B2'));
      if (key === '@weimu') {
        // @weimu 的目标来自 pending，不在 steps 里重复选
        expect(steps[0]?.kind).toBe('dice');
        continue;
      }
      expect(steps[0]).toMatchObject({ kind: 'seat', candidates: ['B1', 'B2'] });
      const dice = steps.filter(
        (s): s is Extract<SelectStep, { kind: 'dice' }> => s.kind === 'dice',
      );
      expect(dice.filter((s) => s.owner === 'opponent').every((s) => s.ownerSeat === 'B2')).toBe(
        true,
      );
    }
  });
});
