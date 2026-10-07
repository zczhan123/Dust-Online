import { describe, it, expect } from 'vitest';
import {
  createGame,
  applyAction,
  skipInitialReroll,
  getLegalActions,
  beginTurn,
  quanzhiDefaultAssign,
  validateQuanzhiAssign,
} from '../src/core/engine/game';
import { SKILL_HANDLERS } from '../src/core/engine/skills';
import { fxTake } from '../src/core/engine/fx';
import { battleNotes } from '../src/core/engine/battleNotes';
import { effectiveSpeed } from '../src/core/engine/derive';
import { SeededRng } from '../src/core/rng/rng';
import type { DiceKind, GameState, PlayerId } from '../src/core/model/types';

/** A 持 028/029/030（破晓之剑 玛特），B 持 001/002/003（雨中剑圣 空） */
const mateGame = (heroB: [string, string, string] = ['001', '002', '003']): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['028', '029', '030'], heroB });
  skipInitialReroll(g);
  return g;
};

const art = (g: GameState, who: PlayerId, id: string) => g.players[who].artifacts.find((a) => a.id === id)!;
const toMain = (g: GameState): void => {
  let guard = 0;
  while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) applyAction(g, { t: 'advance' });
};
const clear = (g: GameState, who: PlayerId): void => {
  g.players[who].areas.attack = [];
  g.players[who].areas.defense = [];
  g.players[who].areas.meditation = [];
};
const runSkill = (g: GameState, who: PlayerId, id: string, key: string, params: Record<string, unknown> = {}): void => {
  SKILL_HANDLERS[key].run({
    g,
    player: who,
    artifact: art(g, who, id),
    rng: new SeededRng(1),
    params,
    endMainPhase: () => {},
    reportConsumed: () => {},
  });
};

describe('028 天罚（白昼之火 / 陨落）', () => {
  it('激活即写入本回合状态：白昼之火=只能用冥想骰抵挡，陨落=只能用攻击骰抵挡，点数均视为 6', () => {
    const g = mateGame();
    toMain(g);
    runSkill(g, 'A', '028', 'tianfa.bairi');
    expect(g.tianfa.A).toEqual({ blockKind: 'meditation', value: 6, damageCount: 0, key: 'tianfa.bairi' });
    runSkill(g, 'A', '028', 'tianfa.yunluo');
    expect(g.tianfa.A).toEqual({ blockKind: 'attack', value: 6, damageCount: 0, key: 'tianfa.yunluo' });
  });

  it('白昼之火：攻击点数视为 6（与骰面无关），对方只能用冥想骰抵挡', () => {
    const g = mateGame();
    toMain(g);
    g.tianfa.A = { blockKind: 'meditation', value: 6, damageCount: 0, key: 'tianfa.bairi' };
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.attack = [{ id: 'a1', value: 2, kind: 'attack' }];
    g.players.B.areas.defense = [{ id: 'bd', value: 3, kind: 'defense' }];
    g.players.B.areas.meditation = [{ id: 'bm', value: 4, kind: 'meditation' }];

    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g.pendingAttack?.value).toBe(6);
    expect(g.pendingAttack?.baseValue).toBe(6);
    expect(g.pendingAttack?.blockKind).toBe('meditation');
    // 只能用冥想骰抵挡（防御骰不在候选里）；"不抵挡" 始终存在
    expect(getLegalActions(g).filter((a) => a.t === 'block')).toEqual([
      { t: 'block' },
      { t: 'block', costSlots: [{ dieIds: ['bm'] }] },
    ]);
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['bm'] }] });
    expect(g.pendingAttack).toBeNull();
    expect(g.players.B.life).toBe(g.players.B.lifeMax); // 被抵挡，无伤害
  });

  it('陨落：对方用攻击骰抵挡（= “使用攻击骰” 的路径）；若没有则必须显式“不抵挡”并直接受伤', () => {
    const g = mateGame();
    toMain(g);
    g.tianfa.A = { blockKind: 'attack', value: 6, damageCount: 0, key: 'tianfa.yunluo' };
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.attack = [{ id: 'a1', value: 1, kind: 'attack' }];
    g.players.B.areas.attack = [{ id: 'ba', value: 5, kind: 'attack' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(getLegalActions(g).filter((a) => a.t === 'block')).toEqual([
      { t: 'block' },
      { t: 'block', costSlots: [{ dieIds: ['ba'] }] },
    ]);
    const before = g.players.B.life;
    applyAction(g, { t: 'block' }); // 不抵挡
    expect(g.players.B.life).toBe(before - 6);
  });

  it('本回合通过攻击造成 2 次伤害后，立即结束主要阶段', () => {
    const g = mateGame();
    toMain(g);
    g.tianfa.A = { blockKind: 'meditation', value: 6, damageCount: 0, key: 'tianfa.bairi' };
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.attack = [
      { id: 'a1', value: 1, kind: 'attack' },
      { id: 'a2', value: 2, kind: 'attack' },
    ];
    expect(g.activePlayer).toBe('A');
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    applyAction(g, { t: 'block' }); // 造成第 1 次伤害
    expect(g.phase).toBe('main');
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a2'] }] });
    applyAction(g, { t: 'block' }); // 造成第 2 次伤害 → 结束主要阶段
    expect(g.activePlayer).toBe('B');
  });

  it('战斗提示：白昼之火 / 陨落按当前状态登记', () => {
    const g = mateGame();
    toMain(g);
    g.tianfa.A = { blockKind: 'meditation', value: 6, damageCount: 0, key: 'tianfa.bairi' };
    expect(battleNotes(g, 'A')).toContainEqual({
      label: '白昼之火',
      text: '本回合攻击点数视为 6，且对方只能用冥想骰抵挡',
    });
    g.tianfa.A = { blockKind: 'attack', value: 6, damageCount: 0, key: 'tianfa.yunluo' };
    expect(battleNotes(g, 'A')).toContainEqual({
      label: '陨落',
      text: '本回合攻击点数视为 6，且对方只能用攻击骰抵挡',
    });
  });
});

