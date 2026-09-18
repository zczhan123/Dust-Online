import { setupGame, type SetupOptions } from './setup';
import { SeededRng } from '../rng/rng';
import { refillPhase, rerollPhase, endPhase } from './phases';
import { effectiveSpeed, rerollAllowance } from './derive';
import { applyDustRiseToArtifact, canTargetForDustRise } from './dustRise';
import { incrementDustfall } from './dustfall';
import { doAttack, resolveBlock, checkLifeEnd, dealTrueDamage, applyDeferredTrueDamage, pumpAttackQueue } from './combat';
import { setDieValue, heal, moveDice, paySlots } from './effects';
import { SKILL_HANDLERS, skillActive, consumeDice, applyTurnStartEffects, hasActiveSkill } from './skills';
import { logLine, pname } from './log';
import type { Action, GameState, PlayerId, PlayerState, SlotFill } from '../model/types';

/** 校验：这些骰必须是该玩家自己的、互不重复的冥想骰（越界抛错，不静默修正） */
function assertOwnMeditationDice(p: PlayerState, ids: string[]): void {
  if (new Set(ids).size !== ids.length) throw new Error('duplicate die id');
  for (const id of ids) {
    if (!p.areas.meditation.some((d) => d.id === id)) throw new Error(`not your meditation die: ${id}`);
  }
}

function withRng(g: GameState, fn: (rng: SeededRng) => void): void {
  const rng = new SeededRng(g.rngState);
  fn(rng);
  g.rngState = rng.state();
}

/** 若骰位中出现“置换”（2 颗真骰）填法，则要求该玩家已激活 010 深红的「真实之剑」 */
function assertConversionAllowed(g: GameState, player: PlayerId, fills?: SlotFill[]): void {
  const usesConversion = (fills ?? []).some((f) => f.dieIds.length === 2);
  if (usesConversion && !hasActiveSkill(g.players[player], 'shenhong.sword')) {
    throw new Error('conversion requires 真实之剑');
  }
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
  g.skillConsumedThisAction = 0;
  g.dunwuPulseUsedThisTurn = false;
  g.attackQueue = null;
  g.extraReroll = null;
  const p = g.activePlayer;
  // 回合开始触发（补充之前，故获得的骰计入意志上限）：008 战车
  applyTurnStartEffects(g, p);
  if (g.firstRound[p]) {
    g.phase = 'dustRise'; // 第一回合跳过补充与重掷
  } else {
    let refilled = 0;
    withRng(g, (rng) => {
      refilled = refillPhase(g, p, rng);
    });
    g.phase = 'reroll';
    // 010 深红·杀意：补充阶段实际补充数量 ≤ 3 时，可造成 3 点真实伤害并回复 2 点生命
    if (hasActiveSkill(g.players[p], 'shenhong.kill') && refilled <= 3) {
      g.pending = { kind: 'shenhongKill', player: p };
    }
  }
}

export function endTurn(g: GameState): void {
  if (g.phase === 'gameOver') return;
  const p = g.players[g.activePlayer];
  // 015 残响·持续：每当你的回合结束时，本神器计数下降 1 点（最低 0；充能层数不受影响）
  const cx = p.artifacts.find((a) => a.skills.some((s) => s.key === 'canxiang.juejing'));
  if (cx && hasActiveSkill(p, 'canxiang.juejing') && cx.count > 0) {
    const before = cx.count;
    cx.count -= 1;
    logLine(g, `「${cx.name}」：回合结束，计数 ${before} → ${cx.count}`);
  }
  p.buffs = p.buffs.filter((b) => b.duration !== 'thisTurn');
  g.firstRound[g.activePlayer] = false;
  g.activePlayer = g.activePlayer === 'A' ? 'B' : 'A';
  g.turnIndex += 1;
  beginTurn(g);
}

