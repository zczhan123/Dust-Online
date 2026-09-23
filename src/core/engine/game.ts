import { setupGame, type SetupOptions } from './setup';
import { SeededRng } from '../rng/rng';
import { refillPhase, doReroll, endPhase } from './phases';
import { effectiveSpeed, effectiveWill, emptyDistribution, rerollAllowance, totalDice } from './derive';
import { applyDustRiseToArtifact, canTargetForDustRise } from './dustRise';
import { incrementDustfall } from './dustfall';
import { afterAttackResolved, applyLifeLoss, artifactWithSkill, commitAttack, doAttack, finalizeAttackResolution, halveAttackDamage, resolveBlock, dealTrueDamage, applyDeferredTrueDamage, pumpAttackQueue, type AttackMods } from './combat';
import { abilityDieInfo, findDieOf, gainRandomDice, setDieValue, heal, moveDice, paySlots, withRngState } from './effects';
import { areaOf } from '../model/dice';
import { pumpPending, queuePending, queueRerollEndTriggers } from './pending';
import { SKILL_HANDLERS, skillActive, consumeDice, applyTurnStartEffects, hasActiveSkill } from './skills';
import { logLine, pname } from './log';
import type { Action, Artifact, DiceKind, Die, GameState, Pending, PlayerId, PlayerState, SkillDef, SlotFill } from '../model/types';

/** 校验：这些骰必须是该玩家自己的、互不重复的冥想骰（越界抛错，不静默修正） */
function assertOwnMeditationDice(p: PlayerState, ids: string[]): void {
  if (new Set(ids).size !== ids.length) throw new Error('duplicate die id');
  for (const id of ids) {
    if (!p.areas.meditation.some((d) => d.id === id)) throw new Error(`not your meditation die: ${id}`);
  }
}

/** 034 破障（持续）：神器上存放的骰可当能力骰「使用/消耗」（类型按持有者第二列分布） */
function heldAbilityDice(g: GameState, player: PlayerId): { id: string; kind: DiceKind }[] {
  const p = g.players[player];
  if (!hasActiveSkill(p, 'jingang.pozhang.continuous')) return [];
  const dist = emptyDistribution(p);
  if (!dist) return [];
  const out: { id: string; kind: DiceKind }[] = [];
  for (const a of p.artifacts) for (const h of a.heldDice ?? []) out.push({ id: h.id, kind: areaOf(h.value, dist) });
  return out;
}

function withRng(g: GameState, fn: (rng: SeededRng) => void): void {
  withRngState(g, fn);
}

/** 若骰位中出现“置换”（2 颗真骰）填法，则要求该玩家已激活 010 深红的「真实之剑」 */
function assertConversionAllowed(g: GameState, player: PlayerId, fills?: SlotFill[]): void {
  const usesConversion = (fills ?? []).some((f) => f.dieIds.length === 2);
  if (usesConversion && !hasActiveSkill(g.players[player], 'shenhong.sword')) {
    throw new Error('conversion requires 真实之剑');
  }
}

/**
 * 025 屠虎·奇袭（持续）：可把**点数不在对方任何区域**的能力骰「视为攻击骰」使用（单骰跨类型）。
 * 返回该骰是否可用于攻击骰位（条件：奇袭已激活 + 该点数不在对方任意区域）。
 */
export function canTreatAsAttack(g: GameState, player: PlayerId, dieId: string): boolean {
  if (!hasActiveSkill(g.players[player], 'tuohu.qixi')) return false;
  const found = findDieOf(g, player, dieId);
  if (!found) return false;
  if (found.kind === 'attack') return false; // 本来就是攻击骰，无需「视为」
  const opp: PlayerId = player === 'A' ? 'B' : 'A';
  const v = found.die.value;
  const kinds: DiceKind[] = ['attack', 'defense', 'meditation'];
  return !kinds.some((k) => g.players[opp].areas[k].some((d) => d.value === v));
}

/** 027 寒光·必杀：是否处于「将要使用攻击骰」且神器上仍有骰子（用完即不再询问，必杀已用无法再次发动） */
export function canUseHanguang(g: GameState, player: PlayerId): boolean {
  const card = artifactWithSkill(g.players[player], 'hanguang.ultimate');
  return (card?.heldDice?.length ?? 0) > 0;
}

/** 校验所有「视为」填法都满足 025 奇袭的条件（越界抛错，不静默修正） */
function assertTreatedAllowed(g: GameState, player: PlayerId, fills?: SlotFill[]): void {
  for (const f of fills ?? []) {
    if (f.treated !== true) continue;
    if (f.dieIds.length !== 1) throw new Error('「视为」填法只能有 1 颗骰');
    if (!canTreatAsAttack(g, player, f.dieIds[0])) {
      throw new Error('「视为攻击骰」不满足 025 屠虎·奇袭的条件');
    }
  }
}

/**
 * 026 哀歌·陷阵：**重掷者自己的**重掷阶段结束时触发（普通路径与 013「雷暴」插入的额外重掷阶段路径**共用**）。
 * 由生命最少的一方（并列 = 重掷者本人，即「当前回合玩家」）弃置重掷者 1 颗能力骰；重掷者没有能力骰时不结算。
 */
