import type { GameState, Phase, PlayerId } from '../model/types';

export const STANDARD_PHASES: Exclude<Phase, 'setup' | 'gameOver'>[] = [
  'refill',
  'reroll',
  'dustRise',
  'main',
  'end',
];

export function shouldSkipPhase(g: GameState, player: PlayerId, phase: Phase): boolean {
  if (g.firstRound[player] && (phase === 'refill' || phase === 'reroll')) return true;
  return false;
}

export function nextPhase(phase: Phase): Phase {
  const i = STANDARD_PHASES.indexOf(phase as (typeof STANDARD_PHASES)[number]);
  if (i < 0 || i === STANDARD_PHASES.length - 1) return 'end';
  return STANDARD_PHASES[i + 1];
}

export function beginTurn(g: GameState): void {
  g.phase = 'refill';
  g.log.push({ turn: g.turnIndex, phase: 'refill', text: `${g.activePlayer} 回合开始` });
}

export function endTurn(g: GameState): void {
  const p = g.players[g.activePlayer];
  g.firstRound[p.id] = false;
  g.activePlayer = g.activePlayer === 'A' ? 'B' : 'A';
  g.turnIndex += 1;
  beginTurn(g);
}
