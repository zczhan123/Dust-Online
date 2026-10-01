// 战术牌 T13「远见」：战斗开始时猜测"生命最先降为 20 点或以下"的玩家；猜对则得 1 个任意点数能力骰（只发一次）
import { describe, it, expect } from 'vitest';
import { createGame, applyAction, getLegalActions, tacticBarState } from '../src/core/engine/game';
import { applyLifeLoss } from '../src/core/engine/combat';
import { pumpPending } from '../src/core/engine/pending';
import { resetToBattleStart } from '../src/core/engine/reset';
import { TACTIC_BY_ID, tacticDisplayText, TACTIC_POOL } from '../src/core/content/tactics';
import type { GameState } from '../src/core/model/types';

const mk = (): GameState =>
  createGame({
    seed: 1,
    firstPlayer: 'A',
    heroA: ['001', '002', '003'],
    heroB: ['004', '005', '006'],
    tacticA: 'T13',
    tacticB: 'T04', // 无战前交互
  });

/** 猜完（A 的 T13 猜 who）→ 进入 initialReroll 之后，供后续伤害测试 */
const guessed = (who: 'A' | 'B', guess: 'A' | 'B'): GameState => {
  const g = mk();
  expect(g.pending?.kind).toBe('tacticGuess');
  applyAction(g, { t: 'tacticGuess', who: guess });
  expect(g.players[who].tacticGuess).toBe(guess);
  return g;
};

describe('T13「远见」· 内容数据', () => {
  it('数据正确（名字 / 生命修正 / key / 原文）', () => {
    const def = TACTIC_BY_ID['T13'];
    expect(def).toBeTruthy();
    expect(def.name).toBe('远见');
    expect(def.number).toBe('Z-013');
    expect(def.key).toBe('yuanjian');
    expect(def.lifeMods).toEqual([{ who: 'opp', amount: 2 }]);
    expect(def.effectText).toBe(
      '战斗开始时，猜测生命最先降为 20 点或以下的玩家。当有玩家的生命降为 20 点或以下时，如果你猜测正确，你立即获得 1 个任意点数的能力骰，并将其放置在任意区域。',
    );
    expect(TACTIC_POOL).toContain('T13');
  });

  it('显示文本：效果句在前、生命修正句在后', () => {
    expect(tacticDisplayText(TACTIC_BY_ID['T13'])).toBe(
      '战斗开始时，猜测生命最先降为 20 点或以下的玩家。当有玩家的生命降为 20 点或以下时，如果你猜测正确，你立即获得 1 个任意点数的能力骰，并将其放置在任意区域；降低对方初始生命2点。',
    );
  });
});

describe('T13「远见」· 战前猜测', () => {
  it('构筑直接指定 → 停在战前弹 tacticGuess；猜完进 initialReroll；对方 −2', () => {
    const base = createGame({ seed: 1, firstPlayer: 'A' });
    const g = mk();
    expect(g.phase).toBe('tactics');
    expect(g.pending?.kind).toBe('tacticGuess');
    // 合法动作＝A/B 两个选项
    expect(getLegalActions(g)).toEqual([
      { t: 'tacticGuess', who: 'A' },
      { t: 'tacticGuess', who: 'B' },
    ]);
    applyAction(g, { t: 'tacticGuess', who: 'B' });
    expect(g.players.A.tacticGuess).toBe('B');
    expect(g.phase).toBe('initialReroll');
    expect(g.players.B.life).toBe(base.players.B.life - 2); // 降低对方初始生命 2 点
    expect(g.players.A.life).toBe(base.players.A.life);
    expect(g.log.map((e) => e.text).some((t) => t.includes('「远见」：猜测 玩家B'))).toBe(true);
  });

  it('非法猜测对象 → 抛错且不改状态', () => {
    const g = mk();
    expect(() => applyAction(g, { t: 'tacticGuess', who: 'C' as 'A' })).toThrow();
    expect(g.players.A.tacticGuess).toBeNull();
    expect(g.phase).toBe('tactics');
  });
});

