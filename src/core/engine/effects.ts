import type {
  DiceKind,
  Die,
  EffectiveDie,
  GameState,
  PlayerId,
  SlotFill,
  SlotSpec,
} from '../model/types';
import { newDieId, createDie, placeDieByDistribution, areaOf } from '../model/dice';
import { SeededRng } from '../rng/rng';
import { logLine, pname } from './log';
import { hasActiveSkill, skillActive } from './skill-state';
import { emptyDistribution } from './derive';

const kindCnOf = (k: DiceKind): string => (k === 'attack' ? '攻击' : k === 'defense' ? '防御' : '冥想');

export type { EffectiveDie, SlotFill, SlotSpec } from '../model/types';

const KINDS: DiceKind[] = ['attack', 'defense', 'meditation'];

/** 找到某玩家的某颗骰（返回所在区域与引用），找不到返回 null */
export function findDieOf(g: GameState, player: PlayerId, dieId: string): { kind: DiceKind; die: Die } | null {
  for (const kind of KINDS) {
    const die = g.players[player].areas[kind].find((d) => d.id === dieId);
    if (die) return { kind, die };
  }
  return null;
}

/** 034 金刚·破障（持续）：神器上存放的骰可当能力骰「使用/消耗」，类型按持有者第二列分布。
 *  返回 { value, kind }；若未激活 / 不在神器上 / 无分布则返回 null。 */
export function heldAsAbility(g: GameState, player: PlayerId, id: string): { value: number; kind: DiceKind } | null {
  if (!hasActiveSkill(g.players[player], 'jingang.pozhang.continuous')) return null;
  const card = g.players[player].artifacts.find((a) => (a.heldDice ?? []).some((h) => h.id === id));
  const h = card?.heldDice?.find((x) => x.id === id);
  if (!h) return null;
  const dist = emptyDistribution(g.players[player]);
  if (!dist) return null;
  return { value: h.value, kind: areaOf(h.value, dist) };
}

/** 某颗骰作为「可支付能力骰」的信息：优先区域真骰，其次 034 破障的神器存放骰 */
export function abilityDieInfo(
  g: GameState,
  player: PlayerId,
  id: string,
): { value: number; kind: DiceKind; source: 'area' | 'artifact' } | null {
  const found = findDieOf(g, player, id);
  if (found) return { value: found.die.value, kind: found.kind, source: 'area' };
  const h = heldAsAbility(g, player, id);
  return h ? { value: h.value, kind: h.kind, source: 'artifact' } : null;
}

/** 变更某颗骰的点数（保留其所在区域）。返回旧点数 */
export function setDieValue(g: GameState, player: PlayerId, dieId: string, value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 6) {
    throw new Error(`invalid die value: ${value}`);
  }
  const found = findDieOf(g, player, dieId);
  if (!found) throw new Error(`die not found: ${dieId}`);
  const old = found.die.value;
  found.die.value = value;
  return old;
}

/** 把骰子**转移给另一位玩家**的指定区域（保留点数与 id；024 狂舞用） */
export function transferDice(g: GameState, from: PlayerId, dieIds: string[], to: PlayerId, toKind: DiceKind): void {
  for (const id of dieIds) {
    const found = findDieOf(g, from, id);
    if (!found) throw new Error(`die not found: ${id}`);
    g.players[from].areas[found.kind] = g.players[from].areas[found.kind].filter((d) => d.id !== id);
    found.die.kind = toKind;
    g.players[to].areas[toKind].push(found.die);
  }
}

/** 把指定骰移动到目标区域（保留点数） */
export function moveDice(g: GameState, player: PlayerId, dieIds: string[], to: DiceKind): void {
  const p = g.players[player];
  for (const id of dieIds) {
    const found = findDieOf(g, player, id);
    if (!found) throw new Error(`die not found: ${id}`);
    p.areas[found.kind] = p.areas[found.kind].filter((d) => d.id !== id);
    found.die.kind = to;
    p.areas[to].push(found.die);
  }
}

/** 回复生命，不超过上限。返回实际回复量 */
export function heal(g: GameState, player: PlayerId, amount: number): number {
  const p = g.players[player];
  const before = p.life;
  p.life = Math.min(p.lifeMax, p.life + amount);
  return p.life - before;
}

/** 可作为「使用/消耗」支付来源的能力骰池：区域真骰 + 034/A03 破障的神器存放骰（启用破障时）。
 *  存放骰的类型按持有者**第二列**分布判定；顺序：攻击→防御→冥想。 */
