import { describe, it, expect } from 'vitest';
import { setupGame } from '../src/core/engine/setup';
import { doAttack, resolveBlock, dealTrueDamage } from '../src/core/engine/combat';
import { totalDice } from '../src/core/engine/derive';

describe('combat', () => {
  it('attack creates a pending attack with the die value and consumes the die', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    const die = g.players.A.areas.attack[0];
    const before = totalDice(g.players.A);
    doAttack(g, 'A', die.id);
    expect(g.pendingAttack).toMatchObject({
      attacker: 'A',
      value: die.value,
      unblockable: false,
      physical: true,
      sourceDieId: die.id,
      sourceValue: die.value,
    });
    expect(totalDice(g.players.A)).toBe(before - 1);
  });

  it('blocking prevents damage and consumes the defense die', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    const atk = g.players.A.areas.attack[0];
    doAttack(g, 'A', atk.id);
    const def = g.players.B.areas.defense[0];
    const before = g.players.B.life;
    resolveBlock(g, def.id);
    expect(g.players.B.life).toBe(before);
    expect(g.pendingAttack).toBeNull();
  });

  it('not blocking deals damage equal to the attack value', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    const atk = g.players.A.areas.attack[0];
    doAttack(g, 'A', atk.id);
    const value = g.pendingAttack!.value;
    const before = g.players.B.life;
    resolveBlock(g);
    expect(g.players.B.life).toBe(before - value);
  });

  it('logs a readable damage line', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    const atk = g.players.A.areas.attack[0];
    doAttack(g, 'A', atk.id);
    resolveBlock(g);
    const text = g.log.map((l) => l.text).join('\n');
    expect(text).toContain('玩家A 使用');
    expect(text).toContain('玩家B 未抵挡');
    expect(text).toContain('生命');
  });

  it('true damage ignores defense dice', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    const before = g.players.B.life;
    dealTrueDamage(g, 'B', 7);
    expect(g.players.B.life).toBe(before - 7);
  });

  it('ends the game when life reaches 0', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    dealTrueDamage(g, 'B', 50);
    expect(g.phase).toBe('gameOver');
    expect(g.winner).toBe('A');
  });

  it('does not allow a second attack while one is pending', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    g.players.A.areas.attack.push({ id: 'x1', value: 3, kind: 'attack' });
    g.players.A.areas.attack.push({ id: 'x2', value: 4, kind: 'attack' });
    doAttack(g, 'A', 'x1');
    expect(() => doAttack(g, 'A', 'x2')).toThrow();
  });
});

import { attackDamageBuff } from '../src/core/engine/combat';

describe('锋芒 continuous', () => {
  it('adds 不祥 count as attack damage when active right', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    const buxiang = g.players.B.artifacts.find((a) => a.id === '004')!;
    expect(attackDamageBuff(g, 'B')).toBe(0);
    buxiang.activeMarkerSide = 'right';
    buxiang.count = 2;
    expect(attackDamageBuff(g, 'B')).toBe(2);
  });
  it('takes the max of buff and 锋芒 (golden rule)', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    const buxiang = g.players.B.artifacts.find((a) => a.id === '004')!;
    buxiang.activeMarkerSide = 'right';
    buxiang.count = 2;
    g.players.B.buffs.push({ attr: 'attackDamage', add: 5, duration: 'thisTurn' });
    expect(attackDamageBuff(g, 'B')).toBe(5);
  });
});
