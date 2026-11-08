import type { GameState, PlayerId } from '../model/types';
import { alliesOf, enemiesOf } from '../model/participants';

/**
 * 2v2 目标策略（按 effect，不按卡）：
 * - anySeat：自己 + 队友 + 两名敌人（卡面“任意玩家”）
 * - selfOrEnemy：自己 + 两名敌人，不含队友
 * - enemyOnly：只能两名敌人
 * - forced：卡面写死（调用方直接给目标，不做候选校验）
 * - none：不需要目标
 */
export type TargetPolicy = 'anySeat' | 'selfOrEnemy' | 'enemyOnly' | 'forced' | 'none';

export function targetCandidates(
  g: GameState,
  actor: PlayerId,
  policy: TargetPolicy,
): PlayerId[] {
  switch (policy) {
    case 'none':
    case 'forced':
      return [];
    case 'enemyOnly':
      return enemiesOf(g, actor);
    case 'selfOrEnemy':
      return [actor, ...enemiesOf(g, actor)];
    case 'anySeat':
      return [actor, ...alliesOf(g, actor), ...enemiesOf(g, actor)];
  }
}

/** 校验并落定目标；没有 target 时只有唯一候选才允许自动落定。 */
export function resolvePolicyTarget(
  g: GameState,
  actor: PlayerId,
  policy: TargetPolicy,
  target?: PlayerId | null,
): PlayerId {
  if (policy === 'none') throw new Error('this effect has no target');
  if (policy === 'forced') {
    if (!target) throw new Error('forced target is required');
    return target;
  }
  const candidates = targetCandidates(g, actor, policy);
  if (target) {
    if (!candidates.includes(target)) throw new Error(`invalid target for ${policy}: ${target}`);
    return target;
  }
  if (candidates.length === 1) return candidates[0];
  throw new Error(`target required for ${policy}`);
}
