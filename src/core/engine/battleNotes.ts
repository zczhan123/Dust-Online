import type { DiceKind, GameState, PlayerId } from '../model/types';
import { hasActiveSkill, skillUseKey } from './skill-state';
import { artifactWithSkill, attackDamageBonus } from './combat';
import { canPayCosts } from './effects';
import { canTreatAsAttack, canUseHanguang } from './game';
import { TACTIC_BY_ID } from '../content/tactics';

const KINDS: DiceKind[] = ['attack', 'defense', 'meditation'];
const oppOf = (p: PlayerId): PlayerId => (p === 'A' ? 'B' : 'A');

/** 一条「攻击提示」：技能名（UI 上色）+ 说明文案（含数值；**不写发动条件**，因为只列出此刻可用的） */
export interface BattleNote {
  label: string;
  text: string;
}

/**
 * 主要阶段的「攻击提示」：列出**此刻真正可用**的、与攻击相关的修正与追击效果。
 * 纯读状态、数据驱动（不硬编码卡牌）——**新增神器/卡牌必须在此登记自己的提示**并补测试。
 * 顺序按一次攻击的时间线：加成 → 攻击前的选择 → 被抵挡时 → 造成伤害后 → 负面状态。
 */
export function battleNotes(g: GameState, player: PlayerId): BattleNote[] {
  if (g.phase !== 'main') return [];
  // 只在「你自己的行动窗口」显示（真实事故：被问是否抵挡时，仍显示自己「下次攻击」的提示）：
  //   ① 必须是你的回合；② 没有被要求抵挡；③ 若有待决策，必须属于你
  //   （③ 允许 022/027 的「使用攻击骰前」待决策——那正是最该看到提示的时刻）
  if (g.activePlayer !== player) return [];
  if (g.pendingAttack) return [];
  if (g.pending && g.pending.player !== player) return [];
  const p = g.players[player];
  const notes: BattleNote[] = [];

  // A 攻击伤害加成（含带来源的本回合 Buff，例如「献祭」②）
  const bonus = attackDamageBonus(g, player);
  // 「横贯 / 吞虎之狼」这类**整回合生效的第 N 次攻击**加成，另有下方"常驻提醒"条目承载
  //（用户 2026-09-28 要求：不看已攻击次数、一直提醒）→ 本条**跳过它们**，保证"一个信息只有一个渲染来源"。
  const STANDING_BONUS_LABELS = new Set(['横贯', '吞虎之狼']);
  if (bonus.value > 0 && !STANDING_BONUS_LABELS.has(bonus.label ?? '')) {
    const label = bonus.label ?? '攻击加成';
    let text = `攻击伤害 +${bonus.value}`;
    if (bonus.label === '寰宇飞升') text = `本回合第一次攻击将 +${bonus.value} 伤害`;
    else if (bonus.label === '迟来的正义') text = `攻击伤害 +${bonus.value}（＝当前尘落，最大 4）`;
    notes.push({ label, text });
  }

  // A **常驻提醒**（不看本回合已发起几次攻击）：
  //  - 025 屠虎·横贯（持续）：本回合第 2 次攻击伤害 +2
  //  - L09 传奇面板·吞虎之狼（持续）：本回合第 3 次攻击伤害 +3
  if (hasActiveSkill(p, 'tuohu.hengguan')) {
    notes.push({ label: '横贯', text: '本回合的第 2 次攻击伤害 +2' });
  }
  if (hasActiveSkill(p, 'lifeng.tunhuzhilang')) {
    notes.push({ label: '吞虎之狼', text: '本回合的第 3 次攻击伤害 +3' });
  }

  // A L06 无光领域（持续状态）：你的攻击点数视为 ±1
  if (p.wuguang === 'up' || p.wuguang === 'down') {
    notes.push({
      label: '无光领域',
      text:
        p.wuguang === 'up'
          ? '你的攻击点数视为上升 1 点（最大 6）'
          : '你的攻击点数视为下降 1 点（最小 1）',
    });
  }

  // A/D 攻击前的选择：025 屠虎·奇袭（持续·左）：有「点数不在对方任意区域」的能力骰时可用
  if (hasActiveSkill(p, 'tuohu.qixi')) {
    const candidates = [...p.areas.defense, ...p.areas.meditation];
    if (candidates.some((d) => canTreatAsAttack(g, player, d.id))) {
      notes.push({ label: '奇袭', text: '可将点数不在对方区域的能力骰视为攻击骰' });
    }
  }

  // A（不可抵挡）：L07 传奇面板·无尽追猎（持续）——攻击骰区恰剩 1 颗时，用它可以打出不可抵挡的攻击
  if (hasActiveSkill(p, 'nisa.wujinzhulie') && p.areas.attack.length === 1) {
    notes.push({ label: '无尽追猎', text: '攻击骰区仅剩 1 颗攻击骰 → 用它攻击时不可抵挡' });
  }

  // D 攻击前的选择：022 死契·处刑通牒（计数 ≥1）
  const siji = artifactWithSkill(p, 'siji.chuxing');
  if (hasActiveSkill(p, 'siji.chuxing') && (siji?.count ?? 0) >= 1) {
    // L08 传奇面板·只为赏金而来：实际发动后还可额外启动 1 个「启动式」技能
    const shangjin = hasActiveSkill(p, 'xiva.zhiweishangjin') ? '（发动后还可额外启动 1 个「启动式」技能）' : '';
    notes.push({ label: '处刑通牒', text: `使用攻击骰前，可令本次伤害 +1 且不可抵挡，或 +5${shangjin}` });
  }

  // D 攻击前的选择：027 寒光·必杀（神器上仍有骰子）
  if (canUseHanguang(g, player)) {
    notes.push({
      label: '凛冽之音',
      text: '使用攻击骰前：可将神器上 1 颗骰移入对应区域，或移除它并弃置对方同点数的能力骰',
    });
  }

  // A/D 攻击前的选择：L02 传奇面板·残影（「影袭」本回合仍可启动）
  if (hasActiveSkill(p, 'ying.canying') && hasActiveSkill(p, 'yingle.yingxi')) {
    const used = g.skillsUsedThisTurn.filter((k) => k === skillUseKey(player, 'yingle.yingxi')).length;
    if (used < 2 && KINDS.some((k) => p.areas[k].some((d) => d.value >= 2))) {
      notes.push({ label: '残影', text: `「影袭」本回合还可启动 ${2 - used} 次` });
    }
  }

  // A/D L04 无上剑术（持续）：使用 5 点攻击骰 → 回复 1 生命；使用 5 点防御骰 → 造成 1 真实伤害
  if (hasActiveSkill(p, 'tata.wushangjianshu')) {
    const hasFive = p.areas.attack.some((d) => d.value === 5) || p.areas.defense.some((d) => d.value === 5);
    const canConvert =
      hasActiveSkill(p, 'shenhong.sword') &&
      p.areas.attack.length + p.areas.defense.length + p.areas.meditation.length >= 2;
    if (hasFive || canConvert) {
      notes.push({
        label: '无上剑术',
        text: '使用 5 点攻击骰 → 回复 1 生命；使用 5 点防御骰 → 造成 1 点真实伤害',
      });
    }
  }

  // B 被抵挡时：025 屠虎·横贯·触发（对方有可弃置、且点数小于「可用攻击骰」的能力骰）
  if (hasActiveSkill(p, 'tuohu.hengguan.trigger')) {
    const maxAtk = p.areas.attack.reduce((m, d) => Math.max(m, d.value), 0);
    const opp = oppOf(player);
    const hasTarget = KINDS.some((k) => g.players[opp].areas[k].some((d) => d.value < maxAtk));
    if (maxAtk > 0 && hasTarget) {
      notes.push({ label: '横贯', text: '攻击被抵挡时，可弃置对方 1 颗点数小于该攻击的能力骰' });
    }
  }

  // B 被抵挡时：004 不祥·锋芒·触发（需 1 攻击骰 + 1 冥想骰；含置换与 034/A03 存放骰）
  if (
    hasActiveSkill(p, 'buxiang.fengmang.trigger') &&
    canPayCosts(g, player, { attack: 1, meditation: 1 }, { held: true })
  ) {
    notes.push({ label: '锋芒', text: '攻击被抵挡时，可追加 2 真实伤害' });
  }
  // B 被抵挡时：L02 传奇面板·暗夜凶神（通过「锋芒」取消对方防御骰后，「不祥」计数可 +1，最高 3 层）
  if (
    hasActiveSkill(p, 'ying.anyexiongshen') &&
    hasActiveSkill(p, 'buxiang.fengmang.trigger') &&
    (artifactWithSkill(p, 'buxiang.fengmang')?.count ?? 0) < 3 &&
    canPayCosts(g, player, { attack: 1, meditation: 1 }, { held: true })
  ) {
    notes.push({ label: '暗夜凶神', text: '通过「锋芒」取消对方防御骰后，可使「不祥」计数 +1（最高 3 层）' });
  }
  // B 被抵挡时：013 鸣雷·雷暴·触发（需 1 冥想骰；含置换与 034/A03 存放骰）
  if (hasActiveSkill(p, 'minglei.leibao.trigger') && canPayCosts(g, player, { meditation: 1 }, { held: true })) {
    notes.push({ label: '雷暴', text: '攻击被抵挡时，可将最多 2 个冥想骰移到攻击骰区' });
  }
  // B 被抵挡时：021 决意·野火燎原（计数 = 5）
  const jueyi = artifactWithSkill(p, 'jueyi.wildfire.continuous');
  if (hasActiveSkill(p, 'jueyi.wildfire.continuous') && (jueyi?.count ?? 0) >= 5) {
    notes.push({ label: '野火燎原', text: '攻击被抵挡时，仍造成一半伤害（向下取整）' });
  }

  // C 造成伤害后：L05 传奇面板·无法饶恕（对方有"点数＝某可用攻击点数"的防御骰时）
  if (hasActiveSkill(p, 'zoray.wufaraoshu')) {
    const oppId = oppOf(player);
    const hasTarget = p.areas.attack.some((d) =>
      g.players[oppId].areas.defense.some((x) => x.value === d.value),
    );
    if (hasTarget) {
      notes.push({ label: '无法饶恕', text: '攻击造成伤害后，可弃置对方 1 个与该攻击点数相同的防御骰' });
    }
  }

  // C 造成伤害后（回血 / 伤害类型）：017 幽冥·冥界行走·持续
  if (hasActiveSkill(p, 'youming.mingjie.continuous')) {
    notes.push({
      label: '冥界行走',
      text: '攻击造成伤害后，回复该点数一半的生命（向上取整）；若攻击点数为 6，则受 3 真实伤害',
    });
  }

  // C 不可抵挡：001 雨切·中央突破（本回合状态）
  if (g.unblockableThisTurn) {
    notes.push({ label: '中央突破', text: '本回合攻击不可抵挡' });
  }

  // C 不可抵挡的变体：028 天罚·白昼之火 / 陨落（本回合状态）；A05 异相无固定值（+3 伤害由上面的攻击加成提示给出）
  const tianfa = g.tianfa[player];
  if (tianfa) {
    const blockCn = tianfa.blockKind === 'meditation' ? '冥想' : '攻击';
    if (tianfa.value !== undefined) {
      notes.push({
        label: tianfa.blockKind === 'meditation' ? '白昼之火' : '陨落',
        text: `本回合攻击点数视为 ${tianfa.value}，且对方只能用${blockCn}骰抵挡`,
      });
    } else {
      notes.push({
        label: tianfa.blockKind === 'meditation' ? '深空之火' : '陨落',
        text: `本回合对方只能用${blockCn}骰抵挡；你造成 2 次伤害后立即结束主要阶段`,
      });
    }
  }

  // C/D 技能后追击：L03 传奇面板·拔城（「主宰」技能启动后，若对方弃置数 < 你消耗数 → 视为以 5 点攻击并切换主宰）
  if (hasActiveSkill(p, 'batton.bacheng')) {
    const zhuzai = p.artifacts.find((a) =>
      a.skills.some((s) => s.key === 'zhuzai.sweep' || s.key === 'zhuzai.smash'),
    );
    const side = zhuzai?.activeMarkerSide;
    const key = side === 'left' ? 'zhuzai.sweep' : side === 'right' ? 'zhuzai.smash' : null;
    if (key && hasActiveSkill(p, key) && !g.skillsUsedThisTurn.includes(skillUseKey(player, key))) {
      notes.push({
        label: '拔城',
        text: '启动「主宰」技能后，若对方弃置的能力骰少于你消耗的，可视为以 5 点攻击 1 次并切换「主宰」技能',
      });
    }
  }

  // E 负面状态：023 蛇蝎·畏惧（仅其下个回合内生效）
  if (p.attackHalvedNextTurn) {
    notes.push({ label: '畏惧', text: '本回合攻击伤害减半' });
  }

  // E 负面状态：031 恶兆·血祭（持续）——自己的攻击造成伤害后，按计数受到真实伤害
  if (hasActiveSkill(p, 'ezhao.xueji')) {
    const xueji = artifactWithSkill(p, 'ezhao.xueji');
    notes.push({ label: '血祭', text: `攻击造成伤害后，你受到 ${xueji?.count ?? 0} 点真实伤害（计数）` });
  }

  // F 战术牌·T04「末路」（触发）：启动「必杀式」后造成/回复＝第三列神器充能需求
  if (TACTIC_BY_ID[p.tactic ?? '']?.key === 'molu') {
    const req = p.artifacts.find((a) => a.column === 3)?.chargeReq ?? 0;
    if (req > 0) {
      notes.push({
        label: '末路',
        text: `启动「必杀式」后，造成 ${req} 点真实伤害并回复 ${req} 点生命（＝第三列神器充能需求）`,
      });
    }
  }

  // F 战术牌·T09「慈悲」（整局 1 次）：造成伤害时可取消并回复等量生命
  if (TACTIC_BY_ID[p.tactic ?? '']?.key === 'cibei' && !p.tacticOnceUsed) {
    notes.push({ label: '慈悲', text: '造成伤害时，可取消该伤害并回复等量生命（整局 1 次）' });
  }

  return notes;
}
