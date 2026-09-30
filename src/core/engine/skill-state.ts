import type { Artifact, LegendPanel, PlayerId, PlayerState, SkillDef } from '../model/types';

/**
 * 「本回合已使用技能 / 必杀已用」的记录键：**按玩家作用域**（`玩家:key`）。
 * 关键：双方可能持有**同名神器**（如双方都拿 009/034，或一方 010、一方异相 A02），
 * 若按裸技能 key 记录，一方的使用会顶掉另一方的同名技能（含必杀整局仅一次）。故一律带玩家前缀。
 */
export function skillUseKey(player: PlayerId, key: string): string {
  return `${player}:${key}`;
}

export function skillActive(a: Artifact, s: SkillDef): boolean {
  // L09 传奇面板·遍野残杀：本回合"左右两侧技能全部视为处于激活状态" → **只放行"标记"这一项判定**
  //（不复活「失去持续式效果」——那是另一条独立效果）
  const markerOk =
    a.allSidesActiveThisTurn === true ||
    (s.side === 'only' ? a.activeMarkerSide != null : a.activeMarkerSide === s.side);
  if (!markerOk) return false;
  // 「在接下来的游戏中失去持续式效果」是通用规则：该神器的持续技能（及其属性/触发加成）一律停止
  // A07 异相·完杀必杀：「直到本回合结束前，双方所有持续式效果失效」→ 本回合临时失效（回合开始清除）
  if (s.kind === 'continuous' && (a.continuousLost || a.continuousLostThisTurn)) return false;
  return true;
}

/**
 * 传奇英雄面板技能：没有「激活」步骤、开局即可用（`side` 恒为 'only'）。
 * 仅当面板「失去持续式效果」（永久 / 本回合）时，其**持续类**停止生效。
 */
export function legendSkillActive(lg: LegendPanel, s: SkillDef): boolean {
  return !(s.kind === 'continuous' && (lg.continuousLost || lg.continuousLostThisTurn));
}

/** 该玩家是否有某 key 的技能处于激活状态（持续效果判定用）——含传奇英雄面板。 */
export function hasActiveSkill(p: PlayerState, key: string): boolean {
  if (p.artifacts.some((a) => a.skills.some((s) => s.key === key && skillActive(a, s)))) return true;
  const lg = p.legend;
  return !!lg && lg.skills.some((s) => s.key === key && legendSkillActive(lg, s));
}

/** 该玩家的传奇面板持有某 key 且生效 → 返回面板本体（取计数等）；否则 null。 */
export function legendWithSkill(p: PlayerState, key: string): LegendPanel | null {
  const lg = p.legend;
  if (!lg) return null;
  const s = lg.skills.find((x) => x.key === key);
  if (!s || !legendSkillActive(lg, s)) return null;
  return lg;
}
