import type { DiceKind, GameState, PlayerId } from '../core/model/types';

export type SelectStep =
  | { kind: 'dice'; label: string; owner: 'self' | 'opponent'; areas: DiceKind[]; min: number; max: number }
  | { kind: 'number'; label: string; min: number; max: number };

export interface SelectionArgs {
  state: GameState;
  player: PlayerId;
  chosenDice: string[][];
  numbers: number[];
}

export interface SkillSelection {
  steps: (args: { state: GameState; player: PlayerId; chosenDice: string[][] }) => SelectStep[];
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
        { kind: 'dice', label: '选择要降低点数的能力骰（恰好 1 颗）', owner: 'self', areas: ['attack', 'defense', 'meditation'], min: 1, max: 1 },
      ];
      if (first) {
        const die = KINDS.flatMap((k) => state.players[player].areas[k]).find((d) => d.id === first);
        steps.push({ kind: 'number', label: `选择 X（1 ~ ${die?.value ?? 1}）`, min: 1, max: die?.value ?? 1 });
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
  // 尘起行动的代价：玩家自选 1 颗冥想骰（伪 key，由 UI 特殊处理为 dustRise 动作）
  '@dustRise': {
    steps: () => [
      { kind: 'dice', label: '选择 1 颗冥想骰作为尘起代价', owner: 'self', areas: ['meditation'], min: 1, max: 1 },
    ],
    buildParams: () => ({}),
  },
};
