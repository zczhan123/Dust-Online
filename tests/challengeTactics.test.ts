import { describe, it, expect } from 'vitest';
import { createChallengeGame, skipInitialReroll } from '../src/core/engine/game';
import { attacksBanned, virtualAttack, pumpAttackQueue, attackDamageBonus } from '../src/core/engine/combat';
import { driveLegendTurn } from './helpers';
import type { GameState } from '../src/core/model/types';

const base = (cardId = 'Z01'): GameState =>
  createChallengeGame({ seed: 1, cardId, challenger: ['001', '002', '003'] });
const withTactic = (tactic: string, cardId = 'Z01'): GameState =>
  createChallengeGame({ seed: 1, cardId, challenger: ['001', '002', '003'], tactic });

describe('挑战模式 · 战术牌 · 初始生命修正（增/减都生效）', () => {
  it('T03 顽强（+6 自身）→ 挑战者生命/上限 +6', () => {
    const b = base();
    const g = withTactic('T03');
    expect(g.players.A.life).toBe(b.players.A.life + 6);
    expect(g.players.A.lifeMax).toBe(b.players.A.lifeMax + 6);
  });

  it('T16 潜伏（−2 对方）→ **传奇 B** 生命/上限 −2', () => {
    const b = base();
    const g = withTactic('T16');
    expect(g.players.B.life).toBe(b.players.B.life - 2);
    expect(g.players.B.lifeMax).toBe(b.players.B.lifeMax - 2);
  });

  it('T02 先机（生命 −2 照吃）：传奇 B 生命 −2', () => {
    const b = base();
    const g = withTactic('T02');
    expect(g.players.B.life).toBe(b.players.B.life - 2);
  });

  it('无战术牌：生命不变', () => {
    const g = base();
    const b = base();
    expect(g.players.A.life).toBe(b.players.A.life);
    expect(g.players.B.life).toBe(b.players.B.life);
  });
});

describe('挑战模式 · T02「先机」削弱（生命照吃、定先手无效）', () => {
  it('不弹"定先手"待决策；先手仍是传奇(B)；战报写明效果无效', () => {
    const g = withTactic('T02');
    expect(g.pending).toBeNull();
    expect(g.firstPlayer).toBe('B'); // 先手仍归传奇
    expect(g.log.map((l) => l.text).some((t) => t.includes('先机') && t.includes('无效'))).toBe(true);
  });
});

describe('挑战模式 · T16「潜伏」（影响传奇）', () => {
  it('传奇第一个回合：`attacksBanned` 为真（实体+虚拟攻击都被拦）', () => {
    const g = withTactic('T16');
    skipInitialReroll(g); // 结束初始重掷 → 传奇首个回合
    expect(g.activePlayer).toBe('B');
    expect(attacksBanned(g)).toBe(true);
    virtualAttack(g, 'B', 5, { skill: '测试', owner: 'B' });
    expect(g.pendingAttack).toBeNull(); // 虚拟攻击被禁（不产生待结算攻击）
  });

  it('被禁时 `pumpAttackQueue` 一次性清空多段队列（防回合卡死/白等）', () => {
    const g = withTactic('T16');
    g.virtualQueue = [
      { attacker: 'B', value: 5, label: '测试', owner: 'B' },
      { attacker: 'B', value: 5, label: '测试', owner: 'B' },
    ];
    pumpAttackQueue(g);
    expect(g.virtualQueue).toBeNull();
    expect(g.pendingAttack).toBeNull();
  });

  it('无 T16 时：传奇首回合不封攻击', () => {
    const g = base();
    expect(attacksBanned(g)).toBe(false);
  });

  it('传奇第二个回合：攻击伤害 +1（「潜伏」；传奇 turnsTaken 已能递增）', () => {
    const g = withTactic('T16', 'Z07');
    skipInitialReroll(g);
    driveLegendTurn(g); // 走完传奇第一个回合
    expect(g.players.B.turnsTaken).toBe(1);
    // 手工推进到"传奇第二回合"：置 activePlayer=B + turnsTaken=2 + 非首回合
    g.activePlayer = 'B';
    g.firstRound.B = false;
    g.players.B.turnsTaken = 2;
    expect(attackDamageBonus(g, 'B').value).toBe(1); // 「潜伏」+1
  });
});
