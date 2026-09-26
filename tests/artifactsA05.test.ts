import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll } from '../src/core/engine/game';
import { ARTIFACTS } from '../src/core/content/artifacts';
import { battleNotes } from '../src/core/engine/battleNotes';
import { attackDamageBonus, doAttack, resolveBlock } from '../src/core/engine/combat';
import type { GameState, PlayerId } from '../src/core/model/types';

/** A 持 A05（异相版 028 天罚）+ 029（第二列）+ 030（第三列）；B 持 004/005/006 */
const gA05 = (): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['A05', '029', '030'], heroB: ['004', '005', '006'] });
  skipInitialReroll(g);
  return g;
};

/** 对照用：A 持基础 028 天罚（与 A05 同列、同搭配） */
const g028 = (): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['028', '029', '030'], heroB: ['004', '005', '006'] });
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

/** 把神器装填到某侧并强制结算其「激活」（等价于一次尘起装填 + 立即强制结算） */
const activate = (g: GameState, who: PlayerId, id: string, side: 'left' | 'right'): void => {
  const a = art(g, who, id);
  a.activeMarkerSide = side;
  a.armedSide = side;
  a.armedTurn = g.turnIndex;
  g.pending = { kind: 'activationResolve', player: who, artifactId: id, side };
  applyAction(g, { t: 'skill', artifactId: id, side });
};

describe('A05 天罚（异相）·内容数据守卫', () => {
  it('技能精确匹配（左右激活）；第一列、大剑、速度4、意志7、名称天罚', () => {
    expect(ARTIFACTS['A05'].id).toBe('A05');
    expect(ARTIFACTS['A05'].name).toBe('天罚');
    expect(ARTIFACTS['A05'].weapon).toBe('大剑');
    expect(ARTIFACTS['A05'].column).toBe(1);
    expect(ARTIFACTS['A05'].speed).toBe(4);
    expect(ARTIFACTS['A05'].will).toBe(7);
    expect(ARTIFACTS['A05'].skills).toEqual([
      { side: 'left', kind: 'activation', key: 'tianfa.alt.shenkong' },
      { side: 'right', kind: 'activation', key: 'tianfa.alt.yunluo' },
    ]);
  });
});

describe('A05 激活（无固定值）', () => {
  it('深空之火（左）：blockKind=meditation、damageCount=0，且 value 未设（无“视为6”）', () => {
    const g = gA05();
    toMain(g);
    activate(g, 'A', 'A05', 'left');
    expect(g.tianfa.A).toEqual({ blockKind: 'meditation', damageCount: 0 });
    expect(g.tianfa.A?.value).toBeUndefined();
    expect(Object.keys(g.tianfa.A!).sort()).toEqual(['blockKind', 'damageCount']);
  });

  it('陨落（右）：blockKind=attack、damageCount=0，且 value 未设', () => {
    const g = gA05();
    toMain(g);
    activate(g, 'A', 'A05', 'right');
    expect(g.tianfa.A).toEqual({ blockKind: 'attack', damageCount: 0 });
    expect(g.tianfa.A?.value).toBeUndefined();
    expect(Object.keys(g.tianfa.A!).sort()).toEqual(['blockKind', 'damageCount']);
  });
});

