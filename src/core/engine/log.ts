import type { GameState, Phase, PlayerId } from '../model/types';

export function pname(id: PlayerId): string {
  return id === 'A' ? '玩家A' : '玩家B';
}

export function logLine(g: GameState, text: string, phase: Phase = g.phase): void {
  g.log.push({ turn: g.turnIndex, phase, text });
}

export function vals(dice: { value: number }[]): string {
  return dice.map((d) => `${d.value}点`).join('、');
}
