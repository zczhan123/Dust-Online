import type { Buff, Distribution, PlayerState } from '../model/types';
import { hasActiveSkill } from './skills';

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

export function effectiveSpeed(p: PlayerState): number {
  const extra = hasActiveSkill(p, 'youlong.wanxiang') ? 1 : 0;
  return baseSpeed(p) + Math.max(maxBuff(p, 'speed'), extra);
}

export function effectiveWill(p: PlayerState): number {
  return baseWill(p) + maxBuff(p, 'will');
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
