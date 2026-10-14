import type { Artifact, DiceKind, GameState, PendingAttack, PlayerId, PlayerState } from '../model/types';
import { hasActiveSkill, skillActive, skillUseKey } from './skill-state';
import { pumpPending, queuePending } from './pending';
import { runChargeSkill } from './charge';
import { chargeLayerUp } from './dustRise';
import { paySlots, heal, canPayCosts, checkLifeTens, noteYuanwu, noteLifeDrop, abilityDicePool, type SlotFill } from './effects';
import { logLine, pname } from './log';
import { fxPush, fxTacticFired, fxSkillFired, fxTrueLine } from './fx';
import {
  addLegendDefense,
  fxLegendSkill,
  legendAttackBonus,
  legendDamageCap,
  legendDeathRevive,
  legendHasSkill,
  legendLateJustice,
  legendLegacyName,
} from './challenge';
import { TACTIC_BY_ID } from '../content/tactics';

/** 按技能 key 找到拥有它的神器（避免硬编码神器编号） */
export function artifactWithSkill(p: PlayerState, key: string): Artifact | undefined {
  return p.artifacts.find((a) => a.skills.some((s) => s.key === key));
}

/** 战术牌 T16「潜伏」是否在场（**全局**：任一玩家持有即生效）。 */
export function t16Active(g: GameState): boolean {
  return (['A', 'B'] as PlayerId[]).some((id) => TACTIC_BY_ID[g.players[id].tactic ?? '']?.key === 'qianfu');
}
/** T16「潜伏」：当前回合玩家在自己的**第一个回合** → 双方均不能进行攻击。 */
export function attacksBanned(g: GameState): boolean {
  return t16Active(g) && g.firstRound[g.activePlayer];
}

/** 010「真实之剑」置换可用且拥有 ≥2 颗任意能力骰 → 「消耗 1 颗」的触发即使没有对应类型骰也可发动 */
/** 攻击伤害加成的来源（同属性取最大；label 供文案显示） */
/** 013 电刑＝1/2/3；A08「将至的电刑」＝**1/3/6**；（均无 → null）。点数**唯一来源**。 */
/** 电刑类「点数序列」唯一来源（§19⑨）：013=1/2/3、A08=1/3/6；未持有则 null */
export function dianxingValuesOf(p: PlayerState): number[] | null {
  if (hasActiveSkill(p, 'minglei.alt.dianxing')) return [1, 3, 6];
  if (hasActiveSkill(p, 'minglei.dianxing')) return [1, 2, 3];
  return null;
}

/** 可用于「消耗 2 冥想骰」的冥想骰数（区域真骰 + 034/A03 破障存放骰；不含 010 置换——
 *  「电刑」的选择器只提供"冥想骰"且带 `allowArtifact`，不支持置换）。 */
function meditationPoolCount(g: GameState, player: PlayerId): number {
  return abilityDicePool(g, player).filter((d) => d.kind === 'meditation').length;
}

/** L06「无光领域」：把**攻击点数**按状态 ±1（钳制 1–6；与"伤害"无关）。 */
function applyWuguang(p: PlayerState, point: number): number {
  if (p.wuguang === 'up') return Math.min(6, point + 1);
  if (p.wuguang === 'down') return Math.max(1, point - 1);
  return point;
}

/**
 * 「攻击点数被改判」的说明文案（供**提示栏 + 战报**写明"X 点骰子被「技能」改为 Y 点"）。
 * 来源：028「白昼之火/陨落」（视为 6）、L06「无光领域」（±1）；无改判返回 `null`。
 * ⚠️ 全模式生效（标准/轮选/构筑/挑战/联机 + 英雄面板）。
 */
export function attackPointNote(g: GameState, pa: PendingAttack): string | null {
  const raw = pa.rawPoint;
  const eff = pa.baseValue;
  if (raw == null || eff == null || raw === eff) return null;
  const srcs: string[] = [];
  if (g.tianfa[pa.attacker]) srcs.push(pa.blockKind === 'attack' ? '陨落' : '白昼之火');
  if (g.players[pa.attacker].wuguang) srcs.push('无光领域');
  return srcs.length > 0
    ? `被${srcs.map((n) => `「${n}」`).join('、')}改为 ${eff} 点`
    : `由 ${raw} 点改为 ${eff} 点`;
}

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
  // A04 异相·灵界熊魂（持续）：攻击伤害 + 计数（同属性取最大）
  if (hasActiveSkill(p, 'shouhun.alt.xiong.continuous')) {
    consider(artifactWithSkill(p, 'shouhun.alt.xiong.continuous')?.count ?? 0, '灵界熊魂');
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
  // L09 传奇面板·吞虎之狼（持续）：本回合的**第 3 次**攻击伤害 +3（与其它加成取最大）
  if (hasActiveSkill(p, 'lifeng.tunhuzhilang') && g.attacksThisTurn[player] === 2) {
    consider(3, '吞虎之狼');
  }
  // L10 传奇面板·迟来的正义（持续）：攻击伤害 +X，X ＝ 当前尘落（最大 4；与其它加成取最大）
  if (hasActiveSkill(p, 'mate.chilaidezhengyi')) {
    const x = Math.min(4, g.dustfall);
    if (x > 0) consider(x, '迟来的正义');
  }
  // 030 救赎·寰宇飞升（持续·双向）：双方各自回合的**第一次**攻击伤害 +3（FAQ 30.1.1；任一方持有并激活即生效）
  if (g.attacksThisTurn[player] === 0) {
    for (const id of ['A', 'B'] as PlayerId[]) {
      if (hasActiveSkill(g.players[id], 'jiushu.huanyu')) {
        consider(3, '寰宇飞升');
        break;
      }
    }
  }
  // 032 梦魇·恶意（持续）：你的攻击伤害 +X，X = 你的冥想骰数量的一半（向下取整）
  // （FAQ 32.2.1：按"支付代价后"的状态计算；doAttack 里 paySlots 先于本函数，故天然满足）
  if (hasActiveSkill(p, 'mengyan.eyi.continuous')) {
    consider(Math.floor(p.areas.meditation.length / 2), '恶意');
  }
  // 战术牌「战斗中生效」类（T05 狂热 / T06 残忍）：单一来源见 `tacticActiveBonus`
  const tacticBonus = tacticActiveBonus(g, player);
  if (tacticBonus) consider(tacticBonus.value, tacticBonus.label);
  // 战术牌 T16「潜伏」：双方各自的**第二个回合**内，攻击伤害 +1（按用户定的口径：只算自己回合发出的攻击）
  if (g.activePlayer === player && g.players[player].turnsTaken === 2 && t16Active(g)) {
    consider(1, '潜伏');
  }
  // 挑战模式 Z05「绝境天神」：传奇当前生命每比初始生命低 10 点 → 其攻击伤害 +N
  if (player === 'B') {
    const jj = legendAttackBonus(g);
    if (jj.value > 0) consider(jj.value, jj.label);
  }
  return best;
}

/**
 * 战术牌中**战斗中生效/条件型**的加成（单一来源；UI 的"生效中"绿色态与战斗提示共用）：
 * - T05「狂热」`kuangre`：**你的前 3 个回合**内（`turnsTaken ≤ 3` 且轮到你自己）→ 攻击伤害 +1；
 * - T06「残忍」`canren`：**对方生命 ≤ 13** 时 → 攻击伤害 +5。
 * 其余战术牌（含 T04 末路等触发型）恒为 `null`。
 */
