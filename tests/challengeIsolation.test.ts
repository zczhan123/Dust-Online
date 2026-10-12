import { describe, it, expect } from 'vitest';
import {
  createGame,
  createChallengeGame,
  skipInitialReroll,
  applyAction,
  getLegalActions,
} from '../src/core/engine/game';
import { logLine, LEGEND_DISPLAY_NAME } from '../src/core/engine/log';
import { fxTake, type FxEvent } from '../src/core/engine/fx';
import { virtualAttack } from '../src/core/engine/combat';
import { SKILL_HANDLERS } from '../src/core/engine/skills';
import { SeededRng } from '../src/core/rng/rng';
import { phaseBannerSegs } from '../src/ui/render';
import { toMain, driveLegendTurn } from './helpers';
import type { GameState, PlayerId } from '../src/core/model/types';

/**
 * 挑战模式 · 隔离守护。
 *
 * 目的：挑战模式是**独立模式**——它的专属结算、战报称呼、阶段横幅、对局动作、
 * 乃至"部分神器被削弱"都**不得外溢**到标准模式（也不得反向误伤挑战者自己）。
 * 这些断言是**动画/渲染改动前的护栏**：改 render/motion 后一旦外溢，这里会红。
 */

const STD = (): GameState =>
  createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['001', '002', '003'] });
const CHAL = (): GameState =>
  createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });

const isChallengeAction = (a: { t: string }): boolean =>
  a.t === 'challengeStep' || a.t === 'challengePick';

/** 传奇专属的动效旁路事件（标准模式一条都不该出现）。 */
const isLegendFx = (e: FxEvent): boolean => e.kind === 'legendRoll' || e.kind === 'legendSkill';

/** 标准局：跨回合驱动若干决策点；每一步都断言"不出现挑战专属动作/待决策/事件"，且不抛错。 */
function driveStandard(g: GameState, steps: number): void {
  skipInitialReroll(g);
  expect(fxTake().some(isLegendFx)).toBe(false);
  for (let i = 0; i < steps && g.phase !== 'gameOver'; i++) {
    const acts = getLegalActions(g);
    expect(acts.some(isChallengeAction)).toBe(false);
    expect(g.pending?.kind).not.toBe('challengePick');
    if (!acts.length) break;
    if (g.pendingAttack) applyAction(g, { t: 'block' });
    else if (g.pending) applyAction(g, acts[0]);
    else applyAction(g, acts.find((a) => a.t === 'advance') ?? acts[0]);
    expect(fxTake().some(isLegendFx)).toBe(false);
  }
}

/** 直调某个神器技能的处理函数（照卡面 key），用于验证"削弱作用在哪一侧"。 */
function runSkill(g: GameState, who: PlayerId, key: string): void {
  SKILL_HANDLERS[key].run({
    g,
    player: who,
    artifact: g.players[who].artifacts[0],
    rng: new SeededRng(1),
    params: {},
    endMainPhase: () => {},
    reportConsumed: () => {},
  });
}

