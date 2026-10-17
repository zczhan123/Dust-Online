import { setupGame, applyFirstPlayer, type SetupOptions } from './setup';
import { SeededRng } from '../rng/rng';
import { refillPhase, doReroll, endPhase } from './phases';
import { effectiveSpeed, effectiveWill, emptyDistribution, rerollAllowance, totalDice } from './derive';
import { applyDustRiseToArtifact, canTargetForDustRise } from './dustRise';
import { incrementDustfall } from './dustfall';
import { afterAttackResolved, applyLifeLoss, applyMolu, artifactWithSkill, attacksBanned, checkLifeEnd, maybeBarrier, doAttack, finalizeAttackResolution, halveAttackDamage, resolveBlock, dealTrueDamage, applyDeferredTrueDamage, pumpAttackQueue, virtualAttack, dianxingValuesOf, SHOUHUN_CONT_KEYS, YonghengQueenSignal, tacticActiveBonus, settleAttack, type AttackMods } from './combat';
import { abilityDieInfo, abilityDicePool, canPayCosts, defaultCostFills, findDieOf, gainRandomDice, maxAffordableSlots, setDieValue, applyHeal, heal, moveDice, noteLifeDrop, offerAdapt, paySlots, withRngState } from './effects';
import { areaOf, createDie, newDieId, placeDieByDistribution } from '../model/dice';
import { pumpPending, queuePending, queueRerollEndTriggers } from './pending';
import { fxPush, fxReset, fxTacticFired, fxSkillFired, fxSetSource, fxTrueLine } from './fx';
import { runChargeSkill } from './charge';
import { SKILL_HANDLERS, skillActive, consumeDice, consumeDiceByKind, applyTurnStartEffects, hasActiveSkill, weijuAvailable } from './skills';
import { skillUseKey } from './skill-state';
import { logLine, pname, sideCn, vals, valsSorted } from './log';
import { LEGEND_DUSTFALL_REQ } from '../content/legends';
import { CHALLENGES, type ChallengeCard, type ChallengeSkill, type ChallengeSlot } from '../content/challenges';
import { matchSlots, matchGroupsPartial, legendCanBlock, addLegendDefense, fxLegendSkill, isInertTactic, isValueLocked, LEGEND_PLAYER } from './challenge';
import { TACTIC_POOL, TACTIC_BY_ID } from '../content/tactics';
import type { Action, Artifact, DiceKind, Die, GameState, LegendPanel, Pending, PlayerId, PlayerState, SkillDef, SlotFill } from '../model/types';

/** 把传奇英雄面板适配成 `Artifact` 形状（仅用于把面板技能送进统一技能处理器；不写入对局状态） */
function legendAsArtifact(lg: LegendPanel): Artifact {
  return {
    id: lg.id,
    name: lg.name,
    column: 1,
    activeMarkerSide: 'left',
    armedSide: null,
    armedTurn: -1,
    count: lg.count,
    countCap: lg.countCap,
    continuousLost: lg.continuousLost,
    continuousLostThisTurn: lg.continuousLostThisTurn,
    chargeLayer: 0,
    skills: lg.skills,
  };
}

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
  for (const a of p.artifacts) for (const h of a.heldDice ?? []) {
    if (isValueLocked(g, player, h.value)) continue; // Z12「不动菩提」：存放骰同受封锁
    out.push({ id: h.id, kind: areaOf(h.value, dist) });
  }
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
/** 026 哀歌·「陷阵」的执行（**唯一入口**）：由两个时点共用 —— ① 重掷阶段结束（026 卡面）② L09「鏖战」的主要阶段结束。 */
function queueXianzhen(g: GameState, owner: PlayerId, reason: 'rerollEnd' | 'mainEnd' = 'rerollEnd'): boolean {
  if (!hasActiveSkill(g.players[owner], 'aige.xianzhen')) return false;
  const own = g.players[owner];
  if (!KINDS_ORDER.some((k) => own.areas[k].length > 0)) return false;
  const aLife = g.players.A.life;
  const bLife = g.players.B.life;
  const chooser: PlayerId = aLife < bLife ? 'A' : bLife < aLife ? 'B' : owner;
  // 挑战模式：决策人若落在**传奇(B)** → 由**挑战者代决**（§19「神器引发的选择」；卡面/设计里的这类选择一律由挑战者做，
  //   与 Z 卡代决的 settleMode 有利/不利**无关** → 三种结算模式下都弹面板）。
  const decider: PlayerId = g.mode === 'challenge' && chooser === 'B' ? 'A' : chooser;
  queuePending(g, { kind: 'xianzhenPick', player: decider, owner });
  logLine(
    g,
    `「陷阵」：${reason === 'mainEnd' ? '主要阶段结束（「鏖战」）' : '重掷阶段结束'}时，生命最低的一方（${pname(
      decider,
    )}）选择弃置 ${pname(owner)} 的 1 个能力骰`,
  );
  return true;
}

/** 投 `n` 个驱动骰（非能力骰；`kind` 只作占位，**永不进区域**，只活在 `g.challenge.driven`）。 */
function rollDrivenDice(g: GameState, n: number): void {
  const before = g.challenge!.driven.length;
  withRngState(g, (rng) => {
    for (let i = 0; i < n; i++) {
      g.challenge!.driven.push(createDie(newDieId('drv-B-'), rng.rollDie(), 'meditation'));
    }
  });
  // 动效旁路：本回合投出的驱动骰（界面：中间并排冒出 → 飞入「临时驱动骰区域」）
  fxPush({
    kind: 'legendRoll',
    player: 'B',
    dice: g.challenge!.driven.slice(before).map((d) => ({ id: d.id, value: d.value })),
  });
}

/** 传奇防御骰上限截断：**保留最新、挤掉最旧**（被挤出的旧骰交给界面走通用"飞中间淡出"）。
 *  ⚠️ **当前未启用**（2026-10-10 用户改口径）：满上限时新骰**直接弃置**（见 `applyChallengeSkill` 的 `gain`），
 *  **不再**"挤掉最旧"。本函数**保留给将来可能的"挤旧"特例**（届时在对应技能里显式调用）。 */
export function capLegendDefense(g: GameState, cap: number): { outIds: string[] } {
  const def = g.players.B.areas.defense;
  if (def.length <= cap) return { outIds: [] };
  const outIds = def.slice(0, def.length - cap).map((d) => d.id);
  g.players.B.areas.defense = def.slice(-cap);
  return { outIds };
}

/** 「相同」槽：把 `driven` 里所有"同点成组"的组都列出来（每组 `slot.count` 颗；按点数升序）。
 *  用于「遁入暗影」——**候选组 > 上限**时由代决/策略**选哪几组**。 */
function allSameGroups(slot: ChallengeSlot, driven: Die[]): { value: number; dice: Die[] }[] {
  const n = slot.count;
  if (n <= 0) return [];
  const byVal = new Map<number, Die[]>();
  for (const d of driven) byVal.set(d.value, [...(byVal.get(d.value) ?? []), d]);
  const out: { value: number; dice: Die[] }[] = [];
  for (const v of [...byVal.keys()].sort((a, b) => a - b)) {
    const pool = byVal.get(v)!;
    for (let i = 0; i + n <= pool.length; i += n) out.push({ value: v, dice: pool.slice(i, i + n) });
  }
  return out;
}

/** 从 `0..n-1` 里取 `k` 个的组合（确定性；n 很小）。 */
function combinations(n: number, k: number): number[][] {
  const out: number[][] = [];
  const dfs = (start: number, cur: number[]): void => {
    if (cur.length === k) {
      out.push([...cur]);
      return;
    }
    for (let i = start; i < n; i++) {
      cur.push(i);
      dfs(i + 1, cur);
      cur.pop();
    }
  };
  if (k > 0) dfs(0, []);
  return out;
}

/**
 * 挑战模式「遁入暗影」：从**本技能的全部骰**里决定"移入防御骰区的下标"。
 * - 防御区放得下（room ≥ 总数）→ 全移；已满（room ≤ 0）→ 不移。
 * - 放不下（0 < room < 总数）→ 挑战者**任选 room 颗（可跨组）**；先按"点数多重集"去重，
 *   只在有 ≥2 种不同结果时才问（如同 1 组、room=1 时两个下标等价 → 不问）。
 * - 需代决但未决 → 挂 `pending`（challengePick）并返回 `null`；favor=取小（利挑战者→传奇防御更差）、against=取大。
 */
function chooseDefenseMove(
  g: GameState,
  card: ChallengeCard,
  skill: ChallengeSkill,
  dice: { id: string; value: number }[],
  room: number,
): number[] | null {
  const total = dice.length;
  if (room <= 0) return [];
  if (room >= total) return dice.map((_, i) => i);
  const seen = new Set<string>();
  const opts: { id: string; label: string; idx: number[] }[] = [];
  for (const c of combinations(total, room)) {
    const key = c
      .map((i) => dice[i].value)
      .sort((a, b) => a - b)
      .join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    // id ＝**被选骰子的 id 拼串**（与骰片池子同源 → 界面"先点哪颗"都不影响匹配）
    opts.push({ id: c.map((i) => dice[i].id).join(','), label: c.map((i) => `${dice[i].value}点`).join('、'), idx: c });
  }
  // 选项 id（骰子 id 串）→ 骰子下标（`placeDefenseFrom` 用下标取骰）
  const idxOf = (idStr: string): number[] =>
    idStr
      .split(',')
      .map((id) => dice.findIndex((d) => d.id === id))
      .filter((i) => i >= 0);
  if (opts.length <= 1) return opts[0]?.idx ?? dice.slice(0, room).map((_, i) => i);
  const dec = (g.challenge!.decisions ??= {});
  const chosen = (dec[skill.id] ?? [])[0];
  if (chosen) return idxOf(chosen);
  const mode = g.challenge!.settleMode;
  if (mode && mode !== 'manual') {
    const id = autoPick({ options: opts.map((o) => ({ id: o.id, label: o.label })), prefer: 'smaller' }, mode)!;
    dec[skill.id] = [id];
    return idxOf(id);
  }
  g.challenge!.activeSkill = (card.skills ?? []).indexOf(skill);
  g.pending = {
    kind: 'challengePick',
    player: 'A',
    prompt: `「${skill.name}」：防御骰区还能放 ${room} 颗，请选择移入哪几颗`,
    options: opts.map((o) => ({ id: o.id, label: o.label })),
    // ⚠️ 这些骰子是**传奇自己**的（驱动骰/技能骰）→ 骰片按 B 上色（不是"代决者 A"）
    pick: { pool: dice.map((d) => ({ id: d.id, value: d.value, kind: 'defense' as const })), n: room, owner: LEGEND_PLAYER },
  };
  return null;
}

/**
 * 把 `dice` 里"被选中"的若干颗**移入传奇防御骰区**（放不下时由挑战者代决哪几颗，见 `chooseDefenseMove`）。
 * 返回本步新产生的骰（供 `legendSkill.spawn`）；若需代决但未决 → 返回 `null`（`chooseDefenseMove` 已挂 `pending`）。
 * 「遁入暗影」与「龙腾万丈」共用——**任何"批量移入防御骰区、受上限截断"的新技能都走它**（勿各写一遍）。
 */
function placeDefenseFrom(
  g: GameState,
  card: ChallengeCard,
  skill: ChallengeSkill,
  dice: { id: string; value: number }[],
): { id: string; value: number; area: 'attack' | 'defense' | 'meditation' }[] | null {
  const cap = card.defenseCap ?? Number.POSITIVE_INFINITY;
  const room = Math.max(0, cap - g.players.B.areas.defense.length);
  const idxs = chooseDefenseMove(g, card, skill, dice, room);
  if (idxs === null) return null;
  const spawn: { id: string; value: number; area: 'attack' | 'defense' | 'meditation' }[] = [];
  for (const i of idxs) {
    const die = createDie(newDieId('chg-B-'), dice[i].value, 'defense');
    if (addLegendDefense(g, die)) spawn.push({ id: die.id, value: dice[i].value, area: 'defense' });
  }
  return spawn;
}

/** 「锋芒」＝传奇攻击伤害 +计数：写成一个 thisTurn buff，走统一口径 `attackDamageBonus`。 */
function syncLegendFengmang(g: GameState): void {
  const p = g.players.B;
  p.buffs = p.buffs.filter((b) => b.source !== '传奇锋芒');
  const add = g.challenge?.count ?? 0;
  if (add > 0) p.buffs.push({ attr: 'attackDamage', add, duration: 'thisTurn', source: '传奇锋芒' });
}

/** 骰区中文（攻/防/冥），供代决文案。 */
const KIND_CN: Record<DiceKind, string> = { attack: '攻', defense: '防', meditation: '冥' };

/** 传奇防御骰"获得 / 移入"的括号内容：**满上限 → "防御骰区已满 N，M 颗弃置"**（避免空括号 `（）`）；否则列点数（升序 `/`）。 */
function legendDefNote(cap: number, spawn: { value: number }[], attempted: number): string {
  const capTxt = Number.isFinite(cap) ? String(cap) : '∞';
  if (spawn.length < attempted) {
    return `（防御骰区已满 ${capTxt}，${attempted - spawn.length} 颗弃置${spawn.length > 0 ? `；入区 ${valsSorted(spawn)}` : ''}）`;
  }
  return `（${spawn.length} 颗：${valsSorted(spawn)}）`;
}

/** 挑战者(A)**能力骰数量最多**的区域（**确定性兜底**：并列取 KINDS_ORDER 靠前者）。并列改由 `tiedBusiestAreas` 走代决。 */
function busiestAreaOfChallenger(g: GameState): DiceKind {
  const p = g.players.A;
  return KINDS_ORDER.reduce((best, k) => (p.areas[k].length > p.areas[best].length ? k : best), KINDS_ORDER[0]);
}

/** 挑战者(A)**并列最多**的能力骰区域（按 `KINDS_ORDER`＝攻→防→冥 排列；仅当"最多 > 0 且 ≥2 个"时非空）。供 Z03「震荡斩击」/ Z12「超度」的区域代决（有利＝取首〔攻〕、不利＝取尾〔冥〕）。 */
function tiedBusiestAreas(g: GameState): DiceKind[] {
  const p = g.players.A;
  const maxN = Math.max(...KINDS_ORDER.map((k) => p.areas[k].length));
  if (maxN <= 0) return [];
  const tied = KINDS_ORDER.filter((k) => p.areas[k].length === maxN);
  return tied.length >= 2 ? tied : [];
}

/** 「死亡亦逝」在**"只弃最少"**口径下的弃置颗数：全都相同＝保留"最多的那个点数"、其余全弃；全都不同＝每个点数留 1 颗、弃掉重复的。（引擎校验与界面提示**共用**这一份。） */
export function siwangMinDiscard(all: Die[], same: boolean): number {
  const cnt = new Map<number, number>();
  for (const d of all) cnt.set(d.value, (cnt.get(d.value) ?? 0) + 1);
  if (same) return all.length - Math.max(...cnt.values());
  return all.length - cnt.size;
}

/** 033「凋零·死亡亦逝（持续）」在某玩家手里是否**生效**（＝该玩家真的装填了这条持续技能）。
 *  ⚠️ **挑战模式不例外**：昔日传奇**从不使用神器的效果**（它那 3 件卡面预设只为取分布/生命；且它从不装填）
 *  → 挑战里 033 只可能来自**挑战者**。曾经的"传奇预设 033 当生效"例外是**错误立论**，已于 2026-10-15 移除。 */
function siwangActive(g: GameState, id: PlayerId): boolean {
  return hasActiveSkill(g.players[id], 'diaoling.siwang');
}

/**
 * 「死亡亦逝」在**某个玩家的回合结束时**是否要执行（两条回合结束路径的**唯一判定**，禁止各写一份）。
 * 卡面：「双方在各自的回合结束时，如果满足条件则选择 1 项执行，随后弃置自己的能力骰」——
 * 故**任一方**装填生效时，**双方各自回合结束时都要执行**；该回合玩家**区域为空**则无事可做（不弹面板）。
 */
export function siwangShouldFire(g: GameState, activePlayer: PlayerId): boolean {
  return (['A', 'B'] as PlayerId[]).some((id) => siwangActive(g, id)) && totalDice(g.players[activePlayer]) > 0;
}

// ————————————————— Z04「D1：开局选骰」—————————————————
// 梦醒时分〔4 同点〕与顿悟〔4 顺点〕共用同一批驱动骰 → "哪几颗给谁"会决定后续顿悟能否发动、
// 以及必检「无上剑术」会打进攻击区什么点数。故在传奇回合**投完骰、逐条结算前**由挑战者一次选好。

/** 「顿悟」可用的顺点窗口起始点（4 连、不回绕：1234/2345/3456）。 */
function straightStarts(driven: Die[], count: number): number[] {
  const vals = new Set(driven.map((d) => d.value));
  const out: number[] = [];
  for (let s = 1; s + count - 1 <= 6; s++) {
    let ok = true;
    for (let v = s; v < s + count; v++) if (!vals.has(v)) { ok = false; break; }
    if (ok) out.push(s);
  }
  return out;
}

/** 「梦醒时分」可用的同点点值：某点数在驱动骰里 ≥ count 颗（升序）。 */
function sameValueGroups(driven: Die[], count: number): number[] {
  const cnt = new Map<number, number>();
  for (const d of driven) cnt.set(d.value, (cnt.get(d.value) ?? 0) + 1);
  return [...cnt.entries()].filter(([, n]) => n >= count).map(([v]) => v).sort((a, b) => a - b);
}

const takeIdsOf = (driven: Die[], v: number, count: number): string[] =>
  driven.filter((d) => d.value === v).slice(0, count).map((d) => d.id);

/**
 * D1 的一种选择（**梦醒时分是必发**，只有"吃哪个点数"可选；顿悟则看剩余能否凑顺点）：
 * - `kind:'dream'`（情形1）：梦醒可吃的点数 ≥2 种 → 让玩家选**吃哪个点值**；顿悟必然被挤断。
 * - `kind:'straight'`（情形2）：梦醒只有 ≤1 种 → 看**顿悟**有没有 ≥2 个顺点窗口，选**用哪个窗口**。
 * （两种情形**互斥**：梦醒有得选时，10 颗骰最多撑 4 种点数 → 顺点必用满 → 吃哪组都断。）
 */
export interface AssignPlan {
  kind: 'dream' | 'straight';
  dreamV: number | null;
  straightS: number | null;
  dreamIds: string[];
  straightIds: string[];
}

/** 枚举本回合 D1 的**候选选择**（情形 1＝梦醒点值；情形 2＝顿悟窗口）。 */
function assignPlans(g: GameState): AssignPlan[] {
  const driven = g.challenge!.driven;
  const dreams = sameValueGroups(driven, 4);
  if (dreams.length >= 2) {
    // 情形 1：梦醒有得选 → 问"吃哪个点值"（顿悟必断，不列为选项）
    return dreams.map((v) => ({
      kind: 'dream' as const,
      dreamV: v,
      straightS: null,
      dreamIds: takeIdsOf(driven, v, 4),
      straightIds: [],
    }));
  }
  // 情形 2：梦醒至多 1 种（或没有）→ 看顿悟在"梦醒吃剩的骰"里有没有 ≥2 个顺点窗口
  const dreamV = dreams[0] ?? null;
  const dreamIds = dreamV === null ? [] : takeIdsOf(driven, dreamV, 4);
  const remain = driven.filter((d) => !dreamIds.includes(d.id));
  const windows = straightStarts(remain, 4);
  if (windows.length < 2) return [];
  return windows.map((s) => ({
    kind: 'straight' as const,
    dreamV,
    straightS: s,
    dreamIds,
    straightIds: [s, s + 1, s + 2, s + 3].flatMap((v) => takeIdsOf(remain, v, 1)),
  }));
}

const assignOptId = (p: AssignPlan): string => (p.kind === 'dream' ? `d${p.dreamV}` : `s${p.straightS}`);
const assignOptLabel = (p: AssignPlan): string =>
  p.kind === 'dream'
    ? `梦醒时分吃 4×${p.dreamV}点`
    : `顿悟用 ${p.straightS}${(p.straightS ?? 0) + 1}${(p.straightS ?? 0) + 2}${(p.straightS ?? 0) + 3}`;

/** 需要问 D1 吗？情形 1（梦醒 ≥2 种点值）或情形 2（顿悟 ≥2 个窗口）时返回候选；否则 null。（导出供测试） */
export function legendAssignNeeded(g: GameState): AssignPlan[] | null {
  // 目前仅"有这两条技能"的卡（Z04）走 D1；其它卡不弹
  const card = CHALLENGES.find((c) => c.id === g.challenge?.cardId);
  const has = (id: string): boolean => (card?.skills ?? []).some((s) => s.id === id);
  if (!has('z04-2') || !has('z04-3')) return null;
  // 传奇**第 1 回合**：z04-2/z04-3 均带「怜悯*」会被跳过（见 `continueLegendTurn` 的怜悯* 判定，同一个 `turn` 字段）
  //   → 这回合分配不可能生效，**不做分配**（否则＝白问一次、还给玩家造成"选了没反应"的误解）。
  if (g.challenge?.turn === 0) return null;
  const plans = assignPlans(g);
  return plans.length >= 2 ? plans : null;
}

/** 自动：**有利＝取大、不利＝取小**（情形 1 比梦醒点值 v；情形 2 比顺点窗口起点 s）。（导出供测试） */
export function legendAssignAuto(plans: AssignPlan[], mode: 'favor' | 'against'): AssignPlan {
  const val = (p: AssignPlan): number => (p.kind === 'dream' ? (p.dreamV ?? 0) : (p.straightS ?? 0));
  const sorted = [...plans].sort((a, b) => val(a) - val(b));
  return mode === 'favor' ? sorted[sorted.length - 1] : sorted[0];
}

const assignBySkill = (p: AssignPlan): Record<string, string[]> => ({ 'z04-2': p.dreamIds, 'z04-3': p.straightIds });

/** 由 D1 选项 id 反查回分配方案（需在"骰子未被消耗前"调用）。 */
function assignFromOptId(g: GameState, id: string): Record<string, string[]> | undefined {
  const p = assignPlans(g).find((x) => assignOptId(x) === id);
  return p ? assignBySkill(p) : undefined;
}

/**
 * 挑战模式：这条技能**本次是否会真的产生效果**（＝"发动检查"）。
 * `∞`（无槽）只表示"**每回合都要做一次发动检查**（无骰子条件）"，**不等于必定生效**——
 * 仅"条件型 ∞ 技能在本步无效果"时返回 `false` → **不弹技能名、不占一步**（照"槽不匹配/怜悯*跳过"处理）。
 * - 有槽技能：槽匹配即执行（本函数对它们恒 `true`）；「战车」虽 `∞` 但**必有效果**（① 一定打 1 次 5 点攻击）→ `true`。
 */
function legendSkillWillFire(g: GameState, skill: ChallengeSkill): boolean {
  switch (skill.id) {
    case 'z01-1': // 龙游万象：驱动里有 1/6 点才重掷得起（有则算"发动"，即便重掷回同点）
      return g.challenge!.driven.some((d) => d.value === 1 || d.value === 6);
    case 'z01-4': {
      // 雨落狂流：不符合分布数 ≥ 3（k≥1）才有骰可弃
      const dist = emptyDistribution(g.players.B);
      let off = 0;
      for (const k of KINDS_ORDER) for (const d of g.players.B.areas[k]) if (!dist || !dist[k].includes(d.value)) off++;
      return Math.floor(off / 3) > 0;
    }
    case 'z03-1': // 统御战场：只有在"存在点数 ≠ 1 的攻击骰"（改点确实产生变化）时才发动；全是 1 / 没有 → 空操作
      return g.players.A.areas.attack.some((d) => d.value !== 1);
    case 'z03-5': {
      // 拔城：本回合未发动过震荡斩击 / 战争横扫才执行
      const fired = g.challenge!.firedThisTurn ?? [];
      return !fired.includes('z03-2') && !fired.includes('z03-3');
    }
    case 'z04-1': // 真实之剑：防御骰超过 10 个才"视为攻击骰发起攻击"，否则空操作
      return g.players.B.areas.defense.length > 10;
    case 'z04-4': // 无上剑术：得有"剩余驱动骰"才移得动
    case 'z04-5': // 灵能屏障：同上
      return g.challenge!.driven.length > 0;
    case 'z05-2': {
      // 不可饶恕：要有驱动骰（用来算 X），且挑战者确实有"众数点数"里的某一种
      const dr = g.challenge!.driven;
      if (dr.length === 0) return false;
      const tied = z05TiedValues(g);
      return KINDS_ORDER.some((k) => g.players.A.areas[k].some((d) => tied.includes(d.value)));
    }
    case 'z07-5': // 尘起：还有驱动骰可移入防御区，或攻击骰区有骰可攻击 → 才发动
      return g.challenge!.driven.length > 0 || g.players.B.areas.attack.length > 0;
    case 'z08-1': // 填弹：得有驱动骰才移得动
      return g.challenge!.driven.length > 0;
    case 'z09-1': // 陷阵：得有驱动骰才重掷得起
      return g.challenge!.driven.length > 0;
    default:
      return true;
  }
}

/** Z05「不可饶恕」：本回合驱动骰里"数量最多的点数"所对应的**全部**点数（并列＝多个，升序）。 */
function z05TiedValues(g: GameState): number[] {
  const cnt = new Map<number, number>();
  for (const d of g.challenge?.driven ?? []) cnt.set(d.value, (cnt.get(d.value) ?? 0) + 1);
  const maxN = cnt.size ? Math.max(...cnt.values()) : 0;
  return [...cnt.entries()].filter(([, n]) => n === maxN).map(([v]) => v).sort((a, b) => a - b);
}

/** Z05「不可饶恕」的 X：并列时优先取**代决已定**的那个；无代决则**兜底取点数大者**（确定性）。 */
function z05ChongfuX(g: GameState, skill: ChallengeSkill): number {
  const chosen = (g.challenge?.decisions?.[skill.id] ?? [])[0];
  if (chosen) return Number(chosen);
  const tied = z05TiedValues(g);
  return tied.length ? tied[tied.length - 1] : 0;
}

/**
 * Z05「不可饶恕」**自动结算**专用（手动＝挑战者自选弹面板，不走这里）。
 * 候选＝并列的各点数；每个候选按"**弃掉挑战者全部该点数骰**"评估：
 *  · `n` ＝ 被弃**总颗数**； · `w` ＝ 被弃**区域组合权重**（攻击=1、防御=2、冥想=4，**按涉及哪几类**求和）。
 * - **有利**（顺挑战者）＝取 `(n 小 → w 小 → 点值 小)`；
 * - **不利** ＝ 完全取反 `(n 大 → w 大 → 点值 大)`。
 * 例（有利）：候选 3 颗攻击(n=3,w=1) vs 1 防+1 冥(n=2,w=6) → 颗数优先 → 选后者。
 */
function z05ChongfuAutoPick(
  g: GameState,
  want: { options: { id: string; label: string }[] },
  mode: 'favor' | 'against',
): string | null {
  const A = g.players.A;
  const items = want.options.map((o) => {
    const v = Number(o.id);
    let n = 0;
    let w = 0;
    for (const k of KINDS_ORDER) {
      const mine = A.areas[k].filter((d) => d.value === v);
      if (mine.length === 0) continue;
      n += mine.length;
      w += k === 'attack' ? 1 : k === 'defense' ? 2 : 4;
    }
    return { id: o.id, v, n, w };
  });
  const dir = mode === 'against' ? -1 : 1; // 有利→取小；不利→取大（取反）
  items.sort((a, b) => dir * (a.n - b.n) || dir * (a.w - b.w) || dir * (a.v - b.v));
  return items[0]?.id ?? null;
}

/** 从 `pool` 里取 `n` 个的组合，按 `prefer` **自动 / 确定性**挑一组（返回骰 id 数组）。
 *  供"弃置挑战者 N 颗能力骰"类（Z07 蛮王之牙 / 不屈咆哮 的循环轮次）自动结算用。 */
function pickComboIds(g: GameState, pool: Die[], n: number, prefer: 'larger' | 'smaller'): string[] {
  if (n <= 0 || pool.length === 0) return [];
  const combos = combinations(pool.length, Math.min(n, pool.length));
  if (combos.length === 0) return [];
  const mode = g.challenge?.settleMode;
  if (mode && mode !== 'manual') {
    const opts = combos.map((c) => ({
      id: c.map((i) => pool[i].id).join(','),
      label: c.map((i) => `${pool[i].value}`).join('、'),
    }));
    const one = autoPick({ options: opts, prefer }, mode);
    return one ? one.split(',') : [];
  }
  const sum = (c: number[]): number => c.reduce((s, i) => s + pool[i].value, 0);
  const sorted = [...combos].sort((a, b) => (prefer === 'larger' ? sum(b) - sum(a) : sum(a) - sum(b)));
  return sorted[0].map((i) => pool[i].id);
}

/**
 * Z11「清算」"弃挑战者 N 颗能力骰"的**确定性顺序**（类型 → 同类点数）：
 *  · **不利**（对挑战者不利）＝ **冥想 → 防御 → 攻击**、同类**先大后小**（弃光一种才动下一种）；
 *  · **有利** ＝ 完全反向（**攻击 → 防御 → 冥想**、同类**先小后大**）。
 * 自选模式不走它（挑战者点骰片面板）；它供 auto 与"没记录选择"时的内部兜底共用。
 */
function qingsuanOrder(pool: Die[], against: boolean): Die[] {
  const rank = (k: DiceKind): number =>
    against ? (k === 'meditation' ? 0 : k === 'defense' ? 1 : 2) : k === 'attack' ? 0 : k === 'defense' ? 1 : 2;
  return [...pool].sort(
    (a, b) => rank(a.kind) - rank(b.kind) || (against ? b.value - a.value : a.value - b.value),
  );
}

// ————————————————— Z08「黑枪」链式代决后瞻 —————————————————
// 「凶弹业舞」〔4 顺点〕→「共振」〔2 颗 ∈{2,5}〕→「处刑通牒」〔2 颗同点〕依次消耗同一批驱动骰：
//   · 凶弹业舞选哪段顺点 → 影响共振能否发动（还可能因搬走攻/防骰改变"能力骰数"而翻转共振分支）；
//   · 共振选哪两颗 → 影响处刑通牒能否发动（并因得骰使黑枪攻击骰 +2 影响处刑通牒的 +5/+1 判定）；
//   · 处刑通牒选哪一对 → 影响蛇蝎之泪（3/4 点）能搬几颗进防御骰区。
// 故自动（有利/不利）**不能只看本步点数**，必须逐候选**向后模拟**：
//   ① 后续技能"可发动"数：有利＝越少越好 / 不利＝越多越好；
//   ② 再比蛇蝎之泪"实际进防御骰区"颗数（受上限截断）：有利＝越少越好 / 不利＝越多越好；
//   ③ 同分再比点值（有利＝点值小、不利＝点值大）保证确定性。

interface Z08Sim {
  driven: number[];
  aAtk: number;
  aDef: number;
  aMed: number;
  bAtk: number;
  bDef: number;
}

function z08SimFromGame(g: GameState): Z08Sim {
  const A = g.players.A;
  const B = g.players.B;
  return {
    driven: (g.challenge?.driven ?? []).map((d) => d.value),
    aAtk: A.areas.attack.length,
    aDef: A.areas.defense.length,
    aMed: A.areas.meditation.length,
    bAtk: B.areas.attack.length,
    bDef: B.areas.defense.length,
  };
}

/** 从多重集 `arr` 里移除一份 `rem`（按值逐个扣，重复值也正确处理）。 */
function minusMulti(arr: number[], rem: number[]): number[] {
  const r = [...rem];
  return arr.filter((v) => {
    const i = r.indexOf(v);
    if (i >= 0) {
      r.splice(i, 1);
      return false;
    }
    return true;
  });
}

interface Z08Cand {
  key: string;
  label: string;
  /** 确定性兜底排序值（本轮消耗的点值之和） */
  sort: number;
  removed: number[];
  next: Z08Sim;
  /** 仅「蛇蝎之泪」：本次实际进防御骰区的颗数 */
  snakeDef?: number;
}

/** Z08 第 k 条技能（k∈2..5）在状态 `st` 下的全部候选（无候选＝该技能发动不了）。 */
function z08SimCands(k: number, st: Z08Sim, cap: number): Z08Cand[] {
  const dr = st.driven;
  const out: Z08Cand[] = [];
  const sum = (a: number[]): number => a.reduce((s, x) => s + x, 0);
  if (k === 2) {
    // 凶弹业舞：4 连顺点窗口（1234 / 2345 / 3456）
    for (let start = 1; start + 3 <= 6; start++) {
      const vals = [start, start + 1, start + 2, start + 3];
      if (!vals.every((v) => dr.includes(v))) continue;
      const moved = Math.min(st.aAtk, Math.max(0, cap - st.bDef));
      out.push({
        key: vals.join(''),
        label: `${vals.join('')}顺点`,
        sort: sum(vals),
        removed: vals,
        next: {
          driven: minusMulti(dr, vals),
          aAtk: 0,
          aDef: 0,
          aMed: st.aMed,
          bAtk: st.bAtk + st.aDef,
          bDef: st.bDef + moved,
        },
      });
    }
  } else if (k === 3) {
    // 共振：取 2 颗每颗 ∈{2,5}（22/25/55 等）
    const pool = dr.filter((v) => v === 2 || v === 5);
    const seen = new Set<string>();
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const vals = [pool[i], pool[j]];
        const key = [...vals].sort((a, b) => a - b).join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        const aTot = st.aAtk + st.aDef + st.aMed;
        const next: Z08Sim = aTot >= 4
          ? { ...st, driven: minusMulti(dr, vals), aAtk: st.aAtk + 2, bAtk: st.bAtk + 2 }
          : { ...st, driven: minusMulti(dr, vals), aDef: Math.max(0, st.aDef - 2), bDef: Math.max(0, st.bDef - 2) };
        out.push({ key, label: `${vals.join('、')}点`, sort: sum(vals), removed: vals, next });
      }
    }
  } else if (k === 4) {
    // 处刑通牒：取 2 颗同点
    const cnt = new Map<number, number>();
    for (const v of dr) cnt.set(v, (cnt.get(v) ?? 0) + 1);
    for (const [v, n] of [...cnt.entries()].sort((a, b) => a[0] - b[0])) {
      if (n < 2) continue;
      const vals = [v, v];
      out.push({ key: String(v), label: `${v}点组`, sort: v, removed: vals, next: { ...st, driven: minusMulti(dr, vals) } });
    }
  } else if (k === 5) {
    // 蛇蝎之泪：任意颗 3/4 点（无限）
    const vals = dr.filter((v) => v === 3 || v === 4);
    if (vals.length === 0) return [];
    const snakeDef = Math.min(vals.length, Math.max(0, cap - st.bDef));
    out.push({ key: 'snake', label: '蛇蝎之泪', sort: sum(vals), removed: vals, next: { ...st, driven: minusMulti(dr, vals) }, snakeDef });
  }
  return out;
}

/** 从第 k 条技能（Z08 的 2..5）起向后模拟，返回**最优**结果（按 mode）：`fired`＝可发动技能数、`snakeDef`＝蛇蝎之泪进防区颗数。 */
function z08TailOpt(k: number, st: Z08Sim, mode: 'favor' | 'against', cap: number): { fired: number; snakeDef: number } {
  if (k > 5) return { fired: 0, snakeDef: 0 };
  const cands = z08SimCands(k, st, cap);
  if (cands.length === 0) return z08TailOpt(k + 1, st, mode, cap);
  const better = (a: { fired: number; snakeDef: number }, b: { fired: number; snakeDef: number }): boolean =>
    mode === 'against'
      ? a.fired > b.fired || (a.fired === b.fired && a.snakeDef > b.snakeDef)
      : a.fired < b.fired || (a.fired === b.fired && a.snakeDef < b.snakeDef);
  let best: { fired: number; snakeDef: number } | null = null;
  for (const c of cands) {
    const rest = k < 5 ? z08TailOpt(k + 1, c.next, mode, cap) : { fired: 0, snakeDef: c.snakeDef ?? 0 };
    const r = { fired: 1 + rest.fired, snakeDef: rest.snakeDef };
    if (best === null || better(r, best)) best = r;
  }
  return best!;
}

/** Z08「凶弹业舞 / 共振 / 处刑通牒」的**链式后瞻**自动选组：返回应选的候选 key。 */
function z08ChainPickKey(g: GameState, skill: ChallengeSkill, mode: 'favor' | 'against'): string | undefined {
  const card = CHALLENGES.find((c) => c.id === g.challenge?.cardId);
  const cap = card?.defenseCap ?? Number.POSITIVE_INFINITY;
  const k = Number(skill.id.split('-')[1]);
  const cands = z08SimCands(k, z08SimFromGame(g), cap);
  if (cands.length === 0) return undefined;
  const better = (a: { fired: number; snakeDef: number; sort: number }, b: { fired: number; snakeDef: number; sort: number }): boolean => {
    if (mode === 'against') {
      if (a.fired !== b.fired) return a.fired > b.fired;
    } else if (a.fired !== b.fired) {
      return a.fired < b.fired;
    }
    if (a.snakeDef !== b.snakeDef) return mode === 'against' ? a.snakeDef > b.snakeDef : a.snakeDef < b.snakeDef;
    return mode === 'against' ? a.sort > b.sort : a.sort < b.sort;
  };
  let best: Z08Cand | null = null;
  let bestScore: { fired: number; snakeDef: number; sort: number } | null = null;
  for (const c of cands) {
    const rest = k < 5 ? z08TailOpt(k + 1, c.next, mode, cap) : { fired: 0, snakeDef: c.snakeDef ?? 0 };
    const score = { fired: rest.fired, snakeDef: rest.snakeDef, sort: c.sort };
    if (bestScore === null || better(score, bestScore)) {
      best = c;
      bestScore = score;
    }
  }
  return best?.key;
}