function queueXianzhenOnRerollEnd(g: GameState, reroller: PlayerId): void {
  if (!hasActiveSkill(g.players[reroller], 'aige.xianzhen')) return;
  const own = g.players[reroller];
  if (!KINDS_ORDER.some((k) => own.areas[k].length > 0)) return;
  const aLife = g.players.A.life;
  const bLife = g.players.B.life;
  const chooser: PlayerId = aLife < bLife ? 'A' : bLife < aLife ? 'B' : reroller;
  queuePending(g, { kind: 'xianzhenPick', player: chooser, owner: reroller });
  logLine(g, `「陷阵」：由生命最少的一方（${pname(chooser)}）选择弃置 ${pname(reroller)} 的 1 颗能力骰`);
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
  g.pendingQueue = [];
  // 019 尘哀·尘起：每回合最多触发 1 次；其赠予的「免费额外尘起」也在回合开始时清零
  g.chenaiUsed.A = false;
  g.chenaiUsed.B = false;
  g.freeNoCostRise = 0;
  // 025 屠虎·横贯（持续）：每回合的攻击次数清零（第 2 次攻击伤害 +2 按本回合统计）
  g.attacksThisTurn.A = 0;
  g.attacksThisTurn.B = 0;
  // 028 天罚（激活·本回合）：攻击点数视为固定值 / 只能用某类骰抵挡 / 造成伤害次数统计，均按本回合清零
  g.tianfa.A = null;
  g.tianfa.B = null;
  // 018 至黑：每回合第一次受伤的判定在每回合开始时重置（任何玩家的回合开始时都重置，双方各自独立）
  g.players.A.damagedThisTurn = false;
  g.players.B.damagedThisTurn = false;
  const p = g.activePlayer;
  // 回合开始触发（补充之前，故获得的骰计入意志上限）：008 战车
  applyTurnStartEffects(g, p);
  if (g.firstRound[p]) {
    g.phase = 'dustRise'; // 第一回合跳过补充与重掷
    // 027 凛冽之音：持续到「持有者自己的下个尘起阶段开始」→ 尘起阶段开始时清除
    g.rerollPunish[p] = false;
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
    // 029 真言·全知（持续）：补充阶段不按常规分布落区，改由玩家自行分配全部能力骰
    if (hasActiveSkill(g.players[p], 'zhenyan.quanzhi')) {
      queuePending(g, { kind: 'quanzhiAssign', player: p });
      pumpPending(g);
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
  // 023 蛇蝎·畏惧：该玩家「下个回合」的攻击伤害减半 → 其回合结束时清除（即使本回合没攻击/被抵挡也不保留）
  p.attackHalvedNextTurn = false;
  p.buffs = p.buffs.filter((b) => b.duration !== 'thisTurn');
  // 027 寒光·必杀：置于神器上的骰子在该玩家回合结束时移除
  const hanguang = p.artifacts.find((a) => a.skills.some((s) => s.key === 'hanguang.ultimate'));
  if (hanguang) hanguang.heldDice = [];
  g.firstRound[g.activePlayer] = false;
  g.activePlayer = g.activePlayer === 'A' ? 'B' : 'A';
  g.turnIndex += 1;
  beginTurn(g);
}

export function advancePhase(g: GameState): void {
  if (g.phase === 'gameOver') return;
  switch (g.phase) {
    case 'reroll': {
      if (g.extraReroll) {
        // 额外重掷阶段结束：把行动权交还原玩家，继续其尘起阶段
        const reroller = g.extraReroll.player;
        const resume = g.extraReroll.resume;
        g.extraReroll = null;
        g.activePlayer = resume;
        g.phase = 'dustRise';
        // 027 凛冽之音：持续到「持有者自己的下个尘起阶段开始」→ 此处（其尘起阶段开始）清除
        g.rerollPunish[resume] = false;
        logLine(g, `额外重掷阶段结束，${pname(resume)} 继续尘起阶段`);
        // 026 哀歌·陷阵：额外重掷阶段结束同样构成「你的重掷阶段结束」→ 与普通路径同一口径
        queueXianzhenOnRerollEnd(g, reroller);
        // 017 帷幕：该额外重掷阶段结束时同样触发（FAQ 17.1.2）；不再触发 013 以免循环
        queueRerollEndTriggers(g, reroller, { includeLeibao: false });
        pumpPending(g);
        break;
      }
      // 先离开重掷阶段再处理触发，避免待决策解算完后重复触发
      g.phase = 'dustRise';
      // 027 凛冽之音：持续到「持有者自己的下个尘起阶段开始」→ 此处（其尘起阶段开始）清除
      // （注意：重掷阶段在本阶段**之前**，所以此时清除不会漏掉本轮重掷的惩罚）
      g.rerollPunish[g.activePlayer] = false;
      // 026 哀歌·陷阵：**重掷者自己的**重掷阶段结束时（与额外重掷路径共用同一实现）
      queueXianzhenOnRerollEnd(g, g.activePlayer);
      // 对方（非当前玩家）的重掷阶段结束时触发：013 雷暴·持续 / 017 帷幕
      queueRerollEndTriggers(g, g.activePlayer);
      pumpPending(g);
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
      // 035 千劫·万丈明光（持续）：你的主要阶段开始时，弃置 2 个能力骰
      if (
        hasActiveSkill(g.players[g.activePlayer], 'qianjie.wanzhang') &&
        totalDice(g.players[g.activePlayer]) > 0
      ) {
        queuePending(g, { kind: 'wanzhangDiscard', player: g.activePlayer });
      }
      break;
    case 'main':
      // 先离开主要阶段（避免待决策解算完后重复触发），再排队「主要阶段结束 / 回合结束」的待决策
      g.phase = 'end';
      // 032 梦魇·低语（持续）：持有者自己的主要阶段结束时，宣称 1 个能力骰类型
      if (hasActiveSkill(g.players[g.activePlayer], 'mengyan.diyu')) {
        queuePending(g, { kind: 'kuyu', player: g.activePlayer });
      }
      // 033 凋零·死亡亦逝（持续）：任一方生效时，双方各自回合结束时都要执行；区域为空则自动通过
      if (
        (['A', 'B'] as PlayerId[]).some((id) => hasActiveSkill(g.players[id], 'diaoling.siwang')) &&
        totalDice(g.players[g.activePlayer]) > 0
      ) {
        queuePending(g, { kind: 'tiaolingPick', player: g.activePlayer });
      }
      // 结束阶段：超出意志上限时，由当前回合玩家**自行选择**弃置哪几颗（说明书 page_09；排在 032/033 之后）
      if (totalDice(g.players[g.activePlayer]) > effectiveWill(g.players[g.activePlayer])) {
        queuePending(g, { kind: 'endDiscard', player: g.activePlayer });
      }
      pumpPending(g);
      finalizeTurnEnd(g);
      break;
    case 'end':
      finalizeTurnEnd(g);
      break;
    default:
      break;
  }
}

/** 「回合结束」结算：先跑结束阶段（弃多余）再交出回合；仅在「结束」阶段、且无任何待决策时执行 */
function finalizeTurnEnd(g: GameState): void {
  if (g.phase !== 'end') return;
  if (g.pending || g.pendingQueue.length > 0) return;
  endPhase(g, g.activePlayer);
  logLine(g, `${pname(g.activePlayer)} 回合结束`);
  endTurn(g);
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
  // 019 尘起赠予的「无需冥想骰的额外尘起行动」（不占每回合 1 次、不耗尘印）
  const canFree = g.freeNoCostRise > 0;
  for (const a of p.artifacts) {
    if (!canTargetForDustRise(a)) continue;
    if (canFree) {
      const sides = a.column === 3 ? [undefined] : a.activeMarkerSide == null ? ['left', 'right'] : [a.activeMarkerSide === 'left' ? 'right' : 'left'];
      for (const side of sides) {
        acts.push({ t: 'dustRise', artifactId: a.id, free: true, ...(side ? { side: side as 'left' | 'right' } : {}) });
      }
    }
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

/** 「充能」技能的默认参数（供充能后强制结算使用；AI/测试同样走这里）。024 狂舞：把自己第 1 颗骰移到另一个区域。 */
function chargeDefaultAction(p: PlayerState, a: Artifact, s: SkillDef): Action {
  const first = KINDS_ORDER.flatMap((k) => p.areas[k])[0];
  const from = first?.kind ?? 'attack';
  const toKind: DiceKind = from === 'defense' ? 'attack' : 'defense';
  return {
    t: 'skill',
    artifactId: a.id,
    side: s.side,
    params: { owner: 'self', dieId: first?.id, toKind },
  };
}

const KINDS_ORDER: DiceKind[] = ['attack', 'defense', 'meditation'];

/** 029 真言·全知：默认（AI/测试）分配——先把成对的同点骰放防御，再抽顺点三连放攻击，其余冥想 */
export function quanzhiDefaultAssign(p: PlayerState): Record<string, DiceKind> {
  const dice = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation];
  const assign: Record<string, DiceKind> = {};
  const pool = new Map<number, Die[]>();
  for (const d of dice) {
    const arr = pool.get(d.value) ?? [];
    arr.push(d);
    pool.set(d.value, arr);
  }
  for (const [v, arr] of [...pool.entries()]) {
    const pairs = Math.floor(arr.length / 2) * 2;
    for (let i = 0; i < pairs; i++) assign[arr[i].id] = 'defense';
    pool.set(v, arr.slice(pairs));
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let v = 1; v <= 4; v++) {
      const a = pool.get(v);
      const b = pool.get(v + 1);
      const c = pool.get(v + 2);
      if (a?.length && b?.length && c?.length) {
        assign[a[0].id] = 'attack';
        assign[b[0].id] = 'attack';
        assign[c[0].id] = 'attack';
        pool.set(v, a.slice(1));
        pool.set(v + 1, b.slice(1));
        pool.set(v + 2, c.slice(1));
        changed = true;
      }
    }
  }
  for (const d of dice) if (!assign[d.id]) assign[d.id] = 'meditation';
  return assign;
}

/** 029 真言·全知：给定骰（值）里是否还含可组合的「同点对」（同点数 ≥2）或「3 连顺点」（v、v+1、v+2 都有） */
export function quanzhiRemainderHasGroup(dice: { value: number }[]): boolean {
  const cnt = new Map<number, number>();
  for (const d of dice) cnt.set(d.value, (cnt.get(d.value) ?? 0) + 1);
  for (const [, c] of cnt) if (c >= 2) return true;
  for (let v = 1; v <= 4; v++) {
    if ((cnt.get(v) ?? 0) > 0 && (cnt.get(v + 1) ?? 0) > 0 && (cnt.get(v + 2) ?? 0) > 0) return true;
  }
  return false;
}

/** 029 真言·全知：校验玩家的分配是否满足「防御=同点成对 / 攻击=顺点三连 / 其余冥想（且不得再含可分组）」（越界抛错，不静默修正） */
export function validateQuanzhiAssign(g: GameState, player: PlayerId, assign: Record<string, DiceKind>): void {
  const p = g.players[player];
  const dice = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation];
  for (const d of dice) {
    const k = assign[d.id];
    if (k !== 'attack' && k !== 'defense' && k !== 'meditation') {
      throw new Error(`「全知」非法落区：${d.id}`);
    }
  }
  const defCount = new Map<number, number>();
  const atkCount = new Map<number, number>();
  for (const d of dice) {
    if (assign[d.id] === 'defense') defCount.set(d.value, (defCount.get(d.value) ?? 0) + 1);
    if (assign[d.id] === 'attack') atkCount.set(d.value, (atkCount.get(d.value) ?? 0) + 1);
  }
  for (const [v, c] of defCount) if (c % 2 !== 0) throw new Error(`「全知」防御区的 ${v} 点未成对`);
  let total = [...atkCount.values()].reduce((a, b) => a + b, 0);
  if (total % 3 !== 0) throw new Error('「全知」攻击区的骰数必须为 3 的倍数');
  let guard = 0;
  while (total > 0 && guard++ < 100) {
    let found = false;
    for (let v = 1; v <= 4; v++) {
      if ((atkCount.get(v) ?? 0) > 0 && (atkCount.get(v + 1) ?? 0) > 0 && (atkCount.get(v + 2) ?? 0) > 0) {
        atkCount.set(v, atkCount.get(v)! - 1);
        atkCount.set(v + 1, atkCount.get(v + 1)! - 1);
        atkCount.set(v + 2, atkCount.get(v + 2)! - 1);
        total -= 3;
        found = true;
        break;
      }
    }
    if (!found) break;
  }
  if (total !== 0) throw new Error('「全知」攻击区无法拆成顺点三元组');
  // 强制分组：冥想区不得再含「同点对」或「3 连顺点」（有则必须继续分配，FAQ 29.1.2）
  const meditationDice = dice.filter((d) => assign[d.id] === 'meditation');
  if (quanzhiRemainderHasGroup(meditationDice)) {
    throw new Error('「全知」剩余骰仍可组合（同点对/顺点），必须继续分配');
  }
}

/** 「激活」类技能：仅在该侧被“切入”的当回合生效（尘起装填即强制结算；此处用于校验/UI 显示） */
function activationUsable(g: GameState, a: { armedSide: 'left' | 'right' | null; armedTurn: number }, s: { side: 'left' | 'right' | 'only' }): boolean {
  return a.armedSide === (s.side === 'only' ? 'left' : s.side) && a.armedTurn === g.turnIndex;
}

/** 「激活」类技能的默认参数（供尘起装填后的强制结算使用；AI/测试同样走这里） */
function activationDefaultAction(g: GameState, p: PlayerState, a: Artifact, s: SkillDef): Action {
  const base = { t: 'skill' as const, artifactId: a.id, side: s.side };
  if (s.key === 'xuyu.void') return { ...base, params: { kind: 'attack' } };
  if (s.key === 'chengjie.jinghua') {
    const opp: PlayerId = p.id === 'A' ? 'B' : 'A';
    const pick = [...g.players[opp].areas.attack, ...g.players[opp].areas.defense, ...g.players[opp].areas.meditation].filter((d) => d.value === 1);
    return { ...base, params: { targetDieIds: pick.slice(0, 2).map((d) => d.id) } };
  }
  if (s.key === 'chengjie.shuzui') {
    const pick = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation].filter((d) => d.value === 1);
    return { ...base, params: { targetDieIds: pick.slice(0, 2).map((d) => d.id) } };
  }
  if (s.key === 'zhenyan.ganshe') {
    // 默认（AI/测试）：把前 3 颗能力骰统一改为 6 点
    const ids = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation].slice(0, 3).map((d) => d.id);
    return { ...base, params: { value: 6, dieIds: ids } };
  }
  if (s.key === 'ezhao.qingsuan') {
    // 默认（AI/测试）：弃置对方 min(计数, 对方骰数) 颗
    const oppId: PlayerId = p.id === 'A' ? 'B' : 'A';
    const opp = g.players[oppId];
    const oppDice = [...opp.areas.attack, ...opp.areas.defense, ...opp.areas.meditation];
    const d = Math.min(a.count, oppDice.length);
    return { ...base, params: { dieIds: oppDice.slice(0, d).map((x) => x.id) } };
  }
  if (s.key === 'jingang.pozhang' || s.key === 'jingang.puti') {
    // 默认（AI/测试）：取 1/2/3 点
    return { ...base, params: { pips: [1, 2, 3] } };
  }
  return { ...base, params: {} };
}

