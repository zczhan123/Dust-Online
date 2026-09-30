import { SeededRng } from '../rng/rng';
import { placeDieByDistribution, createDie, newDieId, resetDieIdCounter } from '../model/dice';
import { makeArtifact } from '../content/artifacts';
import { makeLegend } from '../content/legends';
import { effectiveWill, initialLife, emptyDistribution } from './derive';
import { hasActiveSkill } from './skill-state';
import { logLine, pname } from './log';
import type { GameState, PlayerId, PlayerState } from '../model/types';

export interface SetupOptions {
  seed: number;
  firstPlayer: PlayerId;
  heroA?: [string, string, string];
  heroB?: [string, string, string];
  /** 预选模式·带传奇：该方的传奇英雄面板 id（L01–L12） */
  legendA?: string | null;
  legendB?: string | null;
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

  const second: PlayerId = opts.firstPlayer === 'A' ? 'B' : 'A';
  ({ A: playerA, B: playerB })[second].hasDustSeal = true;

  const rng = new SeededRng(opts.seed);
  if (!hasActiveSkill(playerA, 'batton.wudi')) fillInitialDice(playerA, rng);
  if (!hasActiveSkill(playerB, 'batton.wudi')) fillInitialDice(playerB, rng);

  const g: GameState = {
    players: { A: playerA, B: playerB },
    activePlayer: opts.firstPlayer,
    firstPlayer: opts.firstPlayer,
    initialRerollQueue: [],
    phase: 'setup',
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
    pendingQueue: [],
    chenaiUsed: { A: false, B: false },
    freeNoCostRise: 0,
    attacksThisTurn: { A: 0, B: 0 },
    hunhunGained: { A: 0, B: 0 },
    rerollPunish: { A: false, B: false },
    tianfa: { A: null, B: null },
  };

  // 开局设置类技能写入战报（约定：以后同类"开局就要设置"的技能都必须写战报）
  for (const id of ['A', 'B'] as PlayerId[]) {
    const p = g.players[id];
    if (hasActiveSkill(p, 'batton.wudi')) {
      logLine(
        g,
        `${pname(id)} 「无敌」：没有初始能力骰；初始生命 +20（生命 ${p.life} / 上限 ${p.lifeMax}）`,
      );
    }
  }

  return g;
}