export function tacticActiveBonus(
  g: GameState,
  player: PlayerId,
): { label: string; value: number } | null {
  const key = TACTIC_BY_ID[g.players[player].tactic ?? '']?.key;
  if (key === 'kuangre') {
    const p = g.players[player];
    if (g.activePlayer === player && p.turnsTaken >= 1 && p.turnsTaken <= 3) {
      return { label: '狂热', value: 1 };
    }
  } else if (key === 'canren') {
    const opp: PlayerId = player === 'A' ? 'B' : 'A';
    if (g.players[opp].life <= 13) return { label: '残忍', value: 5 };
  }
  return null;
}

/**
 * T04「末路」：启动「必杀式」技能后 → 造成 / 回复 等同于**第三列神器充能需求**的
 * 真实伤害 / 生命。仅当持有者选的是 T04 时生效（由 `case 'skill'` 与 018 强制必杀两处调用）。
 */
export function applyMolu(g: GameState, player: PlayerId): void {
  if (TACTIC_BY_ID[g.players[player].tactic ?? '']?.key !== 'molu') return;
  const req = g.players[player].artifacts.find((a) => a.column === 3)?.chargeReq ?? 0;
  if (req <= 0) return;
  const opp: PlayerId = player === 'A' ? 'B' : 'A';
  logLine(g, `${pname(player)} 「末路」：启动必杀式 → 造成 ${req} 点真实伤害，回复 ${req} 点生命（第三列充能需求）`);
  fxTacticFired(g, player);
  dealTrueDamage(g, opp, req, player);
  if ((g.phase as string) !== 'gameOver') heal(g, player, req);
}

/**
 * 战术牌 T14「赴火」：持有者**第一次受到「来源＝对方」的伤害**时 → 对造成者反弹**等量真实伤害**（整局 1 次）。
 * 由"伤害来源已知"处调用：攻击落血（`settleAttack`）、`dealTrueDamage`、`applyDeferredTrueDamage`。
 * - `source===target`（自伤）不算；在落血 + 死亡判定**之后**调用 → 若已 `gameOver`（持有者阵亡）则**跳过反弹**。
 */
export function noteFirstDamageFromOpponent(
  g: GameState,
  target: PlayerId,
  amount: number,
  source: PlayerId,
): void {
  if (amount <= 0 || source === target) return;
  if ((g.phase as string) === 'gameOver') return;
  const p = g.players[target];
  if (TACTIC_BY_ID[p.tactic ?? '']?.key !== 'fuhuo') return;
  if (p.tacticOnceUsed) return;
  p.tacticOnceUsed = true;
  logLine(g, `${pname(target)} 「赴火」：首次受到对方造成的 ${amount} 点伤害 → 对 ${pname(source)} 造成等量真实伤害`);
  fxTacticFired(g, target);
  dealTrueDamage(g, source, amount, target);
}

/**
 * 战术牌 T17「诱敌」：持有者**受到「来源＝对方」的伤害后** → 挂**可选**待决策（移动某区域最多 3 颗骰）。
 * 由伤害来源已知处调用（同 T14）；`tacticOnceUsed` 只在**发动**时置位（"不发动"不消耗）。已有同待决策时不重复挂。
 */
export function noteYoudiAfterDamage(g: GameState, target: PlayerId, amount: number, source: PlayerId): void {
  if (amount <= 0 || source === target) return;
  if ((g.phase as string) === 'gameOver') return;
  const p = g.players[target];
  if (TACTIC_BY_ID[p.tactic ?? '']?.key !== 'youdi') return;
  if (p.tacticOnceUsed) return;
  const total = p.areas.attack.length + p.areas.defense.length + p.areas.meditation.length;
  if (total <= 0) return; // 无可移动的骰 → 不打扰
  if (g.pending?.kind === 'youdiMove' || g.pendingQueue.some((x) => x.kind === 'youdiMove')) return;
  queuePending(g, { kind: 'youdiMove', player: target });
  pumpPending(g);
}

export function attackDamageBuff(g: GameState, player: PlayerId): number {
  return attackDamageBonus(g, player).value;}

/** 统一受伤入口：扣血 → 判胜负 → 018 至黑「每回合第一次受伤」计数。
 *  所有扣血点（物理伤害/真实伤害/延后真伤/锋芒取消）都必须走这里。 */
/** L11 传奇面板·「永恒女王」的信号：由 `applyAction` 统一捕获 → "取消一切 + 立即开始新回合"。
 *  用异常是为了**立刻展开当前结算栈**，从而真正做到"取消所有尚待结算的效果和阶段"。 */
export class YonghengQueenSignal extends Error {
  constructor(public readonly target: PlayerId) {
    super('yongheng-queen');
    this.name = 'YonghengQueenSignal';
  }
}

/**
 * L11 传奇面板·永恒女王（持续）：当你受到**能让你死亡的「伤害」或「真实伤害」**时拦截（整局最多 1 次）。
 * - 返回 **true** ＝已拦截（调用方**不得**再扣血）；触发时抛 `YonghengQueenSignal`（由 `applyAction` 收尾）。
 * - **只认「伤害」与「真实伤害」**：**非伤害**的生命下降（033 抹零）、L09 遍野残杀"立即死亡"、尘落 10 等**不触发**。
 */
export function tryYonghengQueen(g: GameState, target: PlayerId, amount: number): boolean {
  if (amount <= 0) return false;
  const p = g.players[target];
  if (!hasActiveSkill(p, 'aiwa.yonghengnvwang')) return false;
  if (g.legendOnceUsed.includes(`${target}:aiwa.yonghengnvwang`)) return false;
  if (p.life - amount > 0) return false;
  throw new YonghengQueenSignal(target);
}

export function applyLifeLoss(g: GameState, target: PlayerId, amount: number): void {
  g.players[target].life -= amount;
  noteLifeDrop(g, target, amount); // L11 邪灵序曲：任何"生命减少"都计数（含伤害/真伤）
  checkLifeEnd(g);
  noteDamageTaken(g, target);
  noteDuanexing(g, target); // L12 闻我名者断恶行：受到伤害/真伤后（gameOver 时内部直接跳过）
  checkLifeTens(g, target); // L05 复仇之灵：生命十位数变化 → 强制额外尘起
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
  fxSkillFired(g, target, 'zhihai.bloom');
}

/**
 * L12 传奇面板·「闻我名者断恶行」（触发）：当你**受到伤害 / 真实伤害后**（`applyLifeLoss` 是共同的落血点，
 * 含自伤真伤），若**对方攻击骰区有骰**，弹询问让你可弃置对方 1 个攻击骰（**每回合最多 1 次**）。
 * 决策人＝持有者本人；神上的存放骰不算攻击骰（只取对方 `areas.attack`）。
 * 用 `skillsUsedThisTurn`（键 `玩家:miyun.duanexing`）记"本回合已触发"——在**入队时**即登记，避免同回合两次受伤重复排队。
 */
function noteDuanexing(g: GameState, target: PlayerId): void {
  if (g.phase === 'gameOver') return;
  const p = g.players[target];
  if (!hasActiveSkill(p, 'miyun.duanexing')) return;
  const key = skillUseKey(target, 'miyun.duanexing');
  if (g.skillsUsedThisTurn.includes(key)) return; // 每回合最多触发 1 次
  const oppId: PlayerId = target === 'A' ? 'B' : 'A';
  if (g.players[oppId].areas.attack.length === 0) return; // 无可弃的攻击骰 → 不弹（不可完成）
  g.skillsUsedThisTurn.push(key);
  queuePending(g, { kind: 'duanexing', player: target });
  logLine(g, `${pname(target)} 「闻我名者断恶行」：受到伤害 → 可弃置对方 1 个攻击骰（本回合 1 次）`);
}

