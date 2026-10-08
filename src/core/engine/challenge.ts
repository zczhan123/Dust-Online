import type { Die, GameState, PlayerId } from '../model/types';
import { challengeInertSkills, type ChallengeCard, type ChallengeSlot } from '../content/challenges';

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

/** 传奇按「防御规则」是否**愿意/可以**抵挡这次攻击（伤害 < 门槛 → 不挡）。 */
export function legendCanBlock(card: ChallengeCard, damage: number): boolean {
  return damage >= (card.defenseMin ?? 0);
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
