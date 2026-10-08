import { describe, it, expect } from 'vitest';
import {
  createGame,
  createChallengeGame,
  skipInitialReroll,
  applyAction,
  getLegalActions,
} from '../src/core/engine/game';
import { fxTake, type FxEvent } from '../src/core/engine/fx';
import type { GameState } from '../src/core/model/types';

/**
 * 挑战模式 · 传奇回合的"动效旁路事件"（界面据此编排过场）。
 *
 * 引擎只报事实、不改结算；标准模式**永不**出现这两种事件（隔离红线）。
 * 动画本身 jsdom 一律跳过（`canAnimate`），所以可测层就是这些事件。
 */

const CHAL = (): GameState =>
  createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });
const STD = (): GameState =>
  createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['001', '002', '003'] });

const isLegendFx = (e: FxEvent): boolean => e.kind === 'legendRoll' || e.kind === 'legendSkill';

describe('挑战模式 · 传奇回合 fx 事件', () => {
  it('回合开始：报 legendRoll（本回合投出的全部驱动骰，id 与角子一致）', () => {
    const g = CHAL();
    fxTake(); // 清掉建局残留
    skipInitialReroll(g); // 挑战者初始重掷 → 紧接着就是传奇第一个回合（投完骰停住）
    expect(g.activePlayer).toBe('B');
    const fx = fxTake();
    const roll = fx.find((e): e is Extract<FxEvent, { kind: 'legendRoll' }> => e.kind === 'legendRoll');
    expect(roll).toBeTruthy();
    expect(roll!.player).toBe('B');
    expect(roll!.dice).toHaveLength(8);
    expect(roll!.dice.map((d) => d.id).sort()).toEqual(g.challenge!.driven.map((d) => d.id).sort());
    // 点数也一致
    for (const d of roll!.dice) {
      expect(g.challenge!.driven.find((x) => x.id === d.id)?.value).toBe(d.value);
    }
  });

  it('发动技能：每一步都报 legendSkill（消耗的驱动骰 / 新产生的骰 / 是否触发攻击）', () => {
    const g = CHAL();
    skipInitialReroll(g);
    fxTake();
    const events: Extract<FxEvent, { kind: 'legendSkill' }>[] = [];
    let guard = 0;
    while (g.activePlayer === 'B' && guard++ < 12) {
      if (g.pendingAttack) {
        applyAction(g, { t: 'block' });
        fxTake();
        continue;
      }
      if (g.pending) {
        const opt = (g.pending as { options: { id: string }[] }).options[0];
        applyAction(g, { t: 'challengePick', id: opt.id });
        fxTake();
        continue;
      }
      applyAction(g, { t: 'challengeStep' });
      for (const e of fxTake()) if (e.kind === 'legendSkill') events.push(e);
    }
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.player).toBe('B');
      expect(typeof e.skillKey).toBe('string');
      expect(e.skillKey.length).toBeGreaterThan(0);
      expect(typeof e.skillName).toBe('string');
      expect(Array.isArray(e.consumed)).toBe(true);
      expect(Array.isArray(e.spawn)).toBe(true);
      expect(Array.isArray(e.outIds)).toBe(true);
      expect(typeof e.attack).toBe('boolean');
      for (const s of e.spawn) expect(['attack', 'defense', 'meditation']).toContain(s.area);
    }
    // 本局必然至少有一步真的产出了骰（葬敌的完杀 / 枭首 / 遁入暗影 之一）
    expect(events.some((e) => e.spawn.length > 0)).toBe(true);
  });

  it('枭首触发攻击时：新产生的骰被立刻移出攻击骰区 → 仍由 legendSkill.spawn 报出（界面才能演"先进区再打"）', () => {
    const g = CHAL();
    skipInitialReroll(g);
    fxTake();
    // 清空挑战者防御骰 → 枭首一旦跑起来必然触发攻击（攻击骰数 > 0）
    let got: Extract<FxEvent, { kind: 'legendSkill' }> | null = null;
    let guard = 0;
    while (g.activePlayer === 'B' && guard++ < 12) {
      if (g.pendingAttack) {
        applyAction(g, { t: 'block' });
        fxTake();
        continue;
      }
      if (g.pending) {
        const opt = (g.pending as { options: { id: string }[] }).options[0];
        applyAction(g, { t: 'challengePick', id: opt.id });
        fxTake();
        continue;
      }
      if (!got) {
        // 强制「枭首」必能填槽（〔6点〕）且满足攻击条件（挑战者 0 防御骰）
        g.players.A.areas.defense = [];
        g.challenge!.driven = [{ id: 'x6', value: 6, kind: 'meditation' }];
      }
      applyAction(g, { t: 'challengeStep' });
      for (const e of fxTake()) {
        if (e.kind === 'legendSkill' && e.skillKey === 'z02-4') got = e;
      }
    }
    expect(got).toBeTruthy();
    expect(got!.attack).toBe(true);
    expect(got!.spawn.length).toBeGreaterThan(0);
    // 骰子已进攻击队列 → 状态里看不到它们（这正是必须由引擎报出的原因）
    expect(got!.spawn.every((s) => !g.players.B.areas[s.area].some((d) => d.id === s.id))).toBe(true);
  });

  it('标准模式：全程不出现 legendRoll / legendSkill', () => {
    const g = STD();
    skipInitialReroll(g);
    expect(fxTake().some(isLegendFx)).toBe(false);
    for (let i = 0; i < 20 && g.phase !== 'gameOver'; i++) {
      const acts = getLegalActions(g);
      if (!acts.length) break;
      if (g.pendingAttack) applyAction(g, { t: 'block' });
      else if (g.pending) applyAction(g, acts[0]);
      else applyAction(g, acts.find((a) => a.t === 'advance') ?? acts[0]);
      expect(fxTake().some(isLegendFx)).toBe(false);
    }
  });
});
