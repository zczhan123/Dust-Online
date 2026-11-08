import { describe, it, expect } from 'vitest';
import { createTwoVTwoGame } from '../src/core/engine/game';
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

describe('2v2 批次 9 · 团队生命阈值', () => {
  it('015 残响绝境：按团队已损生命计算层数', () => {
    const cfg = setup();
    cfg.seats.A1 = ['001', '002', '015'];
    const g = createTwoVTwoGame(cfg);
    const artifact = g.players.A1.artifacts.find((a) => a.id === '015')!;
    g.teams!.A.lifeMax = 60;
    g.teams!.A.life = 35;
    for (const id of g.teams!.A.members) {
      g.players[id].lifeMax = 60;
      g.players[id].life = 35;
    }

    SKILL_HANDLERS['canxiang.juejing.ultimate'].run({ ...ctx(g), artifact });
    expect(artifact.count).toBe(2); // 已损 25 → floor 2
  });

  it('015 满血时不叠层', () => {
    const cfg = setup();
    cfg.seats.A1 = ['001', '002', '015'];
    const g = createTwoVTwoGame(cfg);
    const artifact = g.players.A1.artifacts.find((a) => a.id === '015')!;
    g.teams!.A.lifeMax = 60;
    g.teams!.A.life = 60;
    for (const id of g.teams!.A.members) {
      g.players[id].lifeMax = 60;
      g.players[id].life = 60;
    }
    SKILL_HANDLERS['canxiang.juejing.ultimate'].run({ ...ctx(g), artifact });
    expect(artifact.count).toBe(0);
  });
});