/** Z08 候选 key → 实际要消耗的驱动骰 id（取 `driven` 里前若干颗同值者）。 */
function z08IdsOfKey(driven: Die[], cands: Z08Cand[], key: string): string[] {
  const c = cands.find((x) => x.key === key);
  if (!c) return [];
  const used = new Set<string>();
  const ids: string[] = [];
  for (const v of c.removed) {
    const d = driven.find((x) => x.value === v && !used.has(x.id));
    if (d) {
      ids.push(d.id);
      used.add(d.id);
    }
  }
  return ids;
}

// ————————————————— Z09「天殇的战鬼」链式代决后瞻 —————————————————
// 「陷阵」重掷后，战鬼的残杀〔4顺点〕→ 奇袭〔3顺点〕→ 凛冽之音〔2同点〕→ 横贯〔任意颗 3/5〕依次消耗同一批驱动骰。
// 前一条吃哪些驱动骰会影响后一条能否发动、以及留给横贯的 {3/5} 数量。故自动（有利）**逐候选后瞻**：
//   ① 后续发动技能越少 → ② 填入槽位的点数越小（填进去的骰直接变攻击/防御骰）→ ③ 留给「横贯」的 {3/5} 骰越少。
// 不利＝完全取反。（`凛冽之音` 补充防御骰不影响后续"能否发动/横贯骰数"，故模拟只需跟踪 `driven`。）

interface Z09Cand {
  key: string;
  label: string;
  /** 本轮消耗的点数之和（用于"点数越小越好"） */
  sum: number;
  removed: number[];
}

/** Z09 第 k 条技能（2..4 有选择）在剩余驱动骰 `dr` 下的候选。 */
function z09SimCands(k: number, dr: number[]): Z09Cand[] {
  const out: Z09Cand[] = [];
  const sum = (a: number[]): number => a.reduce((s, x) => s + x, 0);
  if (k === 2 || k === 3) {
    const count = k === 2 ? 4 : 3;
    for (let start = 1; start + count - 1 <= 6; start++) {
      const vals = Array.from({ length: count }, (_, i) => start + i);
      if (!vals.every((v) => dr.includes(v))) continue;
      out.push({ key: vals.join(''), label: `${vals.join('')}顺点`, sum: sum(vals), removed: vals });
    }
  } else if (k === 4) {
    const cnt = new Map<number, number>();
    for (const v of dr) cnt.set(v, (cnt.get(v) ?? 0) + 1);
    for (const [v, n] of [...cnt.entries()].sort((a, b) => a[0] - b[0])) {
      if (n < 2) continue;
      out.push({ key: String(v), label: `${v}点组`, sum: v * 2, removed: [v, v] });
    }
  }
  return out;
}

/** 从第 k 条技能（Z09 的 2..5）向后模拟，返回**最优**结果（按 mode）。 */
function z09TailOpt(
  k: number,
  dr: number[],
  mode: 'favor' | 'against',
): { fired: number; points: number; hengguan: number } {
  if (k > 5) return { fired: 0, points: 0, hengguan: 0 };
  if (k === 5) {
    // 横贯：吃光所有 {3/5}（有则发动）；henguan＝留给它的攻击骰数
    const n = dr.filter((v) => v === 3 || v === 5).length;
    return { fired: n > 0 ? 1 : 0, points: 0, hengguan: n };
  }
  const cands = z09SimCands(k, dr);
  if (cands.length === 0) return z09TailOpt(k + 1, dr, mode);
  let best: { fired: number; points: number; hengguan: number } | null = null;
  for (const c of cands) {
    const rest = z09TailOpt(k + 1, minusMulti(dr, c.removed), mode);
    const t = { fired: 1 + rest.fired, points: c.sum + rest.points, hengguan: rest.hengguan };
    if (best === null || z09Better(t, best, mode)) best = t;
  }
  return best!;
}

/** 有利＝(发动少 → 点数小 → 横贯骰少)；不利＝取反。 */
function z09Better(
  a: { fired: number; points: number; hengguan: number },
  b: { fired: number; points: number; hengguan: number },
  mode: 'favor' | 'against',
): boolean {
  const dir = mode === 'against' ? -1 : 1;
  if (a.fired !== b.fired) return dir * (a.fired - b.fired) < 0;
  if (a.points !== b.points) return dir * (a.points - b.points) < 0;
  return dir * (a.hengguan - b.hengguan) < 0;
}

/** Z09「战鬼的残杀 / 奇袭 / 凛冽之音」的**链式后瞻**自动选组：返回应选的候选 key。 */
function z09ChainPickKey(g: GameState, skill: ChallengeSkill, mode: 'favor' | 'against'): string | undefined {
  const k = Number(skill.id.split('-')[1]);
  const dr = (g.challenge?.driven ?? []).map((d) => d.value);
  const cands = z09SimCands(k, dr);
  if (cands.length === 0) return undefined;
  let best: Z09Cand | null = null;
  let bestScore: { fired: number; points: number; hengguan: number } | null = null;
  for (const c of cands) {
    const rest = z09TailOpt(k + 1, minusMulti(dr, c.removed), mode);
    const score = { fired: 1 + rest.fired, points: c.sum + rest.points, hengguan: rest.hengguan };
    if (bestScore === null || z09Better(score, bestScore, mode)) {
      best = c;
      bestScore = score;
    }
  }
  return best?.key;
}
/**
 * Z07「不屈咆哮」**选组**自动专用（手动＝挑战者自选弹面板）：
 * 不屈咆哮吃掉一段 3 顺点（3 个互不相同的点数），会改变"剩余驱动骰里能凑几组 2 同点"＝
 * **蛮王之牙的发送次数**。规律：**吃掉"偶数颗"的点数 → 该点数少 1 组；"奇数颗" → 组数不变**
 * （2→1、4→3… 减 1；3→2、5→4… 不变）。故蛮王发送数 = 选择前总组数 −(所吃顺点里"偶数颗"点数个数)。
 * - **有利**（少发动蛮王）＝挑"偶数颗"点数最多的顺点；**不利**＝挑"奇数颗"最多的；并列再比点值（有利＝点数大）。
 */
function z07QubuAutoPick(g: GameState, cands: { key: string; sort: number }[], mode: 'favor' | 'against'): string | undefined {
  if (cands.length === 0) return undefined;
  const cnt = new Map<number, number>();
  for (const d of g.challenge!.driven) cnt.set(d.value, (cnt.get(d.value) ?? 0) + 1);
  // 吃掉 [start, start+1, start+2] 后，剩余"2 同点成对"的总组数
  const groupsAfter = (start: number): number => {
    const win = new Set([start, start + 1, start + 2]);
    let groups = 0;
    for (const [v, n] of cnt.entries()) groups += Math.floor((n - (win.has(v) ? 1 : 0)) / 2);
    return groups;
  };
  const items = cands.map((c) => ({ key: c.key, start: c.sort, groups: groupsAfter(c.sort) }));
  items.sort((a, b) =>
    mode === 'against'
      ? b.groups - a.groups || a.start - b.start // 不利＝蛮王越多越好；并列取点数小
      : a.groups - b.groups || b.start - a.start, // 有利＝蛮王越少越好；并列取点数大
  );
  return items[0].key;
}

// ————————————————— Z10「破晓之剑」链式代决后瞻 —————————————————
// 「白昼之火」〔3同点〕→「陨落」〔3顺点〕→「涤罪大剑术」〔2同点〕→「救赎」〔2同点〕依次消耗同一批驱动骰。
// 自动（有利）＝ **① 后续发动技能越少 → ② 点数默认（大）**；不利＝完全取反（发动多 / 点数小）。
interface Z10Cand {
  key: string;
  label: string;
  sum: number;
  removed: number[];
}

function z10SimCands(k: number, dr: number[]): Z10Cand[] {
  const out: Z10Cand[] = [];
  const sum = (a: number[]): number => a.reduce((s, x) => s + x, 0);
  if (k === 2 || k === 4 || k === 5) {
    const n = k === 2 ? 3 : 2; // 白昼之火＝3 同点；涤罪/救赎＝2 同点
    const cnt = new Map<number, number>();
    for (const v of dr) cnt.set(v, (cnt.get(v) ?? 0) + 1);
    for (const [v, c] of [...cnt.entries()].sort((a, b) => a[0] - b[0])) {
      if (c < n) continue;
      const vals = Array.from({ length: n }, () => v);
      out.push({ key: String(v), label: `${v}点组`, sum: sum(vals), removed: vals });
    }
  } else if (k === 3) {
    for (let start = 1; start + 3 - 1 <= 6; start++) {
      const vals = [start, start + 1, start + 2];
      if (!vals.every((v) => dr.includes(v))) continue;
      out.push({ key: vals.join(''), label: `${vals.join('')}顺点`, sum: sum(vals), removed: vals });
    }
  }
  return out;
}

/** 有利＝(后续发动少 → 点数大)；不利＝(发动多 → 点数小)。 */
function z10Better(a: { fired: number; sum: number }, b: { fired: number; sum: number }, mode: 'favor' | 'against'): boolean {
  const dir = mode === 'against' ? -1 : 1;
  if (a.fired !== b.fired) return dir * (a.fired - b.fired) < 0;
  return mode === 'against' ? a.sum < b.sum : a.sum > b.sum;
}

function z10TailOpt(k: number, dr: number[], mode: 'favor' | 'against'): { fired: number; sum: number } {
  if (k > 5) return { fired: 0, sum: 0 };
  const cands = z10SimCands(k, dr);
  if (cands.length === 0) return z10TailOpt(k + 1, dr, mode);
  let best: { fired: number; sum: number } | null = null;
  for (const c of cands) {
    const rest = z10TailOpt(k + 1, minusMulti(dr, c.removed), mode);
    const t = { fired: 1 + rest.fired, sum: c.sum + rest.sum };
    if (best === null || z10Better(t, best, mode)) best = t;
  }
  return best!;
}

/** Z10「白昼之火 / 陨落 / 涤罪大剑术」的链式后瞻自动选组：返回应选的候选 key。 */
function z10ChainPickKey(g: GameState, skill: ChallengeSkill, mode: 'favor' | 'against'): string | undefined {
  const k = Number(skill.id.split('-')[1]);
  const dr = (g.challenge?.driven ?? []).map((d) => d.value);
  const cands = z10SimCands(k, dr);
  if (cands.length === 0) return undefined;
  let best: Z10Cand | null = null;
  let bestScore: { fired: number; sum: number } | null = null;
  for (const c of cands) {
    const rest = z10TailOpt(k + 1, minusMulti(dr, c.removed), mode);
    const score = { fired: 1 + rest.fired, sum: c.sum + rest.sum };
    if (bestScore === null || z10Better(score, bestScore, mode)) {
      best = c;
      bestScore = score;
    }
  }
  return best?.key;
}

// ————————————————— Z12「渡世行僧」链式代决后瞻 —————————————————
/**
 * Z12「超度 / 破障」多格 pips 槽的候选：每格各取 1 颗（格内 `faces` 任选）→ 按**点数组合**去重。
 * 返回的 `values` 供后瞻模拟使用。
 */
function z12PipsCands(
  slots: ChallengeSlot[],
  driven: Die[],
): { key: string; label: string; ids: string[]; sort: number; values: number[] }[] {
  const per: Die[][] = slots.map((sl) => driven.filter((d) => (sl.faces ?? []).includes(d.value)));
  const out: { key: string; label: string; ids: string[]; sort: number; values: number[] }[] = [];
  const seen = new Set<string>();
  const walk = (i: number, chosen: Die[]): void => {
    if (i >= per.length) {
      const key = chosen.map((d) => d.value).join(',');
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          key,
          label: `${chosen.map((d) => d.value).join('/')} 点`,
          ids: chosen.map((d) => d.id),
          sort: 0,
          values: chosen.map((d) => d.value),
        });
      }
      return;
    }
    for (const d of per[i]) {
      if (chosen.some((x) => x.id === d.id)) continue;
      walk(i + 1, [...chosen, d]);
    }
  };
  walk(0, []);
  return out;
}

/** 破障/超度的"每组各取 1 颗"候选 → 返回**去重后的"吃掉之后的剩余池"**（按点数多重集去重；不能填满则空数组）。 */
function z12PipsRests(pool: number[]): number[][] {
  const groups = [[1, 2], [3, 4], [5, 6]];
  const found = new Map<string, number[]>();
  const walk = (gi: number, remaining: number[]): void => {
    if (gi >= groups.length) {
      found.set(remaining.join(','), remaining);
      return;
    }
    for (const v of groups[gi]) {
      const i = remaining.indexOf(v);
      if (i < 0) continue;
      const next = [...remaining];
      next.splice(i, 1);
      walk(gi + 1, next);
    }
  };
  walk(0, [...pool].sort((a, b) => a - b));
  return [...found.values()];
}

/** 万丈明光：池里**有没有某个点数 ≥2 颗**（＝能凑「2 颗同点」一组）。 */
function z12HasSamePair(pool: number[]): boolean {
  const cnt = new Map<number, number>();
  for (const v of pool) cnt.set(v, (cnt.get(v) ?? 0) + 1);
  return [...cnt.values()].some((n) => n >= 2);
}

/** Z12 链式后瞻：从第 `afterIdx` 条起的"可发动总数"（**下游也按同一 `mode` 各自最优**；照 Z08 `z08TailOpt` 口径）。
 *  afterIdx=4 → 破障（多格 pips）→ 再到 万丈明光（同点 2 颗）；afterIdx=5 → 只看万丈明光。 */
function z12LaterFired(afterIdx: number, pool: number[], mode: 'favor' | 'against'): number {
  if (afterIdx >= 5) return z12HasSamePair(pool) ? 1 : 0; // 万丈明光
  const rests = z12PipsRests(pool); // 破障
  if (rests.length === 0) return z12LaterFired(5, pool, mode); // 破障 发不动 → 只看万丈明光
  let best: number | null = null;
  for (const r of rests) {
    const total = 1 + z12LaterFired(5, r, mode);
    if (best === null || (mode === 'against' ? total > best : total < best)) best = total;
  }
  return best!;
}

/** Z12「超度 / 破障」的链式后瞻自动选组：**有利＝后续技能可发动数越少越好**（不便宜后面的技能）；不利＝取反。
 *  tie-break＝所吃点值和**小**（所吃点值不影响本技能效果，仅作确定性）。 */
function z12ChainPickKey(g: GameState, skill: ChallengeSkill, mode: 'favor' | 'against'): string | undefined {
  const idx = Number(skill.id.split('-')[1]); // 3=超度, 4=破障
  const dr = (g.challenge?.driven ?? []).map((d) => d.value);
  const cands = z12PipsCands(skill.slots ?? [], g.challenge?.driven ?? []);
  if (cands.length === 0) return undefined;
  const better = (a: { fired: number; sum: number }, b: { fired: number; sum: number }): boolean => {
    if (a.fired !== b.fired) return mode === 'against' ? a.fired > b.fired : a.fired < b.fired;
    return mode === 'against' ? a.sum > b.sum : a.sum < b.sum;
  };
  let best: (typeof cands)[number] | null = null;
  let bestScore: { fired: number; sum: number } | null = null;
  for (const c of cands) {
    const score = { fired: z12LaterFired(idx + 1, minusMulti(dr, c.values), mode), sum: c.values.reduce((s, v) => s + v, 0) };
    if (bestScore === null || better(score, bestScore)) {
      best = c;
      bestScore = score;
    }
  }
  return best?.key;
}

/**
 * 本条技能在**本局面**下需要挑战者代决的点（模式 1）。返回按顺序要收集的选择。
 *  `atDeferred`＝这句话是在"延后一步"阶段问的（例：暗夜凶神的"弃哪颗防御骰"应在 8 点攻击结算**之后**问）。 */
function challengeDecisions(
  g: GameState,
  skill: ChallengeSkill,
  atDeferred = false,
): { prompt: string; options: { id: string; label: string }[]; prefer?: 'larger' | 'smaller' | 'asc' | 'desc' | 'order'; pick?: { pool: { id: string; value: number; kind: DiceKind }[]; n: number; owner?: PlayerId }; alwaysManual?: boolean }[] {
  const A = g.players.A;
  const B = g.players.B;
  const defOpts = (): { id: string; label: string }[] =>
    A.areas.defense.map((d) => ({ id: d.id, label: `防${d.value}` }));
  switch (skill.id) {
    case 'z01-4': {
      // 雨落狂流：不符合分布数 n → 弃 k=floor(n/3) 个挑战者防御骰；仅当"有得挑"（0<k<防御骰数）时才问
      const dist = emptyDistribution(B);
      let off = 0;
      for (const kd of KINDS_ORDER) for (const d of B.areas[kd]) if (!dist || !dist[kd].includes(d.value)) off++;
      const k = Math.floor(off / 3);
      const m = A.areas.defense.length;
      if (k <= 0 || m <= k) return [];
      return [
        {
          prompt: `「雨落狂流」：不符合分布 ${off} 个 → 弃置挑战者 ${k} 个防御骰`,
          options: combinations(m, k).map((c) => ({
            id: c.map((i) => A.areas.defense[i].id).join(','),
            label: c.map((i) => `防${A.areas.defense[i].value}`).join('、'),
          })),
          prefer: 'smaller',
          pick: { pool: A.areas.defense.map((d) => ({ id: d.id, value: d.value, kind: 'defense' as const })), n: k },
        },
      ];
    }
    case 'z01-5':
    case 'z02-4':
    case 'z04-4':
      // 裁雨流 / 枭首 / 无上剑术：「攻击顺序」**不在此处问**——必须等"骰子已移入攻击骰区"之后再问
      //（顺序代决挪到 `resolveLegendDeferred`）。这里返回 []，让 `applyChallengeSkill` 先做"移动到攻击骰区"。
      return [];
    case 'z02-2':
      return A.areas.defense.length > 1
        ? [
            {
              prompt: '「葬敌的完杀」：留哪 1 颗防御骰？（其余弃置）',
              options: defOpts(),
              prefer: 'larger',
              pick: { pool: A.areas.defense.map((d) => ({ id: d.id, value: d.value, kind: 'defense' as const })), n: 1 },
            },
          ]
        : [];
    case 'z02-3':
      // 卡面顺序：先 8 点攻击 →（攻击结算后）才问"弃哪颗防御骰"
      return atDeferred && A.areas.defense.length > 0
        ? [
            {
              prompt: '「暗夜凶神」：弃置挑战者哪 1 颗防御骰？',
              options: defOpts(),
              prefer: 'smaller',
              pick: { pool: A.areas.defense.map((d) => ({ id: d.id, value: d.value, kind: 'defense' as const })), n: 1 },
            },
          ]
        : [];
    case 'z03-2': {
      // 震荡斩击：① 区域**并列最多** → 先代决"哪个区域"（有利＝攻→防→冥 取首、不利取尾）；
      //   ② 该区域 > 4 颗 → 再问"弃哪 4 颗"（两个 want **按序**收集进 decisions[skill.id]）
      const wants: { prompt: string; options: { id: string; label: string }[]; prefer?: 'smaller' | 'order'; pick?: { pool: { id: string; value: number; kind: DiceKind }[]; n: number } }[] = [];
      const tied = tiedBusiestAreas(g);
      if (tied.length >= 2) {
        const n = A.areas[tied[0]].length;
        wants.push({
          prompt: `「震荡斩击」：多个区域骰数并列最多（各 ${n} 颗），选哪个区域？`,
          options: tied.map((k) => ({ id: k, label: `${KIND_CN[k]}（${n} 颗）` })),
          prefer: 'order',
        });
      }
      const chosen = (g.challenge!.decisions?.[skill.id] ?? [])[0];
      const busiest = chosen && KINDS_ORDER.includes(chosen as DiceKind) ? (chosen as DiceKind) : busiestAreaOfChallenger(g);
      const pool = A.areas[busiest];
      if (pool.length > 4) {
        wants.push({
          prompt: `「震荡斩击」：弃置【${KIND_CN[busiest]}】里最多的 4 颗`,
          options: combinations(pool.length, 4).map((c) => ({
            id: c.map((i) => pool[i].id).join(','),
            label: c.map((i) => `${KIND_CN[busiest]}${pool[i].value}`).join('、'),
          })),
          prefer: 'smaller',
          pick: { pool: pool.map((d) => ({ id: d.id, value: d.value, kind: busiest })), n: 4 },
        });
      }
      return wants;
    }
    case 'z03-3': {
      // 战争横扫：每种类型各弃 1 颗；仅当某类型 > 1 颗才有得挑 → 每类型各一个 want（按 KINDS_ORDER）
      const wants: { prompt: string; options: { id: string; label: string }[]; prefer: 'smaller'; pick?: { pool: { id: string; value: number; kind: DiceKind }[]; n: number } }[] = [];
      for (const k of KINDS_ORDER) {
        const pool = A.areas[k];
        if (pool.length > 1) {
          wants.push({
            prompt: `「战争横扫」：弃置【${KIND_CN[k]}】里的哪 1 颗？`,
            options: pool.map((d) => ({ id: d.id, label: `${KIND_CN[k]}${d.value}` })),
            prefer: 'smaller',
            pick: { pool: pool.map((d) => ({ id: d.id, value: d.value, kind: k })), n: 1 },
          });
        }
      }
      return wants;
    }
    case 'z03-4':
      // 战车：若攻击区有 > 1 颗攻击骰 → 定"逐个攻击"的顺序（照 z01 裁雨流 / z02 枭首）
      return B.areas.attack.length > 1
        ? [
            {
              prompt: '「战车」：用全部攻击骰逐个攻击，按什么顺序？',
              options: [
                { id: 'asc', label: '由小到大' },
                { id: 'desc', label: '由大到小' },
              ],
              prefer: 'desc',
            },
          ]
        : [];
    case 'z04-1':
      // 真实之剑：把全部防御骰当攻击骰逐个攻击 → 定顺序（>1 颗才问）
      return B.areas.defense.length > 1
        ? [
            {
              prompt: '「真实之剑」：用全部攻击骰逐个攻击，按什么顺序？',
              options: [
                { id: 'asc', label: '由小到大' },
                { id: 'desc', label: '由大到小' },
              ],
              prefer: 'desc',
            },
          ]
        : [];
    case 'z08-4':
      // 处刑通牒：用攻击骰区全部骰逐个攻击 → 定顺序（>1 颗才问；骰子已在攻击骰区，故可在前置问）
      return B.areas.attack.length > 1
        ? [
            {
              prompt: '「处刑通牒」：用全部攻击骰逐个攻击，按什么顺序？',
              options: [
                { id: 'asc', label: '由小到大' },
                { id: 'desc', label: '由大到小' },
              ],
              prefer: 'desc',
            },
          ]
        : [];
    case 'z09-1': {
      // 陷阵：**由挑战者选择** 1 颗驱动骰 → 重掷（卡面即"由挑战者选择" → 非代决 → alwaysManual：所有模式都弹面板）
      const dr = g.challenge?.driven ?? [];
      if (dr.length === 0) return [];
      return [
        {
          prompt: '「陷阵」：选择 1 颗要重新投掷的驱动骰',
          options: dr.map((d) => ({ id: d.id, label: `${d.value} 点` })),
          alwaysManual: true,
        },
      ];
    }
    case 'z10-4':
      // 涤罪大剑术：「攻击区有攻击骰则用其全部逐个攻击」→ >1 颗时定顺序（骰子已在攻击区，故前置问）
      return B.areas.attack.length > 1
        ? [
            {
              prompt: '「涤罪大剑术」：用攻击区全部攻击骰逐个攻击，按什么顺序？',
              options: [
                { id: 'asc', label: '由小到大' },
                { id: 'desc', label: '由大到小' },
              ],
              prefer: 'desc',
            },
          ]
        : [];
    case 'z05-2': {
      // 不可饶恕：X＝本回合驱动骰的众数；并列（多个点数同为最多）→ 挑战者代决用哪个点数的 X
      const cnt = new Map<number, number>();
      for (const d of g.challenge?.driven ?? []) cnt.set(d.value, (cnt.get(d.value) ?? 0) + 1);
      const maxN = cnt.size ? Math.max(...cnt.values()) : 0;
      const tied = [...cnt.entries()].filter(([, n]) => n === maxN).map(([v]) => v).sort((a, b) => a - b);
      if (tied.length <= 1) return [];
      return [
        {
          prompt: `「不可饶恕」：多个点数并列最多（各 ${maxN} 个），弃置挑战者哪个点数的能力骰？`,
          options: tied.map((v) => ({ id: String(v), label: `${v} 点` })),
          prefer: 'smaller',
        },
      ];
    }
    case 'z07-2': {
      // 不屈咆哮：弃置挑战者 =计数 的防御骰（有得挑才问）
      const n = Math.min(g.challenge?.count ?? 0, A.areas.defense.length);
      if (n <= 0 || A.areas.defense.length <= n) return [];
      return [
        {
          prompt: `「不屈咆哮」：弃置挑战者 ${n} 个防御骰`,
          options: combinations(A.areas.defense.length, n).map((c) => ({
            id: c.map((i) => A.areas.defense[i].id).join(','),
            label: c.map((i) => `防${A.areas.defense[i].value}`).join('、'),
          })),
          prefer: 'smaller',
          pick: { pool: A.areas.defense.map((d) => ({ id: d.id, value: d.value, kind: 'defense' as const })), n },
        },
      ];
    }
    case 'z11-3': {
      // 清算：弃置挑战者 =计数 个能力骰（跨攻/防/冥；有得挑才问）→ 骰片面板
      const X = g.challenge?.count ?? 0;
      const flat: { id: string; value: number; kind: DiceKind }[] = [
        ...A.areas.attack.map((d) => ({ id: d.id, value: d.value, kind: 'attack' as DiceKind })),
        ...A.areas.defense.map((d) => ({ id: d.id, value: d.value, kind: 'defense' as DiceKind })),
        ...A.areas.meditation.map((d) => ({ id: d.id, value: d.value, kind: 'meditation' as DiceKind })),
      ];
      const n = Math.min(X, flat.length);
      if (n <= 0 || flat.length <= n) return [];
      return [
        {
          prompt: `「清算」：弃置挑战者 ${n} 个能力骰`,
          options: combinations(flat.length, n).map((c) => ({
            id: c.map((i) => flat[i].id).join(','),
            label: c.map((i) => `${KIND_CN[flat[i].kind]}${flat[i].value}`).join('、'),
          })),
          prefer: 'smaller',
          pick: { pool: flat, n, owner: 'A' as PlayerId },
        },
      ];
    }
    case 'z04-5': {
      // 灵能屏障：剩余驱动骰的**点数众数**；并列（≥2 个点数同为最多）→ 挑战者代决"用哪个点数"
      //   （规则：并列最多且数量相同＝自己选一个）；auto＝通用 autoPick（有利＝取点数小＝传奇防御更弱）
      const cnt = new Map<number, number>();
      for (const d of g.challenge?.driven ?? []) cnt.set(d.value, (cnt.get(d.value) ?? 0) + 1);
      const maxN = cnt.size ? Math.max(...cnt.values()) : 0;
      const tied = [...cnt.entries()].filter(([, n]) => n === maxN).map(([v]) => v).sort((a, b) => a - b);
      if (tied.length <= 1) return [];
      return [
        {
          prompt: '「灵能屏障」：多个点数并列最多，用哪个点数的驱动骰？',
          options: tied.map((v) => ({ id: String(v), label: `${v} 点` })),
          prefer: 'smaller',
        },
      ];
    }
    case 'z12-1': {
      // 不动菩提：X＝本回合驱动骰的**众数**；并列（≥2 个点数同为最多）→ 挑战者代决"封锁哪个点数"
      //   （说明书：并列最多且数量相同＝自己选一个）；auto 复用 Z05「不可饶恕」的专用打分（同款：颗数→区域权重→点值）
      const tied = z05TiedValues(g);
      if (tied.length <= 1) return [];
      return [
        {
          prompt: '「不动菩提」：多个点数并列最多，封锁哪个点数的能力骰？',
          options: tied.map((v) => ({ id: String(v), label: `${v} 点` })),
          prefer: 'smaller',
        },
      ];
    }
    case 'z12-3': {
      // 超度：区域**并列最多** → 代决"重掷哪个区域"（有利＝攻→防→冥 取首、不利取尾）
      const tied = tiedBusiestAreas(g);
      if (tied.length < 2) return [];
      const n = A.areas[tied[0]].length;
      return [
        {
          prompt: `「超度」：多个区域骰数并列最多（各 ${n} 颗），重掷哪个区域？`,
          options: tied.map((k) => ({ id: k, label: `${KIND_CN[k]}（${n} 颗）` })),
          prefer: 'order',
        },
      ];
    }
    case 'z12-4':
      // 破障：「攻击区有攻击骰则用其全部逐个攻击」→ >1 颗时定顺序（骰子已在攻击区，故前置问）
      return B.areas.attack.length > 1
        ? [
            {
              prompt: '「破障」：用攻击骰区全部骰逐个攻击，按什么顺序？',
              options: [
                { id: 'asc', label: '由小到大' },
                { id: 'desc', label: '由大到小' },
              ],
              prefer: 'desc',
            },
          ]
        : [];
    default:
      return [];
  }
}
/**
 * **自动结算**（`settleMode != 'manual'`）：替昔传从 `want.options` 里挑一个 id。
 * - `prefer: 'asc'|'desc'`（顺序类）：favor→desc、against→asc（`prefer` 即"对挑战者有利"的方向）。
 * - `prefer: 'larger'|'smaller'`（选骰类，label 形如 `防N`）：favor 取"该方向"、against 取反向。
 * - 无 `prefer`：取第一个（现有确定性默认）。
 * 只从引擎给的**合法 options** 里选 → 天然守约束（如死亡亦逝不能多弃）。
 */
function autoPick(
  want: { options: { id: string; label: string }[]; prefer?: 'larger' | 'smaller' | 'asc' | 'desc' | 'order' },
  mode: 'favor' | 'against',
): string | undefined {
  const opts = want.options;
  if (opts.length === 0) return undefined;
  const prefer = want.prefer;
  // `'order'`：选项**已按"有利优先级"排好**（如区域并列＝攻→防→冥）→ 有利取首、不利取尾
  if (prefer === 'order') return (mode === 'against' ? opts[opts.length - 1] : opts[0]).id;
  if (prefer === 'asc' || prefer === 'desc') {
    const wantId = mode === 'favor' ? prefer : prefer === 'desc' ? 'asc' : 'desc';
    return (opts.find((o) => o.id === wantId) ?? opts[0]).id;
  }
  if (prefer === 'larger' || prefer === 'smaller') {
    const num = (o: { label: string }): number =>
      (String(o.label).match(/\d+/g) ?? []).reduce((s, x) => s + Number(x), 0);
    const sorted = [...opts].sort((a, b) => num(a) - num(b));
    const pickLarger = mode === 'favor' ? prefer === 'larger' : prefer === 'smaller';
    return (pickLarger ? sorted[sorted.length - 1] : sorted[0]).id;
  }
  return opts[0].id;
}

/**
 * 结算传奇的一条技能（导出供测试直接调用；`consumed` ＝本条消耗的驱动骰对象，点数仍保留）。
 * 返回本步的**动效事实**：`spawn`＝新获得的骰（及其区域）、`outIds`＝被挤出的旧骰（当前口径下恒为空，保留给将来特例）。
 * （枭首 / 遁入暗影触发攻击时，新骰会被**立刻移进攻击队列**，界面拿不到区域差集 → 只能靠这里报出。）
 */
