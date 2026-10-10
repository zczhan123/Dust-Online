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

  it('有槽但驱动骰不够 → 跳过（确定性：龙腾万丈 需 3 颗 2/5，只给 1 颗）', () => {
    const g = make('Z01');
    skipInitialReroll(g);
    g.challenge!.resumeAt = 3; // z01-3 龙腾万丈
    g.challenge!.driven = [
      { id: 'd1', value: 1, kind: 'meditation' as const },
      { id: 'd2', value: 2, kind: 'meditation' as const },
    ];
    applyAction(g, { t: 'challengeStep' });
    const t = g.log.map((l) => l.text).join('\n');
    expect(t).toContain('「雨中剑圣」：龙腾万丈 — 驱动骰不足，跳过');
  });

  it('怜悯*：传奇第一回合跳过该条（Z01「断斩一斩」）', () => {
    const g = make('Z01');
    skipInitialReroll(g);
    driveLegendTurn(g);
    const t = g.log.map((l) => l.text).join('\n');
    expect(t).toContain('「雨中剑圣」：断斩一斩 — 首次回合（怜悯*），跳过');
  });

  it('∞ 发动检查（无骰条件）：龙游万象驱动无 1/6 → 无效果，跳过', () => {
    const g = make('Z01');
    skipInitialReroll(g);
    g.challenge!.resumeAt = 1; // z01-1 龙游万象（∞）
    g.challenge!.driven = [{ id: 'd1', value: 3, kind: 'meditation' }];
    applyAction(g, { t: 'challengeStep' });
    expect(g.log.map((l) => l.text).join('\n')).toContain('「雨中剑圣」：龙游万象 — 无效果（条件不满足），跳过');
  });

  it('∞ 发动检查（无骰条件）：拔城本回合已发动过震荡斩击 → 无效果，跳过', () => {
    const g = make('Z03');
    skipInitialReroll(g);
    g.challenge!.resumeAt = 5; // z03-5 拔城（∞）
    g.challenge!.firedThisTurn = ['z03-2'];
    applyAction(g, { t: 'challengeStep' });
    expect(g.log.map((l) => l.text).join('\n')).toContain('「孤塔之王」：拔城 — 无效果（条件不满足），跳过');
  });

  it('∞ 发动检查：统御战场攻击骰**全是 1**（改成 1 是空操作）→ 跳过、不弹名', () => {
    const g = make('Z03');
    skipInitialReroll(g);
    g.challenge!.resumeAt = 1; // z03-1 统御战场（∞）
    g.players.A.areas.attack = [{ id: 'a1', value: 1, kind: 'attack' as const }];
    applyAction(g, { t: 'challengeStep' });
    expect(g.log.map((l) => l.text).join('\n')).toContain('「孤塔之王」：统御战场 — 无效果（条件不满足），跳过');
  });

  it('∞ 发动检查：统御战场存在点数 ≠ 1 的攻击骰 → 发动（不写"无效果"）', () => {
    const g = make('Z03');
    skipInitialReroll(g);
    g.challenge!.resumeAt = 1;
    g.players.A.areas.attack = [{ id: 'a1', value: 3, kind: 'attack' as const }];
    applyAction(g, { t: 'challengeStep' });
    expect(g.log.map((l) => l.text).join('\n')).not.toContain('统御战场 — 无效果');
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
