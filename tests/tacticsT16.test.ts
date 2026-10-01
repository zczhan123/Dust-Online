// 战术牌 T16「潜伏」（全局）：双方各自的第一个回合不能攻击；各自的第二个回合攻击 +1
import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll, getLegalActions } from '../src/core/engine/game';
import { attackDamageBonus, virtualAttack, doAttack } from '../src/core/engine/combat';
import { TACTIC_POOL } from '../src/core/content/tactics';
import type { GameState } from '../src/core/model/types';

const mk = (): GameState => {
  const g = createGame({
    seed: 1,
    firstPlayer: 'A',
    heroA: ['001', '002', '003'],
    heroB: ['001', '002', '003'],
    tacticA: 'T16',
    tacticB: 'T04',
  });
  skipInitialReroll(g);
  g.phase = 'main';
  return g;
};

describe('T16「潜伏」', () => {
  it('第一个回合：不产出 attack 动作；直接发 attack 抛错', () => {
    const g = mk();
    g.players.A.areas.attack = [{ id: 'a', value: 5, kind: 'attack' }];
    expect(getLegalActions(g).some((a) => a.t === 'attack')).toBe(false);
    expect(() => applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a'] }] })).toThrow();
  });

  it('全局：A 持 T16，B 的第一个回合也不能攻击', () => {
    const g = mk();
    g.activePlayer = 'B';
    g.players.B.areas.attack = [{ id: 'b', value: 5, kind: 'attack' }];
    expect(getLegalActions(g).some((a) => a.t === 'attack')).toBe(false);
  });

  it('技能发起的攻击/虚拟攻击同样被禁（第一回合）', () => {
    const g = mk();
    virtualAttack(g, 'A', 5, { skill: '不败之王', owner: 'A' });
    expect(g.pendingAttack ?? null).toBeNull();
    doAttack(g, 'A', [{ dieIds: [] }]); // 守卫在支付前返回
    expect(g.pendingAttack ?? null).toBeNull();
  });

  it('第二个回合：自己回合的攻击 +1', () => {
    const g = mk();
    g.activePlayer = 'A';
    g.firstRound.A = false;
    g.players.A.turnsTaken = 2;
    expect(attackDamageBonus(g, 'A')).toEqual({ value: 1, label: '潜伏' });
    g.players.A.turnsTaken = 3;
    expect(attackDamageBonus(g, 'A').value).toBe(0);
  });

  it('初始生命修正：对方 −2', () => {
    const base = createGame({ seed: 1, firstPlayer: 'A' });
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T16', tacticB: 'T04' });
    expect(g.players.B.life).toBe(base.players.B.life - 2);
    expect(g.players.B.lifeMax).toBe(base.players.B.lifeMax - 2);
  });

  it('TACTIC_POOL 含 T16', () => {
    expect(TACTIC_POOL).toContain('T16');
  });
});