describe('A05 攻击点数不再视为 6，改为伤害 +3', () => {
  it('4 点攻击骰 + 激活深空之火 → 攻击点数 7（不是 6）、blockKind=meditation、加成 3（深空之火）', () => {
    const g = gA05();
    toMain(g);
    activate(g, 'A', 'A05', 'left');
    clear(g, 'A');
    g.players.A.areas.attack = [{ id: 'a4', value: 4, kind: 'attack' }];
    doAttack(g, 'A', [{ dieIds: ['a4'] }]);
    expect(g.pendingAttack?.baseValue).toBe(4);
    expect(g.pendingAttack?.value).toBe(7);
    expect(g.pendingAttack?.blockKind).toBe('meditation');
    expect(attackDamageBonus(g, 'A')).toEqual({ value: 3, label: '深空之火' });
  });

  it('陨落同样只加伤害、不固定点数', () => {
    const g = gA05();
    toMain(g);
    activate(g, 'A', 'A05', 'right');
    clear(g, 'A');
    g.players.A.areas.attack = [{ id: 'a4', value: 4, kind: 'attack' }];
    doAttack(g, 'A', [{ dieIds: ['a4'] }]);
    expect(g.pendingAttack?.baseValue).toBe(4);
    expect(g.pendingAttack?.value).toBe(7);
    expect(g.pendingAttack?.blockKind).toBe('attack');
    expect(attackDamageBonus(g, 'A')).toEqual({ value: 3, label: '陨落' });
  });

  it('黄金法则：另有更大的攻击加成（+5）时取 5，而非与 +3 叠加为 8', () => {
    const g = gA05();
    toMain(g);
    activate(g, 'A', 'A05', 'left');
    g.players.A.buffs.push({ attr: 'attackDamage', add: 5, duration: 'thisTurn', source: '测试加成' });
    expect(attackDamageBonus(g, 'A')).toEqual({ value: 5, label: '测试加成' });
    clear(g, 'A');
    g.players.A.areas.attack = [{ id: 'a4', value: 4, kind: 'attack' }];
    doAttack(g, 'A', [{ dieIds: ['a4'] }]);
    expect(g.pendingAttack?.value).toBe(9);
  });
});

describe('A05 抵挡骰类型限制', () => {
  it('深空之火：只能用冥想骰抵挡；用防御骰抛错且状态不变，改用冥想骰则抵挡成功', () => {
    const g = gA05();
    toMain(g);
    activate(g, 'A', 'A05', 'left');
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.attack = [{ id: 'a4', value: 4, kind: 'attack' }];
    g.players.B.areas.defense = [{ id: 'bd', value: 3, kind: 'defense' }];
    g.players.B.areas.meditation = [{ id: 'bm', value: 4, kind: 'meditation' }];
    doAttack(g, 'A', [{ dieIds: ['a4'] }]);

    expect(() => resolveBlock(g, [{ dieIds: ['bd'] }])).toThrow();
    // 非法动作不得改变状态：攻击仍未结算、防御骰仍在原区域
    expect(g.pendingAttack).not.toBeNull();
    expect(g.players.B.areas.defense.map((d) => d.id)).toEqual(['bd']);

    const life = g.players.B.life;
    resolveBlock(g, [{ dieIds: ['bm'] }]);
    expect(g.pendingAttack).toBeNull();
    expect(g.players.B.life).toBe(life);
    expect(g.players.B.areas.meditation).toEqual([]);
  });

  it('陨落：只能用攻击骰抵挡；用防御骰抛错，改用攻击骰则抵挡成功', () => {
    const g = gA05();
    toMain(g);
    activate(g, 'A', 'A05', 'right');
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.attack = [{ id: 'a4', value: 4, kind: 'attack' }];
    g.players.B.areas.defense = [{ id: 'bd', value: 3, kind: 'defense' }];
    g.players.B.areas.attack = [{ id: 'ba', value: 5, kind: 'attack' }];
    doAttack(g, 'A', [{ dieIds: ['a4'] }]);

    expect(() => resolveBlock(g, [{ dieIds: ['bd'] }])).toThrow();
    expect(g.pendingAttack).not.toBeNull();

    const life = g.players.B.life;
    resolveBlock(g, [{ dieIds: ['ba'] }]);
    expect(g.pendingAttack).toBeNull();
    expect(g.players.B.life).toBe(life);
    expect(g.players.B.areas.attack).toEqual([]);
  });
});

