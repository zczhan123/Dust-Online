import type { DiceKind, Die, Distribution } from './types';

let counter = 0;

export function createDie(id: string, value: number, kind: DiceKind = 'meditation'): Die {
  if (!Number.isInteger(value) || value < 1 || value > 6) {
    throw new Error(`invalid die value: ${value}`);
  }
  return { id, value, kind };
}

export function newDieId(prefix = 'd'): string {
  counter += 1;
  return `${prefix}${counter}`;
}

export function areaOf(value: number, dist: Distribution): DiceKind {
  if (dist.defense.includes(value)) return 'defense';
  if (dist.attack.includes(value)) return 'attack';
  if (dist.meditation.includes(value)) return 'meditation';
  throw new Error(`value ${value} not covered by distribution`);
}

export function placeDieByDistribution(
  areas: Record<DiceKind, Die[]>,
  die: Die,
  dist: Distribution,
): void {
  const kind = areaOf(die.value, dist);
  die.kind = kind;
  areas[kind].push(die);
}

export function resetDieIdCounter(): void {
  counter = 0;
}

/** 只读：拿到当前计数器（供"状态副本试算"用；试算结束必须复原，否则会浪费 id）。 */
export function getDieIdCounter(): number {
  return counter;
}

/** 复原计数器（搭配 `getDieIdCounter`）。 */
export function setDieIdCounter(n: number): void {
  counter = n;
}
