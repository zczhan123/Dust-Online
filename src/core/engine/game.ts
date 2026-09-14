import { setupGame, type SetupOptions } from './setup';
import { SeededRng } from '../rng/rng';
import { refillPhase, rerollPhase, endPhase } from './phases';
import { effectiveSpeed, rerollAllowance } from './derive';
import { applyDustRiseToArtifact, canTargetForDustRise } from './dustRise';
import { incrementDustfall } from './dustfall';
import { doAttack, resolveBlock, checkLifeEnd, dealTrueDamage } from './combat';
import { SKILL_HANDLERS, skillActive, consumeDice } from './skills';
import { logLine, pname } from './log';
import type { Action, GameState, PlayerId, PlayerState } from '../model/types';

function withRng(g: GameState, fn: (rng: SeededRng) => void): void {
  const rng = new SeededRng(g.rngState);
  fn(rng);
  g.rngState = rng.state();
}

export function beginTurn(g: GameState): void {
  if (g.phase === 'gameOver') return;
  logLine(g, `${pname(g.activePlayer)} 的回合开始`);
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
      if (!g.dustRiseActed) {
        const before = g.dustfall;
        const player = g.activePlayer;
        incrementDustfall(g);
        logLine(g, `${pname(player)} 未进行尘起行动，尘落 ${before} → ${g.dustfall}`);
        if ((g.phase as string) === 'gameOver') {
          logLine(g, `尘落达到 10，游戏结束：${pname(g.winner ?? g.activePlayer)} 获胜`);
          break;
        }
      }
      g.phase = 'main';
      break;
    case 'main':
      endPhase(g, g.activePlayer);
      logLine(g, `${pname(g.activePlayer)} 回合结束`);
      endTurn(g);
      break;
    default:
      break;
  }
}

/** 立即结束当前的主要阶段（供 009 必杀等使用） */
export function endMainPhase(g: GameState): void {
  if (g.phase === 'main') advancePhase(g);
}

export function createGame(opts: SetupOptions): GameState {
  const g = setupGame(opts);
  const second: PlayerId = g.firstPlayer === 'A' ? 'B' : 'A';
  g.phase = 'initialReroll';
  g.activePlayer = g.firstPlayer;
  g.initialRerollQueue = [g.firstPlayer, second];
  logLine(g, `${pname(g.firstPlayer)} 先手；初始重掷：可重掷任意数量的初始能力骰`);
  return g;
}

/** 跳过后手/先手的初始重掷，进入先手第一回合（供快速开始/测试） */
export function skipInitialReroll(g: GameState): void {
  let guard = 0;
  while (g.phase === 'initialReroll' && guard++ < 4) applyAction(g, { t: 'advance' });
}

function finishInitialRerollStep(g: GameState): void {
  g.initialRerollQueue.shift();
  if (g.initialRerollQueue.length > 0) {
    g.activePlayer = g.initialRerollQueue[0];
    logLine(g, `${pname(g.activePlayer)} 进行初始重掷`);
  } else {
    g.activePlayer = g.firstPlayer;
    beginTurn(g);
  }
}

