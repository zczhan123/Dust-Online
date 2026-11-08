import { SeededRng } from '../rng/rng';
import { placeDieByDistribution, createDie, newDieId, resetDieIdCounter } from '../model/dice';
import { makeArtifact } from '../content/artifacts';
import { makeLegend } from '../content/legends';
import { TACTIC_BY_ID } from '../content/tactics';
import { effectiveWill, initialLife, emptyDistribution } from './derive';
import { hasActiveSkill } from './skill-state';
import { logLine, pname } from './log';
import { fxSkillFired } from './fx';
import type { GameState, PlayerId, PlayerState } from '../model/types';
import { ONE_V_ONE_ROSTER, nextSeat, rosterOf } from '../model/participants';
import type { TwoVTwoSeat, TwoVTwoSetup } from '../model/twoVTwo';

export interface SetupOptions {
  seed: number;
  firstPlayer: PlayerId;
  heroA?: [string, string, string];
  heroB?: [string, string, string];
  /** 预设模式·带传奇：该方的传奇英雄面板 id（L01–L12） */
  legendA?: string | null;
  legendB?: string | null;
  /** 使用战术牌：预设/轮选＝进入战斗后「抽 2 留 1」（`phase='tactics'`）；构筑/挑战＝在设置页直接选（本轮暂不接线） */
  tactics?: boolean;
  /** 战术牌·**直接指定**（构筑）：该方本场战术牌 id（给了就直接生效、不进抽牌阶段） */
  tacticA?: string;
  tacticB?: string;
}

export function makePlayer(
  id: PlayerId,
  hero: [string, string, string],
  legendId?: string | null,
): PlayerState {
  return {
    id,
    areas: { attack: [], defense: [], meditation: [] },
    artifacts: hero.map(makeArtifact),
    legend: legendId ? makeLegend(legendId) : null,
    life: 0,
    lifeMax: 0,
    markers: 0,
    hasDustSeal: false,
    buffs: [],
    damagedThisTurn: false,
    attackHalvedNextTurn: false,
    dealtDamageThisTurn: false,
    noDamageLastTurn: false,
    lifeTens: 0, // 在下方设定生命后同步（生命十位数）
    tiandanGainedThisTurn: 0, // L08 蛇蝎之泪：本回合「填弹」实际叠加的计数累计
    turnsTaken: 0, // 该玩家自己的回合计数（T05「前 3 个回合」用）
    tacticOnceUsed: false, // 战术牌「整局 1 次」标记（T07/T09）
    tacticHeldDie: null, // 战术牌上的存放骰（T15 影子）
    tacticGuess: null, // 战术牌·T13「远见」猜测的玩家
    tactic: null, // 战术牌（战前抽 2 留 1 / 构筑直接选）
  };
}

export function fillInitialDice(p: PlayerState, rng: SeededRng): void {
  const will = effectiveWill(p);
  const dist = emptyDistribution(p);
  if (!dist) throw new Error(`player ${p.id} has no distribution (column 2)`);
  for (let i = 0; i < will; i++) {
    const die = createDie(newDieId(`${p.id}-`), rng.rollDie());
    placeDieByDistribution(p.areas, die, dist);
  }
}