export interface AbilityDie {
  id: string;
  value: number;
  kind: DiceKind;
  source: 'area' | 'artifact';
}

export function abilityDicePool(g: GameState, player: PlayerId): AbilityDie[] {
  const p = g.players[player];
  const out: AbilityDie[] = [];
  for (const k of KINDS) {
    for (const d of p.areas[k]) out.push({ id: d.id, value: d.value, kind: k, source: 'area' });
  }
  if (hasActiveSkill(p, 'jingang.pozhang.continuous')) {
    const dist = emptyDistribution(p);
    if (dist) {
      for (const a of p.artifacts) {
        for (const h of a.heldDice ?? []) {
          out.push({ id: h.id, value: h.value, kind: areaOf(h.value, dist), source: 'artifact' });
        }
      }
    }
  }
  return out;
}

export interface CostNeed {
  attack?: number;
  defense?: number;
  meditation?: number;
}

/** 从给定池判断 `need` 是否可支付：每格 1 颗同类型能力骰；或（持 010/A02「真实之剑」）2 颗任意能力骰置换为 1 格（点数视为 5）。 */
function canPayFromPool(g: GameState, player: PlayerId, pool: AbilityDie[], need: CostNeed): boolean {
  const count = (k: DiceKind): number => pool.filter((d) => d.kind === k).length;
  const nA = need.attack ?? 0;
  const nD = need.defense ?? 0;
  const nM = need.meditation ?? 0;
  const N = nA + nD + nM;
  if (N === 0) return true;
  const deficit =
    Math.max(0, nA - count('attack')) +
    Math.max(0, nD - count('defense')) +
    Math.max(0, nM - count('meditation'));
  if (deficit === 0) return true; // 全部用同类型骰（T ≥ N 必然成立）
  if (!hasActiveSkill(g.players[player], 'shenhong.sword')) return false;
  return pool.length - N >= deficit;
}

/** `need` 是否可支付（门槛/提示判定用）。
 *  `opts.held` 是否把 034/A03 存放骰计入来源（选择向导尚不支持存放骰的技能传 false，避免"按钮点进去做不完"）。 */
export function canPayCosts(g: GameState, player: PlayerId, need: CostNeed, opts: { held: boolean }): boolean {
  const pool = abilityDicePool(g, player).filter((d) => opts.held || d.source === 'area');
  return canPayFromPool(g, player, pool, need);
}

/** 某类型最多能凑出几格（含置换；`max` 为上限，0 表示一格都付不起）。供"可变数量"技能的默认参数/范围。 */
export function maxAffordableSlots(
  g: GameState,
  player: PlayerId,
  kind: DiceKind,
  max: number,
  opts: { held: boolean },
): number {
  const pool = abilityDicePool(g, player).filter((d) => opts.held || d.source === 'area');
  for (let n = Math.min(max, Math.floor(pool.length)); n >= 1; n--) {
    if (canPayFromPool(g, player, pool, { [kind]: n })) return n;
  }
  return 0;
}

/** 构造一个**可行**的 `SlotFill[]`：优先用同类型真骰/存放骰，缺口用 2 颗任意骰置换。
 *  顺序 = 攻击→防御→冥想（每类重复 N 次），与调用方按该顺序给的 spec 对齐。 */
export function defaultCostFills(
  g: GameState,
  player: PlayerId,
  need: CostNeed,
  opts: { held: boolean },
): SlotFill[] {
  const pool = abilityDicePool(g, player).filter((d) => opts.held || d.source === 'area');
  if (!canPayFromPool(g, player, pool, need)) throw new Error('defaultCostFills: cost not payable');
  const used = new Set<string>();
  const take = (pred: (d: AbilityDie) => boolean): AbilityDie | undefined => {
    const d = pool.find((x) => !used.has(x.id) && pred(x));
    if (d) used.add(d.id);
    return d;
  };
  const specOrder: DiceKind[] = [];
  for (const k of ['attack', 'defense', 'meditation'] as DiceKind[]) {
    for (let i = 0; i < (need[k] ?? 0); i++) specOrder.push(k);
  }
  const fills: SlotFill[] = [];
  const deferred: DiceKind[] = [];
  for (const k of specOrder) {
    const d = take((x) => x.kind === k);
    if (d) fills.push({ dieIds: [d.id] });
    else deferred.push(k);
  }
  for (const _k of deferred) {
    const a = take(() => true);
    const b = take(() => true);
    if (!a || !b) throw new Error('defaultCostFills: not enough dice for conversion');
    fills.push({ dieIds: [a.id, b.id] });
  }
  return fills;
}

