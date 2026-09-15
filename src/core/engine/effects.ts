import type {
  DiceKind,
  Die,
  EffectiveDie,
  GameState,
  PlayerId,
  SlotFill,
  SlotSpec,
} from '../model/types';
import { newDieId } from '../model/dice';

export type { EffectiveDie, SlotFill, SlotSpec } from '../model/types';

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

/** 支付“N 个骰位”的代价：每格 1 颗真骰(类型须匹配) 或 2 颗任意真骰(置换,值5)。
 *  移除所有真骰(返还供应堆)；返回各格“有效骰”；reportConsumed 按“格数”上报。 */
export function paySlots(
  g: GameState,
  player: PlayerId,
  spec: SlotSpec[],
  fills: SlotFill[],
  reportConsumed?: (n: number) => void,
): EffectiveDie[] {
  if (fills.length !== spec.length) throw new Error(`expect ${spec.length} slot fills, got ${fills.length}`);
  const used = new Set<string>();
  const effective: EffectiveDie[] = [];
  const toRemove: string[] = [];
  for (let i = 0; i < spec.length; i++) {
    const { kind } = spec[i];
    const ids = fills[i]?.dieIds ?? [];
    if (ids.length !== 1 && ids.length !== 2) throw new Error('each slot needs 1 (real) or 2 (converted) dice');
    for (const id of ids) {
      if (used.has(id)) throw new Error(`duplicate die id: ${id}`);
      used.add(id);
      if (!findDieOf(g, player, id)) throw new Error(`not your die: ${id}`);
    }
    if (ids.length === 1) {
      const found = findDieOf(g, player, ids[0])!;
      if (found.kind !== kind) throw new Error(`slot needs a ${kind} die, got ${found.kind}`);
      effective.push({ kind, value: found.die.value, source: 'real', realIds: [ids[0]] });
    } else {
      effective.push({ kind, value: 5, source: 'converted', realIds: [...ids] });
    }
    toRemove.push(...ids);
  }
  // 移除并返还供应堆（按当前所在区域移除）
  for (const id of toRemove) {
    for (const k of KINDS) {
      g.players[player].areas[k] = g.players[player].areas[k].filter((d) => d.id !== id);
    }
  }
  reportConsumed?.(spec.length);
  return effective;
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
