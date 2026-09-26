import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll, getLegalActions } from '../src/core/engine/game';
import { ARTIFACTS } from '../src/core/content/artifacts';
import { battleNotes } from '../src/core/engine/battleNotes';
import { skillActive, hasActiveSkill } from '../src/core/engine/skill-state';
import { totalDice, effectiveSpeed, effectiveWill } from '../src/core/engine/derive';
import type { GameState, PlayerId } from '../src/core/model/types';

/** A 持 A07 完杀（异相版 006，第三列）+ 001（第一列）+ 002（第二列）；B 持 004/005/006 */
const gA07 = (heroA: [string, string, string] = ['001', '002', 'A07']): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA, heroB: ['004', '005', '006'] });
  skipInitialReroll(g);
  return g;
};

const art = (g: GameState, who: PlayerId, id: string) => g.players[who].artifacts.find((a) => a.id === id)!;

const toMain = (g: GameState): void => {
  let guard = 0;
  while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) applyAction(g, { t: 'advance' });
};

/** 让 A07 处于「已激活」状态（第三列 side='only'，任意非空激活侧即可） */
const armA07 = (g: GameState, side: 'left' | 'right' = 'left'): void => {
  const a = art(g, 'A', 'A07');
  a.activeMarkerSide = side;
  a.armedSide = side;
  a.armedTurn = g.turnIndex;
};

/** 清空 A 的能力骰，只保留 k 点攻击骰；清空 B 防御区，放 m 颗防御骰（id 为 d0..） */
const setAttackAndDefense = (g: GameState, k: number, m: number): void => {
  const a = g.players.A;
  a.areas.defense = [];
  a.areas.meditation = [];
  a.areas.attack = Array.from({ length: k }, (_, i) => ({ id: `a${i}`, value: 1, kind: 'attack' as const }));
  g.players.B.areas.defense = Array.from({ length: m }, (_, i) => ({ id: `d${i}`, value: 1, kind: 'defense' as const }));
};

/** 从 getLegalActions 中精确取出 A07 的必杀动作（无则 undefined） */
const findA07 = (g: GameState) =>
  getLegalActions(g).find((x) => x.t === 'skill' && x.artifactId === 'A07');

describe('A07 完杀（异相）·内容数据守卫', () => {
  it('name 完杀 / 戒指 / 第三列 / life 50 / chargeReq 2；技能精确匹配', () => {
    expect(ARTIFACTS['A07'].id).toBe('A07');
    expect(ARTIFACTS['A07'].name).toBe('完杀');
    expect(ARTIFACTS['A07'].weapon).toBe('戒指');
    expect(ARTIFACTS['A07'].column).toBe(3);
    expect(ARTIFACTS['A07'].life).toBe(50);
    expect(ARTIFACTS['A07'].chargeReq).toBe(2);
    expect(ARTIFACTS['A07'].skills).toEqual([
      { side: 'only', kind: 'charge', key: 'wansha.alt.charge' },
      { side: 'only', kind: 'ultimate', key: 'wansha.alt.ultimate' },
    ]);
  });
});

describe('A07「历王之血之印」充能（异相）', () => {
  it('完成一次充能 → 防御区新增 1 颗点数=充能层数的防御骰（值=2）', () => {
    const g = gA07();
    expect(g.phase).toBe('dustRise');
    expect(g.activePlayer).toBe('A');
    const card = art(g, 'A', 'A07');
    card.chargeLayer = 1; // chargeReq 2 → 下一次尘起即完成
    g.players.A.areas.meditation = [{ id: 'm0', value: 4, kind: 'meditation' }];
    const defBefore = g.players.A.areas.defense.length;
    const atkBefore = g.players.A.areas.attack.length;

    applyAction(g, { t: 'dustRise', artifactId: 'A07', costSlots: [{ dieIds: ['m0'] }] });

    expect(card.chargeLayer).toBe(2);
    expect(card.activeMarkerSide).toBe('left');
    expect(g.players.A.areas.attack.length).toBe(atkBefore);
    expect(g.players.A.areas.defense.length).toBe(defBefore + 1);
    const gained = g.players.A.areas.defense[g.players.A.areas.defense.length - 1]!;
    expect(gained.kind).toBe('defense');
    expect(gained.value).toBe(2);
  });

  it('对照基础 006：充能获得的是攻击骰（点数=充能层数）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '006'], heroB: ['004', '005', '006'] });
    skipInitialReroll(g);
    const card = g.players.A.artifacts.find((a) => a.id === '006')!;
    card.chargeLayer = 3; // 基础 006 chargeReq 4
    g.players.A.areas.meditation = [{ id: 'm0', value: 4, kind: 'meditation' }];
    const defBefore = g.players.A.areas.defense.length;
    const atkBefore = g.players.A.areas.attack.length;

    applyAction(g, { t: 'dustRise', artifactId: '006', costSlots: [{ dieIds: ['m0'] }] });

    expect(card.chargeLayer).toBe(4);
    expect(g.players.A.areas.attack.length).toBe(atkBefore + 1);
    expect(g.players.A.areas.defense.length).toBe(defBefore);
    const gained = g.players.A.areas.attack[atkBefore]!;
    expect(gained.kind).toBe('attack');
    expect(gained.value).toBe(4);
  });
});

