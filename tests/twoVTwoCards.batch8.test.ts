import { describe, it, expect } from 'vitest';
import { createTwoVTwoGame } from '../src/core/engine/game';
import { siwangShouldFire } from '../src/core/engine/game';
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

const ctx = (g: ReturnType<typeof createTwoVTwoGame>) => ({
  g,
  player: 'A1' as const,
  artifact: g.players.A1.artifacts[0],
  params: {},
  rng: new SeededRng(1),
  endMainPhase: () => {},
});

describe('2v2 批次 8 · 团队生命与无目标技能', () => {
  it('033 抹零：2v2 修改团队生命，而不是空白的个人生命', () => {
    const cfg = setup();
    cfg.seats.A1 = ['001', '002', '033'];
    const g = createTwoVTwoGame(cfg);
    g.teams!.A.life = 53;
    g.teams!.B.life = 47;
    for (const id of g.teams!.A.members) g.players[id].life = 53;
    for (const id of g.teams!.B.members) g.players[id].life = 47;

    SKILL_HANDLERS['diaoling.charge'].run(ctx(g));

    expect(g.teams?.A?.life).toBe(60);
    expect(g.teams?.B?.life).toBe(40);
  });

  it('033 死亡亦逝：任一玩家持有时，任意座位回合结束都可触发', () => {
    const cfg = setup();
    cfg.seats.A2 = ['033', '005', '006'];
    const g = createTwoVTwoGame(cfg);
    g.players.A2.artifacts.find((a) => a.id === '033')!.activeMarkerSide = 'left';
    expect(siwangShouldFire(g, 'B2')).toBe(true);
  });

  it('A03 修罗的破障：存放 2 颗骰，不产生目标选择', () => {
    const cfg = setup();
    cfg.seats.A1 = ['001', '002', 'A03'];
    const g = createTwoVTwoGame(cfg);
    const artifact = g.players.A1.artifacts.find((a) => a.id === 'A03')!;
    SKILL_HANDLERS['jingang.alt.pozhang'].run({
      ...ctx(g),
      artifact,
      params: { pips: [3, 3] },
    });
    expect(artifact.heldDice?.map((d) => d.value)).toEqual([3, 3]);
  });
});
