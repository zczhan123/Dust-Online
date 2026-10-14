import type { Artifact, GameState, PlayerId } from '../model/types';
import { heal } from './effects';
import { sideCn } from './log';

/**
 * 第三列「充能 +1」的**唯一入口**：`applyDustRiseToArtifact` 与 L03「统御战场」等**所有**"给第三列充能"的效果
 * 都必须走这里——层数 +1；**达到 `chargeReq` 即激活**（设 `activeMarkerSide='left'` + `armedSide/armedTurn`）。
 * （真实事故：统御战场曾手写 `chargeLayer += 1` 漏掉激活 → 009/A01「孤王」永远未激活、触发/必杀就绪不了。）
 */
export function chargeLayerUp(g: GameState, a: Artifact): string {
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

/** 第三列神器是否还能被尘起行动选中：未完成充能，或（021 决意等）完成后仍可「续充」且计数未满 */
export function canTargetForDustRise(a: Artifact): boolean {
  if (a.column === 3) {
    if (a.chargeLayer < (a.chargeReq ?? 0)) return true;
    if (a.chargeExtend && a.count < (a.countCap ?? Infinity)) return true;
    return false;
  }
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

  if (a.column === 3) {
    const req = a.chargeReq ?? 0;
    // 已完成充能（已激活）：021 决意「续充」——改为计数 +1（上限），并回复等同计数的生命
    if (a.chargeLayer >= req) {
      if (!a.chargeExtend) throw new Error(`artifact ${artifactId} cannot be dust-risen anymore`);
      const cap = a.countCap ?? Infinity;
      if (a.count >= cap) throw new Error(`artifact ${artifactId} count is full`);
      a.count += 1;
      const healed = heal(g, player, a.count);
      return `为「${a.name}」继续充能：计数 +1（${a.count}${Number.isFinite(cap) ? `/${cap}` : ''}）${
        healed > 0 ? `，回复 ${healed} 点生命` : ''
      }`;
    }
    return chargeLayerUp(g, a);
  }

  if (a.activeMarkerSide == null) {
    const chosen = side ?? 'left';
    a.activeMarkerSide = chosen;
    a.armedSide = chosen;
    a.armedTurn = g.turnIndex;
    return `激活「${a.name}」的${sideCn(chosen)}侧`;
  }

  a.activeMarkerSide = a.activeMarkerSide === 'left' ? 'right' : 'left';
  a.armedSide = a.activeMarkerSide;
  a.armedTurn = g.turnIndex;
  return `将「${a.name}」切换到${sideCn(a.activeMarkerSide)}侧`;
}
