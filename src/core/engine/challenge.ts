import type { Die, GameState, PlayerId } from '../model/types';
import { CHALLENGES, challengeInertSkills, type ChallengeCard, type ChallengeSlot } from '../content/challenges';
import { createDie, newDieId } from '../model/dice';
import { fxPush } from './fx';
import { logLine } from './log';

/** 从小到大、按 id 稳定排序（保证"确定性默认分配"可测）。 */
function sortedDice(dice: Die[]): Die[] {
  return [...dice].sort((a, b) => a.value - b.value || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** arr 中取 n 个的组合（保序、确定性、上限 limit 防爆）。 */
function combos<T>(arr: T[], n: number, limit = 400): T[][] {
  const out: T[][] = [];
  const dfs = (start: number, cur: T[]): void => {
    if (out.length >= limit) return;
    if (cur.length === n) {
      out.push([...cur]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      cur.push(arr[i]);
      dfs(i + 1, cur);
      cur.pop();
      if (out.length >= limit) return;
    }
  };
  if (n > 0) dfs(0, []);
  return out;
}

/** 单个槽的候选分组（每组＝要消耗的骰 id），按确定性顺序排列。 */
function candidates(slot: ChallengeSlot, dice: Die[], taken: Set<string>): string[][] {
  const free = sortedDice(dice.filter((d) => !taken.has(d.id)));
  // 无限槽：容纳**全部**符合 `faces` 的驱动骰（整体作为"一组"）；一颗都没有则视为填不满
  if (slot.unlimited) {
    const faces = slot.faces ?? [];
    const ok = faces.length ? free.filter((d) => faces.includes(d.value)) : free;
    return ok.length ? [ok.map((d) => d.id)] : [];
  }
  const n = slot.count;
  if (n <= 0) return [[]];
  switch (slot.kind) {
    case 'pips': {
      const faces = slot.faces ?? [];
      const ok = free.filter((d) => faces.includes(d.value));
      return combos(ok, n).map((g) => g.map((d) => d.id));
    }
    case 'any':
      return combos(free, n).map((g) => g.map((d) => d.id));
    case 'same': {
      const byVal = new Map<number, Die[]>();
      for (const d of free) byVal.set(d.value, [...(byVal.get(d.value) ?? []), d]);
      const out: string[][] = [];
      for (const v of [...byVal.keys()].sort((a, b) => a - b)) {
        const group = byVal.get(v)!;
        if (group.length >= n) out.push(...combos(group, n).map((g) => g.map((d) => d.id)));
      }
      return out;
    }
    case 'straight': {
      const byVal = new Map<number, Die>();
      for (const d of free) if (!byVal.has(d.value)) byVal.set(d.value, d);
      const out: string[][] = [];
      for (let start = 1; start + n - 1 <= 6; start++) {
        const ids: string[] = [];
        for (let v = start; v < start + n; v++) {
          const d = byVal.get(v);
          if (!d) break;
          ids.push(d.id);
        }
        if (ids.length === n) out.push(ids);
      }
      return out;
    }
    case 'exact': {
      // 一组的**点数多重集恰好等于** `faces`（升序）。Z05「数罪并罚」{1,1}/{1,6}/{6,6}
      const need = [...(slot.faces ?? [])].sort((a, b) => a - b);
      const out: string[][] = [];
      for (const g of combos(free, need.length)) {
        const vs = g.map((d) => d.value).sort((a, b) => a - b);
        if (vs.length === need.length && vs.every((v, i) => v === need[i])) out.push(g.map((d) => d.id));
      }
      return out;
    }
    default:
      return [];
  }
}

/**
 * `slots` 能否用 `driven` **同时**填满（各槽互不重复）；能则返回**确定性默认**要消耗的骰 id，否则 `null`。
 * 空数组＝无需驱动骰（满足）。**这是"能/不能"的唯一判定**；"具体消耗哪几颗"的最终决定由代决层（模式 1）覆盖。
 */
export function matchSlots(slots: ChallengeSlot[], driven: Die[]): string[] | null {
  const taken = new Set<string>();
  const used: string[] = [];
  const dfs = (i: number): boolean => {
    if (i >= slots.length) return true;
    for (const group of candidates(slots[i], driven, taken)) {
      for (const id of group) taken.add(id);
      used.push(...group);
      if (dfs(i + 1)) return true;
      for (const id of group) taken.delete(id);
      used.length -= group.length;
    }
    return false;
  };
  return dfs(0) ? used : null;
}

/**
 * `perGroup` 技能（"每投出 1 组…"，Z05 数罪并罚/电刑）：各槽**各自独立**匹配（互不重复），
 * 返回**匹配到的各组**（槽下标 → 骰 id）。一组都没匹配上 → 空数组（＝本技能不发动）。
 * 贪心按槽序（确定性）：前面的槽优先占用骰子。
 */
export function matchGroupsPartial(
  slots: ChallengeSlot[],
  driven: Die[],
): { slot: number; ids: string[] }[] {
  const taken = new Set<string>();
  const out: { slot: number; ids: string[] }[] = [];
  for (let i = 0; i < slots.length; i++) {
    const cand = candidates(slots[i], driven, taken);
    if (cand.length === 0) continue; // 这一组凑不出 → 跳过，继续看后面的组
    const ids = cand[0];
    for (const id of ids) taken.add(id);
    out.push({ slot: i, ids });
  }
  return out;
}

/** 传奇按「防御规则」是否**愿意/可以**抵挡这次攻击（伤害 < 门槛 → 不挡）。 */
export function legendCanBlock(card: ChallengeCard, damage: number): boolean {
  return damage >= (card.defenseMin ?? 0);
}

/** 挑战模式 Z05「绝境天神」：传奇的**攻击伤害加成**——当前生命每比初始生命低 10 点 → +N。
 *  返回 `{value:0}` 表示无加成。（接入统一口径 `attackDamageBonus`。） */
export function legendAttackBonus(g: GameState): { value: number; label?: string } {
  if (g.mode !== 'challenge') return { value: 0 };
  const card = CHALLENGES.find((c) => c.id === g.challenge?.cardId);
  const per = card?.attackBonusPer10MissingLife ?? 0;
  if (!per || !card?.life) return { value: 0 };
  const v = Math.floor((card.life - g.players.B.life) / 10) * per;
  return v > 0 ? { value: v, label: '绝境天神' } : { value: 0 };
}

/** Z06「死即新生」：传奇（漆黑死神）生命归 0 时 → 立即复活（生命重设为 13 + 得 1..6 攻击骰各 1 个；整局 1 次）。
 *  返回 `true` ＝ 已复活（调用方**不要**判负）。独立于"逐条结算"顺序，任何时刻生命归 0 都触发。 */
export function legendDeathRevive(g: GameState): boolean {
  if (g.mode !== 'challenge' || !g.challenge || g.challenge.deathUsed) return false;
  if (g.players.B.life > 0) return false;
  const card = CHALLENGES.find((c) => c.id === g.challenge!.cardId);
  if (!card?.skills?.some((s) => s.id === 'z06-x')) return false;
  g.challenge.deathUsed = true;
  g.challenge.deathJustTriggered = true;
  g.players.B.life = 13;
  const spawn: { id: string; value: number; area: 'attack' | 'defense' | 'meditation' }[] = [];
  for (let v = 1; v <= 6; v++) {
    const die = createDie(newDieId('chg-B-'), v, 'attack');
    g.players.B.areas.attack.push(die);
    spawn.push({ id: die.id, value: v, area: 'attack' });
  }
  logLine(g, `「${card.legacy}」：死即新生 — 生命重设为 13，获得 1~6 点攻击骰各 1 个`);
  fxPush({
    kind: 'legendSkill',
    player: 'B',
    skillKey: 'z06-x',
    skillName: '死即新生',
    consumed: [],
    spawn,
    outIds: [],
    attack: false,
    announce: true,
  });
  return true;
}

/**
 * 往**传奇（B）防御骰区**加 1 颗骰（新造 / 从别处搬入）；**已达 `card.defenseCap` → 直接弃置**（不加入，返回 `false`）。
 * **唯一入口**——⚠️ 任何"传奇获得 / 搬入防御骰"的代码**都必须走它**，**禁止**在别处直接 `areas.defense.push`。
 * 口径（2026-10-10 用户定）：满上限＝**新骰弃置**，**不是**"挤掉最旧"。挑战模式以外不设限。
 */
export function addLegendDefense(g: GameState, die: Die): boolean {
  if (g.mode === 'challenge') {
    const card = CHALLENGES.find((c) => c.id === g.challenge?.cardId);
    const cap = card?.defenseCap ?? Number.POSITIVE_INFINITY;
    if (g.players.B.areas.defense.length >= cap) return false; // 已满 → 直接弃置
  }
  g.players.B.areas.defense.push(die);
  return true;
}

/** 「昔日传奇」固定坐 B 席（挑战者坐 A 席）——削弱判定要用到。 */
export const LEGEND_PLAYER: PlayerId = 'B';

/**
 * 该神器技能在**这一方手里**是否**整条失效**（挑战模式的"特殊规则"；名单唯一来源 `CHALLENGE_RULE_NOTES`）。
 *
 * ⚠️ 削弱是**按玩家**判定的，**不是**按模式一刀切——两侧理由不同、作用方向相反：
 *  - `tianfa.bairi` / `tianfa.alt.shenkong`：只废**挑战者(A)**。FAQ 27.1.2 / 41.1.1 原文：
 *    "在单人挑战中，昔日传奇没有冥想骰区，我的『天罚·白昼之火』会正常生效吗？→ 为了降低『天罚』
 *     **面对昔日传奇**时的压制能力，我们设定『天罚·白昼之火』没有任何效果。"
 *    → 被废的是"打向传奇"的那一份；传奇自己拿到 028 时**照常生效**（它面对的挑战者有冥想骰区）。
 *  - `minglei.leibao.continuous` / `youming.weimu`：只废**昔日传奇(B)**——「昔日传奇」没有重掷阶段。
 *  - 标准模式：一律 false（旧路径零变化）。
 *  - 其它不在名单里的技能：false。
 */
export function isInertSkill(g: GameState, player: PlayerId, key: string): boolean {
  if (g.mode !== 'challenge') return false;
  if (!challengeInertSkills().has(key)) return false;
  if (key === 'tianfa.bairi' || key === 'tianfa.alt.shenkong') return player !== LEGEND_PLAYER;
  return player === LEGEND_PLAYER;
}
