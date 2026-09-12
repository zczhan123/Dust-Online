import type { GameState, PlayerId } from '../model/types';
import { hasActiveSkill } from './skill-state';

export function attackDamageBuff(g: GameState, player: PlayerId): number {
  const p = g.players[player];
  const adds = p.buffs.filter((b) => b.attr === 'attackDamage').map((b) => b.add);
  const buffMax = adds.length ? Math.max(...adds) : 0;
  const fengmang = hasActiveSkill(p, 'buxiang.fengmang')
    ? p.artifacts.find((a) => a.id === '004')?.count ?? 0
    : 0;
  return Math.max(buffMax, fengmang);
}

function removeDie(g: GameState, player: PlayerId, dieId: string): void {
  const p = g.players[player];
  for (const kind of ['attack', 'defense', 'meditation'] as const) {
    p.areas[kind] = p.areas[kind].filter((d) => d.id !== dieId);
  }
}

export function checkLifeEnd(g: GameState): void {
  if (g.phase === 'gameOver') return;
  const a = g.players.A.life;
  const b = g.players.B.life;
  if (a <= 0 && b <= 0) {
    g.phase = 'gameOver';
    g.winner = g.activePlayer;
  } else if (a <= 0) {
    g.phase = 'gameOver';
    g.winner = 'B';
  } else if (b <= 0) {
    g.phase = 'gameOver';
    g.winner = 'A';
  }
}

/** 使用 1 个攻击骰发起攻击：消耗该骰，产生待结算攻击（伤害=点数+攻击伤害加成） */
export function doAttack(g: GameState, player: PlayerId, dieId: string): void {
  if (g.pendingAttack) throw new Error('pending attack unresolved');
  const die = g.players[player].areas.attack.find((d) => d.id === dieId);
  if (!die) throw new Error(`not an attack die: ${dieId}`);
  removeDie(g, player, dieId);
  g.pendingAttack = {
    attacker: player,
    value: die.value + attackDamageBuff(g, player),
    unblockable: false,
    physical: true,
    sourceDieId: dieId,
    sourceValue: die.value,
  };
}

/** 结算待处理攻击：给出防御骰=抵挡（无伤害）；不给/不可抵挡=造成伤害 */
export function resolveBlock(g: GameState, blockDieId?: string): void {
  const pa = g.pendingAttack;
  if (!pa) throw new Error('no pending attack');
  const defenderId: PlayerId = pa.attacker === 'A' ? 'B' : 'A';
  const defender = g.players[defenderId];
  if (!pa.unblockable && blockDieId) {
    const die = defender.areas.defense.find((d) => d.id === blockDieId);
    if (!die) throw new Error(`not a defense die: ${blockDieId}`);
    removeDie(g, defenderId, blockDieId);
  } else {
    defender.life -= pa.value;
    checkLifeEnd(g);
  }
  g.pendingAttack = null;
}

/** 真实伤害：不可被防御骰抵挡，直接扣血 */
export function dealTrueDamage(g: GameState, target: PlayerId, amount: number): void {
  g.players[target].life -= amount;
  checkLifeEnd(g);
}
