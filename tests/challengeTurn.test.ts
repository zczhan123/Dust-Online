import { describe, it, expect } from 'vitest';
import { createChallengeGame, skipInitialReroll, applyAction } from '../src/core/engine/game';
import { driveLegendTurn } from './helpers';

const make = (cardId = 'Z02') =>
  createChallengeGame({ seed: 1, cardId, challenger: ['001', '002', '003'] });

describe('挑战模式 · 传奇回合骨架', () => {
  it('建局后轮到传奇：投完驱动骰**先停一下**（骰子在临时驱动骰区域），逐条推进后交还挑战者', () => {
    const g = make();
    skipInitialReroll(g); // 挑战者做完初始重掷 → 紧接着就是传奇的第一个回合
    // 停在"投完骰、等界面逐条推进"处
    expect(g.activePlayer).toBe('B');
    expect(g.challenge!.resumeAt).toBe(1);
    expect(g.challenge!.driven).toHaveLength(8);
    expect(g.challenge!.slot).toEqual([]);
    // 逐条推进到结束
    driveLegendTurn(g);
    expect(g.activePlayer).toBe('A');
    expect(g.challenge!.driven).toEqual([]);
    expect(g.challenge!.slot).toEqual([]);
    expect(g.challenge!.turn).toBe(1);
  });

  it('Z02 首回合：投 8 个驱动骰、六条按顺序全部走到；无槽/∞ 条必执行', () => {
    const g = make();
    skipInitialReroll(g);
    driveLegendTurn(g);
    const t = g.log.map((l) => l.text).join('\n');
    expect(t).toContain('投掷 8 个驱动骰');
    for (const name of ['回合开始', '锋芒', '葬敌的完杀', '暗夜凶神', '枭首', '遁入暗影']) {
      expect(t).toContain(`「永暗之刃」：${name}`);
    }
    expect(t).toContain('「永暗之刃」：锋芒\n'); // 无槽 → 必执行（该行不以"跳过"结尾）
  });

  it('有槽但驱动骰不够 → 跳过（Z01 未登记 rollDice → 0 个驱动骰）', () => {
    const g = make('Z01');
    skipInitialReroll(g);
    driveLegendTurn(g);
    const t = g.log.map((l) => l.text).join('\n');
    expect(t).toContain('「雨中剑圣」：龙腾万丈 — 驱动骰不足，跳过');
    expect(t).toContain('「雨中剑圣」：裁雨流'); // 无槽 → 必执行
  });

  it('怜悯*：传奇第一回合跳过该条（Z01「断斩一斩」）', () => {
    const g = make('Z01');
    skipInitialReroll(g);
    driveLegendTurn(g);
    const t = g.log.map((l) => l.text).join('\n');
    expect(t).toContain('「雨中剑圣」：断斩一斩 — 首次回合（怜悯*），跳过');
  });

  it('逐条推进：每次 challengeStep 只走"一条真正要执行的技能"', () => {
    const g = make();
    skipInitialReroll(g);
    expect(g.challenge!.activeSkill).toBe(0); // 停在「回合开始」
    applyAction(g, { t: 'challengeStep' }); // 走第一条（完杀：可能跳过）
    // 每步之后必须仍停在传奇回合、且 resumeAt 有推进（除非已交还）
    if (g.activePlayer === 'B') {
      expect(g.challenge!.resumeAt).not.toBeNull();
      expect(g.challenge!.activeSkill).not.toBeNull();
    }
  });
});
