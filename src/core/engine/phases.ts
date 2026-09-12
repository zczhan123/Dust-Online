import type { GameState, PlayerId } from '../model/types';
import type { Rng } from '../rng/rng';
import { createDie, newDieId, placeDieByDistribution } from '../model/dice';
import { effectiveSpeed, effectiveWill, emptyDistribution, totalDice } from './derive';

/** 补充阶段：补充 min(速度, 意志 - 现有骰数) 颗随机骰，按分布落区 */
export function refillPhase(g: GameState, player: PlayerId, rng: Rng): number {
  const p = g.players[player];
  const dist = emptyDistribution(p);
  if (!dist) throw new Error(`player ${player} has no distribution`);
  const room = Math.max(0, effectiveWill(p) - totalDice(p));
  const count = Math.min(effectiveSpeed(p), room);
  for (let i = 0; i < count; i++) {
    const die = createDie(newDieId(`${player}-`), rng.rollDie());
    placeDieByDistribution(p.areas, die, dist);
  }
  g.log.push({ turn: g.turnIndex, phase: 'refill', text: `${player} 补充 ${count} 颗` });
  return count;
}

import type { Die } from '../model/types';
import { areaOf } from '../model/dice';

function removeDiceByIds(g: GameState, player: PlayerId, ids: Set<string>): void {
  const p = g.players[player];
  for (const kind of ['attack', 'defense', 'meditation'] as const) {
    p.areas[kind] = p.areas[kind].filter((d) => !ids.has(d.id));
  }
}

/** 重掷阶段：重掷指定骰（数量由调用方确保 ≤ 速度），按分布重新落区 */
export function rerollPhase(g: GameState, player: PlayerId, dieIds: string[], rng: Rng): void {
  const p = g.players[player];
  const dist = emptyDistribution(p);
  if (!dist) throw new Error(`player ${player} has no distribution`);
  const ids = new Set(dieIds);
  removeDiceByIds(g, player, ids);
  for (const id of dieIds) {
    const value = rng.rollDie();
    const die: Die = { id, value, kind: areaOf(value, dist) };
    p.areas[die.kind].push(die);
  }
  g.log.push({ turn: g.turnIndex, phase: 'reroll', text: `${player} 重掷 ${dieIds.length} 颗` });
}

/** 结束阶段：弃置多余能力骰至意志上限；返回实际弃置数量 */
export function endPhase(g: GameState, player: PlayerId): number {
  const p = g.players[player];
  const will = effectiveWill(p);
  let excess = totalDice(p) - will;
  if (excess <= 0) return 0;
  const toDiscard = excess;
  const order: ('meditation' | 'attack' | 'defense')[] = ['meditation', 'attack', 'defense'];
  for (const kind of order) {
    while (excess > 0 && p.areas[kind].length > 0) {
      p.areas[kind].pop();
      excess -= 1;
    }
    if (excess <= 0) break;
  }
  g.log.push({ turn: g.turnIndex, phase: 'end', text: `${player} 弃置超出意志的骰子` });
  return toDiscard - excess;
}
