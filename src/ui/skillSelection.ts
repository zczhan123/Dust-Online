import type { DiceKind, GameState, PlayerId } from '../core/model/types';

export type SelectStep =
  | { kind: 'dice'; label: string; owner: 'self' | 'opponent'; areas: DiceKind[]; min: number; max: number; filter?: (d: { value: number }) => boolean }
  | { kind: 'option'; label: string; options: { value: string; label: string }[] }
  | { kind: 'number'; label: string; min: number; max: number };

export interface StepArgs {
  state: GameState;
  player: PlayerId;
  chosenDice: string[][];
  options: string[];
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

export const SKILL_SELECTION: Record<string, SkillSelection> = {
  'yuqie.breakthrough': {
    steps: ({ state, player, chosenDice }) => {
      const selfMed = state.players[player].areas.meditation.length;
      const oppDef = state.players[oppOf(player)].areas.defense.length;
      const medCount = chosenDice[0]?.length ?? 0;
      const need = Math.min(medCount, oppDef);
      return [
        { kind: 'dice', label: '选择消耗的冥想骰（1–3 颗）', owner: 'self', areas: ['meditation'], min: 1, max: Math.min(3, selfMed) },
        { kind: 'dice', label: `选择弃置对方的防御骰（${need} 颗）`, owner: 'opponent', areas: ['defense'], min: need, max: need },
      ];
    },
    buildParams: ({ chosenDice }) => ({ meditationDieIds: chosenDice[0] ?? [], opponentDefenseDieIds: chosenDice[1] ?? [] }),
  },
  'youlong.tengwan': {
    steps: () => [{ kind: 'dice', label: '选择消耗的冥想骰（恰好 3 颗）', owner: 'self', areas: ['meditation'], min: 3, max: 3 }],
    buildParams: ({ chosenDice }) => ({ meditationDieIds: chosenDice[0] ?? [] }),
  },
  'yingle.qianxing': {
    steps: () => [{ kind: 'dice', label: '选择消耗的攻击骰（恰好 2 颗）', owner: 'self', areas: ['attack'], min: 2, max: 2 }],
    buildParams: ({ chosenDice }) => ({ attackDieIds: chosenDice[0] ?? [] }),
  },
  'buxiang.cuilian': {
    steps: () => [{ kind: 'dice', label: '选择消耗的攻击骰（恰好 1 颗）', owner: 'self', areas: ['attack'], min: 1, max: 1 }],
    buildParams: ({ chosenDice }) => ({ attackDieId: chosenDice[0]?.[0] }),
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
    steps: ({ state, player, chosenDice }) => {
      const k = chosenDice[0]?.[0];
      const die = k ? state.players[player].areas.attack.find((d) => d.id === k) : undefined;
      const oppDef = state.players[oppOf(player)].areas.defense.length;
      const need = Math.min(die?.value ?? 0, oppDef);
      return [
        { kind: 'dice', label: '选择消耗的攻击骰（恰好 1 颗）', owner: 'self', areas: ['attack'], min: 1, max: 1 },
        { kind: 'dice', label: `选择弃置对方的防御骰（${need} 颗）`, owner: 'opponent', areas: ['defense'], min: need, max: need },
      ];
    },
    buildParams: ({ chosenDice }) => ({ attackDieId: chosenDice[0]?.[0], opponentDefenseDieIds: chosenDice[1] ?? [] }),
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
    steps: () => [
      { kind: 'dice', label: '选择消耗的 1 个攻击骰', owner: 'self', areas: ['attack'], min: 1, max: 1 },
      { kind: 'dice', label: '选择消耗的 1 个防御骰', owner: 'self', areas: ['defense'], min: 1, max: 1 },
      { kind: 'dice', label: '选择消耗的 1 个冥想骰', owner: 'self', areas: ['meditation'], min: 1, max: 1 },
      { kind: 'dice', label: '选择弃置对方的攻击骰（0–1 颗，不足可跳过）', owner: 'opponent', areas: ['attack'], min: 0, max: 1 },
      { kind: 'dice', label: '选择弃置对方的防御骰（0–1 颗，不足可跳过）', owner: 'opponent', areas: ['defense'], min: 0, max: 1 },
      { kind: 'dice', label: '选择弃置对方的冥想骰（0–1 颗，不足可跳过）', owner: 'opponent', areas: ['meditation'], min: 0, max: 1 },
    ],
    buildParams: ({ chosenDice }) => ({
      consumed: {
        attack: chosenDice[0]?.[0],
        defense: chosenDice[1]?.[0],
        meditation: chosenDice[2]?.[0],
      },
      discard: {
        attack: chosenDice[3]?.[0],
        defense: chosenDice[4]?.[0],
        meditation: chosenDice[5]?.[0],
      },
    }),
  },
  // 007 震荡斩击：选类型 → 消耗 4 颗同类型（显式）→ 弃对方 0–4 颗同类型（显式）
  'zhuzai.smash': {
    steps: ({ options }) => {
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
        steps.push({ kind: 'dice', label: `选择消耗的 4 个${name}骰`, owner: 'self', areas: [kind], min: 4, max: 4 });
        steps.push({ kind: 'dice', label: `选择弃置对方的${name}骰（0–4 颗，不足可跳过）`, owner: 'opponent', areas: [kind], min: 0, max: 4 });
      }
      return steps;
    },
    buildParams: ({ chosenDice, options }) => ({
      kind: options[0],
      consumedIds: chosenDice[1] ?? [],
      opponentDiscardIds: chosenDice[2] ?? [],
    }),
  },
  // 008 王家之拳：消耗 2 颗冥想骰 → 弃置自己的 0–2 颗防御骰（不足可少弃，代价为真实伤害）
  'tiebi.fist': {
    steps: () => [
      { kind: 'dice', label: '选择消耗的冥想骰（恰好 2 颗）', owner: 'self', areas: ['meditation'], min: 2, max: 2 },
      { kind: 'dice', label: '选择弃置的防御骰（0–2 颗，不足可少弃）', owner: 'self', areas: ['defense'], min: 0, max: 2 },
    ],
    buildParams: ({ chosenDice }) => ({ meditationDieIds: chosenDice[0] ?? [], defenseDieIds: chosenDice[1] ?? [] }),
  },
  // 011 灵能屏障·启动：消耗最多 3 颗防御骰 → 获得 2 倍冥想骰
  'dunwu.barrier.activate': {
    steps: ({ state, player }) => [
      { kind: 'dice', label: '选择消耗的防御骰（1–3 颗）', owner: 'self', areas: ['defense'], min: 1, max: Math.min(3, state.players[player].areas.defense.length) },
    ],
    buildParams: ({ chosenDice }) => ({ defenseDieIds: chosenDice[0] ?? [] }),
  },
  // 011 灵能脉冲·启动：消耗最多 3 颗攻击骰 → 获得 2 倍冥想骰
  'dunwu.pulse.activate': {
    steps: ({ state, player }) => [
      { kind: 'dice', label: '选择消耗的攻击骰（1–3 颗）', owner: 'self', areas: ['attack'], min: 1, max: Math.min(3, state.players[player].areas.attack.length) },
    ],
    buildParams: ({ chosenDice }) => ({ attackDieIds: chosenDice[0] ?? [] }),
  },
  // 尘起行动的代价：玩家自选 1 颗冥想骰（伪 key，由 UI 特殊处理为 dustRise 动作）
  '@dustRise': {
    steps: () => [
      { kind: 'dice', label: '选择 1 颗冥想骰作为尘起代价', owner: 'self', areas: ['meditation'], min: 1, max: 1 },
    ],
    buildParams: () => ({}),
  },
};
