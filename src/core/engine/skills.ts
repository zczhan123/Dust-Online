import { createDie, newDieId } from '../model/dice';
import type { Artifact, DiceKind, Die, GameState, PlayerId, PlayerState, SkillDef } from '../model/types';

export function skillActive(a: Artifact, s: SkillDef): boolean {
  return s.side === 'only' ? a.activeMarkerSide != null : a.activeMarkerSide === s.side;
}

/** 该玩家是否有某 key 的技能处于激活状态（持续效果判定用） */
export function hasActiveSkill(p: PlayerState, key: string): boolean {
  return p.artifacts.some((a) => a.skills.some((s) => s.key === key && skillActive(a, s)));
}

export interface SkillCtx {
  g: GameState;
  player: PlayerId;
  artifact: Artifact;
  rng: { rollDie(): number };
  params: Record<string, unknown>;
}

export interface SkillHandler {
  run(ctx: SkillCtx): void;
}

/** 从玩家的某区域移除指定骰（校验归属），返还供应堆 */
export function consumeDice(p: PlayerState, kind: DiceKind, ids: string[]): void {
  const area = p.areas[kind];
  for (const id of ids) {
    const idx = area.findIndex((d) => d.id === id);
    if (idx < 0) throw new Error(`not a ${kind} die: ${id}`);
    area.splice(idx, 1);
  }
}

export const SKILL_HANDLERS: Record<string, SkillHandler> = {
  // 淬炼：消耗 1 攻击骰 → 本神器计数 +1（上限 3）
  'buxiang.cuilian': {
    run({ player, artifact, params, g }) {
      const p = g.players[player];
      const id = params.attackDieId as string;
      if (!id) throw new Error('missing attackDieId');
      consumeDice(p, 'attack', [id]);
      artifact.count = Math.min(3, artifact.count + 1);
    },
  },
  // 龙腾万丈：消耗 3 冥想骰 → 获得 4 随机能力骰；最大/最小各 1 入攻击区，其余 2 入防御区；本回合攻击伤害 +1
  'youlong.tengwan': {
    run({ player, rng, params, g }) {
      const p = g.players[player];
      const ids = params.meditationDieIds as string[];
      if (!ids || ids.length !== 3) throw new Error('need exactly 3 meditation dice');
      consumeDice(p, 'meditation', ids);
      const dice: Die[] = Array.from({ length: 4 }, () => createDie(newDieId(`${player}-`), rng.rollDie()));
      const sorted = [...dice].sort((a, b) => a.value - b.value);
      const min = sorted[0];
      const max = sorted[sorted.length - 1];
      for (const d of dice) {
        if (d === min || d === max) {
          d.kind = 'attack';
          p.areas.attack.push(d);
        } else {
          d.kind = 'defense';
          p.areas.defense.push(d);
        }
      }
      p.buffs.push({ attr: 'attackDamage', add: 1, duration: 'thisTurn' });
    },
  },
  // 潜行：消耗 2 攻击骰 → 先获得 2 随机防御骰，再获得 1 随机冥想骰（顺序强制）
  'yingle.qianxing': {
    run({ player, rng, params, g }) {
      const p = g.players[player];
      const ids = params.attackDieIds as string[];
      if (!ids || ids.length !== 2) throw new Error('need exactly 2 attack dice');
      consumeDice(p, 'attack', ids);
      for (let i = 0; i < 2; i++) p.areas.defense.push(createDie(newDieId(`${player}-`), rng.rollDie(), 'defense'));
      p.areas.meditation.push(createDie(newDieId(`${player}-`), rng.rollDie(), 'meditation'));
    },
  },
};
