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

function makePlayer(
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
    skillConsumedThisAction: 0,
    dunwuPulseUsedThisTurn: false,
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
  for (const id of ['A', 'B'] as PlayerId[]) {
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

/** 设先手：`firstPlayer` + 尘印标记归**另一位**（正常开局与 T02「先机」共用） */
export function applyFirstPlayer(g: GameState, who: PlayerId): void {
  const other: PlayerId = who === 'A' ? 'B' : 'A';
  g.firstPlayer = who;
  g.players.A.hasDustSeal = false;
  g.players.B.hasDustSeal = false;
  g.players[other].hasDustSeal = true;
}