/** A06 异相·「幽魂不散」（持续）：某玩家的**防御/冥想骰**被「使用」（抵挡/尘起）或「弃置」（技能效果）后，
 *  获得 **X 点攻击骰**（X = 其「虚臾」神器上的攻击骰数量）；**每玩家回合上限 2**；X=0 则不获得（不提示）。
 *  注意：**「消耗」不触发**（不要在任何"消耗代价"路径调用本函数；`paySlots(reason='skill')` 已排除）。 */
export function xuyuYouhunTrigger(g: GameState, player: PlayerId, count: number): void {
  if (count <= 0) return;
  const p = g.players[player];
  const card = p.artifacts.find((a) => a.skills.some((s) => s.key === 'xuyu.alt.youhun'));
  if (!card) return;
  const sk = card.skills.find((s) => s.key === 'xuyu.alt.youhun');
  if (!sk || !skillActive(card, sk)) return;
  const x = (card.heldDice ?? []).length; // 本神器上的攻击骰数量（由「勾魂」所置）
  if (x <= 0) return; // X=0：不获得（也不提示）
  const before = g.hunhunGained[player] ?? 0;
  const n = Math.min(count, Math.max(0, 2 - before));
  if (n <= 0) return;
  for (let i = 0; i < n; i++) {
    p.areas.attack.push(createDie(newDieId(`${player}-`), x, 'attack'));
  }
  g.hunhunGained[player] = before + n;
  logLine(
    g,
    `${pname(player)} 「幽魂不散」：防御/冥想骰被使用或弃置 ${count} 个 → 获得 ${n} 个 ${x} 点攻击骰（本回合已获得 ${g.hunhunGained[player]}/2）`,
  );
}

/** 支付“N 个骰位”的代价：每格 1 颗真骰(类型须匹配) 或 2 颗任意真骰(置换,值5)。
 *  移除所有真骰(返还供应堆)；返回各格“有效骰”；reportConsumed 按“格数”上报。 */