export function checkLifeEnd(g: GameState): void {
  if (g.phase === 'gameOver') return;
  if (legendDeathRevive(g)) return; // Z06「死即新生」：传奇生命归 0 → 复活，**不判负**
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
    fxSkillFired(g, player === 'A' ? 'B' : 'A', 'shexie.weiju'); // 023 由对方持有 → 弹在其卡上
  }
}

/** 支付 1 个攻击骰位发起攻击：消耗骰位，产生待结算攻击（伤害=有效点数+攻击伤害加成） */
export function doAttack(g: GameState, player: PlayerId, costSlots: SlotFill[], mods?: AttackMods): void {
  if (g.pendingAttack) throw new Error('pending attack unresolved');
  // 战术牌 T16「潜伏」：双方各自的第一个回合内，双方均不能进行攻击
  if (attacksBanned(g)) {
    logLine(g, `「潜伏」：双方各自的第一个回合内，${pname(player)} 不能进行攻击`);
    return;
  }
  // L07「无尽追猎」（持续）：**攻击时你的攻击骰区恰剩 1 颗**（＝"最后 1 个攻击骰"）→ 该次攻击不可抵挡。
  // 注意：必须在 paySlots 之前判定（支付会把该骰移出攻击骰区）；只作用于**用这颗骰打出的这一次攻击**，
  // 技能发起的虚拟攻击（013 电刑 / A01 不败之王 等）没有实体攻击骰 → 不受影响。
  const loneLastAttackDie =
    g.players[player].areas.attack.length === 1 && hasActiveSkill(g.players[player], 'nisa.wujinzhulie');
  const eff = paySlots(g, player, [{ kind: 'attack' }], costSlots, undefined, 'attack');
  // 025 屠虎·奇袭：本次攻击用「视为攻击骰」的骰发起 → 弹「奇袭」技能名
  if (eff.some((d) => d.source === 'treated')) fxSkillFired(g, player, 'tuohu.qixi');
  const effDie = eff[0];
  // 028 天罚（激活·本回合）：攻击点数「始终视为固定值」（FAQ 28.1.1）；A05 异相无固定值（value 未设）→ 用骰点
  const tianfa = g.tianfa[player];
  // 028 / A05：本回合"让对方**只能用非防御骰抵挡**"（白昼之火/深空之火→冥骰；陨落→攻击骰）＋点数视为6 / 伤害+3
  // → **每次攻击**都弹其技能名（这是"抵消规则被改"的特殊效果；不是单纯加伤害）
  if (tianfa) fxSkillFired(g, player, tianfa.key);
  const rawPoint = tianfa && tianfa.value !== undefined ? tianfa.value : effDie.value;
  const attackPoint = applyWuguang(g.players[player], rawPoint); // L06 无光领域：攻击点数 ±1（钳制 1–6）
  const base = attackDamageBonus(g, player);
  const bonus = Math.max(base.value, mods?.minBonus ?? 0);
  const bonusLabel = mods?.minBonus !== undefined && mods.minBonus > base.value ? mods.bonusLabel : base.label;
  // Z10「迟来的正义」：任一方生命 <10 时，传奇的攻击伤害＝**攻击点数 ×2**（**不加其它加成**，遵黄金法则）
  const lateJustice = player === 'B' && legendLateJustice(g);
  const value = lateJustice ? attackPoint * 2 : attackPoint + bonus;
  const pa: PendingAttack = {
    attacker: player,
    value,
    unblockable: g.unblockableThisTurn || mods?.forceUnblockable === true || loneLastAttackDie,
    physical: true,
    sourceDieId: effDie.realIds[0],
    sourceValue: effDie.value,
    baseValue: attackPoint,
    rawPoint: effDie.value,
    bonusValue: lateJustice ? attackPoint : bonus,
    bonusLabel: lateJustice ? '迟来的正义' : bonusLabel,
    ...(tianfa ? { blockKind: tianfa.blockKind } : {}),
  };
  applyNextTurnHalving(g, player, pa);
  // 025 屠虎·横贯（持续）：记入本回合攻击次数（即使随后被「不动菩提」取消）
  g.attacksThisTurn[player] += 1;
  const defender: PlayerId = player === 'A' ? 'B' : 'A';
  const buffText = bonus > 0 ? `（攻击伤害+${bonus}，共 ${pa.value} 点）` : '';
  // 战报要写明"点数被改判"（028「视为6」/ L06 ±1）——否则"使用 6 点攻击骰"会和骰面矛盾
  const pointNote = attackPointNote(g, pa);
  logLine(
    g,
    pointNote
      ? `${pname(player)} 使用 ${effDie.value} 点攻击骰（${pointNote}）攻击 ${pname(defender)}${buffText}`
      : `${pname(player)} 使用 ${attackPoint} 点攻击骰攻击 ${pname(defender)}${buffText}`,
  );
  if (loneLastAttackDie) {
    logLine(g, `${pname(player)} 「无尽追猎」：攻击骰区仅剩这 1 颗攻击骰 → 本次攻击不可抵挡`);
  }
  // 034 金刚·不动菩提（触发）：防守方可用「神器上同点数存放骰」取消该攻击 → 先询问
  if (maybePutiAttack(g, pa)) return;
  commitAttack(g, pa);
}

/** 把攻击"停到中间"（设置 `pendingAttack`）；**不含** 011 的追问。 */
function parkAttack(g: GameState, pa: PendingAttack): void {
  if (g.pendingAttack) throw new Error('pending attack unresolved');
  g.pendingAttack = pa;
}

/** 攻击已停住后：011 顿悟·灵能屏障 触发（对方可消耗 1 冥想骰使伤害减半）。 */
export function maybeBarrier(g: GameState, pa: PendingAttack): void {
  const defender: PlayerId = pa.attacker === 'A' ? 'B' : 'A';
  if (
    g.pending === null &&
    hasActiveSkill(g.players[defender], 'dunwu.barrier.trigger') &&
    canPayCosts(g, defender, { meditation: 1 }, { held: true })
  ) {
    g.pending = { kind: 'dunwuHalve', player: defender };
  }
}

/** 正式提交一次攻击为「待结算」（设置 pendingAttack；011 灵能屏障触发） */
export function commitAttack(g: GameState, pa: PendingAttack): void {
  parkAttack(g, pa);
  maybeBarrier(g, pa);
}

/**
 * 034/A03「不动菩提」·触发·**攻击侧**：对方**使用 1 个攻击骰后** → 若防守方持菩提、且兜里有同点数的存放骰
 * （"同点数"＝**改后有效攻击点数** `baseValue`，含 028「视为6」/ L06 ±1），挂 `putiPick` 让防守方决定是否取消。
 * 返回 `true` ＝ 已挂起（调用方**立即停止**后续结算）。
 *
 * ⚠️ **凡"用了攻击骰"的攻击都必须过这里**：`doAttack`（实体攻击）＋ **队列虚拟攻击里带真骰的**
 * （挑战模式「枭首 / 裁雨流 / 真实之剑 / 无上剑术」等，见 `pumpAttackQueue`）。
 * **无攻击骰的虚拟攻击不触发**（卡面要求"使用攻击骰"，故以 `sourceDieId` 为门）。
 */
