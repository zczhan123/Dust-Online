import type { DiceKind, GameState, PlayerId } from '../model/types';
import { hasActiveSkill } from './skill-state';
import { artifactWithSkill, attackDamageBonus } from './combat';
import { canPayCosts } from './effects';
import { canTreatAsAttack, canUseHanguang } from './game';

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
  if (bonus.value > 0) {
    const label = bonus.label ?? '攻击加成';
    // 025 横贯 / 030 寰宇飞升 是"按第几次攻击"生效的加成 → 文案点明第几次
    let text = `攻击伤害 +${bonus.value}`;
    if (bonus.label === '横贯') text = `本回合第二次攻击将 +${bonus.value} 伤害`;
    else if (bonus.label === '寰宇飞升') text = `本回合第一次攻击将 +${bonus.value} 伤害`;
    notes.push({ label, text });
  }

  // A/D 攻击前的选择：025 屠虎·奇袭（持续·左）：有「点数不在对方任意区域」的能力骰时可用
  if (hasActiveSkill(p, 'tuohu.qixi')) {
    const candidates = [...p.areas.defense, ...p.areas.meditation];
    if (candidates.some((d) => canTreatAsAttack(g, player, d.id))) {
      notes.push({ label: '奇袭', text: '可将点数不在对方区域的能力骰视为攻击骰' });
    }
  }

  // D 攻击前的选择：022 死契·处刑通牒（计数 ≥1）
  const siji = artifactWithSkill(p, 'siji.chuxing');
  if (hasActiveSkill(p, 'siji.chuxing') && (siji?.count ?? 0) >= 1) {
    notes.push({ label: '处刑通牒', text: '使用攻击骰前，可令本次伤害 +1 且不可抵挡，或 +5' });
  }

  // D 攻击前的选择：027 寒光·必杀（神器上仍有骰子）
  if (canUseHanguang(g, player)) {
    notes.push({
      label: '凛冽之音',
      text: '使用攻击骰前：可将神器上 1 颗骰移入对应区域，或移除它并弃置对方同点数的能力骰',
    });
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
  // B 被抵挡时：013 鸣雷·雷暴·触发（需 1 冥想骰；含置换与 034/A03 存放骰）
  if (hasActiveSkill(p, 'minglei.leibao.trigger') && canPayCosts(g, player, { meditation: 1 }, { held: true })) {
    notes.push({ label: '雷暴', text: '攻击被抵挡时，可将最多 2 个冥想骰移到攻击骰区' });
  }
  // B 被抵挡时：021 决意·野火燎原（计数 = 5）
  const jueyi = artifactWithSkill(p, 'jueyi.wildfire.continuous');
  if (hasActiveSkill(p, 'jueyi.wildfire.continuous') && (jueyi?.count ?? 0) >= 5) {
    notes.push({ label: '野火燎原', text: '攻击被抵挡时，仍造成一半伤害（向下取整）' });
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

  // E 负面状态：023 蛇蝎·畏惧（仅其下个回合内生效）
  if (p.attackHalvedNextTurn) {
    notes.push({ label: '畏惧', text: '本回合攻击伤害减半' });
  }

  // E 负面状态：031 恶兆·血祭（持续）——自己的攻击造成伤害后，按计数受到真实伤害
  if (hasActiveSkill(p, 'ezhao.xueji')) {
    const xueji = artifactWithSkill(p, 'ezhao.xueji');
    notes.push({ label: '血祭', text: `攻击造成伤害后，你受到 ${xueji?.count ?? 0} 点真实伤害（计数）` });
  }

  return notes;
}