export function paySlots(
  g: GameState,
  player: PlayerId,
  spec: SlotSpec[],
  fills: SlotFill[],
  reportConsumed?: (n: number) => void,
  // 触发 026「威压」的这次「使用能力骰」来自哪种支付（供 UI 提示显示触发原因）
  reason: 'attack' | 'defense' | 'dustRise' | 'skill' = 'skill',
): EffectiveDie[] {
  if (fills.length !== spec.length) throw new Error(`expect ${spec.length} slot fills, got ${fills.length}`);
  const used = new Set<string>();
  const effective: EffectiveDie[] = [];
  const toRemove: string[] = [];
  const converted: { kind: DiceKind; values: number[] }[] = [];
  for (let i = 0; i < spec.length; i++) {
    const { kind } = spec[i];
    const ids = fills[i]?.dieIds ?? [];
    if (ids.length !== 1 && ids.length !== 2) throw new Error('each slot needs 1 (real) or 2 (converted) dice');
    for (const id of ids) {
      if (used.has(id)) throw new Error(`duplicate die id: ${id}`);
      used.add(id);
      if (!findDieOf(g, player, id) && !heldAsAbility(g, player, id)) throw new Error(`not your die: ${id}`);
    }
    if (ids.length === 1) {
      const found = findDieOf(g, player, ids[0]);
      const held = found ? null : heldAsAbility(g, player, ids[0]);
      const treated = fills[i]?.treated === true;
      const actualKind = found ? found.kind : held!.kind;
      const actualValue = found ? found.die.value : held!.value;
      if (actualKind !== kind && !treated) throw new Error(`slot needs a ${kind} die, got ${actualKind}`);
      effective.push({
        kind,
        value: actualValue,
        source: found ? (treated ? 'treated' : 'real') : 'artifact',
        realIds: [ids[0]],
      });
      if (treated && actualKind !== kind) {
        logLine(
          g,
          `${pname(player)} 使用「奇袭」视为：${kindCnOf(actualKind)}骰 ${actualValue} 点 → 视为${kindCnOf(kind)}骰`,
        );
      }
    } else {
      converted.push({ kind, values: ids.map((id) => abilityDieInfo(g, player, id)?.value ?? 0) });
      effective.push({ kind, value: 5, source: 'converted', realIds: [...ids] });
    }
    toRemove.push(...ids);
  }
  // 移除并返还供应堆（按当前所在区域移除；034 破障的神器骰从 heldDice 移除）
  for (const id of toRemove) {
    for (const k of KINDS) {
      g.players[player].areas[k] = g.players[player].areas[k].filter((d) => d.id !== id);
    }
    for (const a of g.players[player].artifacts) {
      if (a.heldDice) a.heldDice = a.heldDice.filter((h) => h.id !== id);
    }
  }
  // 「真实之剑」置换留痕（战报）
  if (converted.length > 0) {
    const kindCn = kindCnOf(converted[0].kind);
    if (converted.length === 1) {
      logLine(
        g,
        `${pname(player)} 使用「真实之剑」置换：消耗 2 颗能力骰（${converted[0].values.join('/')}）→ 视为 1 颗${kindCn}骰（点数按 5）`,
      );
    } else {
      const allVals = converted.flatMap((c) => c.values);
      logLine(
        g,
        `${pname(player)} 使用「真实之剑」置换：置换 ${converted.length} 格（另耗 ${allVals.length} 颗任意能力骰：${allVals.join('/')}）→ 视为 ${converted.length} 颗${kindCn}骰（点数按 5）`,
      );
    }
  }
  reportConsumed?.(spec.length);
  // A06 异相·「幽魂不散」：「使用」防御/冥想骰（抵挡 reason='defense' / 尘起 reason='dustRise'）时触发；
  // 「消耗」（reason='skill'）与攻击支付（reason='attack'）不触发。
  if (reason === 'defense' || reason === 'dustRise') {
    const usedDefMed = effective.filter((e) => e.kind === 'defense' || e.kind === 'meditation').length;
    if (usedDefMed > 0) xuyuYouhunTrigger(g, player, usedDefMed);
  }
  // 026 哀歌·威压（触发）：某人「使用 1 个任意能力骰后」→ 若其持有威压，弹出强制选择
  // （FAQ 26.2.1：先结算「威压」，再结算该骰的基础效果 —— 支付后立即排队，挡在后续结算之前）
  const weiyaCard = g.players[player].artifacts.find((a) => a.skills.some((s) => s.key === 'aige.weiya'));
  const weiyaSkill = weiyaCard?.skills.find((s) => s.key === 'aige.weiya');
  if (weiyaCard && weiyaSkill && skillActive(weiyaCard, weiyaSkill)) {
    const me = g.players[player];
    const oppId: PlayerId = player === 'A' ? 'B' : 'A';
    const opp = g.players[oppId];
    const anyTarget = KINDS.some((k) => me.areas[k].length > 0 || opp.areas[k].length > 0);
    if (anyTarget) {
      g.pendingQueue.push({ kind: 'weiyaPick', player, value: weiyaSkill.value ?? 4, reason });
    }
  }
  return effective;
}

/** 随机获得 count 颗指定类型的能力骰（点数为随机）；返回新骰 */
export function gainRandomDice(
  g: GameState,
  player: PlayerId,
  kind: DiceKind,
  count: number,
  rng: { rollDie(): number },
): Die[] {
  const out: Die[] = [];
  const p = g.players[player];
  for (let i = 0; i < count; i++) {
    const die: Die = { id: newDieId(`${player}-`), value: rng.rollDie(), kind };
    p.areas[kind].push(die);
    out.push(die);
  }
  return out;
}

/**
 * 随机获得 count 颗**未指定类型**的能力骰：按「骰点分布」放入对应区域（规则书 §8）。
 * 骰点分布取该玩家第二列神器。
 */
export function gainRandomAbilityDice(
  g: GameState,
  player: PlayerId,
  count: number,
  rng: { rollDie(): number },
): Die[] {
  const p = g.players[player];
  const dist = p.artifacts.find((a) => a.column === 2)?.distribution;
  if (!dist) throw new Error(`player ${player} has no distribution`);
  const out: Die[] = [];
  for (let i = 0; i < count; i++) {
    const die = createDie(newDieId(`${player}-`), rng.rollDie());
    placeDieByDistribution(p.areas, die, dist);
    out.push(die);
  }
  return out;
}

/** 用玩家/游戏里的 rngState 执行一段需要随机数的逻辑（供引擎各处复用） */
export function withRngState<T>(g: { rngState: number }, fn: (rng: SeededRng) => T): T {
  const rng = new SeededRng(g.rngState);
  const out = fn(rng);
  g.rngState = rng.state();
  return out;
}

