// L04「我将在下个梦境与你再度相逢」重开 × 战术牌：
// 规则——L04 重开＝从「获得初始能力骰子」步骤重来，故只重跑**触发时点在该步骤或之后**的战术牌。
//   T01「当你投掷初始能力骰子」→ 重跑；T02「当你获得本战术后」→ 不重跑；生命/上限一律不动。
import { describe, it, expect } from 'vitest';
import { createGame, applyAction, getLegalActions } from '../src/core/engine/game';
import { effectiveWill, totalDice } from '../src/core/engine/derive';
import type { GameState } from '../src/core/model/types';

const runTactics = (g: GameState): void => {
  let guard = 0;
  while (g.phase === 'tactics' && guard++ < 20) applyAction(g, getLegalActions(g)[0]);
};

const useDream = (g: GameState, first: 'A' | 'B'): void => {
  g.phase = 'main';
  g.activePlayer = g.firstPlayer;
  applyAction(g, { t: 'skill', artifactId: 'L04', side: 'only', params: { first } });
};

describe('L04 重开 × 战术牌', () => {
  it('T01「谨慎」：重开时重新弹出"自选初始能力骰"；生命与上限不变', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      legendA: 'L04',
      heroA: ['010', '011', '012'],
      tacticA: 'T01',
      tacticB: 'T04',
    });
    runTactics(g);
    expect(g.phase).toBe('initialReroll');

    const lifeA = g.players.A.life;
    const lifeMaxA = g.players.A.lifeMax;
    const lifeB = g.players.B.life;

    useDream(g, 'B');
    expect(g.phase).toBe('tactics');
    expect(g.pending?.kind).toBe('tacticDice');
    expect(g.pending && g.pending.player).toBe('A');
    expect(g.players.A.life).toBe(lifeA);
    expect(g.players.A.lifeMax).toBe(lifeMaxA);
    expect(g.players.B.life).toBe(lifeB);

    applyAction(g, getLegalActions(g)[0]);
    expect(g.phase).toBe('initialReroll');
    expect(totalDice(g.players.A)).toBe(effectiveWill(g.players.A));
    expect(g.players.A.areas.attack.length).toBeLessThanOrEqual(4);
    expect(g.players.A.life).toBe(lifeA);
    expect(g.players.A.lifeMax).toBe(lifeMaxA);
    expect(g.players.A.hasDustSeal).toBe(false);
    expect(g.players.B.hasDustSeal).toBe(false);
  });

  it('T02「先机」：重开**不**触发（触发时点「当你获得本战术后」早于重开起点）', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      legendA: 'L04',
      heroA: ['010', '011', '012'],
      tacticA: 'T05',
      tacticB: 'T02',
    });
    runTactics(g);
    expect(g.phase).toBe('initialReroll');

    const lifeA = g.players.A.life;
    const lifeMaxA = g.players.A.lifeMax;

    useDream(g, 'A'); // L04 选 A 为先手
    expect(g.pending ?? null).toBeNull(); // 不再弹先手
    expect(g.phase).toBe('initialReroll');
    expect(g.firstPlayer).toBe('A'); // 维持 L04 所选
    expect(g.initialRerollQueue).toEqual(['A', 'B']);
    expect(g.players.A.hasDustSeal).toBe(false);
    expect(g.players.B.hasDustSeal).toBe(false);
    expect(g.players.A.life).toBe(lifeA);
    expect(g.players.A.lifeMax).toBe(lifeMaxA);
  });

  it('T01 + T02 共存：重开只重跑 T01（自选骰），T02 不触发', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      legendA: 'L04',
      heroA: ['010', '011', '012'],
      tacticA: 'T01',
      tacticB: 'T02',
    });
    runTactics(g);
    expect(g.phase).toBe('initialReroll');

    useDream(g, 'B');
    expect(g.phase).toBe('tactics');
    expect(g.pending?.kind).toBe('tacticDice'); // 只有 T01 的待决策
    expect(g.pending && g.pending.player).toBe('A');

    applyAction(g, getLegalActions(g)[0]);
    expect(g.phase).toBe('initialReroll');
    expect(g.firstPlayer).toBe('B'); // 维持 L04 所选（T02 未改）
    expect(g.players.A.hasDustSeal).toBe(false);
    expect(g.players.B.hasDustSeal).toBe(false);
  });

  it('无战术牌：L04 重开仍走原路径（不发尘印、直接进 initialReroll）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', legendA: 'L04', heroA: ['010', '011', '012'] });
    expect(g.phase).toBe('initialReroll');
    useDream(g, 'B');
    expect(g.phase).toBe('initialReroll');
    expect(g.initialRerollQueue).toEqual(['B', 'A']);
    expect(g.players.A.hasDustSeal).toBe(false);
    expect(g.players.B.hasDustSeal).toBe(false);
  });

  it('T04 持有者发动 L04（重置整局）→ T04 照字面触发（重开之后结算）', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      legendA: 'L04',
      heroA: ['001', '002', '003'],
      heroB: ['001', '002', '003'],
      tacticA: 'T04',
      tacticB: 'T03',
    });
    expect(g.phase).toBe('initialReroll');
    const req = g.players.A.artifacts.find((a) => a.column === 3)!.chargeReq!;
    expect(req).toBeGreaterThan(0);
    g.players.A.life = g.players.A.lifeMax - 10; // 留出回复空间
    const lifeA = g.players.A.life;
    const lifeB = g.players.B.life;
    useDream(g, 'B');
    expect(g.players.B.life).toBe(lifeB - req); // 造成 req 真实伤害
    expect(g.players.A.life).toBe(lifeA + req); // 回复 req 生命
  });
});