describe('挑战模式 · 隔离守护（不得外溢到标准模式）', () => {
  describe('A. 模式与状态', () => {
    it('标准局：mode=standard、无 g.challenge', () => {
      const g = STD();
      expect(g.mode).toBe('standard');
      expect(g.challenge).toBeUndefined();
    });

    it('挑战局：mode=challenge、g.challenge 就位（挑战者 A / 传奇 B）', () => {
      const g = CHAL();
      expect(g.mode).toBe('challenge');
      expect(g.challenge?.cardId).toBe('Z02');
    });
  });

  describe('B. 对局动作：挑战专属永不进标准局', () => {
    it('标准局跨回合驱动 40 步：getLegalActions 无 challengeStep/challengePick，pending 不为 challengePick', () => {
      driveStandard(STD(), 40);
    });

    it('挑战局：challengeStep 只给传奇(B)；换到挑战者(A)后动作表里没有它', () => {
      const g = CHAL();
      skipInitialReroll(g);
      expect(g.activePlayer).toBe('B'); // 传奇先手
      expect(getLegalActions(g).some((a) => a.t === 'challengeStep')).toBe(true); // 正面控制
      driveLegendTurn(g);
      toMain(g);
      expect(g.activePlayer).toBe('A');
      expect(getLegalActions(g).some(isChallengeAction)).toBe(false);
    });

    it('标准局：动效旁路里没有传奇专属事件（legendRoll / legendSkill）', () => {
      const g = STD();
      skipInitialReroll(g);
      for (let i = 0; i < 30 && g.phase !== 'gameOver'; i++) {
        const acts = getLegalActions(g);
        expect(fxTake().some(isLegendFx)).toBe(false);
        if (!acts.length) break;
        if (g.pendingAttack) applyAction(g, { t: 'block' });
        else if (g.pending) applyAction(g, acts[0]);
        else applyAction(g, acts.find((a) => a.t === 'advance') ?? acts[0]);
      }
      expect(fxTake().some(isLegendFx)).toBe(false);
    });

    it('挑战局：这两种事件**确实会**出现（证明上一条不是"永远为假"的假护栏）', () => {
      const g = CHAL();
      fxTake();
      skipInitialReroll(g);
      expect(fxTake().some((e) => e.kind === 'legendRoll')).toBe(true);
      // 逐步驱动，直到出现一次 legendSkill（或回合结束）——现已能自动处理代决
      let saw = false;
      let guard = 0;
      while (g.activePlayer === 'B' && g.phase !== 'gameOver' && guard++ < 80) {
        if (fxTake().some((e) => e.kind === 'legendSkill')) {
          saw = true;
          break;
        }
        if (g.pendingAttack) applyAction(g, { t: 'block' });
        else if (g.pending?.kind === 'challengePick') applyAction(g, { t: 'challengePick', id: g.pending.options[0].id });
        else if (g.pending) break;
        else applyAction(g, { t: 'challengeStep' });
      }
      if (!saw && fxTake().some((e) => e.kind === 'legendSkill')) saw = true;
      expect(saw).toBe(true);
    });
  });

  describe('C. 战报称呼', () => {
    it('标准局仍称呼「玩家B」；挑战局 B → **卡名**「永暗之刃」（战报记具体英雄；界面口径仍是昔日传奇）', () => {
      const std = STD();
      logLine(std, '玩家B 回合开始');
      expect(std.log[std.log.length - 1]?.text).toBe('玩家B 回合开始');

      const chal = CHAL();
      logLine(chal, '玩家B 回合开始');
      const shown = chal.log[chal.log.length - 1]?.text;
      expect(shown).toBe('「永暗之刃」 回合开始');
      expect(shown).not.toContain('玩家B');
      expect(shown).not.toContain(LEGEND_DISPLAY_NAME); // 战报不再用「昔日传奇」
      // 叙述里的「昔日传奇」也换成卡名（录像口径）
      logLine(chal, '（单人挑战：跳过「昔日传奇」的那份）');
      expect(chal.log[chal.log.length - 1]?.text).toBe('（单人挑战：跳过「永暗之刃」的那份）');
    });
  });

  describe('D. 阶段横幅', () => {
    const nameOf = (p: PlayerId): string => (p === 'A' ? '玩家A' : '玩家B');

    it('标准局：换手到 main 照常弹「回合开始 + 尘起 + 主要」', () => {
      const segs = phaseBannerSegs({ active: 'A', phase: 'reroll' }, { active: 'B', phase: 'main' }, nameOf);
      expect(segs.map((s) => s.text)).toEqual(['玩家B · 回合开始', '尘起阶段', '主要阶段']);
    });

    it('挑战局传奇回合（legendActor）：只弹「回合开始」，不硬套尘起/主要', () => {
      const segs = phaseBannerSegs(
        { active: 'A', phase: 'reroll' },
        { active: 'B', phase: 'main' },
        nameOf,
        { legendActor: true },
      );
      expect(segs.map((s) => s.text)).toEqual(['玩家B · 回合开始']);
    });
  });

  describe('E. 尘落：挑战模式不存在尘落', () => {
    it('标准局会推进尘落；挑战局（传奇回合 + 挑战者回合）尘落不变', () => {
      const std = STD();
      const d0 = std.dustfall;
      skipInitialReroll(std);
      toMain(std);
      expect(std.dustfall).toBeGreaterThan(d0);

      const chal = CHAL();
      const c0 = chal.dustfall;
      skipInitialReroll(chal);
      driveLegendTurn(chal);
      toMain(chal);
      expect(chal.dustfall).toBe(c0);
    });
  });

  describe('F. 战斗口径：标准局 virtualAttack 不回归', () => {
    it('默认普通虚拟攻击（physical=false、unblockable=false、点数=Base）；显式 unblockable 仍生效', () => {
      const g = STD();
      virtualAttack(g, 'A', 3);
      expect(g.pendingAttack).toBeTruthy();
      expect(g.pendingAttack?.physical).toBe(false);
      expect(g.pendingAttack?.unblockable).toBe(false);
      expect(g.pendingAttack?.value).toBe(3);

      const g2 = STD();
      virtualAttack(g2, 'A', 3, undefined, { unblockable: true });
      expect(g2.pendingAttack?.unblockable).toBe(true);
    });
  });

  describe('G. 「削弱」按玩家分侧（不是按模式一刀切、也不误伤挑战者）', () => {
    it('028 白昼之火：挑战者(A) 无效果；传奇(B) 照常写入（它面对的是有冥想骰区的挑战者）', () => {
      const g = CHAL();
      runSkill(g, 'A', 'tianfa.bairi');
      expect(g.tianfa.A ?? null).toBeNull();
      runSkill(g, 'B', 'tianfa.bairi');
      expect(g.tianfa.B).toEqual({ blockKind: 'meditation', value: 6, damageCount: 0, key: 'tianfa.bairi' });
    });

    it('A05 深空之火：挑战者(A) 无效果（无 tianfa、无伤害加成）；传奇(B) 照常写入', () => {
      const g = CHAL();
      runSkill(g, 'A', 'tianfa.alt.shenkong');
      expect(g.tianfa.A ?? null).toBeNull();
      expect(g.players.A.buffs.some((b) => b.attr === 'attackDamage' && b.source === '深空之火')).toBe(false);

      runSkill(g, 'B', 'tianfa.alt.shenkong');
      expect(g.tianfa.B?.key).toBe('tianfa.alt.shenkong');
      expect(g.players.B.buffs.some((b) => b.attr === 'attackDamage' && b.source === '深空之火')).toBe(true);
    });

    it('标准局：同一技能两侧都正常生效（旧路径零变化）', () => {
      const g = STD();
      runSkill(g, 'A', 'tianfa.bairi');
      expect(g.tianfa.A?.key).toBe('tianfa.bairi');
      runSkill(g, 'B', 'tianfa.bairi');
      expect(g.tianfa.B?.key).toBe('tianfa.bairi');
    });
  });
});
