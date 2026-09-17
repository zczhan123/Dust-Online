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
 * 返回一段可读的中文描述，供战报日志使用。
 */
export function applyDustRiseToArtifact(
  g: GameState,
  player: PlayerId,
  artifactId: string,
  side?: 'left' | 'right',
): string {
  const a = g.players[player].artifacts.find((x) => x.id === artifactId);
  if (!a) throw new Error(`no artifact: ${artifactId}`);
  if (!canTargetForDustRise(a)) throw new Error(`artifact ${artifactId} cannot be dust-risen`);

  const sideLabel = (s: 'left' | 'right'): string => (s === 'left' ? '左' : '右');

  if (a.column === 3) {
    a.chargeLayer += 1;
    const req = a.chargeReq ?? 0;
    let desc = `为「${a.name}」充能（${a.chargeLayer}/${req}）`;
    if (a.chargeLayer >= req) {
      a.activeMarkerSide = 'left';
      a.armedSide = 'left';
      a.armedTurn = g.turnIndex;
      desc += '，完成充能并激活';
    }
    return desc;
  }

  if (a.activeMarkerSide == null) {
    const chosen = side ?? 'left';
    a.activeMarkerSide = chosen;
    a.armedSide = chosen;
    a.armedTurn = g.turnIndex;
    return `激活「${a.name}」的${sideLabel(chosen)}侧`;
  }

  a.activeMarkerSide = a.activeMarkerSide === 'left' ? 'right' : 'left';
  a.armedSide = a.activeMarkerSide;
  a.armedTurn = g.turnIndex;
  return `将「${a.name}」切换到${sideLabel(a.activeMarkerSide)}侧`;
}
