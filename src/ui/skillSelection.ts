import type { DiceKind, Die, GameState, PlayerId } from '../core/model/types';
import { hasActiveSkill } from '../core/engine/skill-state';
import { abilityDicePool, abilityDieInfo } from '../core/engine/effects';
import { effectiveWill } from '../core/engine/derive';

export type SelectStep =
  | {
      kind: 'dice';
      label: string;
      owner: 'self' | 'opponent';
      areas: DiceKind[];
      min: number;
      max: number;
      filter?: (d: { id: string; value: number; kind: DiceKind }) => boolean;
      /** 跨骰约束（如 022「填弹」的顺点）：不满足时禁止确认并给出提示 */
      validate?: (dice: { id: string; value: number; kind: DiceKind }[]) => { ok: boolean; hint?: string };
      /** 本步是「使用/消耗」的支付（走 paySlots）→ 034 破障的存放骰也可选；「弃置/移动」类禁开 */
      allowArtifact?: boolean;
      /** Z12「不动菩提」：本步不是"使用/消耗/弃置"（如移动/改点/置换源骰）→ 不按封锁过滤 */
      ignoreLock?: boolean;
    }
  | { kind: 'option'; label: string; options: { value: string; label: string }[] }
  | { kind: 'number'; label: string; min: number; max: number; fmt?: (n: number) => string }
  | { kind: 'pips'; label: string; min: number; max: number } // 从 1–6 多选互不相同的点数（存放到神器等）
  | { kind: 'slots'; label: string; kinds: DiceKind[] } // 每个代价骰位一个类型

export interface StepArgs {
  state: GameState;
  player: PlayerId;
  chosenDice: string[][];
  options: string[];
  numbers: number[];
  slots: string[][];
}

export interface SelectionArgs extends StepArgs {
  numbers: number[];
}

export interface SkillSelection {
  steps: (args: StepArgs) => SelectStep[];
  buildParams: (args: SelectionArgs) => Record<string, unknown>;
  /** 多颗「真实之剑」代价（S1 缩短）：向导最后一步**直接派发**，不再弹确认条（代价汇总已写在该步标题里） */
  direct?: boolean;
}

/** 本次是否走「多颗真实之剑代价」的直发流程（S1）：需**持剑**且该技能有多颗代价。 */
export function isDirectCost(spec: SkillSelection, state: GameState, player: PlayerId): boolean {
  return !!spec.direct && hasSword(state, player);
}

const KINDS: DiceKind[] = ['attack', 'defense', 'meditation'];
const oppOf = (p: PlayerId): PlayerId => (p === 'A' ? 'B' : 'A');
/** 每颗选中的骰作为一个“真骰”骰位（未启用置换时的回退映射） */
const realSlots = (ids: string[] | undefined): { dieIds: string[] }[] => (ids ?? []).map((id) => ({ dieIds: [id] }));
/** 已填骰位（长度 1=真骰，2=置换）→ 引擎 costSlots */
const slotsParam = (slots: string[][]): { dieIds: string[] }[] => slots.map((ids) => ({ dieIds: [...ids] }));
/** 该玩家是否已激活 010「真实之剑」：激活后技能代价可用 2 颗顶 1 颗置换 */
export const hasSword = (state: GameState, player: PlayerId): boolean =>
  hasActiveSkill(state.players[player], 'shenhong.sword');
const SLOTS_LABEL = '支付代价（可用「真实之剑」置换能力骰）';
const repeatKind = (kind: DiceKind, n: number): DiceKind[] => Array.from({ length: n }, () => kind);

const KIND_CN: Record<DiceKind, string> = { attack: '攻击', defense: '防御', meditation: '冥想' };
/** 可支付能力骰数（区域真骰 + 034/A03 存放骰）按类型——代价向导的可行范围据此计算 */
const kindCount = (state: GameState, player: PlayerId, kind: DiceKind): number =>
  abilityDicePool(state, player).filter((d) => d.kind === kind).length;
/** 可支付能力骰总数（区域真骰 + 存放骰） */
const payTotalDice = (state: GameState, player: PlayerId): number => abilityDicePool(state, player).length;
/** 区域真骰总数（仅用于「结束阶段超出意志上限」等与存放骰无关的场合） */
const totalDice = (state: GameState, player: PlayerId): number =>
  KINDS.reduce((n, k) => n + state.players[player].areas[k].length, 0);
/** 把一串 id 每 2 个配成一对（用于「置换」骰位） */
const chunkPairs = (ids: string[]): string[][] => {
  const out: string[][] = [];
  for (let i = 0; i + 1 < ids.length; i += 2) out.push([ids[i], ids[i + 1]]);
  return out;
};

/** 一次“消耗 N 个<类型>骰”代价的静态描述 */
interface CostSpec {
  /** 技能显示名（用于步骤用语） */
  skill: string;
  /** 所需骰类型 */
  kind: DiceKind;
  /** 骰位上限 */
  maxSlots: number;
  /** 数量是否可变（1..maxSlots）；false 表示恰好 maxSlots 颗 */
  variable: boolean;
}

/** 最多可支付的骰位数：2N ≤（总骰数 + 该类型真骰数），且不超过上限 */
function maxSlotsFor(state: GameState, player: PlayerId, spec: CostSpec): number {
  const bound = Math.floor((payTotalDice(state, player) + kindCount(state, player, spec.kind)) / 2);
  return Math.max(0, Math.min(spec.maxSlots, bound));
}

/** 给定骰位数 N，可行的置换数区间 [minM, maxM]（连续） */
function mRangeFor(state: GameState, player: PlayerId, spec: CostSpec, N: number): [number, number] {
  const minM = Math.max(0, N - kindCount(state, player, spec.kind));
  const maxM = Math.min(N, payTotalDice(state, player) - N);
  return [minM, Math.max(minM, maxM)];
}

/** 读取玩家已选的置换数 M（可变数量技能：numbers[1]；固定数量：numbers[0]） */
const chosenM = (spec: CostSpec, numbers: number[]): number =>
  spec.variable ? (numbers[1] ?? 0) : (numbers[0] ?? 0);

/**
 * 是否存在「选置换源」这一步——决定 `chosenDice` 里代价之后的下标（`costPart.groups`）。
 * 旧交互看 `numbers`；新交互按"真骰还差几格 + 可用骰数"现场判定。
 */
function swordHasSubStep(
  state: GameState,
  player: PlayerId,
  spec: CostSpec,
  numbers: number[],
  chosenDice: string[][],
): boolean {
  if (spec.maxSlots === 1) return chosenM(spec, numbers) > 0;
  const real = chosenDice[0] ?? [];
  if (spec.variable) {
    const room = spec.maxSlots - real.length;
    const sources = payTotalDice(state, player) - real.length;
    return room > 0 && sources >= 2;
  }
  return spec.maxSlots - real.length > 0;
}

/** 汇总句（P1 防呆用）：`真骰 2（冥2·冥4）＋ 置换 1 组（视为 5）＝ 3 格` */
function swordSummary(
  state: GameState,
  player: PlayerId,
  spec: CostSpec,
  numbers: number[],
  chosenDice: string[][],
): string {
  const real = chosenDice[0] ?? [];
  const conv = swordHasSubStep(state, player, spec, numbers, chosenDice) ? (chosenDice[1] ?? []) : [];
  const groups = Math.floor(conv.length / 2);
  if (real.length === 0 && groups === 0) return '';
  const vals = real
    .map((id) => abilityDieInfo(state, player, id)?.value)
    .filter((v): v is number => v !== undefined);
  const parts: string[] = [];
  if (real.length) parts.push(`真骰 ${real.length}${vals.length ? `（${vals.join('·')}）` : ''}`);
  if (groups) parts.push(`置换 ${groups} 组（视为 5）`);
  return `▸ 合计 ${real.length + groups} 格：${parts.join(' ＋ ')}`;
}

/**
 * 「真实之剑」代价的**新交互（S3）**：① 选真骰（**点几颗＝几格**）→ ②（不足/想加）选置换源 → **直接发动**。
 * 「恰好 1 颗」的技能走旧交互 `swordCostStepsOne`（保持不变）。
 */
function swordCostSteps(
  state: GameState,
  player: PlayerId,
  spec: CostSpec,
  numbers: number[],
  chosenDice: string[][],
): SelectStep[] {
  if (spec.maxSlots === 1) return swordCostStepsOne(state, player, spec, numbers, chosenDice);
  const typeName = KIND_CN[spec.kind];
  const N = spec.maxSlots;
  const real = chosenDice[0] ?? [];
  // 防呆 P2（死路预防）：固定款"真骰至少要选几颗"，否则置换源凑不够（realMin = max(0, 2N − 可用骰总数)）。
  // 可变款下限为 **0**：允许"这几格全用「真实之剑」置换"（由步②补足最小格数）。
  const minReal = spec.variable
    ? 0
    : Math.min(kindCount(state, player, spec.kind), Math.max(0, 2 * N - payTotalDice(state, player)));
  const summary = swordSummary(state, player, spec, numbers, chosenDice);
  const steps: SelectStep[] = [
    {
      kind: 'dice',
      label:
        (spec.variable
          ? `选真骰 · ${typeName}（0–${N} 颗；0＝这几格全用「真实之剑」置换）`
          : `选真骰 · ${typeName}（${minReal}–${N} 颗；不够用「真实之剑」补）`) +
        (summary ? `　${summary}` : ''),
      owner: 'self',
      areas: [spec.kind],
      min: minReal,
      max: N,
      allowArtifact: true,
    },
  ];
  const hasSub = swordHasSubStep(state, player, spec, numbers, chosenDice);
  if (hasSub) {
    const sources = payTotalDice(state, player) - real.length;
    const room = N - real.length;
    if (spec.variable) {
      steps.push({
        kind: 'dice',
        label: `再选偶数颗任意骰补格（每 2 颗＝1 格，视为 5 点；0＝不加）`,
        owner: 'self',
        areas: KINDS,
        min: Math.max(0, 2 * (1 - real.length)),
        max: Math.min(2 * room, 2 * Math.floor(sources / 2)),
        filter: (d) => !real.includes(d.id),
        allowArtifact: true,
        ignoreLock: true,
        validate: (ds) =>
          ds.length % 2 === 0
            ? { ok: true, hint: ds.length ? `${ds.length / 2} 组置换（视为 5 点）` : '不置换' }
            : { ok: false, hint: '需选偶数颗（每 2 颗＝1 格）' },
      });
    } else {
      const needDice = room * 2;
      steps.push({
        kind: 'dice',
        label: `再选恰好 ${needDice} 颗任意骰（每 2 颗＝1 格，视为 5 点）`,
        owner: 'self',
        areas: KINDS,
        min: needDice,
        max: needDice,
        filter: (d) => !real.includes(d.id),
        allowArtifact: true,
        ignoreLock: true,
      });
    }
  }
  return steps;
}