function maybePutiAttack(g: GameState, pa: PendingAttack): boolean {
  if (!pa.sourceDieId) return false; // 没有实体攻击骰 → 不算"使用攻击骰"
  const defender: PlayerId = pa.attacker === 'A' ? 'B' : 'A';
  const puti = artifactWithSkill(g.players[defender], 'jingang.puti.trigger');
  const point = pa.baseValue ?? pa.value;
  if (
    !puti ||
    !hasActiveSkill(g.players[defender], 'jingang.puti.trigger') ||
    g.pending !== null ||
    g.pendingQueue.length > 0 ||
    !(puti.heldDice ?? []).some((h) => h.value === point)
  ) {
    return false;
  }
  // 攻击骰先停到中间（供 034 与攻击骰"并排"）；011 的追问推迟到"不发动 034"之后（保持 034 优先）
  if (!g.pendingAttack) parkAttack(g, pa); // 队列攻击已由 `pumpAttackQueue` 停住 → 不重复停
  queuePending(g, {
    kind: 'putiPick',
    player: defender,
    owner: pa.attacker,
    value: point,
    mode: 'attack',
    attack: pa,
  });
  pumpPending(g);
  return true;
}

/** 技能发起的“虚拟”攻击（非实体攻击骰）。`source` = 来源技能名 + 效果拥有者（供提示栏显示） */
export function virtualAttack(
  g: GameState,
  player: PlayerId,
  baseValue: number,
  source?: { skill: string; owner: PlayerId },
  opts?: { unblockable?: boolean },
): void {
  // 战术牌 T16「潜伏」：双方各自的第一个回合内，双方均不能进行攻击（技能发起的虚拟攻击同样被禁）
  if (attacksBanned(g)) {
    logLine(g, `「潜伏」：双方各自的第一个回合内，${pname(player)} 不能进行攻击（技能发起的攻击同样被禁）`);
    return;
  }
  const base = attackDamageBonus(g, player);
  // 028 天罚：攻击点数「始终视为固定值」（FAQ 28.1.1）→ **技能发起的攻击同样适用**（每次攻击弹其技能名）
  const tianfa = g.tianfa[player];
  if (tianfa) fxSkillFired(g, player, tianfa.key);
  const rawTianfa = tianfa && tianfa.value !== undefined ? tianfa.value : baseValue;
  const point = applyWuguang(g.players[player], rawTianfa); // L06 无光领域：攻击点数 ±1
  // Z10「迟来的正义」：任一方生命 <10 时，传奇的攻击伤害＝**攻击点数 ×2**（不加其它加成）
  const lateJustice = player === 'B' && legendLateJustice(g);
  g.pendingAttack = {
    attacker: player,
    value: lateJustice ? point * 2 : point + base.value,
    unblockable: opts?.unblockable ?? g.unblockableThisTurn,
    physical: false,
    baseValue: point,
    rawPoint: baseValue,
    bonusValue: lateJustice ? point : base.value,
    bonusLabel: lateJustice ? '迟来的正义' : base.label,
    ...(source ? { sourceSkill: source.skill, sourceSkillOwner: source.owner } : {}),
  };
  applyNextTurnHalving(g, player, g.pendingAttack);
  // 攻击次数统计（"第 N 次攻击"类加成：025 横贯 / 030 寰宇飞升 / L09 吞虎之狼 / 025 横贯·触发等）：
  // **技能发起的虚拟攻击同样计入**（2026-09-28 用户裁定）；与 `doAttack` 同序：先算加成、再计数。
  g.attacksThisTurn[player] += 1;
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

  if (!pa.unblockable && costSlots && costSlots.length > 0) {
    // 028 天罚：若本次攻击限制了抵挡骰类型（白昼之火=冥想 / 陨落=攻击），则按该类型支付
    const blockKind = pa.blockKind ?? 'defense';
    const eff = paySlots(g, defenderId, [{ kind: blockKind }], costSlots, undefined, 'defense');
    const kindCn = blockKind === 'attack' ? '攻击' : blockKind === 'meditation' ? '冥想' : '防御';
    logLine(g, `${pname(defenderId)} 用 ${eff[0].value} 点${kindCn}骰抵挡了攻击`);
    // 034 金刚·不动菩提（触发）：攻击方可用「神器上同点数存放骰」取消对方这次抵挡
    const puti = artifactWithSkill(g.players[pa.attacker], 'jingang.puti.trigger');
    const willPark =
      !!puti &&
      hasActiveSkill(g.players[pa.attacker], 'jingang.puti.trigger') &&
      g.pending === null &&
      g.pendingQueue.length === 0 &&
      (puti.heldDice ?? []).some((h) => h.value === eff[0].value);
    // 动效旁路：这次抵挡**实际消耗**的骰子（`park`＝先停中间等 034 决定，不立即结算）
    fxPush({
      kind: 'block',
      player: defenderId,
      dieIds: costSlots.flatMap((f) => f.dieIds),
      ...(willPark ? { park: true } : {}),
    });
    if (willPark) {
      // **保留 pendingAttack**：攻击骰 + 防御骰都停在中间，等 034 决定（不发动才走正常抵挡）
      queuePending(g, {
        kind: 'putiPick',
        player: pa.attacker,
        owner: defenderId,
        value: eff[0].value,
        mode: 'block',
        attack: pa,
      });
      pumpPending(g);
      return;
    }
    finalizeAttackResolution(g, pa, true);
    return;
  }

  // 未抵挡：020 兽魂（由攻击方决定）／A04 异相（阈值 2、由**持有者**决定）——时机在抵挡决定之后
  const sh = shouhunInfo(g, defenderId);
  if (sh && g.pending === null) {
    g.pendingAttack = null;
    const decider: PlayerId = sh.decider === 'owner' ? defenderId : pa.attacker;
    queuePending(g, { kind: 'shouhunCancel', player: decider, owner: defenderId, attack: pa, minCount: sh.minCount });
    pumpPending(g);
    return;
  }
  finalizeAttackResolution(g, pa, false);
}

/**
 * 一次攻击的**收尾**（落血 + 事件点 + 028×013 电刑 + 推进多段队列）。
 * 抽出为独立导出：正常结算走它；T09「慈悲」待决策解决后也走它（`applyDamage=false` ＝ 取消伤害）。
 */
