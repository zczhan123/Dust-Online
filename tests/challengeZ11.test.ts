import { describe, it, expect } from 'vitest';
import { createChallengeGame, applyChallengeSkill, applyAction, skipInitialReroll } from '../src/core/engine/game';
import { matchSlots } from '../src/core/engine/challenge';
import { CHALLENGES, slotPhrase } from '../src/core/content/challenges';
import type { Die, DiceKind, GameState } from '../src/core/model/types';

const die = (id: string, value: number, kind: DiceKind = 'meditation'): Die => ({ id, value, kind });
const Z11 = CHALLENGES.find((c) => c.id === 'Z11')!;
const SK = (id: string) => Z11.skills!.find((s) => s.id === id)!;
const make = (mode: 'manual' | 'favor' | 'against' = 'manual') =>
  createChallengeGame({ seed: 1, cardId: 'Z11', challenger: ['001', '002', '003'], settleMode: mode });
const setA = (g: GameState, areas: { attack?: Die[]; defense?: Die[]; meditation?: Die[] }): void => {
  g.players.A.areas.attack = areas.attack ?? [];
  g.players.A.areas.defense = areas.defense ?? [];
  g.players.A.areas.meditation = areas.meditation ?? [];
};
const setB = (g: GameState, areas: { attack?: Die[]; defense?: Die[] }): void => {
  g.players.B.areas.attack = areas.attack ?? [];
  g.players.B.areas.defense = areas.defense ?? [];
  g.players.B.areas.meditation = [];
};
const vals = (ds: Die[]) => ds.map((d) => d.value);

describe('挑战模式 · Z11 受缚邪灵 · 数据', () => {
  it('生命 40 / 门槛 2 / 上限无 / 投 6 / 计数 7 / 6 条', () => {
    expect(Z11.life).toBe(40);
    expect(Z11.defenseMin).toBe(2);
    expect(Z11.defenseCap).toBeUndefined();
    expect(Z11.rollDice).toBe(6);
    expect(Z11.countCap).toBe(7);
    expect(Z11.artifacts).toEqual(['031', '032', '033']);
    expect(Z11.skills).toHaveLength(6);
    expect(SK('z11-1').marker).toBe('∞');
    expect(SK('z11-2').marker).toBe('∞');
    expect(SK('z11-3').marker).toBe('怜悯*');
    expect(SK('z11-3').slots).toEqual([{ kind: 'distinct', count: 4 }]);
    expect(SK('z11-3').slotChoice).toBe(true);
    expect(SK('z11-4').slots).toEqual([{ kind: 'pips', count: 0, faces: [5, 6], unlimited: true }]);
    expect(SK('z11-5').marker).toBe('∞');
    expect(slotPhrase(SK('z11-3').slots)).toBe('（满足4颗不相同的点数时发动）');
  });

  it('distinct 槽匹配：4 颗互不相同 → 匹配；不同点数不足 4 → 不匹配', () => {
    const slots = [{ kind: 'distinct' as const, count: 4 }];
    expect(matchSlots(slots, [die('a', 1), die('b', 2), die('c', 3), die('d', 5)])).not.toBeNull();
    expect(matchSlots(slots, [die('a', 1), die('b', 1), die('c', 2), die('d', 3)])).toBeNull();
  });
});

