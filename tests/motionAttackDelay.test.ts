import { describe, it, expect, afterEach } from 'vitest';
import {
  MOTION,
  attackWatchDelay,
  moveFxDuration,
  removalGroupMs,
  setMotionSpeed,
  type DiceMoveFx,
} from '../src/ui/motion';

/**
 * `attackWatchDelay` = 攻击骰要等多久才起步（1v1 与 2v2 共用的唯一口径）。
 * 2v2 曾写死 `costDur: 0` → 影袭的灰骰和玩家色骰同时飞出（重影）。
 * 这个测试锁住公式本身，防止有人再把它退回字面量。
 */
describe('attackWatchDelay（攻击等待时长唯一口径）', () => {
  afterEach(() => setMotionSpeed(1));

  const emptyFx: DiceMoveFx = { moveIds: [], fromCard: [], hanguangs: [] };
  const movingFx: DiceMoveFx = { moveIds: ['m1', 'm2'], fromCard: [], hanguangs: [] };

  it('没有任何代价、没有搬家、没有上一段 → 0', () => {
    expect(attackWatchDelay({})).toBe(0);
    expect(attackWatchDelay({ costPresent: false, diceFx: emptyFx })).toBe(0);
  });

  it('纯移动（无代价骰）：等"搬家组"播完', () => {
    expect(moveFxDuration(movingFx)).toBeGreaterThan(0);
    expect(attackWatchDelay({ diceFx: movingFx })).toBe(moveFxDuration(movingFx));
  });

  it('纯代价骰（无搬家）：等"消耗组"播完', () => {
    expect(removalGroupMs()).toBeGreaterThan(0);
    expect(attackWatchDelay({ costPresent: true })).toBe(removalGroupMs());
  });

  it('多段串行：上一段收尾时长直接相加', () => {
    expect(attackWatchDelay({ costPresent: true, resolveDur: 700 })).toBe(700 + removalGroupMs());
  });

  it('代价组与搬家组取较大者（不并起叠加）', () => {
    const watch = attackWatchDelay({ costPresent: true, diceFx: movingFx });
    expect(watch).toBe(Math.max(removalGroupMs(), moveFxDuration(movingFx)));
  });

  it('额外延迟（挑战模式"先出骰后攻击"）相加', () => {
    expect(attackWatchDelay({ costPresent: true, extraDelay: 1200 })).toBe(removalGroupMs() + 1200);
  });

  it('时长只受 setMotionSpeed 控制（唯一换算点）', () => {
    const normal = attackWatchDelay({ costPresent: true });
    setMotionSpeed(2);
    const fast = attackWatchDelay({ costPresent: true });
    expect(fast).toBeLessThan(normal);
    expect(fast).toBe(
      Math.max(40, Math.round(MOTION.move / 2)) +
        Math.max(40, Math.round(MOTION.hold / 2)) +
        Math.max(40, Math.round(MOTION.fade / 2)),
    );
  });
});
