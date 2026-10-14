import { describe, it, expect } from 'vitest';
import { createGame, createChallengeGame, applyAction } from '../src/core/engine/game';
import { effectiveWill, totalDice } from '../src/core/engine/derive';
import type { GameState } from '../src/core/model/types';

/** 造一个"能尘起但不尘起"的尘起阶段（否则会被"没得做就自动翻页"跳过） */
const dustRiseReady = (g: GameState): void => {
  g.phase = 'dustRise';
  g.activePlayer = 'A';
  g.dustRiseNormalCount = 0;
  g.dustRiseActed = false;
  g.players.A.hasDustSeal = false;
  g.players.A.areas.meditation = [{ id: 'm1', value: 2, kind: 'meditation' }];
};

describe('挑战模式 · 建局与状态', () => {
  const make = () => createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });

  it('传奇＝B：装卡面预设三件、生命 50、没有任何能力骰', () => {
    const g = make();
    expect(g.mode).toBe('challenge');
    expect(g.players.B.artifacts.map((a) => a.id)).toEqual(['004', '005', '006']);
    expect(g.players.B.life).toBe(50);
    expect(g.players.B.lifeMax).toBe(50);
    expect(totalDice(g.players.B)).toBe(0);
  });

  it('开局战报：用卡名、**不带卡片代号**（不得出现 （Z02））', () => {
    const g = make();
    const txt = g.log.map((l) => l.text).join('\n');
    expect(txt).toContain('挑战模式：对手＝传说中的「永暗之刃」· 生命 50');
    expect(txt).not.toMatch(/（Z\d/);
  });

  it('挑战者＝A：正常拿到能力骰与尘印标记；传奇先手', () => {
    const g = make();
    expect(totalDice(g.players.A)).toBe(effectiveWill(g.players.A));
    expect(g.firstPlayer).toBe('B');
    expect(g.players.A.hasDustSeal).toBe(true); // 先手是传奇 → 尘印归挑战者
    expect(g.players.B.hasDustSeal).toBe(false);
  });

  it('挑战运行时初始值', () => {
    const g = make();
    expect(g.challenge).toEqual({ cardId: 'Z02', count: 0, driven: [], slot: [], turn: 0, settleMode: 'manual' });
  });

  it('传奇没有初始重掷可做 → 初始重掷直接轮到挑战者', () => {
    const g = make();
    expect(g.phase).toBe('initialReroll');
    expect(g.activePlayer).toBe('A');
  });

  it('标准模式（createGame）mode 为 standard、无 challenge（旧路径零变化）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    expect(g.mode).toBe('standard');
    expect(g.challenge).toBeUndefined();
  });

  it('单人挑战没有「尘落」：不尘起也不 +1', () => {
    const g = make();
    dustRiseReady(g);
    const before = g.dustfall;
    applyAction(g, { t: 'advance' }); // 本回合不进行尘起行动
    expect(g.dustfall).toBe(before); // 标准模式这里会 +1
    expect(g.phase).toBe('main');
  });

  it('对照：标准模式同一动作会 +1 尘落', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    dustRiseReady(g);
    const before = g.dustfall;
    applyAction(g, { t: 'advance' });
    expect(g.dustfall).toBe(before + 1);
  });
});
