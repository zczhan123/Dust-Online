import { describe, it, expect } from 'vitest';
import { createChallengeGame } from '../src/core/engine/game';
import { settleAttack } from '../src/core/engine/combat';
import { fxTake } from '../src/core/engine/fx';
import type { GameState } from '../src/core/model/types';

/**
 * **跨卡门禁**：Z 卡的「独立钩子」必须按**当前传奇卡**判定，不能只看 `mode==='challenge'` + 某个**共享状态**。
 *
 * 真实事故 2026-10-12：与 **Z02「永暗之刃」** 对战时，挑战者用 6 点攻击命中，竟触发了 **Z07「荒野行者」的「围攻」**
 * （取消伤害 + 扣了永暗之刃的计数）——因为围攻当时只判了 `mode==='challenge'` + `challenge.count>0`，
 * 而 Z02 **也有计数**（锋芒 X / 暗夜凶神 +1）。修法＝`challenge.ts` 的 **`legendHasSkill(g, skillId)`**。
 */
const chal = (cardId: string): GameState =>
  createChallengeGame({ seed: 1, cardId, challenger: ['001', '002', '003'] });

describe('挑战模式 · 跨卡门禁（Z 卡独立钩子必须按卡判定）', () => {
  it('打 Z02「永暗之刃」（也有计数）时，挑战者 6 点攻击**不**触发 Z07「围攻」', () => {
    const g = chal('Z02');
    g.challenge!.count = 2; // 永暗之刃的计数（锋芒/暗夜凶神）
    g.players.B.life = 30;
    const life0 = g.players.B.life;
    fxTake();
    settleAttack(
      g,
      { attacker: 'A', value: 6, baseValue: 6, sourceValue: 6, unblockable: false, physical: true },
      { blocked: false, blockedForTriggers: false, damageDealt: 6, applyDamage: true },
    );
    expect(g.players.B.life).toBe(life0 - 6); // ★ 伤害照常落下
    expect(g.challenge!.count).toBe(2); // ★ 计数不被扣
    expect(g.log.some((l) => l.text.includes('围攻'))).toBe(false); // ★ 无「围攻」日志
    expect(fxTake().some((e) => e.kind === 'legendSkill' && e.skillKey === 'z07-x')).toBe(false); // ★ 不弹名
  });

  it('打 Z07「荒野行者」时，同样的 6 点攻击**照常**触发围攻（别改坏）', () => {
    const g = chal('Z07');
    g.challenge!.count = 2;
    g.players.B.life = 30;
    const life0 = g.players.B.life;
    settleAttack(
      g,
      { attacker: 'A', value: 6, baseValue: 6, sourceValue: 6, unblockable: false, physical: true },
      { blocked: false, blockedForTriggers: false, damageDealt: 6, applyDamage: true },
    );
    expect(g.players.B.life).toBe(life0); // 取消伤害
    expect(g.challenge!.count).toBe(1); // 计数 −1
    expect(g.log.some((l) => l.text.includes('围攻') && l.text.includes('荒野行者'))).toBe(true);
  });

  it('打 Z02 时，挑战者发起的「裁雨流」攻击**不**污染 Z01 的"前 3 次"计数、也**不**把骰搬进传奇防御区', () => {
    const g = chal('Z02');
    g.players.A.areas.attack = [{ id: 'ax', value: 5, kind: 'attack' }];
    g.players.B.areas.defense = [];
    settleAttack(
      g,
      {
        attacker: 'A',
        value: 5,
        baseValue: 5,
        sourceValue: 5,
        sourceDieId: 'ax',
        sourceSkill: '裁雨流',
        unblockable: false,
        physical: true,
      },
      { blocked: false, blockedForTriggers: false, damageDealt: 5, applyDamage: true },
    );
    expect(g.challenge!.caiyuliuHits ?? 0).toBe(0); // ★ 未被污染（Z02 里没有 Z01 的"前 3 次"）
    expect(g.players.B.areas.defense).toHaveLength(0); // ★ 没搬进**传奇**的防御骰区
  });
});
