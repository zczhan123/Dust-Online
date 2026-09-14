import type { DiceKind, Die, GameState, PlayerId } from '../model/types';
import { newDieId } from '../model/dice';

const KINDS: DiceKind[] = ['attack', 'defense', 'meditation'];

/** 找到某玩家的某颗骰（返回所在区域与引用），找不到返回 null */
export function findDieOf(g: GameState, player: PlayerId, dieId: string): { kind: DiceKind; die: Die } | null {
  for (const kind of KINDS) {
    const die = g.players[player].areas[kind].find((d) => d.id === dieId);
    if (die) return { kind, die };
  }
  return null;
}

/** 变更某颗骰的点数（保留其所在区域）。返回旧点数 */
export function setDieValue(g: GameState, player: PlayerId, dieId: string, value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 6) {
    throw new Error(`invalid die value: ${value}`);
  }
  const found = findDieOf(g, player, dieId);
  if (!found) throw new Error(`die not found: ${dieId}`);
  const old = found.die.value;
  found.die.value = value;
  return old;
}

/** 把指定骰移动到目标区域（保留点数） */
export function moveDice(g: GameState, player: PlayerId, dieIds: string[], to: DiceKind): void {
  const p = g.players[player];
  for (const id of dieIds) {
    const found = findDieOf(g, player, id);
    if (!found) throw new Error(`die not found: ${id}`);
    p.areas[found.kind] = p.areas[found.kind].filter((d) => d.id !== id);
    found.die.kind = to;
    p.areas[to].push(found.die);
  }
}

/** 回复生命，不超过上限。返回实际回复量 */
export function heal(g: GameState, player: PlayerId, amount: number): number {
  const p = g.players[player];
  const before = p.life;
  p.life = Math.min(p.lifeMax, p.life + amount);
  return p.life - before;
}

/** 随机获得 count 颗指定类型的能力骰（点数为随机）；返回新骰 */
export function gainRandomDice(
  g: GameState,
  player: PlayerId,
  kind: DiceKind,
  count: number,
  rng: { rollDie(): number },
): Die[] {
  const out: Die[] = [];
  const p = g.players[player];
  for (let i = 0; i < count; i++) {
    const die: Die = { id: newDieId(`${player}-`), value: rng.rollDie(), kind };
    p.areas[kind].push(die);
    out.push(die);
  }
  return out;
}
