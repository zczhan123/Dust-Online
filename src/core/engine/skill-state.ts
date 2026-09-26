import type { Artifact, PlayerId, PlayerState, SkillDef } from '../model/types';

/**
 * 「本回合已使用技能 / 必杀已用」的记录键：**按玩家作用域**（`玩家:key`）。
 * 关键：双方可能持有**同名神器**（如双方都拿 009/034，或一方 010、一方异相 A02），
 * 若按裸技能 key 记录，一方的使用会顶掉另一方的同名技能（含必杀整局仅一次）。故一律带玩家前缀。
 */
export function skillUseKey(player: PlayerId, key: string): string {
  return `${player}:${key}`;
}

export function skillActive(a: Artifact, s: SkillDef): boolean {
  const markerOk = s.side === 'only' ? a.activeMarkerSide != null : a.activeMarkerSide === s.side;
  if (!markerOk) return false;
  // 「在接下来的游戏中失去持续式效果」是通用规则：该神器的持续技能（及其属性/触发加成）一律停止
  // A07 异相·完杀必杀：「直到本回合结束前，双方所有持续式效果失效」→ 本回合临时失效（回合开始清除）
  if (s.kind === 'continuous' && (a.continuousLost || a.continuousLostThisTurn)) return false;
  return true;
}

/** 该玩家是否有某 key 的技能处于激活状态（持续效果判定用） */
export function hasActiveSkill(p: PlayerState, key: string): boolean {
  return p.artifacts.some((a) => a.skills.some((s) => s.key === key && skillActive(a, s)));
}
