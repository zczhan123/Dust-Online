import type { GameState, PlayerId, TeamState } from './types';

/** 1v1 的固定座位表；引擎内不再直接写 `['A','B']` 字面量。 */
export const ONE_V_ONE_ROSTER: PlayerId[] = ['A', 'B'];

/** 参战座位顺序（2v2 时由适配器写入实际环序）。 */
export function rosterOf(g: GameState): PlayerId[] {
  return g.roster ?? ONE_V_ONE_ROSTER;
}

/** 座位所属阵营。1v1 每个座位自成一队。 */
export function sideOf(g: GameState, seat: PlayerId): string {
  return g.teamOf?.[seat] ?? seat;
}

/** 座位所属队伍；无队伍信息时返回 undefined。 */
export function teamOf(g: GameState, seat: PlayerId): TeamState | undefined {
  return g.teams?.[sideOf(g, seat)];
}

/** 队伍成员。无队伍信息时回退为单人队。 */
export function membersOf(g: GameState, side: string): PlayerId[] {
  return g.teams?.[side]?.members ?? [side as PlayerId];
}

/** 同队队友（不含自己）。 */
export function alliesOf(g: GameState, seat: PlayerId): PlayerId[] {
  return membersOf(g, sideOf(g, seat)).filter((s) => s !== seat);
}

/** 不同阵营的全部座位。 */
export function enemiesOf(g: GameState, seat: PlayerId): PlayerId[] {
  const side = sideOf(g, seat);
  return rosterOf(g).filter((s) => sideOf(g, s) !== side);
}

/**
 * 1v1/单人敌人场景的唯一对手。
 * 2v2（两名敌人）必须显式传目标，否则抛错——避免静默打错人。
 */
export function opponentOf(g: GameState, seat: PlayerId): PlayerId {
  const enemies = enemiesOf(g, seat);
  if (enemies.length !== 1) {
    throw new Error(`expected exactly one enemy for ${seat}, got ${enemies.length}`);
  }
  return enemies[0];
}

/** 解析目标：显式目标必须是敌人；未传时只在唯一敌人场景回退。 */
export function resolveEnemy(g: GameState, seat: PlayerId, target?: PlayerId | null): PlayerId {
  const enemies = enemiesOf(g, seat);
  if (target) {
    if (!enemies.includes(target)) {
      throw new Error(`invalid enemy target: ${target}`);
    }
    return target;
  }
  if (enemies.length === 1) return enemies[0];
  throw new Error(`target required: ${seat} has ${enemies.length} enemies`);
}

/** 固定环序的下一席（1v1: A→B→A；2v2 用适配器写入的 roster 环序）。 */
export function nextSeat(g: GameState, seat: PlayerId): PlayerId {
  const roster = rosterOf(g);
  const index = roster.indexOf(seat);
  if (index < 0) throw new Error(`seat not in roster: ${seat}`);
  return roster[(index + 1) % roster.length];
}

function isSharedTeam(g: GameState, seat: PlayerId): boolean {
  const team = teamOf(g, seat);
  return !!team && team.members.length > 1;
}

/** 座位的有效生命：2v2 共享池；1v1 仍是个人生命（零行为兼容）。 */
export function lifeOf(g: GameState, seat: PlayerId): number {
  const team = teamOf(g, seat);
  return isSharedTeam(g, seat) ? team!.life : g.players[seat].life;
}

/** 座位的有效生命上限：2v2 共享池；1v1 仍是个人上限。 */
export function lifeMaxOf(g: GameState, seat: PlayerId): number {
  const team = teamOf(g, seat);
  return isSharedTeam(g, seat) ? team!.lifeMax : g.players[seat].lifeMax;
}

/** 写生命：2v2 写队伍池并同步两名队员；1v1 写个人生命并同步队伍元数据。 */
export function setLife(g: GameState, seat: PlayerId, value: number): void {
  const team = teamOf(g, seat);
  if (isSharedTeam(g, seat)) {
    team!.life = value;
    for (const member of team!.members) {
      const p = g.players[member];
      if (p) p.life = value;
    }
    return;
  }
  g.players[seat].life = value;
  if (team) team.life = value;
}

/** 写生命上限：2v2 写队伍池并同步两名队员；1v1 写个人上限并同步队伍元数据。 */
export function setLifeMax(g: GameState, seat: PlayerId, value: number): void {
  const team = teamOf(g, seat);
  if (isSharedTeam(g, seat)) {
    team!.lifeMax = value;
    for (const member of team!.members) {
      const p = g.players[member];
      if (p) p.lifeMax = value;
    }
    return;
  }
  g.players[seat].lifeMax = value;
  if (team) team.lifeMax = value;
}
