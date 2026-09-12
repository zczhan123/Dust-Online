import { setupGame, type SetupOptions } from './setup';
import { SeededRng } from '../rng/rng';
import { refillPhase, rerollPhase, endPhase } from './phases';
import { effectiveSpeed, rerollAllowance } from './derive';
import { applyDustRiseToArtifact, canTargetForDustRise } from './dustRise';
import { incrementDustfall } from './dustfall';
import { doAttack, resolveBlock, checkLifeEnd, dealTrueDamage } from './combat';
import { SKILL_HANDLERS, skillActive, consumeDice } from './skills';
import type { Action, GameState, PlayerId, PlayerState } from '../model/types';

function withRng(g: GameState, fn: (rng: SeededRng) => void): void {
  const rng = new SeededRng(g.rngState);
  fn(rng);
  g.rngState = rng.state();
}

export function beginTurn(g: GameState): void {
  if (g.phase === 'gameOver') return;
  g.pendingAttack = null;
  g.pending = null;
  g.unblockableThisTurn = false;
  g.caiyuliuUsed = 0;
  g.dustRiseNormalUsed = false;
  g.dustRiseActed = false;
  g.freeDustRise = 0;
  g.rerollUsed = 0;
  g.skillsUsedThisTurn = [];
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
  const canNormal = (g.freeDustRise > 0 || !g.dustRiseNormalUsed) && hasMed;
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

function activateSkillActions(g: GameState, p: PlayerState): Action[] {
  const acts: Action[] = [];
  for (const a of p.artifacts) {
    for (const s of a.skills) {
      if (s.kind !== 'activate' && s.kind !== 'ultimate') continue;
      if (!skillActive(a, s)) continue;
      if (s.kind === 'ultimate' && g.ultimatesUsed.includes(s.key)) continue;
      if (g.skillsUsedThisTurn.includes(s.key)) continue;
      if (s.key === 'buxiang.cuilian') {
        for (const d of p.areas.attack) acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { attackDieId: d.id } });
      } else if (s.key === 'youlong.tengwan') {
        if (p.areas.meditation.length >= 3) acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { meditationDieIds: p.areas.meditation.slice(0, 3).map((d) => d.id) } });
      } else if (s.key === 'yingle.qianxing') {
        if (p.areas.attack.length >= 2) acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { attackDieIds: p.areas.attack.slice(0, 2).map((d) => d.id) } });
      } else if (s.key === 'yuqie.breakthrough') {
        if (p.areas.meditation.length >= 3) {
          const opp: PlayerId = g.activePlayer === 'A' ? 'B' : 'A';
          const oppDef = g.players[opp].areas.defense.slice(0, 3).map((d) => d.id);
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { meditationCount: 3, opponentDefenseDieIds: oppDef } });
        }
      } else if (s.key === 'yingle.yingxi') {
        const anyDie = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation][0];
        if (anyDie) acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { dieId: anyDie.id, x: 1 } });
      } else if (s.key === 'mingjing.ultimate') {
        acts.push({ t: 'skill', artifactId: a.id, side: s.side });
      } else if (s.key === 'wansha.ultimate') {
        const atk = p.areas.attack[0];
        if (atk) {
          const opp: PlayerId = g.activePlayer === 'A' ? 'B' : 'A';
          const oppDef = g.players[opp].areas.defense.slice(0, atk.value).map((d) => d.id);
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { attackDieId: atk.id, opponentDefenseDieIds: oppDef } });
        }
      }
    }
  }
  return acts;
}

export function getLegalActions(g: GameState): Action[] {
  if (g.phase === 'gameOver') return [];

  if (g.pending) {
    if (g.pending.kind === 'caiyuliu') {
      return [
        { t: 'caiyuliu', to: null },
        { t: 'caiyuliu', to: 'defense' },
        { t: 'caiyuliu', to: 'meditation' },
      ];
    }
    const pp = g.players[g.pending.player];
    const acts: Action[] = [{ t: 'fengmang', accept: false }];
    if (pp.areas.attack.length > 0 && pp.areas.meditation.length > 0) {
      for (const a of pp.areas.attack) {
        for (const m of pp.areas.meditation) {
          acts.push({ t: 'fengmang', accept: true, attackDieId: a.id, meditationDieId: m.id });
        }
      }
    }
    return acts;
  }

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
      acts.push(...activateSkillActions(g, p));
      return acts;
    }
    default:
      return [{ t: 'advance' }];
  }
}