export function settleAttack(
  g: GameState,
  pa: PendingAttack,
  o: { blocked: boolean; blockedForTriggers: boolean; damageDealt: number; applyDamage: boolean },
): void {
  // Z07「围攻」：挑战者**的攻击点数为 6**造成伤害、且「荒野行者」有计数 → 取消该伤害、计数 −1（强制）
  // ⚠️ 判定用**攻击的有效点数** `baseValue`（含 028「陨落」"视为6"等改判；**虚拟攻击也算**）——
  //    `sourceValue` 是"那颗真骰的原始点数"，会漏判/误判（真实事故：陨落把 3 点骰改判成 6 → 围攻不触发）。
  //    也**不看** `value`（伤害）：4 点攻击 +2 加成 = 6 点伤害 ≠ 6 点攻击。
  // ⚠️ **必须按卡门禁**（`legendHasSkill(g,'z07-x')`）：`count` 是**共享字段**（Z02 锋芒/Z05/Z07 都有计数），
  //    只判 `mode==='challenge'` + `count>0` 会在打**别的卡**时误触发（真实事故 2026-10-12：打 Z02「永暗之刃」时冒出围攻）。
  if (
    legendHasSkill(g, 'z07-x') &&
    pa.attacker === 'A' &&
    o.damageDealt > 0 &&
    pa.baseValue === 6 &&
    (g.challenge?.count ?? 0) > 0
  ) {
    g.challenge!.count -= 1;
    logLine(g, `「${legendLegacyName(g)}」：围攻 — 取消 6 点攻击的 ${o.damageDealt} 点伤害，计数 −1`);
    // 触发＝"发动帧" → 弹技能名（围攻是 `unordered` 钩子，不发这条界面就没有名字可弹）
    fxLegendSkill(g, 'z07-x');
    o = { ...o, applyDamage: false, damageDealt: 0 };
  }
  // Z09「威压」（卡面规则）：挑战者(A)的攻击对「天殇的战鬼」**最多造成 4 伤害**。
  //   仅当**原始伤害 > 上限**时才封顶 + 弹「威压」名（≤ 上限 → 原样、不弹）。
  const dmgCap = legendDamageCap(g);
  if (dmgCap !== null && pa.attacker === 'A' && o.damageDealt > dmgCap) {
    logLine(g, `「${legendLegacyName(g)}」：威压 — ${o.damageDealt} 点伤害压至 ${dmgCap} 点`);
    fxLegendSkill(g, 'z09-x');
    o = { ...o, damageDealt: dmgCap };
  }
  const defenderId: PlayerId = pa.attacker === 'A' ? 'B' : 'A';
  const defender = g.players[defenderId];
  if (o.applyDamage && (o.damageDealt > 0 || !o.blocked)) {
    // L11 永恒女王：若本次**攻击伤害**会致死 → 拦截（抛信号，由 applyAction 收尾"取消一切 + 开新回合"）
    if (o.damageDealt > 0) tryYonghengQueen(g, defenderId, o.damageDealt);
    const before = defender.life;
    applyLifeLoss(g, defenderId, o.damageDealt);
    logLine(
      g,
      o.blocked
        ? `${pname(defenderId)} 被抵挡，但「野火燎原」仍造成 ${o.damageDealt} 点伤害（生命 ${before} → ${defender.life}）`
        : `${pname(defenderId)} 未抵挡，受到 ${o.damageDealt} 点伤害（生命 ${before} → ${defender.life}）`,
    );
  }
  // T14「赴火」：防守方首次受到"来源＝攻击方"的伤害 → 反弹等量真伤（钩子自守卫：gameOver 时跳过）
  if (o.applyDamage) noteFirstDamageFromOpponent(g, defenderId, o.damageDealt, pa.attacker);
  // T17「诱敌」：受到对方伤害后，可挂"移动最多 3 颗骰"的可选待决策
  if (o.applyDamage) noteYoudiAfterDamage(g, defenderId, o.damageDealt, pa.attacker);
  // 挑战模式：多段队列用"某颗真骰"发起攻击 → **这一击结算完**才把那颗骰从区里移除。
  //   · 枭首/裁雨流/无上剑术/战车：源骰在**攻击骰区**；
  //   · 真实之剑（甲，2026-10-11）：源骰**留在防御骰区**（不搬进攻击骰区）→ 找不到就回退到防御骰区。
  //（只处理**传奇（B）**自己的那批真骰攻击；挑战者的攻击骰在支付时就已消耗 → 这里本应空转。
  //  也避免误伤 001/C01 裁雨流那种"攻击骰结算后落区"的常规流程。）
  if (g.mode === 'challenge' && pa.attacker === 'B' && pa.sourceDieId) {
    const atkArea = g.players[pa.attacker].areas.attack;
    let area = atkArea;
    let idx = area.findIndex((d) => d.id === pa.sourceDieId);
    if (idx < 0) {
      area = g.players[pa.attacker].areas.defense; // 真实之剑：源骰在防御骰区
      idx = area.findIndex((d) => d.id === pa.sourceDieId);
    }
    if (idx >= 0) {
      // Z01「裁雨流」：**前 3 次造成伤害**的攻击骰 → 移入防御骰区（而非弃掉）；其余照常移走
      // ⚠️ 必须是 **Z01 的卡**（`legendHasSkill`）——挑战者若也用名为「裁雨流」的攻击，
      //    **不得**污染 Z01 的"前 3 次"计数、更不得把骰搬进**传奇的**防御骰区。
      const hits = g.challenge?.caiyuliuHits ?? 0;
      if (legendHasSkill(g, 'z01-5') && pa.sourceSkill === '裁雨流' && o.damageDealt > 0 && hits < 3) {
        const die = area.splice(idx, 1)[0];
        // 移入防御骰区（**受 `defenseCap` 约束**；已满 → 直接弃置＝移除后不加入）。边界：仍占"前 3 次"名额。
        const placed = addLegendDefense(g, die);
        g.challenge!.caiyuliuHits = hits + 1;
        if (placed) fxPush({ kind: 'move', player: pa.attacker, dieIds: [die.id] }); // 攻击骰区 → 防御骰区
      } else {
        area.splice(idx, 1);
      }
    }
  }
  // Z06「冥界行走」（本回合）：传奇（B）的攻击**造成伤害** → 回复该**攻击点数**一半（向上取整）
  // ⚠️ 取 **`baseValue`（攻击的有效点数）**、**不含伤害加成**——与卡面"回复该**攻击点数**一半"一致，
  //    也与标准版 017 / 025·触发 / L05 同口径（凡"按攻击点数"一律 `baseValue ?? value`）。
  //    注：Z06 的**黑/白两面技能不共存**（勾魂镰黑面 / 冥界行走白面）→ 本卡内 `value` 与 `baseValue` 恒等；
  //    取 `baseValue` 是**口径对齐**（防将来白面出加伤），**不是**在修一个可复现的 bug。
  if (g.mode === 'challenge' && pa.attacker === 'B' && g.challenge?.mingjieHeal && o.damageDealt > 0) {
    const healAmt = Math.ceil((pa.baseValue ?? pa.value) / 2);
    heal(g, 'B', healAmt);
    logLine(g, `「漆黑死神」：冥界行走 — 攻击造成伤害，回复 ${healAmt} 点生命`);
  }
  g.pendingAttack = null;
  if (g.phase === 'gameOver') return;
  afterAttackResolved(g, pa, { blocked: o.blockedForTriggers, damageDealt: o.damageDealt });
  // FAQ 28.2.1：028「陨落」限制下，对方用**攻击骰**抵挡 = “使用攻击骰” → 可触发其「电刑」（在攻击方的回合反击）
  // 注意：① 也要认 **A08「将至的电刑」**；② 点数必须传 `values`（013=1/2/3、A08=1/3/6）；③ 门槛走冥想池（含 034 存放骰）
  if (o.blocked && pa.blockKind === 'attack') {
    const dv = dianxingValuesOf(defender);
    if (dv && meditationPoolCount(g, defenderId) >= 2) {
      queuePending(g, { kind: 'dianxing', player: defenderId, values: dv });
    }
  }
  // Z09「横贯」：本技能期间，挑战者每抵挡一次 → 必弃自己 1 个任意能力骰（挑战者选、弹「横贯」名）
  if (
    g.mode === 'challenge' &&
    pa.attacker === 'B' &&
    o.blocked &&
    g.challenge?.hengguan &&
    g.pending === null &&
    (g.phase as string) !== 'gameOver'
  ) {
    const A = g.players.A;
    const pool: { id: string; value: number; kind: DiceKind }[] = [];
    for (const kd of ['attack', 'defense', 'meditation'] as DiceKind[]) {
      for (const d of A.areas[kd]) pool.push({ id: d.id, value: d.value, kind: kd });
    }
    if (pool.length > 0) {
      const kindCn = (k: DiceKind): string => (k === 'attack' ? '攻' : k === 'defense' ? '防' : '冥');
      queuePending(g, {
        kind: 'challengePick',
        player: 'A',
        tag: 'hengguan',
        prompt: '「横贯」：挑战者抵挡后，弃置自己 1 个任意能力骰',
        options: pool.map((p) => ({ id: p.id, label: `${kindCn(p.kind)}${p.value}` })),
        pick: { pool, n: 1 },
      });
      fxLegendSkill(g, 'z09-5');
    }
  }
  // 013 电刑：多段攻击队列 —— 当前决策清空后自动进行下一段
  pumpAttackQueue(g);
}

