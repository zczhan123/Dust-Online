import type { GameState, PlayerId } from '../model/types';
import { withRngState } from './effects';
import { fillInitialDice } from './setup';
import { hasActiveSkill } from './skill-state';

const KINDS = ['attack', 'defense', 'meditation'] as const;

/**
 * L04「我将在下个梦境与你再度相逢」必杀：把对局**重置为"战斗开始时"**。
 * **保留**：双方生命、尘落、以及所有含"计数"的技能计数（各神器 `count` ＋ 面板 `count`）。
 * **重置**：能力骰（按各自意志/分布**重投**）、激活标记/armed/充能层/存放骰/持续失效、
 * buff/受击与回合标记、待决策与队列、已用记录、回合号/首回合、必杀已用 等。
 * 收尾走"开局流程"：`activePlayer = 先手`、`initialRerollQueue = [先手, 后手]`、`phase = 'initialReroll'`，
 * **后手拿尘印**；战报（`g.log`）**保留**。
 */
export function resetToBattleStart(g: GameState, firstPlayer: PlayerId): void {
  const second: PlayerId = firstPlayer === 'A' ? 'B' : 'A';

  // 1) 清空能力骰与各神器/玩家/面板的临时状态（计数与生命**不动**）
  for (const id of ['A', 'B'] as PlayerId[]) {
    const p = g.players[id];
    for (const k of KINDS) p.areas[k] = [];
    for (const a of p.artifacts) {
      a.activeMarkerSide = null;
      a.armedSide = null;
      a.armedTurn = -1;
      a.chargeLayer = 0;
      a.heldDice = [];
      a.continuousLost = false;
      a.continuousLostThisTurn = false;
      a.allSidesActiveThisTurn = false; // L09 遍野残杀的全开标记（重开一局＝清除）
      // 计数（a.count）保留：卡面要求"继承技能计数"
    }
    if (p.legend) {
      p.legend.continuousLost = false;
      p.legend.continuousLostThisTurn = false;
      // 面板计数（p.legend.count）保留
    }
    p.buffs = [];
    p.markers = 0;
    p.hasDustSeal = false;
    p.damagedThisTurn = false;
    p.attackHalvedNextTurn = false;
    p.dealtDamageThisTurn = false;
    p.noDamageLastTurn = false;
    p.lifeTens = Math.floor(p.life / 10); // L05 复仇之灵：重开后按继承的生命重置基准
    p.wuguang = null; // L06 无光领域：重置为战斗开始时
    p.tiandanGainedThisTurn = 0; // L08 蛇蝎之泪
  }

  // 2) 重投初始能力骰（按各自意志与第二列分布）
  withRngState(g, (rng) => {
    // 与正常开局一致：L03「无敌」没有初始能力骰
    if (!hasActiveSkill(g.players.A, 'batton.wudi')) fillInitialDice(g.players.A, rng);
    if (!hasActiveSkill(g.players.B, 'batton.wudi')) fillInitialDice(g.players.B, rng);
  });

  // 3) 尘印：本技能导致的重开**不发尘印标记**（按 2026-09-26 定；正常开局才会给后手）

  // 4) 清对局级状态（尘落 dustfall 与战报 log **保留**）
  g.turnIndex = 0;
  g.firstRound = { A: true, B: true };
  g.pendingAttack = null;
  g.pending = null;
  g.pendingQueue = [];
  g.attackQueue = null;
  g.virtualQueue = null;
  g.extraReroll = null;
  g.unblockableThisTurn = false;
  g.caiyuliuUsed = 0;
  g.dustRiseNormalCount = 0;
  g.dustRiseActed = false;
  g.freeDustRise = 0;
  g.freeNoCostRise = 0;
  g.rerollUsed = 0;
  g.skillsUsedThisTurn = [];
  g.ultimatesUsed = [];
  g.skillConsumedThisAction = 0;
  g.dunwuPulseUsedThisTurn = false;
  g.chenaiUsed = { A: false, B: false };
  g.attacksThisTurn = { A: 0, B: 0 };
  g.hunhunGained = { A: 0, B: 0 };
  g.rerollPunish = { A: false, B: false };
  g.tianfa = { A: null, B: null };
  g.winner = null;
  g.legendOnceUsed = []; // 「整局一次」类的传奇面板技能（L11 永恒女王）；L04 重开＝新一局

  // 5) 开局流程
  g.firstPlayer = firstPlayer;
  g.activePlayer = firstPlayer;
  g.phase = 'initialReroll';
  g.initialRerollQueue = [firstPlayer, second];
}
