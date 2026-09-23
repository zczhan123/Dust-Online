import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll } from '../src/core/engine/game';
import type { DiceKind, GameState, PlayerId } from '../src/core/model/types';

/**
 * 跨卡联动 / §19「新卡必查清单」抽检（028–030）。
 * 覆盖：① 真实之剑(010) 置换 ×（030 必杀 / 028 抵挡）；② 凛冽之音(027) × 全知(029)；
 *       ③ 重掷阶段/额外重掷 × 全知(029)；FAQ 28.1.1（028 × 017 冥界行走）、FAQ 28.2.1（028 陨落抵挡 × 013 电刑）。
 */
const mkGame = (
  heroA: [string, string, string],
  heroB: [string, string, string],
): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA, heroB });
  skipInitialReroll(g);
  g.phase = 'main';
  g.pending = null;
  g.pendingAttack = null;
  g.ultimatesUsed = [];
  g.skillsUsedThisTurn = [];
  for (const who of ['A', 'B'] as PlayerId[]) {
    g.players[who].areas.attack = [];
    g.players[who].areas.defense = [];
    g.players[who].areas.meditation = [];
  }
  return g;
};
const arm = (g: GameState, who: PlayerId, id: string, side: 'left' | 'right'): void => {
  const a = g.players[who].artifacts.find((x) => x.id === id)!;
  a.activeMarkerSide = side;
  a.armedSide = side;
  a.armedTurn = g.turnIndex;
};
const die = (id: string, value: number, kind: DiceKind) => ({ id, value, kind });
const logs = (g: GameState): string => g.log.map((l) => l.text).join('\n');

describe('§19-① 真实之剑（010）置换兼容性', () => {
  it('010 × 030 必杀：真实之剑激活时可用 2 颗任意骰顶 1 格（消耗 4 冥想骰）', () => {
    const g = mkGame(['010', '002', '030'], ['001', '002', '003']);
    arm(g, 'A', '010', 'left'); // 真实之剑
    arm(g, 'A', '030', 'left'); // 寰宇飞升（第三列已激活）
    g.players.A.life = g.players.A.lifeMax - 20;
    g.players.A.areas.meditation = [die('m1', 1, 'meditation'), die('m2', 2, 'meditation'), die('m3', 3, 'meditation')];
    g.players.A.areas.attack = [die('a1', 4, 'attack')];
    g.players.A.areas.defense = [die('d1', 5, 'defense')];
    const before = g.players.A.life;
    applyAction(g, {
      t: 'skill',
      artifactId: '030',
      side: 'only',
      params: {
        // 3 格真冥想 + 1 格置换（2 颗任意骰）
        costSlots: [{ dieIds: ['m1'] }, { dieIds: ['m2'] }, { dieIds: ['m3'] }, { dieIds: ['a1', 'd1'] }],
      },
    });
    expect(g.players.A.areas.meditation.length).toBe(0);
    expect(g.players.A.areas.attack.length).toBe(3); // 新得 3 攻击骰
    expect(g.players.A.areas.defense.length).toBe(3); // 新得 3 防御骰
    expect(g.players.A.life).toBe(before + 10);
    expect(g.players.A.artifacts.find((a) => a.id === '030')!.continuousLost).toBe(true);
    expect(logs(g)).toContain('真实之剑');
  });

  it('010 × 028 抵挡：防守方用真实之剑置换出“攻击骰位”抵挡「陨落」的攻击', () => {
    const g = mkGame(['028', '029', '030'], ['010', '002', '003']);
    arm(g, 'B', '010', 'left'); // 防守方 B 的 真实之剑
    g.tianfa.A = { blockKind: 'attack', value: 6, damageCount: 0 };
    g.players.A.areas.attack = [die('a1', 1, 'attack')];
    g.players.B.areas.meditation = [die('bm1', 4, 'meditation'), die('bm2', 5, 'meditation')];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    const before = g.players.B.life;
    // 用 2 颗任意骰置换出 1 个“攻击骰位”抵挡（028 陨落只能用攻击骰抵挡）
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['bm1', 'bm2'] }] });
    expect(g.players.B.life).toBe(before); // 抵挡成功，无伤害
    expect(g.pendingAttack).toBeNull();
    expect(logs(g)).toContain('真实之剑');
  });
});