/** 一次攻击的收尾（被抵挡/未抵挡皆可）：扣血、事件点、028×013 电刑、推进多段队列 */
export function finalizeAttackResolution(g: GameState, pa: PendingAttack, blocked: boolean): void {
  const defenderId: PlayerId = pa.attacker === 'A' ? 'B' : 'A';
  let damageDealt = pa.value;
  // 「被抵挡」= 用了防御骰（一个事实）；与「伤害=0」是两回事。唯一例外：021 半伤为 0 时按 FAQ 21.1.7 不算被抵挡
  let blockedForTriggers = blocked;
  if (blocked) {
    const r = count5HalfDamage(g, pa);
    damageDealt = r.damage;
    blockedForTriggers = !(r.halfApplied && damageDealt === 0);
  }
  // 战术牌 T09「慈悲」：**攻击方**可将"将造成的伤害"取消并改为回复等量生命（整局 1 次）
  const ap = g.players[pa.attacker];
  if (
    damageDealt > 0 &&
    g.pending === null &&
    (g.phase as string) !== 'gameOver' &&
    TACTIC_BY_ID[ap.tactic ?? '']?.key === 'cibei' &&
    !ap.tacticOnceUsed
  ) {
    g.pendingAttack = null;
    queuePending(g, {
      kind: 'ciBei',
      player: pa.attacker,
      target: defenderId,
      amount: damageDealt,
      attack: pa,
      blocked,
      blockedForTriggers,
    });
    pumpPending(g);
    return;
  }
  settleAttack(g, pa, { blocked, blockedForTriggers, damageDealt, applyDamage: true });
}

/** 021 决意「野火燎原」（持续·计数 5）：被抵挡时仍造成一半伤害（向下取整；同种削减不叠加）。
 *  返回 `halfApplied` 以区分「021 半伤」与「无 021 的普通抵挡」——前者半减为 0 时按 FAQ 21.1.7 不算被抵挡。 */
function count5HalfDamage(g: GameState, pa: PendingAttack): { damage: number; halfApplied: boolean } {
  const card = artifactWithSkill(g.players[pa.attacker], 'jueyi.wildfire.continuous');
  if (!card || card.count < 5) return { damage: 0, halfApplied: false };
  const def = card.skills.find((s) => s.key === 'jueyi.wildfire.continuous');
  if (!def || !skillActive(card, def)) return { damage: 0, halfApplied: false };
  // 同种削减不叠加（FAQ 21.1.5）：已被「灵能屏障」减半 → 不再二次减半，直接按已减半的伤害结算
  if (pa.halved) {
    logLine(
      g,
      `${pname(pa.attacker)} 「野火燎原」：本次攻击被抵挡，仍造成 ${pa.value} 点伤害（与减半不叠加，只减半一次）`,
    );
    return { damage: pa.value, halfApplied: true };
  }
  pa.halved = true;
  const half = Math.floor(pa.value / 2);
  logLine(
    g,
    half > 0
      ? `${pname(pa.attacker)} 「野火燎原」：本次攻击被抵挡，仍造成一半伤害 ${half} 点（向下取整）`
      : `${pname(pa.attacker)} 「野火燎原」：半伤为 0 → 本次既不算被抵挡、也不算造成伤害`,
  );
  return { damage: half, halfApplied: true };
}

/** 「兽魂」持续式 key（原版 020 + 异相 A04）：用于取消伤害的判定与计数复位 */
export const SHOUHUN_CONT_KEYS = [
  'shouhun.xiong.continuous',
  'shouhun.lang.continuous',
  'shouhun.alt.xiong.continuous',
  'shouhun.alt.lang.continuous',
] as const;

interface ShouhunInfo {
  card: Artifact;
  minCount: number;
  /** 谁决定是否取消：原版=攻击方（对方可选取消）；异相 A04=持有者本人 */
  decider: 'attacker' | 'owner';
}

