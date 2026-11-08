import { describe, it, expect } from 'vitest';
import { autoAdvanceAction, beginTurn, createTwoVTwoGame, endTurn } from '../src/core/engine/game';
import { afterAttackResolved, applyLifeLoss, doAttack, resolveBlock } from '../src/core/engine/combat';
import { applyHeal } from '../src/core/engine/effects';
import { castTeamVote, createDefenseVote } from '../src/core/engine/teamVote';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';
import type { PendingAttack } from '../src/core/model/types';

const setup = (firstTeam: 'A' | 'B' = 'A', startPhase = false): TwoVTwoSetup => ({
  seats: {
    A1: ['001', '002', '003'],
    A2: ['004', '005', '006'],
    B1: ['007', '008', '009'],
    B2: ['010', '011', '012'],
  },
  firstTeam,
  startPhase,
  seed: 7,
});

describe('2v2 引擎建局与回合', () => {
  it('建局：四座位、团队生命、先手与尘印', () => {
    const g = createTwoVTwoGame(setup());
    expect(g.phase).toBe('main');
    expect(g.activePlayer).toBe('A1');
    expect(g.roster).toEqual(['A1', 'B1', 'A2', 'B2']);
    expect(g.teamOf).toEqual({ A1: 'A', A2: 'A', B1: 'B', B2: 'B' });
    expect(g.rules).toEqual({ id: '2v2', lifeModel: 'perTeam' });
    expect(g.teams?.A).toMatchObject({ life: 100, lifeMax: 100, members: ['A1', 'A2'] });
    expect(g.teams?.B).toMatchObject({ life: 90, lifeMax: 90, members: ['B1', 'B2'] });
    expect(g.players.A1.artifacts).toHaveLength(3);
    expect(g.players.B2.hasDustSeal).toBe(true);
    expect(g.players.A1.hasDustSeal).toBe(false);
  });

  it('2v2 无冥想骰自动跳过尘起；无骰自动跳过重掷', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'dustRise';
    g.activePlayer = 'A1';
    g.players.A1.areas = { attack: [], defense: [], meditation: [] };
    expect(autoAdvanceAction(g)).toEqual({ t: 'advance' });

    g.phase = 'reroll';
    expect(autoAdvanceAction(g)).toEqual({ t: 'advance' });
  });

  it('首回合只跳过 A1/B1 的补充与重掷；A2/B2 正常', () => {
    for (const seat of ['A1', 'B1'] as const) {
      const g = createTwoVTwoGame(setup());
      g.activePlayer = seat;
      g.firstRound = { A1: true, A2: true, B1: true, B2: true } as never;
      beginTurn(g);
      expect(g.phase, seat).toBe('dustRise');
    }
    for (const seat of ['A2', 'B2'] as const) {
      const g = createTwoVTwoGame(setup());
      g.activePlayer = seat;
      g.firstRound = { A1: true, A2: true, B1: true, B2: true } as never;
      beginTurn(g);
      expect(g.phase, seat).toBe('reroll');
    }
  });

  it('2v2 有尘印时不能把尘起阶段误判为空', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'dustRise';
    g.activePlayer = 'A1';
    g.players.A1.hasDustSeal = true;
    g.players.A1.areas = { attack: [], defense: [], meditation: [] };
    expect(autoAdvanceAction(g)).toBeNull();
  });

  it('真实开局 startPhase 仍把尘印交给尾位 B2', () => {
    const g = createTwoVTwoGame(setup('A', true));
    expect(g.phase).toBe('initialReroll');
    expect(g.players.B2.hasDustSeal).toBe(true);
    expect(g.players.A1.hasDustSeal).toBe(false);
  });

  it('先手 B1 时初始重掷顺序从 B1 环形推进', () => {
    const g = createTwoVTwoGame(setup('B', true));
    expect(g.phase).toBe('initialReroll');
    expect(g.activePlayer).toBe('B1');
    expect(g.initialRerollQueue).toEqual(['B1', 'A2', 'B2', 'A1']);
  });

  it('A1→B1→A2→B2 轮转；A1/B1 首回合跳过补充与重掷', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    expect(g.activePlayer).toBe('A1');
    endTurn(g);
    expect(g.activePlayer).toBe('B1');
    expect(g.phase).toBe('dustRise');
    endTurn(g);
    expect(g.activePlayer).toBe('A2');
    expect(g.phase).toBe('reroll');
  });

  it('伤害与回复都写团队生命池', () => {
    const g = createTwoVTwoGame(setup());
    applyLifeLoss(g, 'A1', 5, 'B1');
    expect(g.teams?.A?.life).toBe(95);
    expect(g.players.A1.life).toBe(95);
    expect(g.players.A2.life).toBe(95);
    applyHeal(g, 'A2', 3);
    expect(g.teams?.A?.life).toBe(98);
    expect(g.players.A1.life).toBe(98);
    expect(g.players.A2.life).toBe(98);
  });

  it('团队生命归零判负', () => {
    const g = createTwoVTwoGame(setup());
    applyLifeLoss(g, 'B2', 90, 'A1');
    expect(g.phase).toBe('gameOver');
    expect(g.winner).toBe('A');
  });

  it('攻击写入防守座位；只有该座位能抵挡；结算后翻面', () => {
    const cfg = setup();
    cfg.dice = {
      A1: { attack: [3], defense: [], meditation: [] },
      B2: { attack: [], defense: [], meditation: [] },
    };
    const g = createTwoVTwoGame(cfg);
    const atk = g.players.A1.areas.attack[0];
    doAttack(g, 'A1', [{ dieIds: [atk.id] }], undefined, 'B2');
    expect(g.pendingAttack?.defender).toBe('B2');
    expect(g.stance).toBe('attackPicks');

    expect(() => resolveBlock(g, undefined, 'B1')).toThrow('only the defender can block');
    resolveBlock(g, undefined, 'B2');
    expect(g.pendingAttack).toBeNull();
    expect(g.teams?.B?.life).toBe(87);
    expect(g.players.B2.life).toBe(87);
    expect(g.stance).toBe('defensePicks');

    endTurn(g);
    expect(g.stance).toBe('defensePicks');
  });

  it('攻击即使 0 伤害/被取消，结算后也翻面', () => {
    const g = createTwoVTwoGame(setup());
    const pa: PendingAttack = { attacker: 'A1', defender: 'B2', value: 0, unblockable: false, physical: true };
    afterAttackResolved(g, pa, { blocked: false, damageDealt: 0 });
    expect(g.stance).toBe('defensePicks');
  });

  it('守方投票：两名座位都选同一目标才决定', () => {
    const g = createTwoVTwoGame(setup());
    const vote = createDefenseVote(g, 'A1');
    expect(vote.voters).toEqual(['B1', 'B2']);
    expect(vote.options.map((o) => o.id)).toEqual(['B1', 'B2']);

    const first = castTeamVote(vote, 'B1', 'B2');
    expect(first.outcome.status).toBe('waiting');
    const second = castTeamVote(first.vote, 'B2', 'B2');
    expect(second.outcome).toEqual({ status: 'resolved', choice: 'B2' });
  });
});