export function applyChallengeSkill(
  g: GameState,
  card: ChallengeCard,
  skill: ChallengeSkill,
  consumed: Die[],
): { spawn: { id: string; value: number; area: 'attack' | 'defense' | 'meditation' }[]; outIds: string[] } {
  const legacy = card.legacy;
  const consumedTxt = consumed.map((d) => d.value).sort((a, b) => a - b).join('/');
  logLine(g, `「${legacy}」：${skill.name}${skill.passive ? '（常驻）' : consumedTxt ? `（消耗驱动骰 ${consumedTxt}）` : ''}`);
  const A = g.players.A;
  const B = g.players.B;
  const spawn: { id: string; value: number; area: 'attack' | 'defense' | 'meditation' }[] = [];
  const outIds: string[] = [];
  /** 传奇新获得一颗能力骰（登记进 `spawn`，供界面演"中间冒出 → 飞入区域"）。
   *  **防御骰**统一走 `addLegendDefense`（满上限 → 新骰直接弃置、不加入、不产生 spawn）。
   *  ⚠️ 口径（2026-10-10 用户定）：满上限＝**新骰弃置**，**不是**"挤掉最旧"。 */
  const gain = (area: 'attack' | 'defense' | 'meditation', value: number): void => {
    const d = createDie(newDieId('chg-B-'), value, area);
    if (area === 'defense') {
      if (!addLegendDefense(g, d)) return; // 已满 → 直接弃置
    } else {
      B.areas[area].push(d);
    }
    spawn.push({ id: d.id, value, area });
  };
  switch (skill.id) {
    case 'z01-0':
      return { spawn, outIds }; // 投驱动骰已在回合开始完成
    case 'z01-1':
      // 龙游万象：将所有 1/6 点的驱动骰**各重掷 1 次**（点数变化 → 通用"骰子翻转"动画）
      withRng(g, (rng) => {
        for (const d of g.challenge!.driven) {
          if (d.value === 1 || d.value === 6) d.value = rng.rollDie();
        }
      });
      return { spawn, outIds };
    case 'z01-2': {
      // 断斩一斩：① 弃双方全部能力骰（区域骰）→ ② 对挑战者 10 真伤 → ③ 昔传得 3 个随机点数防御骰 → ④ 立即结束回合（状态机处理 endsTurn）
      const removedDuanzhan: { kind: DiceKind; value: number }[] = [];
      for (const p of [A, B]) {
        for (const kd of KINDS_ORDER) {
          const ids = p.areas[kd].map((d) => d.id);
          if (ids.length) removedDuanzhan.push(...consumeDice(g, p, kd, ids, { byLegend: true }));
        }
      }
      dealTrueDamage(g, 'A', 10, 'B');
      withRng(g, (rng) => {
        for (let i = 0; i < 3; i++) gain('defense', rng.rollDie());
      });
      logLine(g, `「${legacy}」：${skill.name} — 弃置双方全部能力骰（${vals(removedDuanzhan)}）、对挑战者造成 10 点真实伤害、获得 3 个随机防御骰（${valsSorted(spawn)}）`);
      return { spawn, outIds };
    }
    case 'z01-3': {
      // 龙腾万丈：得 4 个随机点数能力骰 → 最大 1 + 最小 1 移攻击骰区；**其余 2 颗移防御骰区**。
      // 防御骰区放不下全部时，由挑战者**代决"哪颗进"**（延后到 `resolveLegendDeferred`，复用 `chooseDefenseMove`）。
      const vals: number[] = [];
      withRng(g, (rng) => {
        for (let i = 0; i < 4; i++) vals.push(rng.rollDie());
      });
      const sorted = [...vals].sort((a, b) => a - b);
      gain('attack', sorted[sorted.length - 1]); // 最大
      gain('attack', sorted[0]); // 最小
      g.challenge!.deferred = {
        skillId: skill.id,
        step: 0,
        dice: sorted.slice(1, 3).map((v, i) => ({ id: `${skill.id}-def-${i}`, value: v })), // 中间 2 颗 → 防御区
        moved: false,
      };
      logLine(
        g,
        `「${legacy}」：${skill.name} — 获得 4 颗能力骰（${sorted.join('/')}）：最大 ${sorted[sorted.length - 1]} / 最小 ${sorted[0]} → 攻击骰区，中间 2 颗 → 防御骰区`,
      );
      return { spawn, outIds };
    }
    case 'z01-4': {
      // 雨落狂流：数昔传区域中"不符合骰点分布"（第二列＝002 游龙）的能力骰 → 每 3 个弃挑战者 1 防御骰
      const dist = emptyDistribution(B);
      let off = 0;
      for (const k of KINDS_ORDER) for (const d of B.areas[k]) if (!dist || !dist[k].includes(d.value)) off++;
      const k = Math.floor(off / 3);
      if (k <= 0) return { spawn, outIds };
      const chosen = g.challenge!.decisions?.[skill.id] ?? [];
      let ids: string[];
      if (chosen[0]) {
        ids = chosen[0].split(',').filter(Boolean);
      } else {
        const mode = g.challenge!.settleMode;
        const def = [...A.areas.defense].sort((a, b) => a.value - b.value);
        ids = (mode === 'against' ? def.slice(-k) : def.slice(0, k)).map((d) => d.id);
      }
      ids = ids.filter((id) => A.areas.defense.some((d) => d.id === id));
      const removedYuluo = ids.length ? consumeDice(g, A, 'defense', ids, { byLegend: true }) : [];
      if (removedYuluo.length > 0) logLine(g, `「${legacy}」：${skill.name} — 弃置挑战者 ${removedYuluo.length} 个防御骰（${vals(removedYuluo)}）`);
      return { spawn, outIds };
    }
    case 'z01-5': {
      // 裁雨流：① 本条驱骰（无限 3/4 点）全部移入攻击骰区（**先移、报 spawn**）；
      //   ② "攻击顺序代决"与"用全部攻击骰逐个攻击"**延后到** `resolveLegendDeferred`（顺序要在移入之后才问）。
      for (const d of consumed) gain('attack', d.value);
      g.challenge!.caiyuliuHits = 0;
      g.challenge!.deferred = { skillId: skill.id, step: 0 };
      return { spawn, outIds };
    }
    case 'z02-0':
      return { spawn, outIds }; // 投驱动骰已在回合开始完成
    case 'z02-1':
      syncLegendFengmang(g);
      return { spawn, outIds };
    case 'z02-2': {
      // 尽可能弃置挑战者防御骰，直至剩 1（"留哪颗"＝代决，模式 1；未代决时默认留第一颗）
      const keepId = (g.challenge!.decisions?.[skill.id] ?? [])[0] ?? A.areas.defense[0]?.id;
      const drop = A.areas.defense.filter((d) => d.id !== keepId).map((d) => d.id);
      const removedZangdi = drop.length ? consumeDice(g, A, 'defense', drop, { byLegend: true }) : [];
      // 获得 1/2/3/4 点攻击骰各 1
      for (const v of [1, 2, 3, 4]) gain('attack', v);
      logLine(g, `「${legacy}」：${skill.name} — 弃置挑战者防御骰${removedZangdi.length > 0 ? `（${vals(removedZangdi)}）` : '（无）'}、获得攻击骰（${valsSorted(spawn)}）`);
      return { spawn, outIds };
    }
    case 'z02-3': {
      // 卡面顺序：① 先发起 8 点「不可抵挡」攻击；② 攻击结算完**之后**才弃挑战者 1 颗防御骰；③ 最后计数 +1
      virtualAttack(g, 'B', 8, { skill: '暗夜凶神', owner: 'B' }, { unblockable: true });
      if (g.pendingAttack) {
        // 攻击已挂起 → 把"②弃骰 ③计数"记成延后效果，等这次攻击结算完回到传奇回合再执行
        g.challenge!.deferred = { skillId: skill.id, step: 0 };
      } else {
        // 极端兜底（攻击被禁等）：立刻按顺序补齐
        const dropId = (g.challenge!.decisions?.[skill.id] ?? [])[0] ?? A.areas.defense[0]?.id;
        if (dropId) consumeDice(g, A, 'defense', [dropId], { byLegend: true });
        const cap = card.countCap ?? Number.POSITIVE_INFINITY;
        g.challenge!.count = Math.min(cap, g.challenge!.count + 1);
        syncLegendFengmang(g);
      }
      return { spawn, outIds };
    }
    case 'z02-4': {
      for (const d of consumed) gain('attack', d.value);
      // 枭首：① 本技能驱动骰全部移入攻击骰区（**先移、报 spawn**）；
      //   ② "是否攻击 + 攻击顺序代决 + 逐个攻击"**延后到** `resolveLegendDeferred`（顺序要在移入之后才问）。
      g.challenge!.deferred = { skillId: skill.id, step: 0 };
      return { spawn, outIds };
    }
    case 'z02-5': {
      // 遁入暗影：驱动骰按「每 2 颗同点＝1 组」成组（最多 2 组，见 `continueLegendTurn` 的 `matchSameGroups`）。
      // ① 先把本技能全部骰**移入防御骰区**（防御区放不下时由挑战者任选 room 颗）；
      // ② 再逐组发起 2 点攻击。二者都延后到 `resolveLegendDeferred`。
      const n = skill.slots?.[0]?.count ?? 2;
      const groups: number[][] = [];
      for (let i = 0; i + n <= consumed.length; i += n) groups.push(consumed.slice(i, i + n).map((d) => d.value));
      if (groups.length === 0) return { spawn, outIds };
      g.challenge!.deferred = {
        skillId: skill.id,
        step: 0,
        groups,
        dice: consumed.map((d) => ({ id: d.id, value: d.value })),
        moved: false,
      };
      return { spawn, outIds };
    }
    case 'z03-1': {
      // 统御战场：将挑战者的**所有攻击骰**点数变更为 1（原地改点 → 走通用"骰面翻转"）
      for (const d of A.areas.attack) d.value = 1;
      return { spawn, outIds };
    }
    case 'z03-2': {
      // 震荡斩击：弃"挑战者骰最多的区域"里的至多 4 颗；**弃置不足 4 颗 → 1 次 5 点攻击**
      //   ⚠️ 区域**并列最多**时先由挑战者代决区域（`decisions[0]`＝区域 kind）→ 其后的 `decisions[1]`＝"弃哪 4 颗"
      const dec32 = g.challenge!.decisions?.[skill.id] ?? [];
      const areaChoice = KINDS_ORDER.includes(dec32[0] as DiceKind) ? (dec32[0] as DiceKind) : undefined;
      const busiest = areaChoice ?? busiestAreaOfChallenger(g);
      const diceChoice = dec32[areaChoice ? 1 : 0];
      const pool = A.areas[busiest];
      const n = Math.min(4, pool.length);
      let ids: string[];
      if (diceChoice) {
        ids = diceChoice.split(',').filter((id) => pool.some((d) => d.id === id));
      } else {
        const sorted = [...pool].sort((a, b) => a.value - b.value || (a.id < b.id ? -1 : 1));
        const mode = g.challenge!.settleMode;
        ids = (mode === 'against' ? sorted.slice(-n) : sorted.slice(0, n)).map((d) => d.id);
      }
      const removedZhandang = ids.length ? consumeDice(g, A, busiest, ids, { byLegend: true }) : [];
      g.challenge!.firedThisTurn = [...(g.challenge!.firedThisTurn ?? []), skill.id];
      logLine(g, `「${legacy}」：${skill.name} — 弃置挑战者 ${removedZhandang.length} 个${KIND_CN[busiest]}骰（${vals(removedZhandang)}）${ids.length < 4 ? '、攻击骰不足 4 → 1 次 5 点攻击' : ''}`);
      if (ids.length < 4) virtualAttack(g, 'B', 5, { skill: skill.name, owner: 'B' });
      return { spawn, outIds };
    }
    case 'z03-3': {
      // 战争横扫：每种类型各弃 1 颗；**每有一种"无骰可弃" → 1 次 5 点攻击**（多段走 virtualQueue）
      let missed = 0;
      const removedSaodang: { kind: DiceKind; value: number }[] = [];
      const choices = g.challenge!.decisions?.[skill.id] ?? [];
      let ci = 0;
      for (const k of KINDS_ORDER) {
        const pool = A.areas[k];
        if (pool.length === 0) {
          missed += 1;
          continue;
        }
        const want = pool.length > 1 ? choices[ci++] : undefined;
        const sorted = [...pool].sort((a, b) => a.value - b.value);
        const id =
          want && pool.some((d) => d.id === want)
            ? want
            : sorted[g.challenge!.settleMode === 'against' ? sorted.length - 1 : 0].id;
        removedSaodang.push(...consumeDice(g, A, k, [id], { byLegend: true }));
      }
      g.challenge!.firedThisTurn = [...(g.challenge!.firedThisTurn ?? []), skill.id];
      logLine(g, `「${legacy}」：${skill.name} — 弃置挑战者各类型 1 颗（${vals(removedSaodang)}）${missed > 0 ? `、${missed} 种无骰可弃 → ${missed} 次 5 点攻击` : ''}`);
      if (missed > 0) {
        // §19⑨ 多段攻击源：战争横扫
        g.virtualQueue = Array.from({ length: missed }, () => ({
          attacker: 'B' as PlayerId,
          value: 5,
          label: skill.name,
          owner: 'B' as PlayerId,
        }));
        pumpAttackQueue(g);
      }
      return { spawn, outIds };
    }
    case 'z03-4': {
      // 战车：① 1 次 5 点攻击 → ② 攻击骰区有骰则**也用全部攻击骰逐个攻击**（顺序＝代决）→ ③ 攻击结算后补防御（deferred）
      const atk = B.areas.attack;
      const order = (g.challenge!.decisions?.[skill.id] ?? [])[0];
      const q: NonNullable<GameState['virtualQueue']> = [{ attacker: 'B', value: 5, label: skill.name, owner: 'B' }]; // ①
      if (atk.length > 0) {
        const diceQ = atk.map((d) => ({
          attacker: 'B' as PlayerId,
          value: d.value,
          label: skill.name,
          owner: 'B' as PlayerId,
          dieId: d.id,
          dieStyle: 'solid' as const,
        }));
        if (order === 'asc') diceQ.sort((a, b) => a.value - b.value);
        else if (order === 'desc') diceQ.sort((a, b) => b.value - a.value);
        // 区里的排列同序 → "最左先飞"
        const rank = new Map(diceQ.map((x, i) => [x.dieId, i]));
        atk.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
        q.push(...diceQ);
      }
      // §19⑨ 多段攻击源：战车
      g.virtualQueue = q;
      g.challenge!.deferred = { skillId: skill.id, step: 0 }; // ③ 攻击结算后补防御
      pumpAttackQueue(g);
      return { spawn, outIds };
    }
    case 'z03-5': {
      // 拔城：若本回合**既未**发动震荡斩击**也未**发动战争横扫 → 弃挑战者全部能力骰 + 2 次 5 点攻击
      const fired = g.challenge!.firedThisTurn ?? [];
      if (!fired.includes('z03-2') && !fired.includes('z03-3')) {
        const removedBacheng: { kind: DiceKind; value: number }[] = [];
        for (const k of KINDS_ORDER) {
          const ids = A.areas[k].map((d) => d.id);
          if (ids.length) removedBacheng.push(...consumeDice(g, A, k, ids, { byLegend: true }));
        }
        logLine(g, `「${legacy}」：${skill.name} — 弃置挑战者全部能力骰（${vals(removedBacheng)}）、2 次 5 点攻击`);
        // §19⑨ 多段攻击源：拔城
        g.virtualQueue = [0, 1].map(() => ({
          attacker: 'B' as PlayerId,
          value: 5,
          label: skill.name,
          owner: 'B' as PlayerId,
        }));
        pumpAttackQueue(g);
      }
      return { spawn, outIds };
    }
    case 'z04-1': {
      // 真实之剑（甲口径，2026-10-11 用户定）：
      //   · 防御骰 > 10 → **这些防御骰"视为攻击骰"**，逐颗**从防御骰区**飞出攻击；
      //   · **不搬进攻击骰区**（`kind` 不变）→ 界面不会播"防御区→攻击区"的移动；
      //   · 攻击骰区**原有的骰子既不移动、也不参与本次攻击**（卡面"将其全部视为攻击骰"＝只打这批）。
      if (B.areas.defense.length <= 10) return { spawn, outIds };
      const src = [...B.areas.defense]; // 本次攻击源＝这批判防御骰（原地不动）
      // §19⑨ 多段攻击源：真实之剑
      g.virtualQueue = src.map((d) => ({
        attacker: 'B' as PlayerId,
        value: d.value,
        label: skill.name,
        owner: 'B' as PlayerId,
        dieId: d.id,
        dieStyle: 'solid' as const,
      }));
      const order = (g.challenge!.decisions?.[skill.id] ?? [])[0];
      if (order === 'asc') g.virtualQueue.sort((a, b) => a.value - b.value);
      else if (order === 'desc') g.virtualQueue.sort((a, b) => b.value - a.value);
      // 防御骰区**排列也按同序重排** → "最左边那颗先飞出去"，观感不错位（与枭首/裁雨流同款）
      const rank = new Map(g.virtualQueue.map((q, i) => [q.dieId, i]));
      B.areas.defense.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
      pumpAttackQueue(g);
      return { spawn, outIds };
    }
    case 'z04-2': {
      // 梦醒时分：挑战者的**计数与充能全部重设为 0**；"魔女"生命**回复至 40**
      for (const a of A.artifacts) {
        a.count = 0;
        a.chargeLayer = 0;
      }
      g.players.B.life = 40;
      logLine(g, `「${card.legacy}」：${skill.name} — 挑战者计数/充能归零，「${card.legacy}」生命回复至 40`);
      return { spawn, outIds };
    }
    case 'z04-3': {
      // 顿悟：将"魔女"**所有区域中的能力骰数量翻倍**（新增的随机投点、落回原区域）
      for (const k of KINDS_ORDER) {
        const n = B.areas[k].length;
        withRng(g, (rng) => {
          for (let i = 0; i < n; i++) gain(k, rng.rollDie());
        });
      }
      if (spawn.length > 0) logLine(g, `「${legacy}」：${skill.name} — 各区域能力骰数量翻倍，新增 ${spawn.length} 颗（${valsSorted(spawn)}）`);
      return { spawn, outIds };
    }
    case 'z04-4': {
      // 无上剑术：把**剩余驱动骰中最高点数**的骰移入攻击骰区。
      //   "是否攻击（攻击骰数 > 挑战者防御骰数）+ 攻击顺序代决 + 逐个攻击"一律**延后到** `resolveLegendDeferred`
      //   —— 顺序必须在"驱动骰已移入攻击骰区"之后才问（见 AGENTS §16「代决时点＝先移骰动画、再问」）。
      const dr = g.challenge!.driven;
      const maxV = dr.reduce((m, d) => Math.max(m, d.value), 0);
      for (const d of dr.filter((x) => x.value === maxV)) gain('attack', d.value);
      g.challenge!.driven = dr.filter((x) => x.value !== maxV);
      g.challenge!.deferred = { skillId: skill.id, step: 0 };
      return { spawn, outIds };
    }
    case 'z04-5': {
      // 灵能屏障：把**剩余驱动骰中数量最多的点数**的骰移入防御骰区。
      //   **并列（≥2 个点数同为最多）→ 挑战者代决选一个点数**（规则：并列＝自己选一个）；
      //   无代决兜底＝取点数小者（确定性）。
      const dr = g.challenge!.driven;
      const cnt = new Map<number, number>();
      for (const d of dr) cnt.set(d.value, (cnt.get(d.value) ?? 0) + 1);
      const chosen = (g.challenge!.decisions?.[skill.id] ?? [])[0];
      let bestV = 0;
      if (chosen !== undefined) {
        bestV = Number(chosen);
      } else {
        let bestN = -1;
        for (const [v, n] of [...cnt.entries()].sort((a, b) => a[0] - b[0])) {
          if (n > bestN) { bestN = n; bestV = v; }
        }
      }
      for (const d of dr.filter((x) => x.value === bestV)) gain('defense', d.value);
      g.challenge!.driven = dr.filter((x) => x.value !== bestV);
      if (spawn.length > 0) logLine(g, `「${legacy}」：${skill.name} — 移入防御骰区（${valsSorted(spawn)}）`);
      return { spawn, outIds };
    }
    case 'z05-0':
      return { spawn, outIds }; // 投驱动骰已在回合开始完成
    case 'z05-1':
      return { spawn, outIds }; // 纯被动（+2 投骰 / 攻击加成）在别处处理，不占步
    case 'z05-2': {
      // 不可饶恕：弃置挑战者的所有 X 点能力骰（X＝本回合驱动骰的众数，并列已由代决定）
      const x = z05ChongfuX(g, skill);
      let removedAll: { kind: DiceKind; value: number }[] = [];
      for (const k of KINDS_ORDER) {
        const ids = A.areas[k].filter((d) => d.value === x).map((d) => d.id);
        if (ids.length) removedAll = removedAll.concat(consumeDice(g, A, k, ids, { byLegend: true }));
      }
      logLine(g, `「${legacy}」：${skill.name} — 弃置挑战者所有 ${x} 点能力骰（${vals(removedAll)}）`);
      return { spawn, outIds };
    }
    case 'z05-3': {
      // 数罪并罚：每匹配 1 组 → 2 次 6 点攻击 + 自伤 3 点真实伤害
      const size = skill.slots?.[0].count || 2;
      const groups = Math.floor(consumed.length / size);
      if (groups > 0) {
        // §19⑨ 多段攻击源：数罪并罚
        g.virtualQueue = Array.from({ length: groups * 2 }, (_, k) => ({
          attacker: 'B' as PlayerId,
          value: 6,
          label: skill.name,
          owner: 'B' as PlayerId,
          // 每组 2 段 → 提示"第 K / N 组 · 本组第 j / 2 次"
          legendGroup: { index: Math.floor(k / 2) + 1, total: groups, sub: (k % 2) + 1, subTotal: 2 },
        }));
        dealTrueDamage(g, 'B', groups * 3, 'B');
        logLine(g, `「${legacy}」：${skill.name} — ${groups} 组：${groups * 2} 次 6 点攻击，自身受到 ${groups * 3} 点真实伤害`);
        pumpAttackQueue(g);
      }
      return { spawn, outIds };
    }
    case 'z05-4': {
      // 电刑：每匹配 1 组 → 以 1、2、3 点各攻击 1 次；末尾再"若攻击骰区有攻击骰，也一并攻击"
      const size = skill.slots?.[0].count || 2;
      const groups = Math.floor(consumed.length / size);
      const q: NonNullable<GameState['virtualQueue']> = [];
      for (let gi = 0; gi < groups; gi++) {
        [1, 2, 3].forEach((v, j) => {
          q.push({
            attacker: 'B' as PlayerId,
            value: v,
            label: skill.name,
            owner: 'B' as PlayerId,
            // 每组 3 段（1/2/3）→ 提示"第 K / N 组 · 本组第 j / 3 次"
            legendGroup: { index: gi + 1, total: groups, sub: j + 1, subTotal: 3 },
          });
        });
      }
      for (const d of B.areas.attack) {
        q.push({ attacker: 'B' as PlayerId, value: d.value, label: skill.name, owner: 'B' as PlayerId, dieId: d.id, dieStyle: 'solid' as const });
      }
      if (q.length > 0) {
        // §19⑨ 多段攻击源：电刑
        g.virtualQueue = q;
        pumpAttackQueue(g);
      }
      return { spawn, outIds };
    }
    case 'z05-5':
      // 净化：把本技能上的驱动骰（至多 2 颗）移入防御骰区 → **延后一步**（先弹名，再移骰；放不下走代决）
      g.challenge!.deferred = {
        skillId: skill.id,
        step: 0,
        dice: consumed.map((d) => ({ id: d.id, value: d.value })),
      };
      return { spawn, outIds };
    case 'z06-0':
      return { spawn, outIds }; // 投驱动骰已在回合开始完成
    case 'z06-1':
      return { spawn, outIds }; // 无光领域＝纯被动（指示物在别处处理）
    case 'z06-2': {
      // 虚无形态：自身受 10 点真实伤害 → 5 次 5 点攻击
      dealTrueDamage(g, 'B', 10, 'B');
      logLine(g, `「${legacy}」：${skill.name} — 受到 10 点真实伤害`);
      // §19⑨ 多段攻击源：虚无形态
      g.virtualQueue = Array.from({ length: 5 }, (_, j) => ({
        attacker: 'B' as PlayerId,
        value: 5,
        label: skill.name,
        owner: 'B' as PlayerId,
        legendGroup: { index: 1, total: 1, sub: j + 1, subTotal: 5 },
      }));
      pumpAttackQueue(g);
      return { spawn, outIds };
    }
    case 'z06-3':
      // 勾魂镰：本回合其攻击伤害 +2；随后"驱骰→防御区、其余→攻击区并全部攻击"（延后一步做）
      B.buffs.push({ attr: 'attackDamage', add: 2, duration: 'thisTurn', source: '勾魂镰·黑' });
      g.challenge!.deferred = {
        skillId: skill.id,
        step: 0,
        dice: consumed.map((d) => ({ id: d.id, value: d.value })),
      };
      return { spawn, outIds };
    case 'z06-4':
      // 冥界行走（本回合）：其攻击造成伤害 → 回血（钩子在 `settleAttack`）
      g.challenge!.mingjieHeal = true;
      logLine(g, `「${legacy}」：${skill.name} — 本回合其攻击造成伤害时回复一半生命`);
      return { spawn, outIds };
    case 'z06-5':
      // 圆舞：驱骰→防御区、其余→攻击区并全部攻击（延后一步做）
      g.challenge!.deferred = {
        skillId: skill.id,
        step: 0,
        dice: consumed.map((d) => ({ id: d.id, value: d.value })),
      };
      return { spawn, outIds };
    case 'z06-x':
      return { spawn, outIds }; // 死即新生＝独立钩子（生命归 0）
    case 'z07-0':
      return { spawn, outIds }; // 投驱动骰已在回合开始完成
    case 'z07-1': {
      // 燎原之火：计数 +1 → 回复 =计数 生命 → 追加投掷 =计数 的驱动骰
      const cap = card.countCap ?? Number.POSITIVE_INFINITY;
      g.challenge!.count = Math.min(cap, g.challenge!.count + 1);
      const n = g.challenge!.count;
      heal(g, 'B', n);
      const added: number[] = [];
      withRng(g, (rng) => {
        for (let i = 0; i < n; i++) {
          const v = rng.rollDie();
          added.push(v);
          g.challenge!.driven.push(createDie(newDieId('drv-B-'), v, 'meditation'));
        }
      });
      // 战报**带点数**（升序、`/` 拼接——与「回合开始」的「投掷 N 个驱动骰（…）」同款）
      const rolled = [...added].sort((a, b) => a - b).join('/');
      logLine(g, `「${legacy}」：${skill.name} — 计数 ${n}：回复 ${n} 点生命、追加投掷 ${n} 个驱动骰（${rolled}）`);
      return { spawn, outIds };
    }
    case 'z07-2': {
      // 不屈咆哮（怜悯*）：弃置挑战者 =计数 的防御骰
      const dec = (g.challenge!.decisions ??= {});
      const decided = (dec[skill.id] ?? [])[0];
      const n = Math.min(g.challenge!.count, A.areas.defense.length);
      let ids: string[];
      if (decided) ids = decided.split(',');
      else ids = A.areas.defense.slice(0, n).map((d) => d.id);
      if (ids.length > 0) {
        const removed = consumeDice(g, A, 'defense', ids, { byLegend: true });
        logLine(g, `「${legacy}」：${skill.name} — 弃置挑战者 ${ids.length} 个防御骰（${vals(removed)}）`);
      }
      delete dec[skill.id];
      return { spawn, outIds };
    }
    case 'z07-3': {
      // 兽魂：奇数 ≥ 偶数 → 2 次 3 点攻击；偶数 > 奇数 → 本回合攻击伤害 +2
      const dr = g.challenge!.driven;
      const odd = dr.filter((d) => d.value % 2 === 1).length;
      const even = dr.length - odd;
      if (odd >= even) {
        // §19⑨ 多段攻击源：兽魂
        g.virtualQueue = [0, 1].map((_, j) => ({
          attacker: 'B' as PlayerId,
          value: 3,
          label: skill.name,
          owner: 'B' as PlayerId,
          legendGroup: { index: 1, total: 1, sub: j + 1, subTotal: 2 }, // 提示"第 j / 2 次"
        }));
        logLine(g, `「${legacy}」：${skill.name} — 奇数 ${odd} ≥ 偶数 ${even}，2 次 3 点攻击`);
        pumpAttackQueue(g);
      } else {
        B.buffs.push({ attr: 'attackDamage', add: 2, duration: 'thisTurn', source: '兽魂' });
        logLine(g, `「${legacy}」：${skill.name} — 偶数 ${even} > 奇数 ${odd}，本回合攻击伤害 +2`);
      }
      return { spawn, outIds };
    }
    case 'z07-4':
      // 蛮王之牙：**逐组结算、组间等攻击结算**（组a攻击里触发的效果会真实影响组b）——
      //   这里只挂 `deferred`；真正的"每一组"做在 `resolveLegendDeferred`（攻击结算完回到传奇回合时再进下一组）。
      g.challenge!.deferred = { skillId: skill.id, step: 0 };
      return { spawn, outIds };
    case 'z07-5':
      // 尘起：剩余驱动骰 → 防御骰区（先播移动动画）；若攻击骰区有攻击骰 → 问顺序再全体攻击（延后分步）
      g.challenge!.deferred = {
        skillId: skill.id,
        step: 0,
        dice: g.challenge!.driven.map((d) => ({ id: d.id, value: d.value })),
      };
      g.challenge!.driven = [];
      return { spawn, outIds };
    case 'z07-x':
      return { spawn, outIds }; // 围攻＝独立钩子（挑战者 6 点攻击骰造成伤害前）
    case 'z08-0':
      return { spawn, outIds }; // 投驱动骰已在回合开始完成
    case 'z08-1': {
      // 填弹：取点数最高的 1 个驱动骰移入攻击骰区（并列取第一个＝确定性）
      const dr = g.challenge!.driven;
      if (dr.length === 0) return { spawn, outIds };
      const maxV = dr.reduce((m, x) => Math.max(m, x.value), 0);
      const idx = dr.findIndex((x) => x.value === maxV);
      const die = dr[idx];
      g.challenge!.driven = dr.filter((_, i) => i !== idx);
      gain('attack', die.value);
      logLine(g, `「${legacy}」：${skill.name} — 点数最高的驱动骰 ${die.value} 移入攻击骰区`);
      return { spawn, outIds };
    }
    case 'z08-2': {
      // 凶弹业舞：① 挑战者**所有防御骰** → 黑枪攻击骰区（新建 B 攻骰 + 消耗 A 防骰）；
      //   ② 挑战者**所有攻击骰** → 黑枪防御骰区（受上限 4）→ **延后一步**（先播①、放不下时②走代决）。
      const aDef = [...A.areas.defense];
      for (const d of aDef) gain('attack', d.value);
      if (aDef.length > 0) consumeDice(g, A, 'defense', aDef.map((d) => d.id), { byLegend: true });
      const aAtk = A.areas.attack.map((d) => ({ id: d.id, value: d.value }));
      g.challenge!.deferred = { skillId: skill.id, step: 0, dice: aAtk };
      logLine(g, `「${legacy}」：${skill.name} — 挑战者防御骰（${valsSorted(aDef)}）→ 攻击骰区`);
      return { spawn, outIds };
    }
    case 'z08-3': {
      // 共振：挑战者能力骰 ≥4 → 双方各得 2 随机攻击骰；<4 → 双方各弃 2 防御骰（代决"弃哪几颗"延后一步）
      const aTot = A.areas.attack.length + A.areas.defense.length + A.areas.meditation.length;
      if (aTot >= 4) {
        let aGained: { value: number }[] = [];
        withRng(g, (rng) => {
          aGained = gainRandomDice(g, 'A', 'attack', 2, rng);
          gain('attack', rng.rollDie());
          gain('attack', rng.rollDie());
        });
        logLine(
          g,
          `「${legacy}」：${skill.name} — 挑战者能力骰 ${aTot}≥4：双方各获得 2 个随机攻击骰（「${legacy}」：${valsSorted(spawn)}；挑战者：${valsSorted(aGained)}）`,
        );
      } else {
        g.challenge!.deferred = { skillId: skill.id, step: 0 };
        logLine(g, `「${legacy}」：${skill.name} — 挑战者能力骰 ${aTot}<4：双方各弃置 2 个防御骰`);
      }
      return { spawn, outIds };
    }
    case 'z08-4': {
      // 处刑通牒：攻击骰数 > 挑战者防御骰数 → 本回合攻击伤害 +5；否则 +1 且不可抵挡；再"用所有攻击骰发起攻击"
      const atk = B.areas.attack;
      const over = atk.length > A.areas.defense.length;
      B.buffs.push({ attr: 'attackDamage', add: over ? 5 : 1, duration: 'thisTurn', source: '处刑通牒' });
      logLine(
        g,
        `「${legacy}」：${skill.name} — 攻击骰 ${atk.length} ${over ? '>' : '≤'} 挑战者防御骰 ${A.areas.defense.length}：本回合攻击伤害 ${over ? '+5' : '+1 且不可抵挡'}`,
      );
      if (atk.length === 0) return { spawn, outIds };
      const order = (g.challenge!.decisions?.[skill.id] ?? [])[0];
      // §19⑨ 多段攻击源：处刑通牒
      g.virtualQueue = atk.map((x) => ({
        attacker: 'B' as PlayerId,
        value: x.value,
        label: skill.name,
        owner: 'B' as PlayerId,
        dieId: x.id,
        dieStyle: 'solid' as const,
        ...(over ? {} : { unblockable: true }),
      }));
      if (order === 'asc') g.virtualQueue.sort((a, b) => a.value - b.value);
      else if (order === 'desc') g.virtualQueue.sort((a, b) => b.value - a.value);
      // 区里的排列同序 → "最左先飞"
      const rank = new Map(g.virtualQueue.map((x, i) => [x.dieId, i]));
      atk.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
      pumpAttackQueue(g);
      return { spawn, outIds };
    }
    case 'z08-5':
      // 蛇蝎之泪：本技能驱动骰（3/4 点）全部 → 防御骰区（受上限 4；放不下走代决）→ 延后一步
      g.challenge!.deferred = {
        skillId: skill.id,
        step: 0,
        dice: consumed.map((d) => ({ id: d.id, value: d.value })),
      };
      return { spawn, outIds };
    case 'z09-0':
      return { spawn, outIds }; // 投驱动骰已在回合开始完成
    case 'z09-1': {
      // 陷阵：挑战者选 1 颗驱动骰 → 重新投掷 1 次（驱动骰不是能力骰 → 不走 doReroll）
      const dr = g.challenge!.driven;
      if (dr.length === 0) return { spawn, outIds };
      const chosen = (g.challenge!.decisions?.[skill.id] ?? [])[0];
      let i = chosen ? dr.findIndex((d) => d.id === chosen) : -1;
      if (i < 0) i = dr.reduce((best, d, idx) => (d.value > dr[best].value ? idx : best), 0); // 兜底（正常必有挑战者的选择）
      withRng(g, (rng) => {
        dr[i].value = rng.rollDie();
      });
      logLine(g, `「${legacy}」：${skill.name} — 重新投掷 1 个驱动骰 → ${dr[i].value} 点`);
      return { spawn, outIds };
    }
    case 'z09-2':
      // 战鬼的残杀：本技能驱骰 → 攻击骰区；随后"攻击区+防御区全部骰逐个攻击"延后一步（先移骰、再问顺序）
      for (const d of consumed) gain('attack', d.value);
      g.challenge!.deferred = { skillId: skill.id, step: 0 };
      return { spawn, outIds };
    case 'z09-3':
      // 奇袭：本技能驱骰 → 攻击骰区（不攻击；留给后续横贯）
      for (const d of consumed) gain('attack', d.value);
      return { spawn, outIds };
    case 'z09-4': {
      // 凛冽之音：补充**缺失的点数**各 1 颗（指定点数、确定性），直至防御骰区覆盖 1–6（≤6 颗）
      const have = new Set(B.areas.defense.map((x) => x.value));
      const missing = [1, 2, 3, 4, 5, 6].filter((v) => !have.has(v));
      for (const v of missing) gain('defense', v);
      logLine(g, `「${legacy}」：${skill.name} — 补充 ${missing.length} 个防御骰（覆盖 1–6：${valsSorted(spawn)}）`);
      return { spawn, outIds };
    }
    case 'z09-5':
      // 横贯：本技能驱骰 → 攻击骰区；置"挑战者抵挡后必弃骰"标记；随后"全部攻击骰逐个攻击"延后一步
      for (const d of consumed) gain('attack', d.value);
      g.challenge!.hengguan = true;
      g.challenge!.deferred = { skillId: skill.id, step: 0 };
      return { spawn, outIds };
    case 'z09-x':
      return { spawn, outIds }; // 威压＝卡面级规则（钩子在 settleAttack）
    case 'z10-0':
      return { spawn, outIds }; // 投驱动骰已在回合开始完成
    case 'z10-1':
      return { spawn, outIds }; // 迟来的正义＝常驻规则（攻击伤害 ×2 在 combat 的伤害计算处）
    case 'z10-2': {
      // 白昼之火：挑战者只能用**冥想骰**挡下述 3 次攻击（每次 6 点）；获得 2 个随机防御骰
      // §19⑨ 多段攻击源：白昼之火
      g.virtualQueue = Array.from({ length: 3 }, (_, j) => ({
        attacker: 'B' as PlayerId, value: 6, label: skill.name, owner: 'B' as PlayerId,
        blockKind: 'meditation' as DiceKind,
        legendGroup: { index: 1, total: 1, sub: j + 1, subTotal: 3 },
      }));
      withRng(g, (rng) => {
        gain('defense', rng.rollDie());
        gain('defense', rng.rollDie());
      });
      logLine(g, `「${legacy}」：${skill.name} — 3 次 6 点攻击（只能用冥想骰抵挡）、获得随机防御骰${legendDefNote(card.defenseCap ?? Number.POSITIVE_INFINITY, spawn, 2)}`);
      pumpAttackQueue(g);
      return { spawn, outIds };
    }
    case 'z10-3': {
      // 陨落：挑战者只能用**攻击骰**挡下述 3 次攻击（每次 6 点）；获得 2 个随机防御骰
      // §19⑨ 多段攻击源：陨落
      g.virtualQueue = Array.from({ length: 3 }, (_, j) => ({
        attacker: 'B' as PlayerId, value: 6, label: skill.name, owner: 'B' as PlayerId,
        blockKind: 'attack' as DiceKind,
        legendGroup: { index: 1, total: 1, sub: j + 1, subTotal: 3 },
      }));
      withRng(g, (rng) => {
        gain('defense', rng.rollDie());
        gain('defense', rng.rollDie());
      });
      logLine(g, `「${legacy}」：${skill.name} — 3 次 6 点攻击（只能用攻击骰抵挡）、获得随机防御骰${legendDefNote(card.defenseCap ?? Number.POSITIVE_INFINITY, spawn, 2)}`);
      pumpAttackQueue(g);
      return { spawn, outIds };
    }
    case 'z10-4': {
      // 涤罪大剑术：回复 10 → 3 次 4 点攻击 → 得 2 随机防御骰 → 若攻击区有骰则用其全部逐个攻击（顺序代决在前置）
      heal(g, 'B', 10);
      withRng(g, (rng) => {
        gain('defense', rng.rollDie());
        gain('defense', rng.rollDie());
      });
      const order = (g.challenge!.decisions?.[skill.id] ?? [])[0];
      const atk = [...B.areas.attack];
      const q: NonNullable<GameState['virtualQueue']> = Array.from({ length: 3 }, (_, j) => ({
        attacker: 'B' as PlayerId, value: 4, label: skill.name, owner: 'B' as PlayerId,
        legendGroup: { index: 1, total: 1, sub: j + 1, subTotal: 3 },
      }));
      if (atk.length > 0) {
        const diceQ = atk.map((d) => ({
          attacker: 'B' as PlayerId, value: d.value, label: skill.name, owner: 'B' as PlayerId,
          dieId: d.id, dieStyle: 'solid' as const,
        }));
        if (order === 'asc') diceQ.sort((a, b) => a.value - b.value);
        else if (order === 'desc') diceQ.sort((a, b) => b.value - a.value);
        const rank = new Map(diceQ.map((x, i) => [x.dieId, i]));
        atk.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
        q.push(...diceQ);
      }
      logLine(g, `「${legacy}」：${skill.name} — 回复 10 点生命、3 次 4 点攻击、获得随机防御骰${legendDefNote(card.defenseCap ?? Number.POSITIVE_INFINITY, spawn, 2)}${atk.length > 0 ? `、用攻击区全部 ${atk.length} 颗骰攻击` : ''}`);
      // §19⑨ 多段攻击源：涤罪大剑术
      g.virtualQueue = q;
      pumpAttackQueue(g);
      return { spawn, outIds };
    }
    case 'z10-5':
      // 救赎：设"下一回合 override"（投 5、攻击 +1）→ 本回合照常结束 → beginTurn → runLegendTurn **重开一整回合**（真回合，T+1）
      g.challenge!.nextTurnOverride = { rollDice: 5, atkBonus: 1 };
      logLine(g, `「${legacy}」：${skill.name} — 再次开始 1 个「${legacy}」的回合（该回合投 5 个驱动骰、攻击伤害 +1）`);
      return { spawn, outIds };
    case 'z11-0':
      return { spawn, outIds }; // 投驱动骰已在回合开始完成
    case 'z11-1': {
      // 低语：将所有**点数不为 5 和 6** 的驱动骰重新投掷 1 次（点数变化 → 通用"骰子翻转"动画）
      withRng(g, (rng) => {
        for (const d of g.challenge!.driven) {
          if (d.value !== 5 && d.value !== 6) d.value = rng.rollDie();
        }
      });
      logLine(g, `「${legacy}」：${skill.name} — 将点数不为 5 和 6 的驱动骰重新投掷 1 次`);
      return { spawn, outIds };
    }
    case 'z11-2': {
      // 死亡亦逝：挑战者生命"抹零"到十位；「受缚邪灵」尽可能回复到十位（≤生命上限）——**非伤害、非真伤**
      const aBefore = A.life;
      if (A.life % 10 !== 0) {
        A.life = Math.floor(A.life / 10) * 10;
        logLine(g, `${pname('A')} 的生命值下降（抹零）${aBefore} → ${A.life}`);
      }
      const bBefore = B.life;
      if (B.life % 10 !== 0) {
        B.life = Math.min(B.lifeMax, Math.ceil(B.life / 10) * 10);
        logLine(g, `「${legacy}」的生命值回复（抹零）${bBefore} → ${B.life}`);
      }
      checkLifeEnd(g);
      const aDrop = aBefore - A.life;
      // 动效旁路：抹零＝非伤害的"生命下降"→ **白墨线**（传奇面板 → 挑战者生命条）、界面**不抖**（drop=true）
      if (aDrop > 0 && g.phase !== 'gameOver') {
        fxTrueLine('B', 'A', aDrop, true);
        noteLifeDrop(g, 'A', aDrop);
      }
      return { spawn, outIds };
    }
    case 'z11-3': {
      // 清算：挑战者弃置 X 个能力骰（X＝计数）；不足则每少 1 个 → 3 点真实伤害；随后"受缚邪灵"计数 −1
      const X = g.challenge!.count;
      const pool = [...A.areas.attack, ...A.areas.defense, ...A.areas.meditation];
      const d = Math.min(X, pool.length);
      const picks = g.challenge!.decisions?.[skill.id] ?? [];
      let ids: string[] = picks[0] ? picks[0].split(',').filter((id) => pool.some((x) => x.id === id)) : [];
      if (ids.length !== d) {
        // 内部兜底（自选模式玩家点完骰片就有选择、走不到这里；仅测试/AI/异常）：与"有利"同序
        ids = qingsuanOrder(pool, g.challenge!.settleMode === 'against').slice(0, d).map((x) => x.id);
      }
      const removedQingsuan: { kind: DiceKind; value: number }[] = [];
      for (const id of ids) {
        for (const kd of KINDS_ORDER) {
          if (A.areas[kd].some((x) => x.id === id)) {
            removedQingsuan.push(...consumeDice(g, A, kd, [id], { byLegend: true }));
            break;
          }
        }
      }
      const shortfall = X - removedQingsuan.length;
      logLine(
        g,
        `「${legacy}」：${skill.name} — 弃置挑战者 ${removedQingsuan.length} 个能力骰（${vals(removedQingsuan)}）${shortfall > 0 ? `，每少 1 个 3 点 → 造成 ${shortfall * 3} 点真实伤害` : ''}`,
      );
      if (shortfall > 0 && g.phase !== 'gameOver') dealTrueDamage(g, 'A', shortfall * 3, 'B');
      g.challenge!.count = Math.max(0, g.challenge!.count - 1);
      logLine(g, `「${skill.name}」：计数 → ${g.challenge!.count}`);
      return { spawn, outIds };
    }
    case 'z11-4': {
      // 血祭：本技能驱骰（全部 5/6）→ 攻击骰区，并使用**所有攻击骰**逐个攻击
      for (const d of consumed) gain('attack', d.value);
      g.challenge!.xueji = true; // 本技能这批攻击期间：每次攻击后计数 +1、造成伤害后自伤（见 combat.afterAttackResolved）
      const atk = [...B.areas.attack];
      // §19⑨ 多段攻击源：血祭
      g.virtualQueue = atk.map((d) => ({
        attacker: 'B' as PlayerId,
        value: d.value,
        label: skill.name,
        owner: 'B' as PlayerId,
        dieId: d.id,
        dieStyle: 'solid' as const,
      }));
      logLine(g, `「${legacy}」：${skill.name} — 移动 ${atk.length} 颗驱动骰至攻击骰区并使用全部攻击骰逐个攻击`);
      pumpAttackQueue(g);
      return { spawn, outIds };
    }
    case 'z11-5': {
      // 永恒女王：补充随机防御骰，直至防御骰数量为 3（满上限时走 legendDefNote 记"已满弃置"）
      const need = Math.max(0, 3 - B.areas.defense.length);
      withRng(g, (rng) => {
        for (let i = 0; i < need; i++) gain('defense', rng.rollDie());
      });
      logLine(g, `「${legacy}」：${skill.name} — 补充随机防御骰至 3${legendDefNote(card.defenseCap ?? Number.POSITIVE_INFINITY, spawn, need)}`);
      return { spawn, outIds };
    }
    case 'z12-0':
      return { spawn, outIds }; // 投驱动骰已在回合开始完成
    case 'z12-1': {
      // 不动菩提：置"封锁点数"——挑战者本回合**无法使用 / 消耗 / 弃置**该点数的能力骰（直到传奇下个回合开始前）
      const tied = z05TiedValues(g);
      if (tied.length === 0) return { spawn, outIds };
      const chosen = (g.challenge!.decisions?.[skill.id] ?? [])[0];
      const v = chosen !== undefined ? Number(chosen) : tied[tied.length - 1]; // 兜底＝点数大者（同 `z05ChongfuX`）
      g.challenge!.lockValue = v;
      logLine(g, `「${legacy}」：${skill.name} — 挑战者本回合无法使用/消耗/弃置 ${v} 点的能力骰`);
      return { spawn, outIds };
    }
    case 'z12-2': {
      // 万象俱灭：弃置挑战者**全部能力骰** → 真伤 ＝ 被弃骰点数总和
      const removedWanxiang: { kind: DiceKind; value: number }[] = [];
      for (const kd of KINDS_ORDER) {
        const ids = A.areas[kd].map((d) => d.id);
        if (ids.length) removedWanxiang.push(...consumeDice(g, A, kd, ids, { byLegend: true }));
      }
      const total = removedWanxiang.reduce((s, d) => s + d.value, 0);
      logLine(g, `「${legacy}」：${skill.name} — 弃置挑战者全部能力骰（${vals(removedWanxiang)}），造成 ${total} 点真实伤害`);
      if (total > 0 && g.phase !== 'gameOver') dealTrueDamage(g, 'A', total, 'B');
      return { spawn, outIds };
    }
    case 'z12-3': {
      // 超度：挑战者"能力骰数量最多的区域"的全部能力骰**重掷**（按新点数回到挑战者对应区域）→ 5 点真实伤害
      // （重掷走统一入口 `doReroll`：联动 027 寒光惩罚；区域**并列最多**时由代决选区域 `decisions[0]`）
      const dec123 = g.challenge!.decisions?.[skill.id] ?? [];
      const busiest = KINDS_ORDER.includes(dec123[0] as DiceKind) ? (dec123[0] as DiceKind) : busiestAreaOfChallenger(g);
      const ids = A.areas[busiest].map((d) => d.id);
      if (ids.length > 0) {
        withRng(g, (rng) => doReroll(g, 'A', ids, rng));
        logLine(g, `「${legacy}」：${skill.name} — 重掷挑战者${KIND_CN[busiest]}骰区全部 ${ids.length} 颗，并按新点数落区`);
      } else {
        logLine(g, `「${legacy}」：${skill.name} — 挑战者${KIND_CN[busiest]}骰区没有能力骰，无需重掷`);
      }
      if (g.phase !== 'gameOver') {
        logLine(g, `「${legacy}」：${skill.name} — 造成 5 点真实伤害`);
        dealTrueDamage(g, 'A', 5, 'B');
      }
      return { spawn, outIds };
    }
    case 'z12-4': {
      // 破障：5 次 4 点攻击；若攻击骰区有骰，也用其全部逐个攻击（顺序代决前置，同 Z10「涤罪大剑术」）
      const order = (g.challenge!.decisions?.[skill.id] ?? [])[0];
      const atk = [...B.areas.attack];
      const q: NonNullable<GameState['virtualQueue']> = Array.from({ length: 5 }, (_, j) => ({
        attacker: 'B' as PlayerId,
        value: 4,
        label: skill.name,
        owner: 'B' as PlayerId,
        legendGroup: { index: 1, total: 1, sub: j + 1, subTotal: 5 },
      }));
      if (atk.length > 0) {
        const diceQ = atk.map((d) => ({
          attacker: 'B' as PlayerId,
          value: d.value,
          label: skill.name,
          owner: 'B' as PlayerId,
          dieId: d.id,
          dieStyle: 'solid' as const,
        }));
        if (order === 'asc') diceQ.sort((a, b) => a.value - b.value);
        else if (order === 'desc') diceQ.sort((a, b) => b.value - a.value);
        const rank = new Map(diceQ.map((x, i) => [x.dieId, i]));
        atk.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
        q.push(...diceQ);
      }
      logLine(g, `「${legacy}」：${skill.name} — 5 次 4 点攻击${atk.length > 0 ? `、并用攻击区全部 ${atk.length} 颗骰逐个攻击` : ''}`);
      // §19⑨ 多段攻击源：破障
      g.virtualQueue = q;
      pumpAttackQueue(g);
      return { spawn, outIds };
    }
    case 'z12-5': {
      // 万丈明光：补充随机防御骰直至为 3（满上限走 legendDefNote）；「渡世行僧」回复 3 点生命
      const need = Math.max(0, 3 - B.areas.defense.length);
      withRng(g, (rng) => {
        for (let i = 0; i < need; i++) gain('defense', rng.rollDie());
      });
      const healed = heal(g, 'B', 3);
      logLine(g, `「${legacy}」：${skill.name} — 补充随机防御骰至 3${legendDefNote(card.defenseCap ?? Number.POSITIVE_INFINITY, spawn, need)}；回复 ${healed} 点生命`);
      return { spawn, outIds };
    }
    default:
      return { spawn, outIds };
  }
}

