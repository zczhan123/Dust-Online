import { setupGame, type SetupOptions } from './setup';
import { SeededRng } from '../rng/rng';
import { refillPhase, rerollPhase, endPhase } from './phases';
import { effectiveSpeed, rerollAllowance } from './derive';
import { applyDustRiseToArtifact, canTargetForDustRise } from './dustRise';
import { incrementDustfall } from './dustfall';
import { doAttack, resolveBlock } from './combat';
import type { Action, GameState, PlayerId } from '../model/types';

function withRng(g: GameState, fn: (rng: SeededRng) => void): void {
  const rng = new SeededRng(g.rngState);
  fn(rng);
  g.rngState = rng.state();
}

export function beginTurn(g: GameState): void {
  if (g.phase === 'gameOver') return;
  g.pendingAttack = null;
  g.dustRiseNormalUsed = false;
  g.dustRiseActed = false;
  g.rerollUsed = 0;
  const p = g.activePlayer;
  if (g.firstRound[p]) {
    g.phase = 'dustRise'; // 第一回合跳过补充与重掷
  } else {
    withRng(g, (rng) => refillPhase(g, p, rng));
    g.phase = 'reroll';
  }
}

export function endTurn(g: GameState): void {
  if (g.phase === 'gameOver') return;
  const p = g.players[g.activePlayer];
  p.buffs = p.buffs.filter((b) => b.duration !== 'thisTurn');
  g.firstRound[g.activePlayer] = false;
  g.activePlayer = g.activePlayer === 'A' ? 'B' : 'A';
  g.turnIndex += 1;
  beginTurn(g);
}

export function advancePhase(g: GameState): void {
  if (g.phase === 'gameOver') return;
  switch (g.phase) {
    case 'reroll':
      g.phase = 'dustRise';
      break;
    case 'dustRise':
      if (!g.dustRiseActed) incrementDustfall(g);
      if ((g.phase as string) === 'gameOver') break;
      g.phase = 'main';
      break;
    case 'main':
      endPhase(g, g.activePlayer);
      endTurn(g);
      break;
    default:
      break;
  }
}

export function createGame(opts: SetupOptions): GameState {
  const g = setupGame(opts);
  beginTurn(g);
  return g;
}

function dustRiseActions(g: GameState, player: PlayerId): Action[] {
  const p = g.players[player];
  const acts: Action[] = [];
  const hasMed = p.areas.meditation.length > 0;
  const canNormal = !g.dustRiseNormalUsed && hasMed;
  for (const a of p.artifacts) {
    if (!canTargetForDustRise(a)) continue;
    if (a.column === 3) {
      if (canNormal) acts.push({ t: 'dustRise', artifactId: a.id });
      if (p.hasDustSeal) acts.push({ t: 'dustRise', artifactId: a.id, useSeal: true });
    } else if (a.activeMarkerSide == null) {
      if (canNormal) {
        acts.push({ t: 'dustRise', artifactId: a.id, side: 'left' });
        acts.push({ t: 'dustRise', artifactId: a.id, side: 'right' });
      }
      if (p.hasDustSeal) {
        acts.push({ t: 'dustRise', artifactId: a.id, side: 'left', useSeal: true });
        acts.push({ t: 'dustRise', artifactId: a.id, side: 'right', useSeal: true });
      }
    } else {
      const other = a.activeMarkerSide === 'left' ? 'right' : 'left';
      if (canNormal) acts.push({ t: 'dustRise', artifactId: a.id, side: other });
      if (p.hasDustSeal) acts.push({ t: 'dustRise', artifactId: a.id, side: other, useSeal: true });
    }
  }
  return acts;
}

export function getLegalActions(g: GameState): Action[] {
  if (g.phase === 'gameOver') return [];

  if (g.pendingAttack) {
    const defender: PlayerId = g.pendingAttack.attacker === 'A' ? 'B' : 'A';
    const acts: Action[] = [{ t: 'block' }];
    if (!g.pendingAttack.unblockable) {
      for (const d of g.players[defender].areas.defense) acts.push({ t: 'block', dieId: d.id });
    }
    return acts;
  }

  const p = g.players[g.activePlayer];
  switch (g.phase) {
    case 'reroll': {
      const acts: Action[] = [{ t: 'advance' }];
      if (g.rerollUsed < rerollAllowance(p)) {
        const speed = effectiveSpeed(p);
        const all = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation].sort(
          (a, b) => a.value - b.value,
        );
        const pick = all.slice(0, speed).map((d) => d.id);
        if (pick.length) acts.push({ t: 'reroll', dieIds: pick });
      }
      return acts;
    }
    case 'dustRise':
      return [...dustRiseActions(g, g.activePlayer), { t: 'advance' }];
    case 'main': {
      const acts: Action[] = [{ t: 'advance' }];
      for (const d of p.areas.attack) acts.push({ t: 'attack', dieId: d.id });
      return acts;
    }
    default:
      return [{ t: 'advance' }];
  }
}

export function applyAction(g: GameState, action: Action): GameState {
  if (g.phase === 'gameOver') throw new Error('game is over');
  switch (action.t) {
    case 'advance':
      advancePhase(g);
      break;
    case 'reroll': {
      if (g.phase !== 'reroll') throw new Error('not reroll phase');
      const p = g.players[g.activePlayer];
      if (g.rerollUsed >= rerollAllowance(p)) throw new Error('reroll limit reached');
      const owned = new Set(
        [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation].map((d) => d.id),
      );
      if (action.dieIds.length > effectiveSpeed(p)) throw new Error('reroll exceeds speed');
      if (new Set(action.dieIds).size !== action.dieIds.length) throw new Error('duplicate die id');
      for (const id of action.dieIds) if (!owned.has(id)) throw new Error(`not your die: ${id}`);
      withRng(g, (rng) => rerollPhase(g, g.activePlayer, action.dieIds, rng));
      g.rerollUsed += 1;
      break;
    }
    case 'dustRise': {
      if (g.phase !== 'dustRise') throw new Error('not dust rise phase');
      const p = g.players[g.activePlayer];
      if (action.useSeal) {
        if (!p.hasDustSeal) throw new Error('no dust seal');
        p.hasDustSeal = false;
        applyDustRiseToArtifact(g, g.activePlayer, action.artifactId, action.side);
        g.dustRiseActed = true;
      } else {
        if (g.dustRiseNormalUsed) throw new Error('normal dust rise already used');
        const med = p.areas.meditation[0];
        if (!med) throw new Error('no meditation die');
        p.areas.meditation = p.areas.meditation.filter((d) => d.id !== med.id);
        applyDustRiseToArtifact(g, g.activePlayer, action.artifactId, action.side);
        g.dustRiseNormalUsed = true;
        g.dustRiseActed = true;
      }
      break;
    }
    case 'attack':
      if (g.phase !== 'main') throw new Error('not main phase');
      if (g.pendingAttack) throw new Error('pending attack unresolved');
      doAttack(g, g.activePlayer, action.dieId);
      break;
    case 'block':
      if (!g.pendingAttack) throw new Error('no pending attack');
      resolveBlock(g, action.dieId);
      break;
  }
  return g;
}