/** 「真实之剑」代价的**旧交互**（仅「恰好 1 颗」的技能用，按用户要求保持不变）：
 *  ①置换几组 ②实际消耗的真骰 ③用于置换的任意骰 */
function swordCostStepsOne(
  state: GameState,
  player: PlayerId,
  spec: CostSpec,
  numbers: number[],
  chosenDice: string[][],
): SelectStep[] {
  const typeName = KIND_CN[spec.kind];
  const steps: SelectStep[] = [];
  const maxN = Math.max(1, maxSlotsFor(state, player, spec));
  const N = spec.variable ? numbers[0] ?? 1 : spec.maxSlots;
  if (spec.variable) {
    steps.push({
      kind: 'number',
      label: `请选择「${spec.skill}」本次结算消耗几颗${typeName}骰`,
      min: 1,
      max: maxN,
      fmt: (n) => `${n} 颗`,
    });
  }
  const [minM, maxM] = mRangeFor(state, player, spec, N);
  steps.push({
    kind: 'number',
    label: `请选择「真实之剑」置换填充几颗${typeName}骰（2 颗任意骰＝1 颗，点数按 5；0 为不置换）`,
    min: minM,
    max: maxM,
    fmt: (n) => (n === 0 ? '不置换' : `置换 ${n} 颗`),
  });
  const M = chosenM(spec, numbers);
  const realCount = N - M;
  steps.push({
    kind: 'dice',
    label: `请选择「${spec.skill}」实际消耗的${typeName}骰`,
    owner: 'self',
    areas: [spec.kind],
    min: realCount,
    max: realCount,
    allowArtifact: true,
  });
  if (M > 0) {
    const realPicked = new Set(chosenDice[0] ?? []);
    steps.push({
      kind: 'dice',
      label: `请选择用于置换的任意 ${M * 2} 颗能力骰（每 2 颗顶 1 颗${typeName}骰）`,
      owner: 'self',
      areas: KINDS,
      min: M * 2,
      max: M * 2,
      filter: (d) => !realPicked.has(d.id),
      allowArtifact: true,
    });
  }
  return steps;
}

/** 从向导状态组装 costSlots；groups = 代价占用的 chosenDice 组数（供后续步骤定位） */
function costPart(
  state: GameState,
  player: PlayerId,
  spec: CostSpec,
  numbers: number[],
  chosenDice: string[][],
): { costSlots: { dieIds: string[] }[]; groups: number } {
  if (!hasSword(state, player)) {
    return { costSlots: realSlots(chosenDice[0]), groups: 1 };
  }
  const real = chosenDice[0] ?? [];
  const hasSub = swordHasSubStep(state, player, spec, numbers, chosenDice);
  const conv = hasSub ? chosenDice[1] ?? [] : [];
  return {
    costSlots: [
      ...real.map((id) => ({ dieIds: [id] })),
      ...chunkPairs(conv).map((pair) => ({ dieIds: pair })),
    ],
    groups: hasSub ? 2 : 1,
  };
}

const SPEC_TENGWAN: CostSpec = { skill: '龙腾万丈', kind: 'meditation', maxSlots: 3, variable: false };
const SPEC_QIANXING: CostSpec = { skill: '潜行', kind: 'attack', maxSlots: 2, variable: false };
const SPEC_FIST: CostSpec = { skill: '王家之拳', kind: 'meditation', maxSlots: 2, variable: false };
const SPEC_BARRIER: CostSpec = { skill: '灵能屏障', kind: 'defense', maxSlots: 3, variable: true };
const SPEC_PULSE: CostSpec = { skill: '灵能脉冲', kind: 'attack', maxSlots: 3, variable: true };
const SPEC_WANSHA: CostSpec = { skill: '零时枭首', kind: 'attack', maxSlots: 1, variable: false };
const SPEC_MINGJIE: CostSpec = { skill: '冥界行走', kind: 'meditation', maxSlots: 3, variable: true };
const SPEC_HUANYU: CostSpec = { skill: '寰宇飞升', kind: 'meditation', maxSlots: 4, variable: false };
const SPEC_EYI: CostSpec = { skill: '恶意', kind: 'attack', maxSlots: 1, variable: false };

function ownDieValue(state: GameState, player: PlayerId, id: string | undefined): number | undefined {
  if (!id) return undefined;
  for (const k of KINDS) {
    const d = state.players[player].areas[k].find((x) => x.id === id);
    if (d) return d.value;
  }
  return undefined;
}

/** 034 金刚·激活（破障 / 不动菩提同效）：一次选 3 个互不相同的点数存放到神器上 */
const jingangLoadSelection: SkillSelection = {
  steps: () => [
    { kind: 'pips' as const, label: '「金刚」：选择存放的 3 个互不相同的点数', min: 3, max: 3 },
  ],
  buildParams: ({ chosenDice }) => ({ pips: (chosenDice[0] ?? []).map(Number) }),
};

/** A03 金刚·异相激活（修罗的破障 / 修罗的菩提同效）：两步各选 1 个点数（可相同）→ 2 个任意点数存放 */
const jingang2LoadSelection: SkillSelection = {
  steps: () => [
    { kind: 'pips' as const, label: '选择第 1 颗存放骰的点数（1–6）', min: 1, max: 1 },
    { kind: 'pips' as const, label: '选择第 2 颗存放骰的点数（1–6，可与第 1 颗相同）', min: 1, max: 1 },
  ],
  buildParams: ({ chosenDice }) => ({
    pips: [...(chosenDice[0] ?? []), ...(chosenDice[1] ?? [])].map(Number),
  }),
};