describe('挑战模式 · Z11 低语 / 死亡亦逝 / 永恒女王', () => {
  it('低语：5、6 保持不变，其余被重掷（消耗 RNG）', () => {
    const g = make();
    g.challenge!.driven = [die('a', 1), die('b', 2), die('c', 5), die('d', 6), die('e', 4)];
    const rngBefore = g.rngState;
    applyChallengeSkill(g, Z11, SK('z11-1'), []);
    const dv = g.challenge!.driven;
    expect(dv.find((d) => d.id === 'c')!.value).toBe(5); // 5 点不重掷
    expect(dv.find((d) => d.id === 'd')!.value).toBe(6); // 6 点不重掷
    expect(g.rngState).not.toBe(rngBefore); // 重掷消耗了 RNG
    for (const d of dv) expect(d.value).toBeGreaterThanOrEqual(1);
    for (const d of dv) expect(d.value).toBeLessThanOrEqual(6);
  });

  it('死亡亦逝：挑战者抹零到十位、自身回满到十位（非伤害改值）', () => {
    const g = make();
    g.players.A.life = 37;
    g.players.B.life = 33;
    applyChallengeSkill(g, Z11, SK('z11-2'), []);
    expect(g.players.A.life).toBe(30); // floor(37/10)*10
    expect(g.players.B.life).toBe(40); // ceil(33/10)*10，且 ≤ lifeMax 40
  });

  it('永恒女王：补随机防御骰至 3（已有 ≥3 → 不补）', () => {
    const g = make();
    setB(g, { defense: [die('d1', 1, 'defense')] });
    applyChallengeSkill(g, Z11, SK('z11-5'), []);
    expect(g.players.B.areas.defense).toHaveLength(3);

    const g2 = make();
    setB(g2, {
      defense: [die('d1', 1, 'defense'), die('d2', 2, 'defense'), die('d3', 3, 'defense'), die('d4', 4, 'defense')],
    });
    applyChallengeSkill(g2, Z11, SK('z11-5'), []);
    expect(g2.players.B.areas.defense).toHaveLength(4); // 不补
  });
});

describe('挑战模式 · Z11 清算', () => {
  it('弃挑战者 =计数 个能力骰，计数 −1', () => {
    const g = make();
    g.challenge!.count = 3;
    setA(g, {
      attack: [die('a1', 1, 'attack'), die('a2', 2, 'attack')],
      defense: [die('d1', 3, 'defense')],
      meditation: [die('m1', 4, 'meditation'), die('m2', 5, 'meditation')],
    });
    applyChallengeSkill(g, Z11, SK('z11-3'), [die('x1', 1), die('x2', 2), die('x3', 3), die('x4', 4)]);
    const left = g.players.A.areas.attack.length + g.players.A.areas.defense.length + g.players.A.areas.meditation.length;
    expect(left).toBe(2);
    expect(g.challenge!.count).toBe(2);
  });

  it('挑战者能力骰不足 X → 每少 1 个造成 3 点真实伤害', () => {
    const g = make();
    g.challenge!.count = 5;
    setA(g, { attack: [die('a1', 1, 'attack')] });
    const life0 = g.players.A.life;
    applyChallengeSkill(g, Z11, SK('z11-3'), [die('x1', 1), die('x2', 2), die('x3', 3), die('x4', 4)]);
    expect(g.players.A.areas.attack).toHaveLength(0);
    expect(g.players.A.life).toBe(life0 - (5 - 1) * 3); // 4 个缺口 → 12 真伤
    expect(g.challenge!.count).toBe(4);
  });

  it('弃骰方向·不利：先弃冥想（同类先大后小）', () => {
    const g = make('against');
    g.challenge!.count = 2;
    setA(g, {
      attack: [die('a2', 2, 'attack')],
      defense: [die('d5', 5, 'defense')],
      meditation: [die('m1', 1, 'meditation'), die('m6', 6, 'meditation')],
    });
    applyChallengeSkill(g, Z11, SK('z11-3'), [die('x1', 1), die('x2', 2), die('x3', 3), die('x4', 4)]);
    // 不利：冥想优先 → 弃 m6、m1；防/攻原封不动
    expect(g.players.A.areas.meditation).toHaveLength(0);
    expect(g.players.A.areas.defense.map((d) => d.id)).toEqual(['d5']);
    expect(g.players.A.areas.attack.map((d) => d.id)).toEqual(['a2']);
  });

  it('弃骰方向·有利：先弃攻击（同类先小后大）', () => {
    const g = make('favor');
    g.challenge!.count = 2;
    setA(g, {
      attack: [die('a2', 2, 'attack')],
      defense: [die('d5', 5, 'defense')],
      meditation: [die('m1', 1, 'meditation'), die('m6', 6, 'meditation')],
    });
    applyChallengeSkill(g, Z11, SK('z11-3'), [die('x1', 1), die('x2', 2), die('x3', 3), die('x4', 4)]);
    // 有利：攻击 → 防御 → 冥想（反向）→ 弃 a2、d5；冥想全留
    expect(g.players.A.areas.attack).toHaveLength(0);
    expect(g.players.A.areas.defense).toHaveLength(0);
    expect(g.players.A.areas.meditation.map((d) => d.value).sort()).toEqual([1, 6]);
  });

  it('自动（走 wants 循环，不利）：先弃冥想', () => {
    const g = make('against');
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.turn = 2;
    g.challenge!.count = 2;
    g.challenge!.resumeAt = 3; // z11-3 清算
    g.challenge!.driven = [die('a', 1), die('b', 2), die('c', 3), die('d', 4)];
    setA(g, {
      attack: [die('a2', 2, 'attack')],
      defense: [die('d5', 5, 'defense')],
      meditation: [die('m1', 1, 'meditation'), die('m6', 6, 'meditation')],
    });
    applyAction(g, { t: 'challengeStep' });
    expect(g.players.A.areas.meditation).toHaveLength(0); // 不利：冥想优先被弃
    expect(g.players.A.areas.defense.map((d) => d.id)).toEqual(['d5']);
  });
});

