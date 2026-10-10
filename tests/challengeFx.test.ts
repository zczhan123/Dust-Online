import { describe, it, expect } from 'vitest';
import {
  createGame,
  createChallengeGame,
  skipInitialReroll,
  applyAction,
  applyChallengeSkill,
  resolveLegendDeferred,
  getLegalActions,
} from '../src/core/engine/game';
import { fxTake, type FxEvent } from '../src/core/engine/fx';
import { CHALLENGES } from '../src/core/content/challenges';
import type { Die, DiceKind, GameState } from '../src/core/model/types';

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

const CARD = CHALLENGES.find((c) => c.id === 'Z02')!;
const SK = (id: string) => CARD.skills!.find((s) => s.id === id)!;
const die = (id: string, value: number, kind: DiceKind): Die => ({ id, value, kind });

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

  it('∞/无槽技能（龙游万象）也报 announce=true（不消耗驱动骰也要弹技能名）', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z01', challenger: ['001', '002', '003'] });
    skipInitialReroll(g);
    fxTake();
    g.challenge!.resumeAt = 1; // z01-1 龙游万象（∞）
    applyAction(g, { t: 'challengeStep' });
    const ev = fxTake().find((e): e is Extract<FxEvent, { kind: 'legendSkill' }> => e.kind === 'legendSkill');
    expect(ev).toBeTruthy();
    expect(ev!.skillKey).toBe('z01-1');
    expect(ev!.consumed).toEqual([]); // ∞＝不消耗驱动骰
    expect(ev!.announce).toBe(true); // 但仍是一条“发动”→ 界面弹技能名
  });

  it('枭首：驱动骰移入攻击骰区由 legendSkill.spawn 报出，本步 attack=false（攻击延后到 deferred）', () => {
    const g = CHAL();
    skipInitialReroll(g);
    fxTake();
    let got: Extract<FxEvent, { kind: 'legendSkill' }> | null = null;
    let inAreaAtFrame = false;
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
        if (e.kind === 'legendSkill' && e.skillKey === 'z02-4' && !got) {
          got = e;
          // 本步只"移入" → 骰子**留在**攻击骰区（供界面演"先进区、再逐颗飞出"）
          inAreaAtFrame = e.spawn.every((s) => g.players.B.areas[s.area].some((d) => d.id === s.id));
        }
      }
    }
    expect(got).toBeTruthy();
    expect(got!.spawn.length).toBeGreaterThan(0);
    expect(got!.attack).toBe(false); // 攻击延后到 resolveLegendDeferred
    expect(inAreaAtFrame).toBe(true); // 移入的骰当帧仍在攻击骰区
  });

  it('枭首（D）：攻击骰**留在攻击骰区**，轮到它攻击、**结算后**才从区里移走（不再一次清空）', () => {
    const g = CHAL();
    g.players.A.areas.defense = []; // 保证满足攻击条件
    g.players.B.areas.attack = [die('b1', 2, 'attack'), die('b2', 3, 'attack')];
    g.challenge!.decisions = { 'z02-4': ['asc'] }; // 直接给顺序（跳过代决面板）
    applyChallengeSkill(g, CARD, SK('z02-4'), [die('k1', 6, 'meditation')]);
    // 先移入：3 颗（旧 2 + 新 1）都在攻击骰区；**这一帧不攻击**
    expect(g.players.B.areas.attack.map((d) => d.value).sort((a, b) => a - b)).toEqual([2, 3, 6]);
    expect(g.pendingAttack).toBeNull();
    resolveLegendDeferred(g, CARD); // 移入之后才逐个攻击
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', sourceDieId: 'b1' });
    expect(g.pendingAttack?.dieStyle).toBe('solid');
    expect(g.virtualQueue?.length).toBe(2);
    // 结算这一击 → 第一颗（b1）才从攻击骰区移走
    applyAction(g, { t: 'block' });
    expect(g.players.B.areas.attack.some((d) => d.id === 'b1')).toBe(false);
  });

  it('枭首（顺序）：代决"由大到小"时，攻击骰区的**排列也按同一顺序重排**（最左先飞）', () => {
    const g = CHAL();
    g.players.A.areas.defense = [];
    g.players.B.areas.attack = [die('b1', 2, 'attack'), die('b2', 5, 'attack')];
    g.challenge!.decisions = { 'z02-4': ['desc'] };
    applyChallengeSkill(g, CARD, SK('z02-4'), [die('k1', 6, 'meditation')]);
    resolveLegendDeferred(g, CARD); // 顺序代决在"移入之后"才应用
    // 队列/区里都按"由大到小"：6 → 5 → 2
    expect(g.players.B.areas.attack.map((d) => d.value)).toEqual([6, 5, 2]);
    expect(g.virtualQueue?.map((q) => q.value)).toEqual([5, 2]);
    expect(g.pendingAttack).toMatchObject({ sourceDieId: g.players.B.areas.attack[0].id });
  });

  it('代决帧 vs 选完帧：两条 legendSkill（先"弹名＋进槽"，选完只报"新产生的骰"）', () => {
    const g = CHAL();
    skipInitialReroll(g);
    fxTake();
    // 让「葬敌的完杀」可填（〔1、2、3、4〕），且挑战者防御骰 >1 → 产生代决
    g.challenge!.driven = [
      die('q1', 1, 'meditation'),
      die('q2', 2, 'meditation'),
      die('q3', 3, 'meditation'),
      die('q4', 4, 'meditation'),
    ];
    g.players.A.areas.defense = [die('a1', 2, 'defense'), die('a2', 3, 'defense')];
    applyAction(g, { t: 'challengeStep' }); // 完杀：先扣骰 + 发事件，再挂代决
    const fx1 = fxTake().filter((e): e is Extract<FxEvent, { kind: 'legendSkill' }> => e.kind === 'legendSkill');
    expect(fx1.length).toBe(1);
    expect(fx1[0].consumed.length).toBeGreaterThan(0); // 代决帧：报消耗（界面＝弹技能名 + 驱骰进槽）
    expect(fx1[0].announce).toBe(true); // 代决帧＝发动帧 → 弹技能名
    expect(fx1[0].spawn).toEqual([]);
    expect(fx1[0].attack).toBe(false);
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    applyAction(g, { t: 'challengePick', id: g.pending.options[0].id });
    applyAction(g, { t: 'challengeStep' }); // 结算：只报"新产生的骰"
    const fx2 = fxTake().filter((e): e is Extract<FxEvent, { kind: 'legendSkill' }> => e.kind === 'legendSkill');
    expect(fx2.length).toBe(1);
    expect(fx2[0].consumed).toEqual([]); // 不重复报消耗（界面不重复弹名 / 不重复进槽）
    expect(fx2[0].announce).toBe(false); // 续跑帧不重复弹名
    expect(fx2[0].spawn.length).toBeGreaterThan(0);
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
