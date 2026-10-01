// 战术牌 T09「慈悲」：将造成的伤害 → 可取消并回复等量生命（整局 1 次；含真实伤害）
import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll } from '../src/core/engine/game';
import { finalizeAttackResolution, dealTrueDamage } from '../src/core/engine/combat';
import { TACTIC_POOL } from '../src/core/content/tactics';
import type { GameState, PendingAttack } from '../src/core/model/types';

const mk = (): GameState => {
  const g = createGame({
    seed: 1,
    firstPlayer: 'A',
    heroA: ['001', '002', '003'],
    heroB: ['001', '002', '003'],
    tacticA: 'T09',
    tacticB: 'T03',
  });
  skipInitialReroll(g);
  g.phase = 'main';
  g.activePlayer = 'A';
  return g;
};
const atk = (value: number): PendingAttack => ({ attacker: 'A', value, unblockable: false, physical: true });

describe('T09「慈悲」', () => {
  it('攻击伤害：可取消并回复等量生命（整局 1 次）', () => {
    const g = mk();
    g.players.A.life = 20;
    g.players.A.lifeMax = 50;
    g.players.B.life = 40;
    finalizeAttackResolution(g, atk(5), false);
    expect(g.pending?.kind).toBe('ciBei');
    applyAction(g, { t: 'ciBei', accept: true });
    expect(g.players.B.life).toBe(40); // 伤害被取消
    expect(g.players.A.life).toBe(25); // 回复 5
    expect(g.players.A.tacticOnceUsed).toBe(true);
  });

  it('攻击伤害：不发动 → 照常造成伤害', () => {
    const g = mk();
    g.players.A.life = 20;
    g.players.A.lifeMax = 50;
    g.players.B.life = 40;
    finalizeAttackResolution(g, atk(5), false);
    applyAction(g, { t: 'ciBei', accept: false });
    expect(g.players.B.life).toBe(35);
    expect(g.players.A.life).toBe(20);
    expect(g.players.A.tacticOnceUsed).toBe(false);
  });

  it('真实伤害：可取消并回复等量生命', () => {
    const g = mk();
    g.players.A.life = 20;
    g.players.A.lifeMax = 50;
    g.players.B.life = 40;
    dealTrueDamage(g, 'B', 4, 'A');
    expect(g.pending?.kind).toBe('ciBei');
    applyAction(g, { t: 'ciBei', accept: true });
    expect(g.players.B.life).toBe(40);
    expect(g.players.A.life).toBe(24);
    expect(g.players.A.tacticOnceUsed).toBe(true);
  });

  it('真实伤害：不发动 → 照常造成伤害', () => {
    const g = mk();
    g.players.B.life = 40;
    dealTrueDamage(g, 'B', 4, 'A');
    applyAction(g, { t: 'ciBei', accept: false });
    expect(g.players.B.life).toBe(36);
  });

  it('整局 1 次：用过后不再弹出，伤害照常', () => {
    const g = mk();
    g.players.A.tacticOnceUsed = true;
    g.players.B.life = 40;
    dealTrueDamage(g, 'B', 4, 'A');
    expect(g.pending ?? null).toBeNull();
    expect(g.players.B.life).toBe(36);
  });

  it('自伤（source===target）不触发', () => {
    const g = mk();
    g.players.A.life = 40;
    dealTrueDamage(g, 'A', 4, 'A');
    expect(g.pending ?? null).toBeNull();
    expect(g.players.A.life).toBe(36);
  });
});

describe('战术牌池含 T09', () => {
  it('TACTIC_POOL 含 T09', () => {
    expect(TACTIC_POOL).toContain('T09');
  });
});
