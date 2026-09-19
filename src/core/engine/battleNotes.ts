import type { DiceKind, GameState, PlayerId } from '../model/types';
import { hasActiveSkill } from './skill-state';
import { artifactWithSkill, attackDamageBonus } from './combat';

/** 一条「攻击提示」：技能名（UI 上色）+ 说明文案（含数值；**不写发动条件**，因为只列出此刻可用的） */
export interface BattleNote {
  label: string;
  text: string;
}

const countOf = (g: GameState, who: PlayerId, k: DiceKind): number => g.players[who].areas[k].length;

/**
 * 主要阶段的「攻击提示」：列出**此刻真正可用**的、与攻击相关的修正与追击效果。
 * 纯读状态、数据驱动（不硬编码卡牌）——**新增神器/卡牌必须在此登记自己的提示**并补测试。
 * 顺序按一次攻击的时间线：加成 → 攻击前的选择 → 被抵挡时 → 造成伤害后 → 负面状态。
 */
export function battleNotes(g: GameState, player: PlayerId): BattleNote[] {
  if (g.phase !== 'main') return [];
  const p = g.players[player];
  const notes: BattleNote[] = [];

  // A 攻击伤害加成（含带来源的本回合 Buff，例如「献祭」②）
  const bonus = attackDamageBonus(g, player);
  if (bonus.value > 0) {
    notes.push({ label: bonus.label ?? '攻击加成', text: `攻击伤害 +${bonus.value}` });
  }

  // D 攻击前的选择：022 死契·处刑通牒（计数 ≥1）
  const siji = artifactWithSkill(p, 'siji.chuxing');
  if (hasActiveSkill(p, 'siji.chuxing') && (siji?.count ?? 0) >= 1) {
    notes.push({ label: '处刑通牒', text: '使用攻击骰前，可令本次伤害 +1 且不可抵挡，或 +5' });
  }

  // B 被抵挡时：004 不祥·锋芒·触发（需 1 攻击骰 + 1 冥想骰）
  if (
    hasActiveSkill(p, 'buxiang.fengmang.trigger') &&
    countOf(g, player, 'attack') >= 1 &&
    countOf(g, player, 'meditation') >= 1
  ) {
    notes.push({ label: '锋芒', text: '攻击被抵挡时，可追加 2 真实伤害' });
  }
  // B 被抵挡时：013 鸣雷·雷暴·触发（需 1 冥想骰）
  if (hasActiveSkill(p, 'minglei.leibao.trigger') && countOf(g, player, 'meditation') >= 1) {
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

  // E 负面状态：023 蛇蝎·畏惧（仅其下个回合内生效）
  if (p.attackHalvedNextTurn) {
    notes.push({ label: '畏惧', text: '本回合攻击伤害减半' });
  }

  return notes;
}
