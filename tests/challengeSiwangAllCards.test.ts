import { describe, it, expect } from 'vitest';
import { applyAction, createChallengeGame, getLegalActions, skipInitialReroll } from '../src/core/engine/game';
import { CHALLENGES } from '../src/core/content/challenges';
import type { GameState, PlayerId } from '../src/core/model/types';

/** 让挑战者带着**已装填**的 033（＝充能满）——033 是第三列、`only` 侧。 */
function armSiwang(g: GameState): void {
  const a033 = g.players.A.artifacts.find((a) => a.id === '033')!;
  a033.activeMarkerSide = 'left';
  a033.armedSide = 'left';
  a033.armedTurn = g.turnIndex;
}

/** 保证某玩家"区域骰 > 0"（放**冥想区**：传奇回合里不会被抵挡消耗）。 */
function giveAreaDice(g: GameState, id: PlayerId, vals: number[]): void {
  for (let i = 0; i < vals.length; i++) {
    g.players[id].areas.meditation.push({ id: `${id}-m${i}`, value: vals[i], kind: 'meditation' });
  }
}

/** 推进传奇回合：中途的**代决（challengePick）自动取第一项**；遇到**别的**待决策（如 tiaolingPick）就停。 */
function driveUntilPending(g: GameState): void {
  let guard = 0;
  while (g.activePlayer === 'B' && g.phase !== 'gameOver' && guard++ < 200) {
    if (g.pending) {
      if (g.pending.kind === 'challengePick') {
        applyAction(g, { t: 'challengePick', id: g.pending.options[0].id });
        continue;
      }
      return; // 停下来看这个待决策（tiaolingPick / 其它）
    }
    if (g.pendingAttack) {
      const legal = getLegalActions(g);
      applyAction(g, legal.find((a) => a.t === 'block') ?? legal[0]);
      continue;
    }
    applyAction(g, { t: 'challengeStep' });
  }
}

/** 「全部相同」口径下该弃哪些（＝保留**一个**"最多点数"的那批，其余全弃）与应弃颗数。 */
function siwangDrop(g: GameState): { drop: string[]; need: number } {
  const all = [
    ...g.players.B.areas.attack,
    ...g.players.B.areas.defense,
    ...g.players.B.areas.meditation,
  ];
  const cnt = new Map<number, number>();
  for (const d of all) cnt.set(d.value, (cnt.get(d.value) ?? 0) + 1);
  let mostV = 0;
  let mostN = -1;
  for (const [v, n] of cnt) if (n > mostN) { mostN = n; mostV = v; }
  const drop = all.filter((d) => d.value !== mostV).map((d) => d.id);
  return { drop, need: all.length - Math.max(0, mostN) };
}

/** B 三区合计。 */
function bTotal(g: GameState): number {
  return (
    g.players.B.areas.attack.length + g.players.B.areas.defense.length + g.players.B.areas.meditation.length
  );
}

describe('死亡亦逝（033）· 全 12 张传奇卡覆盖：传奇回合结束都会挂代决', () => {
  for (const card of CHALLENGES) {
    it(`${card.id}「${card.legacy}」：传奇回合结束 → tiaolingPick{player:A, owner:B}`, () => {
      const g = createChallengeGame({ seed: 1, cardId: card.id, challenger: ['031', '032', '033'] });
      armSiwang(g);
      giveAreaDice(g, 'B', [3, 3, 5]); // 保证昔日此刻有区域骰
      skipInitialReroll(g);
      driveUntilPending(g);
      const pd = g.pending as { kind?: string; player?: string; owner?: string } | null;
      expect(pd?.kind).toBe('tiaolingPick');
      expect(pd!.player).toBe('A');
      expect(pd!.owner).toBe('B');
    });
  }
});