// 028 / A05：生效期间**每次攻击**都弹其技能名（"让对方只能用非防御骰抵挡"的特殊效果）
describe('028 攻击时弹技能名', () => {
  it('白昼之火生效期间攻击 → fxTake 含 {skillFired, tianfa.bairi}', () => {
    const g = mateGame();
    toMain(g);
    g.tianfa.A = { blockKind: 'meditation', value: 6, damageCount: 0, key: 'tianfa.bairi' };
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.attack = [{ id: 'a1', value: 2, kind: 'attack' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(fxTake().some((e) => e.kind === 'skillFired' && e.skillKey === 'tianfa.bairi')).toBe(true);
  });

  it('未发动（tianfa=null）时攻击 → 不发 tianfa 技能名', () => {
    const g = mateGame();
    toMain(g);
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.attack = [{ id: 'a1', value: 2, kind: 'attack' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(
      fxTake().some((e) => e.kind === 'skillFired' && (e.skillKey ?? '').startsWith('tianfa.')),
    ).toBe(false);
  });
});

describe('029 真言（全知 / 神圣干涉）', () => {
  it('全知（持续）：速度 +1', () => {
    const g = mateGame();
    toMain(g);
    const base = effectiveSpeed(g.players.A);
    art(g, 'A', '029').activeMarkerSide = 'left';
    expect(effectiveSpeed(g.players.A)).toBe(base + 1);
  });

  it('全知：补充阶段会弹出「自行分配落区」的待决策，并可解算', () => {
    const g = mateGame();
    g.activePlayer = 'A';
    g.firstRound.A = false;
    art(g, 'A', '029').activeMarkerSide = 'left';
    beginTurn(g);
    expect(g.pending?.kind).toBe('quanzhiAssign');
    const act = getLegalActions(g)[0];
    expect(act.t).toBe('quanzhiAssign');
    applyAction(g, act);
    expect(g.pending).toBeNull();
  });

  it('FAQ 29.1.1：按「防御=同点成对 / 攻击=顺点三连 / 其余冥想」校验分配', () => {
    const g = mateGame();
    clear(g, 'A');
    const specs: [string, number, DiceKind][] = [
      ['d2', 2, 'attack'],
      ['d5a', 5, 'attack'],
      ['d1', 1, 'defense'],
      ['d6', 6, 'defense'],
      ['d3a', 3, 'attack'],
      ['d3b', 3, 'attack'],
      ['d4', 4, 'attack'],
      ['d5b', 5, 'attack'],
    ];
    for (const [id, value, kind] of specs) g.players.A.areas[kind].push({ id, value, kind });
    // FAQ 例：攻击 {4,5,6} / 防御 {3,3} / 冥想 {1,2,5}
    const assign: Record<string, DiceKind> = {
      d4: 'attack', d5b: 'attack', d6: 'attack',
      d3a: 'defense', d3b: 'defense',
      d1: 'meditation', d2: 'meditation', d5a: 'meditation',
    };
    expect(() => validateQuanzhiAssign(g, 'A', assign)).not.toThrow();
    // 防御未成对 → 抛错
    expect(() => validateQuanzhiAssign(g, 'A', { ...assign, d3b: 'meditation' })).toThrow();
    // 攻击区不是顺点三连 → 抛错（2,5,6 非连续）
    expect(() => validateQuanzhiAssign(g, 'A', { ...assign, d4: 'meditation', d2: 'attack' })).toThrow();
    // 默认分配本身必须是合法的
    expect(() => validateQuanzhiAssign(g, 'A', quanzhiDefaultAssign(g.players.A))).not.toThrow();
  });

  it('神圣干涉（FAQ 29.2.1）：最多 3 颗统一改为同一指定点数并移到对应区域，然后回复 3 点生命', () => {
    const g = mateGame();
    toMain(g);
    clear(g, 'A');
    g.players.A.areas.meditation = [
      { id: 'm1', value: 2, kind: 'meditation' },
      { id: 'm2', value: 3, kind: 'meditation' },
      { id: 'm3', value: 4, kind: 'meditation' },
    ];
    g.players.A.life = g.players.A.lifeMax - 10;
    const a = art(g, 'A', '029');
    a.activeMarkerSide = 'right';
    a.armedSide = 'right';
    a.armedTurn = g.turnIndex;
    g.pending = { kind: 'activationResolve', player: 'A', artifactId: '029', side: 'right' };
    const before = g.players.A.life;
    applyAction(g, {
      t: 'skill',
      artifactId: '029',
      side: 'right',
      params: { value: 6, dieIds: ['m1', 'm2', 'm3'] },
    });
    // 全部改为 6 点，且按分布（029：6 → 防御区）
    for (const d of g.players.A.areas.defense) expect(d.value).toBe(6);
    expect(g.players.A.areas.defense.length).toBe(3);
    expect(g.players.A.areas.meditation.length).toBe(0);
    expect(g.players.A.life).toBe(before + 3);
  });

  it('神圣干涉：超过 3 颗抛错', () => {
    const g = mateGame();
    toMain(g);
    clear(g, 'A');
    g.players.A.areas.meditation = [1, 2, 3, 4].map((v) => ({ id: `m${v}`, value: v, kind: 'meditation' as const }));
    expect(() =>
      runSkill(g, 'A', '029', 'zhenyan.ganshe', { value: 6, dieIds: ['m1', 'm2', 'm3', 'm4'] }),
    ).toThrow();
  });

  it('强制分组：冥想区若仍含同点对/顺点则非法（必须继续分配）', () => {
    const g = mateGame();
    clear(g, 'A');
    const specs: [string, number, DiceKind][] = [
      ['a3a', 3, 'attack'],
      ['a3b', 3, 'attack'],
      ['a4', 4, 'attack'],
      ['a5', 5, 'attack'],
      ['a6', 6, 'attack'],
    ];
    for (const [id, value, kind] of specs) g.players.A.areas[kind].push({ id, value, kind });
    // 全冥想 → 剩余含 {3,3} 与 {4,5,6} → 非法
    const allMed: Record<string, DiceKind> = {};
    for (const [id] of specs) allMed[id] = 'meditation';
    expect(() => validateQuanzhiAssign(g, 'A', allMed)).toThrow();
    // 只放攻击 {4,5,6}、把成对的 {3,3} 丢冥想 → 非法
    expect(() =>
      validateQuanzhiAssign(g, 'A', {
        a4: 'attack', a5: 'attack', a6: 'attack', a3a: 'meditation', a3b: 'meditation',
      }),
    ).toThrow();
    // 防御 {3,3} + 攻击 {4,5,6}、剩余空 → 合法
    expect(() =>
      validateQuanzhiAssign(g, 'A', {
        a3a: 'defense', a3b: 'defense', a4: 'attack', a5: 'attack', a6: 'attack',
      }),
    ).not.toThrow();
  });

  it('强制分组：骰面本就无可分组时，全冥想合法（如 1,3,5）', () => {
    const g = mateGame();
    clear(g, 'A');
    g.players.A.areas.attack = [1, 3, 5].map((v) => ({ id: `m${v}`, value: v, kind: 'attack' as const }));
    expect(() =>
      validateQuanzhiAssign(g, 'A', { m1: 'meditation', m3: 'meditation', m5: 'meditation' }),
    ).not.toThrow();
  });
});

describe('030 救赎（寰宇飞升）', () => {
  it('持续（双向）：双方各自回合的第一次攻击伤害 +3，第二次不再加成', () => {
    const g = mateGame();
    toMain(g);
    art(g, 'A', '030').activeMarkerSide = 'left';
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.attack = [{ id: 'a1', value: 1, kind: 'attack' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g.pendingAttack?.bonusValue).toBe(3);
    expect(g.pendingAttack?.value).toBe(4);
    applyAction(g, { t: 'block' });
    // 第二次攻击（本回合）不再 +3
    g.players.A.areas.attack = [{ id: 'a2', value: 1, kind: 'attack' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a2'] }] });
    expect(g.pendingAttack?.bonusValue).toBe(0);
  });

  it('持续（双向）：持有者不是当前玩家时，对方首攻同样 +3', () => {
    const g = mateGame();
    toMain(g);
    art(g, 'A', '030').activeMarkerSide = 'left';
    g.activePlayer = 'B';
    g.attacksThisTurn.B = 0;
    clear(g, 'A');
    clear(g, 'B');
    g.players.B.areas.attack = [{ id: 'b1', value: 2, kind: 'attack' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['b1'] }] });
    expect(g.pendingAttack?.bonusValue).toBe(3);
    expect(g.pendingAttack?.value).toBe(5);
  });

  it('必杀：消耗 4 冥想骰 → 3 攻击骰 + 3 防御骰 → 回复 10 → 失去持续式', () => {
    const g = mateGame();
    toMain(g);
    clear(g, 'A');
    g.players.A.areas.meditation = [1, 2, 3, 4].map((v) => ({ id: `m${v}`, value: v, kind: 'meditation' as const }));
    g.players.A.life = g.players.A.lifeMax - 20;
    const a = art(g, 'A', '030');
    a.activeMarkerSide = 'left';
    const before = g.players.A.life;
    runSkill(g, 'A', '030', 'jiushu.huanyu.ultimate', {
      costSlots: [1, 2, 3, 4].map((v) => ({ dieIds: [`m${v}`] })),
    });
    expect(g.players.A.areas.meditation.length).toBe(0);
    expect(g.players.A.areas.attack.length).toBe(3);
    expect(g.players.A.areas.defense.length).toBe(3);
    expect(g.players.A.life).toBe(before + 10);
    expect(a.continuousLost).toBe(true);
    // 失去持续后再攻击 → 无 +3
    g.attacksThisTurn.A = 0;
    clear(g, 'A');
    g.players.A.areas.attack = [{ id: 'x1', value: 1, kind: 'attack' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['x1'] }] });
    expect(g.pendingAttack?.bonusValue).toBe(0);
  });

  it('必杀：冥想骰不足 4 颗时不出现在合法动作里', () => {
    const g = mateGame();
    toMain(g);
    clear(g, 'A');
    g.players.A.areas.meditation = [1, 2, 3].map((v) => ({ id: `m${v}`, value: v, kind: 'meditation' as const }));
    art(g, 'A', '030').activeMarkerSide = 'left';
    const offered = getLegalActions(g).some((x) => x.t === 'skill' && x.artifactId === '030');
    expect(offered).toBe(false);
  });
});
