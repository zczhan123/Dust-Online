import type { DiceKind, GameState, PlayerId } from '../core/model/types';
import { hasActiveSkill } from '../core/engine/skill-state';

export type SelectStep =
  | { kind: 'dice'; label: string; owner: 'self' | 'opponent'; areas: DiceKind[]; min: number; max: number; filter?: (d: { id: string; value: number; kind: DiceKind }) => boolean }
  | { kind: 'option'; label: string; options: { value: string; label: string }[] }
  | { kind: 'number'; label: string; min: number; max: number; fmt?: (n: number) => string }
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
}

const KINDS: DiceKind[] = ['attack', 'defense', 'meditation'];
const oppOf = (p: PlayerId): PlayerId => (p === 'A' ? 'B' : 'A');
/** 每颗选中的骰作为一个“真骰”骰位（未启用置换时的回退映射） */
const realSlots = (ids: string[] | undefined): { dieIds: string[] }[] => (ids ?? []).map((id) => ({ dieIds: [id] }));
/** 已填骰位（长度 1=真骰，2=置换）→ 引擎 costSlots */
const slotsParam = (slots: string[][]): { dieIds: string[] }[] => slots.map((ids) => ({ dieIds: [...ids] }));
/** 该玩家是否已激活 010「真实之剑」：激活后技能代价可用 2 颗顶 1 颗置换 */
const hasSword = (state: GameState, player: PlayerId): boolean =>
  hasActiveSkill(state.players[player], 'shenhong.sword');
const SLOTS_LABEL = '支付代价（可用「真实之剑」置换能力骰）';
const repeatKind = (kind: DiceKind, n: number): DiceKind[] => Array.from({ length: n }, () => kind);

const KIND_CN: Record<DiceKind, string> = { attack: '攻击', defense: '防御', meditation: '冥想' };
const kindCount = (state: GameState, player: PlayerId, kind: DiceKind): number =>
  state.players[player].areas[kind].length;
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
  const bound = Math.floor((totalDice(state, player) + kindCount(state, player, spec.kind)) / 2);
  return Math.max(0, Math.min(spec.maxSlots, bound));
}

/** 给定骰位数 N，可行的置换数区间 [minM, maxM]（连续） */
function mRangeFor(state: GameState, player: PlayerId, spec: CostSpec, N: number): [number, number] {
  const minM = Math.max(0, N - kindCount(state, player, spec.kind));
  const maxM = Math.min(N, totalDice(state, player) - N);
  return [minM, Math.max(minM, maxM)];
}

/** 读取玩家已选的置换数 M（可变数量技能：numbers[1]；固定数量：numbers[0]） */
const chosenM = (spec: CostSpec, numbers: number[]): number =>
  spec.variable ? (numbers[1] ?? 0) : (numbers[0] ?? 0);

/** 真实之剑激活时，「支付 N 个骰位」的统一向导步骤（①数量 ②置换数 ③真实骰 ④任意骰） */
function swordCostSteps(
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
  const M = chosenM(spec, numbers);
  const real = chosenDice[0] ?? [];
  const conv = M > 0 ? chosenDice[1] ?? [] : [];
  return {
    costSlots: [
      ...real.map((id) => ({ dieIds: [id] })),
      ...chunkPairs(conv).map((pair) => ({ dieIds: pair })),
    ],
    groups: M > 0 ? 2 : 1,
  };
}

const SPEC_TENGWAN: CostSpec = { skill: '龙腾万丈', kind: 'meditation', maxSlots: 3, variable: false };
const SPEC_QIANXING: CostSpec = { skill: '潜行', kind: 'attack', maxSlots: 2, variable: false };
const SPEC_FIST: CostSpec = { skill: '王家之拳', kind: 'meditation', maxSlots: 2, variable: false };
const SPEC_BARRIER: CostSpec = { skill: '灵能屏障', kind: 'defense', maxSlots: 3, variable: true };
const SPEC_PULSE: CostSpec = { skill: '灵能脉冲', kind: 'attack', maxSlots: 3, variable: true };
const SPEC_WANSHA: CostSpec = { skill: '零时枭首', kind: 'attack', maxSlots: 1, variable: false };
const SPEC_MINGJIE: CostSpec = { skill: '冥界行走', kind: 'meditation', maxSlots: 3, variable: true };