/** 020 兽魂 / A04 异相：该玩家是否有「兽魂·持续」激活且计数达阈值（用于「取消伤害」判定） */
function shouhunInfo(g: GameState, player: PlayerId): ShouhunInfo | null {
  const p = g.players[player];
  for (const key of SHOUHUN_CONT_KEYS) {
    const card = artifactWithSkill(p, key);
    if (!card) continue;
    const s = card.skills.find((x) => x.key === key);
    if (!s || !skillActive(card, s)) continue;
    const alt = key.startsWith('shouhun.alt.');
    const minCount = alt ? 2 : 1;
    if (card.count < minCount) continue;
    return { card, minCount, decider: alt ? 'owner' : 'attacker' };
  }
  return null;
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
  // L05 传奇面板·无法饶恕（触发）：攻击**造成伤害**后，可选弃置对方 1 个"**点数**＝该攻击**点数**"的防御骰。
  // 注意：触发看 **伤害**（damageDealt>0）、匹配看 **点数**（baseValue ?? value）——两者是不同概念。
  if (res.damageDealt > 0 && hasActiveSkill(g.players[pa.attacker], 'zoray.wufaraoshu')) {
    const atkPoint = pa.baseValue ?? pa.value;
    const defenderId2: PlayerId = pa.attacker === 'A' ? 'B' : 'A';
    if (g.players[defenderId2].areas.defense.some((d) => d.value === atkPoint)) {
      queuePending(g, { kind: 'wufaraoshu', player: pa.attacker, value: atkPoint });
    }
  }
  // L01 断苇一斩：记录"本回合（我方回合）造成过伤害"（仅攻击方＝当前回合玩家时计）
  if (res.damageDealt > 0 && g.activePlayer === pa.attacker) atk.dealtDamageThisTurn = true;
  // L03 传奇面板·统御战场（持续）：受到**攻击造成的伤害**后 → 该玩家的「孤王」充能 +1
  // （封顶 chargeReq；满 3 不再加、也不触发充能效果）
  if (res.damageDealt > 0) {
    const defenderId: PlayerId = pa.attacker === 'A' ? 'B' : 'A';
    const def = g.players[defenderId];
    if (hasActiveSkill(def, 'batton.tongyuzhancang')) {
      // 「孤王」＝第三列：009 用 `guwang.charge`、异相 A01 用 `guwang.alt.charge`——两种 key 都要认
      const guwang = def.artifacts.find((a) =>
        a.skills.some((s) => s.key === 'guwang.charge' || s.key === 'guwang.alt.charge'),
      );
      if (guwang) {
        const cap = guwang.chargeReq ?? 0;
        if (guwang.chargeLayer < cap) {
          // **走唯一充能入口**（达标即设 activeMarkerSide 完成激活）→ 009 的触发/必杀、A01 的必杀才会就绪
          chargeLayerUp(g, guwang);
          logLine(
            g,
            `${pname(defenderId)} 「统御战场」：受到攻击伤害 → 「${guwang.name}」充能 +1（${guwang.chargeLayer}/${cap}）`,
          );
          fxSkillFired(g, defenderId, 'batton.tongyuzhancang');
          // 连锁执行该神器的「充能效果」（009「高塔铁幕」→ 把对方 1 个攻击骰点数变为 1）
          runChargeSkill(g, defenderId, guwang.id);
        }
      }
    }
  }
  // 028 天罚：统计本回合通过攻击造成伤害的次数（满 2 次由 game.ts 结束主要阶段）
  const tf = g.tianfa[pa.attacker];
  if (res.damageDealt > 0 && tf && g.activePlayer === pa.attacker) {
    tf.damageCount += 1;
  }
  // 031 恶兆·血祭（持续）：进行 1 次攻击后计数 +1（含虚拟攻击）。
  // （FAQ 31.1.1：0 伤害也 +1；FAQ 31.1.2：先 +1、再按新计数结算自伤。）
  // 自伤（按新计数受真伤）**改到本函数最末尾**结算：它可能致死并触发 L11「永恒女王」；
  // 此时攻击已完整结算、不应算"中断攻击"，若放中段会把后面所有"攻击结算后"触发一起截断。
  {
    const xueji = artifactWithSkill(atk, 'ezhao.xueji');
    if (xueji && hasActiveSkill(atk, 'ezhao.xueji')) {
      const before = xueji.count;
      xueji.count = Math.min(xueji.countCap ?? 7, xueji.count + 1);
      logLine(g, `「${xueji.name}」：进行 1 次攻击，计数 ${before} → ${xueji.count}`);
    }
  }
  // 017 幽冥·冥界行走（持续）：你的攻击造成伤害后
  if (res.damageDealt > 0) onAttackDamage(g, pa.attacker, pa.baseValue ?? pa.value);
  // A06 异相·「勾魂」（持续）：你用"点数不存在于本神器之上"的攻击骰造成伤害后，将该攻击骰置于本神器上（永久）
  // ⚠️ "攻击点数"取**改后有效点数**（`baseValue`，含 L06 ±1）——与 034 菩提同口径（作者裁定 2026-10-11）。
  const gouhunPoint = pa.baseValue ?? pa.value;
  if (res.damageDealt > 0 && pa.physical && pa.sourceValue !== undefined) {
    const gou = artifactWithSkill(atk, 'xuyu.alt.gouhun');
    const gsk = gou?.skills.find((s) => s.key === 'xuyu.alt.gouhun');
    if (gou && gsk && skillActive(gou, gsk)) {
      const held = gou.heldDice ?? (gou.heldDice = []);
      if (!held.some((h) => h.value === gouhunPoint)) {
        const chipId = `${pa.attacker}-${gou.id}-held-${gouhunPoint}`;
        held.push({ id: chipId, value: gouhunPoint });
        logLine(g, `${pname(pa.attacker)} 「勾魂」：将本次攻击骰（${gouhunPoint} 点）置于「${gou.name}」上`);
        fxSkillFired(g, pa.attacker, 'xuyu.alt.gouhun');
        // 动效旁路：参考裁雨流——攻击骰从中间飞向该神器标题栏、变灰存放
        fxPush({ kind: 'gouhun', player: pa.attacker, artifactId: gou.id, chipId, value: gouhunPoint });
      }
    }
  }
  // 001 裁雨流：当你使用攻击骰造成伤害后（每回合最多 3 次）
  if (res.damageDealt > 0 && pa.physical && pa.sourceDieId !== undefined && pa.sourceValue !== undefined) {
    if (hasActiveSkill(atk, 'yuqie.caiyuliu') && g.caiyuliuUsed < 3) {
      fxPush({ kind: 'holdAttackDie', player: pa.attacker, dieId: pa.sourceDieId }); // 攻击骰先停在中间，等玩家决定
      queuePending(g, { kind: 'caiyuliu', player: pa.attacker, dieId: pa.sourceDieId, value: pa.sourceValue });
    }
  }
  // C01 特典·极之境·裁雨流（触发）：使用攻击骰造成伤害后，可重掷该骰并按新点数落区（无次数上限）
  if (res.damageDealt > 0 && pa.physical && pa.sourceDieId !== undefined && pa.sourceValue !== undefined && hasActiveSkill(atk, 'c01.caiyuliu')) {
    fxPush({ kind: 'holdAttackDie', player: pa.attacker, dieId: pa.sourceDieId });
    queuePending(g, { kind: 'c01Caiyuliu', player: pa.attacker, dieId: pa.sourceDieId });
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
  // 不再用"是否处于多段攻击队列"做一刀切抑制：
  //  - 电刑：靠 `usedAttackDie`（**必须有实体攻击骰**）天然防自链——多段攻击的"虚拟段"不触发；
  //  - 雷暴：按卡面"攻击被抵挡后"——**多段攻击中途某段被抵挡时同样触发**。
  {
    const usedAttackDie = pa.physical && pa.sourceDieId !== undefined;
    const dv = dianxingValuesOf(atk);
    if (usedAttackDie && dv && meditationPoolCount(g, pa.attacker) >= 2) {
      queuePending(g, { kind: 'dianxing', player: pa.attacker, values: dv });
    } else if (res.blocked && hasActiveSkill(atk, 'minglei.leibao.trigger') && atk.areas.meditation.length >= 1) {
      // 雷暴是「移动冥想骰」→ 必须数**区域**冥想骰（034 存放骰不可移动，故此处**故意**不用 meditationPoolCount）
      // `else if` 是安全的：电刑(左)/雷暴(右) 同属一件神器，activeMarkerSide 同时只能在一侧 → 不可能同时可用
      queuePending(g, { kind: 'leibao', player: pa.attacker });
    }
  }
  // 031 恶兆·血祭：攻击造成伤害后，按**新计数**对自己造成真伤（放在最后：不截断其它"攻击结算后"触发；
  // 此时攻击已完整结算，即便致死并触发自身「永恒女王」也不算"中断攻击"）。
  {
    const xueji = artifactWithSkill(atk, 'ezhao.xueji');
    if (xueji && hasActiveSkill(atk, 'ezhao.xueji') && res.damageDealt > 0 && (g.phase as string) !== 'gameOver') {
      logLine(g, `${pname(pa.attacker)} 「血祭」：攻击造成伤害，受到 ${xueji.count} 点真实伤害`);
      fxSkillFired(g, pa.attacker, 'ezhao.xueji');
      dealTrueDamage(g, pa.attacker, xueji.count, pa.attacker);
    }
  }
}

/** 若存在多段攻击队列且当前无待决策/待抵挡，则发起下一段虚拟攻击 */
export function pumpAttackQueue(g: GameState): void {
  pumpPending(g); // 先弹出排队中的待决策/018 强制必杀，保证「攻击与攻击之间可中断」
  if (g.pendingAttack || g.pending || g.phase === 'gameOver') return;
  // T16「潜伏」：本回合禁攻 → **一次性清空多段队列**（否则"被禁的攻击"会残留队列 → `challengeStep` 要求队列为空 → 回合卡死 + 界面白等一拍）
  if (attacksBanned(g)) {
    if (g.attackQueue || g.virtualQueue) logLine(g, `「潜伏」：本回合不能进行攻击（多段攻击整段跳过）`);
    g.attackQueue = null;
    g.virtualQueue = null;
    return;
  }
  // 013 电刑：同一攻击者的多段攻击（1/2/3）
  const q = g.attackQueue;
  if (q) {
    const value = q.values.shift()!;
    if (q.values.length === 0) g.attackQueue = null;
    logLine(g, `${pname(q.player)} 「电刑」第 ${value} 点攻击（依次结算）`);
    virtualAttack(g, q.player, value, { skill: '电刑', owner: q.player });
    return;
  }
  // A01 不败之王：技能发起的多次攻击，**攻击者可不同**（你先 5 点 → 对方 3 点 ×2）
  const vq = g.virtualQueue;
  if (vq && vq.length > 0) {
    const next = vq.shift()!;
    if (vq.length === 0) g.virtualQueue = null;
    logLine(g, `${pname(next.attacker)} 「${next.label}」：以 ${next.value} 点发起攻击（依次结算）`);
    virtualAttack(g, next.attacker, next.value, { skill: next.label, owner: next.owner }, { unblockable: next.unblockable });
    // 挑战模式「枭首」：本条攻击用的是**攻击骰区里的那颗真骰**。
    // ⚠️ 这里**不删**它——骰子留在区里（"用掉"发生在**这次攻击结算后**，见 settleAttack）：
    //   于是"新骰飞进来"与"旧骰还并排在区里"能同帧存在，界面再按"先进后出"演；
    //   等待响应期间由界面把区里那颗真骰**藏起来**（观感＝飞出去后区里就没它了）。
    if (next.dieId || next.legendGroup || next.blockKind) {
      const pa = g.pendingAttack as PendingAttack | null; // TS 在函数开头已把它收窄成 null，这里重新取
      if (pa) {
        if (next.dieId) {
          pa.sourceDieId = next.dieId;
          pa.sourceValue = next.value;
        }
        if (next.dieStyle) pa.dieStyle = next.dieStyle;
        if (next.legendGroup) pa.legendGroup = next.legendGroup; // 因"多组"触发的攻击 → 提示"第 K / N 组"
        if (next.blockKind) pa.blockKind = next.blockKind; // Z10：本条只能用该类型骰抵挡
      }
    }
    // 034/A03 菩提·触发（攻击侧）：**用了攻击骰**的攻击（挑战「枭首 / 裁雨流 / 真实之剑 / 无上剑术」等）
    // → 防守方持 034/A03 时同样可取消（卡面＝"对方使用 1 个攻击骰后"）。此时已 `pendingAttack` 停住，不重复 park。
    const curPa = g.pendingAttack as PendingAttack | null;
    if (curPa && maybePutiAttack(g, curPa)) return;
  }
}

/** 017 幽冥·冥界行走（持续）：你的攻击造成伤害后，按「攻击的有效点数」结算 */
function onAttackDamage(g: GameState, attacker: PlayerId, value: number): void {
  const atk = g.players[attacker];
  if (!hasActiveSkill(atk, 'youming.mingjie.continuous')) return;
  fxSkillFired(g, attacker, 'youming.mingjie.continuous');
  if (value === 6) {
    logLine(g, `${pname(attacker)} 「冥界行走」：攻击点数为 6，受到 3 点真实伤害`);
    dealTrueDamage(g, attacker, 3, attacker);
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

/** 真实伤害：不可被防御骰抵挡，直接扣血（009 「高塔铁幕」触发可消耗防御骰取消）。
 *  `source` = 造成该真伤的**来源玩家**（009 只在「来自对方」即 source !== target 时挂起）。 */
export function dealTrueDamage(
  g: GameState,
  target: PlayerId,
  amount: number,
  source: PlayerId,
  opts?: { skipCibei?: boolean; skipLine?: boolean },
): void {
  const p = g.players[target];
  // 动效旁路：真伤"发动即报"（白墨线）——在**任何取消/延后判定之前**发，保证"不管最终有没有造成伤害"都飞线
  if (!opts?.skipLine && amount > 0) fxTrueLine(source, target, amount);
  // 战术牌 T09「慈悲」：**造成者**可将"将造成的真实伤害"取消并改为回复等量生命（整局 1 次）；
  //   `skipCibei` 用于"不发动"后按原路重走（避免再次挂起）。
  if (
    !opts?.skipCibei &&
    source !== target &&
    amount > 0 &&
    g.pending === null &&
    (g.phase as string) !== 'gameOver' &&
    TACTIC_BY_ID[g.players[source].tactic ?? '']?.key === 'cibei' &&
    !g.players[source].tacticOnceUsed
  ) {
    g.pending = { kind: 'ciBei', player: source, target, amount };
    return; // 伤害延后到决策解决时结算
  }
  // 009 高塔铁幕触发：受到**来自对方**的真实伤害时，若有防御骰可消耗 1 个取消（仅当当前无待决策）
  if (
    source !== target &&
    g.pending === null &&
    g.phase !== 'gameOver' &&
    hasActiveSkill(p, 'guwang.trigger') &&
    canPayCosts(g, target, { defense: 1 }, { held: true })
  ) {
    g.pending = { kind: 'guwangCancel', player: target, amount };
    return; // 伤害延后到决策解决时结算
  }
  // L06 死即新生（持续）：**因自己造成的伤害**死亡 → 改为生命重设 13（上限不变、不判负、游戏继续）
  if (source === target && hasActiveSkill(p, 'xiu.sijixinsheng') && p.life - amount <= 0) {
    g.players[target].life = 13;
    logLine(g, `${pname(target)} 「死即新生」：因自己造成的伤害将死亡 → 生命重设为 13`);
    fxSkillFired(g, target, 'xiu.sijixinsheng');
    noteDamageTaken(g, target);
    checkLifeTens(g, target);
  } else {
    // L01 断苇一斩：真伤**实际落到生命上**时，记"造成伤害"（来源＝对方；仅其回合内计）
    if (source !== target && g.activePlayer === source) g.players[source].dealtDamageThisTurn = true;
    tryYonghengQueen(g, target, amount); // L11 永恒女王：**真伤**致死者同样触发
    applyLifeLoss(g, target, amount);
  }
  // T14「赴火」：受到"来源＝对方"的真实伤害 → 反弹等量真伤（自伤/游戏结束自动跳过）
  noteFirstDamageFromOpponent(g, target, amount, source);
  // T17「诱敌」：受到对方真伤后 → 可挂"移动最多 3 颗骰"的可选待决策
  noteYoudiAfterDamage(g, target, amount, source);
  // L06 圆舞（持续）：**受到自己造成的伤害**后 → 强制将 1 个能力骰移动到另 1 个区域
  if (source === target) noteYuanwu(g, target);
}

/** 结算被延后的真实伤害（由 guwangCancel 决策在放弃取消时调用） */
export function applyDeferredTrueDamage(g: GameState, target: PlayerId, amount: number): void {
  const p = g.players[target];
  const before = p.life;
  // L01 断苇一斩：延后的真伤实际结算时，记"造成伤害"（来源＝当前回合玩家）
  if (g.activePlayer !== target) g.players[g.activePlayer].dealtDamageThisTurn = true;
  tryYonghengQueen(g, target, amount); // L11 永恒女王：延后的真伤同样按"真实伤害"处理
  applyLifeLoss(g, target, amount);
  logLine(g, `${pname(target)} 受到 ${amount} 点真实伤害（生命 ${before} → ${p.life}）`);
  // 009 延后的真伤恒为"来自对方" → T14 可反弹（source＝目标玩家）
  noteFirstDamageFromOpponent(g, target, amount, target === 'A' ? 'B' : 'A');
  // T17「诱敌」：同样可挂"移动最多 3 颗骰"的可选待决策
  noteYoudiAfterDamage(g, target, amount, target === 'A' ? 'B' : 'A');
}
