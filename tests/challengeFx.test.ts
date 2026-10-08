import { describe, it, expect } from 'vitest';
import {
  createGame,
  createChallengeGame,
  skipInitialReroll,
  applyAction,
  applyChallengeSkill,
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
    // 轮到的第一颗已从攻击骰区消耗掉（其余仍留在区里 → 界面演"逐颗飞出"）
    expect(got!.spawn.every((s) => !g.players.B.areas[s.area].some((d) => d.id === s.id))).toBe(true);
  });

  it('枭首（D）：攻击骰**留在攻击骰区**，轮到它攻击、**结算后**才从区里移走（不再一次清空）', () => {
    const g = CHAL();
    g.players.A.areas.defense = []; // 保证满足攻击条件
    g.players.B.areas.attack = [die('b1', 2, 'attack'), die('b2', 3, 'attack')];
    applyChallengeSkill(g, CARD, SK('z02-4'), [die('k1', 6, 'meditation')]);
    // 3 颗（旧 2 + 新 1）全部发起攻击；**这一帧都还在区里**（界面：新骰进区与旧骰并排，不重叠）
    expect(g.players.B.areas.attack.map((d) => d.value).sort((a, b) => a - b)).toEqual([2, 3, 6]);
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', sourceDieId: 'b1' });
    expect(g.pendingAttack?.dieStyle).toBe('solid');
    expect(g.virtualQueue?.length).toBe(2);
    // 结算这一击 → 第一颗（b1）才从攻击骰区移走
    applyAction(g, { t: 'block' });
    expect(g.players.B.areas.attack.some((d) => d.id === 'b1')).toBe(false);
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
    expect(fx1[0].spawn).toEqual([]);
    expect(fx1[0].attack).toBe(false);
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    applyAction(g, { t: 'challengePick', id: g.pending.options[0].id });
    applyAction(g, { t: 'challengeStep' }); // 结算：只报"新产生的骰"
    const fx2 = fxTake().filter((e): e is Extract<FxEvent, { kind: 'legendSkill' }> => e.kind === 'legendSkill');
    expect(fx2.length).toBe(1);
    expect(fx2[0].consumed).toEqual([]); // 不重复报消耗（界面不重复弹名 / 不重复进槽）
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
