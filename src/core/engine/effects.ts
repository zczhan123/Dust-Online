import type {
  DiceKind,
  Die,
  EffectiveDie,
  GameState,
  PlayerId,
  SlotFill,
  SlotSpec,
} from '../model/types';
import { newDieId, createDie, placeDieByDistribution } from '../model/dice';
import { SeededRng } from '../rng/rng';
import { logLine, pname } from './log';
import { skillActive } from './skill-state';

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
      if (!findDieOf(g, player, id)) throw new Error(`not your die: ${id}`);
    }
    if (ids.length === 1) {
      const found = findDieOf(g, player, ids[0])!;
      const treated = fills[i]?.treated === true;
      if (found.kind !== kind && !treated) throw new Error(`slot needs a ${kind} die, got ${found.kind}`);
      effective.push({
        kind,
        value: found.die.value,
        source: treated ? 'treated' : 'real',
        realIds: [ids[0]],
      });
      if (treated && found.kind !== kind) {
        logLine(
          g,
          `${pname(player)} 使用「奇袭」视为：${kindCnOf(found.kind)}骰 ${found.die.value} 点 → 视为${kindCnOf(kind)}骰`,
        );
      }
    } else {
      converted.push({ kind, values: ids.map((id) => findDieOf(g, player, id)?.die.value ?? 0) });
      effective.push({ kind, value: 5, source: 'converted', realIds: [...ids] });
    }
    toRemove.push(...ids);
  }
  // 移除并返还供应堆（按当前所在区域移除）
  for (const id of toRemove) {
    for (const k of KINDS) {
      g.players[player].areas[k] = g.players[player].areas[k].filter((d) => d.id !== id);
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