describe('A07 必杀门槛（对方防御骰数 ≥ 你攻击骰数才能启动）', () => {
  const setup = (k: number, m: number): GameState => {
    const g = gA07();
    toMain(g);
    armA07(g);
    setAttackAndDefense(g, k, m);
    return g;
  };

  it('m ≥ k 时提供；m < k 时不提供', () => {
    expect(findA07(setup(1, 3))).toBeTruthy();
    expect(findA07(setup(2, 2))).toBeTruthy();
    expect(findA07(setup(3, 2))).toBeUndefined();
    expect(findA07(setup(1, 0))).toBeUndefined();
  });

  it('m > k 时默认 params.opponentDefenseDieIds = 前 (m−k) 颗对方防御骰', () => {
    const g = setup(1, 3);
    expect(findA07(g)).toEqual({
      t: 'skill',
      artifactId: 'A07',
      side: 'only',
      params: { opponentDefenseDieIds: ['d0', 'd1'] },
    });
  });
});

describe('A07 必杀结算（弃差额，发起者选）', () => {
  const setup = (k: number, m: number): GameState => {
    const g = gA07();
    toMain(g);
    armA07(g);
    setAttackAndDefense(g, k, m);
    return g;
  };

  it('m > k：按 params.opponentDefenseDieIds 指定弃置 m−k 颗（只弃合法 id）', () => {
    const g = setup(1, 3);
    applyAction(g, { t: 'skill', artifactId: 'A07', side: 'only', params: { opponentDefenseDieIds: ['d1', 'd2'] } });
    // 3 − 1 = 2 颗被弃，指定的 d1/d2 被弃，剩 d0
    expect(g.players.B.areas.defense.map((d) => d.id)).toEqual(['d0']);
    expect(g.ultimatesUsed).toContain('A:wansha.alt.ultimate');
    expect(g.skillsUsedThisTurn).toContain('A:wansha.alt.ultimate');
  });

  it('m == k：弃 0 颗但仍生效（持续失效已挂上，必杀记录已用）', () => {
    const g = setup(2, 2);
    applyAction(g, { t: 'skill', artifactId: 'A07', side: 'only' });
    expect(g.players.B.areas.defense.map((d) => d.id)).toEqual(['d0', 'd1']);
    expect(art(g, 'A', 'A07').continuousLostThisTurn).toBe(true);
    expect(g.ultimatesUsed).toContain('A:wansha.alt.ultimate');
  });

  it('m < k：不可执行——getLegalActions 不提供，直接 applyAction 抛错且不改状态', () => {
    const g = setup(3, 1);
    expect(findA07(g)).toBeUndefined();
    const defBefore = g.players.B.areas.defense.map((d) => d.id);
    const atkBefore = g.players.A.areas.attack.map((d) => d.id);
    expect(() => applyAction(g, { t: 'skill', artifactId: 'A07', side: 'only' })).toThrow();
    expect(g.players.B.areas.defense.map((d) => d.id)).toEqual(defBefore);
    expect(g.players.A.areas.attack.map((d) => d.id)).toEqual(atkBefore);
    expect(art(g, 'A', 'A07').continuousLostThisTurn ?? false).toBe(false);
    expect(g.ultimatesUsed).not.toContain('A:wansha.alt.ultimate');
    expect(g.skillsUsedThisTurn).not.toContain('A:wansha.alt.ultimate');
  });
});

