// 战术牌 T14「赴火」：第一次受到对方造成的伤害 → 对其造成等量真实伤害（整局 1 次）
import { describe, it, expect } from 'vitest';
import { createGame, skipInitialReroll } from '../src/core/engine/game';
import { finalizeAttackResolution, dealTrueDamage } from '../src/core/engine/combat';
import { TACTIC_POOL } from '../src/core/content/tactics';
import type { GameState, PendingAttack } from '../src/core/model/types';

const mk = (): GameState => {
  const g = createGame({
    seed: 1,
    firstPlayer: 'A',
    heroA: ['001', '002', '003'],
    heroB: ['001', '002', '003'],
    tacticA: 'T14',
    tacticB: 'T04',
  });
  skipInitialReroll(g);
  g.phase = 'main';
  g.players.A.life = 50;
  g.players.B.life = 50;
  return g;
};
const atkByB = (value: number): PendingAttack => ({ attacker: 'B', value, unblockable: false, physical: true });

describe('T14「赴火」', () => {
  it('第一次受到对方造成的攻击伤害 → 反弹等量真实伤害（且只一次）', () => {
    const g = mk();
    finalizeAttackResolution(g, atkByB(5), false);
    expect(g.players.A.life).toBe(45);
    expect(g.players.B.life).toBe(45); // 反弹 5 点真伤给 B
    expect(g.players.A.tacticOnceUsed).toBe(true);
    // 第二次受到伤害 → 不再反弹
    finalizeAttackResolution(g, atkByB(3), false);
    expect(g.players.A.life).toBe(42);
    expect(g.players.B.life).toBe(45);
  });

  it('第一次受到对方造成的真实伤害 → 反弹', () => {
    const g = mk();
    dealTrueDamage(g, 'A', 4, 'B');
    expect(g.players.A.life).toBe(46);
    expect(g.players.B.life).toBe(46);
    expect(g.players.A.tacticOnceUsed).toBe(true);
  });

  it('自伤（source===target）不触发', () => {
    const g = mk();
    dealTrueDamage(g, 'A', 4, 'A');
    expect(g.players.A.life).toBe(46);
    expect(g.players.B.life).toBe(50); // 不反弹
    expect(g.players.A.tacticOnceUsed).toBe(false);
  });

  it('若该伤害打死持有者（游戏结束）→ 不反弹', () => {
    const g = mk();
    g.players.A.life = 3;
    finalizeAttackResolution(g, atkByB(5), false);
    expect(g.phase).toBe('gameOver');
    expect(g.players.A.life).toBeLessThanOrEqual(0);
    expect(g.players.B.life).toBe(50); // 未反弹
  });

  it('初始生命修正：对方 −3', () => {
    const base = createGame({ seed: 1, firstPlayer: 'A' });
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T14', tacticB: 'T04' });
    expect(g.players.B.life).toBe(base.players.B.life - 3);
    expect(g.players.B.lifeMax).toBe(base.players.B.lifeMax - 3);
  });

  it('TACTIC_POOL 含 T14', () => {
    expect(TACTIC_POOL).toContain('T14');
  });
});
