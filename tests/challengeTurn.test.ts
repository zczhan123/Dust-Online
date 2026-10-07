import { describe, it, expect } from 'vitest';
import { createChallengeGame, skipInitialReroll, applyAction } from '../src/core/engine/game';

const make = (cardId = 'Z02') =>
  createChallengeGame({ seed: 1, cardId, challenger: ['001', '002', '003'] });

describe('挑战模式 · 传奇回合骨架', () => {
  it('建局后轮到传奇：它把回合跑到最后并交还挑战者；驱动骰清空、传奇回合数 +1', () => {
    const g = make();
    skipInitialReroll(g); // 挑战者做完初始重掷 → 紧接着就是传奇的第一个回合
    // 传奇回合可能在某次攻击处停下等挑战者响应 → 逐段"不抵挡"把它跑完
    let guard = 0;
    while (g.activePlayer === 'B' && guard++ < 30) applyAction(g, { t: 'block' });
    expect(g.activePlayer).toBe('A');
    expect(g.challenge!.driven).toEqual([]);
    expect(g.challenge!.turn).toBe(1);
  });

  it('Z02 首回合：投 8 个驱动骰、六条按顺序全部走到；无槽/∞ 条必执行', () => {
    const g = make();
    skipInitialReroll(g);
    const t = g.log.map((l) => l.text).join('\n');
    expect(t).toContain('投掷 8 个驱动骰');
    // 按箭头顺序六条都走到（执行或跳过都算"走到"）
    for (const name of ['回合开始', '锋芒', '葬敌的完杀', '暗夜凶神', '枭首', '遁入暗影']) {
      expect(t).toContain(`「永暗之刃」：${name}`);
    }
    // 「锋芒」无槽 → 必执行（该行不以"跳过"结尾）
    expect(t).toContain('「永暗之刃」：锋芒\n');
  });

  it('有槽但驱动骰不够 → 跳过（Z01 未登记 rollDice → 0 个驱动骰）', () => {
    const g = make('Z01');
    skipInitialReroll(g);
    const t = g.log.map((l) => l.text).join('\n');
    expect(t).toContain('「雨中剑圣」：龙腾万丈 — 驱动骰不足，跳过');
    expect(t).toContain('「雨中剑圣」：裁雨流'); // 无槽 → 必执行
  });

  it('怜悯*：传奇第一回合跳过该条（Z01「断斩一斩」）', () => {
    const g = make('Z01');
    skipInitialReroll(g);
    const t = g.log.map((l) => l.text).join('\n');
    expect(t).toContain('「雨中剑圣」：断斩一斩 — 首次回合（怜悯*），跳过');
  });
});
