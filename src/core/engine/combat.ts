import type { Artifact, GameState, PendingAttack, PlayerId, PlayerState } from '../model/types';
import { hasActiveSkill, skillActive } from './skill-state';
import { pumpPending, queuePending } from './pending';
import { paySlots, heal, type SlotFill } from './effects';
import { logLine, pname } from './log';

/** 按技能 key 找到拥有它的神器（避免硬编码神器编号） */
export function artifactWithSkill(p: PlayerState, key: string): Artifact | undefined {
  return p.artifacts.find((a) => a.skills.some((s) => s.key === key));
}

/** 攻击伤害加成的来源（同属性取最大；label 供文案显示） */
export function attackDamageBonus(
  g: GameState,
  player: PlayerId,
): { value: number; label?: string } {
  const p = g.players[player];
  let best: { value: number; label?: string } = { value: 0 };
  const consider = (value: number, label?: string): void => {
    if (value > best.value) best = { value, label };
  };
  for (const b of p.buffs.filter((x) => x.attr === 'attackDamage')) consider(b.add, b.source);
  // 004 锋芒（持续）：攻击伤害 + 淬炼计数
  if (hasActiveSkill(p, 'buxiang.fengmang')) {
    consider(artifactWithSkill(p, 'buxiang.fengmang')?.count ?? 0, '锋芒');
  }
  // 015 绝境天神（持续）：攻击伤害 + 计数
  if (hasActiveSkill(p, 'canxiang.juejing')) {
    consider(artifactWithSkill(p, 'canxiang.juejing')?.count ?? 0, '绝境天神');
  }
  // 020 兽魂·熊之心（持续）：攻击伤害 + 计数
  if (hasActiveSkill(p, 'shouhun.xiong.continuous')) {
    consider(artifactWithSkill(p, 'shouhun.xiong.continuous')?.count ?? 0, '熊之心');
  }
  // 021 决意·野火燎原（持续·计数 1+）：攻击伤害 +1
  if (hasActiveSkill(p, 'jueyi.wildfire.continuous')) {
    const jy = artifactWithSkill(p, 'jueyi.wildfire.continuous');
    if ((jy?.count ?? 0) >= 1) consider(1, '野火燎原');
  }
  // 025 屠虎·横贯（持续）：本回合的**第 2 次**攻击伤害 +2（与其它加成取最大）
  if (hasActiveSkill(p, 'tuohu.hengguan') && g.attacksThisTurn[player] === 1) {
    consider(2, '横贯');
  }
  return best;
}

export function attackDamageBuff(g: GameState, player: PlayerId): number {
  return attackDamageBonus(g, player).value;
}

/** 统一受伤入口：扣血 → 判胜负 → 018 至黑「每回合第一次受伤」计数。
 *  所有扣血点（物理伤害/真实伤害/延后真伤/锋芒取消）都必须走这里。 */
export function applyLifeLoss(g: GameState, target: PlayerId, amount: number): void {
  g.players[target].life -= amount;
  checkLifeEnd(g);
  noteDamageTaken(g, target);
}