export function advancePhase(g: GameState): void {
  if (g.phase === 'gameOver') return;
  switch (g.phase) {
    case 'reroll': {
      // 013 雷暴·持续：对方重掷阶段结束时，若你拥有该持续技能，先询问是否插入一个额外重掷阶段
      if (g.extraReroll) {
        // 额外重掷阶段结束：把行动权交还原玩家，继续其尘起阶段
        const resume = g.extraReroll.resume;
        g.extraReroll = null;
        g.activePlayer = resume;
        g.phase = 'dustRise';
        logLine(g, `额外重掷阶段结束，${pname(resume)} 继续尘起阶段`);
        break;
      }
      const other: PlayerId = g.activePlayer === 'A' ? 'B' : 'A';
      if (hasActiveSkill(g.players[other], 'minglei.leibao.continuous')) {
        g.pending = { kind: 'leibaoReroll', player: other };
        break;
      }
      g.phase = 'dustRise';
      break;
    }
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
  const medSlot = medId ? [{ dieIds: [medId] }] : undefined;
  for (const a of p.artifacts) {
    if (!canTargetForDustRise(a)) continue;
    if (a.column === 3) {
      if (canNormal && medSlot) acts.push({ t: 'dustRise', artifactId: a.id, costSlots: medSlot });
      if (p.hasDustSeal) acts.push({ t: 'dustRise', artifactId: a.id, useSeal: true });
    } else if (a.activeMarkerSide == null) {
      if (canNormal && medSlot) {
        acts.push({ t: 'dustRise', artifactId: a.id, side: 'left', costSlots: medSlot });
        acts.push({ t: 'dustRise', artifactId: a.id, side: 'right', costSlots: medSlot });
      }
      if (p.hasDustSeal) {
        acts.push({ t: 'dustRise', artifactId: a.id, side: 'left', useSeal: true });
        acts.push({ t: 'dustRise', artifactId: a.id, side: 'right', useSeal: true });
      }
    } else {
      const other = a.activeMarkerSide === 'left' ? 'right' : 'left';
      if (canNormal && medSlot) acts.push({ t: 'dustRise', artifactId: a.id, side: other, costSlots: medSlot });
      if (p.hasDustSeal) acts.push({ t: 'dustRise', artifactId: a.id, side: other, useSeal: true });
    }
  }
  return acts;
}

/** 「激活」类技能：仅在该侧被“切入”的当回合可用一次 */
function activationUsable(g: GameState, a: { armedSide: 'left' | 'right' | null; armedTurn: number }, s: { side: 'left' | 'right' | 'only' }): boolean {
  return a.armedSide === (s.side === 'only' ? 'left' : s.side) && a.armedTurn === g.turnIndex;
}

/** 该技能当前是否属于“可发动”类型（启动 / 激活 / 必杀） */
function isUsableKind(kind: string): boolean {
  return kind === 'activate' || kind === 'activation' || kind === 'ultimate';
}

function activateSkillActions(g: GameState, p: PlayerState): Action[] {
  const acts: Action[] = [];
  for (const a of p.artifacts) {
    for (const s of a.skills) {
      if (!isUsableKind(s.kind)) continue;
      if (!skillActive(a, s)) continue;
      if (s.kind === 'activation' && !activationUsable(g, a, s)) continue;
      if (s.kind === 'ultimate' && g.ultimatesUsed.includes(s.key)) continue;
      if (g.skillsUsedThisTurn.includes(s.key)) continue;
      if (s.key === 'buxiang.cuilian') {
        if (a.count >= 3) continue;
        for (const d of p.areas.attack) acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots: [{ dieIds: [d.id] }] } });
      } else if (s.key === 'youlong.tengwan') {
        if (p.areas.meditation.length >= 3) acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots: p.areas.meditation.slice(0, 3).map((d) => ({ dieIds: [d.id] })) } });
      } else if (s.key === 'yingle.qianxing') {
        if (p.areas.attack.length >= 2) acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots: p.areas.attack.slice(0, 2).map((d) => ({ dieIds: [d.id] })) } });
      } else if (s.key === 'yuqie.breakthrough') {
        const medCount = Math.min(3, p.areas.meditation.length);
        if (medCount >= 1) {
          const costSlots = p.areas.meditation.slice(0, medCount).map((d) => ({ dieIds: [d.id] }));
          const opp: PlayerId = g.activePlayer === 'A' ? 'B' : 'A';
          const oppDef = g.players[opp].areas.defense;
          const required = Math.min(medCount, oppDef.length);
          const oppDefIds = oppDef.slice(0, required).map((d) => d.id);
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots, opponentDefenseDieIds: oppDefIds } });
        }
      } else if (s.key === 'yingle.yingxi') {
        const anyDie = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation].find((d) => d.value >= 2);
        if (anyDie) acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { dieId: anyDie.id, x: 1 } });
      } else if (s.key === 'mingjing.ultimate') {
        acts.push({ t: 'skill', artifactId: a.id, side: s.side });
      } else if (s.key === 'canxiang.juejing.ultimate') {
        acts.push({ t: 'skill', artifactId: a.id, side: s.side });
      } else if (s.key === 'chengjie.jinghua') {
        const opp: PlayerId = g.activePlayer === 'A' ? 'B' : 'A';
        const pick = g.players[opp].areas.attack
          .concat(g.players[opp].areas.defense, g.players[opp].areas.meditation)
          .filter((d) => d.value === 1);
        acts.push({
          t: 'skill',
          artifactId: a.id,
          side: s.side,
          params: { targetDieIds: pick.slice(0, 2).map((d) => d.id) },
        });
      } else if (s.key === 'chengjie.shuzui') {
        const pick = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation].filter((d) => d.value === 1);
        acts.push({
          t: 'skill',
          artifactId: a.id,
          side: s.side,
          params: { targetDieIds: pick.slice(0, 2).map((d) => d.id) },
        });
      } else if (s.key === 'wansha.ultimate') {
        const atk = p.areas.attack[0];
        if (atk) {
          const opp: PlayerId = g.activePlayer === 'A' ? 'B' : 'A';
          const oppDef = g.players[opp].areas.defense.slice(0, atk.value).map((d) => d.id);
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots: [{ dieIds: [atk.id] }], opponentDefenseDieIds: oppDef } });
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
              costSlots: [
                { dieIds: [p.areas.attack[0].id] },
                { dieIds: [p.areas.defense[0].id] },
                { dieIds: [p.areas.meditation[0].id] },
              ],
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
              costSlots: p.areas[kind].slice(0, 4).map((d) => ({ dieIds: [d.id] })),
              opponentDiscardIds: g.players[opp].areas[kind].slice(0, 4).map((d) => d.id),
            },
          });
        }
      } else if (s.key === 'tiebi.fist') {
        if (p.areas.meditation.length >= 2) {
          acts.push({
            t: 'skill',
            artifactId: a.id,
            side: s.side,
            params: {
              costSlots: p.areas.meditation.slice(0, 2).map((d) => ({ dieIds: [d.id] })),
              defenseDieIds: p.areas.defense.slice(0, 2).map((d) => d.id),
            },
          });
        }
      } else if (s.key === 'guwang.ultimate') {
        acts.push({ t: 'skill', artifactId: a.id, side: s.side });
      } else if (s.key === 'dunwu.barrier.activate') {
        if (p.areas.defense.length >= 1) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots: p.areas.defense.slice(0, 3).map((d) => ({ dieIds: [d.id] })) } });
        }
      } else if (s.key === 'dunwu.pulse.activate') {
        if (p.areas.attack.length >= 1) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots: p.areas.attack.slice(0, 3).map((d) => ({ dieIds: [d.id] })) } });
        }
      } else if (s.key === 'monv.ultimate') {
        if (p.areas.meditation.length >= 1) {
          acts.push({
            t: 'skill',
            artifactId: a.id,
            side: s.side,
            params: { to: 'attack', meditationDieIds: p.areas.meditation.slice(0, 3).map((d) => d.id) },
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
    if (g.pending.kind === 'guwangCharge') {
      const opponent: PlayerId = g.pending.player === 'A' ? 'B' : 'A';
      const acts: Action[] = [{ t: 'guwangCharge' }];
      for (const d of g.players[opponent].areas.attack) acts.push({ t: 'guwangCharge', dieId: d.id });
      return acts;
    }
    if (g.pending.kind === 'guwangCancel') {
      const p = g.players[g.pending.player];
      const acts: Action[] = [{ t: 'guwangCancel', cancel: false }];
      for (const d of p.areas.defense) acts.push({ t: 'guwangCancel', cancel: true, defenseDieId: d.id });
      return acts;
    }
    if (g.pending.kind === 'shenhongKill') {
      return [
        { t: 'shenhongKill', accept: true },
        { t: 'shenhongKill', accept: false },
      ];
    }
    if (g.pending.kind === 'dunwuHalve') {
      const p = g.players[g.pending.player];
      return [
        { t: 'dunwuHalve', accept: false },
        ...p.areas.meditation.map((d) => ({ t: 'dunwuHalve' as const, accept: true, meditationDieId: d.id })),
      ];
    }
    if (g.pending.kind === 'dunwuPulse') {
      return [
        { t: 'dunwuPulse', accept: true },
        { t: 'dunwuPulse', accept: false },
      ];
    }
    if (g.pending.kind === 'leibaoReroll') {
      return [
        { t: 'leibaoReroll', accept: true },
        { t: 'leibaoReroll', accept: false },
      ];
    }
    if (g.pending.kind === 'dianxing') {
      const p = g.players[g.pending.player];
      const acts: Action[] = [{ t: 'dianxing', accept: false }];
      // 默认动作（供 AI / 测试）：取前 2 颗冥想骰；真人由 UI 打开选骰面板显式选择
      const first2 = p.areas.meditation.slice(0, 2).map((d) => d.id);
      if (first2.length === 2) acts.push({ t: 'dianxing', dieIds: first2 });
      return acts;
    }
    if (g.pending.kind === 'leibao') {
      const p = g.players[g.pending.player];
      const pick = p.areas.meditation.slice(0, 2).map((d) => d.id);
      return [
        { t: 'leibao', accept: false },
        { t: 'leibao', dieIds: pick },
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
      for (const d of g.players[defender].areas.defense) {
        acts.push({ t: 'block', costSlots: [{ dieIds: [d.id] }] });
      }
    }
    return acts;
  }

  const p = g.players[g.activePlayer];
  switch (g.phase) {
    case 'reroll': {
      const acts: Action[] = [{ t: 'advance' }];
      const allowance = g.extraReroll ? 1 : rerollAllowance(p);
      if (g.rerollUsed < allowance) {
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
      for (const d of p.areas.attack) acts.push({ t: 'attack', costSlots: [{ dieIds: [d.id] }] });
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
    withRng(g, (rng) =>
      SKILL_HANDLERS[cs.key].run({
        g,
        player,
        artifact: a,
        rng,
        params: {},
        endMainPhase: () => endMainPhase(g),
        reportConsumed: () => {},
      }),
    );
  }
}

export function applyAction(g: GameState, action: Action): GameState {
  if (g.phase === 'gameOver') throw new Error('game is over');
  if (g.pending && action.t !== 'caiyuliu' && action.t !== 'fengmang' && action.t !== 'guwangCharge' && action.t !== 'guwangCancel' && action.t !== 'shenhongKill' && action.t !== 'dunwuHalve' && action.t !== 'dunwuPulse' && action.t !== 'leibaoReroll' && action.t !== 'dianxing' && action.t !== 'leibao') {
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
      const allowance = g.extraReroll ? 1 : rerollAllowance(p);
      if (g.rerollUsed >= allowance) throw new Error('reroll limit reached');
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
    case 'leibaoReroll': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'leibaoReroll') throw new Error('no leibaoReroll pending');
      g.pending = null;
      if (action.accept) {
        g.extraReroll = { player: pd.player, resume: g.activePlayer };
        g.activePlayer = pd.player;
        g.rerollUsed = 0;
        g.phase = 'reroll';
        logLine(g, `${pname(pd.player)} 发动「雷暴」：插入一个额外重掷阶段（重掷 1 次，骰数 ≤ 速度）`);
      } else {
        g.phase = 'dustRise';
        logLine(g, `${pname(pd.player)} 放弃「雷暴」的额外重掷`);
      }
      break;
    }
    case 'dianxing': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'dianxing') throw new Error('no dianxing pending');
      const p = g.players[pd.player];
      if (action.accept === false) {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 不发动「电刑」`);
        pumpAttackQueue(g);
        break;
      }
      const ids = action.dieIds ?? [];
      if (ids.length !== 2) throw new Error('电刑需消耗恰好 2 个冥想骰');
      assertOwnMeditationDice(p, ids);
      g.pending = null;
      const pickedVals = ids.map((x) => p.areas.meditation.find((d) => d.id === x)?.value ?? 0);
      consumeDice(p, 'meditation', ids);
      g.attackQueue = { player: pd.player, values: [1, 2, 3] };
      logLine(
        g,
        `${pname(pd.player)} 发动「电刑」：消耗 2 个冥想骰（${pickedVals.join('/')}点），依次以 1、2、3 点各进行一次攻击`,
      );
      pumpAttackQueue(g);
      break;
    }
    case 'leibao': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'leibao') throw new Error('no leibao pending');
      const p = g.players[pd.player];
      if (action.accept === false) {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 不发动「雷暴」`);
        pumpAttackQueue(g);
        break;
      }
      const ids = action.dieIds ?? [];
      if (ids.length > 2) throw new Error('雷暴最多移动 2 个冥想骰');
      assertOwnMeditationDice(p, ids);
      g.pending = null;
      if (ids.length > 0) moveDice(g, pd.player, ids, 'attack');
      logLine(
        g,
        `${pname(pd.player)} 发动「雷暴」：将 ${ids.length} 个冥想骰移动到攻击骰区（保留点数）`,
      );
      pumpAttackQueue(g);
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
        assertConversionAllowed(g, g.activePlayer, action.costSlots);
        if (!action.costSlots || action.costSlots.length === 0) throw new Error('costSlots required');
        paySlots(g, g.activePlayer, [{ kind: 'meditation' }], action.costSlots);
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
      assertConversionAllowed(g, g.activePlayer, action.costSlots);
      doAttack(g, g.activePlayer, action.costSlots);
      break;
    case 'block': {
      if (!g.pendingAttack) throw new Error('no pending attack');
      const defender: PlayerId = g.pendingAttack.attacker === 'A' ? 'B' : 'A';
      assertConversionAllowed(g, defender, action.costSlots);
      resolveBlock(g, action.costSlots);
      break;
    }
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
      pumpAttackQueue(g);
      break;
    }
    case 'guwangCharge': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'guwangCharge') throw new Error('no guwangCharge pending');
      const opponent: PlayerId = pd.player === 'A' ? 'B' : 'A';
      if (action.dieId) {
        const die = g.players[opponent].areas.attack.find((d) => d.id === action.dieId);
        if (!die) throw new Error('not an opponent attack die');
        const old = setDieValue(g, opponent, action.dieId, 1);
        logLine(g, `${pname(pd.player)} 「高塔铁幕」：将 ${pname(opponent)} 的 1 颗攻击骰由 ${old} 点变更为 1 点`);
      } else {
        logLine(g, `${pname(pd.player)} 「高塔铁幕」：不变更攻击骰`);
      }
      g.pending = null;
      break;
    }
    case 'guwangCancel': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'guwangCancel') throw new Error('no guwangCancel pending');
      const p = g.players[pd.player];
      const dieId = action.defenseDieId;
      if (action.cancel && dieId && p.areas.defense.some((d) => d.id === dieId)) {
        const value = p.areas.defense.find((d) => d.id === dieId)!.value;
        consumeDice(p, 'defense', [dieId]);
        logLine(
          g,
          `${pname(pd.player)} 「高塔铁幕」：消耗 1 个防御骰（${value}点），取消 ${pd.amount} 点真实伤害`,
        );
      } else {
        applyDeferredTrueDamage(g, pd.player, pd.amount);
      }
      g.pending = null;
      break;
    }
    case 'shenhongKill': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'shenhongKill') throw new Error('no shenhongKill pending');
      if (action.accept) {
        const opponent: PlayerId = pd.player === 'A' ? 'B' : 'A';
        g.pending = null;
        logLine(g, `${pname(pd.player)} 发动「杀意」：造成 3 点真实伤害，然后回复 2 点生命`);
        dealTrueDamage(g, opponent, 3);
        heal(g, pd.player, 2);
      } else {
        logLine(g, `${pname(pd.player)} 放弃杀意`);
        g.pending = null;
      }
      break;
    }
    case 'dunwuHalve': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'dunwuHalve') throw new Error('no dunwuHalve pending');
      const p = g.players[pd.player];
      const dieId = action.meditationDieId;
      if (action.accept && dieId && p.areas.meditation.some((d) => d.id === dieId)) {
        consumeDice(p, 'meditation', [dieId]);
        if (g.pendingAttack) g.pendingAttack.value = Math.floor(g.pendingAttack.value / 2);
        logLine(g, `${pname(pd.player)} 「灵能屏障」：消耗 1 个冥想骰，伤害减半为 ${g.pendingAttack?.value ?? 0}`);
      } else {
        logLine(g, `${pname(pd.player)} 放弃灵能屏障`);
      }
      g.pending = null;
      break;
    }
    case 'dunwuPulse': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'dunwuPulse') throw new Error('no dunwuPulse pending');
      if (action.accept) {
        const opponent: PlayerId = pd.player === 'A' ? 'B' : 'A';
        g.pending = null;
        logLine(g, `${pname(pd.player)} 发动「灵能脉冲」：造成 ${pd.amount} 点真实伤害`);
        dealTrueDamage(g, opponent, pd.amount);
        g.dunwuPulseUsedThisTurn = true;
      } else {
        logLine(g, `${pname(pd.player)} 放弃灵能脉冲`);
        g.pending = null;
      }
      break;
    }
    case 'skill': {
      if (g.phase !== 'main') throw new Error('not main phase');
      if (g.pendingAttack) throw new Error('pending attack unresolved');
      const p = g.players[g.activePlayer];
      const a = p.artifacts.find((x) => x.id === action.artifactId);
      if (!a) throw new Error(`no artifact: ${action.artifactId}`);
      const s = a.skills.find(
        (x) =>
          x.side === action.side &&
          (x.kind === 'activate' ||
            x.kind === 'activation' ||
            x.kind === 'ultimate'),
      );
      if (!s) throw new Error('no usable skill on that side');
      if (!skillActive(a, s)) throw new Error('skill not active');
      if (s.kind === 'activation' && !activationUsable(g, a, s)) throw new Error('activation skill only usable in the turn it was armed');
      if (s.kind === 'ultimate' && g.ultimatesUsed.includes(s.key)) throw new Error('ultimate already used');
      if (g.skillsUsedThisTurn.includes(s.key)) throw new Error('skill already used this turn');
      assertConversionAllowed(g, g.activePlayer, action.params?.costSlots as SlotFill[] | undefined);
      const handler = SKILL_HANDLERS[s.key];
      if (!handler) throw new Error(`no handler for skill: ${s.key}`);
      g.skillConsumedThisAction = 0;
      withRng(g, (rng) =>
        handler.run({
          g,
          player: g.activePlayer,
          artifact: a,
          rng,
          params: action.params ?? {},
          endMainPhase: () => endMainPhase(g),
          reportConsumed: (n) => {
            g.skillConsumedThisAction += n;
          },
        }),
      );
      g.skillsUsedThisTurn.push(s.key);
      if (s.kind === 'ultimate') g.ultimatesUsed.push(s.key);
      // 011 灵能脉冲·触发：通过技能消耗能力骰后，可额外造成等同消耗数量的真实伤害（每回合最多 1 次）
      if (
        g.skillConsumedThisAction > 0 &&
        hasActiveSkill(g.players[g.activePlayer], 'dunwu.pulse.trigger') &&
        !g.dunwuPulseUsedThisTurn &&
        g.pending === null
      ) {
        g.pending = { kind: 'dunwuPulse', player: g.activePlayer, amount: g.skillConsumedThisAction };
      }
      break;
    }
  }
  return g;
}