function ownDieValue(state: GameState, player: PlayerId, id: string | undefined): number | undefined {
  if (!id) return undefined;
  for (const k of KINDS) {
    const d = state.players[player].areas[k].find((x) => x.id === id);
    if (d) return d.value;
  }
  return undefined;
}

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
        { kind: 'dice', label: '选择消耗的冥想骰（1–3 颗）', owner: 'self', areas: ['meditation'], min: 1, max: Math.min(3, selfMed) },
        { kind: 'dice', label: `选择弃置对方的防御骰（${need} 颗）`, owner: 'opponent', areas: ['defense'], min: need, max: need },
      ];
    },
    buildParams: ({ chosenDice, slots }) => ({
      costSlots: slots.length ? slotsParam(slots) : realSlots(chosenDice[0]),
      opponentDefenseDieIds: slots.length ? (chosenDice[0] ?? []) : (chosenDice[1] ?? []),
    }),
  },
  'youlong.tengwan': {
    steps: ({ state, player, chosenDice, numbers }) =>
      hasSword(state, player)
        ? swordCostSteps(state, player, SPEC_TENGWAN, numbers, chosenDice)
        : [{ kind: 'dice', label: '选择消耗的冥想骰（恰好 3 颗）', owner: 'self', areas: ['meditation'], min: 3, max: 3 }],
    buildParams: ({ state, player, chosenDice, numbers }) => ({
      costSlots: costPart(state, player, SPEC_TENGWAN, numbers, chosenDice).costSlots,
    }),
  },
  'yingle.qianxing': {
    steps: ({ state, player, chosenDice, numbers }) =>
      hasSword(state, player)
        ? swordCostSteps(state, player, SPEC_QIANXING, numbers, chosenDice)
        : [{ kind: 'dice', label: '选择消耗的攻击骰（恰好 2 颗）', owner: 'self', areas: ['attack'], min: 2, max: 2 }],
    buildParams: ({ state, player, chosenDice, numbers }) => ({
      costSlots: costPart(state, player, SPEC_QIANXING, numbers, chosenDice).costSlots,
    }),
  },
  'buxiang.cuilian': {
    steps: ({ state, player }) =>
      hasSword(state, player)
        ? [{ kind: 'slots', label: SLOTS_LABEL, kinds: repeatKind('attack', 1) }]
        : [{ kind: 'dice', label: '选择消耗的攻击骰（恰好 1 颗）', owner: 'self', areas: ['attack'], min: 1, max: 1 }],
    buildParams: ({ chosenDice, slots }) => ({
      costSlots: slots.length ? slotsParam(slots) : realSlots(chosenDice[0]),
    }),
  },
  'yingle.yingxi': {
    steps: ({ state, player, chosenDice }) => {
      const first = chosenDice[0]?.[0];
      const steps: SelectStep[] = [
        { kind: 'dice', label: '选择要降低点数的能力骰（恰好 1 颗，点数≥2）', owner: 'self', areas: ['attack', 'defense', 'meditation'], min: 1, max: 1, filter: (d) => d.value >= 2 },
      ];
      if (first) {
        const die = KINDS.flatMap((k) => state.players[player].areas[k]).find((d) => d.id === first);
        const max = Math.max(1, (die?.value ?? 2) - 1);
        steps.push({ kind: 'number', label: `选择 X（1 ~ ${max}，降完不低于 1 点）`, min: 1, max });
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
        { kind: 'dice', label: '选择消耗的攻击骰（恰好 1 颗）', owner: 'self', areas: ['attack'], min: 1, max: 1 },
        { kind: 'dice', label: `选择弃置对方的防御骰（${need} 颗）`, owner: 'opponent', areas: ['defense'], min: need, max: need },
      ];
    },
    buildParams: ({ state, player, chosenDice, numbers }) => {
      const { costSlots, groups } = costPart(state, player, SPEC_WANSHA, numbers, chosenDice);
      return { costSlots, opponentDefenseDieIds: chosenDice[groups] ?? [] };
    },
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
  // 007 战争横扫：各消耗 1 攻/防/冥（显式）；各弃对方 0–1 攻/防/冥（显式）
  'zhuzai.sweep': {
    steps: ({ state, player }) => {
      const oppDice: SelectStep[] = [
        { kind: 'dice', label: '选择弃置对方的攻击骰（0–1 颗，不足可跳过）', owner: 'opponent', areas: ['attack'], min: 0, max: 1 },
        { kind: 'dice', label: '选择弃置对方的防御骰（0–1 颗，不足可跳过）', owner: 'opponent', areas: ['defense'], min: 0, max: 1 },
        { kind: 'dice', label: '选择弃置对方的冥想骰（0–1 颗，不足可跳过）', owner: 'opponent', areas: ['meditation'], min: 0, max: 1 },
      ];
      if (hasSword(state, player)) {
        return [{ kind: 'slots', label: SLOTS_LABEL, kinds: ['attack', 'defense', 'meditation'] }, ...oppDice];
      }
      return [
        { kind: 'dice', label: '选择消耗的 1 个攻击骰', owner: 'self', areas: ['attack'], min: 1, max: 1 },
        { kind: 'dice', label: '选择消耗的 1 个防御骰', owner: 'self', areas: ['defense'], min: 1, max: 1 },
        { kind: 'dice', label: '选择消耗的 1 个冥想骰', owner: 'self', areas: ['meditation'], min: 1, max: 1 },
        ...oppDice,
      ];
    },
    buildParams: ({ chosenDice, slots }) => ({
      costSlots: slots.length
        ? slotsParam(slots)
        : [...realSlots(chosenDice[0]), ...realSlots(chosenDice[1]), ...realSlots(chosenDice[2])],
      discard: slots.length
        ? {
            attack: chosenDice[0]?.[0],
            defense: chosenDice[1]?.[0],
            meditation: chosenDice[2]?.[0],
          }
        : {
            attack: chosenDice[3]?.[0],
            defense: chosenDice[4]?.[0],
            meditation: chosenDice[5]?.[0],
          },
    }),
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
        if (hasSword(state, player)) {
          steps.push({ kind: 'slots', label: SLOTS_LABEL, kinds: repeatKind(kind, 4) });
        } else {
          steps.push({ kind: 'dice', label: `选择消耗的 4 个${name}骰`, owner: 'self', areas: [kind], min: 4, max: 4 });
        }
        steps.push({ kind: 'dice', label: `选择弃置对方的${name}骰（0–4 颗，不足可跳过）`, owner: 'opponent', areas: [kind], min: 0, max: 4 });
      }
      return steps;
    },
    buildParams: ({ chosenDice, options, slots }) => ({
      kind: options[0],
      costSlots: slots.length ? slotsParam(slots) : realSlots(chosenDice[1]),
      opponentDiscardIds: slots.length ? (chosenDice[1] ?? []) : (chosenDice[2] ?? []),
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
        { kind: 'dice', label: '选择消耗的冥想骰（恰好 2 颗）', owner: 'self', areas: ['meditation'], min: 2, max: 2 },
        discard,
      ];
    },
    buildParams: ({ state, player, chosenDice, numbers }) => {
      const { costSlots, groups } = costPart(state, player, SPEC_FIST, numbers, chosenDice);
      return { costSlots, defenseDieIds: chosenDice[groups] ?? [] };
    },
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
            },
          ],
    buildParams: ({ state, player, chosenDice, numbers }) => ({
      costSlots: costPart(state, player, SPEC_BARRIER, numbers, chosenDice).costSlots,
    }),
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
            },
          ],
    buildParams: ({ state, player, chosenDice, numbers }) => ({
      costSlots: costPart(state, player, SPEC_PULSE, numbers, chosenDice).costSlots,
    }),
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
        label: '选择要变更的己方「1 点」能力骰（0–2 颗，可不选）',
        owner: 'self',
        areas: KINDS,
        min: 0,
        max: 2,
        filter: (d) => d.value === 1,
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
      },
    ],
    buildParams: () => ({}),
  },
  // 013 雷暴·触发（待决策）：一次选完要移动到攻击骰区的冥想骰（1–2 颗；不想移动就用「不发动」）
  '@leibao': {
    steps: () => [
      {
        kind: 'dice',
        label: '选择要移动到攻击骰区的冥想骰（1–2 颗，保留点数）',
        owner: 'self',
        areas: ['meditation'],
        min: 1,
        max: 2,
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
            },
          ],
    buildParams: ({ state, player, chosenDice, numbers }) => ({
      costSlots: costPart(state, player, SPEC_MINGJIE, numbers, chosenDice).costSlots,
    }),
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
      { kind: 'dice', label: '选择 1 颗冥想骰作为尘起代价', owner: 'self', areas: ['meditation'], min: 1, max: 1 },
    ],
    buildParams: () => ({}),
  },
};
