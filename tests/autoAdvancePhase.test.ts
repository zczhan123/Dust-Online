import { describe, it, expect } from 'vitest';
import {
  createGame,
  applyAction,
  skipInitialReroll,
  getLegalActions,
  autoAdvanceAction,
} from '../src/core/engine/game';
import type { Die, DiceKind } from '../src/core/model/types';

const die = (id: string, value: number, kind: DiceKind): Die => ({ id, value, kind });

/** 让 A 的 002「龙游万象」（持续·左）生效 → 重掷次数变 2 */
const armYoulong = (g: ReturnType<typeof createGame>): void => {
  const a = g.players.A.artifacts.find((x) => x.id === '002')!;
  a.activeMarkerSide = 'left';
  a.armedSide = 'left';
  a.armedTurn = g.turnIndex;
};

describe('自动推进阶段：没得做就自动翻页', () => {
  // ── 重掷阶段 ────────────────────────────────────────────────
  it('重掷次数用尽 → 自动离开重掷阶段', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    g.phase = 'reroll';
    g.activePlayer = 'A';
    g.rerollUsed = 0;
    g.players.A.areas = { attack: [die('r1', 1, 'attack')], defense: [], meditation: [] };
    applyAction(g, { t: 'reroll', dieIds: ['r1'] });
    expect(g.rerollUsed).toBe(1);
    // 只剩攻击骰、无法尘起 → 连尘起阶段也一并自动翻页
    expect(g.phase).toBe('main');
  });

  it('002「龙游万象」给到 2 次 → 第 1 次后**不**自动结束', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    armYoulong(g);
    g.phase = 'reroll';
    g.activePlayer = 'A';
    g.rerollUsed = 0;
    g.players.A.areas = {
      attack: [die('r1', 1, 'attack'), die('r2', 2, 'attack')],
      defense: [],
      meditation: [],
    };
    applyAction(g, { t: 'reroll', dieIds: ['r1'] });
    expect(g.rerollUsed).toBe(1);
    expect(g.phase).toBe('reroll'); // 还有第 2 次 → 停下等玩家
    applyAction(g, { t: 'reroll', dieIds: ['r2'] });
    expect(g.rerollUsed).toBe(2);
    expect(g.phase).not.toBe('reroll'); // 用尽 → 自动结束
  });

  // ── 尘起阶段 ────────────────────────────────────────────────
  it('尘起次数用尽 → 自动进入主要阶段（仍有冥想骰也不允许再尘起）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    g.dustRiseNormalCount = 0;
    g.dustRiseActed = false;
    g.players.A.areas = {
      attack: [],
      defense: [],
      meditation: [die('m1', 2, 'meditation'), die('m2', 3, 'meditation')],
    };
    applyAction(g, { t: 'dustRise', artifactId: '001', side: 'left', costSlots: [{ dieIds: ['m1'] }] });
    expect(g.dustRiseNormalCount).toBe(1);
    expect(g.phase).toBe('main');
    expect(g.players.A.areas.meditation.map((d) => d.id)).toEqual(['m2']); // 另一颗仍留着（给主要阶段）
  });

  it('持有尘印 → 算"还能尘起"，用完常规次数也**不**自动结束', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    g.dustRiseNormalCount = 0;
    g.dustRiseActed = false;
    g.players.A.hasDustSeal = true;
    g.players.A.areas = { attack: [], defense: [], meditation: [die('m1', 2, 'meditation')] };
    applyAction(g, { t: 'dustRise', artifactId: '001', side: 'left', costSlots: [{ dieIds: ['m1'] }] });
    expect(g.phase).toBe('dustRise');
    expect(getLegalActions(g).some((a) => a.t === 'dustRise' && a.useSeal)).toBe(true);
  });

  it('019 免费尘起在手 → **不**自动结束', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    g.dustRiseNormalCount = 0;
    g.dustRiseActed = false;
    g.freeNoCostRise = 1;
    g.players.A.areas = { attack: [], defense: [], meditation: [die('m1', 2, 'meditation')] };
    applyAction(g, { t: 'dustRise', artifactId: '001', side: 'left', costSlots: [{ dieIds: ['m1'] }] });
    expect(g.phase).toBe('dustRise');
    expect(getLegalActions(g).some((a) => a.t === 'dustRise' && a.free)).toBe(true);
  });

  it('T12「激进」额外充能在手（首个尘起阶段）→ **不**自动结束', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T12' });
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    g.firstRound.A = true;
    g.dustRiseNormalCount = 0;
    g.dustRiseActed = false;
    g.players.A.tacticOnceUsed = false;
    g.players.A.hasDustSeal = false;
    g.players.A.areas = {
      attack: [],
      defense: [],
      meditation: [die('m1', 2, 'meditation'), die('m2', 3, 'meditation')],
    };
    applyAction(g, { t: 'dustRise', artifactId: '001', side: 'left', costSlots: [{ dieIds: ['m1'] }] });
    expect(g.phase).toBe('dustRise'); // 还能对第三列（003）额外充能
    expect(
      getLegalActions(g).some((a) => a.t === 'dustRise' && a.artifactId === '003'),
    ).toBe(true);
  });

  // ── 与 T07「保守」的先后（关键：自动判定必须在补骰之后） ─────
  it('T07「保守」补的骰在自动判定之前 → 尘起阶段不被误判为空', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T07' });
    // 清空 A 的初始骰（防御为 0）→ 回合开始时 T07 才会触发
    g.players.A.areas = { attack: [], defense: [], meditation: [] };
    skipInitialReroll(g); // → A 第一个回合开始（turnIndex 变 1 → checkBaoshou 生效）
    // T07：防御骰第一次为 0 → 补 1 防御 + 1 冥想。若自动判定排在补骰之前，尘起阶段会被误跳过（进主要）
    expect(g.players.A.areas.defense).toHaveLength(1);
    expect(g.players.A.areas.meditation).toHaveLength(1);
    expect(g.phase).toBe('dustRise');
  });

  // ── 与 T11「迷烟」的关系 ───────────────────────────────────
  it('T11「迷烟」：首个回合有多给的重掷阶段（有骰→不跳过；用尽→自动结束）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T11' });
    skipInitialReroll(g);
    expect(g.activePlayer).toBe('A');
    expect(g.phase).toBe('reroll'); // 首回合本无重掷，T11 多给了一段
    const rr = getLegalActions(g).find((a) => a.t === 'reroll');
    expect(rr).toBeTruthy();
    applyAction(g, rr!);
    expect(g.phase).not.toBe('reroll');
  });

  it('无 T11：首回合没有重掷阶段（直接尘起）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    expect(g.phase).toBe('dustRise');
  });

  // ── 待决策时不推进 ─────────────────────────────────────────
  it('有 pending / 待抵挡 时一律不自动推进', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    g.players.A.areas = { attack: [], defense: [], meditation: [] };
    expect(autoAdvanceAction(g)).not.toBeNull(); // 无任何可做之事
    g.pending = { kind: 'chenaiFreeRise', player: 'A' };
    expect(autoAdvanceAction(g)).toBeNull(); // 让位待决策
  });

  // ── 单元：谓词本身 ─────────────────────────────────────────
  it('autoAdvanceAction：重掷/尘起阶段的边界', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    // 重掷：还有次数 → null
    g.phase = 'reroll';
    g.activePlayer = 'A';
    g.rerollUsed = 0;
    g.players.A.areas = { attack: [die('r1', 1, 'attack')], defense: [], meditation: [] };
    expect(autoAdvanceAction(g)).toBeNull();
    // 次数用尽 → advance
    g.rerollUsed = 1;
    expect(autoAdvanceAction(g)).toEqual({ t: 'advance' });
    // 尘起：有冥想骰 → null
    g.phase = 'dustRise';
    g.dustRiseNormalCount = 0;
    g.players.A.areas = { attack: [], defense: [], meditation: [die('m1', 2, 'meditation')] };
    expect(autoAdvanceAction(g)).toBeNull();
  });
});