export function setupGame(opts: SetupOptions): GameState {
  resetDieIdCounter();
  const heroA = opts.heroA ?? ['001', '002', '003'];
  const heroB = opts.heroB ?? ['004', '005', '006'];

  const playerA = makePlayer('A', heroA, opts.legendA);
  const playerB = makePlayer('B', heroB, opts.legendB);

  // 战术牌·**直接指定**（构筑）：在建局时就落定（不进抽牌阶段）
  playerA.tactic = opts.tacticA ?? null;
  playerB.tactic = opts.tacticB ?? null;

  const lifeA = initialLife(playerA);
  const lifeB = initialLife(playerB);
  playerA.life = playerA.lifeMax = lifeA;
  playerB.life = playerB.lifeMax = lifeB;

  // L03 传奇面板「无敌」（持续）：你没有初始的能力骰；你的**初始生命 +20（生命上限也 +20）**。
  for (const p of [playerA, playerB]) {
    if (hasActiveSkill(p, 'batton.wudi')) {
      p.life += 20;
      p.lifeMax += 20;
    }
  }

  // L05 复仇之灵：记录生命十位数基准
  playerA.lifeTens = Math.floor(playerA.life / 10);
  playerB.lifeTens = Math.floor(playerB.life / 10);

  const rng = new SeededRng(opts.seed);
  if (!hasActiveSkill(playerA, 'batton.wudi')) fillInitialDice(playerA, rng);
  if (!hasActiveSkill(playerB, 'batton.wudi')) fillInitialDice(playerB, rng);

  const g: GameState = {
    players: { A: playerA, B: playerB },
    roster: [...ONE_V_ONE_ROSTER],
    teamOf: { A: 'A', B: 'B' },
    teams: {
      A: { id: 'A', members: ['A'], life: playerA.life, lifeMax: playerA.lifeMax },
      B: { id: 'B', members: ['B'], life: playerB.life, lifeMax: playerB.lifeMax },
    },
    rules: { id: '1v1', lifeModel: 'perSeat' },
    activePlayer: opts.firstPlayer,
    firstPlayer: opts.firstPlayer,
    initialRerollQueue: [],
    phase: 'setup',
    mode: 'standard',
    dustfall: 0,
    turnIndex: 0,
    firstRound: { A: true, B: true },
    rngState: rng.state(),
    log: [],
    pendingAttack: null,
    pending: null,
    unblockableThisTurn: false,
    caiyuliuUsed: 0,
    dustRiseNormalCount: 0,
    dustRiseActed: false,
    freeDustRise: 0,
    rerollUsed: 0,
    skillsUsedThisTurn: [],
    ultimatesUsed: [],
    legendOnceUsed: [],
    winner: null,
    skillConsumedThisAction: {},
    dunwuPulseUsed: {},
    attackQueue: null,
    virtualQueue: null,
    extraReroll: null,
    tacticPool: [],
    tacticQueue: [],
    tacticHand: [],
    tacticStartDone: false,
    tacticLowFirst: null,
    pendingQueue: [],
    chenaiUsed: { A: false, B: false },
    freeNoCostRise: 0,
    attacksThisTurn: { A: 0, B: 0 },
    hunhunGained: { A: 0, B: 0 },
    rerollPunish: { A: false, B: false },
    tianfa: { A: null, B: null },
  };

  // 开局设置类技能写入战报（约定：以后同类"开局就要设置"的技能都必须写战报）
  applyFirstPlayer(g, opts.firstPlayer); // 先手 + 尘印（后手持有）
  for (const id of rosterOf(g)) {
    const p = g.players[id];
    if (hasActiveSkill(p, 'batton.wudi')) {
      logLine(
        g,
        `${pname(id)} 「无敌」：没有初始能力骰；初始生命 +20（生命 ${p.life} / 上限 ${p.lifeMax}）`,
      );
      // 动效旁路：开局首帧（"双方第一骰子上屏"）在 L03 传奇面板弹一次「无敌」。
      // 建局后到首次 renderGame 之间没有 applyAction（不会被 fxReset 清），故首帧可取到。
      fxSkillFired(g, id, 'batton.wudi');
    }
    // 战术牌（构筑直接指定）：写战报
    if (p.tactic) {
      logLine(g, `${pname(id)} 战术牌：「${TACTIC_BY_ID[p.tactic]?.name ?? p.tactic}」`);
    }
  }

  return g;
}

