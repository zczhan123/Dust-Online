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
