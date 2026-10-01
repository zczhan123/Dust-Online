// 战术牌（战斗牌）· 战前「抽 2 留 1」引擎流程
import { describe, it, expect } from 'vitest';
import { createGame, applyAction, getLegalActions } from '../src/core/engine/game';
import type { Action, GameState } from '../src/core/model/types';

const pickIds = (g: GameState): string[] =>
  getLegalActions(g)
    .filter((a): a is Extract<Action, { t: 'tacticPick' }> => a.t === 'tacticPick')
    .map((a) => a.id);

describe('战术牌·战前抽 2 留 1', () => {
  it('开启：进 tactics、先手抽 2；双方都选完才出现"战斗开始时"待决策；收口后进 initialReroll', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tactics: true });
    expect(g.phase).toBe('tactics');
    expect(g.activePlayer).toBe('A');
    expect(g.tacticHand).toHaveLength(2);
    const handA = [...g.tacticHand];
    expect(pickIds(g)).toEqual(handA); // 合法动作＝当前选者手里的 2 张

    applyAction(g, { t: 'tacticPick', id: handA[0] });
    expect(g.players.A.tactic).toBe(handA[0]);
    expect(g.pending ?? null).toBeNull(); // 延后：A 选完不立刻弹"战斗开始时"
    expect(g.phase).toBe('tactics');
    expect(g.activePlayer).toBe('B');
    expect(g.tacticHand).toHaveLength(2);
    expect(g.tacticHand).not.toContain(handA[0]); // 双方不同名：后手抽的池已排除先手所选

    const handB = [...g.tacticHand];
    applyAction(g, { t: 'tacticPick', id: handB[0] });
    expect(g.players.B.tactic).toBe(handB[0]);
    expect(g.players.B.tactic).not.toBe(g.players.A.tactic);
    // 双方选完 → 才可能出现"战斗开始时"待决策（至多 2 个）→ 逐个解决
    let guard = 0;
    while (g.phase === 'tactics' && g.pending && guard++ < 10) applyAction(g, getLegalActions(g)[0]);
    expect(g.phase).toBe('initialReroll');
    expect(g.initialRerollQueue).toEqual(['A', 'B']);
  });

  it('先手为 B 时顺序为 B→A（A 选完仍不弹）', () => {
    const g = createGame({ seed: 2, firstPlayer: 'B', tactics: true });
    expect(g.tacticQueue).toEqual(['B', 'A']);
    applyAction(g, { t: 'tacticPick', id: g.tacticHand[0] });
    expect(g.players.B.tactic).toBeTruthy();
    expect(g.pending ?? null).toBeNull();
    expect(g.activePlayer).toBe('A'); // 轮次交给 A
  });

  it('未开启：直接进 initialReroll，无抽牌', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    expect(g.phase).toBe('initialReroll');
    expect(g.tacticHand).toHaveLength(0);
    expect(g.players.A.tactic ?? null).toBeNull();
  });

  it('直接指定（构筑）：落 tactic；有"战斗开始时"交互时停在战前，收口后进 initialReroll 并结算生命修正', () => {
    const base = createGame({ seed: 1, firstPlayer: 'A' });

    // 无交互的 T03 / T04：直接进 initialReroll；A 生命 +6
    const g1 = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T03', tacticB: 'T04' });
    expect(g1.players.A.tactic).toBe('T03');
    expect(g1.players.B.tactic).toBe('T04');
    expect(g1.tacticHand).toHaveLength(0);
    expect(g1.phase).toBe('initialReroll');
    expect(g1.players.A.life).toBe(base.players.A.life + 6);
    expect(g1.players.A.lifeMax).toBe(base.players.A.lifeMax + 6);
    expect(g1.players.B.life).toBe(base.players.B.life);

    // A 自选点数（T01 / 谨慎）→ 停在战前待决策
    const g2 = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T01', tacticB: 'T04' });
    expect(g2.phase).toBe('tactics');
    expect(g2.pending?.kind).toBe('tacticDice');
    applyAction(g2, getLegalActions(g2)[0]);
    expect(g2.phase).toBe('initialReroll');
    expect(g2.players.A.life).toBe(base.players.A.life + 2);
    expect(g2.players.B.life).toBe(base.players.B.life);

    // 两步结算：A 的 T03（自身 +6）与 B 的 T02（降低对方 2）→ A 净 +4
    const g3 = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T03', tacticB: 'T02' });
    expect(g3.pending?.kind).toBe('tacticFirst');
    applyAction(g3, getLegalActions(g3)[0]);
    expect(g3.phase).toBe('initialReroll');
    expect(g3.players.A.life).toBe(base.players.A.life + 4);
    expect(g3.players.A.lifeMax).toBe(base.players.A.lifeMax + 4);
    expect(g3.players.B.life).toBe(base.players.B.life);
  });

  it('非法（不在手里）→ 抛错且不改状态', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tactics: true });
    const hand = [...g.tacticHand];
    const outside = g.tacticPool.find((id) => !hand.includes(id));
    expect(outside).toBeTruthy();
    expect(() => applyAction(g, { t: 'tacticPick', id: outside as string })).toThrow();
    expect(g.players.A.tactic ?? null).toBeNull();
    expect(g.phase).toBe('tactics');
  });

  it('战报：生命修正始终体现（含净值 0 的 +2/−2，且无贡献方不写）', () => {
    const base = createGame({ seed: 1, firstPlayer: 'A' });

    // T01（A 自身 +2）与 T02（B 对 A −2）→ A 净 0；A 的战报须写明两笔与"（不变）"
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T01', tacticB: 'T02' });
    let guard = 0;
    while (g.phase === 'tactics' && guard++ < 20) applyAction(g, getLegalActions(g)[0]);
    expect(g.phase).toBe('initialReroll');
    const texts = g.log.map((e) => e.text);
    const lineA = texts.find((t) => t.startsWith('玩家A 战术牌·初始生命修正'));
    expect(lineA).toBe(
      `玩家A 战术牌·初始生命修正：「谨慎」+2、「先机」−2 → 生命 ${base.players.A.life}／上限 ${base.players.A.lifeMax}（不变）`,
    );
    expect(texts.some((t) => t.startsWith('玩家B 战术牌·初始生命修正'))).toBe(false); // B 无贡献

    // T03（A 自身 +6）：单笔正修正的写法
    const g2 = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T03', tacticB: 'T04' });
    const lineA2 = g2.log.map((e) => e.text).find((t) => t.startsWith('玩家A 战术牌·初始生命修正'));
    expect(lineA2).toBe(
      `玩家A 战术牌·初始生命修正：「顽强」+6 → 生命 ${base.players.A.life + 6}／上限 ${base.players.A.lifeMax + 6}`,
    );
  });
});