describe('A07 必杀：直到本回合结束前双方所有持续式效果失效', () => {
  /** A07 激活 + A 的 002「万象」（持续）激活 + B 的 004「锋芒」（持续）激活 */
  const setup = (): GameState => {
    const g = gA07();
    toMain(g);
    armA07(g);
    art(g, 'A', '002').activeMarkerSide = 'left'; // youlong.wanxiang（持续）
    art(g, 'B', '004').activeMarkerSide = 'right'; // buxiang.fengmang（持续）
    setAttackAndDefense(g, 1, 2);
    return g;
  };

  it('执行后：双方所有神器的持续技能 skillActive 为 false（含 A 自己与 B 的）', () => {
    const g = setup();
    expect(hasActiveSkill(g.players.A, 'youlong.wanxiang')).toBe(true);
    expect(hasActiveSkill(g.players.B, 'buxiang.fengmang')).toBe(true);

    applyAction(g, { t: 'skill', artifactId: 'A07', side: 'only', params: { opponentDefenseDieIds: ['d0'] } });

    for (const id of ['A', 'B'] as PlayerId[]) {
      for (const a of g.players[id].artifacts) {
        for (const s of a.skills) {
          if (s.kind === 'continuous') expect(skillActive(a, s)).toBe(false);
        }
      }
    }
    expect(hasActiveSkill(g.players.A, 'youlong.wanxiang')).toBe(false);
    expect(hasActiveSkill(g.players.B, 'buxiang.fengmang')).toBe(false);
  });

  it('回合开始后恢复：continuousLostThisTurn 清零、持续技能重新生效', () => {
    const g = setup();
    applyAction(g, { t: 'skill', artifactId: 'A07', side: 'only', params: { opponentDefenseDieIds: ['d0'] } });
    expect(art(g, 'A', 'A07').continuousLostThisTurn).toBe(true);

    // A 的主要阶段结束（A 仅 1 颗骰，未超意志上限）→ 进入 B 回合，beginTurn 清除临时标记
    applyAction(g, { t: 'advance' });
    expect(g.activePlayer).toBe('B');
    expect(art(g, 'A', 'A07').continuousLostThisTurn).toBe(false);
    expect(art(g, 'A', '002').continuousLostThisTurn).toBe(false);
    expect(art(g, 'B', '004').continuousLostThisTurn).toBe(false);
    expect(hasActiveSkill(g.players.A, 'youlong.wanxiang')).toBe(true);
    expect(hasActiveSkill(g.players.B, 'buxiang.fengmang')).toBe(true);
  });
});

describe('A07 必杀：提醒（已移至 globalHint，不进 battleNotes）', () => {
  it('执行前后 battleNotes 都不含「历王之血之印」（改由 globalHint 常驻横幅承载）', () => {
    const g = gA07();
    toMain(g);
    armA07(g);
    setAttackAndDefense(g, 1, 2);

    expect(battleNotes(g, 'A').some((n) => n.label === '历王之血之印')).toBe(false);

    applyAction(g, { t: 'skill', artifactId: 'A07', side: 'only', params: { opponentDefenseDieIds: ['d0'] } });
    expect(art(g, 'A', 'A07').continuousLostThisTurn).toBe(true);
    expect(battleNotes(g, 'A').some((n) => n.label === '历王之血之印')).toBe(false);
  });
});

describe('§19：A07 无骰代价、与 010 / 034 支付来源无关', () => {
  it('必杀动作不含 costSlots；持 010 真实之剑发动也不消耗 / 置换任何骰', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['010', '002', 'A07'], heroB: ['004', '005', '006'] });
    skipInitialReroll(g);
    toMain(g);
    armA07(g);
    setAttackAndDefense(g, 1, 3);

    const action = findA07(g);
    expect(action).toBeTruthy();
    expect(action).toMatchObject({
      t: 'skill',
      artifactId: 'A07',
      side: 'only',
      params: { opponentDefenseDieIds: ['d0', 'd1'] },
    });
    // 无支付步骤：params 里没有 costSlots
    expect(action?.t === 'skill' ? action.params?.costSlots ?? null : 'n/a').toBeNull();

    const totalBefore = totalDice(g.players.A);
    applyAction(g, action!);
    expect(totalDice(g.players.A)).toBe(totalBefore); // 010 置换未被触发
    expect(g.players.B.areas.defense.map((d) => d.id)).toEqual(['d2']);
  });
});

describe('A07 持续失效：速度 / 意志 的持续加成也被去掉', () => {
  it('万丈明光（速度+3 / 意志+2）在失效期归零', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '035', 'A07'], heroB: ['004', '005', '006'] });
    skipInitialReroll(g);
    g.phase = 'main';
    g.pending = null;
    g.pendingAttack = null;
    const w = art(g, 'A', '035');
    w.activeMarkerSide = 'left'; // 万丈明光（持续：速度+3、意志+2）
    w.armedSide = 'left';
    expect(effectiveSpeed(g.players.A)).toBe(7); // 基础 4 + 3
    expect(effectiveWill(g.players.A)).toBe(9); // 基础 7 + 2

    for (const id of ['A', 'B'] as const) {
      for (const a of g.players[id].artifacts) a.continuousLostThisTurn = true;
    }
    expect(effectiveSpeed(g.players.A)).toBe(4);
    expect(effectiveWill(g.players.A)).toBe(7);
  });
});