export const SKILL_SELECTION: Record<string, SkillSelection> = {
  'yuqie.breakthrough': {
    steps: ({ state, player, chosenDice, slots }) => {
      const selfMed = state.players[player].areas.meditation.length;
      const oppDef = state.players[oppOf(player)].areas.defense.length;
      if (hasSword(state, player)) {
        const n = Math.min(3, selfMed);
        const need = Math.min(n, oppDef);
        return [
          { kind: 'slots', label: SLOTS_LABEL, kinds: repeatKind('meditation', n) },
          { kind: 'dice', label: `选择弃置对方的防御骰（${need} 颗）`, owner: 'opponent', areas: ['defense'], min: need, max: need },
        ];
      }
      const medCount = chosenDice[0]?.length ?? 0;
      const need = Math.min(medCount, oppDef);
      void slots;
      return [
        { kind: 'dice', label: '选择消耗的冥想骰（1–3 颗）', owner: 'self', areas: ['meditation'], min: 1, max: Math.min(3, selfMed), allowArtifact: true },
        { kind: 'dice', label: `选择弃置对方的防御骰（${need} 颗）`, owner: 'opponent', areas: ['defense'], min: need, max: need },
      ];
    },
    buildParams: ({ chosenDice, slots }) => ({
      costSlots: slots.length ? slotsParam(slots) : realSlots(chosenDice[0]),
      opponentDefenseDieIds: slots.length ? (chosenDice[0] ?? []) : (chosenDice[1] ?? []),
    }),
  },
  // C01 特典·突破（启动）：消耗任意数量冥想骰（C01 第一列 → 无置换/存放骰）→ 弃对方等量防御骰
  // 交互：**直接选冥想骰（选几颗＝消耗几颗）**，不再先问"消耗几颗" → 由 3 步简化为 2 步。
  'c01.breakthrough': {
    steps: ({ state, player, chosenDice }) => {
      const med = state.players[player].areas.meditation.length;
      const oppDef = state.players[oppOf(player)].areas.defense.length;
      const maxN = Math.max(1, med);
      const picked = chosenDice[0]?.length ?? 0;
      const need = Math.min(picked, oppDef);
      return [
        { kind: 'dice', label: `选择消耗的冥想骰（1–${maxN} 颗）`, owner: 'self', areas: ['meditation'], min: 1, max: maxN },
        { kind: 'dice', label: `选择弃置对方的防御骰（${need} 颗）`, owner: 'opponent', areas: ['defense'], min: need, max: need },
      ];
    },
    buildParams: ({ chosenDice }) => ({
      costSlots: realSlots(chosenDice[0]),
      opponentDefenseDieIds: chosenDice[1] ?? [],
    }),
  },
  'youlong.tengwan': {
    steps: ({ state, player, chosenDice, numbers }) =>
      hasSword(state, player)
        ? swordCostSteps(state, player, SPEC_TENGWAN, numbers, chosenDice)
        : [{ kind: 'dice', label: '选择消耗的冥想骰（恰好 3 颗）', owner: 'self', areas: ['meditation'], min: 3, max: 3, allowArtifact: true }],
    buildParams: ({ state, player, chosenDice, numbers }) => ({
      costSlots: costPart(state, player, SPEC_TENGWAN, numbers, chosenDice).costSlots,
    }),
    direct: true,
  },
  'yingle.qianxing': {
    steps: ({ state, player, chosenDice, numbers }) =>
      hasSword(state, player)
        ? swordCostSteps(state, player, SPEC_QIANXING, numbers, chosenDice)
        : [{ kind: 'dice', label: '选择消耗的攻击骰（恰好 2 颗）', owner: 'self', areas: ['attack'], min: 2, max: 2, allowArtifact: true }],
    buildParams: ({ state, player, chosenDice, numbers }) => ({
      costSlots: costPart(state, player, SPEC_QIANXING, numbers, chosenDice).costSlots,
    }),
    direct: true,
  },
  'buxiang.cuilian': {
    steps: ({ state, player }) =>
      hasSword(state, player)
        ? [{ kind: 'slots', label: SLOTS_LABEL, kinds: repeatKind('attack', 1) }]
        : [{ kind: 'dice', label: '选择消耗的攻击骰（恰好 1 颗）', owner: 'self', areas: ['attack'], min: 1, max: 1, allowArtifact: true }],
    buildParams: ({ chosenDice, slots }) => ({
      costSlots: slots.length ? slotsParam(slots) : realSlots(chosenDice[0]),
    }),
  },
  'yingle.yingxi': {
    steps: ({ state, player, chosenDice }) => {
      const first = chosenDice[0]?.[0];
      const steps: SelectStep[] = [
        { kind: 'dice', label: '选择要点数下降的能力骰（恰好 1 颗，点数≥2）', owner: 'self', areas: ['attack', 'defense', 'meditation'], min: 1, max: 1, filter: (d) => d.value >= 2, ignoreLock: true },
      ];
      if (first) {
        const die = KINDS.flatMap((k) => state.players[player].areas[k]).find((d) => d.id === first);
        const max = Math.max(1, (die?.value ?? 2) - 1);
        steps.push({ kind: 'number', label: `选择下降点数 X（1 ~ ${max}，最低降为 1）`, min: 1, max });
      }
      return steps;
    },
    buildParams: ({ chosenDice, numbers }) => ({ dieId: chosenDice[0]?.[0], x: numbers[0] }),
  },
  'wansha.ultimate': {
    steps: ({ state, player, chosenDice, numbers }) => {
      const oppDef = state.players[oppOf(player)].areas.defense.length;
      if (hasSword(state, player)) {
        const M = chosenM(SPEC_WANSHA, numbers);
        const costValue = M > 0 ? 5 : ownDieValue(state, player, chosenDice[0]?.[0]) ?? 0;
        const need = Math.min(costValue, oppDef);
        return [
          ...swordCostSteps(state, player, SPEC_WANSHA, numbers, chosenDice),
          { kind: 'dice', label: `选择弃置对方的防御骰（${need} 颗）`, owner: 'opponent', areas: ['defense'], min: need, max: need },
        ];
      }
      const costValue = ownDieValue(state, player, chosenDice[0]?.[0]) ?? 0;
      const need = Math.min(costValue, oppDef);
      return [
        { kind: 'dice', label: '选择消耗的攻击骰（恰好 1 颗）', owner: 'self', areas: ['attack'], min: 1, max: 1, allowArtifact: true },
        { kind: 'dice', label: `选择弃置对方的防御骰（${need} 颗）`, owner: 'opponent', areas: ['defense'], min: need, max: need },
      ];
    },
    buildParams: ({ state, player, chosenDice, numbers }) => {
      const { costSlots, groups } = costPart(state, player, SPEC_WANSHA, numbers, chosenDice);
      return { costSlots, opponentDefenseDieIds: chosenDice[groups] ?? [] };
    },
  },
  // A07 异相·历王之血之印：弃置对方防御骰至与你攻击骰数相等（发起者选）
  'wansha.alt.ultimate': {
    steps: ({ state, player }) => {
      const myAtk = state.players[player].areas.attack.length;
      const required = Math.max(0, state.players[oppOf(player)].areas.defense.length - myAtk);
      if (required <= 0) return [];
      return [
        { kind: 'dice', label: `选择弃置对方的防御骰（${required} 颗，至与你攻击骰数 ${myAtk} 相等）`, owner: 'opponent', areas: ['defense'], min: required, max: required },
      ];
    },
    buildParams: ({ chosenDice }) => ({ opponentDefenseDieIds: chosenDice[0] ?? [] }),
  },
  'mingjing.ultimate': {
    steps: ({ state, player, chosenDice }) => {
      const p = state.players[player];
      const o = state.players[oppOf(player)];
      const steps: SelectStep[] = [];
      let i = 0;
      for (const k of KINDS) {
        const want = Math.min(p.areas[k].length, o.areas[k].length);
        if (want > 0) {
          const name = k === 'attack' ? '攻击' : k === 'defense' ? '防御' : '冥想';
          steps.push({ kind: 'dice', label: `选择弃置对方的${name}骰（${want} 颗）`, owner: 'opponent', areas: [k], min: want, max: want });
          i++;
        }
      }
      void chosenDice; void i;
      return steps;
    },
    buildParams: ({ state, player, chosenDice }) => {
      const p = state.players[player];
      const o = state.players[oppOf(player)];
      const map: Record<string, string[]> = { attack: [], defense: [], meditation: [] };
      let i = 0;
      for (const k of KINDS) {
        const want = Math.min(p.areas[k].length, o.areas[k].length);
        if (want > 0) {
          map[k] = chosenDice[i] ?? [];
          i++;
        }
      }
      return { opponentDiceByKind: map };
    },
  },
  // 007 战争横扫：消耗 1 攻 + 1 防 + 1 冥（**合并为一步**）→ 弃对方 0–1 攻/防/冥（**合并为一步**）。
  // 注意：007 为第一列，与 010「真实之剑」永不同队 → 无置换路径（故不涉及 slots）。
  'zhuzai.sweep': {
    steps: ({ state, player }) => {
      const oppAreas = state.players[oppOf(player)].areas;
      const haveKinds = (['attack', 'defense', 'meditation'] as DiceKind[]).filter(
        (k) => oppAreas[k].length > 0,
      );
      const steps: SelectStep[] = [
        {
          kind: 'dice',
          label: '选择消耗的 3 颗能力骰（攻击 / 防御 / 冥想 各 1 颗）',
          owner: 'self',
          areas: ['attack', 'defense', 'meditation'],
          min: 3,
          max: 3,
          allowArtifact: true,
          validate: (dice) => {
            const kinds = dice.map((d) => d.kind);
            return kinds.length === 3 && new Set(kinds).size === 3
              ? { ok: true, hint: '三类各 1 颗 ✓' }
              : { ok: false, hint: '必须攻击 / 防御 / 冥想 各选 1 颗' };
          },
        },
      ];
      // 「能弃则必须弃」：对方**有**的类别各必弃 1 颗（缺类自动跳过；对方全空 → 无此步）
      if (haveKinds.length > 0) {
        const names = haveKinds.map((k) => KIND_CN[k]).join(' / ');
        steps.push({
          kind: 'dice',
          label: `选择弃置对方的能力骰（${names} 各 1 颗）`,
          owner: 'opponent',
          areas: haveKinds,
          min: haveKinds.length,
          max: haveKinds.length,
          validate: (dice) =>
            new Set(dice.map((d) => d.kind)).size === dice.length
              ? { ok: true }
              : { ok: false, hint: '每种类型各 1 颗' },
        });
      }
      return steps;
    },
    buildParams: ({ state, player, chosenDice }) => {
      const oppId = oppOf(player);
      const byKind = (ids: string[], owner: PlayerId): Partial<Record<DiceKind, string>> => {
        const m: Partial<Record<DiceKind, string>> = {};
        for (const id of ids) {
          const k = abilityDieInfo(state, owner, id)?.kind;
          if (k) m[k] = id;
        }
        return m;
      };
      const c = byKind(chosenDice[0] ?? [], player);
      const d = byKind(chosenDice[1] ?? [], oppId);
      return {
        // costSlots 必须按 [攻击, 防御, 冥想] 顺序（引擎 spec 顺序）
        costSlots: [
          ...(c.attack ? [{ dieIds: [c.attack] }] : []),
          ...(c.defense ? [{ dieIds: [c.defense] }] : []),
          ...(c.meditation ? [{ dieIds: [c.meditation] }] : []),
        ],
        discard: { attack: d.attack, defense: d.defense, meditation: d.meditation },
      };
    },
  },
  // 007 震荡斩击：选类型 → 消耗 4 颗同类型（显式）→ 弃对方 0–4 颗同类型（显式）
  'zhuzai.smash': {
    steps: ({ state, player, options }) => {
      const kind = options[0];
      const name = kind === 'attack' ? '攻击' : kind === 'defense' ? '防御' : '冥想';
      const steps: SelectStep[] = [
        {
          kind: 'option',
          label: '选择消耗的能力骰类型',
          options: [
            { value: 'attack', label: '攻击' },
            { value: 'defense', label: '防御' },
            { value: 'meditation', label: '冥想' },
          ],
        },
      ];
      if (kind === 'attack' || kind === 'defense' || kind === 'meditation') {
        steps.push({ kind: 'dice', label: `选择消耗的 4 个${name}骰`, owner: 'self', areas: [kind], min: 4, max: 4, allowArtifact: true });
        // 「能弃则必须弃」：恰弃 min(4, 对方该类骰数) 颗
        const need = Math.min(4, state.players[oppOf(player)].areas[kind].length);
        steps.push({
          kind: 'dice',
          label: `选择弃置对方的${name}骰（恰好 ${need} 颗${need === 4 ? '' : '（对方只有这么多）'}）`,
          owner: 'opponent',
          areas: [kind],
          min: need,
          max: need,
        });
      }
      return steps;
    },
    buildParams: ({ chosenDice, options }) => ({
      kind: options[0],
      costSlots: realSlots(chosenDice[1]),
      opponentDiscardIds: chosenDice[2] ?? [],
    }),
  },
  // 008 王家之拳：消耗 2 颗冥想骰 → 弃置自己的 0–2 颗防御骰（不足可少弃，代价为真实伤害）
  'tiebi.fist': {
    steps: ({ state, player, chosenDice, numbers }) => {
      const discard: SelectStep = {
        kind: 'dice',
        label: '选择弃置的防御骰（0–2 颗，不足可少弃）',
        owner: 'self',
        areas: ['defense'],
        min: 0,
        max: 2,
      };
      if (hasSword(state, player)) {
        return [...swordCostSteps(state, player, SPEC_FIST, numbers, chosenDice), discard];
      }
      return [
        { kind: 'dice', label: '选择消耗的冥想骰（恰好 2 颗）', owner: 'self', areas: ['meditation'], min: 2, max: 2, allowArtifact: true },
        discard,
      ];
    },
    buildParams: ({ state, player, chosenDice, numbers }) => {
      const { costSlots, groups } = costPart(state, player, SPEC_FIST, numbers, chosenDice);
      return { costSlots, defenseDieIds: chosenDice[groups] ?? [] };
    },
    direct: true,
  },
  // 011 灵能屏障·启动：消耗最多 3 颗防御骰 → 获得 2 倍冥想骰
  'dunwu.barrier.activate': {
    steps: ({ state, player, chosenDice, numbers }) =>
      hasSword(state, player)
        ? swordCostSteps(state, player, SPEC_BARRIER, numbers, chosenDice)
        : [
            {
              kind: 'dice',
              label: '选择消耗的防御骰（1–3 颗）',
              owner: 'self',
              areas: ['defense'],
              min: 1,
              max: Math.min(3, state.players[player].areas.defense.length),
              allowArtifact: true,
            },
          ],
    buildParams: ({ state, player, chosenDice, numbers }) => ({
      costSlots: costPart(state, player, SPEC_BARRIER, numbers, chosenDice).costSlots,
    }),
    direct: true,
  },
  // 011 灵能脉冲·启动：消耗最多 3 颗攻击骰 → 获得 2 倍冥想骰
  'dunwu.pulse.activate': {
    steps: ({ state, player, chosenDice, numbers }) =>
      hasSword(state, player)
        ? swordCostSteps(state, player, SPEC_PULSE, numbers, chosenDice)
        : [
            {
              kind: 'dice',
              label: '选择消耗的攻击骰（1–3 颗）',
              owner: 'self',
              areas: ['attack'],
              min: 1,
              max: Math.min(3, state.players[player].areas.attack.length),
              allowArtifact: true,
            },
          ],
    buildParams: ({ state, player, chosenDice, numbers }) => ({
      costSlots: costPart(state, player, SPEC_PULSE, numbers, chosenDice).costSlots,
    }),
    direct: true,
  },
  // 012 魔女·必杀 梦醒时分：选择目标区域 → 选择 1–3 颗冥想骰移动（保留点数）
  'monv.ultimate': {
    steps: ({ state, player }) => [
      {
        kind: 'option',
        label: '选择要移动到的区域',
        options: [
          { value: 'attack', label: '攻击骰区' },
          { value: 'defense', label: '防御骰区' },
        ],
      },
      {
        kind: 'dice',
        label: '选择要移动的冥想骰（1–3 颗）',
        owner: 'self',
        areas: ['meditation'],
        min: 1,
        max: Math.min(3, state.players[player].areas.meditation.length),
        ignoreLock: true,
      },
    ],
    buildParams: ({ chosenDice, options }) => ({ to: options[0], meditationDieIds: chosenDice[1] ?? [] }),
  },
  // 014 净化（激活）：选择对方最多 2 个「1 点」能力骰（可不选）
  'chengjie.jinghua': {
    steps: () => [
      {
        kind: 'dice',
        label: '选择要变更的对方「1 点」能力骰（0–2 颗，可不选）',
        owner: 'opponent',
        areas: KINDS,
        min: 0,
        max: 2,
        filter: (d) => d.value === 1,
      },
    ],
    buildParams: ({ chosenDice }) => ({ targetDieIds: chosenDice[0] ?? [] }),
  },
  // 014 数罪并罚（激活）：同上，对象为自己
  'chengjie.shuzui': {
    steps: () => [
      {
        kind: 'dice',
        label: '选择要改点的自己「1 点」能力骰（0–2 颗，可不选）',
        owner: 'self',
        areas: KINDS,
        min: 0,
        max: 2,
        filter: (d) => d.value === 1,
        ignoreLock: true,
      },
    ],
    buildParams: ({ chosenDice }) => ({ targetDieIds: chosenDice[0] ?? [] }),
  },
  // 013 电刑（待决策）：一次选完 2 颗消耗的冥想骰（伪 key，由 UI 派发 dianxing 动作）
  '@dianxing': {
    steps: () => [
      {
        kind: 'dice',
        label: '选择消耗的 2 个冥想骰（电刑）',
        owner: 'self',
        areas: ['meditation'],
        min: 2,
        max: 2,
        allowArtifact: true,
      },
    ],
    buildParams: () => ({}),
  },
  // 013 雷暴·触发（待决策）：一次选完要移动到攻击骰区的冥想骰（1–2 颗；不想移动就用「不发动」）
  '@leibao': {
    steps: () => [
      {
        kind: 'dice',
        label: '选择要移动的己方冥想骰（1–2 颗，用于抵挡）',
        owner: 'self',
        areas: ['meditation'],
        min: 1,
        max: 2,
        ignoreLock: true,
      },
    ],
    buildParams: () => ({}),
  },
  // 016 虚臾·虚无形态（激活）：选 1 个能力骰类型 → 获得该类型 3 点骰直至能力骰总数达意志上限
  'xuyu.void': {
    steps: () => [
      {
        kind: 'option',
        label: '选择「虚无形态」要获得的能力骰类型',
        options: [
          { value: 'attack', label: '攻击' },
          { value: 'defense', label: '防御' },
          { value: 'meditation', label: '冥想' },
        ],
      },
    ],
    buildParams: ({ options }) => ({ kind: options[0] }),
  },
  // 016 虚臾·献祭（启动）：受到 4 真伤 → 二选一
  'xuyu.sacrifice': {
    steps: () => [
      {
        kind: 'option',
        label: '选择「献祭」要执行的项',
        options: [
          { value: 'dice', label: '① 获得 3 个随机点数能力骰（按其点数落区）' },
          { value: 'damage', label: '② 本回合你的攻击伤害 +2' },
        ],
      },
    ],
    buildParams: ({ options }) => ({ choice: options[0] }),
  },
  // 017 幽冥·冥界行走（启动）：消耗最多 3 个冥想骰 → 获得同等数量随机攻击骰
  'youming.mingjie': {
    steps: ({ state, player, chosenDice, numbers }) =>
      hasSword(state, player)
        ? swordCostSteps(state, player, SPEC_MINGJIE, numbers, chosenDice)
        : [
            {
              kind: 'dice',
              label: '选择消耗的冥想骰（1–3 颗）',
              owner: 'self',
              areas: ['meditation'],
              min: 1,
              max: Math.min(3, state.players[player].areas.meditation.length),
              allowArtifact: true,
            },
          ],
    buildParams: ({ state, player, chosenDice, numbers }) => ({
      costSlots: costPart(state, player, SPEC_MINGJIE, numbers, chosenDice).costSlots,
    }),
    direct: true,
  },
  // 019 尘哀·蛮王之牙（启动）：选 X（1–3）→ 选种类组合 → 每种类各 1 颗 → 选 X 项（①②可重复）
  // ①「弃置对方 1 个防御骰」由发动者**指定具体是哪颗**（页面末尾追加选骰步骤；对方没有防御骰时 ① 禁用）。
  'chenai.fang': {
    steps: ({ state, player, options }) => {
      const x = Number(options[0] ?? '1');
      const CN: Record<string, string> = { attack: '攻击', defense: '防御', meditation: '冥想' };
      const steps: SelectStep[] = [
        {
          kind: 'option',
          label: '「蛮王之牙」：消耗几个种类各不相同的能力骰（X）',
          options: [
            { value: '1', label: '1 个（选 1 项）' },
            { value: '2', label: '2 个（选 2 项）' },
            { value: '3', label: '3 个（选 3 项）' },
          ],
        },
      ];
      const sets =
        x === 2
          ? ['attack,defense', 'attack,meditation', 'defense,meditation']
          : x === 3
            ? ['attack,defense,meditation']
            : ['attack', 'defense', 'meditation'];
      steps.push({
        kind: 'option',
        label: '选择要消耗的能力骰种类组合',
        options: sets.map((s) => ({
          value: s,
          label: s.split(',').map((k) => CN[k]).join(' + '),
        })),
      });
      const chosenSet = options[1];
      const kinds = (sets.includes(chosenSet ?? '') ? chosenSet! : sets[0]).split(',') as DiceKind[];
      for (const k of kinds) {
        steps.push({
          kind: 'dice',
          label: `选择消耗的 1 颗${CN[k]}骰`,
          owner: 'self',
          areas: [k],
          min: 1,
          max: 1,
          allowArtifact: true,
        });
      }
      const opp = oppOf(player);
      const oppDefCount = state.players[opp].areas.defense.length; // ① 的最多次数；0 则 ① 禁用
      const pickBase = 2 + kinds.length;
      for (let i = 0; i < x; i++) {
        const discardsSoFar = Array.from({ length: i }, (_, j) => options[pickBase + j]).filter(
          (v) => v === 'discard',
        ).length;
        const opts = [{ value: 'gain', label: '② 获得 1 个 3 点攻击骰' }];
        if (discardsSoFar < oppDefCount) opts.unshift({ value: 'discard', label: '① 弃置对方的 1 个防御骰' });
        steps.push({
          kind: 'option',
          label: `选择第 ${i + 1} 项${oppDefCount === 0 ? '（对方没有防御骰，①不可选）' : ''}`,
          options: opts,
        });
      }
      const dCount = Array.from({ length: x }, (_, i) => options[pickBase + i]).filter(
        (v) => v === 'discard',
      ).length;
      if (dCount > 0) {
        steps.push({
          kind: 'dice',
          label: `选择要弃置的对方防御骰（${dCount} 颗）`,
          owner: 'opponent',
          areas: ['defense'],
          min: dCount,
          max: dCount,
        });
      }
      return steps;
    },
    buildParams: ({ options, chosenDice }) => {
      const x = Number(options[0] ?? '1');
      const kinds = (options[1] ?? 'attack').split(',');
      const costSlots = kinds.map((_, i) => ({ dieIds: chosenDice[2 + i] ?? [] }));
      // 选项目的步骤排在「每个种类的骰子步骤」之后 → 按 step 下标读取
      const pickBase = 2 + kinds.length;
      const picks = Array.from({ length: x }, (_, i) => options[pickBase + i] as string);
      const dCount = picks.filter((p) => p === 'discard').length;
      // 末尾追加的"选防御骰"步骤是最后一个入 chosenDice 的
      const discardIds = dCount > 0 ? (chosenDice[chosenDice.length - 1] ?? []) : [];
      return { costSlots, picks, ...(discardIds.length ? { discardIds } : {}) };
    },
  },
  // 022 死契·填弹（启动）：消耗 1–6 颗任意能力骰（≥2 颗必须顺点，UI 实时校验并禁用确认）
  'siji.tiandan': {
    steps: () => [
      {
        kind: 'dice',
        label: '选择要消耗的能力骰（1–6 颗；≥2 颗时点数必须顺点）',
        owner: 'self',
        areas: KINDS,
        min: 1,
        max: 6,
        allowArtifact: true,
        validate: (dice) => {
          if (dice.length < 2) return { ok: true, hint: `已选 ${dice.length} 颗（1 颗无顺点要求）` };
          const sorted = dice.map((d) => d.value).sort((a, b) => a - b);
          const ok = sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
          return ok
            ? { ok: true, hint: `顺点 ✓（${sorted.join('-')}）` }
            : { ok: false, hint: `不是顺点 ✗（需连续且不回绕，如 2-3-4）` };
        },
      },
    ],
    buildParams: ({ chosenDice }) => ({ dieIds: chosenDice[0] ?? [] }),
  },
  // 023 蛇蝎·畏惧（启动）：先选我方要消耗的 1 颗骰（持 010 时可用 2 颗置换 1 颗）
  'shexie.weiju': {
    steps: ({ state, player, options }) => {
      if (!hasSword(state, player)) {
        return [
          { kind: 'dice', label: '选择你要消耗的 1 颗能力骰（随后对方必须消耗 1 颗）', owner: 'self', areas: KINDS, min: 1, max: 1, allowArtifact: true },
        ];
      }
      const convert = options[0] === 'convert';
      const steps: SelectStep[] = [
        {
          kind: 'option',
          label: '「畏惧」：如何支付这 1 颗能力骰',
          options: [
            { value: 'real', label: '直接消耗 1 颗能力骰' },
            { value: 'convert', label: '用 2 颗任意能力骰置换 1 颗（点数按 5）' },
          ],
        },
      ];
      steps.push(
        convert
          ? { kind: 'dice', label: '选择用于置换的 2 颗任意能力骰', owner: 'self', areas: KINDS, min: 2, max: 2 }
          : { kind: 'dice', label: '选择你要消耗的 1 颗能力骰（随后对方必须消耗 1 颗）', owner: 'self', areas: KINDS, min: 1, max: 1, allowArtifact: true },
      );
      return steps;
    },
    buildParams: ({ chosenDice }) => {
      const ids = chosenDice[chosenDice.length - 1] ?? [];
      return ids.length === 2 ? { costSlots: [{ dieIds: ids }] } : { dieId: ids[0] };
    },
  },
  // 023 蛇蝎·共振（启动）：先选我方要重掷的 1 颗骰（之后的①/②在待决策里选）
  'shexie.gongzhen': {
    steps: () => [
      { kind: 'dice', label: '选择你要重掷的 1 颗能力骰（将按新点数落入对应区域）', owner: 'self', areas: KINDS, min: 1, max: 1, ignoreLock: true },
    ],
    buildParams: ({ chosenDice }) => ({ dieId: chosenDice[0]?.[0] }),
  },
  // 023 蛇蝎·共振（待决策）：按重掷后的区域类型二选一；选 ② 时由发起者指定双方各弃置哪 2 颗
  '@gongzhen': {
    steps: ({ state, options }) => {
      const pd = state.pending;
      const areaKind = pd && pd.kind === 'gongzhenPick' ? pd.areaKind : 'attack';
      const CN: Record<string, string> = { attack: '攻击', defense: '防御', meditation: '冥想' };
      const actor = pd ? pd.player : state.activePlayer;
      const steps: SelectStep[] = [
        {
          kind: 'option',
          label: `「共振」效果选择（重掷后落入${CN[areaKind]}骰区）`,
          options: [
            { value: 'gain', label: `① 双方各获得 2 个随机点数的${CN[areaKind]}骰` },
            { value: 'discard', label: `② 双方各弃置 2 个${CN[areaKind]}骰（由你选择）` },
          ],
        },
      ];
      if (options[0] === 'discard') {
        for (const owner of ['self', 'opponent'] as const) {
          const who = owner === 'self' ? actor : oppOf(actor);
          const n = state.players[who].areas[areaKind].length;
          const need = Math.min(2, n);
          steps.push({
            kind: 'dice',
            label: `选择要弃置的${owner === 'self' ? '你' : '对方'}的 ${need} 颗${CN[areaKind]}骰（不足则尽可能）`,
            owner,
            areas: [areaKind],
            min: need,
            max: need,
          });
        }
      }
      return steps;
    },
    buildParams: ({ options, chosenDice }) => ({
      pick: options[0] === 'discard' ? 'discard' : 'gain',
      myIds: chosenDice[1] ?? [],
      oppIds: chosenDice[2] ?? [],
    }),
  },
  // 024 狂舞·凶弹业舞（充能，强制结算）：选任意玩家 1 颗骰 → 移到该玩家另一个区域
  'kuangwu.charge': {
    steps: ({ state, player, options, chosenDice }) => {
      const sideChoice = options[0] === 'opponent' ? 'opponent' : 'self';
      const CN: Record<string, string> = { attack: '攻击', defense: '防御', meditation: '冥想' };
      const who = sideChoice === 'self' ? player : oppOf(player);
      const steps: SelectStep[] = [
        {
          kind: 'option',
          label: '选择要移动哪一方的能力骰',
          options: [
            { value: 'self', label: '我方的能力骰' },
            { value: 'opponent', label: '对方的能力骰' },
          ],
        },
        { kind: 'dice', label: '选择要移动的 1 颗能力骰', owner: sideChoice, areas: KINDS, min: 1, max: 1, ignoreLock: true },
      ];
      const pickedId = chosenDice[1]?.[0];
      const currentKind = pickedId
        ? KINDS.map((k) => state.players[who].areas[k].find((d) => d.id === pickedId)).find((d) => d !== undefined)?.kind
        : undefined;
      if (currentKind) {
        steps.push({
          kind: 'option',
          label: '选择要移动到该玩家的哪个区域（不能与原区域相同）',
          options: KINDS.filter((k) => k !== currentKind).map((k) => ({ value: k, label: `${CN[k]}骰区` })),
        });
      }
      return steps;
    },
    buildParams: ({ options, chosenDice }) => ({
      owner: options[0] === 'opponent' ? 'opponent' : 'self',
      dieId: chosenDice[1]?.[0],
      toKind: options[2],
    }),
  },
  // 024 狂舞·凶弹业舞（必杀）：先选方向，再为（按该方向排序的）各区域各选 ≤3 颗；挑战模式只 5 个区域
  'kuangwu.ultimate': {
    steps: ({ state, player, options }) => {
      const CN: Record<string, string> = { attack: '攻击', defense: '防御', meditation: '冥想' };
      const dir = options[0] === 'ccw' ? 'ccw' : 'cw';
      const challenge = state.mode === 'challenge'; // 昔日传奇没有冥想骰区 → 跳过"对方冥想"
      const base: { owner: 'self' | 'opponent'; kind: DiceKind }[] = [
        { owner: 'self', kind: 'meditation' },
        { owner: 'self', kind: 'attack' },
        { owner: 'self', kind: 'defense' },
        ...(challenge
          ? []
          : [{ owner: 'opponent' as const, kind: 'meditation' as DiceKind }]),
        { owner: 'opponent', kind: 'attack' },
        { owner: 'opponent', kind: 'defense' },
      ];
      const slots = dir === 'cw' ? base : [...base].reverse();
      const steps: SelectStep[] = [
        {
          kind: 'option',
          label: '选择旋转方向',
          options: [
            { value: 'cw', label: '顺时针' },
            { value: 'ccw', label: '逆时针' },
          ],
        },
      ];
      for (const s of slots) {
        const who = s.owner === 'self' ? player : oppOf(player);
        const n = state.players[who].areas[s.kind].length;
        const need = Math.min(3, n);
        steps.push({
          kind: 'dice',
          label: `选择${s.owner === 'self' ? '我方' : '对方'}${CN[s.kind]}骰区要移动的骰（${need} 颗${n === 0 ? '，该区域没有骰' : ''}）`,
          owner: s.owner,
          areas: [s.kind],
          min: need,
          max: need,
          ignoreLock: true,
        });
      }
      return steps;
    },
    buildParams: ({ state, chosenDice, options }) => ({
      direction: options[0] === 'ccw' ? 'ccw' : 'cw',
      groups: chosenDice.slice(1, state.mode === 'challenge' ? 6 : 7).map((g) => [...g]),
    }),
  },
  // 026 哀歌·威压（待决策）：先选变哪一方 → 选 1 颗能力骰点数改为固定值（保留原区域）
  '@weiyaPick': {
    steps: ({ state, options }) => {
      const pd = state.pending;
      const value = pd && pd.kind === 'weiyaPick' ? pd.value : 4;
      const owner: 'self' | 'opponent' = options[0] === 'opponent' ? 'opponent' : 'self';
      return [
        {
          kind: 'option',
          label: '选择要变更哪一方的能力骰',
          options: [
            { value: 'self', label: '我方的能力骰' },
            { value: 'opponent', label: '对方的能力骰' },
          ],
        },
        { kind: 'dice', label: `选择要变为 ${value} 点的 1 颗能力骰（保留原区域）`, owner, areas: KINDS, min: 1, max: 1, ignoreLock: true },
      ];
    },
    buildParams: () => ({}),
  },
  // 026 哀歌·陷阵（待决策，强制、无「不发动」）：生命最少方选持有者的 1 颗能力骰弃置
  '@xianzhenPick': {
    steps: ({ state }) => {
      const pd = state.pending;
      const owner: PlayerId = pd && pd.kind === 'xianzhenPick' ? pd.owner : state.activePlayer;
      const actor: PlayerId = pd && pd.kind === 'xianzhenPick' ? pd.player : state.activePlayer;
      return [
        {
          kind: 'dice',
          label: '选择要弃置的 1 颗能力骰',
          owner: owner === actor ? 'self' : 'opponent',
          areas: KINDS,
          min: 1,
          max: 1,
        },
      ];
    },
    buildParams: () => ({}),
  },
  // 025 屠虎·横贯·触发（待决策）：选对方 1 颗点数严格小于该攻击的能力骰弃置（或不发动）
  '@hengguan': {
    steps: ({ state }) => {
      const pd = state.pending;
      const value = pd && pd.kind === 'hengguan' ? pd.value : 1;
      return [
        {
          kind: 'dice',
          label: `选择要弃置的对方 1 颗点数小于 ${value} 的能力骰`,
          owner: 'opponent',
          areas: KINDS,
          min: 1,
          max: 1,
          filter: (d) => d.value < value,
        },
      ];
    },
    buildParams: () => ({}),
  },
  // 017 幽冥·帷幕（待决策）：选对方 1 个能力骰弃置
  '@weimu': {
    steps: () => [
      {
        kind: 'dice',
        label: '选择要弃置的对方能力骰（1 颗）',
        owner: 'opponent',
        areas: KINDS,
        min: 1,
        max: 1,
      },
    ],
    buildParams: () => ({}),
  },
  // L06 传奇面板·圆舞（待决策）：选 1 颗能力骰 → 选目标区域（**排除该骰所在的区**，只列另外两个）
  '@yuanwu': {
    steps: ({ state, player, chosenDice }) => {
      const first = chosenDice[0]?.[0];
      const from = first ? KINDS.find((k) => state.players[player].areas[k].some((d) => d.id === first)) : undefined;
      const ALL: { value: string; label: string }[] = [
        { value: 'attack', label: '攻击骰区' },
        { value: 'defense', label: '防御骰区' },
        { value: 'meditation', label: '冥想骰区' },
      ];
      return [
        { kind: 'dice' as const, label: '选择要移动的 1 个能力骰', owner: 'self' as const, areas: KINDS, min: 1, max: 1, ignoreLock: true },
        {
          kind: 'option' as const,
          label: '移动到哪个区域',
          // 圆舞＝"移动到**另 1 个**区域"→ 第二步**排除**所选骰当前所在区，否则"移到原区"会被引擎判非法
          options: from ? ALL.filter((o) => o.value !== from) : ALL,
        },
      ];
    },
    buildParams: () => ({}),
  },
  // L06 传奇面板·无光领域（启动）：选择 ①攻击点数+1（最大6）/ ②-1（最小1）
  'xiu.wuguanglingyu': {
    steps: () => [
      {
        kind: 'option' as const,
        label: '选择无光领域的效果',
        options: [
          { value: 'up', label: '攻击点数视为上升 1（最大 6）' },
          { value: 'down', label: '攻击点数视为下降 1（最小 1）' },
        ],
      },
    ],
    buildParams: ({ options }) => ({ choice: options[0] ?? 'up' }),
  },
  // L07 传奇面板·不屈咆哮（必杀）：弃置对方数量＝你的「决意」当前计数的能力骰（跨类型一次选；不足则全弃）
  'nisa.buqupaoxiao': {
    steps: ({ state, player }) => {
      const p = state.players[player];
      const o = state.players[oppOf(player)];
      const jy = p.artifacts.find((a) => a.skills.some((s) => s.key === 'jueyi.wildfire'));
      const n = jy?.count ?? 0;
      const total = KINDS.reduce((sum, k) => sum + o.areas[k].length, 0);
      const need = Math.min(n, total);
      if (need <= 0) return []; // 对方无能力骰 → 无需选骰，直接结算（弃 0 颗）
      return [
        {
          kind: 'dice' as const,
          label: `选择弃置对方 ${need} 颗能力骰（跨类型）`,
          owner: 'opponent' as const,
          areas: KINDS,
          min: need,
          max: need,
        },
      ];
    },
    buildParams: ({ chosenDice }) => ({ dieIds: chosenDice[0] ?? [] }),
  },
  // L05 传奇面板·无法饶恕（待决策）：选对方 1 个"点数＝该攻击点数"的防御骰弃置
  '@wufaraoshu': {
    steps: ({ state }) => {
      const pd = state.pending;
      const value = pd && pd.kind === 'wufaraoshu' ? pd.value : 0;
      return [
        {
          kind: 'dice' as const,
          label: `选择要弃置的对方 ${value} 点防御骰（1 颗）`,
          owner: 'opponent' as const,
          areas: ['defense'] as DiceKind[],
          min: 1,
          max: 1,
          filter: (d: { value: number }) => d.value === value,
        },
      ];
    },
    buildParams: () => ({}),
  },
  // L07 传奇面板·始祖兽魂（待决策）：可额外消耗 1 个冥想骰（改为把「兽魂」计数重设为 3）
  '@shizushouhun': {
    steps: () => [
      {
        kind: 'dice' as const,
        label: '选择要额外消耗的 1 个冥想骰',
        owner: 'self' as const,
        areas: ['meditation'] as DiceKind[],
        min: 1,
        max: 1,
        allowArtifact: true,
      },
    ],
    buildParams: () => ({}),
  },
  // L10 传奇面板·涤罪大剑术（待决策）：选对方 2 颗**种类不相同**的能力骰弃置
  '@dizuidaijianshu': {
    steps: () => [
      {
        kind: 'dice' as const,
        label: '选择要弃置的对方 2 颗能力骰（种类必须不相同）',
        owner: 'opponent' as const,
        areas: KINDS,
        min: 2,
        max: 2,
        validate: (dice: Die[]) => {
          if (dice.length < 2) return { ok: true, hint: `已选 ${dice.length} 颗（需 2 颗且种类不相同）` };
          const ok = new Set(dice.map((d) => d.kind)).size === dice.length;
          return ok ? { ok: true, hint: '种类不相同 ✓' } : { ok: false, hint: '2 颗骰的种类必须不相同 ✗' };
        },
      },
    ],
    buildParams: () => ({}),
  },
  // L01 传奇面板·雨落狂流（待决策 ①）：选对方 1 个能力骰弃置
  '@kongYuluo': {
    steps: () => [
      {
        kind: 'dice',
        label: '选择要弃置的对方能力骰（1 颗）',
        owner: 'opponent',
        areas: KINDS,
        min: 1,
        max: 1,
      },
    ],
    buildParams: () => ({}),
  },
  // L01 传奇面板·雨落狂流（待决策 ②）：选择随机能力骰的落区
  '@kongYuluoGain': {
    steps: () => [
      {
        kind: 'option',
        label: '选择落区',
        options: [
          { value: 'attack', label: '攻击骰区' },
          { value: 'defense', label: '防御骰区' },
          { value: 'meditation', label: '冥想骰区' },
        ],
      },
    ],
    buildParams: ({ options }) => ({ kind: options[0] }),
  },
  // L04 传奇面板·我将在下个梦境与你再度相逢（必杀）：先选"先手玩家"，再重开一局
  'tata.mengjing': {
    steps: () => [
      {
        kind: 'option',
        label: '选择先手玩家',
        options: [
          { value: 'A', label: '玩家A' },
          { value: 'B', label: '玩家B' },
        ],
      },
    ],
    buildParams: ({ options }) => ({ first: options[0] ?? 'A' }),
  },
  // 018 至黑·漆黑绽放（待决策）：可重掷最多 X 颗能力骰（含刚获得的骰）
  '@zhihaiReroll': {
    steps: ({ state }) => {
      const pd = state.pending;
      const x = pd && pd.kind === 'zhihaiReroll' ? pd.x : 0;
      return [
        {
          kind: 'dice' as const,
          label: `选择要重掷的能力骰（0–${x} 颗；按新点数落区）`,
          owner: 'self' as const,
          areas: KINDS,
          min: 0,
          max: x,
        },
      ];
    },
    buildParams: () => ({}),
  },
  // 尘起行动的代价：玩家自选 1 颗冥想骰（伪 key，由 UI 特殊处理为 dustRise 动作）
  '@dustRise': {
    steps: () => [
      { kind: 'dice', label: '选择 1 颗冥想骰作为尘起代价', owner: 'self', areas: ['meditation'], min: 1, max: 1, allowArtifact: true },
    ],
    buildParams: () => ({}),
  },
  // 029 真言·神圣干涉（激活）：选 1 个统一点数 → 选最多 3 颗能力骰全部改为该点数（FAQ 29.2.1）
  'zhenyan.ganshe': {
    steps: ({ state, player, options }) => {
      const v = Number(options[0] ?? '');
      const steps: SelectStep[] = [
        {
          kind: 'option',
          label: '「神圣干涉」：选择要把能力骰统一改为的点数',
          options: [1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `${n} 点` })),
        },
      ];
      if (v >= 1 && v <= 6) {
        const total = KINDS.reduce((n, k) => n + state.players[player].areas[k].length, 0);
        steps.push({
          kind: 'dice',
          label: `选择要统一改为 ${v} 点的能力骰（0–3 颗）`,
          owner: 'self',
          areas: KINDS,
          min: 0,
          max: Math.min(3, total),
        });
      }
      return steps;
    },
    buildParams: ({ options, chosenDice }) => ({
      value: Number(options[0] ?? '6'),
      dieIds: chosenDice[1] ?? [],
    }),
  },
  // 030 救赎·寰宇飞升（必杀）：消耗 4 个冥想骰
  'jiushu.huanyu.ultimate': {
    steps: ({ state, player, chosenDice, numbers }) =>
      hasSword(state, player)
        ? swordCostSteps(state, player, SPEC_HUANYU, numbers, chosenDice)
        : [{ kind: 'dice', label: '选择消耗的 4 个冥想骰', owner: 'self', areas: ['meditation'], min: 4, max: 4, allowArtifact: true }],
    buildParams: ({ state, player, chosenDice, numbers }) => ({
      costSlots: costPart(state, player, SPEC_HUANYU, numbers, chosenDice).costSlots,
    }),
    direct: true,
  },
  // 031 恶兆·清算（激活）：由发动者弃置对方 X 颗（X=计数；不足则弃光）
  'ezhao.qingsuan': {
    steps: ({ state, player }) => {
      const oppId = oppOf(player);
      const opp = state.players[oppId];
      const total = KINDS.reduce((n, k) => n + opp.areas[k].length, 0);
      const card = state.players[player].artifacts.find((a) => a.skills.some((s) => s.key === 'ezhao.qingsuan'));
      const X = card?.count ?? 0;
      const d = Math.min(X, total);
      return [
        {
          kind: 'dice',
          label: `选择要弃置的对方能力骰（${d} 颗；X=计数 ${X}，不足则弃光并每差 1 颗 3 真伤）`,
          owner: 'opponent',
          areas: KINDS,
          min: d,
          max: d,
        },
      ];
    },
    buildParams: ({ chosenDice }) => ({ dieIds: chosenDice[0] ?? [] }),
  },
  // 032 梦魇·恶意（启动）：消耗 1 个攻击骰 → 获得 2 随机冥想骰（真实之剑激活时可置换）
  'mengyan.eyi': {
    steps: ({ state, player, chosenDice, numbers }) =>
      hasSword(state, player)
        ? swordCostSteps(state, player, SPEC_EYI, numbers, chosenDice)
        : [{ kind: 'dice', label: '选择消耗的 1 个攻击骰', owner: 'self', areas: ['attack'], min: 1, max: 1, allowArtifact: true }],
    buildParams: ({ state, player, chosenDice, numbers }) => ({
      costSlots: costPart(state, player, SPEC_EYI, numbers, chosenDice).costSlots,
    }),
  },
  // 032 梦魇·低语（待决策）：宣称 1 个能力骰类型
  '@kuyu': {
    steps: () => [
      {
        kind: 'option',
        label: '「低语」：宣称 1 个能力骰类型（获得 1 随机骰并移入该区；不符分布则尘落 +1）',
        options: [
          { value: 'attack', label: '攻击骰区' },
          { value: 'defense', label: '防御骰区' },
          { value: 'meditation', label: '冥想骰区' },
        ],
      },
    ],
    buildParams: ({ options }) => ({ area: options[0] ?? 'attack' }),
  },
  // 033 凋零·死亡亦逝（待决策）：① 全相同 / ② 全不同 → 弃能力骰
  //   · **代决传奇**（挑战模式；`player:'A'`、`owner:'B'`）：只能弃**最少颗数** →
  //     选"保留哪个点数"后**其余自动弃**（没有选骰步骤；只列"数量并列最多"的点数）
  //   · **自己弃**（标准/轮选/构筑/挑战者自己）：**旧逻辑**＝骰片选择器（可弃 0 颗、也可故意多弃），
  //     校验"剩余全相同/全不同"
  '@tiaolingPick': {
    steps: ({ state, options }) => {
      const pd = state.pending;
      const ownerId: PlayerId = pd && pd.kind === 'tiaolingPick' ? pd.owner ?? pd.player : state.activePlayer;
      const decider: PlayerId = pd && pd.kind === 'tiaolingPick' ? pd.player : state.activePlayer;
      const p = state.players[ownerId];
      const all = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation];
      const pick = options[0] === 'same' ? 'same' : 'diff';
      const legendDuty = state.mode === 'challenge' && ownerId !== decider; // 挑战者替传奇代决
      const steps: SelectStep[] = [
        {
          kind: 'option',
          label: '「死亡亦逝」：选择执行哪一项',
          options: [
            { value: 'same', label: '① 弃至剩余全部点数相同' },
            { value: 'diff', label: '② 弃至剩余全部点数不同' },
          ],
        },
      ];
      if (legendDuty) {
        if (pick === 'same') {
          // 代决：**保留的点数可以任意选**（用户定 2026-10-16）；该点数上的骰子必须**全部保留**（不能多弃）
          const vals = [...new Set(all.map((d) => d.value))].sort((a, b) => a - b);
          steps.push({
            kind: 'option',
            label: '「死亡亦逝」：选择要【保留】的点数（其余全部弃置）',
            options: vals.map((v) => ({ value: String(v), label: `保留 ${v} 点` })),
          });
        }
        return steps;
      }
      // 自己弃：旧逻辑（骰片选择器，可 0 颗、可多弃）
      steps.push({
        kind: 'dice',
        label: '选择要弃置的能力骰（可弃 0 颗，也可多弃）',
        owner: ownerId === decider ? 'self' : 'opponent',
        areas: KINDS,
        min: 0,
        max: all.length,
        validate: (picked) => {
          const discard = new Set(picked.map((d) => d.id));
          const remaining = all.filter((d) => !discard.has(d.id)).map((d) => d.value);
          const ok = pick === 'same' ? new Set(remaining).size <= 1 : new Set(remaining).size === remaining.length;
          if (!ok) {
            return { ok: false, hint: pick === 'same' ? '需弃到剩余全部点数相同' : '需弃到剩余全部点数不同' };
          }
          return { ok: true, hint: pick === 'same' ? '剩余已全部相同 ✓' : '剩余已全部不同 ✓' };
        },
      });
      return steps;
    },
    buildParams: ({ state, options, chosenDice }) => {
      const pd = state.pending;
      const ownerId: PlayerId = pd && pd.kind === 'tiaolingPick' ? pd.owner ?? pd.player : state.activePlayer;
      const decider: PlayerId = pd && pd.kind === 'tiaolingPick' ? pd.player : state.activePlayer;
      const legendDuty = state.mode === 'challenge' && ownerId !== decider;
      const pick = options[0] === 'same' ? 'same' : 'diff';
      if (!legendDuty) {
        // 自己弃：骰片选择器选出的就是"要弃的骰"
        return { pick, dieIds: chosenDice[1] ?? [] };
      }
      const p = state.players[ownerId];
      const all = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation];
      if (pick === 'same') {
        const keep = Number(options[1]);
        return { pick: 'same' as const, dieIds: all.filter((d) => d.value !== keep).map((d) => d.id) };
      }
      // 全不同：每种点数保留 1 颗（多余的自动弃置）
      const seen = new Set<number>();
      const dieIds: string[] = [];
      for (const d of all) {
        if (seen.has(d.value)) dieIds.push(d.id);
        else seen.add(d.value);
      }
      return { pick: 'diff' as const, dieIds };
    },
  },
  // 035 千劫·超度（启动）：消耗 2 个同点数冥想骰 → 5 真伤 → 选任意玩家一区重掷
  // 持「真实之剑」：① 选 2 颗【同点】冥想骰（0–2 颗）→（不足）② 选置换源 → 选区域（直发，不再确认）
  'qianjie.chaodu': {
    steps: ({ state, player, chosenDice }) => {
      const targetSteps: SelectStep[] = [
        {
          kind: 'option',
          label: '「超度」：选择要重掷哪个玩家的区域',
          options: [
            { value: 'self', label: '我方的区域' },
            { value: 'opponent', label: '对方的区域' },
          ],
        },
        {
          kind: 'option',
          label: '「超度」：选择要重掷的区域',
          options: [
            { value: 'attack', label: '攻击骰区' },
            { value: 'defense', label: '防御骰区' },
            { value: 'meditation', label: '冥想骰区' },
          ],
        },
      ];
      if (!hasSword(state, player)) {
        return [
          {
            kind: 'dice' as const,
            label: '选择消耗的 2 颗【点数相同】的冥想骰',
            owner: 'self' as const,
            areas: ['meditation' as const],
            min: 2,
            max: 2,
            allowArtifact: true,
            validate: (dice: { value: number }[]) =>
              dice.length === 2 && dice[0].value === dice[1].value
                ? { ok: true, hint: `点数相同 ✓（${dice[0].value} 点）` }
                : { ok: false, hint: dice.length === 2 ? '两颗点数必须相同' : '请选择 2 颗冥想骰' },
          },
          ...targetSteps,
        ];
      }
      // 持真实之剑：① 选 2 颗同点冥想骰（0–2 颗；实时校验）→ ② 不足时选置换源
      const real = chosenDice[0] ?? [];
      const costSteps: SelectStep[] = [
        {
          kind: 'dice',
          label: '选择消耗的 2 颗【点数相同】的冥想骰（0–2 颗；不够用「真实之剑」补）',
          owner: 'self',
          areas: ['meditation'],
          min: 0,
          max: 2,
          allowArtifact: true,
          validate: (dice: { value: number }[]) => {
            if (dice.length === 2)
              return dice[0].value === dice[1].value
                ? { ok: true, hint: `点数相同 ✓（${dice[0].value} 点）` }
                : { ok: false, hint: '两颗点数必须相同' };
            if (dice.length === 1)
              return dice[0].value === 5
                ? { ok: true, hint: '1 颗真骰 + 1 组置换 → 须为 5 点 ✓' }
                : { ok: false, hint: '只选 1 颗真骰时必须是 5 点（置换出的骰恒为 5）' };
            return { ok: true, hint: '不选真骰 → 两组置换（视为 5、5）' };
          },
        },
      ];
      if (real.length < 2) {
        const needDice = (2 - real.length) * 2;
        costSteps.push({
          kind: 'dice',
          label: `再选恰好 ${needDice} 颗任意骰（每 2 颗＝1 格，视为 5）`,
          owner: 'self',
          areas: KINDS,
          min: needDice,
          max: needDice,
          filter: (d) => !real.includes(d.id),
          allowArtifact: true,
          validate: (ds: { value: number }[]) => {
            const vals = real
              .map((id) => ownDieValue(state, player, id))
              .concat(Array(Math.floor(ds.length / 2)).fill(5))
              .filter((v): v is number => v !== undefined);
            return vals.length === 2 && vals[0] === vals[1]
              ? { ok: true, hint: `两格均为 ${vals[0]} 点 ✓` }
              : { ok: false, hint: `两格点数必须相同（当前 ${vals.join(' 与 ')}）` };
          },
        });
      }
      return [...costSteps, ...targetSteps];
    },
    buildParams: ({ state, player, chosenDice, options }) => ({
      costSlots: hasSword(state, player)
        ? [...realSlots(chosenDice[0]), ...chunkPairs(chosenDice[1] ?? []).map((pair) => ({ dieIds: pair }))]
        : realSlots(chosenDice[0]),
      targetOwner: options.includes('opponent') ? 'opponent' : 'self',
      targetKind: (['attack', 'defense', 'meditation'] as DiceKind[]).find((k) => options.includes(k)) ?? 'attack',
    }),
    // 持剑时最后一步直发（与"真实之剑多颗代价"一致）；未持剑仍走确认条
    direct: true,
  },
  // 结束阶段：能力骰总数超出「意志」上限 → 由当前回合玩家自选弃置哪 N 颗（非强制指定）
  '@endDiscard': {
    steps: ({ state, player }) => {
      const pd = state.pending;
      const who = pd && pd.kind === 'endDiscard' ? pd.player : player;
      const p = state.players[who];
      const excess = Math.max(0, totalDice(state, who) - effectiveWill(p));
      return [
        {
          kind: 'dice',
          label: `「结束阶段」：弃置 ${excess} 颗能力骰（超出意志上限，请自行选择）`,
          owner: 'self',
          areas: KINDS,
          min: excess,
          max: excess,
        },
      ];
    },
    buildParams: () => ({}),
  },
  // 035 千劫·万丈明光（待决策）：主要阶段开始弃 2 个能力骰
  '@wanzhangDiscard': {
    steps: ({ state }) => {
      const pd = state.pending;
      const player: PlayerId = pd && pd.kind === 'wanzhangDiscard' ? pd.player : state.activePlayer;
      const p = state.players[player];
      const total = KINDS.reduce((n, k) => n + p.areas[k].length, 0);
      const need = Math.min(2, total);
      return [
        {
          kind: 'dice',
          label: `「万丈明光」：选择要弃置的 ${need} 个能力骰`,
          owner: 'self',
          areas: KINDS,
          min: need,
          max: need,
        },
      ];
    },
    buildParams: () => ({}),
  },
  // 034 金刚·激活（破障 / 不动菩提同效）：选 3 个互不相同的点数存放到神器上
  'jingang.pozhang': jingangLoadSelection,
  'jingang.puti': jingangLoadSelection,
  // A03 金刚·异相激活（修罗的破障 / 修罗的菩提同效）：2 个任意点数（可相同）存放到神器上
  'jingang.alt.pozhang': jingang2LoadSelection,
  'jingang.alt.puti': jingang2LoadSelection,
  // 036 无相·万象俱灭（充能，必执行）：弃任意玩家 1 个能力骰 → 该玩家回 3 血
  'wuxiang.charge': {
    steps: ({ options }) => {
      const owner = options[0] === 'opponent' ? 'opponent' : 'self';
      return [
        {
          kind: 'option',
          label: '「万象俱灭」充能：选择弃置哪一方的能力骰',
          options: [
            { value: 'self', label: '我方' },
            { value: 'opponent', label: '对方' },
          ],
        },
        { kind: 'dice', label: '选择要弃置的 1 颗能力骰（该玩家随后回复 3 点生命）', owner, areas: KINDS, min: 1, max: 1 },
      ];
    },
    buildParams: ({ options, chosenDice }) => ({
      owner: options[0] === 'opponent' ? 'opponent' : 'self',
      dieId: chosenDice[1]?.[0],
    }),
  },
  // 036 无相·万象俱灭（必杀）：为 1–6 点各选保留 1 个（跨双方）
  'wuxiang.wanxiang.ultimate': {
    steps: ({ state, player }) => {
      const CN: Record<DiceKind, string> = { attack: '攻', defense: '防', meditation: '冥' };
      const owners: [string, PlayerId][] = [
        ['self', player],
        ['opponent', player === 'A' ? 'B' : 'A'],
      ];
      const steps: SelectStep[] = [];
      for (let v = 1; v <= 6; v++) {
        const opts: { value: string; label: string }[] = [];
        for (const [tag, who] of owners) {
          for (const k of KINDS) {
            for (const d of state.players[who].areas[k]) {
              if (d.value === v) {
                opts.push({ value: `${tag}:${d.id}`, label: `${tag === 'self' ? '我方' : '对方'}${CN[k]}${v}` });
              }
            }
          }
        }
        steps.push({ kind: 'option', label: `「万象俱灭」：选择保留的 ${v} 点能力骰`, options: opts });
      }
      return steps;
    },
    buildParams: ({ options }) => ({ keepIds: options.map((o) => (o ?? '').split(':')[1]) }),
  },
  // 「真实之剑」(010) 置换支付入口（伪 key，由 UI 派发对应动作）：
  // 给 009 高塔铁幕·触发 / 011 灵能屏障·触发 / 023 畏惧·对方 这三处「消耗 1 颗」的待决策提供「2 颗顶 1」。
  '@guwangCancelConvert': {
    steps: () => [
      { kind: 'dice', label: '「真实之剑」置换：选择用于代替的 2 颗任意能力骰', owner: 'self', areas: KINDS, min: 2, max: 2 },
    ],
    buildParams: () => ({}),
  },
  '@dunwuHalveConvert': {
    steps: () => [
      { kind: 'dice', label: '「真实之剑」置换：选择用于代替的 2 颗任意能力骰', owner: 'self', areas: KINDS, min: 2, max: 2 },
    ],
    buildParams: () => ({}),
  },
  '@weijuPayConvert': {
    steps: () => [
      { kind: 'dice', label: '「真实之剑」置换：选择用于代替的 2 颗任意能力骰', owner: 'self', areas: KINDS, min: 2, max: 2 },
    ],
    buildParams: () => ({}),
  },
};
