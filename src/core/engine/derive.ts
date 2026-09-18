import type { Buff, Distribution, PlayerState } from '../model/types';
import { hasActiveSkill } from './skill-state';

export function artifactByColumn(p: PlayerState, column: 1 | 2 | 3) {
  return p.artifacts.find((a) => a.column === column);
}

export function baseSpeed(p: PlayerState): number {
  return artifactByColumn(p, 1)?.speed ?? 0;
}

export function baseWill(p: PlayerState): number {
  return artifactByColumn(p, 1)?.will ?? 0;
}

export function emptyDistribution(p: PlayerState): Distribution | undefined {
  return artifactByColumn(p, 2)?.distribution;
}

function maxBuff(p: PlayerState, attr: Buff['attr']): number {
  const adds = p.buffs.filter((b) => b.attr === attr).map((b) => b.add);
  return adds.length ? Math.max(...adds) : 0;
}

/** 激活中的持续技能提供的属性加成（同类取最大，不叠加） */
function skillAttributeBonuses(p: PlayerState): { speed: number; will: number } {
  let speed = 0;
  let will = 0;
  if (hasActiveSkill(p, 'youlong.wanxiang')) speed = Math.max(speed, 1);
  if (hasActiveSkill(p, 'monv.awaken')) {
    speed = Math.max(speed, Math.min(3, p.areas.meditation.length));
    will = Math.max(will, 1);
  }
  if (hasActiveSkill(p, 'tiebi.chariot')) will = Math.max(will, 1);
  if (hasActiveSkill(p, 'canxiang.juejing')) will = Math.max(will, 1);
  // 016 虚臾·虚无形态（持续）：你的速度 +2（仅激活该侧时）
  if (hasActiveSkill(p, 'xuyu.void.continuous')) speed = Math.max(speed, 2);
  return { speed, will };
}

export function effectiveSpeed(p: PlayerState): number {
  const bonus = skillAttributeBonuses(p).speed;
  return baseSpeed(p) + Math.max(maxBuff(p, 'speed'), bonus);
}

export function effectiveWill(p: PlayerState): number {
  const bonus = skillAttributeBonuses(p).will;
  return baseWill(p) + Math.max(maxBuff(p, 'will'), bonus);
}

export function totalDice(p: PlayerState): number {
  return p.areas.attack.length + p.areas.defense.length + p.areas.meditation.length;
}

export function initialLife(p: PlayerState): number {
  return artifactByColumn(p, 3)?.life ?? 0;
}

export function rerollAllowance(p: PlayerState): number {
  return hasActiveSkill(p, 'youlong.wanxiang') ? 2 : 1;
}
