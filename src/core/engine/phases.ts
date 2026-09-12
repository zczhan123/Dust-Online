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