/**
 * 传奇的一个回合（说明书 page_15–16）：投驱动骰 → 按箭头逐条检查 → 全部查完 / 遇 `endsTurn` 即结束。
 * 不遵循常规阶段；**不存在尘落**；它的一切抉择由挑战者代决（模式 1，2d 接）。
 */
function runLegendTurn(g: GameState): void {
  const card = CHALLENGES.find((c) => c.id === g.challenge?.cardId);
  if (!g.challenge || !card || !card.skills) {
    endTurn(g); // 兜底：数据缺失也必须把回合交还，绝不卡死
    return;
  }
  g.phase = 'main'; // 传奇无阶段概念；仅作占位（回合内同步跑完）
  g.rerollUsed = 0;
  g.dustRiseNormalCount = 0;
  g.dustRiseActed = false;
  g.challenge.firedThisTurn = []; // Z03「拔城」：每回合清"本回合已发动"标记
  g.challenge.mingjieHeal = false; // Z06「冥界行走」：每回合清"本回合攻击回血"标记
  g.challenge.hengguan = false; // Z09「横贯」：每回合清"抵挡后必弃骰"标记
  g.challenge.xueji = false; // Z11「血祭」：每回合清"本技能这批攻击"标记（正常在该批队列走空时清，这里兜底）
  g.challenge.lockValue = undefined; // Z12「不动菩提」：每回合清（＝"封锁直到传奇下个回合开始前"）
  // 传奇的"自己的回合"计数（与普通玩家同口径：它每进行一个回合 +1）——供 T16「潜伏」第二回合 +1 / T05 等判定
  g.players.B.turnsTaken = Math.min(4, g.players.B.turnsTaken + 1);
  g.challenge.deathJustTriggered = false; // Z06「死即新生」：绿色"刚触发"只在触发帧
  const legacy = card.legacy;
  // Z10「救赎」：读取"下一回合 override"（本回合投 N 驱动骰 + 攻击加成）——**消费后清空**
  const ov = g.challenge.nextTurnOverride;
  g.challenge.nextTurnOverride = undefined;
  if (ov?.atkBonus) {
    g.players.B.buffs.push({ attr: 'attackDamage', add: ov.atkBonus, duration: 'thisTurn', source: '救赎' });
    logLine(g, `「${legacy}」：救赎 — 本回合攻击伤害 +${ov.atkBonus}`);
  }
  const baseN = ov?.rollDice ?? card.rollDice ?? 0;
  logLine(g, `——「${legacy}」的回合——`);
  logLine(g, `「${legacy}」：回合开始`);
  // Z05「绝境天神」：上个挑战者的回合受过伤 → 额外投掷驱动骰（8+2=10）
  const extra = card.rollDiceBonusOnDamage && g.challenge.damagedDuringChallengerTurn ? card.rollDiceBonusOnDamage : 0;
  rollDrivenDice(g, baseN + extra);
  g.challenge.damagedDuringChallengerTurn = false; // 只认"上一个挑战者回合"，用掉即清
  if (extra > 0) {
    // 额外那几颗＝刚追加到队尾的（取尾部 extra 颗 —— **别排序**，否则会与基础骰混在一起）
    const extraRolled = g.challenge.driven
      .slice(-extra)
      .map((d) => d.value)
      .sort((a, b) => a - b)
      .join('/');
    logLine(g, `「${legacy}」：上个挑战者的回合受到过伤害 → 额外投掷 ${extra} 个驱动骰（${extraRolled}）`);
    // 弹技能名（＝发动帧）：让玩家知道此刻「绝境天神」生效、驱动骰变成 8+2
    const jj = (card.skills ?? []).find((s) => s.id === 'z05-1');
    fxPush({
      kind: 'legendSkill',
      player: 'B',
      skillKey: jj?.id ?? 'z05-1',
      skillName: jj?.name ?? '绝境天神',
      consumed: [],
      spawn: [],
      outIds: [],
      attack: false,
      announce: true,
    });
  }
  const rolled = [...g.challenge.driven]
    .map((d) => d.value)
    .sort((a, b) => a - b)
    .join('/');
  logLine(g, `「${legacy}」：投掷 ${baseN + extra} 个驱动骰（${rolled}）`);
  // 投完即"停一下"：骰子落在**临时驱动骰区域**（driven），由界面按节奏派发 challengeStep 逐条结算
  g.challenge.slot = [];
  g.challenge.activeSkill = 0; // 高亮「回合开始」
  g.challenge.resumeAt = 1; // 下一条从技能 1 开始
  // Z04「D1：开局选骰」——投完骰、逐条结算前，若"分配对战局有较大影响"则由挑战者一次选好
  g.challenge.assign = undefined;
  const assignPlanner = legendAssignNeeded(g);
  if (assignPlanner) {
    const mode = g.challenge.settleMode;
    if (mode && mode !== 'manual') {
      g.challenge.assign = assignBySkill(legendAssignAuto(assignPlanner, mode));
    } else {
      g.pending = {
        kind: 'challengePick',
        player: 'A',
        tag: 'assign',
        prompt:
          '检测到「梦醒时分」「顿悟」的驱动骰分配有 1 种以上选择，请代决。（会影响后续「无上剑术」打进攻击区的点数）',
        options: assignPlanner.map((p) => ({ id: assignOptId(p), label: assignOptLabel(p) })),
      };
    }
  }
}

/**
 * 收尾"延后一步"的效果（**按卡面顺序**：例「暗夜凶神」＝①8点攻击 →（攻击结算后）②弃挑战者1防御骰 →③计数+1）。
 * 只在攻击已结算完、回到传奇回合时执行；遇到"②的代决"就挂起等待。
 */
export function resolveLegendDeferred(g: GameState, card: ChallengeCard): void {
  const d = g.challenge?.deferred;
  if (!g.challenge || !d) return;
  const skill = (card.skills ?? []).find((s) => s.id === d.skillId);
  if (!skill) {
    g.challenge.deferred = undefined;
    return;
  }
  const A = g.players.A;
  if (skill.id === 'z02-3') {
    // ② 弃挑战者 1 颗防御骰（弃哪颗＝代决，模式 1；**攻击结算之后**才问）
    const wants = challengeDecisions(g, skill, true);
    const dec = (g.challenge.decisions ??= {});
    const got = dec[skill.id] ?? [];
    if (wants.length > got.length) {
      const mode = g.challenge.settleMode;
      if (mode && mode !== 'manual') {
        // 自动结算（有利/不利）：替昔传选齐，不弹面板
        const arr = dec[skill.id] ?? [];
        for (let k = got.length; k < wants.length; k++) {
          const id = autoPick(wants[k], mode);
          if (id) arr.push(id);
        }
        dec[skill.id] = arr;
      } else {
        const w = wants[got.length];
        // 让代决归到**这条技能**（challengePick 按 activeSkill 存选择）
        g.challenge.activeSkill = (card.skills ?? []).indexOf(skill);
        g.pending = { kind: 'challengePick', player: 'A', prompt: w.prompt, options: w.options, pick: w.pick };
        return; // 停在代决
      }
    }
    const dropId = (dec[skill.id] ?? [])[0] ?? A.areas.defense[0]?.id;
    const dropped = dropId ? consumeDice(g, A, 'defense', [dropId], { byLegend: true }) : [];
    delete dec[skill.id];
    // ③ 计数 +1（≤ 上限），并同步「锋芒」加成
    const cap = card.countCap ?? Number.POSITIVE_INFINITY;
    g.challenge.count = Math.min(cap, g.challenge.count + 1);
    syncLegendFengmang(g);
    logLine(g, `「${card.legacy}」：${skill.name} — 弃置挑战者 1 个防御骰（${dropped.length > 0 ? vals(dropped) : '—'}），计数 +1`);
    g.challenge.deferred = undefined;
    return;
  }
  if (skill.id === 'z01-5' || skill.id === 'z02-4' || skill.id === 'z04-4') {
    // 裁雨流 / 枭首 / 无上剑术：骰子**已移入攻击骰区**（`applyChallengeSkill` 做的）→ 此刻才问"攻击顺序"、再逐个攻击。
    const atk = g.players.B.areas.attack;
    // 枭首 / 无上剑术：只有"攻击骰数 > 挑战者防御骰数"才真的攻击（否则本技能只移入、不打，也不问顺序）
    if ((skill.id === 'z02-4' || skill.id === 'z04-4') && atk.length <= A.areas.defense.length) {
      g.challenge.deferred = undefined;
      return;
    }
    if (atk.length === 0) {
      g.challenge.deferred = undefined;
      return;
    }
    const dec = (g.challenge.decisions ??= {});
    const orderOpts = [
      { id: 'asc', label: '由小到大' },
      { id: 'desc', label: '由大到小' },
    ];
    if (atk.length > 1 && !(dec[skill.id] ?? [])[0]) {
      const mode = g.challenge.settleMode;
      if (mode && mode !== 'manual') {
        // 自动结算（有利/不利）：favor→desc、against→asc（与 `autoPick` 口径一致）
        dec[skill.id] = [autoPick({ options: orderOpts, prefer: 'desc' }, mode)!];
      } else {
        g.challenge.activeSkill = (card.skills ?? []).indexOf(skill);
        g.pending = {
          kind: 'challengePick',
          player: 'A',
          prompt: `「${skill.name}」：用全部攻击骰逐个攻击，按什么顺序？`,
          options: orderOpts,
        };
        return; // 停在代决
      }
    }
    const order = (dec[skill.id] ?? [])[0];
    delete dec[skill.id];
    // 骰子**留在攻击骰区**：队列条目带 dieId/dieStyle，轮到它时才从区里飞出并消耗（界面演"逐颗飞出攻击"）
    // §19⑨ 多段攻击源：裁雨流 / 枭首 / 无上剑术
    g.virtualQueue = atk.map((x) => ({
      attacker: 'B' as PlayerId,
      value: x.value,
      label: skill.name,
      owner: 'B' as PlayerId,
      dieId: x.id,
      dieStyle: 'solid' as const,
    }));
    if (order === 'asc') g.virtualQueue.sort((a, b) => a.value - b.value);
    else if (order === 'desc') g.virtualQueue.sort((a, b) => b.value - a.value);
    // 区里的**排列也按同一顺序重排** → "最左边那颗先飞出去"，观感不错位
    const rank = new Map(g.virtualQueue.map((q, i) => [q.dieId, i]));
    atk.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    g.challenge.deferred = undefined;
    pumpAttackQueue(g);
    return;
  }
  if (skill.id === 'z01-3') {
    // 龙腾万丈：把"最大/最小之外的**中间 2 颗**"移入防御骰区；放不下时由挑战者代决"哪颗进"。
    const spawn = placeDefenseFrom(g, card, skill, d.dice ?? []);
    if (spawn === null) return; // 停在代决（challengePick）
    logLine(g, `「${card.legacy}」：${skill.name} — 移入防御骰区${legendDefNote(card.defenseCap ?? Number.POSITIVE_INFINITY, spawn, (d.dice ?? []).length)}`);
    delete (g.challenge.decisions ?? {})[skill.id];
    g.challenge.deferred = undefined;
    fxPush({
      kind: 'legendSkill',
      player: 'B',
      skillKey: skill.id,
      skillName: skill.name,
      consumed: [],
      spawn,
      outIds: [],
      attack: false,
      announce: false, // 移骰步 ≠ 发动帧 → 不重复弹技能名
    });
    return;
  }
  if (skill.id === 'z03-4') {
    // 战车 ③（攻击结算后）：**补充随机点数的防御骰，直至防御骰的数量为 4**（卡面原文；作者裁定 2026-10-11）
    //   —— 防御骰区**已有 4 颗（或更多）则不再补充**；补 1 颗 → 孤塔之王受 **2 点真实伤害**（补 0 → 0 伤）。
    const TARGET_DEF = 4;
    const toAdd = Math.max(0, TARGET_DEF - g.players.B.areas.defense.length);
    const spawn: { id: string; value: number; area: 'attack' | 'defense' | 'meditation' }[] = [];
    let added = 0;
    withRng(g, (rng) => {
      for (let i = 0; i < toAdd; i++) {
        const v = rng.rollDie();
        const die = createDie(newDieId('chg-B-'), v, 'defense');
        if (!addLegendDefense(g, die)) break; // Z03 无上限，理论必成
        spawn.push({ id: die.id, value: v, area: 'defense' });
        added += 1;
      }
    });
    if (added > 0) {
      dealTrueDamage(g, 'B', added * 2, 'B');
      logLine(g, `「${card.legacy}」：${skill.name} — 补充 ${added} 个防御骰（补至 4：${valsSorted(spawn)}），受到 ${added * 2} 点真实伤害`);
    } else {
      logLine(g, `「${card.legacy}」：${skill.name} — 防御骰已有 ${g.players.B.areas.defense.length} 个（≥ 4），不再补充`);
    }
    g.challenge.deferred = undefined;
    fxPush({
      kind: 'legendSkill',
      player: 'B',
      skillKey: skill.id,
      skillName: skill.name,
      consumed: [],
      spawn,
      outIds: [],
      attack: false,
      announce: false,
    });
    return;
  }
  if (skill.id === 'z07-4') {
    // 蛮王之牙「如有可能则再次发动」——**逐组、组间等攻击结算**。每轮拆成**两拍**（`deferred.step`）：
    //   · step 0（本轮效果）：① 弃 3 代决（>3 颗才弹）→ ② 弃骰 → ③ 缺额补 3 点攻击 → 转 step 1
    //   · step 1（本轮攻击**已结算**后）：若驱动骰还能凑组 → **这时才消耗该组** + 弹技能名 → 转回 step 0
    // ⚠️ 「消耗下一组」必须放在 step 1（本轮攻击之后）。放在同一拍会变成"先把两组驱骰都收走、再一口气 6 次攻击"
    //    —— 真实事故 2026-10-11（用户实测：两组骰子一起进槽、6 次攻击连在一起）。
    const slot = skill.slots![0];
    const dec = (g.challenge.decisions ??= {});
    if (d.step === 1) {
      const groups = allSameGroups(slot, g.challenge.driven);
      if (groups.length === 0) {
        g.challenge.deferred = undefined; // 凑不出下一组 → 结束
        return;
      }
      // 这一拍只演"弹技能名 + 该组驱骰进槽"；本轮的弃骰/攻击留到下一拍（step 0）
      const grpDice = groups[0].dice.map((x) => ({ id: x.id, value: x.value }));
      const grpIds = new Set(groups[0].dice.map((x) => x.id));
      g.challenge.driven = g.challenge.driven.filter((x) => !grpIds.has(x.id));
      d.step = 0;
      logLine(g, `「${card.legacy}」：${skill.name} — 清空本技能上的驱动骰，如有可能则再次发动`);
      fxLegendSkill(g, skill.id, { consumed: grpDice });
      return;
    }
    // ── step 0：本轮效果 ──
    const def = g.players.A.areas.defense;
    if (def.length > 3 && !(dec[skill.id] ?? [])[0]) {
      const mode = g.challenge.settleMode;
      const combos = combinations(def.length, 3);
      const opts = combos.map((c) => ({
        id: c.map((i) => def[i].id).join(','),
        label: c.map((i) => `防${def[i].value}`).join('、'),
      }));
      if (mode && mode !== 'manual') {
        dec[skill.id] = [autoPick({ options: opts, prefer: 'smaller' }, mode)!];
      } else {
        g.challenge.activeSkill = (card.skills ?? []).indexOf(skill);
        g.pending = {
          kind: 'challengePick',
          player: 'A',
          prompt: `「${skill.name}」：弃置挑战者 3 个防御骰`,
          options: opts,
          // 骰片选择（界面用池子渲染；id 仍在确认时拼成逗号串）
          pick: { pool: def.map((d2) => ({ id: d2.id, value: d2.value, kind: 'defense' as const })), n: 3 },
        };
        return; // 停在代决
      }
    }
    const chosen = (dec[skill.id] ?? [])[0];
    const ids = chosen
      ? chosen.split(',')
      : pickComboIds(g, def, Math.min(3, def.length), g.challenge.settleMode === 'against' ? 'larger' : 'smaller');
    if (ids.length > 0) consumeDice(g, A, 'defense', ids, { byLegend: true });
    delete dec[skill.id];
    const short = 3 - ids.length;
    logLine(g, `「${card.legacy}」：${skill.name} — 本轮弃挑战者 ${ids.length} 个防御骰${short > 0 ? `，补 ${short} 次 3 点攻击` : ''}`);
    d.step = 1; // 本轮效果已发生 → 等这几次攻击结算完，下一次再判断"如有可能则再次发动"
    if (short > 0) {
      // §19⑨ 多段攻击源：蛮王之牙
      g.virtualQueue = Array.from({ length: short }, () => ({
        attacker: 'B' as PlayerId, value: 3, label: skill.name, owner: 'B' as PlayerId,
      }));
      pumpAttackQueue(g);
      return;
    }
    return;
  }
  if (skill.id === 'z07-5') {
    // 尘起：① 剩余驱动骰 → 防御骰区（先播移动动画）→ ② 攻击骰区有骰则问顺序 → ③ 逐个攻击
    if (!d.moved) {
      const spawn = placeDefenseFrom(g, card, skill, d.dice ?? []);
      if (spawn === null) return; // 停在代决
      d.moved = true;
      delete (g.challenge.decisions ?? {})[skill.id];
      logLine(g, `「${card.legacy}」：${skill.name} — 移入防御骰区${legendDefNote(card.defenseCap ?? Number.POSITIVE_INFINITY, spawn, (d.dice ?? []).length)}`);
      fxPush({
        kind: 'legendSkill', player: 'B', skillKey: skill.id, skillName: skill.name,
        consumed: [], spawn, outIds: [], attack: g.players.B.areas.attack.length > 0, announce: false,
      });
      return;
    }
    const atk = g.players.B.areas.attack;
    if (atk.length === 0) {
      g.challenge.deferred = undefined;
      return;
    }
    const dec = (g.challenge.decisions ??= {});
    const orderOpts = [
      { id: 'asc', label: '由小到大' },
      { id: 'desc', label: '由大到小' },
    ];
    if (atk.length > 1 && !(dec[skill.id] ?? [])[0]) {
      const mode = g.challenge.settleMode;
      if (mode && mode !== 'manual') {
        dec[skill.id] = [autoPick({ options: orderOpts, prefer: 'desc' }, mode)!];
      } else {
        g.challenge.activeSkill = (card.skills ?? []).indexOf(skill);
        g.pending = {
          kind: 'challengePick',
          player: 'A',
          prompt: `「${skill.name}」：用全部攻击骰逐个攻击，按什么顺序？`,
          options: orderOpts,
        };
        return;
      }
    }
    const order = (dec[skill.id] ?? [])[0];
    delete dec[skill.id];
    // §19⑨ 多段攻击源：尘起
    g.virtualQueue = atk.map((x) => ({
      attacker: 'B' as PlayerId, value: x.value, label: skill.name, owner: 'B' as PlayerId,
      dieId: x.id, dieStyle: 'solid' as const,
    }));
    if (order === 'asc') g.virtualQueue.sort((a, b) => a.value - b.value);
    else if (order === 'desc') g.virtualQueue.sort((a, b) => b.value - a.value);
    const rank = new Map(g.virtualQueue.map((q, i) => [q.dieId, i]));
    atk.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    g.challenge.deferred = undefined;
    pumpAttackQueue(g);
    return;
  }
  if (skill.id === 'z06-3' || skill.id === 'z06-5') {
    // 勾魂镰 / 圆舞：① 本技能驱骰 → 防御骰区（受上限 4；放不下挑战者代决）→ ② 其余驱骰 → 攻击骰区 → 全部攻击
    if (!d.moved) {
      const spawn = placeDefenseFrom(g, card, skill, d.dice ?? []);
      if (spawn === null) return; // 停在代决（challengePick）
      d.moved = true;
      logLine(g, `「${card.legacy}」：${skill.name} — 移入防御骰区${legendDefNote(card.defenseCap ?? Number.POSITIVE_INFINITY, spawn, (d.dice ?? []).length)}`);
      delete (g.challenge.decisions ?? {})[skill.id];
      fxPush({
        kind: 'legendSkill', player: 'B', skillKey: skill.id, skillName: skill.name,
        consumed: [], spawn, outIds: [], attack: false, announce: false,
      });
      return;
    }
    // ②a 其余驱动骰 → 攻击骰区（先播"移入"动画）
    if (d.step < 1) {
      const rest = g.challenge.driven;
      g.challenge.driven = [];
      const spawn2: { id: string; value: number; area: 'attack' | 'defense' | 'meditation' }[] = [];
      for (const dd of rest) {
        const die = createDie(newDieId('chg-B-'), dd.value, 'attack');
        g.players.B.areas.attack.push(die);
        spawn2.push({ id: die.id, value: dd.value, area: 'attack' });
      }
      d.step = 1;
      logLine(g, `「${card.legacy}」：${skill.name} — 其余驱动骰移入攻击骰区（${spawn2.length} 颗）`);
      fxPush({
        kind: 'legendSkill', player: 'B', skillKey: skill.id, skillName: skill.name,
        consumed: [], spawn: spawn2, outIds: [], attack: g.players.B.areas.attack.length > 0, announce: false,
      });
      return;
    }
    // ②b 攻击顺序代决（>1 颗才问；自动 favor→desc、against→asc）→ ②c 逐个攻击
    const atk = g.players.B.areas.attack;
    if (atk.length === 0) {
      g.challenge.deferred = undefined;
      return;
    }
    const dec = (g.challenge.decisions ??= {});
    const orderOpts = [
      { id: 'asc', label: '由小到大' },
      { id: 'desc', label: '由大到小' },
    ];
    if (atk.length > 1 && !(dec[skill.id] ?? [])[0]) {
      const mode = g.challenge.settleMode;
      if (mode && mode !== 'manual') {
        dec[skill.id] = [autoPick({ options: orderOpts, prefer: 'desc' }, mode)!];
      } else {
        g.challenge.activeSkill = (card.skills ?? []).indexOf(skill);
        g.pending = {
          kind: 'challengePick',
          player: 'A',
          prompt: `「${skill.name}」：用全部攻击骰逐个攻击，按什么顺序？`,
          options: orderOpts,
        };
        return; // 停在代决
      }
    }
    const order = (dec[skill.id] ?? [])[0];
    delete dec[skill.id];
    // §19⑨ 多段攻击源：勾魂镰 / 圆舞
    g.virtualQueue = atk.map((x) => ({
      attacker: 'B' as PlayerId, value: x.value, label: skill.name, owner: 'B' as PlayerId,
      dieId: x.id, dieStyle: 'solid' as const,
    }));
    if (order === 'asc') g.virtualQueue.sort((a, b) => a.value - b.value);
    else if (order === 'desc') g.virtualQueue.sort((a, b) => b.value - a.value);
    const rank = new Map(g.virtualQueue.map((q, i) => [q.dieId, i]));
    atk.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    g.challenge.deferred = undefined;
    pumpAttackQueue(g);
    return;
  }
  if (skill.id === 'z05-5') {
    // 净化（延后一步）：把本技能上的驱动骰移入防御骰区（上限 4；放不下时挑战者代决"哪颗进"）
    const spawn = placeDefenseFrom(g, card, skill, d.dice ?? []);
    if (spawn === null) return; // 停在代决（challengePick）
    logLine(g, `「${card.legacy}」：${skill.name} — 移入防御骰区${legendDefNote(card.defenseCap ?? Number.POSITIVE_INFINITY, spawn, (d.dice ?? []).length)}`);
    delete (g.challenge.decisions ?? {})[skill.id];
    g.challenge.deferred = undefined;
    fxPush({
      kind: 'legendSkill',
      player: 'B',
      skillKey: skill.id,
      skillName: skill.name,
      consumed: [],
      spawn,
      outIds: [],
      attack: false,
      announce: false,
    });
    return;
  }
  if (skill.id === 'z02-5') {
    // 遁入暗影：① 先"移入防御骰区"（只做一次；放不下时挑战者**任选 room 颗**）→ ② 再逐组发起 2 点攻击。
    const groups = d.groups ?? [];
    if (!d.moved) {
      const spawn = placeDefenseFrom(g, card, skill, d.dice ?? []);
      if (spawn === null) return; // 停在代决（challengePick）
      logLine(g, `「${card.legacy}」：${skill.name} — 移入防御骰区${legendDefNote(card.defenseCap ?? Number.POSITIVE_INFINITY, spawn, (d.dice ?? []).length)}`);
      d.moved = true;
      delete (g.challenge.decisions ?? {})[skill.id];
      // 动效旁路：本步移入的骰（`spawn`）；`attack`＝移入之后逐个攻击（界面把攻击动画后移到"移入"之后）
      fxPush({
        kind: 'legendSkill',
        player: 'B',
        skillKey: skill.id,
        skillName: skill.name,
        consumed: [],
        spawn,
        outIds: [],
        attack: groups.length > 0,
        announce: false, // 遁入的移骰步 ≠ 发动帧 → 不重复弹技能名
      });
      return;
    }
    // ② 逐组 2 点攻击（带序号/总数供提示栏显示「（第 K / N 次）」）
    if (d.step >= groups.length) {
      g.challenge.deferred = undefined;
      return;
    }
    d.step += 1;
    virtualAttack(g, 'B', 2, { skill: '遁入暗影', owner: 'B' });
    if (g.pendingAttack) g.pendingAttack.legendGroup = { index: d.step, total: groups.length };
    if (d.step >= groups.length) g.challenge.deferred = undefined;
    return;
  }
  if (skill.id === 'z08-2') {
    // 凶弹业舞 ②：挑战者**所有攻击骰** → 黑枪防御骰区（受上限 4；放不下时挑战者代决"哪几颗进"）。
    const dice = d.dice ?? [];
    if (dice.length === 0) {
      g.challenge.deferred = undefined;
      return;
    }
    const spawn = placeDefenseFrom(g, card, skill, dice);
    if (spawn === null) return; // 停在代决（challengePick）
    // 挑战者的这些攻击骰**全部离开**其攻击骰区（放不进防御区的部分＝弃置）
    const ids = dice.map((x) => x.id).filter((id) => g.players.A.areas.attack.some((dd) => dd.id === id));
    if (ids.length > 0) consumeDice(g, g.players.A, 'attack', ids, { byLegend: true });
    logLine(g, `「${card.legacy}」：${skill.name} — 挑战者攻击骰移入防御骰区${legendDefNote(card.defenseCap ?? Number.POSITIVE_INFINITY, spawn, (d.dice ?? []).length)}`);
    delete (g.challenge.decisions ?? {})[skill.id];
    g.challenge.deferred = undefined;
    fxPush({
      kind: 'legendSkill',
      player: 'B',
      skillKey: skill.id,
      skillName: skill.name,
      consumed: [],
      spawn,
      outIds: [],
      attack: false,
      announce: false,
    });
    return;
  }
  if (skill.id === 'z08-3') {
    // 共振·弃置分支：双方各弃 2 个防御骰（挑战者代决"弃哪几颗"；step 0＝黑枪侧、step 1＝挑战者侧）。
    const dec = (g.challenge.decisions ??= {});
    const removedAll: { kind: DiceKind; value: number }[] = [];
    const doDiscard = (who: PlayerId, prefer: 'larger' | 'smaller'): boolean => {
      const pool = g.players[who].areas.defense;
      if (pool.length === 0) return true;
      if (pool.length <= 2) {
        removedAll.push(...consumeDice(g, g.players[who], 'defense', pool.map((x) => x.id), { byLegend: true }));
        return true;
      }
      const key = `${skill.id}:${who}`;
      const chosen = (dec[key] ?? [])[0];
      if (chosen) {
        removedAll.push(...consumeDice(g, g.players[who], 'defense', chosen.split(','), { byLegend: true }));
        return true;
      }
      const opts = combinations(pool.length, 2).map((c) => ({
        id: c.map((i) => pool[i].id).join(','),
        label: c.map((i) => `防${pool[i].value}`).join('、'),
      }));
      const mode = g.challenge!.settleMode;
      if (mode && mode !== 'manual') {
        const id = autoPick({ options: opts, prefer }, mode)!;
        dec[key] = [id];
        removedAll.push(...consumeDice(g, g.players[who], 'defense', id.split(','), { byLegend: true }));
        return true;
      }
      g.challenge!.activeSkill = (card.skills ?? []).indexOf(skill);
      g.pending = {
        kind: 'challengePick',
        player: 'A',
        prompt: `「${skill.name}」：弃置${who === 'B' ? '「黑枪」' : '自己'}哪 2 个防御骰？`,
        options: opts,
        key,
        pick: { pool: pool.map((x) => ({ id: x.id, value: x.value, kind: 'defense' as const })), n: 2, owner: who },
      };
      return false;
    };
    if (d.step === 0) {
      if (!doDiscard('B', 'larger')) return; // 有利＝弃黑枪的"大"防御骰（削它防御）
      d.step = 1;
    }
    if (d.step === 1) {
      if (!doDiscard('A', 'smaller')) return; // 有利＝弃自己的"小"防御骰（保自己大牌）
      delete dec[`${skill.id}:B`];
      delete dec[`${skill.id}:A`];
      g.challenge.deferred = undefined;
      logLine(g, `「${card.legacy}」：${skill.name} — 双方各弃置 2 个防御骰（${vals(removedAll)}）`);
    }
    return;
  }
  if (skill.id === 'z08-5') {
    // 蛇蝎之泪：本技能驱动骰（3/4 点）全部 → 防御骰区（受上限 4；放不下时挑战者代决"哪几颗进"）
    const spawn = placeDefenseFrom(g, card, skill, d.dice ?? []);
    if (spawn === null) return; // 停在代决（challengePick）
    logLine(g, `「${card.legacy}」：${skill.name} — 移入防御骰区${legendDefNote(card.defenseCap ?? Number.POSITIVE_INFINITY, spawn, (d.dice ?? []).length)}`);
    delete (g.challenge.decisions ?? {})[skill.id];
    g.challenge.deferred = undefined;
    fxPush({
      kind: 'legendSkill',
      player: 'B',
      skillKey: skill.id,
      skillName: skill.name,
      consumed: [],
      spawn,
      outIds: [],
      attack: false,
      announce: false,
    });
    return;
  }
  if (skill.id === 'z09-2' || skill.id === 'z09-5') {
    // 战鬼的残杀（攻击区+防御区全部骰）/ 横贯（攻击区全部骰）：逐个攻击——>1 颗才问顺序（先移骰、再问）
    const Bp = g.players.B;
    const pool = skill.id === 'z09-2' ? [...Bp.areas.attack, ...Bp.areas.defense] : [...Bp.areas.attack];
    if (pool.length === 0) {
      g.challenge.deferred = undefined;
      return;
    }
    const dec = (g.challenge.decisions ??= {});
    const orderOpts = [
      { id: 'asc', label: '由小到大' },
      { id: 'desc', label: '由大到小' },
    ];
    if (pool.length > 1 && !(dec[skill.id] ?? [])[0]) {
      const mode = g.challenge.settleMode;
      if (mode && mode !== 'manual') {
        dec[skill.id] = [autoPick({ options: orderOpts, prefer: 'desc' }, mode)!];
      } else {
        g.challenge.activeSkill = (card.skills ?? []).indexOf(skill);
        g.pending = {
          kind: 'challengePick',
          player: 'A',
          prompt: `「${skill.name}」：用全部${skill.id === 'z09-2' ? '能力' : '攻击'}骰逐个攻击，按什么顺序？`,
          options: orderOpts,
        };
        return; // 停在代决
      }
    }
    const order = (dec[skill.id] ?? [])[0];
    delete dec[skill.id];
    // §19⑨ 多段攻击源：战鬼的残杀 / 横贯
    g.virtualQueue = pool.map((x) => ({
      attacker: 'B' as PlayerId,
      value: x.value,
      label: skill.name,
      owner: 'B' as PlayerId,
      dieId: x.id,
      dieStyle: 'solid' as const,
    }));
    if (order === 'asc') g.virtualQueue.sort((a, b) => a.value - b.value);
    else if (order === 'desc') g.virtualQueue.sort((a, b) => b.value - a.value);
    g.challenge.deferred = undefined;
    pumpAttackQueue(g);
    return;
  }
  g.challenge.deferred = undefined;
}

