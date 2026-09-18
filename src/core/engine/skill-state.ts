import type { Artifact, PlayerState, SkillDef } from '../model/types';

export function skillActive(a: Artifact, s: SkillDef): boolean {
  const markerOk = s.side === 'only' ? a.activeMarkerSide != null : a.activeMarkerSide === s.side;
  if (!markerOk) return false;
  // 「在接下来的游戏中失去持续式效果」是通用规则：该神器的持续技能（及其属性/触发加成）一律停止
  if (s.kind === 'continuous' && a.continuousLost) return false;
  return true;
}

/** 该玩家是否有某 key 的技能处于激活状态（持续效果判定用） */
export function hasActiveSkill(p: PlayerState, key: string): boolean {
  return p.artifacts.some((a) => a.skills.some((s) => s.key === key && skillActive(a, s)));
}