function dustRiseActions(g: GameState, player: PlayerId): Action[] {
  const p = g.players[player];
  const acts: Action[] = [];
  const hasMed = p.areas.meditation.length > 0;
  const canNormal = (g.freeDustRise > 0 || !g.dustRiseNormalUsed) && hasMed;
  const medId = hasMed ? p.areas.meditation[0].id : undefined; // 默认候选（仅供 AI）；UI 会让玩家自选
  for (const a of p.artifacts) {
    if (!canTargetForDustRise(a)) continue;
    if (a.column === 3) {
      if (canNormal && medId) acts.push({ t: 'dustRise', artifactId: a.id, meditationDieId: medId });
      if (p.hasDustSeal) acts.push({ t: 'dustRise', artifactId: a.id, useSeal: true });
    } else if (a.activeMarkerSide == null) {
      if (canNormal && medId) {
        acts.push({ t: 'dustRise', artifactId: a.id, side: 'left', meditationDieId: medId });
        acts.push({ t: 'dustRise', artifactId: a.id, side: 'right', meditationDieId: medId });
      }
      if (p.hasDustSeal) {
        acts.push({ t: 'dustRise', artifactId: a.id, side: 'left', useSeal: true });
        acts.push({ t: 'dustRise', artifactId: a.id, side: 'right', useSeal: true });
      }
    } else {
      const other = a.activeMarkerSide === 'left' ? 'right' : 'left';
      if (canNormal && medId) acts.push({ t: 'dustRise', artifactId: a.id, side: other, meditationDieId: medId });
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
        if (a.count >= 3) continue;
        for (const d of p.areas.attack) acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { attackDieId: d.id } });
      } else if (s.key === 'youlong.tengwan') {
        if (p.areas.meditation.length >= 3) acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { meditationDieIds: p.areas.meditation.slice(0, 3).map((d) => d.id) } });
      } else if (s.key === 'yingle.qianxing') {
        if (p.areas.attack.length >= 2) acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { attackDieIds: p.areas.attack.slice(0, 2).map((d) => d.id) } });
      } else if (s.key === 'yuqie.breakthrough') {
        const medCount = Math.min(3, p.areas.meditation.length);
        if (medCount >= 1) {
          const medIds = p.areas.meditation.slice(0, medCount).map((d) => d.id);
          const opp: PlayerId = g.activePlayer === 'A' ? 'B' : 'A';
          const oppDef = g.players[opp].areas.defense;
          const required = Math.min(medCount, oppDef.length);
          const oppDefIds = oppDef.slice(0, required).map((d) => d.id);
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { meditationDieIds: medIds, opponentDefenseDieIds: oppDefIds } });
        }
      } else if (s.key === 'yingle.yingxi') {
        const anyDie = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation].find((d) => d.value >= 2);
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
      } else if (s.key === 'zhuzai.sweep') {
        if (p.areas.attack.length >= 1 && p.areas.defense.length >= 1 && p.areas.meditation.length >= 1) {
          const opp: PlayerId = g.activePlayer === 'A' ? 'B' : 'A';
          const o = g.players[opp];
          const discard: Record<string, string> = {};
          if (o.areas.attack[0]) discard.attack = o.areas.attack[0].id;
          if (o.areas.defense[0]) discard.defense = o.areas.defense[0].id;
          if (o.areas.meditation[0]) discard.meditation = o.areas.meditation[0].id;
          acts.push({
            t: 'skill',
            artifactId: a.id,
            side: s.side,
            params: {
              consumed: {
                attack: p.areas.attack[0].id,
                defense: p.areas.defense[0].id,
                meditation: p.areas.meditation[0].id,
              },
              discard,
            },
          });
        }
      } else if (s.key === 'zhuzai.smash') {
        const kinds = ['attack', 'defense', 'meditation'] as const;
        const kind = kinds.find((k) => p.areas[k].length >= 4);
        if (kind) {
          const opp: PlayerId = g.activePlayer === 'A' ? 'B' : 'A';
          acts.push({
            t: 'skill',
            artifactId: a.id,
            side: s.side,
            params: {
              kind,
              consumedIds: p.areas[kind].slice(0, 4).map((d) => d.id),
              opponentDiscardIds: g.players[opp].areas[kind].slice(0, 4).map((d) => d.id),
            },
          });
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

  if (g.phase === 'initialReroll') {
    const p = g.players[g.activePlayer];
    const all = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation].map((d) => d.id);
    const acts: Action[] = [{ t: 'advance' }];
    if (all.length) acts.push({ t: 'reroll', dieIds: all });
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
      if (g.phase === 'initialReroll') finishInitialRerollStep(g);
      else advancePhase(g);
      break;
    case 'reroll': {
      if (g.phase === 'initialReroll') {
        const p = g.players[g.activePlayer];
        const owned = new Set(
          [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation].map((d) => d.id),
        );
        if (new Set(action.dieIds).size !== action.dieIds.length) throw new Error('duplicate die id');
        for (const id of action.dieIds) if (!owned.has(id)) throw new Error(`not your die: ${id}`);
        withRng(g, (rng) => rerollPhase(g, g.activePlayer, action.dieIds, rng));
        finishInitialRerollStep(g);
        break;
      }
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
      } else {
        if (g.freeDustRise > 0) {
          g.freeDustRise -= 1;
        } else if (!g.dustRiseNormalUsed) {
          g.dustRiseNormalUsed = true;
        } else {
          throw new Error('no dust rise action available');
        }
        const medId = action.meditationDieId;
        if (!medId) throw new Error('meditationDieId required');
        if (!p.areas.meditation.some((d) => d.id === medId)) throw new Error('not your meditation die');
        p.areas.meditation = p.areas.meditation.filter((d) => d.id !== medId);
      }
      const desc = applyDustRiseToArtifact(g, g.activePlayer, action.artifactId, action.side);
      logLine(
        g,
        `${pname(g.activePlayer)} 尘起：${desc}${action.useSeal ? '（消耗尘印标记）' : ''}`,
      );
      runChargeSkill(g, g.activePlayer, action.artifactId);
      g.dustRiseActed = true;
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
        logLine(
          g,
          `${pname(pd.player)} 发动「裁雨流」：将 ${pd.value} 点骰移到${
            action.to === 'defense' ? '防御' : '冥想'
          }骰区`,
        );
      } else {
        logLine(g, `${pname(pd.player)} 放弃裁雨流`);
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
        const av = p.areas.attack.find((d) => d.id === action.attackDieId)?.value ?? 0;
        const mv = p.areas.meditation.find((d) => d.id === action.meditationDieId)?.value ?? 0;
        consumeDice(p, 'attack', [action.attackDieId]);
        consumeDice(p, 'meditation', [action.meditationDieId]);
        g.players[pd.defenderId].life -= pd.value;
        logLine(
          g,
          `${pname(pd.player)} 发动「锋芒」：消耗 1 颗攻击骰（${av}点）与 1 颗冥想骰（${mv}点），取消抵挡并追加 2 点真实伤害`,
        );
        checkLifeEnd(g);
        if ((g.phase as string) !== 'gameOver') dealTrueDamage(g, pd.defenderId, 2);
      } else {
        logLine(g, `${pname(pd.player)} 放弃锋芒`);
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