/** 018 至黑·持续：每当你于任何玩家的回合中第一次受到伤害后，计数 +1（上限 5） */
function noteDamageTaken(g: GameState, target: PlayerId): void {
  const p = g.players[target];
  if (p.damagedThisTurn) return;
  p.damagedThisTurn = true;
  const card = artifactWithSkill(p, 'zhihai.bloom');
  if (!card || card.continuousLost) return;
  if (!hasActiveSkill(p, 'zhihai.bloom')) return;
  const before = card.count;
  card.count = Math.min(5, card.count + 1);
  logLine(g, `「${card.name}」：本回合首次受到伤害，计数 ${before} → ${card.count}`);
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

/** 022 死契·处刑通牒 这类「单次攻击修正」：伤害加成取最大、可强制不可抵挡 */
export interface AttackMods {
  /** 本次攻击的伤害加成（与既有加成**取最大**，FAQ 22.2.2） */
  minBonus?: number;
  /** 本次攻击的加成来源名（提示栏显示） */
  bonusLabel?: string;
  /** 本次攻击不可抵挡（只影响这一次攻击，不设回合标记） */
  forceUnblockable?: boolean;
}

/** 攻击伤害减半的**唯一入口**（同种削减不叠加：灵能屏障 / 021 满计数 / 023 畏惧 只生效一次） */
export function halveAttackDamage(pa: PendingAttack, reason: string): boolean {
  if (pa.halved) return false;
  pa.value = Math.floor(pa.value / 2);
  pa.halved = true;
  pa.halveReason = reason;
  return true;
}

/** 023 蛇蝎·畏惧：该玩家在其下个回合中的攻击伤害减半（生成攻击时就减半，提示/日志保持一致） */
function applyNextTurnHalving(g: GameState, player: PlayerId, pa: PendingAttack): void {
  if (g.activePlayer !== player) return;
  if (!g.players[player].attackHalvedNextTurn) return;
  if (halveAttackDamage(pa, '畏惧')) {
    logLine(g, `${pname(player)} 处于「畏惧」影响中：本次攻击伤害减半为 ${pa.value}`);
  }
}

/** 支付 1 个攻击骰位发起攻击：消耗骰位，产生待结算攻击（伤害=有效点数+攻击伤害加成） */
export function doAttack(g: GameState, player: PlayerId, costSlots: SlotFill[], mods?: AttackMods): void {
  if (g.pendingAttack) throw new Error('pending attack unresolved');
  const eff = paySlots(g, player, [{ kind: 'attack' }], costSlots, undefined, 'attack');
  const effDie = eff[0];
  const base = attackDamageBonus(g, player);
  const bonus = Math.max(base.value, mods?.minBonus ?? 0);
  const bonusLabel = mods?.minBonus !== undefined && mods.minBonus > base.value ? mods.bonusLabel : base.label;
  const value = effDie.value + bonus;
  g.pendingAttack = {
    attacker: player,
    value,
    unblockable: g.unblockableThisTurn || mods?.forceUnblockable === true,
    physical: true,
    sourceDieId: effDie.realIds[0],
    sourceValue: effDie.value,
    baseValue: effDie.value,
    bonusValue: bonus,
    bonusLabel,
  };
  applyNextTurnHalving(g, player, g.pendingAttack);
  // 025 屠虎·横贯（持续）：记入本回合攻击次数（第 2 次攻击时加成已在 attackDamageBonus 中生效）
  g.attacksThisTurn[player] += 1;
  const defender: PlayerId = player === 'A' ? 'B' : 'A';
  const buffText = bonus > 0 ? `（攻击伤害+${bonus}，共 ${g.pendingAttack.value} 点）` : '';
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
  const base = attackDamageBonus(g, player);
  g.pendingAttack = {
    attacker: player,
    value: baseValue + base.value,
    unblockable: g.unblockableThisTurn,
    physical: false,
    baseValue,
    bonusValue: base.value,
    bonusLabel: base.label,
  };
  applyNextTurnHalving(g, player, g.pendingAttack);
}

/**
 * 结算待处理攻击：
 * - 支付防御骰位 = 抵挡（伤害 0；021 满计数时例外，仍造成一半伤害）
 * - 不给 / 不可抵挡 = 造成伤害；若防守方有 020「兽魂」持续且计数 ≥1，改由**攻击方**决定是否取消（延后结算）
 */
export function resolveBlock(g: GameState, costSlots?: SlotFill[]): void {
  const pa = g.pendingAttack;
  if (!pa) throw new Error('no pending attack');
  const defenderId: PlayerId = pa.attacker === 'A' ? 'B' : 'A';
  const defender = g.players[defenderId];
  let blocked = false;
  let damageDealt = 0;

  if (!pa.unblockable && costSlots && costSlots.length > 0) {
    const eff = paySlots(g, defenderId, [{ kind: 'defense' }], costSlots, undefined, 'defense');
    blocked = true;
    logLine(g, `${pname(defenderId)} 用 ${eff[0].value} 点防御骰抵挡了攻击`);
    // 021 决意（持续·计数 5）：被抵挡时仍造成一半伤害
    damageDealt = count5HalfDamage(g, pa);
  } else {
    // 020 兽魂：由攻击方选择「取消伤害（持有者计数 −1）」还是「正常造成伤害」——时机在抵挡决定之后
    const sh = shouhunCard(g, defenderId);
    if (sh && g.pending === null) {
      g.pendingAttack = null;
      queuePending(g, { kind: 'shouhunCancel', player: pa.attacker, owner: defenderId, attack: pa });
      pumpPending(g);
      return;
    }
    damageDealt = pa.value;
  }

  if (damageDealt > 0 || !blocked) {
    const before = defender.life;
    applyLifeLoss(g, defenderId, damageDealt);
    logLine(
      g,
      blocked
        ? `${pname(defenderId)} 被抵挡，但「野火燎原」仍造成 ${damageDealt} 点伤害（生命 ${before} → ${defender.life}）`
        : `${pname(defenderId)} 未抵挡，受到 ${damageDealt} 点伤害（生命 ${before} → ${defender.life}）`,
    );
  }
  g.pendingAttack = null;
  if (g.phase === 'gameOver') return;
  afterAttackResolved(g, pa, { blocked, damageDealt });
  // 013 电刑：多段攻击队列 —— 当前决策清空后自动进行下一段
  pumpAttackQueue(g);
}

/** 021 决意「野火燎原」（持续·计数 5）：被抵挡时仍造成一半伤害（向下取整；同种削减不叠加） */
function count5HalfDamage(g: GameState, pa: PendingAttack): number {
  const card = artifactWithSkill(g.players[pa.attacker], 'jueyi.wildfire.continuous');
  if (!card || card.count < 5) return 0;
  const def = card.skills.find((s) => s.key === 'jueyi.wildfire.continuous');
  if (!def || !skillActive(card, def)) return 0;
  // 同种削减不叠加（FAQ 21.1.5）：已被「灵能屏障」减半 → 不再二次减半，直接按已减半的伤害结算
  if (pa.halved) {
    logLine(
      g,
      `${pname(pa.attacker)} 「野火燎原」：本次攻击被抵挡，仍造成 ${pa.value} 点伤害（与减半不叠加，只减半一次）`,
    );
    return pa.value;
  }
  pa.halved = true;
  const half = Math.floor(pa.value / 2);
  logLine(
    g,
    half > 0
      ? `${pname(pa.attacker)} 「野火燎原」：本次攻击被抵挡，仍造成一半伤害 ${half} 点（向下取整）`
      : `${pname(pa.attacker)} 「野火燎原」：半伤为 0 → 本次既不算被抵挡、也不算造成伤害`,
  );
  return half > 0 ? half : 0;
}

/** 020 兽魂：该玩家是否有「兽魂」持续处于激活状态且计数 ≥1（用于「攻击方可取消伤害」） */
function shouhunCard(g: GameState, player: PlayerId): Artifact | null {
  const card = artifactWithSkill(g.players[player], 'shouhun.xiong.continuous');
  if (!card || card.count < 1) return null;
  const anyActive = card.skills.some((s) => s.kind === 'continuous' && skillActive(card, s));
  return anyActive ? card : null;
}

/**
 * 一次攻击结算完成后的**事件点**（供正常结算与「兽魂」延后结算共用）：
 * 造成伤害后（冥界行走/裁雨流/尘起）、被抵挡后（锋芒）、使用攻击骰后（电刑/雷暴）。
 */
export function afterAttackResolved(
  g: GameState,
  pa: PendingAttack,
  res: { blocked: boolean; damageDealt: number },
): void {
  const atk = g.players[pa.attacker];
  // 017 幽冥·冥界行走（持续）：你的攻击造成伤害后
  if (res.damageDealt > 0) onAttackDamage(g, pa.attacker, pa.baseValue ?? pa.value);
  // 001 裁雨流：当你使用攻击骰造成伤害后（每回合最多 3 次）
  if (res.damageDealt > 0 && pa.physical && pa.sourceDieId !== undefined && pa.sourceValue !== undefined) {
    if (hasActiveSkill(atk, 'yuqie.caiyuliu') && g.caiyuliuUsed < 3) {
      queuePending(g, { kind: 'caiyuliu', player: pa.attacker, dieId: pa.sourceDieId, value: pa.sourceValue });
    }
  }
  // 019 尘哀·尘起：你在自己的回合中通过攻击造成伤害后（每回合最多 1 次）
  if (
    res.damageDealt > 0 &&
    g.activePlayer === pa.attacker &&
    !g.chenaiUsed[pa.attacker] &&
    hasActiveSkill(atk, 'chenai.rise')
  ) {
    g.chenaiUsed[pa.attacker] = true;
    queuePending(g, { kind: 'chenaiFreeRise', player: pa.attacker });
  }
  // 004 锋芒·触发：你的攻击被防御骰抵挡后
  if (res.blocked && hasActiveSkill(atk, 'buxiang.fengmang.trigger')) {
    queuePending(g, { kind: 'fengmang', player: pa.attacker, defenderId: pa.attacker === 'A' ? 'B' : 'A', value: pa.value });
  }
  // 025 屠虎·横贯·触发：你的攻击被抵挡后，可弃置对方 1 颗**点数小于该攻击**的能力骰
  // （FAQ 25.2.1：必须严格小于，不能相同；FAQ 25.2.3：比较的是攻击点数，不含伤害修正）
  if (res.blocked && hasActiveSkill(atk, 'tuohu.hengguan.trigger')) {
    const cmp = pa.baseValue ?? pa.value;
    const opp = g.players[pa.attacker === 'A' ? 'B' : 'A'];
    const hasTarget = (['attack', 'defense', 'meditation'] as const).some((k) =>
      opp.areas[k].some((d) => d.value < cmp),
    );
    // 无合格目标时不可发动（不弹待决策）
    if (hasTarget) queuePending(g, { kind: 'hengguan', player: pa.attacker, value: cmp });
  }
  // 013 鸣雷·触发式询问（在攻击结算完成的这一刻）
  if (g.pending === null && g.pendingQueue.length === 0 && !g.attackQueue) {
    const med = atk.areas.meditation.length;
    const usedAttackDie = pa.physical && pa.sourceDieId !== undefined;
    if (usedAttackDie && hasActiveSkill(atk, 'minglei.dianxing') && med >= 2) {
      queuePending(g, { kind: 'dianxing', player: pa.attacker });
    } else if (res.blocked && hasActiveSkill(atk, 'minglei.leibao.trigger') && med >= 1) {
      queuePending(g, { kind: 'leibao', player: pa.attacker });
    }
  }
}

/** 若存在多段攻击队列且当前无待决策/待抵挡，则发起下一段虚拟攻击 */
export function pumpAttackQueue(g: GameState): void {
  pumpPending(g); // 先弹出排队中的待决策/018 强制必杀，保证「攻击与攻击之间可中断」
  const q = g.attackQueue;
  if (!q || g.pendingAttack || g.pending || g.phase === 'gameOver') return;
  const value = q.values.shift()!;
  if (q.values.length === 0) g.attackQueue = null;
  logLine(g, `${pname(q.player)} 「电刑」第 ${value} 点攻击（依次结算）`);
  virtualAttack(g, q.player, value);
}

/** 017 幽冥·冥界行走（持续）：你的攻击造成伤害后，按「攻击的有效点数」结算 */
function onAttackDamage(g: GameState, attacker: PlayerId, value: number): void {
  const atk = g.players[attacker];
  if (!hasActiveSkill(atk, 'youming.mingjie.continuous')) return;
  if (value === 6) {
    logLine(g, `${pname(attacker)} 「冥界行走」：攻击点数为 6，受到 3 点真实伤害`);
    dealTrueDamage(g, attacker, 3);
    return;
  }
  const n = heal(g, attacker, Math.ceil(value / 2));
  logLine(
    g,
    n > 0
      ? `${pname(attacker)} 「冥界行走」：攻击造成伤害，回复 ${n} 点生命（攻击点数 ${value}，不受加成影响）`
      : `${pname(attacker)} 「冥界行走」：生命已满，未回复`,
  );
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
  applyLifeLoss(g, target, amount);
}

/** 结算被延后的真实伤害（由 guwangCancel 决策在放弃取消时调用） */
export function applyDeferredTrueDamage(g: GameState, target: PlayerId, amount: number): void {
  const p = g.players[target];
  const before = p.life;
  applyLifeLoss(g, target, amount);
  logLine(g, `${pname(target)} 受到 ${amount} 点真实伤害（生命 ${before} → ${p.life}）`);
}
