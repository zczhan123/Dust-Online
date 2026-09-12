import type { Artifact, GameState, PlayerId } from '../model/types';

/** 第三列神器是否还能被尘起行动选中（未完成充能才行） */
export function canTargetForDustRise(a: Artifact): boolean {
  if (a.column === 3) return a.chargeLayer < (a.chargeReq ?? 0);
  return true;
}

/**
 * 尘起行动对神器的状态变更（不含代价与回合限制，那些由动作层处理）。
 * - 第一/二列：无标记→激活到指定侧；有标记→切换到另一侧。
 * - 第三列：充能层数 +1；达到需求即激活（唯一槽记为 left）。
 */
export function applyDustRiseToArtifact(
  g: GameState,
  player: PlayerId,
  artifactId: string,
  side?: 'left' | 'right',
): void {
  const a = g.players[player].artifacts.find((x) => x.id === artifactId);
  if (!a) throw new Error(`no artifact: ${artifactId}`);
  if (!canTargetForDustRise(a)) throw new Error(`artifact ${artifactId} cannot be dust-risen`);

  if (a.column === 3) {
    a.chargeLayer += 1;
    if (a.chargeLayer >= (a.chargeReq ?? 0)) a.activeMarkerSide = 'left';
    return;
  }

  if (a.activeMarkerSide == null) {
    a.activeMarkerSide = side ?? 'left';
  } else {
    a.activeMarkerSide = a.activeMarkerSide === 'left' ? 'right' : 'left';
  }
}