describe('Z10「救赎」× 033：先结算本回合「回合结束」，再开新回合', () => {
  /** 造一局：挑战者带 033 已装填、昔日有区域骰、且本回合已置「救赎」覆盖。 */
  const makeSut = (): { g: GameState; t0: number } => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z10', challenger: ['031', '032', '033'] });
    armSiwang(g);
    giveAreaDice(g, 'B', [3, 3, 3, 5, 5]); // 多给几颗：保证"只弃最少"后仍有骰、且能连锁
    g.players.A.life = 60; // 免得第二回合的攻击把挑战者打死（连锁测试要跑完整轮）
    skipInitialReroll(g);
    g.challenge!.nextTurnOverride = { rollDice: 5, atkBonus: 1 }; // 模拟 z10-5「救赎」已生效
    return { g, t0: g.turnIndex };
  };

  it('先挂 033（新回合**还没开**）→ 解完 033 → 才开新回合（投 5 / turnIndex+1 / 覆盖已消费）', () => {
    const { g, t0 } = makeSut();
    driveUntilPending(g);
    // ① 先结算本回合的「回合结束」：033 代决
    expect(g.pending?.kind).toBe('tiaolingPick');
    expect(g.challenge!.nextTurnOverride).toBeTruthy(); // 新回合尚未开始
    expect(g.turnIndex).toBe(t0);
    // ② 解掉 033（只弃最少，'same' 口径）
    const { drop, need } = siwangDrop(g);
    expect(drop.length).toBe(need);
    const before = bTotal(g);
    applyAction(g, { t: 'tiaolingResolve', pick: 'same', dieIds: drop });
    expect(g.pending).toBeNull();
    expect(bTotal(g)).toBe(before - drop.length); // 恰好弃了"最少"那几颗
    // ③ 解完后仍停在传奇（等 challengeStep）→ 派一步才开新回合
    expect(g.challenge!.startNextTurnAfterPending).toBe(true);
    expect(getLegalActions(g).some((a) => a.t === 'challengeStep')).toBe(true);
    applyAction(g, { t: 'challengeStep' });
    expect(g.challenge!.startNextTurnAfterPending).toBe(false);
    expect(g.turnIndex).toBe(t0 + 1); // 新回合真的开了
    expect(g.challenge!.nextTurnOverride).toBeUndefined(); // 覆盖已被消费
    expect(g.challenge!.driven.length).toBe(5); // 「救赎」的新回合＝投 5 个驱动骰
  });

  it('连锁：新回合也置「救赎」→ 那一轮的「回合结束」再结算一次 033', () => {
    const { g, t0 } = makeSut();
    driveUntilPending(g);
    const d1 = siwangDrop(g);
    applyAction(g, { t: 'tiaolingResolve', pick: 'same', dieIds: d1.drop });
    applyAction(g, { t: 'challengeStep' }); // 开新回合
    expect(g.turnIndex).toBe(t0 + 1);
    expect(bTotal(g)).toBeGreaterThan(0); // 第一轮"只弃最少"后仍有骰
    // 新回合再触发一次「救赎」→ 跑到它的收尾
    g.challenge!.nextTurnOverride = { rollDice: 5, atkBonus: 1 };
    driveUntilPending(g);
    expect(g.phase).not.toBe('gameOver');
    expect(g.pending?.kind).toBe('tiaolingPick'); // 第二轮仍然"先结算 033"
    expect(g.turnIndex).toBe(t0 + 1); // 第二个新回合也还没开
  });

  it('无 033（挑战者没带）→ 不挂 pending、直接开新回合（行为与改前一致）', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z10', challenger: ['029', '030', '031'] });
    giveAreaDice(g, 'B', [3, 3, 5]);
    skipInitialReroll(g);
    const t0 = g.turnIndex;
    g.challenge!.nextTurnOverride = { rollDice: 5, atkBonus: 1 };
    driveUntilPending(g);
    expect(g.pending?.kind ?? null).not.toBe('tiaolingPick');
    expect(g.challenge!.startNextTurnAfterPending).not.toBe(true); // 没有"延后"这回事
    expect(g.challenge!.nextTurnOverride).toBeUndefined(); // 新回合已开、覆盖已被消费
    expect(g.turnIndex).toBeGreaterThan(t0); // 确实进入了后续回合（新回合也跑完了）
  });
});
