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
    unblockable: g.unblockableThisTurn,
    physical: true,
    sourceDieId: dieId,
    sourceValue: die.value,
  };
}

/** 技能发起的“虚拟”攻击（非实体攻击骰） */
export function virtualAttack(g: GameState, player: PlayerId, baseValue: number): void {
  g.pendingAttack = {
    attacker: player,
    value: baseValue + attackDamageBuff(g, player),
    unblockable: g.unblockableThisTurn,
    physical: false,
  };
}

/** 结算待处理攻击：给出防御骰=抵挡（无伤害）；不给/不可抵挡=造成伤害 */
export function resolveBlock(g: GameState, blockDieId?: string): void {
  const pa = g.pendingAttack;
  if (!pa) throw new Error('no pending attack');
  const defenderId: PlayerId = pa.attacker === 'A' ? 'B' : 'A';
  const defender = g.players[defenderId];
  let blocked = false;
  if (!pa.unblockable && blockDieId) {
    const die = defender.areas.defense.find((d) => d.id === blockDieId);
    if (!die) throw new Error(`not a defense die: ${blockDieId}`);
    removeDie(g, defenderId, blockDieId);
    blocked = true;
  } else {
    defender.life -= pa.value;
    checkLifeEnd(g);
  }
  g.pendingAttack = null;
  if (g.phase === 'gameOver') return;

  if (blocked) {
    // 锋芒·触发：你的攻击被防御骰抵挡后
    if (hasActiveSkill(g.players[pa.attacker], 'buxiang.fengmang.trigger')) {
      g.pending = { kind: 'fengmang', player: pa.attacker, defenderId, value: pa.value };
    }
  } else if (pa.physical && pa.sourceDieId !== undefined && pa.sourceValue !== undefined) {
    // 裁雨流：当你使用攻击骰造成伤害后
    if (hasActiveSkill(g.players[pa.attacker], 'yuqie.caiyuliu') && g.caiyuliuUsed < 3) {
      g.pending = { kind: 'caiyuliu', player: pa.attacker, dieId: pa.sourceDieId, value: pa.sourceValue };
    }
  }
}

/** 真实伤害：不可被防御骰抵挡，直接扣血 */
export function dealTrueDamage(g: GameState, target: PlayerId, amount: number): void {
  g.players[target].life -= amount;
  checkLifeEnd(g);
}
