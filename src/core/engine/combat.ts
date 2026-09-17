import type { Artifact, GameState, PlayerId, PlayerState } from '../model/types';
import { hasActiveSkill } from './skill-state';
import { paySlots, type SlotFill } from './effects';
import { logLine, pname } from './log';

/** 按技能 key 找到拥有它的神器（避免硬编码神器编号） */
export function artifactWithSkill(p: PlayerState, key: string): Artifact | undefined {
  return p.artifacts.find((a) => a.skills.some((s) => s.key === key));
}

export function attackDamageBuff(g: GameState, player: PlayerId): number {
  const p = g.players[player];
  const adds = p.buffs.filter((b) => b.attr === 'attackDamage').map((b) => b.add);
  const buffMax = adds.length ? Math.max(...adds) : 0;
  // 004 锋芒（持续）：攻击伤害 + 淬炼计数
  const fmArt = artifactWithSkill(p, 'buxiang.fengmang');
  const fengmang = hasActiveSkill(p, 'buxiang.fengmang') ? fmArt?.count ?? 0 : 0;
  // 015 绝境天神（持续）：攻击伤害 + 计数
  const cxArt = artifactWithSkill(p, 'canxiang.juejing');
  const canxiang = hasActiveSkill(p, 'canxiang.juejing') ? cxArt?.count ?? 0 : 0;
  return Math.max(buffMax, fengmang, canxiang);
}

export function checkLifeEnd(g: GameState): void {
  if (g.phase === 'gameOver') return;
  const a = g.players.A.life;
  const b = g.players.B.life;
  let winner: PlayerId | null = null;
  if (a <= 0 && b <= 0) {
    winner = g.activePlayer;
  } else if (a <= 0) {
    winner = 'B';
  } else if (b <= 0) {
    winner = 'A';
  }
  if (winner) {
    g.phase = 'gameOver';
    g.winner = winner;
    logLine(g, `游戏结束：${pname(winner)} 获胜`);
  }
}

/** 支付 1 个攻击骰位发起攻击：消耗骰位，产生待结算攻击（伤害=有效点数+攻击伤害加成） */
export function doAttack(g: GameState, player: PlayerId, costSlots: SlotFill[]): void {
  if (g.pendingAttack) throw new Error('pending attack unresolved');
  const eff = paySlots(g, player, [{ kind: 'attack' }], costSlots);
  const effDie = eff[0];
  const buff = attackDamageBuff(g, player);
  const value = effDie.value + buff;
  g.pendingAttack = {
    attacker: player,
    value,
    unblockable: g.unblockableThisTurn,
    physical: true,
    sourceDieId: effDie.realIds[0],
    sourceValue: effDie.value,
  };
  const defender: PlayerId = player === 'A' ? 'B' : 'A';
  const buffText = buff > 0 ? `（攻击伤害+${buff}，共 ${value} 点）` : '';
  logLine(g, `${pname(player)} 使用 ${effDie.value} 点攻击骰攻击 ${pname(defender)}${buffText}`);
  // 011 顿悟·灵能屏障 触发：当对方使用 1 个攻击骰后，可消耗 1 个冥想骰使伤害减半
  if (
    g.pending === null &&
    hasActiveSkill(g.players[defender], 'dunwu.barrier.trigger') &&
    g.players[defender].areas.meditation.length >= 1
  ) {
    g.pending = { kind: 'dunwuHalve', player: defender };
  }
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

/** 结算待处理攻击：支付防御骰位=抵挡（无伤害）；不给/不可抵挡=造成伤害 */
export function resolveBlock(g: GameState, costSlots?: SlotFill[]): void {
  const pa = g.pendingAttack;
  if (!pa) throw new Error('no pending attack');
  const defenderId: PlayerId = pa.attacker === 'A' ? 'B' : 'A';
  const defender = g.players[defenderId];
  let blocked = false;
  if (!pa.unblockable && costSlots && costSlots.length > 0) {
    const eff = paySlots(g, defenderId, [{ kind: 'defense' }], costSlots);
    blocked = true;
    logLine(g, `${pname(defenderId)} 用 ${eff[0].value} 点防御骰抵挡了攻击`);
  } else {
    const before = defender.life;
    defender.life -= pa.value;
    logLine(g, `${pname(defenderId)} 未抵挡，受到 ${pa.value} 点伤害（生命 ${before} → ${defender.life}）`);
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
  // 013 鸣雷·触发式询问（在攻击结算完成的这一刻）
  if (g.pending === null && !g.attackQueue) {
    const atk = g.players[pa.attacker];
    const med = atk.areas.meditation.length;
    const usedAttackDie = pa.physical && pa.sourceDieId !== undefined;
    if (usedAttackDie && hasActiveSkill(atk, 'minglei.dianxing') && med >= 2) {
      g.pending = { kind: 'dianxing', player: pa.attacker, picked: [] };
    } else if (blocked && hasActiveSkill(atk, 'minglei.leibao.trigger') && med >= 1) {
      g.pending = { kind: 'leibao', player: pa.attacker, picked: [] };
    }
  }
  // 013 电刑：多段攻击队列 —— 当前决策清空后自动进行下一段
  pumpAttackQueue(g);
}

/** 若存在多段攻击队列且当前无待决策/待抵挡，则发起下一段虚拟攻击 */
export function pumpAttackQueue(g: GameState): void {
  const q = g.attackQueue;
  if (!q || g.pendingAttack || g.pending || g.phase === 'gameOver') return;
  const value = q.values.shift()!;
  if (q.values.length === 0) g.attackQueue = null;
  logLine(g, `${pname(q.player)} 「电刑」第 ${value} 点攻击（依次结算）`);
  virtualAttack(g, q.player, value);
}

/** 真实伤害：不可被防御骰抵挡，直接扣血（009 「高塔铁幕」触发可消耗防御骰取消） */
export function dealTrueDamage(g: GameState, target: PlayerId, amount: number): void {
  const p = g.players[target];
  // 009 高塔铁幕触发：受到真实伤害时，若有防御骰可消耗 1 个取消（仅当当前无待决策）
  if (
    g.pending === null &&
    g.phase !== 'gameOver' &&
    hasActiveSkill(p, 'guwang.trigger') &&
    p.areas.defense.length >= 1
  ) {
    g.pending = { kind: 'guwangCancel', player: target, amount };
    return; // 伤害延后到决策解决时结算
  }
  p.life -= amount;
  checkLifeEnd(g);
}

/** 结算被延后的真实伤害（由 guwangCancel 决策在放弃取消时调用） */
export function applyDeferredTrueDamage(g: GameState, target: PlayerId, amount: number): void {
  const p = g.players[target];
  const before = p.life;
  p.life -= amount;
  logLine(g, `${pname(target)} 受到 ${amount} 点真实伤害（生命 ${before} → ${p.life}）`);
  checkLifeEnd(g);
}
