import { areaOf, createDie, newDieId } from '../model/dice';
import type { Artifact, DiceKind, Die, GameState, PlayerId, PlayerState } from '../model/types';
import { skillActive, hasActiveSkill } from './skill-state';
import { dealTrueDamage, virtualAttack } from './combat';
import { logLine, pname, vals } from './log';
export { skillActive, hasActiveSkill };

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
      const spot = p.areas.attack.find((d) => d.id === id)?.value ?? 0;
      const before = artifact.count;
      consumeDice(p, 'attack', [id]);
      artifact.count = Math.min(3, artifact.count + 1);
      logLine(
        g,
        `${pname(player)} 发动「淬炼」：消耗 1 颗攻击骰（${spot}点），「不祥」计数 ${before} → ${artifact.count}`,
      );
    },
  },
  // 龙腾万丈：消耗 3 冥想骰 → 获得 4 随机能力骰；最大/最小各 1 入攻击区，其余 2 入防御区；本回合攻击伤害 +1
  'youlong.tengwan': {
    run({ player, rng, params, g }) {
      const p = g.players[player];
      const ids = params.meditationDieIds as string[];
      if (!ids || ids.length !== 3) throw new Error('need exactly 3 meditation dice');
      const consumed = ids
        .map((id) => p.areas.meditation.find((d) => d.id === id))
        .filter((d): d is Die => d !== undefined);
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
      logLine(
        g,
        `${pname(player)} 发动「龙腾万丈」：消耗 3 颗冥想骰（${vals(consumed)}），获得 4 颗能力骰（${vals(
          dice,
        )}），2 颗移入攻击骰区、2 颗移入防御骰区，本回合攻击伤害 +1`,
      );
    },
  },
  // 潜行：消耗 2 攻击骰 → 先获得 2 随机防御骰，再获得 1 随机冥想骰（顺序强制）
  'yingle.qianxing': {
    run({ player, rng, params, g }) {
      const p = g.players[player];
      const ids = params.attackDieIds as string[];
      if (!ids || ids.length !== 2) throw new Error('need exactly 2 attack dice');
      const consumed = ids
        .map((id) => p.areas.attack.find((d) => d.id === id))
        .filter((d): d is Die => d !== undefined);
      consumeDice(p, 'attack', ids);
      const def: Die[] = [];
      for (let i = 0; i < 2; i++) {
        const d = createDie(newDieId(`${player}-`), rng.rollDie(), 'defense');
        p.areas.defense.push(d);
        def.push(d);
      }
      const med = createDie(newDieId(`${player}-`), rng.rollDie(), 'meditation');
      p.areas.meditation.push(med);
      logLine(
        g,
        `${pname(player)} 发动「潜行」：消耗 2 颗攻击骰（${vals(consumed)}），获得 2 颗防御骰（${vals(
          def,
        )}）与 1 颗冥想骰（${med.value}点）`,
      );
    },
  },
  // 明镜·充能：立即再次进行 1 次需要正常使用冥想骰的额外尘起行动（不占每回合 1 次上限）
  'mingjing.charge': {
    run({ g, player }) {
      g.freeDustRise += 1;
      logLine(g, `${pname(player)} 「明镜」充能效果：获得 1 次额外尘起行动`);
    },
  },
  // 完杀·充能：获得 1 个点数等于当前充能层数的攻击骰
  'wansha.charge': {
    run({ g, player, artifact }) {
      g.players[player].areas.attack.push(createDie(newDieId(`${player}-`), artifact.chargeLayer, 'attack'));
      logLine(g, `${pname(player)} 「完杀」充能效果：获得 1 颗 ${artifact.chargeLayer} 点攻击骰`);
    },
  },
  // 中央突破：消耗最多 3 个冥想骰 → 弃置对方等量防御骰；恰好 3 个则本回合攻击不可抵挡
  'yuqie.breakthrough': {
    run({ g, player, params }) {
      const p = g.players[player];
      const medIds = (params.meditationDieIds as string[] | undefined) ?? [];
      if (medIds.length < 1 || medIds.length > 3) throw new Error('meditationDieIds must contain 1..3 dice');
      if (new Set(medIds).size !== medIds.length) throw new Error('duplicate meditation die id');
      for (const id of medIds) {
        if (!p.areas.meditation.some((d) => d.id === id)) throw new Error(`not your meditation die: ${id}`);
      }
      const med = medIds
        .map((id) => p.areas.meditation.find((d) => d.id === id))
        .filter((d): d is Die => d !== undefined);
      consumeDice(p, 'meditation', medIds);
      const opponent: PlayerId = player === 'A' ? 'B' : 'A';
      const oppDef = g.players[opponent].areas.defense;
      const required = Math.min(medIds.length, oppDef.length);
      const defIds = (params.opponentDefenseDieIds as string[] | undefined) ?? [];
      if (new Set(defIds).size !== defIds.length) throw new Error('duplicate defense die id');
      for (const id of defIds) {
        if (!oppDef.some((d) => d.id === id)) throw new Error(`not an opponent defense die: ${id}`);
      }
      if (defIds.length !== required) throw new Error(`must discard exactly ${required} defense dice`);
      const def = defIds
        .map((id) => oppDef.find((d) => d.id === id))
        .filter((d): d is Die => d !== undefined);
      consumeDice(g.players[opponent], 'defense', defIds);
      if (medIds.length === 3) g.unblockableThisTurn = true;
      logLine(
        g,
        `${pname(player)} 发动「中央突破」：消耗 ${medIds.length} 颗冥想骰（${vals(med)}），弃置 ${pname(
          opponent,
        )} 的 ${defIds.length} 颗防御骰（${vals(def)}）${
          medIds.length === 3 ? '，本回合攻击不可抵挡' : ''
        }`,
      );
    },
  },
  // 影袭：使 1 个能力骰点数下降 X（最低 1）→ 按新点数移到对应区域；视为以 X 点进行 1 次（虚拟）攻击
  'yingle.yingxi': {
    run({ g, player, params }) {
      const p = g.players[player];
      const dieId = params.dieId as string;
      const x = params.x as number;
      if (!Number.isInteger(x) || x < 1) throw new Error('x must be >= 1');
      const kinds = ['attack', 'defense', 'meditation'] as const;
      let old = 0;
      let found = false;
      for (const k of kinds) {
        const die = p.areas[k].find((d) => d.id === dieId);
        if (die) {
          old = die.value;
          found = true;
          break;
        }
      }
      if (!found) throw new Error(`die not found: ${dieId}`);
      if (x > old - 1) throw new Error('x cannot reduce the die below 1');
      const newValue = old - x;
      for (const k of kinds) {
        p.areas[k] = p.areas[k].filter((d) => d.id !== dieId);
      }
      const dist = p.artifacts.find((a) => a.column === 2)!.distribution!;
      const newKind = areaOf(newValue, dist);
      p.areas[newKind].push({ id: dieId, value: newValue, kind: newKind });
      virtualAttack(g, player, x);
      logLine(
        g,
        `${pname(player)} 发动「影袭」：将 1 颗能力骰由 ${old} 点降为 ${newValue} 点（X=${x}），并视为以 ${x} 点发起攻击`,
      );
    },
  },
  // 明镜·必杀 斩神切：弃置自己全部能力骰；对方弃置对应种类对应数量；造成 X 真实伤害；获得 3 随机防御骰
  'mingjing.ultimate': {
    run({ g, player, rng, params }) {
      const p = g.players[player];
      const opponent: PlayerId = player === 'A' ? 'B' : 'A';
      const o = g.players[opponent];
      const own = { attack: p.areas.attack.length, defense: p.areas.defense.length, meditation: p.areas.meditation.length };
      const total = own.attack + own.defense + own.meditation;
      p.areas.attack = []; p.areas.defense = []; p.areas.meditation = [];
      const chosen = (params.opponentDiceByKind as Record<string, string[]>) ?? {};
      let oppDiscarded = 0;
      for (const k of ['attack', 'defense', 'meditation'] as const) {
        const want = Math.min(own[k], o.areas[k].length);
        const provided = (chosen[k] ?? []).filter((id) => o.areas[k].some((d) => d.id === id)).slice(0, want);
        const remaining = o.areas[k].filter((d) => !provided.includes(d.id)).map((d) => d.id);
        while (provided.length < want) provided.push(remaining.shift()!);
        if (provided.length) consumeDice(o, k, provided);
        oppDiscarded += provided.length;
      }
      const x = total + oppDiscarded;
      logLine(
        g,
        `${pname(player)} 发动必杀「斩神切」：弃置自己全部 ${total} 颗能力骰，${pname(
          opponent,
        )} 弃置 ${oppDiscarded} 颗，造成 ${x} 点真实伤害，获得 3 颗防御骰`,
      );
      dealTrueDamage(g, opponent, x);
      if (g.phase === 'gameOver') return;
      for (let i = 0; i < 3; i++) p.areas.defense.push(createDie(newDieId(`${player}-`), rng.rollDie(), 'defense'));
    },
  },
  // 完杀·必杀 零时枭首：消耗 1 攻击骰 → 弃对方 X 个防御骰；若对方仍有剩余防御骰，再获得 X 个随机攻击骰（X=消耗骰点数）
  'wansha.ultimate': {
    run({ g, player, rng, params }) {
      const p = g.players[player];
      const opponent: PlayerId = player === 'A' ? 'B' : 'A';
      const o = g.players[opponent];
      const dieId = params.attackDieId as string;
      const die = p.areas.attack.find((d) => d.id === dieId);
      if (!die) throw new Error('need an attack die');
      const x = die.value;
      consumeDice(p, 'attack', [dieId]);
      const wanted = ((params.opponentDefenseDieIds as string[]) ?? [])
        .filter((id) => o.areas.defense.some((d) => d.id === id))
        .slice(0, x);
      if (wanted.length < x) {
        for (const d of o.areas.defense) {
          if (wanted.length >= x) break;
          if (!wanted.includes(d.id)) wanted.push(d.id);
        }
      }
      consumeDice(o, 'defense', wanted);
      const gained = o.areas.defense.length > 0;
      if (gained) {
        for (let i = 0; i < x; i++) p.areas.attack.push(createDie(newDieId(`${player}-`), rng.rollDie(), 'attack'));
      }
      logLine(
        g,
        `${pname(player)} 发动必杀「零时枭首」：消耗 1 颗攻击骰（${x}点），弃置 ${pname(
          opponent,
        )} 的 ${wanted.length} 颗防御骰${gained ? `，并获得 ${x} 颗攻击骰` : ''}`,
      );
    },
  },
};