/** 尘起装填到某侧后，若该侧有「激活」技能：立即强制结算（无选择项则直接执行处理器） */
function resolveActivationOnArm(g: GameState, player: PlayerId, artifactId: string, side: 'left' | 'right'): void {
  const p = g.players[player];
  const a = p.artifacts.find((x) => x.id === artifactId);
  if (!a) return;
  const armed: 'left' | 'right' = side;
  const s = a.skills.find((x) => x.kind === 'activation' && (x.side === armed || (a.column === 3 && x.side === 'only')));
  if (!s) return;
  const handler = SKILL_HANDLERS[s.key];
  if (!handler) return;
  logLine(g, `「${a.name}」的「激活」技能立即结算`);
  if (activationNeedsChoice(s.key)) {
    g.pending = { kind: 'activationResolve', player, artifactId, side: s.side };
    return;
  }
  withRng(g, (rng) =>
    handler.run({
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

/** 该「激活」技能是否需要玩家选择（需要则装填时弹出强制选择器） */
function activationNeedsChoice(key: string): boolean {
  return (
    key === 'xuyu.void' ||
    key === 'chengjie.jinghua' ||
    key === 'chengjie.shuzui' ||
    key === 'zhenyan.ganshe' ||
    key === 'ezhao.qingsuan' ||
    key === 'jingang.pozhang' ||
    key === 'jingang.puti'
  );
}

/** 该技能当前是否属于“可发动”类型（启动 / 必杀；「激活」由尘起装填时强制结算，不在此列） */
function isUsableKind(kind: string): boolean {
  return kind === 'activate' || kind === 'ultimate';
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
      } else if (s.key === 'xuyu.sacrifice') {
        // 016 献祭（启动）：受到 4 真伤 → 二选一（默认 ①获得 3 随机骰）
        acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { choice: 'dice' } });
      } else if (s.key === 'youming.mingjie') {
        // 017 冥界行走（启动）：消耗最多 3 冥想骰 → 获得同等数量随机攻击骰
        if (p.areas.meditation.length >= 1) {
          acts.push({
            t: 'skill',
            artifactId: a.id,
            side: s.side,
            params: { costSlots: p.areas.meditation.slice(0, 3).map((d) => ({ dieIds: [d.id] })) },
          });
        }
      } else if (s.key === 'zhihai.bloom.ultimate') {
        // 018 漆黑绽放（必杀）：计数 ≥1 时可主动发动（FAQ 18.1.3）；计数=5 由引擎强制发动
        if (a.count >= 1) acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: {} });
      } else if (s.key === 'chenai.fang') {
        // 019 蛮王之牙（启动）：默认消耗 1 个任意能力骰 + 选择 ② 获得 1 个 3 点攻击骰
        const anyDie = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation][0];
        if (anyDie) {
          acts.push({
            t: 'skill',
            artifactId: a.id,
            side: s.side,
            params: { costSlots: [{ dieIds: [anyDie.id] }], picks: ['gain'] },
          });
        }
      } else if (s.key === 'siji.tiandan') {
        // 022 死契·填弹（启动）：默认消耗 1 个任意能力骰（1 颗无「顺点」要求）
        const anyDie = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation][0];
        if (anyDie) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { dieIds: [anyDie.id] } });
        }
      } else if (s.key === 'shexie.weiju') {
        // 023 蛇蝎·畏惧（启动）：我方与对方都必须有至少 1 颗能力骰，否则不能发动
        const opp: PlayerId = p.id === 'A' ? 'B' : 'A';
        const anyDie = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation][0];
        const oppDice = [...g.players[opp].areas.attack, ...g.players[opp].areas.defense, ...g.players[opp].areas.meditation];
        if (anyDie && oppDice.length >= 1) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { dieId: anyDie.id } });
        }
      } else if (s.key === 'shexie.gongzhen') {
        // 023 蛇蝎·共振（启动）：默认重掷我方第 1 颗骰
        const anyDie = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation][0];
        if (anyDie) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { dieId: anyDie.id } });
        }
      } else if (s.key === 'kuangwu.ultimate') {
        // 024 狂舞·凶弹业舞（必杀）：默认每个区域取最多 3 颗、顺时针
        const opp: PlayerId = p.id === 'A' ? 'B' : 'A';
        const groups = [p, g.players[opp]].flatMap((who) =>
          (['defense', 'attack', 'meditation'] as const).map((k) => who.areas[k].slice(0, 3).map((d) => d.id)),
        );
        acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { groups, direction: 'cw' } });
      } else if (s.key === 'hanguang.ultimate') {
        // 027 寒光·凛冽之音（必杀）：取 1–6 点各 1 颗置于本神器上（无需参数）
        acts.push({ t: 'skill', artifactId: a.id, side: s.side });
      } else if (s.key === 'jiushu.huanyu.ultimate') {
        // 030 救赎·寰宇飞升（必杀）：消耗 4 个冥想骰
        if (p.areas.meditation.length >= 4) {
          acts.push({
            t: 'skill',
            artifactId: a.id,
            side: s.side,
            params: { costSlots: p.areas.meditation.slice(0, 4).map((d) => ({ dieIds: [d.id] })) },
          });
        }
      } else if (s.key === 'mengyan.eyi') {
        // 032 梦魇·恶意（启动）：消耗 1 个攻击骰 → 获得 2 个随机点数冥想骰
        if (p.areas.attack.length >= 1) {
          acts.push({
            t: 'skill',
            artifactId: a.id,
            side: s.side,
            params: { costSlots: [{ dieIds: [p.areas.attack[0].id] }] },
          });
        }
      } else if (s.key === 'qianjie.chaodu') {
        // 035 千劫·超度（启动）：消耗 2 个点数相同的冥想骰 → 5 真伤 → 重掷任意玩家一区
        const byVal = new Map<number, string[]>();
        for (const d of p.areas.meditation) {
          const arr = byVal.get(d.value) ?? [];
          arr.push(d.id);
          byVal.set(d.value, arr);
        }
        // 034 金刚·破障（持续）生效时，神器上按分布为「冥想」的存放骰也可用于支付
        if (hasActiveSkill(p, 'jingang.pozhang.continuous')) {
          const dist = emptyDistribution(p);
          if (dist) {
            for (const a of p.artifacts) {
              for (const h of a.heldDice ?? []) {
                if (areaOf(h.value, dist) === 'meditation') {
                  const arr = byVal.get(h.value) ?? [];
                  arr.push(h.id);
                  byVal.set(h.value, arr);
                }
              }
            }
          }
        }
        const pairIds = [...byVal.values()].find((ids) => ids.length >= 2);
        if (pairIds) {
          acts.push({
            t: 'skill',
            artifactId: a.id,
            side: s.side,
            params: {
              costSlots: [{ dieIds: [pairIds[0]] }, { dieIds: [pairIds[1]] }],
              targetOwner: 'opponent',
              targetKind: 'attack',
            },
          });
        }
      } else if (s.key === 'wuxiang.wanxiang.ultimate') {
        // 036 无相·万象俱灭（必杀）：仅当双方 6 区中 1–6 点各至少 1 个时提供（默认各取首个）
        const seen = new Set<number>();
        const keepIds: string[] = [];
        for (const who of ['A', 'B'] as PlayerId[]) {
          for (const k of KINDS_ORDER) {
            for (const d of g.players[who].areas[k]) {
              if (!seen.has(d.value)) {
                seen.add(d.value);
                keepIds.push(d.id);
              }
            }
          }
        }
        if (seen.size === 6) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { keepIds } });
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
      for (const h of heldAbilityDice(g, g.pending.player)) {
        if (h.kind === 'defense') acts.push({ t: 'guwangCancel', cancel: true, defenseDieId: h.id });
      }
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
        ...heldAbilityDice(g, g.pending.player)
          .filter((h) => h.kind === 'meditation')
          .map((h) => ({ t: 'dunwuHalve' as const, accept: true, meditationDieId: h.id })),
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
    if (g.pending.kind === 'sijiChuxing') {
      return [
        { t: 'chuxingPick', pick: 'none' },
        { t: 'chuxingPick', pick: 'unblockable' },
        { t: 'chuxingPick', pick: 'bonus5' },
      ];
    }
    if (g.pending.kind === 'weijuPay') {
      const p = g.players[g.pending.player];
      const acts: Action[] = [];
      for (const k of ['attack', 'defense', 'meditation'] as const) {
        for (const d of p.areas[k]) acts.push({ t: 'weijuPay', dieId: d.id });
      }
      for (const h of heldAbilityDice(g, g.pending.player)) acts.push({ t: 'weijuPay', dieId: h.id });
      return acts;
    }
    if (g.pending.kind === 'gongzhenPick') {
      const pd = g.pending;
      const me = g.players[pd.player];
      const opp = g.players[pd.player === 'A' ? 'B' : 'A'];
      const acts: Action[] = [{ t: 'gongzhenResolve', pick: 'gain' }];
      const myIds = me.areas[pd.areaKind].slice(0, 2).map((d) => d.id); // 默认候选（AI/测试用）
      const oppIds = opp.areas[pd.areaKind].slice(0, 2).map((d) => d.id);
      if (myIds.length + oppIds.length > 0) acts.push({ t: 'gongzhenResolve', pick: 'discard', myIds, oppIds });
      return acts;
    }
    if (g.pending.kind === 'chargeResolve') {
      const pd = g.pending;
      const p = g.players[pd.player];
      const a = p.artifacts.find((x) => x.id === pd.artifactId);
      const s = a?.skills.find((x) => x.kind === 'charge');
      if (!a || !s) return [{ t: 'advance' }];
      return [chargeDefaultAction(p, a, s)];
    }
    if (g.pending.kind === 'weiyaPick') {
      const pd = g.pending;
      const me = g.players[pd.player];
      const opp = g.players[pd.player === 'A' ? 'B' : 'A'];
      const acts: Action[] = [{ t: 'weiyaPick', owner: 'self' }]; // 省略 dieId = 不发动「威压」
      for (const k of KINDS_ORDER) {
        for (const d of me.areas[k]) acts.push({ t: 'weiyaPick', owner: 'self', dieId: d.id });
        for (const d of opp.areas[k]) acts.push({ t: 'weiyaPick', owner: 'opp', dieId: d.id });
      }
      return acts;
    }
    if (g.pending.kind === 'xianzhenPick') {
      const pd = g.pending;
      const ownerP = g.players[pd.owner];
      const acts: Action[] = [];
      for (const k of KINDS_ORDER) {
        for (const d of ownerP.areas[k]) acts.push({ t: 'xianzhenResolve', dieId: d.id });
      }
      return acts;
    }
    if (g.pending.kind === 'hengguan') {
      const pd = g.pending;
      const opp = g.players[pd.player === 'A' ? 'B' : 'A'];
      const acts: Action[] = [{ t: 'hengguan' }]; // 省略 dieId = 不发动
      for (const k of KINDS_ORDER) {
        for (const d of opp.areas[k]) {
          if (d.value < pd.value) acts.push({ t: 'hengguan', dieId: d.id });
        }
      }
      return acts;
    }
    if (g.pending.kind === 'hanguangPick') {
      const pd = g.pending;
      const card = artifactWithSkill(g.players[pd.player], 'hanguang.ultimate');
      const held = card?.heldDice ?? [];
      const opp = g.players[pd.player === 'A' ? 'B' : 'A'];
      const acts: Action[] = [];
      for (const h of held) {
        acts.push({ t: 'hanguangPick', pick: 'move', dieId: h.id });
        for (const k of KINDS_ORDER) {
          for (const d of opp.areas[k]) {
            if (d.value === h.value) {
              acts.push({ t: 'hanguangPick', pick: 'discard', dieId: h.id, targetDieId: d.id });
            }
          }
        }
      }
      return acts;
    }
    if (g.pending.kind === 'chenaiFreeRise') {
      return [
        { t: 'chenaiFreeRise', accept: true },
        { t: 'chenaiFreeRise', accept: false },
      ];
    }
    if (g.pending.kind === 'quanzhiAssign') {
      const pd = g.pending;
      return [{ t: 'quanzhiAssign', assign: quanzhiDefaultAssign(g.players[pd.player]) }];
    }
    if (g.pending.kind === 'kuyu') {
      return [
        { t: 'kuyuResolve', area: 'attack' },
        { t: 'kuyuResolve', area: 'defense' },
        { t: 'kuyuResolve', area: 'meditation' },
      ];
    }
    if (g.pending.kind === 'tiaolingPick') {
      // 默认（AI/测试）：选「全不同」，弃掉重复点数（每点数留 1 颗）
      const p = g.players[g.pending.player];
      const all = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation];
      const seen = new Set<number>();
      const discard: string[] = [];
      for (const d of all) {
        if (seen.has(d.value)) discard.push(d.id);
        else seen.add(d.value);
      }
      return [{ t: 'tiaolingResolve', pick: 'diff', dieIds: discard }];
    }
    if (g.pending.kind === 'endDiscard') {
      // 默认（AI/测试）：弃前 N 颗；真人由 UI 打开选择器自选
      const p = g.players[g.pending.player];
      const excess = Math.max(0, totalDice(p) - effectiveWill(p));
      const all = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation];
      return [{ t: 'endDiscardResolve', dieIds: all.slice(0, excess).map((d) => d.id) }];
    }
    if (g.pending.kind === 'wanzhangDiscard') {
      const p = g.players[g.pending.player];
      const all = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation];
      const n = Math.min(2, all.length);
      return [{ t: 'wanzhangDiscard', dieIds: all.slice(0, n).map((d) => d.id) }];
    }
    if (g.pending.kind === 'putiPick') {
      return [
        { t: 'putiResolve', accept: false },
        { t: 'putiResolve', accept: true },
      ];
    }
    if (g.pending.kind === 'shouhunCancel') {
      return [
        { t: 'shouhunCancel', cancel: true },
        { t: 'shouhunCancel', cancel: false },
      ];
    }
    if (g.pending.kind === 'activationResolve') {
      const pd = g.pending;
      const p = g.players[pd.player];
      const a = p.artifacts.find((x) => x.id === pd.artifactId);
      const s = a?.skills.find((x) => x.kind === 'activation' && x.side === pd.side);
      if (!a || !s) return [{ t: 'advance' }];
      return [activationDefaultAction(g, p, a, s)];
    }
    if (g.pending.kind === 'weimu') {
      const pd = g.pending;
      const opp: PlayerId = pd.player === 'A' ? 'B' : 'A';
      const acts: Action[] = [{ t: 'weimu', accept: false }];
      const o = g.players[opp];
      for (const k of ['attack', 'defense', 'meditation'] as const) {
        for (const d of o.areas[k]) acts.push({ t: 'weimu', accept: true, dieId: d.id });
      }
      return acts;
    }
    if (g.pending.kind === 'zhihaiReroll') {
      const pd = g.pending;
      const p = g.players[pd.player];
      const all = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation];
      const acts: Action[] = [{ t: 'zhihaiReroll', dieIds: [] }];
      const pick = all.slice(0, Math.min(pd.x, all.length)).map((d) => d.id);
      if (pick.length > 0) acts.push({ t: 'zhihaiReroll', dieIds: pick });
      return acts;
    }
    const pp = g.players[g.pending.player];
    const acts: Action[] = [{ t: 'fengmang', accept: false }];
    // 034 破障（持续）：存放骰按分布视为攻击/冥想骰时也可作为「锋芒」的代价
    const held = heldAbilityDice(g, g.pending.player);
    const atkIds = [
      ...pp.areas.attack.map((d) => d.id),
      ...held.filter((h) => h.kind === 'attack').map((h) => h.id),
    ];
    const medIds = [
      ...pp.areas.meditation.map((d) => d.id),
      ...held.filter((h) => h.kind === 'meditation').map((h) => h.id),
    ];
    if (atkIds.length > 0 && medIds.length > 0) {
      for (const a of atkIds) {
        for (const m of medIds) {
          acts.push({ t: 'fengmang', accept: true, attackDieId: a, meditationDieId: m });
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
    const pa = g.pendingAttack;
    const defender: PlayerId = pa.attacker === 'A' ? 'B' : 'A';
    const acts: Action[] = [{ t: 'block' }];
    if (!pa.unblockable) {
      // 028 天罚：只能用指定类型的骰抵挡（白昼之火=冥想 / 陨落=攻击）；否则用防御骰
      const kind = pa.blockKind ?? 'defense';
      for (const d of g.players[defender].areas[kind]) {
        acts.push({ t: 'block', costSlots: [{ dieIds: [d.id] }] });
      }
      for (const h of heldAbilityDice(g, defender)) {
        if (h.kind === kind) acts.push({ t: 'block', costSlots: [{ dieIds: [h.id] }] });
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
      // 034 破障（持续）：神器上存放的骰按分布视为攻击骰时，也可用于发起攻击
      for (const h of heldAbilityDice(g, g.activePlayer)) {
        if (h.kind === 'attack') acts.push({ t: 'attack', costSlots: [{ dieIds: [h.id] }] });
      }
      // 025 屠虎·奇袭（持续）：把「点数不在对方任意区域」的能力骰**视为攻击骰**发起攻击
      // （默认候选供 AI/测试；真人由 UI 显式选择）
      if (hasActiveSkill(p, 'tuohu.qixi')) {
        for (const k of ['defense', 'meditation'] as const) {
          for (const d of p.areas[k]) {
            if (canTreatAsAttack(g, g.activePlayer, d.id)) {
              acts.push({ t: 'attack', costSlots: [{ dieIds: [d.id], treated: true }] });
            }
          }
        }
      }
      acts.push(...activateSkillActions(g, p));
      // 019 尘起赠予的免费额外尘起：可在主要阶段立即使用（不耗冥想骰、不占每回合 1 次）
      if (g.freeNoCostRise > 0) {
        for (const a of dustRiseActions(g, g.activePlayer)) {
          if (a.t === 'dustRise' && a.free) acts.push(a);
        }
      }
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
    // 024 狂舞：充能技能需要玩家选择（哪一方哪颗骰 → 移到该玩家另一区域）→ 弹出强制选择器
    if (cs.needsChoice) {
      g.pending = { kind: 'chargeResolve', player, artifactId };
      return;
    }
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

/** 每种「待决策」对应的解算动作类型（替代手写白名单，新增 pending 时只需在此登记） */
const PENDING_ACTION: Record<Pending['kind'], Action['t']> = {
  caiyuliu: 'caiyuliu',
  fengmang: 'fengmang',
  guwangCharge: 'guwangCharge',
  guwangCancel: 'guwangCancel',
  shenhongKill: 'shenhongKill',
  dunwuHalve: 'dunwuHalve',
  dunwuPulse: 'dunwuPulse',
  leibaoReroll: 'leibaoReroll',
  dianxing: 'dianxing',
  leibao: 'leibao',
  activationResolve: 'skill',
  weimu: 'weimu',
  zhihaiReroll: 'zhihaiReroll',
  chenaiFreeRise: 'chenaiFreeRise',
  shouhunCancel: 'shouhunCancel',
  sijiChuxing: 'chuxingPick',
  weijuPay: 'weijuPay',
  gongzhenPick: 'gongzhenResolve',
  chargeResolve: 'skill',
  weiyaPick: 'weiyaPick',
  xianzhenPick: 'xianzhenResolve',
  hengguan: 'hengguan',
  hanguangPick: 'hanguangPick',
  quanzhiAssign: 'quanzhiAssign',
  kuyu: 'kuyuResolve',
  tiaolingPick: 'tiaolingResolve',
  endDiscard: 'endDiscardResolve',
  wanzhangDiscard: 'wanzhangDiscard',
  putiPick: 'putiResolve',
};

export function applyAction(g: GameState, action: Action): GameState {
  if (g.phase === 'gameOver') throw new Error('game is over');
  if (g.pending && action.t !== PENDING_ACTION[g.pending.kind]) {
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
        withRng(g, (rng) => doReroll(g, g.activePlayer, action.dieIds, rng));
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
      withRng(g, (rng) => doReroll(g, g.activePlayer, action.dieIds, rng));
      g.rerollUsed += 1;
      // 029 真言·全知（持续）：重掷阶段同样不按常规分布落区，由玩家重新分配全部能力骰
      if (hasActiveSkill(g.players[g.activePlayer], 'zhenyan.quanzhi')) {
        queuePending(g, { kind: 'quanzhiAssign', player: g.activePlayer });
      }
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
      if (action.accept === false) {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 不发动「电刑」`);
        pumpAttackQueue(g);
        break;
      }
      const ids = action.dieIds ?? [];
      if (ids.length !== 2) throw new Error('电刑需消耗恰好 2 个冥想骰');
      for (const id of ids) {
        const info = abilityDieInfo(g, pd.player, id);
        if (!info || info.kind !== 'meditation') throw new Error(`电刑需要冥想骰: ${id}`);
      }
      g.pending = null;
      // 「消耗 2 个冥想骰」→ 走 paySlots（与「使用/消耗」语义一致：支持 010 置换 / 034 破障 / 触发 026 威压）
      const eff = paySlots(
        g,
        pd.player,
        [{ kind: 'meditation' }, { kind: 'meditation' }],
        ids.map((id) => ({ dieIds: [id] })),
        undefined,
        'skill',
      );
      const pickedVals = eff.map((e) => e.value);
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
      // 019 尘起赠予的免费额外尘起（可在主要阶段立即使用，不耗冥想骰、不占每回合 1 次）
      if (action.free) {
        if (g.freeNoCostRise <= 0) throw new Error('no free dust rise available');
      } else if (g.phase !== 'dustRise') {
        throw new Error('not dust rise phase');
      }
      const p = g.players[g.activePlayer];
      // 第三列：只有「本次充能完成激活」时才结算该神器的「激活」技能（续充不重复结算）
      const beforeRise = p.artifacts.find((x) => x.id === action.artifactId);
      const wasFullyCharged = beforeRise?.column === 3 && beforeRise.chargeLayer >= (beforeRise.chargeReq ?? 0);
      if (action.free) {
        g.freeNoCostRise -= 1;
      } else if (action.useSeal) {
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
        paySlots(g, g.activePlayer, [{ kind: 'meditation' }], action.costSlots, undefined, 'dustRise');
      }
      const desc = applyDustRiseToArtifact(g, g.activePlayer, action.artifactId, action.side);
      logLine(
        g,
        `${pname(g.activePlayer)} 尘起：${desc}${action.useSeal ? '（使用尘印标记）' : ''}`,
      );
      runChargeSkill(g, g.activePlayer, action.artifactId);
      // 「激活」类技能：装填到该侧的瞬间立即强制结算（016 虚无形态 / 014 净化·数罪并罚 / 020 兽魂 / 021 决意）
      // 第三列续充（wasFullyCharged）不再重复结算「激活」
      const justArmed = g.players[g.activePlayer].artifacts.find((x) => x.id === action.artifactId);
      if (!wasFullyCharged && (justArmed?.armedSide === 'left' || justArmed?.armedSide === 'right')) {
        resolveActivationOnArm(g, g.activePlayer, action.artifactId, justArmed.armedSide);
      }
      g.dustRiseActed = true;
      break;
    }
    case 'attack':
      if (g.phase !== 'main') throw new Error('not main phase');
      if (g.pendingAttack) throw new Error('pending attack unresolved');
      assertConversionAllowed(g, g.activePlayer, action.costSlots);
      assertTreatedAllowed(g, g.activePlayer, action.costSlots);
      // 027 寒光·必杀：使用攻击骰前先决定是否使用神器上的骰子（先于 022；两者仅可能在非预选模式共存）
      if (canUseHanguang(g, g.activePlayer)) {
        g.pending = { kind: 'hanguangPick', player: g.activePlayer, costSlots: action.costSlots };
        break;
      }
      // 022 死契·处刑通牒：使用攻击骰前必须先决定是否扣计数（FAQ 22.2.1：优先于抵挡与「灵能屏障」）
      if (hasActiveSkill(g.players[g.activePlayer], 'siji.chuxing') && (artifactWithSkill(g.players[g.activePlayer], 'siji.chuxing')?.count ?? 0) >= 1) {
        g.pending = { kind: 'sijiChuxing', player: g.activePlayer, costSlots: action.costSlots };
        break;
      }
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
        // 「消耗 1 攻击骰 + 1 冥想骰」→ 走 paySlots（支持 010 置换 / 034 破障 / 触发 026 威压）
        const eff = paySlots(
          g,
          pd.player,
          [{ kind: 'attack' }, { kind: 'meditation' }],
          [{ dieIds: [action.attackDieId] }, { dieIds: [action.meditationDieId] }],
          undefined,
          'skill',
        );
        const av = eff[0].value;
        const mv = eff[1].value;
        applyLifeLoss(g, pd.defenderId, pd.value);
        logLine(
          g,
          `${pname(pd.player)} 发动「锋芒」：消耗 1 颗攻击骰（${av}点）与 1 颗冥想骰（${mv}点），取消抵挡并追加 2 点真实伤害`,
        );
        if ((g.phase as string) !== 'gameOver') dealTrueDamage(g, pd.defenderId, 2, pd.player);
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
      const dieId = action.defenseDieId;
      // 支付填法：显式 costSlots（010 置换 2 颗顶 1）优先；否则单颗 defenseDieId
      const fills: SlotFill[] | null =
        action.costSlots && action.costSlots.length === 1
          ? action.costSlots
          : dieId
            ? [{ dieIds: [dieId] }]
            : null;
      let consumed: { value: number; converted: boolean } | null = null;
      if (action.cancel && fills) {
        const firstId = fills[0].dieIds[0];
        const info = abilityDieInfo(g, pd.player, firstId);
        const convertible = fills[0].dieIds.length === 2;
        if (convertible || (info && info.kind === 'defense')) {
          // 「消耗 1 个防御骰」→ 走 paySlots（支持 010 置换 / 034 破障 / 触发 026 威压）
          const eff = paySlots(g, pd.player, [{ kind: 'defense' }], fills, undefined, 'skill');
          consumed = { value: eff[0].value, converted: convertible };
        }
      }
      if (consumed) {
        logLine(
          g,
          `${pname(pd.player)} 「高塔铁幕」：消耗 1 个防御骰（${consumed.value}点${consumed.converted ? '·置换' : ''}），取消 ${pd.amount} 点真实伤害`,
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
        dealTrueDamage(g, opponent, 3, pd.player);
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
      const dieId = action.meditationDieId;
      // 支付填法：显式 costSlots（010 置换 2 颗顶 1）优先；否则单颗 meditationDieId
      const fills: SlotFill[] | null =
        action.costSlots && action.costSlots.length === 1
          ? action.costSlots
          : dieId
            ? [{ dieIds: [dieId] }]
            : null;
      let paid = false;
      if (action.accept && fills) {
        const firstId = fills[0].dieIds[0];
        const info = abilityDieInfo(g, pd.player, firstId);
        const convertible = fills[0].dieIds.length === 2;
        if (convertible || (info && info.kind === 'meditation')) {
          // 「消耗 1 个冥想骰」→ 走 paySlots（支持 010 置换 / 034 破障 / 触发 026 威压）
          paySlots(g, pd.player, [{ kind: 'meditation' }], fills, undefined, 'skill');
          paid = true;
        }
      }
      if (paid) {
        if (g.pendingAttack) {
          // 统一减半入口：同种削减不叠加（屏障 / 021 满计数 / 023 畏惧 只减半一次，FAQ 21.1.5）
          const ok = halveAttackDamage(g.pendingAttack, '灵能屏障');
          logLine(
            g,
            ok
              ? `${pname(pd.player)} 「灵能屏障」：消耗 1 个冥想骰，伤害减半为 ${g.pendingAttack.value}`
              : `${pname(pd.player)} 「灵能屏障」：本次攻击已在减半状态，不再叠加（同种削减不叠加）`,
          );
        }
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
        dealTrueDamage(g, opponent, pd.amount, pd.player);
        g.dunwuPulseUsedThisTurn = true;
      } else {
        logLine(g, `${pname(pd.player)} 放弃灵能脉冲`);
        g.pending = null;
      }
      break;
    }
    case 'weimu': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'weimu') throw new Error('no weimu pending');
      g.pending = null;
      if (action.accept === false) {
        logLine(g, `${pname(pd.player)} 不发动「帷幕」`);
        break;
      }
      const dieId = action.dieId;
      if (!dieId) throw new Error('missing die');
      const opp: PlayerId = pd.player === 'A' ? 'B' : 'A';
      const found = findDieOf(g, opp, dieId);
      if (!found) throw new Error(`not ${pname(opp)}'s ability die: ${dieId}`);
      const val = found.die.value;
      logLine(g, `${pname(pd.player)} 发动「帷幕」：受到 2 点真实伤害，弃置 ${pname(opp)} 的 1 个能力骰（${val}点）`);
      dealTrueDamage(g, pd.player, 2, pd.player);
      consumeDice(g.players[opp], found.kind, [dieId]);
      break;
    }
    case 'zhihaiReroll': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'zhihaiReroll') throw new Error('no zhihaiReroll pending');
      const ids = action.dieIds;
      if (ids.length > pd.x) throw new Error(`最多重掷 ${pd.x} 个能力骰`);
      if (new Set(ids).size !== ids.length) throw new Error('duplicate die id');
      for (const id of ids) {
        if (!findDieOf(g, pd.player, id)) throw new Error(`not your ability die: ${id}`);
      }
      g.pending = null;
      if (ids.length === 0) {
        logLine(g, `${pname(pd.player)} 「漆黑绽放」：不重掷`);
        break;
      }
      withRng(g, (rng) => doReroll(g, pd.player, ids, rng));
      break;
    }
    case 'chenaiFreeRise': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'chenaiFreeRise') throw new Error('no chenaiFreeRise pending');
      g.pending = null;
      if (action.accept) {
        g.freeNoCostRise += 1;
        logLine(g, `${pname(pd.player)} 「尘起」：获得 1 次无需冥想骰的额外尘起行动（可在主要阶段立即使用）`);
      } else {
        logLine(g, `${pname(pd.player)} 放弃「尘起」的额外尘起行动`);
      }
      break;
    }
    case 'shouhunCancel': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'shouhunCancel') throw new Error('no shouhunCancel pending');
      const pa2 = pd.attack;
      g.pending = null;
      if (action.cancel) {
        const owner = g.players[pd.owner];
        const card = owner.artifacts.find((x) => x.skills.some((s) => s.key === 'shouhun.xiong.continuous' || s.key === 'shouhun.lang.continuous'));
        if (card && card.count > 0) card.count -= 1;
        logLine(
          g,
          `${pname(pd.player)} 「兽魂」：取消本次 ${pa2.value} 点伤害，令 ${pname(pd.owner)} 的「兽魂」计数下降 1 点${
            card ? `（${card.count}）` : ''
          }`,
        );
        break;
      }
      logLine(g, `${pname(pd.player)} 「兽魂」：不取消，正常造成伤害`);
      const before = g.players[pd.owner].life;
      applyLifeLoss(g, pd.owner, pa2.value);
      logLine(g, `${pname(pd.owner)} 未抵挡，受到 ${pa2.value} 点伤害（生命 ${before} → ${g.players[pd.owner].life}）`);
      if ((g.phase as string) !== 'gameOver') {
        afterAttackResolved(g, pa2, { blocked: false, damageDealt: pa2.value });
        pumpAttackQueue(g);
      }
      break;
    }
    case 'chuxingPick': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'sijiChuxing') throw new Error('no sijiChuxing pending');
      const card = artifactWithSkill(g.players[pd.player], 'siji.chuxing');
      g.pending = null;
      if (action.pick === 'none') {
        logLine(g, `${pname(pd.player)} 不发动「处刑通牒」`);
        doAttack(g, pd.player, pd.costSlots);
        break;
      }
      if (!card || card.count < 1) throw new Error('no 「死契」 count to spend');
      card.count -= 1;
      const mods: AttackMods =
        action.pick === 'unblockable'
          ? { minBonus: 1, bonusLabel: '处刑通牒', forceUnblockable: true }
          : { minBonus: 5, bonusLabel: '处刑通牒' };
      logLine(
        g,
        `${pname(pd.player)} 发动「处刑通牒」：计数 −1（${card.count}），本次攻击${
          action.pick === 'unblockable' ? '伤害 +1 且不可抵挡' : '伤害 +5'
        }`,
      );
      doAttack(g, pd.player, pd.costSlots, mods);
      break;
    }
    case 'weijuPay': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'weijuPay') throw new Error('no weijuPay pending');
      const p = g.players[pd.player];
      // 支付填法：显式 costSlots（010 置换 2 颗顶 1）优先；否则单颗 dieId
      const fills: SlotFill[] | null =
        action.costSlots && action.costSlots.length === 1
          ? action.costSlots
          : action.dieId
            ? [{ dieIds: [action.dieId] }]
            : null;
      if (!fills) throw new Error('weijuPay needs a die');
      const firstId = fills[0].dieIds[0];
      const info = abilityDieInfo(g, pd.player, firstId);
      if (!info) throw new Error(`not your ability die: ${firstId}`);
      const spec = fills[0].dieIds.length === 2 ? [{ kind: 'meditation' as DiceKind }] : [{ kind: info.kind }];
      // 「对方必须消耗 1 个任意能力骰」→ 走 paySlots（支持 010 置换 / 034 破障 / 触发 026 威压）
      const eff = paySlots(g, pd.player, spec, fills, undefined, 'skill');
      const theirValue = eff[0].value;
      g.pending = null;
      const kindCn = info.kind === 'attack' ? '攻击' : info.kind === 'defense' ? '防御' : '冥想';
      logLine(
        g,
        `${pname(pd.player)} 因「畏惧」消耗 1 颗${kindCn}骰（${theirValue}点），与 ${pname(pd.initiator)} 的 ${pd.initiatorValue} 点比较`,
      );
      // FAQ 23.2.1：1 点视为大于 6 点
      const beats = (x: number, y: number): boolean => (x === 1 && y === 6 ? true : y === 1 && x === 6 ? false : x > y);
      if (beats(pd.initiatorValue, theirValue)) {
        p.attackHalvedNextTurn = true;
        logLine(g, `「畏惧」生效：${pname(pd.player)} 点数较小 → 其下个回合中攻击造成的伤害减半`);
      } else {
        logLine(g, `「畏惧」未生效（1 视为大于 6；相等或更大则无事发生）`);
      }
      break;
    }
    case 'gongzhenResolve': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'gongzhenPick') throw new Error('no gongzhenPick pending');
      const me = pd.player;
      const opp: PlayerId = me === 'A' ? 'B' : 'A';
      g.pending = null;
      const kind = pd.areaKind;
      const kindCn = kind === 'attack' ? '攻击' : kind === 'defense' ? '防御' : '冥想';
      if (action.pick === 'gain') {
        withRng(g, (rng) => {
          gainRandomDice(g, me, kind, 2, rng);
          gainRandomDice(g, opp, kind, 2, rng);
        });
        logLine(g, `「共振」：${pname(me)} 与 ${pname(opp)} 各获得 2 个随机点数的${kindCn}骰`);
        break;
      }
      // ② 双方各弃置最多 2 颗该类型（由发起者选择；不足则尽可能，FAQ 23.2.2）
      const pickFor = (who: PlayerId, ids: string[]): number => {
        const valid = ids.filter((id) => g.players[who].areas[kind].some((d) => d.id === id)).slice(0, 2);
        if (valid.length > 0) consumeDice(g.players[who], kind, valid);
        return valid.length;
      };
      const mine = pickFor(me, action.myIds ?? []);
      const theirs = pickFor(opp, action.oppIds ?? []);
      logLine(g, `「共振」：${pname(me)} 弃置自己 ${mine} 颗、${pname(opp)} 的 ${theirs} 颗${kindCn}骰`);
      break;
    }
    case 'weiyaPick': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'weiyaPick') throw new Error('no weiyaPick pending');
      if (!action.dieId) {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 不发动「威压」`);
        break;
      }
      const target: PlayerId = action.owner === 'opp' ? (pd.player === 'A' ? 'B' : 'A') : pd.player;
      const old = setDieValue(g, target, action.dieId, pd.value);
      g.pending = null;
      logLine(
        g,
        `${pname(pd.player)} 发动「威压」：将 ${pname(target)} 的 1 颗能力骰 ${old} → ${pd.value}（保留原区域）`,
      );
      break;
    }
    case 'xianzhenResolve': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'xianzhenPick') throw new Error('no xianzhenPick pending');
      const found = findDieOf(g, pd.owner, action.dieId);
      if (!found) throw new Error(`not ${pd.owner} ability die: ${action.dieId}`);
      const ownerP = g.players[pd.owner];
      ownerP.areas[found.kind] = ownerP.areas[found.kind].filter((d) => d.id !== action.dieId);
      logLine(
        g,
        `「陷阵」：${pname(pd.player)} 选择弃置 ${pname(pd.owner)} 的 ${found.die.value} 点能力骰`,
      );
      // 然后：持有者获得「另外两种类型」的随机点数能力骰各 1 个
      const others = KINDS_ORDER.filter((k) => k !== found.kind);
      withRng(g, (rng) => {
        const gained = others.flatMap((k) => gainRandomDice(g, pd.owner, k, 1, rng));
        logLine(
          g,
          `${pname(pd.owner)} 「陷阵」：获得另外两种类型的随机点数能力骰各 1 个（${gained
            .map((d) => d.value)
            .join('/')}）`,
        );
      });
      g.pending = null;
      break;
    }
    case 'hengguan': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'hengguan') throw new Error('no hengguan pending');
      if (!action.dieId) {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 不发动「横贯」`);
        break;
      }
      const oppId: PlayerId = pd.player === 'A' ? 'B' : 'A';
      const found = findDieOf(g, oppId, action.dieId);
      if (!found) throw new Error(`not ${oppId} ability die: ${action.dieId}`);
      if (found.die.value >= pd.value) throw new Error('「横贯」只能弃置点数小于该攻击的能力骰');
      const oppP = g.players[oppId];
      oppP.areas[found.kind] = oppP.areas[found.kind].filter((d) => d.id !== action.dieId);
      g.pending = null;
      logLine(
        g,
        `${pname(pd.player)} 发动「横贯」：弃置 ${pname(oppId)} 的 ${found.die.value} 点能力骰（小于本次攻击 ${pd.value} 点）`,
      );
      break;
    }
    case 'hanguangPick': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'hanguangPick') throw new Error('no hanguangPick pending');
      const card = artifactWithSkill(g.players[pd.player], 'hanguang.ultimate');
      if (!card || !card.heldDice) throw new Error('no 寒光·必杀 data');
      const held = card.heldDice.find((d) => d.id === action.dieId);
      if (!held) throw new Error(`held die not found: ${action.dieId}`);
      const oppId: PlayerId = pd.player === 'A' ? 'B' : 'A';
      const kindCnOf = (k: DiceKind): string => (k === 'attack' ? '攻击' : k === 'defense' ? '防御' : '冥想');
      if (action.pick === 'move') {
        const dist = g.players[pd.player].artifacts.find((a) => a.column === 2)?.distribution;
        if (!dist) throw new Error('no distribution');
        const kind = areaOf(held.value, dist);
        card.heldDice = card.heldDice.filter((d) => d.id !== action.dieId);
        g.players[pd.player].areas[kind].push({ id: held.id, value: held.value, kind });
        logLine(
          g,
          `${pname(pd.player)} 「凛冽之音」：将神器上的 ${held.value} 点骰移入${kindCnOf(kind)}骰区`,
        );
      } else {
        if (!action.targetDieId) throw new Error('missing target die');
        const found = findDieOf(g, oppId, action.targetDieId);
        if (!found) throw new Error(`not ${oppId} ability die: ${action.targetDieId}`);
        if (found.die.value !== held.value) {
          throw new Error('「凛冽之音」只能弃置与神器上该骰点数相同的对方能力骰');
        }
        g.players[oppId].areas[found.kind] = g.players[oppId].areas[found.kind].filter(
          (d) => d.id !== action.targetDieId,
        );
        card.heldDice = card.heldDice.filter((d) => d.id !== action.dieId);
        logLine(
          g,
          `${pname(pd.player)} 「凛冽之音」：移除神器上的 ${held.value} 点骰，弃置 ${pname(oppId)} 的 1 颗 ${held.value} 点能力骰`,
        );
      }
      g.pending = null;
      // 继续本次攻击：先处理 022（若可用），否则直接发起攻击
      if (
        hasActiveSkill(g.players[pd.player], 'siji.chuxing') &&
        (artifactWithSkill(g.players[pd.player], 'siji.chuxing')?.count ?? 0) >= 1
      ) {
        g.pending = { kind: 'sijiChuxing', player: pd.player, costSlots: pd.costSlots };
      } else {
        doAttack(g, pd.player, pd.costSlots);
      }
      break;
    }
    case 'quanzhiAssign': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'quanzhiAssign') throw new Error('no quanzhiAssign pending');
      validateQuanzhiAssign(g, pd.player, action.assign);
      const p = g.players[pd.player];
      const all = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation];
      for (const d of all) {
        const k = action.assign[d.id];
        if (d.kind !== k) {
          p.areas[d.kind] = p.areas[d.kind].filter((x) => x.id !== d.id);
          d.kind = k;
          p.areas[k].push(d);
        }
      }
      logLine(
        g,
        `${pname(pd.player)} 「全知」：将全部能力骰重新落区（防御=同点成对 / 攻击=顺点三连 / 其余冥想）`,
      );
      g.pending = null;
      break;
    }
    case 'kuyuResolve': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'kuyu') throw new Error('no kuyu pending');
      const area = action.area;
      if (area !== 'attack' && area !== 'defense' && area !== 'meditation') throw new Error('invalid area');
      g.pending = null;
      const kindCn = area === 'attack' ? '攻击' : area === 'defense' ? '防御' : '冥想';
      withRng(g, (rng) => {
        const gained = gainRandomDice(g, pd.player, area, 1, rng);
        const die = gained[0];
        const dist = emptyDistribution(g.players[pd.player]);
        const expected = dist ? areaOf(die.value, dist) : area;
        logLine(
          g,
          `${pname(pd.player)} 「低语」：宣称${kindCn}骰区，获得 1 个随机点数能力骰（${die.value} 点）并移入${kindCn}骰区`,
        );
        if (expected !== area) {
          const before = g.dustfall;
          incrementDustfall(g);
          logLine(g, `「低语」：该骰（${die.value} 点）不符合骰点分布，尘落 ${before} → ${g.dustfall}`);
        }
      });
      break;
    }
    case 'tiaolingResolve': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'tiaolingPick') throw new Error('no tiaolingPick pending');
      const p = g.players[pd.player];
      const ids = action.dieIds ?? [];
      if (new Set(ids).size !== ids.length) throw new Error('duplicate die id');
      const all = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation];
      const discardSet = new Set(ids);
      for (const id of ids) if (!all.some((d) => d.id === id)) throw new Error(`not your ability die: ${id}`);
      const remaining = all.filter((d) => !discardSet.has(d.id));
      const vals = remaining.map((d) => d.value);
      const ok = action.pick === 'same' ? new Set(vals).size <= 1 : new Set(vals).size === vals.length;
      if (!ok) {
        throw new Error(
          action.pick === 'same' ? '「死亡亦逝」：弃置后须全部点数相同' : '「死亡亦逝」：弃置后须全部点数不同',
        );
      }
      for (const id of ids) {
        const found = findDieOf(g, pd.player, id);
        if (found) consumeDice(p, found.kind, [id]);
      }
      g.pending = null;
      logLine(
        g,
        `${pname(pd.player)} 「死亡亦逝」：选择「${action.pick === 'same' ? '全部相同' : '全部不同'}」，弃置 ${ids.length} 颗能力骰`,
      );
      break;
    }
    case 'endDiscardResolve': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'endDiscard') throw new Error('no endDiscard pending');
      // 先校验（数量/归属）→ 失败抛错且不改状态；成功后才清 pending
      endPhase(g, pd.player, action.dieIds ?? []);
      g.pending = null;
      break;
    }
    case 'wanzhangDiscard': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'wanzhangDiscard') throw new Error('no wanzhangDiscard pending');
      const p = g.players[pd.player];
      const all = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation];
      const n = Math.min(2, all.length);
      const ids = action.dieIds ?? [];
      if (new Set(ids).size !== ids.length) throw new Error('duplicate die id');
      if (ids.length !== n) throw new Error(`「万丈明光」需弃置 ${n} 个能力骰`);
      for (const id of ids) {
        const found = findDieOf(g, pd.player, id);
        if (!found) throw new Error(`not your ability die: ${id}`);
        consumeDice(p, found.kind, [id]);
      }
      g.pending = null;
      logLine(g, `${pname(pd.player)} 「万丈明光」：主要阶段开始，弃置 ${ids.length} 个能力骰`);
      break;
    }
    case 'putiResolve': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'putiPick') throw new Error('no putiPick pending');
      if (!pd.attack) throw new Error('putiPick missing attack');
      const pa = pd.attack;
      g.pending = null;
      if (!action.accept) {
        logLine(g, `${pname(pd.player)} 不发动「不动菩提」`);
        if (pd.mode === 'block') finalizeAttackResolution(g, pa, true);
        else commitAttack(g, pa);
        break;
      }
      // 发动：移除神器上 1 个同点数存放骰
      const card = artifactWithSkill(g.players[pd.player], 'jingang.puti.trigger');
      if (card?.heldDice) card.heldDice = card.heldDice.filter((h) => h.value !== pd.value);
      if (pd.mode === 'block') {
        logLine(g, `${pname(pd.player)} 「不动菩提」：移除 1 个 ${pd.value} 点存放骰，取消对方的抵挡`);
        finalizeAttackResolution(g, pa, false);
      } else {
        logLine(g, `${pname(pd.player)} 「不动菩提」：移除 1 个 ${pd.value} 点存放骰，取消对方的攻击`);
        pumpAttackQueue(g);
      }
      break;
    }
    case 'skill': {
      const pendingSkill = g.pending && g.pending.kind === 'activationResolve' ? g.pending : null;
      const resolvingActivation =
        pendingSkill !== null && pendingSkill.artifactId === action.artifactId && pendingSkill.side === action.side;
      const pendingCharge = g.pending && g.pending.kind === 'chargeResolve' ? g.pending : null;
      const resolvingCharge = pendingCharge !== null && pendingCharge.artifactId === action.artifactId;
      if (g.phase !== 'main' && !resolvingActivation && !resolvingCharge) throw new Error('not main phase');
      if (g.pendingAttack) throw new Error('pending attack unresolved');
      const p = g.players[g.activePlayer];
      const a = p.artifacts.find((x) => x.id === action.artifactId);
      if (!a) throw new Error(`no artifact: ${action.artifactId}`);
      const s = a.skills.find(
        (x) =>
          x.side === action.side &&
          (x.kind === 'activate' ||
            x.kind === 'activation' ||
            x.kind === 'ultimate' ||
            (resolvingCharge && x.kind === 'charge')),
      );
      if (!s) throw new Error('no usable skill on that side');
      if (s.kind === 'charge') {
        // 024：充能技能由「充能行动」触发的强制选择结算，不能手动发动
        if (!resolvingCharge) throw new Error('充能技能由充能行动结算，不能手动发动');
      } else if (!skillActive(a, s)) {
        throw new Error('skill not active');
      }
      if (s.kind === 'activation') {
        // 「激活」类只能由尘起装填时的强制结算触发，不能手动发动
        if (!resolvingActivation) throw new Error('激活类技能由尘起装填时立即强制结算，不能手动发动');
        if (!activationUsable(g, a, s)) throw new Error('activation skill only usable in the turn it was armed');
      }
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
      // 非法参数在处理器内抛错时不清空待决策（非法动作不得改变状态）
      if (resolvingActivation || resolvingCharge) g.pending = null;
      g.skillsUsedThisTurn.push(s.key);
      if (s.kind === 'ultimate') g.ultimatesUsed.push(s.key);
      // 019 蛮王之牙等：启动后刷新自身「每回合一次」计数（本回合可再次启动）
      if (s.refresh) g.skillsUsedThisTurn = g.skillsUsedThisTurn.filter((k) => k !== s.key);
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
  // 028 天罚（激活·本回合）：通过攻击造成 2 次伤害后，立即结束主要阶段
  const tf = g.tianfa[g.activePlayer];
  if (tf && tf.damageCount >= 2 && g.phase === 'main' && !g.pendingAttack && g.pending === null) {
    logLine(g, `${pname(g.activePlayer)} 「天罚」：本回合已通过攻击造成 2 次伤害，立即结束主要阶段`);
    endMainPhase(g);
  }
  // 每次动作结束后，把排队中的待决策/018 强制必杀弹出来（先于多段攻击的下一段）
  pumpPending(g);
  // 若已进入「结束」阶段且无待决策 → 真正结算结束阶段并交出回合（供 032/033 的待决策解决后推进）
  finalizeTurnEnd(g);
  return g;
}
