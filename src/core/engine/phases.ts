import type { DiceKind, GameState, PlayerId } from '../model/types';
import type { Rng } from '../rng/rng';
import { createDie, newDieId, placeDieByDistribution } from '../model/dice';
import { effectiveSpeed, effectiveWill, emptyDistribution, totalDice } from './derive';
import { logLine, pname, vals } from './log';
import { dealTrueDamage } from './combat';

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
  logLine(
    g,
    count > 0 ? `${pname(player)} 补充 ${count} 颗能力骰` : `${pname(player)} 无需补充能力骰`,
    'refill',
  );
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
  const newDice: Die[] = [];
  for (const id of dieIds) {
    const value = rng.rollDie();
    const die: Die = { id, value, kind: areaOf(value, dist) };
    p.areas[die.kind].push(die);
    newDice.push(die);
  }
  logLine(g, `${pname(player)} 重掷 ${dieIds.length} 颗能力骰（新点数：${vals(newDice)}）`, 'reroll');
}

/**
 * 统一的重掷入口：执行重掷 → 然后结算 027「凛冽之音」（充能）的惩罚。
 * FAQ 27.1.2：**谁的区域中的能力骰被重掷，谁受到伤害**（与发起重掷的人无关）。
 * 惩罚同时存在多个（双方各持有 027）时**不叠加**：一次重掷只结算一次等量真实伤害。
 */
export function doReroll(g: GameState, player: PlayerId, dieIds: string[], rng: Rng): void {
  rerollPhase(g, player, dieIds, rng);
  if (dieIds.length === 0) return;
  // 027 寒光·凛冽之音（充能）：持有者的下个尘起阶段开始前，任何人重掷都会使「被重掷方」受伤
  const holders = (['A', 'B'] as PlayerId[]).filter((id) => g.rerollPunish[id]);
  if (holders.length === 0) return;
  if (g.phase === 'gameOver') return;
  // 伤害来源 = 027 持有者；若持有者恰为「被重掷方」（自掷）则取另一方（保证「来自对方」的 009 判定正确）
  const source = holders.find((id) => id !== player) ?? player;
  dealTrueDamage(g, player, dieIds.length, source);
  logLine(
    g,
    `${pname(player)} 因「凛冽之音」受到 ${dieIds.length} 点真实伤害（被重掷 ${dieIds.length} 颗能力骰）`,
  );
}

/** 结束阶段：弃置多余能力骰至意志上限。
 *  `dieIds` = 玩家显式选择的骰（必须恰好等于当前超出数）；省略 → 按 冥想→攻击→防御 的**默认**顺序弃（仅供 AI/测试）。
 *  返回实际弃置数量。 */
export function endPhase(g: GameState, player: PlayerId, dieIds?: string[]): number {
  const p = g.players[player];
  const will = effectiveWill(p);
  const excess = totalDice(p) - will;
  if (excess <= 0) return 0;
  let discarded = 0;
  if (dieIds) {
    if (dieIds.length !== excess) throw new Error(`结束阶段需弃置恰好 ${excess} 颗能力骰`);
    if (new Set(dieIds).size !== dieIds.length) throw new Error('duplicate die id');
    const kinds: DiceKind[] = ['attack', 'defense', 'meditation'];
    // 先整体校验归属（不通过则不改状态）
    for (const id of dieIds) {
      if (!kinds.some((k) => p.areas[k].some((d) => d.id === id))) throw new Error(`not your ability die: ${id}`);
    }
    for (const id of dieIds) {
      for (const k of kinds) {
        const idx = p.areas[k].findIndex((d) => d.id === id);
        if (idx >= 0) {
          p.areas[k].splice(idx, 1);
          break;
        }
      }
    }
    discarded = dieIds.length;
  } else {
    let left = excess;
    for (const kind of ['meditation', 'attack', 'defense'] as const) {
      while (left > 0 && p.areas[kind].length > 0) {
        p.areas[kind].pop();
        left -= 1;
      }
      if (left <= 0) break;
    }
    discarded = excess - left;
  }
  if (discarded > 0) {
    logLine(g, `${pname(player)} 弃置 ${discarded} 颗能力骰（超出意志上限）`, 'end');
  }
  return discarded;
}
