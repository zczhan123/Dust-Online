import type { Artifact, GameState, PlayerId, SkillDef } from '../../core/model/types';
import { hasActiveSkill, skillUseKey } from '../../core/engine/skill-state';
import { ARTIFACT_TEXT } from '../../core/content/artifactText';

export interface SkillStateContext {
  state: GameState;
}

export function kindFromType(type: string): SkillDef['kind'] | undefined {
  if (type.includes('激活')) return 'activation';
  if (type.includes('启动')) return 'activate';
  if (type.includes('必杀')) return 'ultimate';
  if (type.includes('充能')) return 'charge';
  if (type.includes('持续')) return 'continuous';
  if (type.includes('触发')) return 'trigger';
  return undefined;
}

export function isActivatableType(type: string): boolean {
  return type.includes('启动') || type.includes('激活') || type.includes('必杀');
}

export function findSkillKey(
  a: Artifact,
  side: SkillDef['side'],
  type: string,
): string | undefined {
  const kind = kindFromType(type);
  if (kind) {
    const def = a.skills.find((s) => s.side === side && s.kind === kind);
    if (def) return def.key;
  }
  return a.skills.find((s) => s.side === side)?.key;
}

/** 018 至黑：必杀「强制发动」进行中（计数达 5 被引擎强制启动，尚在选择重掷骰）。 */
export function zhihaiForcedFrame(
  ctx: SkillStateContext,
  a: Artifact,
  s: { type: string },
): boolean {
  const pd = ctx.state.pending;
  if (!pd || pd.kind !== 'zhihaiReroll' || !pd.forced) return false;
  if (!s.type.includes('必杀')) return false;
  return ctx.state.players[pd.player].artifacts.includes(a);
}

/** 该神器属于哪名玩家（双方可能持有同名神器，故记录键必须带玩家前缀）。 */
export function ownerIdOfArtifact(state: GameState, a: Artifact): PlayerId | undefined {
  return Object.values(state.players).find((p) => p.artifacts.includes(a))?.id;
}

/** 单条技能行：可用 / 未激活 / 不能再使用 / 激活侧但本次已用完。 */
/** 激活侧是否为「激活」类技能、且当前已不可用（用于「已激活」徽标变灰）。 */
export function activeSideSpent(ctx: SkillStateContext, a: Artifact): boolean {
  const side = a.activeMarkerSide;
  if (!side) return false;
  if (a.continuousLost || a.continuousLostThisTurn) return true;
  const skills = ARTIFACT_TEXT[a.id]?.skills;
  const t =
    skills?.find((s) => s.side === side && s.type.includes('激活')) ??
    skills?.find((s) => s.side === 'only' && s.type.includes('激活'));
  if (!t) return false;
  return skillPartState(ctx, a, t) === 'spent';
}
export function skillPartState(
  ctx: SkillStateContext,
  a: Artifact,
  s: { side: SkillDef['side']; type: string },
): 'on' | 'off' | 'disabled' | 'spent' {
  const key = findSkillKey(a, s.side, s.type);
  const owner = ownerIdOfArtifact(ctx.state, a);
  const markerOk =
    a.allSidesActiveThisTurn === true ||
    (a.activeMarkerSide != null && (s.side === a.activeMarkerSide || s.side === 'only'));
  if (zhihaiForcedFrame(ctx, a, s)) return 'on';
  if (
    key != null &&
    s.type.includes('必杀') &&
    owner != null &&
    ctx.state.ultimatesUsed.includes(skillUseKey(owner, key))
  ) {
    return 'disabled';
  }
  if ((a.continuousLost || a.continuousLostThisTurn) && s.type.includes('持续')) {
    return 'disabled';
  }
  if (key === 'buxiang.cuilian' && a.count >= 3) return 'disabled';
  if (
    a.column === 3 &&
    s.type.includes('充能') &&
    a.chargeLayer >= (a.chargeReq ?? 0)
  ) {
    return 'disabled';
  }
  if (
    key === 'kuangwu.ultimate' &&
    owner != null &&
    hasActiveSkill(ctx.state.players[owner], 'xiva.meiyoulianmin') &&
    ctx.state.dustfall >= 4
  ) {
    return 'on';
  }
  if (s.type.includes('激活') && markerOk) {
    const armedNow =
      a.armedTurn === ctx.state.turnIndex &&
      a.armedSide === (s.side === 'only' ? 'left' : s.side);
    const used =
      key != null &&
      owner != null &&
      ctx.state.skillsUsedThisTurn.includes(skillUseKey(owner, key));
    if (!armedNow || used) return 'spent';
  }
  return markerOk ? 'on' : 'off';
}
