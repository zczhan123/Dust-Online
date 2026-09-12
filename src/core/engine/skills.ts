import type { Artifact, PlayerState, SkillDef } from '../model/types';

export function skillActive(a: Artifact, s: SkillDef): boolean {
  return s.side === 'only' ? a.activeMarkerSide != null : a.activeMarkerSide === s.side;
}

/** 该玩家是否有某 key 的技能处于激活状态（持续效果判定用） */
export function hasActiveSkill(p: PlayerState, key: string): boolean {
  return p.artifacts.some((a) => a.skills.some((s) => s.key === key && skillActive(a, s)));
}