describe('A05 造成 2 次伤害后立即结束主要阶段', () => {
  it('damageCount 随造成伤害累加：0 → 1 → 2（直接结算，尚未触发主阶段收尾）', () => {
    const g = gA05();
    toMain(g);
    activate(g, 'A', 'A05', 'left');
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.attack = [
      { id: 'a1', value: 1, kind: 'attack' },
      { id: 'a2', value: 2, kind: 'attack' },
    ];
    expect(g.tianfa.A?.damageCount).toBe(0);
    doAttack(g, 'A', [{ dieIds: ['a1'] }]);
    resolveBlock(g); // 第 1 次伤害（未抵挡）
    expect(g.tianfa.A?.damageCount).toBe(1);
    doAttack(g, 'A', [{ dieIds: ['a2'] }]);
    resolveBlock(g); // 第 2 次伤害
    expect(g.tianfa.A?.damageCount).toBe(2);
  });

  it('两次攻击造成伤害后经 applyAction 收尾 → 立即结束主要阶段、回合交给 B（战报登记）', () => {
    const g = gA05();
    toMain(g);
    activate(g, 'A', 'A05', 'left');
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.attack = [
      { id: 'a1', value: 1, kind: 'attack' },
      { id: 'a2', value: 2, kind: 'attack' },
    ];
    expect(g.activePlayer).toBe('A');
    expect(g.phase).toBe('main');

    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    applyAction(g, { t: 'block' }); // 第 1 次伤害
    expect(g.tianfa.A?.damageCount).toBe(1);
    expect(g.phase).toBe('main');
    expect(g.activePlayer).toBe('A');

    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a2'] }] });
    applyAction(g, { t: 'block' }); // 第 2 次伤害 → 立即结束主要阶段
    expect(g.activePlayer).toBe('B');
    expect(g.phase).not.toBe('main');
    expect(
      g.log.some(
        (e) => e.text.includes('天罚') && e.text.includes('2 次伤害') && e.text.includes('立即结束主要阶段'),
      ),
    ).toBe(true);
  });

  it('被抵挡时伤害为 0，不计入 damageCount（2 次判定只算真正造成伤害）', () => {
    const g = gA05();
    toMain(g);
    activate(g, 'A', 'A05', 'left');
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.attack = [{ id: 'a4', value: 4, kind: 'attack' }];
    g.players.B.areas.meditation = [{ id: 'bm', value: 6, kind: 'meditation' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a4'] }] });
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['bm'] }] });
    expect(g.tianfa.A?.damageCount).toBe(0);
    expect(g.phase).toBe('main');
    expect(g.activePlayer).toBe('A');
  });
});

describe('A05 战斗提示 battleNotes', () => {
  it('未激活时无天罚条目', () => {
    const g = gA05();
    toMain(g);
    expect(g.activePlayer).toBe('A');
    const labels = battleNotes(g, 'A').map((n) => n.label);
    expect(labels).toEqual([]);
    for (const name of ['深空之火', '陨落', '白昼之火']) expect(labels).not.toContain(name);
  });

  it('深空之火：登记攻击伤害 +3 与“只能用冥想骰抵挡 / 2 次伤害结束主要阶段”', () => {
    const g = gA05();
    toMain(g);
    activate(g, 'A', 'A05', 'left');
    const notes = battleNotes(g, 'A');
    expect(notes).toContainEqual({ label: '深空之火', text: '攻击伤害 +3' });
    expect(notes).toContainEqual({
      label: '深空之火',
      text: '本回合对方只能用冥想骰抵挡；你造成 2 次伤害后立即结束主要阶段',
    });
  });

  it('陨落：登记攻击伤害 +3 与“只能用攻击骰抵挡 / 2 次伤害结束主要阶段”', () => {
    const g = gA05();
    toMain(g);
    activate(g, 'A', 'A05', 'right');
    const notes = battleNotes(g, 'A');
    expect(notes).toContainEqual({ label: '陨落', text: '攻击伤害 +3' });
    expect(notes).toContainEqual({
      label: '陨落',
      text: '本回合对方只能用攻击骰抵挡；你造成 2 次伤害后立即结束主要阶段',
    });
  });
});

describe('A05 对照基础 028', () => {
  it('基础 028 白昼之火仍写入固定值 value=6（证明 A05 去掉了固定值）', () => {
    const g = g028();
    toMain(g);
    activate(g, 'A', '028', 'left');
    expect(g.tianfa.A).toEqual({ blockKind: 'meditation', value: 6, damageCount: 0 });
  });
});