/** 对第三列神器执行充能后，触发其「充能」技能效果（无论是否完成充能） */
function runChargeSkill(g: GameState, player: PlayerId, artifactId: string): void {
  const a = g.players[player].artifacts.find((x) => x.id === artifactId);
  if (!a || a.column !== 3) return;
  const cs = a.skills.find((s) => s.kind === 'charge');
  if (cs && SKILL_HANDLERS[cs.key]) {
    withRng(g, (rng) => SKILL_HANDLERS[cs.key].run({ g, player, artifact: a, rng, params: {} }));
  }
}

export function applyAction(g: GameState, action: Action): GameState {
  if (g.phase === 'gameOver') throw new Error('game is over');
  if (g.pending && action.t !== 'caiyuliu' && action.t !== 'fengmang') {
    throw new Error('resolve pending decision first');
  }
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
        runChargeSkill(g, g.activePlayer, action.artifactId);
        g.dustRiseActed = true;
      } else {
        if (g.freeDustRise > 0) {
          g.freeDustRise -= 1;
        } else if (!g.dustRiseNormalUsed) {
          g.dustRiseNormalUsed = true;
        } else {
          throw new Error('no dust rise action available');
        }
        const med = p.areas.meditation[0];
        if (!med) throw new Error('no meditation die');
        p.areas.meditation = p.areas.meditation.filter((d) => d.id !== med.id);
        applyDustRiseToArtifact(g, g.activePlayer, action.artifactId, action.side);
        runChargeSkill(g, g.activePlayer, action.artifactId);
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
    case 'caiyuliu': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'caiyuliu') throw new Error('no caiyuliu pending');
      if (action.to) {
        g.players[pd.player].areas[action.to].push({ id: pd.dieId, value: pd.value, kind: action.to });
        g.caiyuliuUsed += 1;
      }
      g.pending = null;
      break;
    }
    case 'fengmang': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'fengmang') throw new Error('no fengmang pending');
      if (action.accept) {
        if (!action.attackDieId || !action.meditationDieId) throw new Error('missing dice');
        const p = g.players[pd.player];
        consumeDice(p, 'attack', [action.attackDieId]);
        consumeDice(p, 'meditation', [action.meditationDieId]);
        g.players[pd.defenderId].life -= pd.value;
        checkLifeEnd(g);
        if ((g.phase as string) !== 'gameOver') dealTrueDamage(g, pd.defenderId, 2);
      }
      g.pending = null;
      break;
    }
    case 'skill': {
      if (g.phase !== 'main') throw new Error('not main phase');
      if (g.pendingAttack) throw new Error('pending attack unresolved');
      const p = g.players[g.activePlayer];
      const a = p.artifacts.find((x) => x.id === action.artifactId);
      if (!a) throw new Error(`no artifact: ${action.artifactId}`);
      const s = a.skills.find((x) => x.side === action.side && (x.kind === 'activate' || x.kind === 'ultimate'));
      if (!s) throw new Error('no usable skill on that side');
      if (!skillActive(a, s)) throw new Error('skill not active');
      if (s.kind === 'ultimate' && g.ultimatesUsed.includes(s.key)) throw new Error('ultimate already used');
      if (g.skillsUsedThisTurn.includes(s.key)) throw new Error('skill already used this turn');
      const handler = SKILL_HANDLERS[s.key];
      if (!handler) throw new Error(`no handler for skill: ${s.key}`);
      withRng(g, (rng) => handler.run({ g, player: g.activePlayer, artifact: a, rng, params: action.params ?? {} }));
      g.skillsUsedThisTurn.push(s.key);
      if (s.kind === 'ultimate') g.ultimatesUsed.push(s.key);
      break;
    }
  }
  return g;
}