/**
 * 从 `g.challenge.resumeAt` 继续逐条结算；遇"发起攻击/代决"就记下续跑点并返回。
 * `once = true`（界面按节奏派发 `challengeStep`）→ **只结算"一条真正要执行的技能"**就返回，让每条都看得见。
 *
 * **顺序＝卡面文字顺序**；每条技能固定前缀：①（界面）弹技能名 ② 驱动骰：临时区 → 驱动骰槽 → 消失
 * → ③ 再按卡面逐步执行（该步的代决在**它该发生的那一步**才弹）。
 */
function continueLegendTurn(g: GameState, once = false): void {
  const card = CHALLENGES.find((c) => c.id === g.challenge?.cardId);
  if (!g.challenge || !card || !card.skills) {
    endTurn(g);
    return;
  }
  const legacy = card.legacy;
  // 「延后一步」先收尾（例：暗夜凶神＝攻击结算后 弃骰 + 计数）
  if (g.challenge.deferred) {
    resolveLegendDeferred(g, card);
    return; // 本步只做这一件事；下一次 challengeStep 再继续
  }
  g.challenge.resumeAt = g.challenge.resumeAt ?? 0;
  for (let i = g.challenge.resumeAt; i < card.skills.length; i++) {
    if (g.pendingAttack) return; // 正在等挑战者响应
    const skill: ChallengeSkill = card.skills[i];
    // Z06「死即新生」：由独立钩子（生命归 0）触发，**不占顺序步**
    if (skill.unordered) continue;
    // Z06「漆黑死神」：技能带 `color` → 只有指示物当前面与之相同时才发动
    if (skill.color && skill.color !== (g.challenge.token ?? 'black')) {
      logLine(g, `「${legacy}」：${skill.name} — 指示物为「${g.challenge.token === 'black' ? '黑' : '白'}」面，不发动`);
      continue;
    }
    // 纯被动（如「锋芒」＝按计数加伤害）：**不占"逐条结算"的步**，内部同步即可
    if (skill.passive) {
      applyChallengeSkill(g, card, skill, []);
      continue;
    }
    if (skill.marker === '怜悯*' && g.challenge.turn === 0) {
      logLine(g, `「${legacy}」：${skill.name} — 首次回合（怜悯*），跳过`);
      continue;
    }
    // ∞（无骰条件）技能：先做"发动检查"——本步若不会产生效果 → 跳过（不弹技能名、不占一步）
    if (!legendSkillWillFire(g, skill)) {
      logLine(g, `「${legacy}」：${skill.name} — 无效果（条件不满足），跳过`);
      continue;
    }
    // 本条消耗的驱动骰：代决暂停期间**已扣下并记住** → 续跑时直接取回（不重算槽匹配，否则骰子已不在 driven 里）
    const resuming = g.challenge.pendingSkillId === skill.id && !!g.challenge.pendingConsumed;
    let consumed: Die[] = [];
    if (resuming) {
      consumed = g.challenge.pendingConsumed!.map((x) => ({ id: x.id, value: x.value, kind: 'meditation' }));
    } else if (skill.slots && skill.slots.length > 0) {
      // 「相同」槽且 maxSameGroups>1（遁入暗影）：一次容纳最多 N 组，**只消耗成组的骰**（零头留 driven）
      const multi = skill.slots.length === 1 && skill.slots[0].kind === 'same' && (skill.maxSameGroups ?? 1) > 1;
      if (multi) {
        const groups = allSameGroups(skill.slots[0], g.challenge.driven);
        const maxG = skill.maxSameGroups!;
        if (groups.length === 0) {
          logLine(g, `「${legacy}」：${skill.name} — 驱动骰不足，跳过`);
          continue;
        }
        const dec = (g.challenge.decisions ??= {});
        const chosenStr = (dec[skill.id] ?? [])[0];
        let chosenIdx: number[] | null = chosenStr ? chosenStr.split(',').map(Number) : null;
        if (groups.length > maxG && !chosenIdx) {
          // 昔传防御骰**已满**（= 上限）：本组移入不会发生（移 0 颗）、攻击次数恒为组数 → 选哪几组**无实际影响**，
          // 不再打扰挑战者（攻击次数已在"攻击提示"里由「（第 K / N 次）」讲清）→ 用确定性默认＝前 maxG 组。
          const defFull = g.players.B.areas.defense.length >= (card.defenseCap ?? Number.POSITIVE_INFINITY);
          if (defFull) {
            chosenIdx = groups.slice(0, maxG).map((_, idx) => idx);
          } else {
            const mode = g.challenge.settleMode;
            if (mode && mode !== 'manual') {
              // 自动：favor＝点数小、against＝点数大
              chosenIdx = groups
                .map((gr, idx) => ({ idx, value: gr.value }))
                .sort((a, b) => (mode === 'against' ? b.value - a.value : a.value - b.value))
                .slice(0, maxG)
                .map((x) => x.idx);
              dec[skill.id] = [chosenIdx.join(',')];
            } else {
              // 自选：弹面板让挑战者选哪几组（候选组 > 上限时才问）
              const combos = combinations(groups.length, maxG);
              g.challenge.activeSkill = i;
              g.challenge.resumeAt = i;
              g.pending = {
                kind: 'challengePick',
                player: 'A',
                prompt: `「${skill.name}」：移入哪些同点组？（选 ${maxG} 组）`,
                options: combos.map((c) => ({
                  id: c.join(','),
                  label: c.map((idx) => `${groups[idx].value}点组`).join('、'),
                })),
              };
              return;
            }
          }
        }
        const useIdx = chosenIdx ?? groups.map((_, idx) => idx);
        consumed = useIdx.flatMap((idx) => groups[idx]?.dice ?? []);
      } else if (skill.perGroup) {
        // Z05「数罪并罚」/「电刑」：逐组独立——尽量多匹配、可只匹配一部分（一组都没 → 跳过）
        const matched = matchGroupsPartial(skill.slots, g.challenge.driven);
        if (matched.length === 0) {
          logLine(g, `「${legacy}」：${skill.name} — 驱动骰不足，跳过`);
          continue;
        }
        const ids = new Set(matched.flatMap((gr) => gr.ids));
        consumed = g.challenge.driven.filter((d) => ids.has(d.id));
      } else if (
        skill.slotChoice &&
        (skill.slots.length === 1
          ? skill.id === 'z08-2' ||
            skill.id === 'z08-3' ||
            skill.id === 'z08-4' ||
            skill.slots[0].kind === 'same' ||
            skill.slots[0].kind === 'straight' ||
            skill.slots[0].kind === 'distinct'
          : // 多格 **pips** 槽（Z12 超度/破障：每格各取 1 颗、格内 faces 任选 → "用哪几颗"有多种填法）
            skill.slots.every((sl) => sl.kind === 'pips' && sl.count === 1))
      ) {
        // Z06 虚无形态/勾魂镰/圆舞（同点）+ Z07 不屈咆哮（顺点）+ Z08 凶弹业舞/共振/处刑通牒 + Z12 超度/破障：
        //   有 **≥2 个不同**的候选组 → 挑战者代决"用哪一组"（Z08/Z12 走链式后瞻、Z07 按"蛮王发送数"自动）。
        const s = skill.slots[0];
        const isZ08 = skill.id === 'z08-2' || skill.id === 'z08-3' || skill.id === 'z08-4';
        const isZ09 = skill.id === 'z09-2' || skill.id === 'z09-3' || skill.id === 'z09-4';
        const isZ10 = skill.id === 'z10-2' || skill.id === 'z10-3' || skill.id === 'z10-4';
        const isZ12 = skill.id === 'z12-3' || skill.id === 'z12-4';
        const cands: { key: string; label: string; ids: string[]; sort: number; values?: number[] }[] = [];
        if (isZ08) {
          const capZ = card.defenseCap ?? Number.POSITIVE_INFINITY;
          const simCands = z08SimCands(Number(skill.id.split('-')[1]), z08SimFromGame(g), capZ);
          for (const c of simCands) {
            cands.push({ key: c.key, label: c.label, ids: z08IdsOfKey(g.challenge.driven, simCands, c.key), sort: c.sort });
          }
        } else if (isZ12) {
          // Z12「超度 / 破障」：多格 pips 槽（1/2、3/4、5/6 各取 1 颗）——按点数多重集去重后作为候选
          for (const c of z12PipsCands(skill.slots, g.challenge.driven)) cands.push(c);
        } else if (s.kind === 'same') {
          for (const gr of allSameGroups(s, g.challenge.driven)) {
            cands.push({ key: String(gr.value), label: `${gr.value}点组`, ids: gr.dice.map((d) => d.id), sort: gr.value });
          }
        } else if (s.kind === 'distinct') {
          // Z11「清算」：4 颗**互不相同**点数（不要求连续）。自动方向（卡设）＝**尽量少给"血祭"留 5/6**
          //   → `sort` ＝ 组内 5/6 的颗数（有利＝sort 大＝吃走 5、6；不利＝sort 小＝留着）。
          //   并列按枚举顺序（点值升序）确定性取。下游唯一消费者＝血祭（其槽＝全部 5/6），故 sort 即完整后瞻。
          const byVal = new Map<number, Die>();
          for (const d of g.challenge.driven) if (!byVal.has(d.value)) byVal.set(d.value, d);
          const valsD = [...byVal.keys()].sort((a, b) => a - b);
          for (const idxs of combinations(valsD.length, s.count)) {
            const vs = idxs.map((i) => valsD[i]);
            cands.push({
              key: vs.join(','),
              label: `${vs.join('/')} 点`,
              ids: vs.map((v) => byVal.get(v)!.id),
              sort: vs.filter((v) => v === 5 || v === 6).length,
            });
          }
        } else {
          for (let start = 1; start + s.count - 1 <= 6; start++) {
            const ids: string[] = [];
            for (let v = start; v < start + s.count; v++) {
              const d = g.challenge.driven.find((x) => x.value === v && !ids.includes(x.id));
              if (!d) break;
              ids.push(d.id);
            }
            if (ids.length === s.count) {
              const vs = [];
              for (let v = start; v < start + s.count; v++) vs.push(v);
              cands.push({ key: vs.join(''), label: `${vs.join('')}顺点`, ids, sort: start });
            }
          }
        }
        if (cands.length === 0) {
          logLine(g, `「${legacy}」：${skill.name} — 驱动骰不足，跳过`);
          continue;
        }
        const decS = (g.challenge.decisions ??= {});
        // 选组用**独立键**（`slot:<技能id>`）——同一条技能可能还有别的代决（如 Z07 蛮王之牙的"弃骰"），
        //   共用同一个 `decisions[skill.id]` 会互相覆盖（真实事故：选组写入点数值被当骰子 id → "not a defense die"）。
        const slotKey = `slot:${skill.id}`;
        if (cands.length >= 2 && !(decS[slotKey] ?? [])[0]) {
          const opts = cands.map((c) => ({ id: c.key, label: c.label }));
          const mode = g.challenge.settleMode;
          if (mode && mode !== 'manual') {
            // Z08：链式后瞻（后续发动数 → 蛇蝎之泪防骰数 → 点值）；Z07「不屈咆哮」：按"蛮王发送数"；
            // 其余：**有利＝点数大、不利＝点数小**
            const key2 =
              (isZ08 ? z08ChainPickKey(g, skill, mode) : undefined) ??
              (isZ09 ? z09ChainPickKey(g, skill, mode) : undefined) ??
              (isZ10 ? z10ChainPickKey(g, skill, mode) : undefined) ??
              (isZ12 ? z12ChainPickKey(g, skill, mode) : undefined) ??
              (skill.id === 'z07-2' ? z07QubuAutoPick(g, cands, mode) : undefined);
            if (key2 !== undefined) {
              decS[slotKey] = [key2];
            } else {
              const sorted = [...cands].sort((a, b) => (mode === 'against' ? a.sort - b.sort : b.sort - a.sort));
              decS[slotKey] = [sorted[0].key];
            }
          } else {
            g.challenge.activeSkill = i;
            g.challenge.resumeAt = i;
            g.pending = {
              kind: 'challengePick',
              player: 'A',
              prompt: `「${skill.name}」：本技能用哪一组驱动骰？`,
              options: opts,
              key: slotKey,
            };
            return;
          }
        }
        const wantC = (decS[slotKey] ?? [])[0] ?? cands[0].key;
        const grp = cands.find((c) => c.key === wantC);
        consumed = grp ? g.challenge.driven.filter((d) => grp.ids.includes(d.id)) : [];
        // ⚠️ 不在这里 `delete dec[slotKey]`：本条可能还有别的代决（wants）会让本函数**续跑**，
        //    续跑时要复用同一个选组结果 → 统一在"应用后"清（见下方的 `delete dec[...]`）。
      } else {
        // Z04「D1：开局选骰」——本条的骰由挑战者开局已选定（且与后续技能互不重叠）
        const assigned = g.challenge!.assign?.[skill.id];
        if (assigned && assigned.length > 0) {
          consumed = g.challenge.driven.filter((d) => assigned.includes(d.id));
        } else {
          const m = matchSlots(skill.slots, g.challenge.driven);
          if (!m) {
            logLine(g, `「${legacy}」：${skill.name} — 驱动骰不足，跳过`);
            continue;
          }
          consumed = g.challenge.driven.filter((d) => m.includes(d.id));
        }
      }
    }
    // 代决（模式 1）：本条需要的选择还没收集齐 → **先把骰子扣下、发第一步动效**，再挂代决
    const wants = challengeDecisions(g, skill);
    const dec = (g.challenge.decisions ??= {});
    const got = dec[skill.id] ?? [];
    if (wants.length > got.length) {
      const mode = g.challenge.settleMode;
      // `alwaysManual`：该选择**始终由挑战者亲自做**（如 Z09「陷阵」卡面"由挑战者选择"）——
      //   即便 favor/against 也**弹面板**、不自动选。
      if (mode && mode !== 'manual' && !wants[got.length]?.alwaysManual) {
        // 自动结算（有利/不利）：替昔传选齐，不弹面板（下面照常结算）
        const arr = dec[skill.id] ?? [];
        for (let k = got.length; k < wants.length; k++) {
          // Z05「不可饶恕」/ Z12「不动菩提」＝**专用口径**（颗数 → 区域权重 → 点值）；Z11「清算」＝**类型序 + 同类点数序**；其余走通用 autoPick
          const id =
            skill.id === 'z05-2' || skill.id === 'z12-1'
              ? z05ChongfuAutoPick(g, wants[k], mode)
              : skill.id === 'z11-3'
                ? qingsuanOrder(
                    [
                      ...g.players.A.areas.attack,
                      ...g.players.A.areas.defense,
                      ...g.players.A.areas.meditation,
                    ],
                    mode === 'against',
                  )
                    .slice(0, wants[k].pick?.n ?? 0)
                    .map((d) => d.id)
                    .join(',')
                : autoPick(wants[k], mode);
          if (id) arr.push(id);
        }
        dec[skill.id] = arr;
      } else {
        g.challenge.activeSkill = i;
        g.challenge.resumeAt = i;
        if (!resuming) {
          g.challenge.driven = g.challenge.driven.filter((d) => !consumed.includes(d)); // 真正扣掉
          // ⚠️ **不写 `slot`**：驱动骰槽只是界面上的"过场" → 那几颗骰由界面影子演「临时区→中间→槽→消失」，
          //    状态里**不留**（否则界面会露出真骰、之后还要再演一次"从槽飞走"）。记账靠 `pendingConsumed`。
          g.challenge.pendingConsumed = consumed.map((d) => ({ id: d.id, value: d.value }));
          g.challenge.pendingSkillId = skill.id;
          // 动效旁路：**先动画（技能名 + 驱骰进槽）**，选择面板由界面延后到动画播完再显示
          fxPush({
            kind: 'legendSkill',
            player: 'B',
            skillKey: skill.id,
            skillName: skill.name,
            consumed: consumed.map((d) => ({ id: d.id, value: d.value })),
            spawn: [],
            outIds: [],
            attack: false,
            announce: true, // 代决帧＝这条技能的"发动帧" → 弹技能名
          });
        }
        const w = wants[got.length];
        g.pending = { kind: 'challengePick', player: 'A', prompt: w.prompt, options: w.options, pick: w.pick };
        return;
      }
    }
    g.challenge.driven = g.challenge.driven.filter((d) => !consumed.includes(d)); // 真正扣掉
    g.challenge.slot = []; // 驱动骰槽＝纯过场视觉，状态里不留骰
    g.challenge.activeSkill = i; // 界面高亮"正在结算"
    g.challenge.pendingConsumed = undefined;
    g.challenge.pendingSkillId = undefined;
    const fxConsumed = resuming ? [] : consumed.map((d) => ({ id: d.id, value: d.value })); // 代决帧已报过 → 不重复
    const res = applyChallengeSkill(g, card, skill, consumed);
    // 动效旁路：本步的编排依据（新产生的骰 / 是否触发攻击；消耗已在代决帧报过）
    fxPush({
      kind: 'legendSkill',
      player: 'B',
      skillKey: skill.id,
      skillName: skill.name,
      consumed: fxConsumed,
      spawn: res.spawn,
      outIds: res.outIds,
      attack: !!(g.pendingAttack || g.virtualQueue),
      announce: !resuming, // 发动帧（非续跑帧）→ 弹技能名；续跑帧不重复弹
    });
    delete dec[skill.id];
    delete dec[`slot:${skill.id}`]; // 选组的独立键也一并清（防跨回合复用旧选择）
    g.challenge.slot = [];
    if (g.pendingAttack || g.virtualQueue) {
      g.challenge.resumeAt = i + 1; // 等挑战者响应完再续
      return;
    }
    if (skill.endsTurn) {
      logLine(g, `「${legacy}」：${skill.name} — 立即结束回合`);
      break;
    }
    if (once) {
      g.challenge.resumeAt = i + 1; // 只结算一条 → 交回界面，等下一次 challengeStep
      return;
    }
  }
  g.challenge.driven = [];
  g.challenge.slot = [];
  g.challenge.resumeAt = null;
  g.challenge.activeSkill = null;
  // 挑战模式：传奇的**"回合结束"时点** —— 033「死亡亦逝」（**挑战者**装填生效，任一方生效即双方各自回合结束都要执行）
  //   → 由**挑战者(A)代决**弃置传奇的能力骰（只能弃最少）。判定与常规路径**共用** `siwangShouldFire`。
  //   ⚠️ 必须在**交还/开新回合之后**再挂（`beginTurn` 会 `g.pending = null` / 清 `pendingQueue`，挂早了会被清掉）。
  const needSiwang = siwangShouldFire(g, 'B');
  // Z06「漆黑死神」：**回合结束时翻面**黑白指示物（并弹「无光领域」技能名）
  if (card.token) {
    const prev: 'black' | 'white' = g.challenge.token === 'white' ? 'white' : 'black';
    g.challenge.token = prev === 'black' ? 'white' : 'black';
    logLine(g, `「${legacy}」：无光领域指示物翻面 → ${g.challenge.token === 'black' ? '黑' : '白'}面`);
    const wg = (card.skills ?? []).find((s) => s.id === 'z06-1');
    fxPush({
      kind: 'legendSkill',
      player: 'B',
      skillKey: wg?.id ?? 'z06-1',
      skillName: wg?.name ?? '无光领域',
      consumed: [],
      spawn: [],
      outIds: [],
      attack: false,
      announce: true,
    });
  }
  g.challenge.turn += 1;
  // Z10「救赎」：设了"下一回合 override" → **同一玩家开真·新回合**（`turnIndex++`、清本回合 buff、不再算首回合），
  //   不交还挑战者；`beginTurn` 见 activePlayer 仍是传奇 → 再走 `runLegendTurn`（消费 override：投 5 + 攻击 +1）。
  if (g.challenge.nextTurnOverride) {
    // ⚠️「救赎」只说"再次开始 1 个回合"，**没说跳过本回合的「回合结束」** → 先把本回合的结束结算（033）交出去，
    //    **解完之后**才开新回合（否则 `beginTurn` 会把刚挂的 pending/pendingQueue 清掉）。
    //    由界面按节奏派发 `challengeStep` → `case 'challengeStep'` 里执行 `startNextLegendTurn`。
    if (needSiwang) {
      g.challenge.startNextTurnAfterPending = true;
      queuePending(g, { kind: 'tiaolingPick', player: 'A', owner: 'B' });
      return;
    }
    startNextLegendTurn(g);
    return;
  }
  endTurn(g); // 交回合给挑战者（其 beginTurn 走正常流程）
  // 挑战模式：传奇回合结束 → 033 代决（挂在这里才不会被挑战者 `beginTurn` 的 `g.pending = null` 清掉）
  if (needSiwang) queuePending(g, { kind: 'tiaolingPick', player: 'A', owner: 'B' });
}

/** Z10「救赎」等"同一玩家再开一个回合"：清本回合 buff、不再算首回合、`turnIndex+1` → 回到传奇（消费 `nextTurnOverride`）。 */
function startNextLegendTurn(g: GameState): void {
  g.players.B.buffs = g.players.B.buffs.filter((b) => b.duration !== 'thisTurn');
  g.firstRound.B = false;
  g.turnIndex += 1;
  beginTurn(g);
}

export function beginTurn(g: GameState): void {
  if (g.phase === 'gameOver') return;
  // 单人挑战：轮到传奇 → 不按常规阶段，直接跑它的"自动机回合"
  if (g.mode === 'challenge' && g.activePlayer === 'B') {
    runLegendTurn(g);
    return;
  }
  const p = g.activePlayer;
  // 战术牌 T05「狂热」：该玩家**自己的回合**计数 +1（封顶 4；L04 重开清零）——"前 3 个回合"判定用
  g.players[p].turnsTaken = Math.min(4, g.players[p].turnsTaken + 1);
  // 先切入新回合的起始阶段，再打「回合开始」战报：让该行日志携带新回合的阶段标签
  //（首回合 = 尘起、其后 = 重掷），否则会带上上一回合遗留的标签（初始重掷 / 结束）
  // 战术牌 T11「迷烟」：你自己的**第一个回合仍具有重掷阶段**（首回合本来跳过重掷）
  const t11 = TACTIC_BY_ID[g.players[p].tactic ?? '']?.key === 'miyan';
  g.phase = g.firstRound[p] && !t11 ? 'dustRise' : 'reroll';
  // T11「迷烟」：首回合本应跳过重掷，是它**多给了一段"重掷阶段"** → 弹「迷烟」
  if (g.firstRound[p] && t11) fxTacticFired(g, p);
  // 回合分隔横幅：全模式统一成 `——X 的回合——`（与传奇回合「——「黑枪」的回合——」同款）
  logLine(g, `——${pname(p)} 的回合——`);
  g.pendingAttack = null;
  g.pending = null;
  g.unblockableThisTurn = false;
  g.caiyuliuUsed = 0;
  g.dustRiseNormalCount = 0;
  g.dustRiseActed = false;
  g.freeDustRise = 0;
  g.rerollUsed = 0;
  g.skillsUsedThisTurn = [];
  g.skillConsumedThisAction = 0;
  g.dunwuPulseUsedThisTurn = false;
  g.attackQueue = null;
  g.virtualQueue = null;
  g.extraReroll = null;
  g.pendingQueue = [];
  // 019 尘哀·尘起：每回合最多触发 1 次；其赠予的「免费额外尘起」也在回合开始时清零
  g.chenaiUsed.A = false;
  g.chenaiUsed.B = false;
  g.freeNoCostRise = 0;
  // 025 屠虎·横贯（持续）：每回合的攻击次数清零（第 2 次攻击伤害 +2 按本回合统计）
  g.attacksThisTurn.A = 0;
  g.attacksThisTurn.B = 0;
  g.hunhunGained.A = 0;
  g.hunhunGained.B = 0;
  // A07 异相·完杀必杀：「直到本回合结束前双方持续式失效」——回合开始清除该临时标记
  // 注：L09「遍野残杀」的「左右两侧视为激活」**不在回合开始清除**（常驻，直到其"回合结束即死"触发）。
  for (const id of ['A', 'B'] as PlayerId[]) {
    for (const a of g.players[id].artifacts) {
      a.continuousLostThisTurn = false;
    }
    if (g.players[id].legend) g.players[id].legend!.continuousLostThisTurn = false;
  }
  // 028 天罚（激活·本回合）：攻击点数视为固定值 / 只能用某类骰抵挡 / 造成伤害次数统计，均按本回合清零
  g.tianfa.A = null;
  g.tianfa.B = null;
  // 018 至黑：每回合第一次受伤的判定在每回合开始时重置（任何玩家的回合开始时都重置，双方各自独立）
  g.players.A.damagedThisTurn = false;
  g.players.B.damagedThisTurn = false;
  // L08 蛇蝎之泪：本回合「填弹」实际叠加的计数累计 —— 每次回合开始都清零（双方）
  g.players.A.tiandanGainedThisTurn = 0;
  g.players.B.tiandanGainedThisTurn = 0;
  // L01 断苇一斩：判定"我上一个回合是否一整个回合都没造成任何伤害"，随后重置本回合标记
  // （首个回合没有"上一个回合"→ 不可发动）
  g.players[p].noDamageLastTurn = !g.firstRound[p] && !g.players[p].dealtDamageThisTurn;
  g.players[p].dealtDamageThisTurn = false;
  // 回合开始触发（补充之前，故获得的骰计入意志上限）：008 战车
  applyTurnStartEffects(g, p);
  // 战术牌 T08「无情」：对方的回合开始时（补充骰之前），若任一方生命 ≤20 → 本回合玩家受 2 真伤
  checkWuqing(g, p);
  if ((g.phase as string) === 'gameOver') return;
  // 战术牌 T15「影子」：你自己的**第一个回合开始时** → 为战术上的存放骰选定点数（1–6）
  if (
    g.firstRound[p] &&
    TACTIC_BY_ID[g.players[p].tactic ?? '']?.key === 'yingzi' &&
    !g.players[p].tacticHeldDie &&
    !g.players[p].tacticOnceUsed
  ) {
    queuePending(g, { kind: 'yingziPick', player: p });
    pumpPending(g);
  }
  if (g.firstRound[p]) {
    // 第一回合跳过补充与重掷
    // 027 凛冽之音：持续到「持有者自己的下个尘起阶段开始」→ 尘起阶段开始时清除
    g.rerollPunish[p] = false;
  } else {
    let refilled = 0;
    withRng(g, (rng) => {
      refilled = refillPhase(g, p, rng);
    });
    // 010 深红·杀意：补充阶段实际补充数量 ≤ 3 时，可造成 3 点真实伤害并回复 2 点生命
    if (hasActiveSkill(g.players[p], 'shenhong.kill') && refilled <= 3) {
      g.pending = { kind: 'shenhongKill', player: p };
    }
    // A02 深红（异相）·哀悼：补充阶段实际补充数量 ≤ 3 时，可造成 2 点真实伤害并弃置对方 1 个防御骰
    if (hasActiveSkill(g.players[p], 'shenhong.alt.aidao') && refilled <= 3) {
      queuePending(g, { kind: 'aidao', player: p });
      pumpPending(g);
    }
    // 029 真言·全知（持续）：补充阶段不按常规分布落区，改由玩家自行分配全部能力骰
    if (hasActiveSkill(g.players[p], 'zhenyan.quanzhi')) {
      queuePending(g, { kind: 'quanzhiAssign', player: p });
      pumpPending(g);
    }
  }
  // 战术牌 T07「保守」：回合开始时也检查（从第一回合起，防御骰第一次为空即触发）
  checkBaoshou(g);
}