describe('挑战模式 · Z11 清算 · distinct 选组（后瞻：少留 5/6 给血祭）', () => {
  const drive = (mode: 'favor' | 'against'): GameState => {
    const g = make(mode);
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.turn = 2;
    g.challenge!.count = 1;
    g.challenge!.resumeAt = 3; // z11-3 清算
    g.challenge!.driven = [die('a', 1), die('b', 2), die('c', 3), die('d', 5), die('e', 6)];
    setA(g, { attack: [die('x', 1, 'attack')] });
    applyAction(g, { t: 'challengeStep' });
    return g;
  };

  it('有利＝吃走含 5、6 的一组（剩最小的 3）', () => {
    const g = drive('favor');
    expect(g.challenge!.driven).toHaveLength(1);
    expect(vals(g.challenge!.driven)).toEqual([3]); // 吃 {1,2,5,6}
  });

  it('不利＝尽量留 5、6（吃 {1,2,3,5}）', () => {
    const g = drive('against');
    expect(g.challenge!.driven).toHaveLength(1);
    expect(vals(g.challenge!.driven)).toEqual([6]); // 吃 {1,2,3,5}
  });
});

describe('挑战模式 · Z11 血祭', () => {
  it('驱动骰（5/6）→ 攻击区、逐颗攻击；每次攻击后计数 +1；造成伤害后自伤 =计数', () => {
    const g = make();
    setA(g, {}); // 挑战者无骰 → 逐段"不抵挡"
    setB(g, {});
    g.players.A.life = 50;
    g.players.B.life = 40;
    g.challenge!.count = 0;
    applyChallengeSkill(g, Z11, SK('z11-4'), [die('d1', 5), die('d2', 6)]);
    expect(g.players.B.areas.attack).toHaveLength(2);
    expect(g.challenge!.xueji).toBe(true);
    expect(g.pendingAttack?.attacker).toBe('B');
    const b0 = g.players.B.life;
    let guard = 0;
    while ((g.pendingAttack || g.virtualQueue) && guard++ < 20) applyAction(g, { t: 'block' });
    // 2 次攻击：计数 0→1、1→2；自伤 1 + 2 = 3
    expect(g.challenge!.count).toBe(2);
    expect(g.players.B.life).toBe(b0 - 3);
    // 这批攻击已结算完 → 批次标记关闭（其后其它攻击不再计入）
    expect(g.challenge!.xueji).toBe(false);
  });
});

describe('挑战模式 · Z11 整回合跑通', () => {
  it('从头驱动整个传奇回合 → 不报错、正常交还（或终局）', async () => {
    const { driveLegendTurn } = await import('./helpers');
    const g = make('favor');
    skipInitialReroll(g);
    expect(g.activePlayer).toBe('B');
    driveLegendTurn(g);
    expect(g.phase === 'gameOver' || g.activePlayer === 'A').toBe(true);
  });
});
