import { SeededRng } from '../rng/rng';
import { placeDieByDistribution, createDie, newDieId, resetDieIdCounter } from '../model/dice';
import { makeArtifact } from '../content/artifacts';
import { effectiveWill, initialLife, emptyDistribution } from './derive';
import type { GameState, PlayerId, PlayerState } from '../model/types';

export interface SetupOptions {
  seed: number;
  firstPlayer: PlayerId;
  heroA?: [string, string, string];
  heroB?: [string, string, string];
}

function makePlayer(id: PlayerId, hero: [string, string, string]): PlayerState {
  return {
    id,
    areas: { attack: [], defense: [], meditation: [] },
    artifacts: hero.map(makeArtifact),
    life: 0,
    lifeMax: 0,
    markers: 0,
    hasDustSeal: false,
    buffs: [],
  };
}

function fillInitial(p: PlayerState, rng: SeededRng): void {
  const will = effectiveWill(p);
  const dist = emptyDistribution(p);
  if (!dist) throw new Error(`player ${p.id} has no distribution (column 2)`);
  for (let i = 0; i < will; i++) {
    const die = createDie(newDieId(`${p.id}-`), rng.rollDie());
    placeDieByDistribution(p.areas, die, dist);
  }
}

export function setupGame(opts: SetupOptions): GameState {
  resetDieIdCounter();
  const heroA = opts.heroA ?? ['001', '002', '003'];
  const heroB = opts.heroB ?? ['004', '005', '006'];

  const playerA = makePlayer('A', heroA);
  const playerB = makePlayer('B', heroB);

  const lifeA = initialLife(playerA);
  const lifeB = initialLife(playerB);
  playerA.life = playerA.lifeMax = lifeA;
  playerB.life = playerB.lifeMax = lifeB;

  const second: PlayerId = opts.firstPlayer === 'A' ? 'B' : 'A';
  ({ A: playerA, B: playerB })[second].hasDustSeal = true;

  const rng = new SeededRng(opts.seed);
  fillInitial(playerA, rng);
  fillInitial(playerB, rng);

  return {
    players: { A: playerA, B: playerB },
    activePlayer: opts.firstPlayer,
    phase: 'setup',
    dustfall: 0,
    turnIndex: 0,
    firstRound: { A: true, B: true },
    rngState: rng.state(),
    log: [],
    pendingAttack: null,
    dustRiseNormalUsed: false,
    dustRiseActed: false,
    rerollUsed: 0,
    winner: null,
  };
}