export function endTurn(g: GameState): void {
  if (g.phase === 'gameOver') return;
  const p = g.players[g.activePlayer];
  // L09 传奇面板·遍野残杀：你的回合结束时，你**立即死亡**（直接判负，不走伤害流程）
  if (p.artifacts.some((a) => a.allSidesActiveThisTurn === true)) {
    logLine(g, `${pname(g.activePlayer)} 「遍野残杀」：回合结束 → 立即死亡`);
    const before = p.life;
    p.life = 0;
    noteLifeDrop(g, g.activePlayer, before - p.life); // L11 邪灵序曲：直接设 0 也是"生命下降"
    checkLifeEnd(g);
    if ((g.phase as string) === 'gameOver') return; // 已判负：不再继续正常交回合
  }
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

/** 「推进阶段」的唯一入口：初始重掷 → 走初始重掷步；其余 → `advancePhase`。
 *  供 `advance` 动作与「自动推进」（见 `autoAdvanceAction`）共用，保证阶段口径一致。 */
function doAdvance(g: GameState): void {
  if (g.phase === 'initialReroll') finishInitialRerollStep(g);
  else advancePhase(g);
}

/**
 * 「没得做就自动翻页」：判断当前阶段是否**确实没有任何可做之事**，是则返回 `{t:'advance'}`。
 *
 * - **初始重掷**：持 T01「谨慎」（卡面：没有初始重掷步骤）或没有任何能力骰。
 * - **重掷阶段**：重掷次数已用尽（默认 1；002「龙游万象」→2；013 雷暴插入的额外阶段→1）或无骰可重掷。
 *   **首回合由 T11「迷烟」带入的重掷阶段同样适用**（有骰就正常停下等重掷，无骰才跳过）。
 * - **尘起阶段**：`dustRiseActions` 为空＝没有任何可用的尘起途径。
 *   （**尘印 / 019 免费尘起 / T12「激进」都算"还能尘起"** → 动作列表非空 → 不会自动结束。）
 * - 有 `pending` / 待抵挡 / 多段攻击队列时一律**不**自动推进（让位待决策）。
 *
 * 纯读、不改状态。**必须在 `checkBaoshou`（T07「保守」补骰）之后调用**：否则会把"刚获得冥想骰、
 * 其实能尘起"的阶段误判为空。
 */
export function autoAdvanceAction(g: GameState): Action | null {
  if (g.phase === 'gameOver') return null;
  if (g.pending || g.pendingQueue.length > 0 || g.pendingAttack) return null;
  const p = g.players[g.activePlayer];
  if (g.phase === 'initialReroll') {
    const noStep = TACTIC_BY_ID[p.tactic ?? '']?.key === 'qingzhen';
    return noStep || totalDice(p) === 0 ? { t: 'advance' } : null;
  }
  if (g.phase === 'reroll') {
    const allowance = g.extraReroll ? 1 : rerollAllowance(p);
    const canReroll = g.rerollUsed < allowance && effectiveSpeed(p) > 0 && totalDice(p) > 0;
    return canReroll ? null : { t: 'advance' };
  }
  if (g.phase === 'dustRise') {
    return dustRiseActions(g, g.activePlayer).length === 0 ? { t: 'advance' } : null;
  }
  return null;
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
        queueXianzhen(g, reroller);
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
      queueXianzhen(g, g.activePlayer);
      // 对方（非当前玩家）的重掷阶段结束时触发：013 雷暴·持续 / 017 帷幕
      queueRerollEndTriggers(g, g.activePlayer);
      pumpPending(g);
      break;
    }
    case 'dustRise':
      // 单人挑战「不存在尘落」（说明书 page_15）→ 不尘起也不 +1、不判 10 层胜
      if (g.mode !== 'challenge' && !g.dustRiseActed) {
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
      // L09 传奇面板·鏖战（持续）：**你的主要阶段结束时**，若你有能力骰且「陷阵」处于激活状态 → 再次执行 1 次「陷阵」。
      // 顺序（2026-09-28 用户确认）：**鏖战 → 033 → 意志上限弃骰**（后两者会先减骰子，若排在前面会把鏖战"饿死"）。
      if (hasActiveSkill(g.players[g.activePlayer], 'lifeng.aozhan')) {
        // 仅当「陷阵」**真的排队**（已激活 + 有骰可弃）时才弹「鏖战」技能名——否则只发日志、不弹气泡
        if (queueXianzhen(g, g.activePlayer, 'mainEnd')) fxSkillFired(g, g.activePlayer, 'lifeng.aozhan');
      }
      // 032 梦魇·低语（持续）：持有者自己的主要阶段结束时，宣称 1 个能力骰类型
      if (hasActiveSkill(g.players[g.activePlayer], 'mengyan.diyu')) {
        queuePending(g, { kind: 'kuyu', player: g.activePlayer });
      }
      // L11 传奇面板·邪灵序曲（持续）：**你的回合结束时**，造成＝「邪灵序曲」计数**十位数**的真实伤害给对手。
      // 顺序（2026-09-28 用户确认）：**（主要阶段结束：L09 鏖战 → 032 低语）→ 邪灵序曲 → 033 → 意志上限弃骰**。
      if (hasActiveSkill(g.players[g.activePlayer], 'aiwa.xielingxuqu')) {
        const lg = g.players[g.activePlayer].legend;
        const dmg = lg ? Math.floor(lg.count / 10) : 0;
        if (dmg > 0) {
          const oppId: PlayerId = g.activePlayer === 'A' ? 'B' : 'A';
          logLine(
            g,
            `${pname(g.activePlayer)} 「邪灵序曲」：回合结束 → 计数 ${lg ? lg.count : 0} 的十位数 ${dmg} → 对 ${pname(oppId)} 造成等量真实伤害`,
          );
          if (lg) fxSetSource({ player: g.activePlayer, artifactId: lg.id, side: 'only', skillKey: 'aiwa.xielingxuqu' });
          dealTrueDamage(g, oppId, dmg, g.activePlayer);
        }
      }
      // 邪灵序曲若把对手打死 → 直接结束（不再走 033 / 意志上限）
      if ((g.phase as string) === 'gameOver') break;
      // 033 凋零·死亡亦逝（持续）：任一方"生效"时，双方各自回合结束时都要执行；区域为空则自动通过。
      //   判定**唯一来源** `siwangShouldFire`（与挑战模式"传奇回合结束"路径共用，勿各写一份）。
      if (siwangShouldFire(g, g.activePlayer)) {
        const owner = g.activePlayer;
        // 挑战模式：轮到传奇（B）结束时 → 由**挑战者(A)代决**（骰子仍属传奇）
        const decider: PlayerId = g.mode === 'challenge' && owner === 'B' ? 'A' : owner;
        queuePending(g, { kind: 'tiaolingPick', player: decider, owner });
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
  if (opts.tactics) {
    enterTacticsPhase(g);
  } else if (opts.tacticA || opts.tacticB) {
    // 构筑/挑战＝设置页**直接指定**战术牌：进"战前"阶段承载其"战斗开始时"交互（T01 选骰 / T02 先手）
    g.phase = 'tactics';
    for (const id of ['A', 'B'] as PlayerId[]) applyTacticStart(g, id);
    pumpPending(g);
    maybeEnterInitialReroll(g);
  } else {
    enterInitialReroll(g);
  }
  // 收口：初始状态也不该停在"没有任何可做之事"的阶段（如 L03「无敌」无初始能力骰、T01「谨慎」无初始重掷步骤）
  settleAutoAdvance(g);
  return g;
}

/** 建局收口：反复自动推进，直到没有"没得做"的阶段（见 `autoAdvanceAction`）。 */
function settleAutoAdvance(g: GameState): void {
  for (let guard = 0; guard < 6; guard++) {
    if (!autoAdvanceAction(g)) break;
    doAdvance(g);
  }
}

export interface ChallengeSetupOptions {
  seed: number;
  /** 挑战卡 id（如 'Z02'） */
  cardId: string;
  /** 挑战者（A）构筑的 3 件神器（第一/二/三列） */
  challenger: [string, string, string];
  /** 挑战者的战术牌（可空） */
  tactic?: string;
  /** 结算模式（选择界面定）：`manual`（默认）/ `favor`（有利挑战者）/ `against`（不利挑战者） */
  settleMode?: 'manual' | 'favor' | 'against';
}

/** 单人挑战建局：挑战者＝A（构筑），传奇＝B（挑战卡预设，无能力骰、生命取卡面、先手）。 */
export function createChallengeGame(opts: ChallengeSetupOptions): GameState {
  const card = CHALLENGES.find((c) => c.id === opts.cardId);
  if (!card) throw new Error(`unknown challenge card: ${opts.cardId}`);
  const g = setupGame({
    seed: opts.seed,
    firstPlayer: 'B', // 说明书：永远从「昔日传奇」回合开始
    heroA: opts.challenger,
    heroB: card.artifacts,
    tacticA: opts.tactic,
  });
  g.mode = 'challenge';
  // 传奇没有初始能力骰（它的骰是每回合投的"驱动骰"），也没有冥想骰区
  g.players.B.areas = { attack: [], defense: [], meditation: [] };
  if (card.life != null) g.players.B.life = g.players.B.lifeMax = card.life;
  g.challenge = { cardId: card.id, count: 0, driven: [], slot: [], turn: 0, settleMode: opts.settleMode ?? 'manual' };
  // Z06「漆黑死神」：黑白指示物，战斗开始＝**黑面朝上**（回合结束翻面）
  if (card.token) g.challenge.token = 'black';
  logLine(g, `挑战模式：对手＝传说中的「${card.legacy}」· 生命 ${g.players.B.life}`);
  // 挑战者的战术牌：构筑直接生效
  if (opts.tactic) applyTacticStart(g, 'A');
  // 战前收口：**初始生命修正**（标准流程在"战前收口" `maybeEnterInitialReroll` 结算；挑战建局不经 `tactics` 阶段 → 这里补，
  //   否则所有 `lifeMods` 失效，如 T03 顽强 +6）。`applyTacticLifeMods` 内部已处理「+取最大 / −取最大」→ 增、减一并修。
  if (opts.tactic) {
    applyTacticLifeMods(g);
    g.tacticStartDone = true;
  }
  // 挑战者仍需初始重掷（传奇无骰 → 它那一步会被自动跳过）
  enterInitialReroll(g);
  settleAutoAdvance(g);
  return g;
}

/** 进入「初始重掷」（战前管线的最后一步） */
function enterInitialReroll(g: GameState): void {
  const second: PlayerId = g.firstPlayer === 'A' ? 'B' : 'A';
  g.phase = 'initialReroll';
  g.activePlayer = g.firstPlayer;
  g.initialRerollQueue = [g.firstPlayer, second];
  logLine(g, `${pname(g.firstPlayer)} 先手；初始重掷：可重掷任意数量的初始能力骰`);
}

/** 战术牌·战前抽牌：进入 `tactics` 阶段，先给先手抽 2 张（另一人待其选完再从剩余池抽 → 双方不同名） */
function enterTacticsPhase(g: GameState): void {
  const second: PlayerId = g.firstPlayer === 'A' ? 'B' : 'A';
  g.phase = 'tactics';
  g.activePlayer = g.firstPlayer;
  g.tacticPool = TACTIC_POOL.slice();
  g.tacticQueue = [g.firstPlayer, second];
  drawNextTacticHand(g);
}

/** 给队首（`tacticQueue[0]`）从剩余池抽 2 张并移出池（保证双方不选到同一张），写战报 */
function drawNextTacticHand(g: GameState): void {
  const who = g.tacticQueue[0];
  if (!who) { g.tacticHand = []; return; }
  const hand: string[] = [];
  withRng(g, (rng) => {
    for (let i = 0; i < 2 && g.tacticPool.length > 0; i++) {
      hand.push(g.tacticPool.splice(rng.int(g.tacticPool.length), 1)[0]);
    }
  });
  g.tacticHand = hand;
  logLine(
    g,
    `${pname(who)} 战术牌：抽到${hand.map((id) => `「${TACTIC_BY_ID[id]?.name ?? id}」`).join('、')}（留 1 张）`,
  );
}

/**
 * 战术牌"战斗开始时"交互挂载：战术牌**定下时**调用（构筑带入 / 预设·轮选抽到后 / L04 重开重跑 T01）。
 * 只挂**交互待决策**（T01 选点 / T02 先手）；**生命修正**不在这里——它们要等双方都定好、在战前收口统一结算。
 *
 * ⚠️ L04 重开只重跑**触发时点 ≥「获得初始能力骰子」**的战术牌（见 `TacticDef.reOnReset`）；调用方自行过滤。
 */
export function applyTacticStart(g: GameState, player: PlayerId): void {
  const id = g.players[player].tactic;
  if (!id) return;
  const key = TACTIC_BY_ID[id]?.key;
  // 挑战模式：部分战术牌的**效果**在挑战下失效（**生命修正照吃**）——见 challenges.ts 的 `challengeInertTactics`
  if (key && isInertTactic(g, key)) {
    logLine(g, `${pname(player)} 战术牌「${TACTIC_BY_ID[id]?.name ?? id}」：挑战模式下此效果无效（生命修正照常）`);
    return;
  }
  if (key === 'qingzhen') {
    // L03「无敌」＝没有初始能力骰 → 与 T01 同人时**无敌优先**（无骰可选）
    if (hasActiveSkill(g.players[player], 'batton.wudi')) return;
    g.players[player].areas.attack = [];
    g.players[player].areas.defense = [];
    g.players[player].areas.meditation = [];
    queuePending(g, { kind: 'tacticDice', player });
  } else if (key === 'xianji') {
    queuePending(g, { kind: 'tacticFirst', player });
  } else if (key === 'yuanjian') {
    // T13「远见」：战斗开始时猜测"生命最先降为 20 点或以下"的玩家
    queuePending(g, { kind: 'tacticGuess', player });
  }
}

/** 战术牌生命修正（战前收口一次）：**先「+生命」取最大 → 再「−生命」取最大**，同时改生命上限 */
function applyTacticLifeMods(g: GameState): void {
  for (const id of ['A', 'B'] as PlayerId[]) {
    // 收集该玩家受到的生命修正贡献（来源战术牌名 + 数值；按来源 A→B 顺序）；+ 与 − 各取一笔生效
    let posBest: { name: string; amount: number } | null = null;
    let negBest: { name: string; amount: number } | null = null;
    for (const src of ['A', 'B'] as PlayerId[]) {
      const t = g.players[src].tactic;
      if (!t) continue;
      const def = TACTIC_BY_ID[t];
      if (!def) continue;
      const name = def.name ?? t;
      for (const lm of def.lifeMods) {
        const target: PlayerId = lm.who === 'self' ? src : src === 'A' ? 'B' : 'A';
        if (target !== id) continue;
        // 方向由 `who` 决定（amount 一律存正数）：self＝提高 / opp＝降低
        if (lm.who === 'self') {
          if (!posBest || lm.amount > posBest.amount) posBest = { name, amount: lm.amount };
        } else if (!negBest || lm.amount < negBest.amount) {
          negBest = { name, amount: lm.amount }; // 多条 − 取"数值最大"（最接近 0）
        }
      }
    }
    if (!posBest && !negBest) continue; // 无任何贡献 → 不写战报
    const delta = (posBest?.amount ?? 0) - (negBest?.amount ?? 0);
    const p = g.players[id];
    p.life += delta;
    p.lifeMax += delta;
    // 静默同步"生命十位数基准"（L05 复仇之灵用）；战前阶段**不触发** checkLifeTens（避免误引发额外尘起）
    p.lifeTens = Math.floor(p.life / 10);
    // 战报始终反映结果（含净 0，如 +2 再 −2）；列出实际生效的来源
    const parts: string[] = [];
    if (posBest) parts.push(`「${posBest.name}」+${posBest.amount}`);
    if (negBest) parts.push(`「${negBest.name}」−${negBest.amount}`);
    const suffix = delta === 0 ? '（不变）' : '';
    logLine(
      g,
      `${pname(id)} 战术牌·初始生命修正：${parts.join('、')} → 生命 ${p.life}／上限 ${p.lifeMax}${suffix}`,
    );
  }
}

/** 战前收口：抽牌完、无待决策 → 结算战术牌生命修正（一次）并进入初始重掷 */
function maybeEnterInitialReroll(g: GameState): void {
  if (g.phase !== 'tactics') return;
  if (g.tacticQueue.length > 0) return;
  if (g.pending || g.pendingQueue.length > 0) return;
  if (!g.tacticStartDone) {
    applyTacticLifeMods(g);
    g.tacticStartDone = true;
  }
  enterInitialReroll(g);
}

/**
 * 战术牌横条三态（**单一来源**；`render.ts` 的战术牌横条只读它）：
 * - `active`（绿·生效中）：T05 前 3 回合 / T06 对方血≤13 / T04 有就绪必杀 / T08 任一方血≤20；
 * - `spent`（灰·已用尽）：T01/T02/T03（开局类）、T05 过前 3 回合、T07 已触发（整局 1 次）；
 * - `normal`：其余。
 */
export type TacticBarState = 'active' | 'spent' | 'normal';
export function tacticBarState(g: GameState, player: PlayerId): TacticBarState {
  const def = TACTIC_BY_ID[g.players[player].tactic ?? ''];
  if (!def) return 'normal';
  const p = g.players[player];
  const active =
    tacticActiveBonus(g, player) !== null ||
    // T05「狂热」：仍在前 3 个回合内 → 横条常绿（**不看是否轮到自己**；否则对方回合会闪成普通灰）
    (def.key === 'kuangre' && p.turnsTaken >= 1 && p.turnsTaken <= 3) ||
    (def.key === 'molu' && hasReadyUltimate(g, player)) ||
    (def.key === 'wuqing' && (g.players.A.life <= 20 || g.players.B.life <= 20)) ||
    (def.key === 'cibei' && !p.tacticOnceUsed) ||
    (def.key === 'baoshou' && !p.tacticOnceUsed) ||
    (def.key === 'yuhui' && !p.tacticOnceUsed) ||
    (def.key === 'fuhuo' && !p.tacticOnceUsed) ||
    (def.key === 'yingzi' && !p.tacticOnceUsed) ||
    // T17「诱敌」：未发动＝绿（待命）
    (def.key === 'youdi' && !p.tacticOnceUsed) ||
    // T18「适应」：未用＝绿（待命）
    (def.key === 'shipei' && !p.tacticOnceUsed) ||
    // T16「潜伏」（全局）：当前回合玩家的第 1 或第 2 个回合期间＝生效中
    (def.key === 'qianfu' &&
      (g.firstRound[g.activePlayer] || g.players[g.activePlayer].turnsTaken === 2)) ||
    (def.key === 'miyan' && g.firstRound[player]) ||
    (def.key === 'jijin' && g.firstRound[player] && !p.tacticOnceUsed) ||
    // T13「远见」：尚未有人降到 ≤20（待命）＝生效中
    (def.key === 'yuanjian' && g.tacticLowFirst === null);
  if (active) return 'active';
  if (def.setupOnly) return 'spent';
  if (def.key === 'kuangre' && p.turnsTaken > 3) return 'spent';
  if (def.key === 'baoshou' && p.tacticOnceUsed) return 'spent';
  if (def.key === 'cibei' && p.tacticOnceUsed) return 'spent';
  if (def.key === 'yuhui' && p.tacticOnceUsed) return 'spent';
  if (def.key === 'fuhuo' && p.tacticOnceUsed) return 'spent';
  if (def.key === 'yingzi' && p.tacticOnceUsed) return 'spent';
  if (def.key === 'youdi' && p.tacticOnceUsed) return 'spent';
  if (def.key === 'shipei' && p.tacticOnceUsed) return 'spent';
  if (def.key === 'miyan' && !g.firstRound[player]) return 'spent';
  if (def.key === 'jijin' && (p.tacticOnceUsed || !g.firstRound[player])) return 'spent';
  if (def.key === 'yuanjian' && g.tacticLowFirst !== null) return 'spent';
  return 'normal';
}

/**
 * 战术牌 T07「保守」：**从游戏的第一个回合起**，当某玩家**防御骰区第一次为空**时，立即获得
 * 1 个随机点数防御骰 + 1 个随机点数冥想骰（整局 1 次）。在**每次行动结算后**与**每个回合开始时**检查。
 */
function checkBaoshou(g: GameState): void {
  if (g.phase === 'gameOver') return;
  if (g.turnIndex < 1) return; // 「从游戏的第一个回合开始」→ 战前不检查
  for (const id of ['A', 'B'] as PlayerId[]) {
    const p = g.players[id];
    if (TACTIC_BY_ID[p.tactic ?? '']?.key !== 'baoshou') continue;
    if (p.tacticOnceUsed) continue;
    if (p.areas.defense.length !== 0) continue;
    p.tacticOnceUsed = true;
    fxTacticFired(g, id);
    withRng(g, (rng) => {
      const d1 = gainRandomDice(g, id, 'defense', 1, rng)[0];
      const d2 = gainRandomDice(g, id, 'meditation', 1, rng)[0];
      logLine(
        g,
        `${pname(id)} 「保守」：防御骰第一次为 0 → 获得 1 个随机防御骰（${d1.value}）与 1 个随机冥想骰（${d2.value}）`,
      );
    });
  }
}

/**
 * 战术牌 T08「无情」：**对方的回合开始时**（`turnStarter` ＝本回合玩家），若**任一方生命 ≤20**，
 * 则本回合玩家受到 2 点真实伤害（source＝持有者）。每个对方回合均可再次触发。
 */
function checkWuqing(g: GameState, turnStarter: PlayerId): void {
  if (g.phase === 'gameOver') return;
  const holder: PlayerId = turnStarter === 'A' ? 'B' : 'A';
  if (TACTIC_BY_ID[g.players[holder].tactic ?? '']?.key !== 'wuqing') return;
  if (g.players.A.life > 20 && g.players.B.life > 20) return;
  logLine(g, `${pname(holder)} 「无情」：有玩家生命 ≤20 → ${pname(turnStarter)} 受到 2 点真实伤害`);
  fxTacticFired(g, holder);
  dealTrueDamage(g, turnStarter, 2, holder);
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
    g.turnIndex += 1; // T0 专属初始重掷；首个玩家回合从 T1 起（与 endTurn / L11 的自增口径一致）
    beginTurn(g);
  }
}

/** L05 复仇之灵：**强制**的一次"无需冥想骰的额外尘起行动"（不占次数、不耗 freeNoCostRise） */
function fuchouRiseActions(g: GameState, player: PlayerId): Action[] {
  const p = g.players[player];
  const acts: Action[] = [];
  for (const a of p.artifacts) {
    if (!canTargetForDustRise(a)) continue;
    const sides =
      a.column === 3
        ? [undefined]
        : a.activeMarkerSide == null
          ? ['left', 'right']
          : [a.activeMarkerSide === 'left' ? 'right' : 'left'];
    for (const side of sides) {
      acts.push({
        t: 'dustRise',
        artifactId: a.id,
        free: true,
        fuchou: true,
        ...(side ? { side: side as 'left' | 'right' } : {}),
      });
    }
  }
  return acts;
}

function dustRiseActions(g: GameState, player: PlayerId): Action[] {
  const p = g.players[player];
  const acts: Action[] = [];
  // 尘起 = 「使用 1 个冥想骰」→ 走统一求值器（含 010「真实之剑」的 2 颗任意骰置换；尘起支付步的 UI 支持置换）。
  // 不含 034 存放骰（尘起支付步的骰片只列区域骰）——`held:false`，避免"按钮出现却做不完"。
  const hasMed = canPayCosts(g, player, { meditation: 1 }, { held: false });
  // L02 残影（持续）：每个尘起阶段可进行最多 2 次「尘起行动」（默认 1 次）
  const normalLimit = hasActiveSkill(p, 'ying.canying') ? 2 : 1;
  const canNormal = (g.freeDustRise > 0 || g.dustRiseNormalCount < normalLimit) && hasMed;
  // 战术牌 T12「激进」：你自己的**第一个尘起阶段**里，可对**第三列**神器额外充能 1 次（正常支付冥想骰）
  const t12Extra =
    g.firstRound[player] && TACTIC_BY_ID[p.tactic ?? '']?.key === 'jijin' && !p.tacticOnceUsed;
  // 默认候选（仅供 AI/测试；UI 会让玩家自选）：有冥想骰就用它；没有（但可用 010 置换）就用求值器构造的可行填法
  const medId = p.areas.meditation.find((d) => !isValueLocked(g, player, d.value))?.id;
  const medSlot: SlotFill[] | undefined = medId
    ? [{ dieIds: [medId] }]
    : hasMed
      ? defaultCostFills(g, player, { meditation: 1 }, { held: false })
      : undefined;
  // 019 尘起赠予的「无需冥想骰的额外尘起行动」（不占每回合 1 次、不耗尘印）
  const canFree = g.freeNoCostRise > 0;
  // 023「畏惧」（左侧）＝"对方必须消耗 1 颗能力骰"→ **对方没有能力骰时不生成该侧候选**（全模式）。
  //   判定唯一来源 `weijuAvailable`（界面 `dustSideStep` 用同一份 → 不会出现"按钮在但做不完"）。
  const sideOk = (a: Artifact, side: 'left' | 'right' | undefined): boolean =>
    !(a.id === '023' && side === 'left') || weijuAvailable(g, player);
  for (const a of p.artifacts) {
    if (!canTargetForDustRise(a)) continue;
    if (canFree) {
      const sides: ('left' | 'right' | undefined)[] =
        a.column === 3 ? [undefined] : a.activeMarkerSide == null ? ['left', 'right'] : [a.activeMarkerSide === 'left' ? 'right' : 'left'];
      for (const side of sides) {
        if (!sideOk(a, side)) continue;
        acts.push({ t: 'dustRise', artifactId: a.id, free: true, ...(side ? { side: side as 'left' | 'right' } : {}) });
      }
    }
    if (a.column === 3) {
      // 第三列充能：正常尘起次数内，或（T12 额外）首个尘起阶段的第 2 次充能
      if ((canNormal || t12Extra) && medSlot) acts.push({ t: 'dustRise', artifactId: a.id, costSlots: medSlot });
      if (p.hasDustSeal) acts.push({ t: 'dustRise', artifactId: a.id, useSeal: true });
    } else if (a.activeMarkerSide == null) {
      if (canNormal && medSlot) {
        if (sideOk(a, 'left')) acts.push({ t: 'dustRise', artifactId: a.id, side: 'left', costSlots: medSlot });
        if (sideOk(a, 'right')) acts.push({ t: 'dustRise', artifactId: a.id, side: 'right', costSlots: medSlot });
      }
      if (p.hasDustSeal) {
        if (sideOk(a, 'left')) acts.push({ t: 'dustRise', artifactId: a.id, side: 'left', useSeal: true });
        if (sideOk(a, 'right')) acts.push({ t: 'dustRise', artifactId: a.id, side: 'right', useSeal: true });
      }
    } else {
      const other = a.activeMarkerSide === 'left' ? 'right' : 'left';
      if (canNormal && medSlot && sideOk(a, other)) acts.push({ t: 'dustRise', artifactId: a.id, side: other, costSlots: medSlot });
      if (p.hasDustSeal && sideOk(a, other)) acts.push({ t: 'dustRise', artifactId: a.id, side: other, useSeal: true });
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
  if (s.key === 'jingang.alt.pozhang' || s.key === 'jingang.alt.puti') {
    // 默认（AI/测试）：2 个任意点数，取两个相同点（合法输入）
    return { ...base, params: { pips: [1, 1] } };
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
  // 动效旁路："激活"立即发动其技能 → 第二条气泡（技能名）；先由 rise 弹「激活」。
  fxPush({ kind: 'skillFired', player, artifactId, side: s.side, skillKey: s.key, auto: false });
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
    key === 'jingang.puti' ||
    key === 'jingang.alt.pozhang' ||
    key === 'jingang.alt.puti'
  );
}

/** 该技能当前是否属于“可发动”类型（启动 / 必杀；「激活」由尘起装填时强制结算，不在此列） */
function isUsableKind(kind: string): boolean {
  return kind === 'activate' || kind === 'ultimate';
}

/** 走「slots」向导的技能（001/003/007/035）：激活 010 后向导改走 slots 步，而 slots 步暂不支持存放骰
 *  （UI 延期项）→ 这些技能的存放骰在门槛里先不计入，避免"按钮出现但做不完"。其余技能一律计入。 */
const heldForSlotsSkill = (p: PlayerState): boolean => !hasActiveSkill(p, 'shenhong.sword');

/** 某技能本回合的使用次数上限（默认 1；L02 残影：影袭 → 2） */
const skillPerTurnLimit = (p: PlayerState, key: string): number =>
  key === 'yingle.yingxi' && hasActiveSkill(p, 'ying.canying') ? 2 : 1;

function activateSkillActions(g: GameState, p: PlayerState): Action[] {
  const acts: Action[] = [];
  // L08 传奇面板·没有怜悯（持续·尘落前置 4）：024「狂舞」的**必杀**无需激活/充能即可启动（每回合 1 次、不计整局一次）
  const lianminOn = hasActiveSkill(p, 'xiva.meiyoulianmin') && g.dustfall >= 4;
  for (const a of p.artifacts) {
    for (const s of a.skills) {
      if (!isUsableKind(s.kind)) continue;
      const lianminUlt = lianminOn && s.key === 'kuangwu.ultimate';
      if (!lianminUlt && !skillActive(a, s)) continue;
      if (s.kind === 'activation' && !activationUsable(g, a, s)) continue;
      if (s.kind === 'ultimate' && !lianminUlt && g.ultimatesUsed.includes(skillUseKey(p.id, s.key))) continue;
      if (
        g.skillsUsedThisTurn.filter((k) => k === skillUseKey(p.id, s.key)).length >=
        skillPerTurnLimit(p, s.key)
      )
        continue;
      if (s.key === 'buxiang.cuilian') {
        if (a.count >= 3) continue;
        const held = heldForSlotsSkill(p);
        if (!canPayCosts(g, p.id, { attack: 1 }, { held })) continue;
        const atkDice = abilityDicePool(g, p.id).filter((x) => (held || x.source === 'area') && x.kind === 'attack');
        for (const d of atkDice) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots: [{ dieIds: [d.id] }] } });
        }
        // 同类型骰不足时用「真实之剑」置换凑（2 颗任意骰顶 1 颗）
        if (atkDice.length === 0) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots: defaultCostFills(g, p.id, { attack: 1 }, { held }) } });
        }
      } else if (s.key === 'youlong.tengwan') {
        if (canPayCosts(g, p.id, { meditation: 3 }, { held: true })) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots: defaultCostFills(g, p.id, { meditation: 3 }, { held: true }) } });
        }
      } else if (s.key === 'yingle.qianxing') {
        if (canPayCosts(g, p.id, { attack: 2 }, { held: true })) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots: defaultCostFills(g, p.id, { attack: 2 }, { held: true }) } });
        }
      } else if (s.key === 'yuqie.breakthrough') {
        const held = heldForSlotsSkill(p);
        const n = maxAffordableSlots(g, p.id, 'meditation', 3, { held });
        if (n >= 1) {
          const costSlots = defaultCostFills(g, p.id, { meditation: n }, { held });
          const opp: PlayerId = g.activePlayer === 'A' ? 'B' : 'A';
          const oppDef = g.players[opp].areas.defense;
          const required = Math.min(n, oppDef.length);
          const oppDefIds = oppDef.slice(0, required).map((d) => d.id);
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots, opponentDefenseDieIds: oppDefIds } });
        }
      } else if (s.key === 'c01.breakthrough') {
        // C01 特典·突破：消耗任意数量冥想骰（=可支付上限）→ 弃对方等量防御骰（发起者选）
        const n = maxAffordableSlots(g, p.id, 'meditation', 99, { held: true });
        if (n >= 1) {
          const costSlots = defaultCostFills(g, p.id, { meditation: n }, { held: true });
          const opp: PlayerId = g.activePlayer === 'A' ? 'B' : 'A';
          const oppDef = g.players[opp].areas.defense;
          const required = Math.min(n, oppDef.length);
          const oppDefIds = oppDef.slice(0, required).map((d) => d.id);
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots, opponentDefenseDieIds: oppDefIds } });
        }
      } else if (s.key === 'yingle.yingxi') {
        const anyDie = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation].find((d) => d.value >= 2);
        if (anyDie) acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { dieId: anyDie.id, x: 1 } });
      } else if (s.key === 'mingjing.ultimate') {
        acts.push({ t: 'skill', artifactId: a.id, side: s.side });
        // L01 断苇一斩（触发）：若"我上一个回合整回合未造成任何伤害"，可改为"弃置对方**全部**能力骰"
        if (p.legend && hasActiveSkill(p, 'kong.duanweiyizhan') && p.noDamageLastTurn) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { opponentDiscardAll: true } });
        }
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
        if (canPayCosts(g, p.id, { attack: 1 }, { held: true })) {
          const fills = defaultCostFills(g, p.id, { attack: 1 }, { held: true });
          const eff = fills[0].dieIds.length === 2 ? 5 : (findDieOf(g, p.id, fills[0].dieIds[0])?.die.value ?? 5);
          const opp: PlayerId = g.activePlayer === 'A' ? 'B' : 'A';
          const oppDef = g.players[opp].areas.defense.slice(0, eff).map((d) => d.id);
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots: fills, opponentDefenseDieIds: oppDef } });
        }
      } else if (s.key === 'wansha.alt.ultimate') {
        // A07 异相·历王之血之印：对方防御骰数 ≥ 你攻击骰数才能启动；弃置差额（发起者选）
        const opp: PlayerId = p.id === 'A' ? 'B' : 'A';
        const oppDef = g.players[opp].areas.defense;
        const required = oppDef.length - p.areas.attack.length;
        if (required >= 0) {
          acts.push({
            t: 'skill',
            artifactId: a.id,
            side: s.side,
            params: { opponentDefenseDieIds: oppDef.slice(0, required).map((d) => d.id) },
          });
        }
      } else if (s.key === 'zhuzai.sweep') {
        const held = heldForSlotsSkill(p);
        if (canPayCosts(g, p.id, { attack: 1, defense: 1, meditation: 1 }, { held })) {
          const costSlots = defaultCostFills(g, p.id, { attack: 1, defense: 1, meditation: 1 }, { held });
          const opp: PlayerId = g.activePlayer === 'A' ? 'B' : 'A';
          const o = g.players[opp];
          const discard: Record<string, string> = {};
          if (o.areas.attack[0]) discard.attack = o.areas.attack[0].id;
          if (o.areas.defense[0]) discard.defense = o.areas.defense[0].id;
          if (o.areas.meditation[0]) discard.meditation = o.areas.meditation[0].id;
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots, discard } });
        }
      } else if (s.key === 'zhuzai.smash') {
        const held = heldForSlotsSkill(p);
        const kinds = ['attack', 'defense', 'meditation'] as const;
        const kind = kinds.find((k) => canPayCosts(g, p.id, { [k]: 4 }, { held }));
        if (kind) {
          const opp: PlayerId = g.activePlayer === 'A' ? 'B' : 'A';
          acts.push({
            t: 'skill',
            artifactId: a.id,
            side: s.side,
            params: {
              kind,
              costSlots: defaultCostFills(g, p.id, { [kind]: 4 }, { held }),
              opponentDiscardIds: g.players[opp].areas[kind].slice(0, 4).map((d) => d.id),
            },
          });
        }
      } else if (s.key === 'tiebi.fist') {
        if (canPayCosts(g, p.id, { meditation: 2 }, { held: true })) {
          acts.push({
            t: 'skill',
            artifactId: a.id,
            side: s.side,
            params: {
              costSlots: defaultCostFills(g, p.id, { meditation: 2 }, { held: true }),
              defenseDieIds: p.areas.defense.slice(0, 2).map((d) => d.id),
            },
          });
        }
      } else if (s.key === 'guwang.ultimate') {
        acts.push({ t: 'skill', artifactId: a.id, side: s.side });
      } else if (s.key === 'dunwu.barrier.activate') {
        // 011 灵能屏障（激活）：消耗 1–3 防御骰（含置换；含 034/A03 存放骰）
        const n = maxAffordableSlots(g, p.id, 'defense', 3, { held: true });
        if (n >= 1) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots: defaultCostFills(g, p.id, { defense: n }, { held: true }) } });
        }
      } else if (s.key === 'dunwu.pulse.activate') {
        // 011 灵能脉冲（激活）：消耗 1–3 攻击骰（含置换；含 034/A03 存放骰）
        const n = maxAffordableSlots(g, p.id, 'attack', 3, { held: true });
        if (n >= 1) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots: defaultCostFills(g, p.id, { attack: n }, { held: true }) } });
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
        // 017 冥界行走（启动）：消耗最多 3 冥想骰 → 获得同等数量随机攻击骰（含置换；含 034/A03 存放骰）
        const n = maxAffordableSlots(g, p.id, 'meditation', 3, { held: true });
        if (n >= 1) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots: defaultCostFills(g, p.id, { meditation: n }, { held: true }) } });
        }
      } else if (s.key === 'zhihai.bloom.ultimate') {
        // 018 漆黑绽放（必杀）：计数 ≥1 时可主动发动（FAQ 18.1.3）；计数=5 由引擎强制发动
        if (a.count >= 1) acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: {} });
      } else if (s.key === 'chenai.fang') {
        // 019 蛮王之牙（启动）：默认消耗 1 个任意能力骰 + 选择 ② 获得 1 个 3 点攻击骰
        const anyDie = abilityDicePool(g, p.id)[0];
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
        const anyDie = abilityDicePool(g, p.id)[0];
        if (anyDie) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { dieIds: [anyDie.id] } });
        }
      } else if (s.key === 'shexie.weiju') {
        // 023 蛇蝎·畏惧（启动）：我方与对方都必须有至少 1 颗能力骰，否则不能发动（我方可用 034/A03 存放骰）
        const opp: PlayerId = p.id === 'A' ? 'B' : 'A';
        const anyDie = abilityDicePool(g, p.id)[0];
        const oppDice = [...g.players[opp].areas.attack, ...g.players[opp].areas.defense, ...g.players[opp].areas.meditation];
        if (anyDie && oppDice.length >= 1) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { dieId: anyDie.id } });
        }
      } else if (s.key === 'shexie.gongzhen') {
        // 023 蛇蝎·共振（启动）：默认重掷我方第 1 颗骰（存放骰不在区域、不可重掷 → 只列区域真骰）
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
        // 030 救赎·寰宇飞升（必杀）：消耗 4 个冥想骰（含置换；含 034/A03 存放骰）
        if (canPayCosts(g, p.id, { meditation: 4 }, { held: true })) {
          acts.push({
            t: 'skill',
            artifactId: a.id,
            side: s.side,
            params: { costSlots: defaultCostFills(g, p.id, { meditation: 4 }, { held: true }) },
          });
        }
      } else if (s.key === 'mengyan.eyi') {
        // 032 梦魇·恶意（启动）：消耗 1 个攻击骰 → 获得 2 个随机点数冥想骰（含置换；含 034/A03 存放骰）
        if (canPayCosts(g, p.id, { attack: 1 }, { held: true })) {
          acts.push({
            t: 'skill',
            artifactId: a.id,
            side: s.side,
            params: { costSlots: defaultCostFills(g, p.id, { attack: 1 }, { held: true }) },
          });
        }
      } else if (s.key === 'qianjie.chaodu') {
        // 035 千劫·超度（启动）：消耗 2 颗点数相同的冥想骰 → 5 真伤 → 重掷任意玩家一区
        // 存放骰：向导为 slots 步（激活 010 时）→ held=false；否则 dice 步（含存放骰）→ held=true
        const held = heldForSlotsSkill(p);
        const med = abilityDicePool(g, p.id).filter((x) => (held || x.source === 'area') && x.kind === 'meditation');
        const byVal = new Map<number, string[]>();
        for (const d of med) {
          const arr = byVal.get(d.value) ?? [];
          arr.push(d.id);
          byVal.set(d.value, arr);
        }
        let fills: SlotFill[] | null = null;
        const pairIds = [...byVal.values()].find((ids) => ids.length >= 2);
        if (pairIds) {
          // ① 真骰/存放骰里已有同点对
          fills = [{ dieIds: [pairIds[0]] }, { dieIds: [pairIds[1]] }];
        } else if (hasActiveSkill(p, 'shenhong.sword')) {
          // ② 用「真实之剑」置换凑「两颗 5 点」：真/存放 5 点 + 1 格置换（=5），或两颗都置换（=5,5）
          const pool = abilityDicePool(g, p.id).filter((x) => held || x.source === 'area');
          const five = med.find((d) => d.value === 5);
          if (five) {
            const rest = pool.filter((x) => x.id !== five.id);
            if (rest.length >= 2) fills = [{ dieIds: [five.id] }, { dieIds: [rest[0].id, rest[1].id] }];
          }
          if (!fills && pool.length >= 4) {
            fills = [{ dieIds: [pool[0].id, pool[1].id] }, { dieIds: [pool[2].id, pool[3].id] }];
          }
        }
        if (fills) {
          acts.push({
            t: 'skill',
            artifactId: a.id,
            side: s.side,
            params: { costSlots: fills, targetOwner: 'opponent', targetKind: 'attack' },
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
  // 传奇英雄面板技能（开局即可用、无需激活）：需要玩家点击发动的「必杀 / 启动」类
  const lg = p.legend;
  if (lg) {
    for (const s of lg.skills) {
      if (s.kind !== 'ultimate' && s.kind !== 'activate') continue;
      if (g.ultimatesUsed.includes(skillUseKey(p.id, s.key))) continue;
      if (
        g.skillsUsedThisTurn.filter((k) => k === skillUseKey(p.id, s.key)).length >=
        skillPerTurnLimit(p, s.key)
      )
        continue;
      if (!legendSkillReady(g, p.id, s.key)) continue; // 尘落前置 + 个别额外前提（唯一来源）
      // 面板可能同时含「启动 / 必杀」→ 动作带上 key，供引擎与界面精确区分
      acts.push({ t: 'skill', artifactId: lg.id, side: 'only', params: { legendKey: s.key } });
    }
  }
  return acts;
}

/**
 * 传奇面板技能当前**是否可发动**（引擎与界面**同一来源**）：尘落前置 + 个别技能的额外前提。
 * `getLegalActions` 与 `render.ts` 的技能行灰绿判定都必须走这里（否则会出现"界面绿、引擎不给动作"的不一致）。
 */
export function legendSkillReady(g: GameState, player: PlayerId, key: string): boolean {
  if (g.dustfall < (LEGEND_DUSTFALL_REQ[key] ?? 0)) return false; // 尘落前置
  // L07「不屈咆哮」：还要求「决意」**当前计数 ≥ 1**（计数 0 时不给按钮——否则弃 0 颗却把计数重设为 1）
  if (key === 'nisa.buqupaoxiao') {
    const p = g.players[player];
    const jy = p.artifacts.find((a) => a.skills.some((x) => x.key === 'jueyi.wildfire'));
    if (!jy || jy.count < 1) return false;
  }
  // L09「遍野残杀」：还要求**你的所有神器均处于激活状态**（每件至少一侧有激活标记；第三列＝充能满）
  if (key === 'lifeng.bianyecansha') {
    const p = g.players[player];
    if (!p.artifacts.every((a) => a.activeMarkerSide != null)) return false;
  }
  return true;
}

/**
 * 「必杀就绪」唯一来源：该玩家当前是否有**可发动的必杀式**（只看"就绪前提"，**不看是否轮到他行动、
 * 也不看是否付得起代价**）。供战术牌 T04「末路」的"生效中"（绿）判定。
 * - 第三列神器必杀：充能满（已激活，`skillActive` 成立）且未用尽；
 * - **没有怜悯**（L08）：持 `xiva.meiyoulianmin` 且尘落 ≥4 时，024「狂舞」的必杀**无需充能**即算就绪；
 * - 传奇面板必杀：`legendSkillReady`（尘落前置等）且未用尽；
 * 均需本回合次数上限未用完。
 */
export function hasReadyUltimate(g: GameState, player: PlayerId): boolean {
  const p = g.players[player];
  const lianmin = hasActiveSkill(p, 'xiva.meiyoulianmin') && g.dustfall >= 4;
  const perTurnLeft = (key: string): boolean =>
    g.skillsUsedThisTurn.filter((k) => k === skillUseKey(player, key)).length < skillPerTurnLimit(p, key);
  for (const a of p.artifacts) {
    for (const s of a.skills) {
      if (s.kind !== 'ultimate') continue;
      const lianminUlt = lianmin && s.key === 'kuangwu.ultimate';
      if (!lianminUlt) {
        if (!skillActive(a, s)) continue;
        if (g.ultimatesUsed.includes(skillUseKey(player, s.key))) continue;
      }
      if (!perTurnLeft(s.key)) continue;
      return true;
    }
  }
  const lg = p.legend;
  if (lg) {
    for (const s of lg.skills) {
      if (s.kind !== 'ultimate') continue;
      if (g.ultimatesUsed.includes(skillUseKey(player, s.key))) continue;
      if (!legendSkillReady(g, player, s.key)) continue;
      if (!perTurnLeft(s.key)) continue;
      return true;
    }
  }
  return false;
}

export function getLegalActions(g: GameState): Action[] {
  if (g.phase === 'gameOver') return [];
  // 战术牌·战前抽 2 留 1：只枚举**当前选者**手里的 2 张（有待决策时交给下面的 pending 分支）
  if (g.phase === 'tactics' && !g.pending) {
    if (!g.tacticQueue[0]) return [];
    return g.tacticHand.map((id) => ({ t: 'tacticPick' as const, id }));
  }

  if (g.pending) {
    if (g.pending.kind === 'caiyuliu') {
      return [
        { t: 'caiyuliu', to: null },
        { t: 'caiyuliu', to: 'defense' },
        { t: 'caiyuliu', to: 'meditation' },
      ];
    }
    if (g.pending.kind === 'c01Caiyuliu') {
      return [
        { t: 'c01Caiyuliu', accept: true },
        { t: 'c01Caiyuliu', accept: false },
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
    if (g.pending.kind === 'aidao') {
      const opp: PlayerId = g.pending.player === 'A' ? 'B' : 'A';
      const defense = g.players[opp].areas.defense;
      // 有防御骰时必须弃置 1 颗（由持有者选择弃哪颗）→ 不给"不弃骰"的发动选项；无则仅造成 2 点真实伤害。
      // 只能从对方**区域内**的防御骰中选（034 破障的存放骰不属区域 → 不可选）。
      const fire: Action[] = defense.length
        ? defense.map((d) => ({ t: 'aidao' as const, accept: true, defenseDieId: d.id }))
        : [{ t: 'aidao' as const, accept: true }];
      return [{ t: 'aidao', accept: false }, ...fire];
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
    if (g.pending.kind === 'shizushouhun') {
      const p = g.players[g.pending.player];
      const acts: Action[] = [{ t: 'shizushouhun', accept: false }];
      // 默认填法（仅供 AI / 测试）；UI 会走「@shizushouhun」选择器让玩家自选冥想骰
      const medId = p.areas.meditation[0]?.id;
      const fills: SlotFill[] | undefined = medId
        ? [{ dieIds: [medId] }]
        : defaultCostFills(g, p.id, { meditation: 1 }, { held: true });
      if (fills) acts.push({ t: 'shizushouhun', accept: true, costSlots: fills });
      return acts;
    }
    if (g.pending.kind === 'shangjin') {
      const p = g.players[g.pending.player];
      const acts: Action[] = [{ t: 'shangjin', decline: true }];
      // 可选项 = 你**已激活**的「启动式」技能（UI 会为每个选项打开该技能自己的选择器，
      // 由 `case 'skill'` 在 `shangjin` 待决策存在时按"不计入每回合上限"执行）
      for (const a of p.artifacts) {
        for (const s of a.skills) {
          if (s.kind !== 'activate') continue;
          if (!skillActive(a, s)) continue;
          acts.push({ t: 'shangjin', artifactId: a.id, side: s.side, skillKey: s.key });
        }
      }
      return acts;
    }
    if (g.pending.kind === 'dizuidaijianshu') {
      // 不发动 / 发动（具体 2 颗由选择器补全；`{t:'dizuidaijianshu'}` 形式供 UI 拦截后打开面板）
      return [{ t: 'dizuidaijianshu', accept: false }, { t: 'dizuidaijianshu' }];
    }
    if (g.pending.kind === 'nudengzuiren') {
      return [
        { t: 'nudengzuiren', accept: false },
        { t: 'nudengzuiren', accept: true },
      ];
    }
    if (g.pending.kind === 'duanexing') {
      // 不发动 / 弃置对方 1 个**攻击骰**（选哪颗由玩家决定；仅取对方攻击骰区，神上存放骰不算）
      const opp = g.players[g.pending.player === 'A' ? 'B' : 'A'];
      return [
        { t: 'duanexing', accept: false },
        ...opp.areas.attack.map((d) => ({ t: 'duanexing' as const, accept: true, dieId: d.id })),
      ];
    }
    if (g.pending.kind === 'tacticDice') {
      // 默认动作（供 AI/测试）：按分布每类最多取 4 颗、凑满意志数；真人由 UI 弹窗自选
      const p = g.players[g.pending.player];
      const dist = emptyDistribution(p) ?? { attack: [1, 2], defense: [3, 4], meditation: [5, 6] };
      const will = effectiveWill(p);
      const values: number[] = [];
      for (const kind of ['attack', 'defense', 'meditation'] as const) {
        for (let i = 0; i < 4 && values.length < will && dist[kind].length > 0; i++) {
          values.push(dist[kind][0]);
        }
      }
      return [{ t: 'tacticDice', values }];
    }
    if (g.pending.kind === 'tacticFirst') {
      return [
        { t: 'tacticFirst', who: 'A' },
        { t: 'tacticFirst', who: 'B' },
      ];
    }
    if (g.pending.kind === 'tacticGuess') {
      return [
        { t: 'tacticGuess', who: 'A' },
        { t: 'tacticGuess', who: 'B' },
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
    // 挑战模式·代决：把该待决策的全部候选直接枚举（挑战者代为决定）
    if (g.pending.kind === 'challengePick') {
      return g.pending.options.map((o) => ({ t: 'challengePick' as const, id: o.id }));
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
    if (g.pending.kind === 'anyexiongshen') {
      return [
        { t: 'anyexiongshen', accept: true },
        { t: 'anyexiongshen', accept: false },
      ];
    }
    if (g.pending.kind === 'bacheng') {
      return [
        { t: 'bacheng', accept: true },
        { t: 'bacheng', accept: false },
      ];
    }
    if (g.pending.kind === 'yuanwu') {
      // L06 圆舞：强制——选 1 颗能力骰 + 目标区域（默认供 AI/测试；真人走两步选择器）
      const pd = g.pending;
      const pp = g.players[pd.player];
      const acts: Action[] = [];
      for (const k of ['attack', 'defense', 'meditation'] as DiceKind[]) {
        for (const d of pp.areas[k]) {
          const dest = (['attack', 'defense', 'meditation'] as DiceKind[]).find((x) => x !== k);
          if (dest) acts.push({ t: 'yuanwu', dieId: d.id, to: dest });
        }
      }
      return acts;
    }
    if (g.pending.kind === 'fuchouRise') {
      return fuchouRiseActions(g, g.pending.player);
    }
    if (g.pending.kind === 'wufaraoshu') {
      const pd = g.pending;
      const opp: PlayerId = pd.player === 'A' ? 'B' : 'A';
      const acts: Action[] = [{ t: 'wufaraoshu', choice: 'decline' }];
      for (const d of g.players[opp].areas.defense) {
        if (d.value === pd.value) acts.push({ t: 'wufaraoshu', choice: 'discard', dieId: d.id });
      }
      return acts;
    }
    if (g.pending.kind === 'kongYuluo') {
      // L01 雨落狂流：①弃置对方 1 个能力骰（逐颗列举）/②获得 1 随机点数能力骰并移入任意区域/不发动
      const pd = g.pending;
      const opp: PlayerId = pd.player === 'A' ? 'B' : 'A';
      const o = g.players[opp];
      const acts: Action[] = [
        { t: 'kongYuluo', choice: 'decline' },
        { t: 'kongYuluo', choice: 'gain', kind: 'attack' },
        { t: 'kongYuluo', choice: 'gain', kind: 'defense' },
        { t: 'kongYuluo', choice: 'gain', kind: 'meditation' },
      ];
      for (const k of ['attack', 'defense', 'meditation'] as DiceKind[]) {
        for (const d of o.areas[k]) acts.push({ t: 'kongYuluo', choice: 'discard', dieId: d.id, kind: k });
      }
      return acts;
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
      // 默认（AI/测试）：选择全部不同、弃掉重复项（每点数留 1 颗）——也是"最少弃"的那一档
      const p = g.players[g.pending.owner ?? g.pending.player];
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
    if (g.pending.kind === 'ciBei') {
      return [
        { t: 'ciBei', accept: true },
        { t: 'ciBei', accept: false },
      ];
    }
    if (g.pending.kind === 'yuhuiPlace') {
      const areas: DiceKind[] = ['attack', 'defense', 'meditation'];
      const out: Action[] = [];
      for (const a of areas) for (const b of areas) out.push({ t: 'yuhuiPlace', areas: [a, b] });
      return out;
    }
    if (g.pending.kind === 'yingziPick') {
      return [1, 2, 3, 4, 5, 6].map((value) => ({ t: 'yingziPick' as const, value }));
    }
    if (g.pending.kind === 'yuanjianGain') {
      // 完整枚举：6 点数 × 3 区域（真人由 UI 面板呈现）
      const out: Action[] = [];
      for (let value = 1; value <= 6; value++) {
        for (const area of ['attack', 'defense', 'meditation'] as DiceKind[]) {
          out.push({ t: 'yuanjianGain', value, area });
        }
      }
      return out;
    }
    if (g.pending.kind === 'youdiMove') {
      // 不发动 + 默认（AI/测试）：取第一个非空区域的前 1 颗 → 另一个区域
      const p = g.players[g.pending.player];
      const out: Action[] = [{ t: 'youdiMove', cancel: true }];
      const areas: DiceKind[] = ['attack', 'defense', 'meditation'];
      for (const from of areas) {
        if (p.areas[from].length === 0) continue;
        const to = areas.find((k) => k !== from)!;
        out.push({ t: 'youdiMove', from, to, dieIds: [p.areas[from][0].id] });
        break;
      }
      return out;
    }
    if (g.pending.kind === 'shipeiPick') {
      const pd = g.pending;
      const out: Action[] = [{ t: 'shipeiPick', cancel: true }];
      if (pd.dieIds.length > 0) out.push({ t: 'shipeiPick', dieId: pd.dieIds[0], value: 1 });
      return out;
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
    // T01「谨慎」：没有初始重掷步骤（此前仍会枚举出一个"点了就抛错"的「重掷」选项）
    const noStep = TACTIC_BY_ID[p.tactic ?? '']?.key === 'qingzhen';
    if (all.length && !noStep) acts.push({ t: 'reroll', dieIds: all });
    return acts;
  }

  if (g.pendingAttack) {
    const pa = g.pendingAttack;
    const defender: PlayerId = pa.attacker === 'A' ? 'B' : 'A';
    // 单人挑战：传奇按「防御规则」抵挡（伤害 < 门槛 → 不给任何抵挡动作＝自动不挡）
    const card =
      g.mode === 'challenge' && defender === 'B'
        ? CHALLENGES.find((c) => c.id === g.challenge?.cardId)
        : undefined;
    const legendBlocks = card == null || legendCanBlock(card, pa.value);
    // 传奇防御规则：伤害 ≥ 门槛且传奇有可用骰 → **必须挡**（只给"用哪颗骰抵挡"，不给"不抵御"）。
    // 仅 标准模式 / 不可抵挡 / 伤害不足 / 传奇无可用骰 时才放"不抵挡"。
    const legendMustBlock = card != null && legendBlocks && !pa.unblockable;
    const dieBlocks: Action[] = [];
    if (!pa.unblockable && legendBlocks) {
      // 028 天罚：只能用指定类型的骰抵挡（白昼之火=冥想 / 陨落=攻击）；否则用防御骰
      const kind = pa.blockKind ?? 'defense';
      for (const d of g.players[defender].areas[kind]) {
        if (isValueLocked(g, defender, d.value)) continue; // Z12「不动菩提」：封锁点数的骰不可用于抵挡
        dieBlocks.push({ t: 'block', costSlots: [{ dieIds: [d.id] }] });
      }
      for (const h of heldAbilityDice(g, defender)) {
        if (h.kind === kind) dieBlocks.push({ t: 'block', costSlots: [{ dieIds: [h.id] }] });
      }
    }
    const acts: Action[] = [];
    if (!legendMustBlock || dieBlocks.length === 0) acts.push({ t: 'block' });
    acts.push(...dieBlocks);
    return acts;
  }

  // 挑战模式：轮到传奇且它已"停一下"→ 唯一可枚举动作＝推进一条（界面按节奏自动派发）
  if (
    g.mode === 'challenge' &&
    g.activePlayer === 'B' &&
    !g.pending &&
    !g.pendingAttack &&
    !g.attackQueue &&
    !g.virtualQueue &&
    (g.challenge?.resumeAt != null || g.challenge?.startNextTurnAfterPending)
  ) {
    return [{ t: 'challengeStep' }];
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
      // 战术牌 T16「潜伏」：双方各自的第一个回合内不能进行攻击（不产出任何 attack 动作）
      if (!attacksBanned(g)) {
        for (const d of p.areas.attack) {
          if (isValueLocked(g, g.activePlayer, d.value)) continue; // Z12「不动菩提」：封锁点数的骰不可用于攻击
          acts.push({ t: 'attack', costSlots: [{ dieIds: [d.id] }] });
        }
        // 034 破障（持续）：神器上存放的骰按分布视为攻击骰时，也可用于发起攻击
        for (const h of heldAbilityDice(g, g.activePlayer)) {
          if (h.kind === 'attack') acts.push({ t: 'attack', costSlots: [{ dieIds: [h.id] }] });
        }
        // 025 屠虎·奇袭（持续）：把「点数不在对方任意区域」的能力骰**视为攻击骰**发起攻击
        // （默认候选供 AI/测试；真人由 UI 显式选择）
        if (hasActiveSkill(p, 'tuohu.qixi')) {
          for (const k of ['defense', 'meditation'] as const) {
            for (const d of p.areas[k]) {
              if (isValueLocked(g, g.activePlayer, d.value)) continue; // Z12「不动菩提」
              if (canTreatAsAttack(g, g.activePlayer, d.id)) {
                acts.push({ t: 'attack', costSlots: [{ dieIds: [d.id], treated: true }] });
              }
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
/** 每种「待决策」对应的解算动作类型（替代手写白名单，新增 pending 时只需在此登记） */
const PENDING_ACTION: Record<Pending['kind'], Action['t']> = {
  challengePick: 'challengePick',
  caiyuliu: 'caiyuliu',
  c01Caiyuliu: 'c01Caiyuliu',
  fengmang: 'fengmang',
  guwangCharge: 'guwangCharge',
  guwangCancel: 'guwangCancel',
  shenhongKill: 'shenhongKill',
  aidao: 'aidao',
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
  ciBei: 'ciBei',
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
  kongYuluo: 'kongYuluo',
  anyexiongshen: 'anyexiongshen',
  bacheng: 'bacheng',
  fuchouRise: 'dustRise',
  wufaraoshu: 'wufaraoshu',
  yuanwu: 'yuanwu',
  shizushouhun: 'shizushouhun',
  shangjin: 'shangjin',
  dizuidaijianshu: 'dizuidaijianshu',
  nudengzuiren: 'nudengzuiren',
  duanexing: 'duanexing',
  tacticDice: 'tacticDice',
  tacticFirst: 'tacticFirst',
  tacticGuess: 'tacticGuess',
  yuhuiPlace: 'yuhuiPlace',
  yingziPick: 'yingziPick',
  yuanjianGain: 'yuanjianGain',
  youdiMove: 'youdiMove',
  shipeiPick: 'shipeiPick',
};

/**
 * 动作入口。外面包一层 `try/catch` 只服务于 L11「永恒女王」：该技能要求"取消该伤害与**所有尚待结算的
 * 效果和阶段**"，唯一可靠做法是让当前结算栈**立即展开**（抛 `YonghengQueenSignal`），在这里统一收尾
 * （清空待决策/多段队列/延后攻击 → 立即开始该玩家的全新回合）。其它异常**原样抛出**（绝不吞错）。
 */
export function applyAction(g: GameState, action: Action): GameState {
  fxReset(); // 动效旁路事件：每次动作开始清空
  try {
    return applyActionCore(g, action);
  } catch (e) {
    if (e instanceof YonghengQueenSignal) {
      runYonghengQueen(g, e.target);
      return g;
    }
    throw e;
  }
}

/** L11 永恒女王：取消一切 + 立即开始该玩家的一个**全新回合**（整局 1 次；标记在进入时已置） */
function runYonghengQueen(g: GameState, target: PlayerId): void {
  logLine(g, `${pname(target)} 「永恒女王」：取消该伤害与所有尚待结算的效果/阶段 → 立即开始 1 个新的回合`);
  fxSkillFired(g, target, 'aiwa.yonghengnvwang');
  g.legendOnceUsed.push(skillUseKey(target, 'aiwa.yonghengnvwang'));
  // 被打断的玩家＝当前回合玩家。永恒女王**只取消"将来触发的效果/阶段"**，不撤销已生效状态：
  //  - 不跑其"回合结束时触发"（遍野残杀不死、寒光骰不弃、残响不 −1）——这些是将来触发；
  //  - 但"只持续一回合"的状态照常到期（本回合攻击加成、023 畏惧的"下个回合减半"）；
  //  - 且其"有过一个回合"要记账（首回合标记置否），避免下个回合被误当首回合而跳过补充/重掷。
  const actor = g.activePlayer;
  const ap = g.players[actor];
  ap.buffs = ap.buffs.filter((b) => b.duration !== 'thisTurn');
  ap.attackHalvedNextTurn = false;
  g.firstRound[actor] = false;
  // 取消所有尚待结算：待决策链、待抵挡、多段攻击队列、延后攻击、额外重掷
  g.pending = null;
  g.pendingQueue = [];
  g.pendingAttack = null;
  g.attackQueue = null;
  g.virtualQueue = null;
  g.extraReroll = null;
  // 立即开始该玩家的一个全新回合（正常规则：补充按意志补骰、照常重掷；不是"补满"）
  g.activePlayer = target;
  g.firstRound[target] = false;
  g.turnIndex += 1;
  beginTurn(g);
}

function applyActionCore(g: GameState, action: Action): GameState {
  if (g.phase === 'gameOver') throw new Error('game is over');
  // L08「只为赏金而来」：该待决策下，除 `shangjin`（不发动/选技能）外还允许派发 `skill`
  //（选中的技能需要走它自己的选择器补全参数，最后以 `{t:'skill',…}` 提交）
  const shangjinSkill = g.pending?.kind === 'shangjin' && action.t === 'skill';
  if (g.pending && action.t !== PENDING_ACTION[g.pending.kind] && !shangjinSkill) {
    throw new Error('resolve pending decision first');
  }
  switch (action.t) {
    case 'tacticPick': {
      if (g.phase !== 'tactics') throw new Error('not tactics phase');
      const who = g.tacticQueue[0];
      if (!who) throw new Error('no tactic picker');
      if (!g.tacticHand.includes(action.id)) throw new Error(`not in tactic hand: ${action.id}`);
      g.players[who].tactic = action.id;
      logLine(g, `${pname(who)} 战术牌：选择「${TACTIC_BY_ID[action.id]?.name ?? action.id}」`);
      g.tacticQueue.shift();
      if (g.tacticQueue.length > 0) {
        g.activePlayer = g.tacticQueue[0];
        drawNextTacticHand(g); // 从剩余池抽 → 天然不含对方所选
      } else {
        // 双方都选完 → 再统一挂"战斗开始时"交互（T01 选骰 / T02 先手）；生命修正留到战前收口
        g.tacticHand = [];
        for (const id of ['A', 'B'] as PlayerId[]) applyTacticStart(g, id);
      }
      break;
    }
    case 'tacticDice': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'tacticDice') throw new Error('no tacticDice pending');
      const p = g.players[pd.player];
      const dist = emptyDistribution(p);
      if (!dist) throw new Error('no distribution');
      const will = effectiveWill(p);
      if (action.values.length !== will) throw new Error(`「谨慎」需恰好 ${will} 颗`);
      const counts: Record<DiceKind, number> = { attack: 0, defense: 0, meditation: 0 };
      for (const v of action.values) {
        if (!Number.isInteger(v) || v < 1 || v > 6) throw new Error(`非法点数：${v}`);
        counts[areaOf(v, dist)] += 1;
      }
      if (counts.attack > 4 || counts.defense > 4 || counts.meditation > 4) {
        throw new Error('「谨慎」：同类型能力骰不能超过 4 个');
      }
      // 先校验后落状态
      g.pending = null;
      p.areas.attack = [];
      p.areas.defense = [];
      p.areas.meditation = [];
      for (const v of action.values) placeDieByDistribution(p.areas, createDie(newDieId(`${pd.player}-`), v), dist);
      logLine(g, `${pname(pd.player)} 「谨慎」：自定初始能力骰点数（${action.values.join('、')}）`);
      break;
    }
    case 'tacticFirst': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'tacticFirst') throw new Error('no tacticFirst pending');
      if (action.who !== 'A' && action.who !== 'B') throw new Error('invalid first player');
      g.pending = null;
      applyFirstPlayer(g, action.who);
      logLine(
        g,
        `${pname(pd.player)} 「先机」：指定 ${pname(action.who)} 为先手；尘印标记归 ${pname(action.who === 'A' ? 'B' : 'A')}`,
      );
      break;
    }
    case 'tacticGuess': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'tacticGuess') throw new Error('no tacticGuess pending');
      if (action.who !== 'A' && action.who !== 'B') throw new Error('invalid guess player');
      g.pending = null;
      g.players[pd.player].tacticGuess = action.who;
      logLine(g, `${pname(pd.player)} 「远见」：猜测 ${pname(action.who)} 将最先降为 20 点或以下`);
      break;
    }
    case 'advance':
      doAdvance(g);
      break;
    case 'reroll': {
      if (g.phase === 'initialReroll') {
        const p = g.players[g.activePlayer];
        // T01「谨慎」：你没有对初始能力骰的重掷步骤
        if (TACTIC_BY_ID[p.tactic ?? '']?.key === 'qingzhen') {
          throw new Error('「谨慎」：没有初始重掷步骤');
        }
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
      // 龙游万象（002 持续）：把重掷上限提到 2 → **第 2 次**重掷＝它多给的那次 → 弹它的气泡
      if (g.rerollUsed >= 2 && hasActiveSkill(g.players[g.activePlayer], 'youlong.wanxiang')) {
        fxSkillFired(g, g.activePlayer, 'youlong.wanxiang');
      }
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
        fxSkillFired(g, pd.player, 'minglei.leibao.trigger');
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
      if (new Set(ids).size !== ids.length) throw new Error('电刑的 2 个冥想骰不可重复');
      for (const id of ids) {
        const info = abilityDieInfo(g, pd.player, id);
        if (!info || info.kind !== 'meditation') throw new Error(`电刑需要冥想骰: ${id}`);
      }
      g.pending = null;
      fxSkillFired(g, pd.player, 'minglei.dianxing'); // 013 / A08（按持有者实际 key）
      fxSkillFired(g, pd.player, 'minglei.alt.dianxing');
      // 「消耗 2 个冥想骰」→ 走 paySlots（与「使用/消耗」语义一致：支持 010 置换 / 034 破障）
      const eff = paySlots(
        g,
        pd.player,
        [{ kind: 'meditation' }, { kind: 'meditation' }],
        ids.map((id) => ({ dieIds: [id] })),
        undefined,
        'skill',
      );
      const pickedVals = eff.map((e) => e.value);
      const vals = pd.values ?? dianxingValuesOf(g.players[pd.player]) ?? [1, 2, 3];
      // §19⑨ 多段攻击源：013 电刑 / A08 将至的电刑（attackQueue）
      g.attackQueue = { player: pd.player, values: [...vals] };
      logLine(
        g,
        `${pname(pd.player)} 发动「电刑」：消耗 2 个冥想骰（${pickedVals.join('/')}点），依次以 ${vals.join('、')} 点各进行一次攻击`,
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
      fxSkillFired(g, pd.player, 'minglei.leibao.trigger');
      pumpAttackQueue(g);
      break;
    }
    case 'dustRise': {
      // 019 尘起赠予的免费额外尘起（可在主要阶段立即使用，不耗冥想骰、不占每回合 1 次）
      // L05 复仇之灵：强制额外尘起（同上，且不消耗 019 的计数）
      if (action.fuchou) {
        // 强制额外尘起：无阶段/计数门槛
      } else if (action.free) {
        if (g.freeNoCostRise <= 0) throw new Error('no free dust rise available');
      } else if (g.phase !== 'dustRise') {
        throw new Error('not dust rise phase');
      }
      // L05 复仇之灵：强制尘起**可能属于"非当前回合玩家"**（如对方回合中其生命十位数变化）→ 一切按**归属玩家**取
      const who: PlayerId =
        action.fuchou && g.pending && g.pending.kind === 'fuchouRise' ? g.pending.player : g.activePlayer;
      const p = g.players[who];
      // 第三列：只有「本次充能完成激活」时才结算该神器的「激活」技能（续充不重复结算）
      const beforeRise = p.artifacts.find((x) => x.id === action.artifactId);
      const wasFullyCharged = beforeRise?.column === 3 && beforeRise.chargeLayer >= (beforeRise.chargeReq ?? 0);
      const wasSwitching = beforeRise?.activeMarkerSide != null; // 本次是"切换"（而非首次激活）
      if (action.fuchou) {
        // L05 复仇之灵：强制额外尘起——不耗冥想骰、不占次数、不消耗 019 的 freeNoCostRise；结算该待决策
        if (g.pending && g.pending.kind === 'fuchouRise') g.pending = null;
      } else if (action.free) {
        g.freeNoCostRise -= 1;
      } else if (action.useSeal) {
        if (!p.hasDustSeal) throw new Error('no dust seal');
        p.hasDustSeal = false;
      } else {
        if (g.freeDustRise > 0) {
          g.freeDustRise -= 1;
        } else if (g.dustRiseNormalCount < (hasActiveSkill(p, 'ying.canying') ? 2 : 1)) {
          g.dustRiseNormalCount += 1;
          // 残影（L02 持续）：把尘起上限提到 2 → 第 2 次＝它多给的那次 → 弹「残影」
          if (g.dustRiseNormalCount >= 2) fxSkillFired(g, who, 'ying.canying');
        } else if (
          // 战术牌 T12「激进」：你自己的**第一个尘起阶段**里，可对**第三列**神器额外充能 1 次（正常支付冥想骰）
          g.firstRound[who] &&
          TACTIC_BY_ID[p.tactic ?? '']?.key === 'jijin' &&
          !p.tacticOnceUsed &&
          beforeRise?.column === 3
        ) {
          p.tacticOnceUsed = true;
          fxTacticFired(g, who); // 动效旁路：战术栏弹「激进」
          logLine(g, `${pname(who)} 「激进」：第一个尘起阶段 → 对第三列神器进行 1 次额外充能`);
        } else {
          throw new Error('no dust rise action available');
        }
        assertConversionAllowed(g, who, action.costSlots);
        if (!action.costSlots || action.costSlots.length === 0) throw new Error('costSlots required');
        paySlots(g, who, [{ kind: 'meditation' }], action.costSlots, undefined, 'dustRise');
      }
      const desc = applyDustRiseToArtifact(g, who, action.artifactId, action.side);
      logLine(g, `${pname(who)} 尘起：${desc}${action.useSeal ? '（使用尘印标记）' : ''}`);
      // 动效旁路：尘起"开"气泡（切换 / 激活 / 充能）。第三列＝充能（侧按 'only' 取名）
      fxPush({
        kind: 'rise',
        player: who,
        artifactId: action.artifactId,
        side: beforeRise?.column === 3 ? 'only' : (action.side ?? 'left'),
        mode: beforeRise?.column === 3 ? 'charge' : wasSwitching ? 'switch' : 'activate',
      });
      // 战术牌 T10「迂回」：你**第一次切换**一件**不含「激活」技能**的神器后 → 获得 2 个 1 点能力骰（待放置）
      if (
        wasSwitching &&
        beforeRise &&
        !beforeRise.skills.some((s) => s.kind === 'activation') &&
        TACTIC_BY_ID[p.tactic ?? '']?.key === 'yuhui' &&
        !p.tacticOnceUsed
      ) {
        p.tacticOnceUsed = true;
        queuePending(g, { kind: 'yuhuiPlace', player: who });
        fxTacticFired(g, who);
        logLine(g, `${pname(who)} 「迂回」：第一次切换神器 → 获得 2 个 1 点能力骰（待放置）`);
      }
      runChargeSkill(g, who, action.artifactId, () => endMainPhase(g));
      // 「激活」类技能：装填到该侧的瞬间立即强制结算（016 虚无形态 / 014 净化·数罪并罚 / 020 兽魂 / 021 决意）
      // 第三列续充（wasFullyCharged）不再重复结算「激活」
      const justArmed = g.players[who].artifacts.find((x) => x.id === action.artifactId);
      if (!wasFullyCharged && (justArmed?.armedSide === 'left' || justArmed?.armedSide === 'right')) {
        resolveActivationOnArm(g, who, action.artifactId, justArmed.armedSide);
      }
      // L10 传奇面板·涤罪大剑术（触发）：**进行 1 次尘起行动后**，若**第一列与第二列神器的激活标记在同一侧**
      //（按"列"判定，异相 A05 等同样适用）且对方能给出"2 颗**种类不相同**的能力骰" → 由持有者决定是否弃置。
      if (hasActiveSkill(p, 'mate.dizuidaijianshu')) {
        const c1 = p.artifacts.find((a) => a.column === 1);
        const c2 = p.artifacts.find((a) => a.column === 2);
        const sameSide = c1?.activeMarkerSide != null && c1.activeMarkerSide === c2?.activeMarkerSide;
        if (sameSide) {
          const opp = g.players[who === 'A' ? 'B' : 'A'];
          const oppKinds = new Set(
            [...opp.areas.attack, ...opp.areas.defense, ...opp.areas.meditation].map((d) => d.kind),
          );
          if (oppKinds.size >= 2) queuePending(g, { kind: 'dizuidaijianshu', player: who });
        }
      }
      g.dustRiseActed = true;
      break;
    }
    case 'attack':
      if (g.phase !== 'main') throw new Error('not main phase');
      if (g.pendingAttack) throw new Error('pending attack unresolved');
      if (attacksBanned(g)) throw new Error('「潜伏」：双方各自的第一个回合内不能进行攻击');
      assertConversionAllowed(g, g.activePlayer, action.costSlots);
      assertTreatedAllowed(g, g.activePlayer, action.costSlots);
      // 027 寒光·必杀：使用攻击骰前先决定是否使用神器上的骰子（先于 022；两者仅可能在非预设模式共存）
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
        fxSkillFired(g, pd.player, 'yuqie.caiyuliu');
      } else {
        logLine(g, `${pname(pd.player)} 放弃裁雨流`);
      }
      g.pending = null;
      break;
    }
    case 'c01Caiyuliu': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'c01Caiyuliu') throw new Error('no c01Caiyuliu pending');
      if (!action.accept) {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 放弃「极之境·裁雨流」`);
        break;
      }
      const p = g.players[pd.player];
      const dist = emptyDistribution(p);
      if (!dist) throw new Error('「极之境·裁雨流」需要第二列分布');
      g.pending = null;
      withRng(g, (rng) => {
        const v = rng.rollDie();
        const kind = areaOf(v, dist);
        const die = { id: pd.dieId, value: v, kind }; // **复用攻击骰 id**（界面才能"中间重掷翻面 → 飞回区域"，而不是消失+新骰出现）
        p.areas[kind].push(die);
        const cn = kind === 'attack' ? '攻击' : kind === 'defense' ? '防御' : '冥想';
        logLine(g, `${pname(pd.player)} 发动「极之境·裁雨流」：将该攻击骰重新投掷为 ${v} 点，移回${cn}骰区`);
        fxSkillFired(g, pd.player, 'c01.caiyuliu');
        offerAdapt(g, pd.player, [die], true); // T18「适应」
      });
      break;
    }
    case 'fengmang': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'fengmang') throw new Error('no fengmang pending');
      if (action.accept) {
        if (!action.attackDieId || !action.meditationDieId) throw new Error('missing dice');
        // 「消耗 1 攻击骰 + 1 冥想骰」→ 走 paySlots（支持 010 置换 / 034 破障）
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
        fxSkillFired(g, pd.player, 'buxiang.fengmang.trigger'); // 先发（兼作真伤白墨线锚点）
        if ((g.phase as string) !== 'gameOver') dealTrueDamage(g, pd.defenderId, 2, pd.player);
        // L02 传奇面板·暗夜凶神（触发）：通过「锋芒」取消对方防御骰后 → 可选使「不祥」计数 +1（最高 3 层）
        if ((g.phase as string) !== 'gameOver') {
          const atkP = g.players[pd.player];
          const buxiang = atkP.artifacts.find((x) => x.skills.some((s) => s.key === 'buxiang.fengmang'));
          if (
            hasActiveSkill(atkP, 'ying.anyexiongshen') &&
            buxiang &&
            buxiang.count < (buxiang.countCap ?? 3)
          ) {
            queuePending(g, { kind: 'anyexiongshen', player: pd.player });
          }
        }
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
          // 「消耗 1 个防御骰」→ 走 paySlots（支持 010 置换 / 034 破障）
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
        fxSkillFired(g, pd.player, 'shenhong.kill');
        dealTrueDamage(g, opponent, 3, pd.player);
        heal(g, pd.player, 2);
      } else {
        logLine(g, `${pname(pd.player)} 放弃杀意`);
        g.pending = null;
      }
      break;
    }
    case 'aidao': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'aidao') throw new Error('no aidao pending');
      if (!action.accept) {
        logLine(g, `${pname(pd.player)} 放弃「哀悼」`);
        g.pending = null;
        break;
      }
      const opponent: PlayerId = pd.player === 'A' ? 'B' : 'A';
      const defense = g.players[opponent].areas.defense;
      // "即使不能完整弃置仍需尽可能执行"：对方有防御骰则**必须**指定要弃置的那一颗（由持有者选择）。
      // 先校验再改状态（非法动作不得改变状态）。
      if (defense.length > 0 && (!action.defenseDieId || !defense.some((d) => d.id === action.defenseDieId))) {
        throw new Error('「哀悼」需指定要弃置的对方防御骰');
      }
      g.pending = null;
      logLine(g, `${pname(pd.player)} 发动「哀悼」：造成 2 点真实伤害，然后弃置对方的 1 个防御骰`);
      fxSkillFired(g, pd.player, 'shenhong.alt.aidao');
      dealTrueDamage(g, opponent, 2, pd.player);
      // 弃置对方 1 个防御骰（持有者已选定；034 破障的存放骰不属区域 → 不可选）
      if (defense.length > 0 && action.defenseDieId) {
        const die = defense.find((d) => d.id === action.defenseDieId)!;
        consumeDice(g, g.players[opponent], 'defense', [action.defenseDieId]);
        logLine(g, `${pname(pd.player)} 弃置 ${pname(opponent)} 的 1 个防御骰（${die.value} 点）`);
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
          // 「消耗 1 个冥想骰」→ 走 paySlots（支持 010 置换 / 034 破障）
          const eff = paySlots(g, pd.player, [{ kind: 'meditation' }], fills, undefined, 'skill');
          paid = true;
          // 动效旁路：011 的冥想骰飞到中间、与攻击骰**并排** → 只它消失（攻击骰留位等抵挡）
          fxPush({ kind: 'attackJoin', player: pd.player, mode: 'spend', dieIds: fills[0].dieIds, value: eff[0].value });
        }
      }
      if (paid) {
        fxSkillFired(g, pd.player, 'dunwu.barrier.trigger');
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
        fxSkillFired(g, pd.player, 'dunwu.pulse.trigger');
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
      fxSkillFired(g, pd.player, 'youming.weimu');
      dealTrueDamage(g, pd.player, 2, pd.player);
      consumeDice(g, g.players[opp], found.kind, [dieId]);
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
        fxSkillFired(g, pd.player, 'chenai.rise');
      } else {
        logLine(g, `${pname(pd.player)} 放弃「尘起」的额外尘起行动`);
      }
      break;
    }
    case 'bacheng': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'bacheng') throw new Error('no bacheng pending');
      g.pending = null;
      if (action.accept) {
        fxSkillFired(g, pd.player, 'batton.bacheng'); // 按「发动拔城」那一下才弹「拔城」技能名
        const p = g.players[pd.player];
        virtualAttack(g, pd.player, 5, { skill: '拔城', owner: pd.player });
        logLine(g, `${pname(pd.player)} 「拔城」：视为以 5 点进行 1 次攻击`);
        const zz = p.artifacts.find((a) =>
          a.skills.some((s) => s.key === 'zhuzai.sweep' || s.key === 'zhuzai.smash'),
        );
        if (zz) {
          const from = zz.activeMarkerSide;
          const to: 'left' | 'right' = from === 'right' ? 'left' : 'right';
          zz.activeMarkerSide = to;
          zz.armedSide = null;
          zz.armedTurn = -1;
          logLine(g, `${pname(pd.player)} 「拔城」：切换「${zz.name}」的技能（${from ? sideCn(from) : '未激活'} → ${sideCn(to)}）`);
          // 动效旁路：切换「主宰」技能 → 主宰卡上弹「切换」小气泡（与尘起切换同款，此前是静默换面）
          fxPush({ kind: 'rise', player: pd.player, artifactId: zz.id, side: to, mode: 'switch' });
        }
        pumpAttackQueue(g);
      } else {
        logLine(g, `${pname(pd.player)} 放弃「拔城」`);
      }
      break;
    }
    case 'yuanwu': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'yuanwu') throw new Error('no yuanwu pending');
      const p2 = g.players[pd.player];
      const dieId = action.dieId ?? '';
      let from: DiceKind | null = null;
      for (const k of ['attack', 'defense', 'meditation'] as DiceKind[]) {
        if (p2.areas[k].some((d) => d.id === dieId)) {
          from = k;
          break;
        }
      }
      const to = action.to;
      if (from == null) throw new Error('圆舞：不是你的能力骰');
      if (to !== 'attack' && to !== 'defense' && to !== 'meditation') throw new Error('圆舞：目标区域非法');
      if (to === from) throw new Error('圆舞：必须移动到「另一个」区域');
      g.pending = null;
      moveDice(g, pd.player, [dieId], to);
      const cn = to === 'attack' ? '攻击' : to === 'defense' ? '防御' : '冥想';
      logLine(g, `${pname(pd.player)} 「圆舞」：将 1 个能力骰移动到${cn}骰区`);
      break;
    }
    case 'shangjin': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'shangjin') throw new Error('no shangjin pending');
      if (action.decline || !action.artifactId) {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 不发动「只为赏金而来」`);
        break;
      }
      // 选中某个技能：它还需要**自己的选择器**补全参数 → UI 会先打开选择器，再派发 `{t:'skill',…}`
      // （`case 'skill'` 会识别 `shangjin` 待决策 → 按"不计入每回合上限"执行并清空本待决策）
      throw new Error('「只为赏金而来」：请通过选择器指定该技能的参数');
    }
    case 'dizuidaijianshu': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'dizuidaijianshu') throw new Error('no dizuidaijianshu pending');
      if (action.accept === false) {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 不发动「涤罪大剑术」`);
        break;
      }
      const ids = action.dieIds ?? [];
      if (ids.length !== 2) throw new Error('「涤罪大剑术」：需选择对方 2 个能力骰');
      if (new Set(ids).size !== ids.length) throw new Error('duplicate die id');
      const oppId2: PlayerId = pd.player === 'A' ? 'B' : 'A';
      const byKind: Partial<Record<DiceKind, string[]>> = {};
      for (const id of ids) {
        const found = findDieOf(g, oppId2, id);
        if (!found) throw new Error(`not an opponent ability die: ${id}`);
        (byKind[found.kind] ??= []).push(id);
      }
      if (Object.keys(byKind).length !== 2) throw new Error('「涤罪大剑术」：2 颗骰的种类必须不相同');
      g.pending = null;
      consumeDiceByKind(g, g.players[oppId2], byKind); // 一次效果（多类型）→ 对方「雨落狂流」只 +1
      logLine(g, `${pname(pd.player)} 「涤罪大剑术」：弃置 ${pname(oppId2)} 的 2 颗能力骰（种类不相同）`);
      fxSkillFired(g, pd.player, 'mate.dizuidaijianshu');
      break;
    }
    case 'nudengzuiren': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'nudengzuiren') throw new Error('no nudengzuiren pending');
      const oppId2: PlayerId = pd.player === 'A' ? 'B' : 'A';
      g.pending = null;
      if (!action.accept) {
        const healed = applyHeal(g, pd.player, pd.amount);
        logLine(
          g,
          `${pname(pd.player)} 「汝等罪人」：正常回复 ${healed} 点生命（技能为 ${pd.amount} 点，受生命上限限制）`,
        );
        break;
      }
      logLine(
        g,
        `${pname(pd.player)} 「汝等罪人」：放弃回复 ${pd.amount} 点生命，改为对 ${pname(oppId2)} 造成 ${pd.amount} 点真实伤害`,
      );
      fxSkillFired(g, pd.player, 'mate.nudengzuiren'); // 先发（兼作真伤白墨线锚点），再落血
      dealTrueDamage(g, oppId2, pd.amount, pd.player); // 真伤：source＝你（对方 009 等可取消）
      break;
    }
    case 'duanexing': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'duanexing') throw new Error('no duanexing pending');
      const oppId3: PlayerId = pd.player === 'A' ? 'B' : 'A';
      if (!action.accept) {
        logLine(g, `${pname(pd.player)} 「闻我名者断恶行」：不发动`);
        g.pending = null;
        break;
      }
      const dieId = action.dieId;
      if (!dieId) throw new Error('「闻我名者断恶行」需指定要弃置的攻击骰');
      const opp = g.players[oppId3];
      const found = opp.areas.attack.find((d) => d.id === dieId);
      if (!found) throw new Error(`not opponent attack die: ${dieId}`); // 先校验（神上存放骰不算）
      consumeDice(g, opp, 'attack', [dieId]); // 弃置（不走 paySlots）
      logLine(
        g,
        `${pname(pd.player)} 「闻我名者断恶行」：弃置 ${pname(oppId3)} 的 1 个攻击骰（${found.value} 点）`,
      );
      fxSkillFired(g, pd.player, 'miyun.duanexing');
      g.pending = null;
      break;
    }
    case 'shizushouhun': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'shizushouhun') throw new Error('no shizushouhun pending');
      const p2 = g.players[pd.player];
      const card = p2.artifacts.find((a) => a.id === pd.artifactId);
      if (!card) throw new Error(`no artifact: ${pd.artifactId}`);
      if (!action.accept) {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 不发动「始祖兽魂」：保留「${card.name}」计数 2`);
        break;
      }
      // 先校验后落状态：必须恰好 1 个「冥想骰位」的填法（010 置换允许 2 顶 1；预设下 L07 与 010 不可能共存，仅为通用性）
      const fills = action.costSlots ?? [];
      const ids = fills[0]?.dieIds ?? [];
      if (fills.length !== 1 || ids.length < 1) throw new Error('「始祖兽魂」：需指定 1 个冥想骰位');
      if (ids.length === 2) assertConversionAllowed(g, pd.player, fills);
      g.pending = null;
      paySlots(g, pd.player, [{ kind: 'meditation' }], fills, undefined, 'skill');
      card.count = 3;
      logLine(g, `${pname(pd.player)} 「始祖兽魂」：额外消耗 1 个冥想骰 → 将「${card.name}」的计数重设为 3`);
      fxSkillFired(g, pd.player, 'nisa.shizushouhun');
      break;
    }
    case 'wufaraoshu': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'wufaraoshu') throw new Error('no wufaraoshu pending');
      const opp: PlayerId = pd.player === 'A' ? 'B' : 'A';
      const o = g.players[opp];
      if (action.choice === 'decline') {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 「无法饶恕」：不弃置`);
        break;
      }
      const dieId = action.dieId ?? '';
      if (!o.areas.defense.some((d) => d.id === dieId && d.value === pd.value)) {
        throw new Error('无法饶恕：对方没有该点数的防御骰');
      }
      g.pending = null;
      consumeDice(g, o, 'defense', [dieId]); // 弃置（非支付）
      logLine(g, `${pname(pd.player)} 「无法饶恕」：弃置 ${pname(opp)} 的 1 个 ${pd.value} 点防御骰`);
      fxSkillFired(g, pd.player, 'zoray.wufaraoshu');
      break;
    }
    case 'anyexiongshen': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'anyexiongshen') throw new Error('no anyexiongshen pending');
      g.pending = null;
      if (action.accept) {
        const p = g.players[pd.player];
        const card = p.artifacts.find((a) => a.skills.some((s) => s.key === 'buxiang.fengmang'));
        if (card) {
          const before = card.count;
          card.count = Math.min(card.countCap ?? 3, card.count + 1);
          logLine(g, `${pname(pd.player)} 「暗夜凶神」：使「不祥」的计数 +1（${before} → ${card.count}）`);
          fxSkillFired(g, pd.player, 'ying.anyexiongshen');
        }
      } else {
        logLine(g, `${pname(pd.player)} 放弃「暗夜凶神」`);
      }
      break;
    }
    case 'kongYuluo': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'kongYuluo') throw new Error('no kongYuluo pending');
      const opp: PlayerId = pd.player === 'A' ? 'B' : 'A';
      const o = g.players[opp];
      if (action.choice === 'decline') {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 「雨落狂流」：不选择执行`);
        break;
      }
      if (action.choice === 'gain') {
        const kind = action.kind;
        if (kind !== 'attack' && kind !== 'defense' && kind !== 'meditation') {
          throw new Error('雨落狂流：落区类型非法');
        }
        g.pending = null;
        withRng(g, (rng) => {
          const die = gainRandomDice(g, pd.player, kind, 1, rng)[0];
          const cn = kind === 'attack' ? '攻击' : kind === 'defense' ? '防御' : '冥想';
          logLine(g, `${pname(pd.player)} 「雨落狂流」：获得 1 个随机点数能力骰（${die.value}）并移入${cn}骰区`);
        });
        break;
      }
      // discard：弃置对方的 1 个能力骰（骰主＝对方 → 触发**对方**的「雨落狂流」，口径 (B)：不看是谁执行的）
      const dieId = action.dieId;
      let found: { kind: DiceKind; id: string } | null = null;
      for (const k of ['attack', 'defense', 'meditation'] as DiceKind[]) {
        const d = o.areas[k].find((x) => x.id === dieId);
        if (d) {
          found = { kind: k, id: d.id };
          break;
        }
      }
      if (!found) throw new Error('雨落狂流：对方没有该能力骰');
      g.pending = null;
      const removed = consumeDice(g, o, found.kind, [found.id]);
      logLine(g, `${pname(pd.player)} 「雨落狂流」：弃置 ${pname(opp)} 的 1 个能力骰（${removed.length > 0 ? vals(removed) : '—'}）`);
      break;
    }
    case 'shouhunCancel': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'shouhunCancel') throw new Error('no shouhunCancel pending');
      const pa2 = pd.attack;
      g.pending = null;
      if (action.cancel) {
        const owner = g.players[pd.owner];
        const card = owner.artifacts.find((x) => x.skills.some((s) => (SHOUHUN_CONT_KEYS as readonly string[]).includes(s.key)));
        // 「兽魂」这张卡有**两面**（熊：攻击+X / 狼：速度+X），取消伤害的效果两面都写着 →
        // 只弹**当前激活那一面**的持续技能名（此前把 4 个 key 全发 → 同名卡的两个 key 都命中 → 弹两次，真实事故）。
        const cont = card?.skills.find(
          (s) =>
            (SHOUHUN_CONT_KEYS as readonly string[]).includes(s.key) &&
            s.kind === 'continuous' &&
            skillActive(card, s),
        );
        if (card && card.count > 0) card.count -= 1;
        logLine(
          g,
          `${pname(pd.player)} 「兽魂」：取消本次 ${pa2.value} 点伤害，令 ${pname(pd.owner)} 的「兽魂」计数下降 1 点${
            card ? `（${card.count}）` : ''
          }`,
        );
        // 取消的这次攻击仍**算作进行了一次攻击 / 使用了攻击骰**（说明书「取消」条）：
        // 触发"使用攻击骰后/进行攻击后"类；但 damageDealt=0 → "造成伤害后"类不触发；blocked=false → "被抵挡后"类不触发。
        // 关键：必须推进多段攻击队列（否则 013 电刑 / A01 不败之王 的第 2/3 段会凭空消失）。
        if (cont) fxSkillFired(g, pd.owner, cont.key);
        if ((g.phase as string) !== 'gameOver') {
          afterAttackResolved(g, pa2, { blocked: false, damageDealt: 0 });
          pumpAttackQueue(g);
        }
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
    case 'shipeiPick': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'shipeiPick') throw new Error('no shipeiPick pending');
      if (action.cancel) {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 不发动「适应」`);
        break;
      }
      const dieId = action.dieId;
      const value = action.value;
      if (!dieId || !pd.dieIds.includes(dieId)) throw new Error('「适应」：请从本次掷出的骰中选择 1 颗');
      if (!Number.isInteger(value) || value! < 1 || value! > 6) throw new Error('「适应」：点数须在 1–6');
      const p = g.players[pd.player];
      const kinds: DiceKind[] = ['attack', 'defense', 'meditation'];
      if (!kinds.some((k) => p.areas[k].some((d) => d.id === dieId))) throw new Error(`「适应」：找不到该骰 ${dieId}`);
      g.pending = null;
      p.tacticOnceUsed = true;
      fxTacticFired(g, pd.player);
      if (pd.replaceByDist) {
        const dist = p.artifacts.find((a) => a.column === 2)?.distribution;
        if (!dist) throw new Error(`player ${pd.player} has no distribution`);
        for (const k of kinds) p.areas[k] = p.areas[k].filter((d) => d.id !== dieId);
        const kind = areaOf(value!, dist);
        p.areas[kind].push(createDie(dieId, value!, kind));
        const cn: Record<DiceKind, string> = { attack: '攻击', defense: '防御', meditation: '冥想' };
        logLine(g, `${pname(pd.player)} 「适应」：将 1 颗骰的点数改为 ${value}（移入${cn[kind]}骰区）`);
      } else {
        for (const k of kinds) {
          const d = p.areas[k].find((x) => x.id === dieId);
          if (d) {
            d.value = value!;
            break;
          }
        }
        logLine(g, `${pname(pd.player)} 「适应」：将 1 颗骰的点数改为 ${value}`);
      }
      break;
    }
    case 'youdiMove': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'youdiMove') throw new Error('no youdiMove pending');
      if (action.cancel) {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 不发动「诱敌」`);
        break;
      }
      const p = g.players[pd.player];
      const from = action.from;
      const to = action.to;
      const ids = action.dieIds ?? [];
      if (!from || !to || from === to) throw new Error('「诱敌」需指定不同的来源/目标区域');
      if (ids.length < 1 || ids.length > 3) throw new Error('「诱敌」需移动 1–3 颗能力骰');
      if (new Set(ids).size !== ids.length) throw new Error('duplicate die id');
      const inFrom = new Set(p.areas[from].map((d) => d.id));
      for (const id of ids) if (!inFrom.has(id)) throw new Error(`not your die in ${from}: ${id}`);
      g.pending = null;
      p.tacticOnceUsed = true;
      // 走统一入口 `moveDice`（会发 `move` 旁路事件）——不再由界面"对比 DOM 自己猜"（AGENTS「别再猜，引擎报事件」）
      moveDice(g, pd.player, ids, to);
      const cn: Record<DiceKind, string> = { attack: '攻击', defense: '防御', meditation: '冥想' };
      logLine(g, `${pname(pd.player)} 「诱敌」：将${cn[from]}骰区的 ${ids.length} 颗骰移到${cn[to]}骰区（保留点数）`);
      fxTacticFired(g, pd.player);
      break;
    }
    case 'yingziPick': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'yingziPick') throw new Error('no yingziPick pending');
      if (!Number.isInteger(action.value) || action.value < 1 || action.value > 6) {
        throw new Error('「影子」点数须在 1–6');
      }
      g.pending = null;
      const p = g.players[pd.player];
      p.tacticHeldDie = { id: newDieId(`${pd.player}-`), value: action.value };
      logLine(g, `${pname(pd.player)} 「影子」：将 1 个 ${action.value} 点能力骰从供应堆置于战术上`);
      fxTacticFired(g, pd.player); // 动效旁路：置骰那一刻也弹「影子」气泡（战术栏）
      break;
    }
    case 'yuhuiPlace': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'yuhuiPlace') throw new Error('no yuhuiPlace pending');
      if (action.areas.length !== 2) throw new Error('「迂回」需为 2 颗骰各指定 1 个区域');
      for (const k of action.areas) {
        if (k !== 'attack' && k !== 'defense' && k !== 'meditation') throw new Error(`invalid area: ${k}`);
      }
      g.pending = null;
      const p = g.players[pd.player];
      const cn: Record<DiceKind, string> = { attack: '攻击', defense: '防御', meditation: '冥想' };
      for (const k of action.areas) p.areas[k].push(createDie(newDieId(`${pd.player}-`), 1, k));
      logLine(g, `${pname(pd.player)} 「迂回」：获得 2 个 1 点能力骰 → 放置于 ${action.areas.map((k) => cn[k]).join('、')}`);
      break;
    }
    case 'yuanjianGain': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'yuanjianGain') throw new Error('no yuanjianGain pending');
      if (!Number.isInteger(action.value) || action.value < 1 || action.value > 6) {
        throw new Error('「远见」点数须在 1–6');
      }
      if (action.area !== 'attack' && action.area !== 'defense' && action.area !== 'meditation') {
        throw new Error(`invalid area: ${action.area}`);
      }
      g.pending = null;
      const p = g.players[pd.player];
      const cn: Record<DiceKind, string> = { attack: '攻击', defense: '防御', meditation: '冥想' };
      p.areas[action.area].push(createDie(newDieId(`${pd.player}-`), action.value, action.area));
      logLine(
        g,
        `${pname(pd.player)} 「远见」：猜测正确 → 获得 1 个 ${action.value} 点能力骰 → ${cn[action.area]}骰区`,
      );
      break;
    }
    case 'ciBei': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'ciBei') throw new Error('no ciBei pending');
      g.pending = null;
      const payer = g.players[pd.player];
      if (action.accept) {
        payer.tacticOnceUsed = true;
        logLine(g, `${pname(pd.player)} 「慈悲」：取消该 ${pd.amount} 点伤害，改为回复 ${pd.amount} 点生命（整局 1 次）`);
        fxTacticFired(g, pd.player);
        heal(g, pd.player, pd.amount);
        // 攻击伤害：视为本次攻击未造成伤害（仍算进行过一次攻击；"被抵挡"事实按原结算）
        if (pd.attack && (g.phase as string) !== 'gameOver') {
          settleAttack(g, pd.attack, {
            blocked: pd.blocked ?? false,
            blockedForTriggers: pd.blockedForTriggers ?? false,
            damageDealt: 0,
            applyDamage: false,
          });
        }
        break;
      }
      // 不发动 → 照常结算
      if (pd.attack) {
        settleAttack(g, pd.attack, {
          blocked: pd.blocked ?? false,
          blockedForTriggers: pd.blockedForTriggers ?? false,
          damageDealt: pd.amount,
          applyDamage: true,
        });
      } else {
        dealTrueDamage(g, pd.target, pd.amount, pd.player, { skipCibei: true, skipLine: true }); // 原始技能发动时已飞过线，不再重复
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
      fxSkillFired(g, pd.player, 'siji.chuxing');
      // L08 传奇面板·只为赏金而来（触发）：**实际发动**「处刑通牒」（选①/②）之后 → 由持有者选择启动 1 个"已激活的启动式"技能
      // （放在 doAttack 之后：攻击已生成、正在等抵挡决定；本待决策会先弹出，符合"触发处刑通牒后立即"的时序）
      if (hasActiveSkill(g.players[pd.player], 'xiva.zhiweishangjin')) {
        queuePending(g, { kind: 'shangjin', player: pd.player });
      }
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
      // 「对方必须消耗 1 个任意能力骰」→ 走 paySlots（支持 010 置换 / 034 破障）
      const eff = paySlots(g, pd.player, spec, fills, undefined, 'skill');
      const theirValue = eff[0].value;
      g.pending = null;
      // 动效旁路：被要求方骰到位 → 与发起方停在中间的骰并排后一起消失
      fxPush({ kind: 'weiju', player: pd.player, mode: 'pay', dieIds: fills[0].dieIds, value: theirValue });
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
    case 'challengeStep': {
      if (g.mode !== 'challenge') throw new Error('not challenge mode');
      if (g.activePlayer !== 'B') throw new Error('not legend turn');
      if (g.pending || g.pendingAttack || g.attackQueue || g.virtualQueue) throw new Error('legend turn busy');
      // Z10「救赎」：本回合的「回合结束」（033）已结算完 → 现在才开新回合（见 `continueLegendTurn` 收尾）
      if (g.challenge?.startNextTurnAfterPending) {
        g.challenge.startNextTurnAfterPending = false;
        startNextLegendTurn(g);
        break;
      }
      if (g.challenge?.resumeAt == null) throw new Error('no challenge step pending');
      continueLegendTurn(g, true);
      break;
    }
    case 'challengePick': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'challengePick') throw new Error('no challengePick pending');
      let opt = pd.options.find((o) => o.id === action.id);
      // 骰片选择（`pick`）：界面按"点击顺序"拼 id → 与选项 id 的排列可能不同 → 再按**集合**匹配一次
      if (!opt && pd.pick) {
        const want = action.id.split(',');
        const wantSet = new Set(want);
        opt = pd.options.find((o) => {
          const parts = o.id.split(',');
          return parts.length === want.length && parts.every((x) => wantSet.has(x));
        });
      }
      if (!opt) throw new Error(`非法代决选项：${action.id}`);
      g.pending = null;
      if (pd.tag === 'hengguan') {
        // Z09「横贯」：弃置挑战者所选的那 1 个能力骰（"弃置"＝技能效果 → 走 consumeDice，非支付）
        for (const kd of ['attack', 'defense', 'meditation'] as DiceKind[]) {
          if (g.players.A.areas[kd].some((d) => d.id === action.id)) {
            consumeDice(g, g.players.A, kd, [action.id], { byLegend: true });
            break;
          }
        }
        logLine(g, `（代决）${pd.prompt} → ${opt.label}`);
        break;
      }
      if (pd.tag === 'assign') {
        // Z04「D1：开局选骰」→ 存进 `g.challenge.assign`（不按技能记 `decisions`）
        g.challenge!.assign = assignFromOptId(g, action.id);
        logLine(g, `（代决）${pd.prompt} → ${opt.label}`);
        break;
      }
      const card = CHALLENGES.find((c) => c.id === g.challenge?.cardId);
      // 选择归到"**正在结算的那条技能**"：不能用 resumeAt —— "延后一步"的代决（例：暗夜凶神弃骰）
      // 是在攻击结算后问的，那时 resumeAt 已经指向下一条了。
      const idx = g.challenge?.activeSkill ?? g.challenge?.resumeAt ?? 0;
      const key = pd.key ?? card?.skills?.[idx]?.id ?? 'unknown';
      const dec = (g.challenge!.decisions ??= {});
      dec[key] = [...(dec[key] ?? []), action.id];
      logLine(g, `（代决）${pd.prompt} → ${opt.label}`);
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
        // 单人挑战：传奇没有冥想骰区 → 跳过给它的冥想骰（FAQ 23.2.3）
        const skipLegend = g.mode === 'challenge' && opp === 'B' && kind === 'meditation';
        let mineGained: { value: number }[] = [];
        let oppGained: { value: number }[] = [];
        withRng(g, (rng) => {
          mineGained = gainRandomDice(g, me, kind, 2, rng);
          if (!skipLegend) oppGained = gainRandomDice(g, opp, kind, 2, rng);
        });
        logLine(
          g,
          skipLegend
            ? `「共振」：${pname(me)} 获得 2 个随机点数的${kindCn}骰（${valsSorted(mineGained)}）（单人挑战：跳过「昔日传奇」的那份）`
            : `「共振」：${pname(me)} 与 ${pname(opp)} 各获得 2 个随机点数的${kindCn}骰（${pname(me)}：${valsSorted(mineGained)}；${pname(opp)}：${valsSorted(oppGained)}）`,
        );
        break;
      }
      // ② 双方各弃置最多 2 颗该类型（由发起者选择；不足则尽可能，FAQ 23.2.2）
      const pickFor = (who: PlayerId, ids: string[]): number => {
        const valid = ids.filter((id) => g.players[who].areas[kind].some((d) => d.id === id)).slice(0, 2);
        if (valid.length > 0) consumeDice(g, g.players[who], kind, valid);
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
      fxSkillFired(g, pd.player, 'aige.weiya');
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
      fxSkillFired(g, pd.owner, 'aige.xianzhen');
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
      fxSkillFired(g, pd.player, 'tuohu.hengguan.trigger');
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
      // 动效旁路：027 寒光·必杀的两种模式（供界面播"移入对应区" / "与对方同点骰一起消失"）
      fxSkillFired(g, pd.player, 'hanguang.ultimate');
      fxPush({
        kind: 'hanguang',
        player: pd.player,
        mode: action.pick,
        heldId: action.dieId,
        ...(action.targetDieId ? { opponentId: action.targetDieId } : {}),
      });
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
      // 动效旁路：本次重排的**全部**骰子（含"落区没变"的）→ 界面整体"聚中间再分体"
      fxPush({ kind: 'move', player: pd.player, dieIds: Object.keys(action.assign) });
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
      fxSkillFired(g, pd.player, 'mengyan.diyu');
      break;
    }
    case 'tiaolingResolve': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'tiaolingPick') throw new Error('no tiaolingPick pending');
      const ownerId: PlayerId = pd.owner ?? pd.player; // 被弃骰的归属方（挑战模式下代决传奇时＝B）
      const p = g.players[ownerId];
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
      // 挑战模式：**代决传奇**时只能"弃最少"（不许故意多弃）；挑战者弃**自己的**不受此限
      if (g.mode === 'challenge' && ownerId === 'B' && ids.length !== siwangMinDiscard(all, action.pick === 'same')) {
        throw new Error('「死亡亦逝」：挑战模式下代决「昔日传奇」时只能弃置最少的颗数');
      }
      for (const id of ids) {
        const found = findDieOf(g, ownerId, id);
        if (found) consumeDice(g, p, found.kind, [id]);
      }
      g.pending = null;
      logLine(
        g,
        `${pname(ownerId)} 「死亡亦逝」：选择「${action.pick === 'same' ? '全部相同' : '全部不同'}」，弃置 ${ids.length} 颗能力骰${pd.player !== ownerId ? `（由 ${pname(pd.player)} 代决）` : ''}`,
      );
      fxSkillFired(g, ownerId, 'diaoling.siwang');
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
        consumeDice(g, p, found.kind, [id]);
      }
      g.pending = null;
      logLine(g, `${pname(pd.player)} 「万丈明光」：主要阶段开始，弃置 ${ids.length} 个能力骰`);
      fxSkillFired(g, pd.player, 'qianjie.wanzhang');
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
        // mode='block'：防御骰站住 → 走正常"抵挡"；mode='attack'：攻击已停住 → 继续（此时才做 011 追问）
        if (pd.mode === 'block') finalizeAttackResolution(g, pa, true);
        else maybeBarrier(g, pa);
        break;
      }
      // 发动：移除神器上 1 个同点数存放骰
      const card = artifactWithSkill(g.players[pd.player], 'jingang.puti.trigger');
      const removedHeld = card?.heldDice?.find((h) => h.value === pd.value);
      // ⚠️ **只移除 1 个**（按 id 删那一颗）——卡面写"移除本神器上的 **1 个**与其点数相同的骰子"。
      //    A03（异相）的装载是"2 个任意点数、**可相同**" → 若按 `value` filter 会把两颗同点一次吃光
      //    （034 是 3 个互不相同，最多 1 颗命中所以看不出来；2026-10-11 查得）。
      if (removedHeld && card?.heldDice) card.heldDice = card.heldDice.filter((h) => h.id !== removedHeld.id);
      const joinIds = removedHeld ? [removedHeld.id] : [];
      if (pd.mode === 'block') {
        logLine(g, `${pname(pd.player)} 「不动菩提」：移除 1 个 ${pd.value} 点存放骰，取消对方的抵挡`);
        // 动效：攻击+防御+灰存放骰 三颗并排 → 一起消失
        fxPush({ kind: 'attackJoin', player: pd.player, mode: 'cancel', dieIds: joinIds, value: pd.value });
        finalizeAttackResolution(g, pa, false);
      } else {
        logLine(g, `${pname(pd.player)} 「不动菩提」：移除 1 个 ${pd.value} 点存放骰，取消对方的攻击`);
        // 动效：攻击骰 + 灰存放骰 并排 → 一起消失
        g.pendingAttack = null;
        fxPush({ kind: 'attackJoin', player: pd.player, mode: 'cancel', dieIds: joinIds, value: pd.value });
        pumpAttackQueue(g);
      }
      fxSkillFired(g, pd.player, 'jingang.puti.trigger');
      break;
    }
    case 'skill': {
      const pendingSkill = g.pending && g.pending.kind === 'activationResolve' ? g.pending : null;
      const resolvingActivation =
        pendingSkill !== null && pendingSkill.artifactId === action.artifactId && pendingSkill.side === action.side;
      const pendingCharge = g.pending && g.pending.kind === 'chargeResolve' ? g.pending : null;
      const resolvingCharge = pendingCharge !== null && pendingCharge.artifactId === action.artifactId;
      if (g.phase !== 'main' && !resolvingActivation && !resolvingCharge) throw new Error('not main phase');
      // L08「只为赏金而来」：赏金给的这次启动发生在"攻击已生成、正等抵挡决定"之间（卡面「立即」）→ 放行
      const pendingShangjin = g.pending && g.pending.kind === 'shangjin' ? g.pending : null;
      if (g.pendingAttack && !pendingShangjin) throw new Error('pending attack unresolved');
      // 技能持有者（= 行动者）：强制结算的待决策可能属于**非当前回合玩家**（如 L05「复仇之灵」在对方回合强制尘起后
      // 触发 014「惩戒」的「激活」选择器）→ 一律取待决策的玩家，绝不能用 activePlayer（否则 `no artifact` 抛错）
      const skillOwner: PlayerId = pendingSkill?.player ?? pendingCharge?.player ?? pendingShangjin?.player ?? g.activePlayer;
      const p = g.players[skillOwner];
      // 技能持有者：优先神器；否则若 id 命中该玩家的传奇面板 → 用适配器（面板技能开局即可用）
      const a =
        p.artifacts.find((x) => x.id === action.artifactId) ??
        (p.legend && p.legend.id === action.artifactId ? legendAsArtifact(p.legend) : undefined);
      if (!a) throw new Error(`no artifact: ${action.artifactId}`);
      // 技能使用者 = 神器持有者（须在处理器的 endMainPhase 改变 activePlayer **之前**捕获）
      const skillUser = skillOwner;
      // 传奇面板动作带 `legendKey` → 按 key 精确取（面板可同时含「启动 / 必杀」）
      const legendKey = (action.params?.legendKey as string | undefined) ?? undefined;
      const s = legendKey
        ? a.skills.find(
            (x) => x.key === legendKey && (x.kind === 'activate' || x.kind === 'ultimate'),
          )
        : a.skills.find(
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
        // L08 没有怜悯：024 的必杀在"没有怜悯"生效期间**无需激活/充能**（其余技能不变）
        const lianminUlt = s.key === 'kuangwu.ultimate' && hasActiveSkill(g.players[skillOwner], 'xiva.meiyoulianmin') && g.dustfall >= 4;
        if (!lianminUlt) throw new Error('skill not active');
      }
      if (s.kind === 'activation') {
        // 「激活」类只能由尘起装填时的强制结算触发，不能手动发动
        if (!resolvingActivation) throw new Error('激活类技能由尘起装填时立即强制结算，不能手动发动');
        if (!activationUsable(g, a, s)) throw new Error('activation skill only usable in the turn it was armed');
      }
      if (s.key === 'kuangwu.ultimate' && hasActiveSkill(g.players[skillOwner], 'xiva.meiyoulianmin') && g.dustfall >= 4) {
        // 没有怜悯：不吃"整局一次"（改为每回合 1 次，走下方 skillPerTurnLimit）
      } else if (s.kind === 'ultimate' && g.ultimatesUsed.includes(skillUseKey(skillUser, s.key))) {
        throw new Error('ultimate already used');
      }
      // L08 只为赏金而来：这次启动**不计入**每回合上限（也不写 skillsUsedThisTurn）
      const fromShangjin = pendingShangjin !== null && pendingShangjin.player === skillOwner;
      if (fromShangjin && s.kind !== 'activate') throw new Error('「只为赏金而来」只能启动"启动式"技能');
      if (
        !fromShangjin &&
        g.skillsUsedThisTurn.filter((k) => k === skillUseKey(skillUser, s.key)).length >=
          skillPerTurnLimit(g.players[skillUser], s.key)
      )
        throw new Error('skill already used this turn');
      assertConversionAllowed(g, skillOwner, action.params?.costSlots as SlotFill[] | undefined);
      const handler = SKILL_HANDLERS[s.key];
      if (!handler) throw new Error(`no handler for skill: ${s.key}`);
      g.skillConsumedThisAction = 0;
      // 动效旁路：记录"当前正在结算的发动卡"（真伤白墨线锚点 = 该技能卡图）
      fxSetSource({ player: skillOwner, artifactId: a.id, side: s.side, skillKey: s.key });
      // 登记"本次使用"（每回合一次 / 必杀整局一次）。抽成函数是为了让 L11「永恒女王」中途打断时也能登记：
      // 若 handler 内造成致死真伤触发永恒女王 → 抛 YonghengQueenSignal 立即展开结算栈，**必杀也必须记为"已用"**
      // （否则 L12「立地成佛」等打死永恒女王持有者后可再次发动——真实事故）。
      const recordUse = (): void => {
        if (s.key === 'tata.mengjing' || fromShangjin) return; // L04 重开已重置记录；赏金启动不占每回合上限
        g.skillsUsedThisTurn.push(skillUseKey(skillUser, s.key));
        const lianminUltRec =
          s.key === 'kuangwu.ultimate' && hasActiveSkill(g.players[skillOwner], 'xiva.meiyoulianmin') && g.dustfall >= 4;
        if (s.kind === 'ultimate' && !lianminUltRec) g.ultimatesUsed.push(skillUseKey(skillUser, s.key));
      };
      try {
        withRng(g, (rng) =>
          handler.run({
            g,
            player: skillOwner,
            artifact: a,
            rng,
            params: action.params ?? {},
            endMainPhase: () => endMainPhase(g),
            reportConsumed: (n) => {
              g.skillConsumedThisAction += n;
            },
          }),
        );
      } catch (e) {
        if (e instanceof YonghengQueenSignal) recordUse(); // 必杀照样算"已用尽"
        throw e; // 普通非法参数错误不登记；信号交给外层 runYonghengQueen
      }
      // L08「没有怜悯」：024 必杀**经它**发动 → **先**弹「没有怜悯」（随后才是 024 必杀的必杀横幅）
      if (s.key === 'kuangwu.ultimate' && hasActiveSkill(g.players[skillOwner], 'xiva.meiyoulianmin') && g.dustfall >= 4) {
        fxSkillFired(g, skillOwner, 'xiva.meiyoulianmin');
      }
      // L01「断苇一斩」：斩神切**经它**发动（改为弃置对方全部能力骰）→ 先弹「断苇一斩」（随后才是斩神切的必杀横幅）
      if (
        s.key === 'mingjing.ultimate' &&
        (action.params as { opponentDiscardAll?: boolean } | undefined)?.opponentDiscardAll === true
      ) {
        fxSkillFired(g, skillOwner, 'kong.duanweiyizhan');
      }
      // L08「只为赏金而来」：本次启动**由它授予**（不计每回合上限）→ 先弹「只为赏金而来」（随后才是被启动的技能名）
      if (fromShangjin) {
        fxSkillFired(g, skillOwner, 'xiva.zhiweishangjin');
      }
      // 动效旁路：技能"用"气泡（发动）。激活/充能会连弹两条（先「激活/充能」，再此条技能名）。
      fxPush({ kind: 'skillFired', player: skillOwner, artifactId: a.id, side: s.side, skillKey: s.key, auto: false });
      // 非法参数在处理器内抛错时不清空待决策（非法动作不得改变状态）
      // 只在"待决策仍是本次解决的那个"时清空 —— 处理器可能已经**设置了一个新的待决策**
      //（如 023 畏惧 → weijuPay），不能把它一起清掉
      const consumedPending = pendingSkill ?? pendingCharge ?? pendingShangjin;
      if (consumedPending && g.pending === consumedPending) g.pending = null;
      recordUse();
      // L02「残影」：影袭上限提到 2 → 第 2 次＝它多给的那次 → 弹「残影」
      if (
        s.key === 'yingle.yingxi' &&
        g.skillsUsedThisTurn.filter((k) => k === skillUseKey(skillUser, 'yingle.yingxi')).length >= 2
      ) {
        fxSkillFired(g, skillUser, 'ying.canying');
      }
      // L08 没有怜悯（持续）：每次启动「凶弹业舞」（必杀）后 → 你受到 2 点真实伤害
      if (
        s.key === 'kuangwu.ultimate' &&
        hasActiveSkill(g.players[skillOwner], 'xiva.meiyoulianmin') &&
        g.dustfall >= 4 &&
        (g.phase as string) !== 'gameOver'
      ) {
        logLine(g, `${pname(skillOwner)} 「没有怜悯」：启动「凶弹业舞」 → 受到 2 点真实伤害`);
        dealTrueDamage(g, skillOwner, 2, skillOwner); // 自伤：source=自己
      }
      // 战术牌 T04「末路」（触发）：启动**必杀式**后 → 造成/回复＝第三列神器充能需求
      // （覆盖：普通启动 / L08 没有怜悯 / L04 重开；018 强制必杀在 pending.ts 里另调）
      if (s.kind === 'ultimate') applyMolu(g, skillUser);
      // 019 蛮王之牙等：启动后刷新自身「每回合一次」计数（本回合可再次启动）
      if (s.refresh) g.skillsUsedThisTurn = g.skillsUsedThisTurn.filter((k) => k !== skillUseKey(skillUser, s.key));
      // 011 灵能脉冲·触发：通过技能消耗能力骰后，可额外造成等同消耗数量的真实伤害（每回合最多 1 次）
      if (
        g.skillConsumedThisAction > 0 &&
        hasActiveSkill(g.players[skillOwner], 'dunwu.pulse.trigger') &&
        !g.dunwuPulseUsedThisTurn &&
        g.pending === null
      ) {
        g.pending = { kind: 'dunwuPulse', player: skillOwner, amount: g.skillConsumedThisAction };
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
  // 多段攻击（013 电刑等）被待决策打断后，解决该待决策应**自动继续下一段**（否则会停在半途，
  // 表现为"电刑后续各段不再触发任何'造成伤害后'类技能"）。
  pumpAttackQueue(g);
  // 挑战模式：传奇回合**不再在此自动续跑**——改由界面按节奏派发 `challengeStep` 逐条推进
  // （这样每条技能都"看得见"；代决/待抵挡结束后同样由界面继续下一步）。
  // 若已进入「结束」阶段且无待决策 → 真正结算结束阶段并交出回合（供 032/033 的待决策解决后推进）
  finalizeTurnEnd(g);
  // 战术牌·战前：抽牌完、无待决策 → 结算生命修正并进入初始重掷
  maybeEnterInitialReroll(g);
  // 战术牌 T07「保守」：每次行动结算后，若某持牌者防御骰第一次为 0 → 触发
  checkBaoshou(g);
  // 「没得做就自动翻页」：重掷 / 尘起 / 初始重掷阶段若确实没有任何可做之事 → 自动推进到下一阶段。
  // 必须排在 `checkBaoshou` 之后（T07 可能刚补了防御/冥想骰，不能把"刚有骰子可做"的阶段误判为空）。
  for (let guard = 0; guard < 6; guard++) {
    if (!autoAdvanceAction(g)) break;
    doAdvance(g);
  }
  // 自动推进可能新排队待决策（如 035「万丈明光」主要阶段开始的弃骰）→ 再泵一次（`pumpPending` 幂等）
  pumpPending(g);
  return g;
}