/** 2v2 建局：四人座位、团队共享生命、各自初始骰区。种子/骰子可显式指定。 */
export function setupTwoVTwoGame(setup: TwoVTwoSetup): GameState {
  resetDieIdCounter();
  const roster: TwoVTwoSeat[] = ['A1', 'B1', 'A2', 'B2'];
  const rng = new SeededRng(setup.seed ?? 1);
  const players: Record<string, PlayerState> = {};
  for (const seat of roster) {
    const p = makePlayer(seat, setup.seats[seat]);
    for (const [artifactId, side] of Object.entries(setup.active?.[seat] ?? {})) {
      const art = p.artifacts.find((a) => a.id === artifactId);
      if (art) art.activeMarkerSide = side;
    }
    for (const [artifactId, count] of Object.entries(setup.counts?.[seat] ?? {})) {
      const art = p.artifacts.find((a) => a.id === artifactId);
      if (art) art.count = count;
    }
    players[seat] = p;
  }

  const teamLife: Record<'A' | 'B', number> = { A: 0, B: 0 };
  for (const seat of roster) {
    const value = initialLife(players[seat]);
    players[seat].life = players[seat].lifeMax = value;
    teamLife[seat[0] as 'A' | 'B'] += value;
  }
  const teams = [...new Set(roster.map((seat) => seat[0]))] as ('A' | 'B')[];
  for (const team of teams) {
    teamLife[team] = Math.max(1, teamLife[team]);
    for (const seat of roster.filter((s) => s[0] === team)) {
      players[seat].life = players[seat].lifeMax = teamLife[team];
      players[seat].lifeTens = Math.floor(teamLife[team] / 10);
    }
  }

  for (const seat of roster) {
    const explicit = setup.dice?.[seat];
    if (explicit) {
      for (const kind of ['attack', 'defense', 'meditation'] as const) {
        for (const value of explicit[kind]) {
          players[seat].areas[kind].push(createDie(newDieId(`${seat}-`), value));
        }
      }
    } else {
      fillInitialDice(players[seat], rng);
    }
  }

  const firstPlayer: PlayerId = setup.firstTeam === 'A' ? 'A1' : 'B1';
  const g: GameState = {
    players,
    roster: [...roster],
    teamOf: { A1: 'A', A2: 'A', B1: 'B', B2: 'B' },
    teams: {
      A: { id: 'A', members: ['A1', 'A2'], life: teamLife.A, lifeMax: teamLife.A },
      B: { id: 'B', members: ['B1', 'B2'], life: teamLife.B, lifeMax: teamLife.B },
    },
    rules: { id: '2v2', lifeModel: 'perTeam' },
    stance: 'attackPicks',
    activePlayer: firstPlayer,
    firstPlayer,
    initialRerollQueue: [],
    phase: 'setup',
    mode: 'standard',
    dustfall: 0,
    turnIndex: 0,
    firstRound: { A1: true, A2: true, B1: true, B2: true },
    rngState: rng.state(),
    log: [],
    pendingAttack: null,
    pending: null,
    unblockableThisTurn: false,
    caiyuliuUsed: 0,
    dustRiseNormalCount: 0,
    dustRiseActed: false,
    freeDustRise: 0,
    rerollUsed: 0,
    skillsUsedThisTurn: [],
    ultimatesUsed: [],
    legendOnceUsed: [],
    winner: null,
    skillConsumedThisAction: {},
    dunwuPulseUsed: {},
    attackQueue: null,
    virtualQueue: null,
    extraReroll: null,
    tacticPool: [],
    tacticQueue: [],
    tacticHand: [],
    tacticStartDone: false,
    tacticLowFirst: null,
    pendingQueue: [],
    chenaiUsed: { A1: false, A2: false, B1: false, B2: false },
    freeNoCostRise: 0,
    attacksThisTurn: { A1: 0, A2: 0, B1: 0, B2: 0 },
    hunhunGained: { A1: 0, A2: 0, B1: 0, B2: 0 },
    rerollPunish: { A1: false, A2: false, B1: false, B2: false },
    tianfa: { A1: null, A2: null, B1: null, B2: null },
  };
  applyFirstPlayer(g, firstPlayer);
  return g;
}

/** 设先手：`firstPlayer` + 尘印标记归**另一位**（正常开局与 T02「先机」共用） */
export function applyFirstPlayer(g: GameState, who: PlayerId): void {
  g.firstPlayer = who;
  for (const id of rosterOf(g)) g.players[id].hasDustSeal = false;
  let holder: PlayerId = who;
  // 2v2：尘印归第 4 个行动者；1v1 归后手（nextSeat）
  const steps = g.rules?.id === '2v2' ? 3 : 1;
  for (let i = 0; i < steps; i += 1) holder = nextSeat(g, holder);
  g.players[holder].hasDustSeal = true;
}