describe('§19-②/③ 重掷（027 / 额外重掷）× 029 全知', () => {
  it('027 × 029：重掷者受等量真实伤害，且随后弹出「全知」分配待决策', () => {
    const g = mkGame(['028', '029', '027'], ['001', '002', '003']);
    arm(g, 'A', '029', 'left');
    g.rerollPunish.A = true; // 视为已充能「凛冽之音」
    g.phase = 'reroll';
    g.activePlayer = 'A';
    g.rerollUsed = 0;
    g.players.A.areas.meditation = [die('x1', 1, 'meditation'), die('x2', 2, 'meditation')];
    const before = g.players.A.life;
    applyAction(g, { t: 'reroll', dieIds: ['x1', 'x2'] });
    expect(g.players.A.life).toBe(before - 2); // 027：被重掷方受 2 真实伤害
    expect(g.pending?.kind).toBe('quanzhiAssign');
  });

  it('额外重掷阶段（013 雷暴）× 029：额外阶段重掷同样触发「全知」分配', () => {
    const g = mkGame(['013', '029', '030'], ['001', '002', '003']);
    arm(g, 'A', '013', 'right'); // 013 雷暴·持续
    arm(g, 'A', '029', 'left');
    // B 重掷 → A 的雷暴触发（在 B 的重掷阶段结束时）
    g.phase = 'reroll';
    g.activePlayer = 'B';
    g.rerollUsed = 0;
    g.players.B.areas.meditation = [die('bx', 1, 'meditation')];
    applyAction(g, { t: 'reroll', dieIds: ['bx'] });
    applyAction(g, { t: 'advance' }); // 离开重掷阶段 → 触发 A 的雷暴
    expect(g.pending?.kind).toBe('leibaoReroll');
    applyAction(g, { t: 'leibaoReroll', accept: true });
    expect(g.extraReroll?.player).toBe('A');
    expect(g.activePlayer).toBe('A');
    expect(g.phase).toBe('reroll');
    // A 在额外重掷阶段重掷 → 全知分配待决策
    g.players.A.areas.meditation = [die('ax', 2, 'meditation')];
    applyAction(g, { t: 'reroll', dieIds: ['ax'] });
    expect(g.pending?.kind).toBe('quanzhiAssign');
  });
});

describe('FAQ 028 跨卡联动', () => {
  it('28.1.1：攻击点数「视为 6」会影响「幽冥-冥界行走」的回血（为 6 → 受 3 真实伤害）', () => {
    const g = mkGame(['028', '017', '030'], ['001', '002', '003']);
    arm(g, 'A', '017', 'right'); // 017 冥界行走·持续
    g.tianfa.A = { blockKind: 'meditation', value: 6, damageCount: 0 };
    g.players.A.areas.attack = [die('a1', 2, 'attack')];
    const lifeA = g.players.A.life;
    const lifeB = g.players.B.life;
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    applyAction(g, { t: 'block' }); // 不抵挡
    expect(g.players.B.life).toBe(lifeB - 6); // 被视为 6 点
    expect(g.players.A.life).toBe(lifeA - 3); // 冥界行走：攻击点数 6 → 3 真实伤害
  });

  it('28.2.1：「陨落」下对方用攻击骰抵挡 = 使用攻击骰 → 触发其「电刑」（在攻击方回合反击）', () => {
    const g = mkGame(['028', '029', '030'], ['013', '002', '003']);
    arm(g, 'B', '013', 'left'); // 013 电刑·触发
    g.tianfa.A = { blockKind: 'attack', value: 6, damageCount: 0 };
    g.players.A.areas.attack = [die('a1', 1, 'attack')];
    g.players.B.areas.attack = [die('ba', 5, 'attack')];
    g.players.B.areas.meditation = [die('bm1', 2, 'meditation'), die('bm2', 3, 'meditation')];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['ba'] }] });
    // B 的 电刑 被触发（由 B 结算，攻击目标是 A）
    expect(g.pending?.kind).toBe('dianxing');
    expect(g.pending?.player).toBe('B');
    const lifeA = g.players.A.life;
    applyAction(g, { t: 'dianxing', dieIds: ['bm1', 'bm2'] });
    // 依次以 1、2、3 点虚拟攻击 A；A 无骰 → 共受 6 点伤害
    for (const v of [1, 2, 3]) {
      expect(g.pendingAttack?.value).toBe(v);
      applyAction(g, { t: 'block' });
    }
    expect(g.players.A.life).toBe(lifeA - 6);
  });
});