describe('T13「远见」· 触发与奖励', () => {
  it('猜对：生命首个降到 ≤20 → 发 1 个任意点数能力骰并放入任意区域（只发一次）', () => {
    const g = guessed('A', 'B');
    g.players.B.life = 21;
    applyLifeLoss(g, 'B', 3); // 21 → 18（≤20）
    pumpPending(g); // 真实对局里由 applyAction 收尾自动 pump
    expect(g.tacticLowFirst).toBe('B');
    expect(g.pending?.kind).toBe('yuanjianGain');
    expect(getLegalActions(g)).toHaveLength(18); // 6 点数 × 3 区域
    applyAction(g, { t: 'yuanjianGain', value: 4, area: 'meditation' });
    expect(g.players.A.areas.meditation.some((d) => d.value === 4)).toBe(true);
    expect(g.pending ?? null).toBeNull();

    // 只发一次：之后 A 也降到 ≤20 → 不再触发
    g.players.A.life = 21;
    applyLifeLoss(g, 'A', 3);
    pumpPending(g);
    expect(g.tacticLowFirst).toBe('B'); // 仍是"第一个"
    expect(g.pending ?? null).toBeNull();
  });

  it('猜错：另一人先降到 ≤20 → 不发奖；此后即便猜中的人也降下来也不发', () => {
    const g = guessed('A', 'A'); // A 猜自己
    g.players.B.life = 21;
    applyLifeLoss(g, 'B', 3); // B 先降到 ≤20（猜错）
    pumpPending(g);
    expect(g.tacticLowFirst).toBe('B');
    expect(g.pending ?? null).toBeNull();
    expect(g.log.map((e) => e.text).some((t) => t.includes('猜测错误'))).toBe(true);

    // 之后 A 也降到 ≤20 → 仍不发（对错已在第一人触线时定死）
    g.players.A.life = 21;
    applyLifeLoss(g, 'A', 3);
    pumpPending(g);
    expect(g.pending ?? null).toBeNull();
  });

  it('致死的一击（游戏结束）→ 不发奖、不记录', () => {
    const g = guessed('A', 'B');
    applyLifeLoss(g, 'B', g.players.B.life); // B → 0（判负）
    pumpPending(g);
    expect(g.phase).toBe('gameOver');
    expect(g.tacticLowFirst).toBeNull();
    expect(g.pending ?? null).toBeNull();
  });

  it('非法奖励选择 → 抛错', () => {
    const g = guessed('A', 'B');
    g.players.B.life = 21;
    applyLifeLoss(g, 'B', 5); // 21 → 16（≤20）
    pumpPending(g);
    expect(g.pending?.kind).toBe('yuanjianGain');
    expect(() => applyAction(g, { t: 'yuanjianGain', value: 7, area: 'attack' })).toThrow();
    expect(() => applyAction(g, { t: 'yuanjianGain', value: 3, area: 'x' as 'attack' })).toThrow();
    expect(g.pending?.kind).toBe('yuanjianGain'); // 未改状态
  });
});

describe('T13「远见」· 横条三态 / L04 重开', () => {
  it('横条：触线前"生效中"（绿）、触线后"已用尽"（灰）', () => {
    const g = guessed('A', 'B');
    expect(tacticBarState(g, 'A')).toBe('active');
    g.players.B.life = 21;
    applyLifeLoss(g, 'B', 5);
    pumpPending(g);
    expect(tacticBarState(g, 'A')).toBe('spent');
  });

  it('L04 重开：不重跑（reOnReset 未设）；猜测与"第一个≤20"均保留', () => {
    const def = TACTIC_BY_ID['T13'];
    expect(def.reOnReset ?? false).toBe(false);

    const g = guessed('A', 'B');
    resetToBattleStart(g, 'A');
    expect(g.players.A.tacticGuess).toBe('B'); // 猜测保留（生命继承，猜测已完成）
    expect(g.tacticLowFirst).toBeNull(); // 尚未触线 → 重开后仍可触发
    expect(g.phase).toBe('initialReroll'); // 无 reOnReset 牌 → 直接进初始重掷
  });

  it('L04 重开（已触线后）：记录保留，不会重复发奖', () => {
    const g = guessed('A', 'B');
    g.players.B.life = 21;
    applyLifeLoss(g, 'B', 3);
    pumpPending(g);
    applyAction(g, { t: 'yuanjianGain', value: 2, area: 'attack' }); // 用掉奖励
    resetToBattleStart(g, 'A');
    expect(g.tacticLowFirst).toBe('B'); // 记录保留
    g.players.B.life = 21;
    applyLifeLoss(g, 'B', 5);
    pumpPending(g);
    expect(g.pending ?? null).toBeNull(); // 不再发
  });
});
