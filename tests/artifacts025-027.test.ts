import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll, getLegalActions, canUseHanguang } from '../src/core/engine/game';
import type { GameState, PlayerId } from '../src/core/model/types';

/** A 持 025/026/027（天狱的战鬼 李封），B 持 004/005/006（永暗之刃 影） */
const lifengGame = (heroB: [string, string, string] = ['004', '005', '006']): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['025', '026', '027'], heroB });
  skipInitialReroll(g);
  return g;
};

const art = (g: GameState, who: PlayerId, id: string) => g.players[who].artifacts.find((a) => a.id === id)!;
const activate = (g: GameState, who: PlayerId, id: string, side: 'left' | 'right'): void => {
  const a = art(g, who, id);
  a.activeMarkerSide = side;
  a.armedSide = side;
  a.armedTurn = g.turnIndex;
};
const toMain = (g: GameState): void => {
  let guard = 0;
  while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) {
    if (g.pending?.kind === 'chargeResolve') break;
    applyAction(g, { t: 'advance' });
  }
};
/** 推进到指定玩家的重掷阶段（会自然跳过其第一回合没有重掷的阶段） */
const toReroll = (g: GameState, who: PlayerId): void => {
  let guard = 0;
  while (!(g.activePlayer === who && g.phase === 'reroll') && guard++ < 80 && g.phase !== 'gameOver') {
    applyAction(g, { t: 'advance' });
  }
};
const allDice = (g: GameState, who: PlayerId) => [
  ...g.players[who].areas.attack,
  ...g.players[who].areas.defense,
  ...g.players[who].areas.meditation,
];

describe('025 屠虎（奇袭 / 横贯）', () => {
  it('FAQ 25.1.1：奇袭可把「点数不在对方任意区域」的防御骰视为攻击骰；对方失去该点数后另一颗也可', () => {
    const g = lifengGame();
    toMain(g);
    activate(g, 'A', '025', 'left');
    g.players.A.areas.attack = [];
    g.players.A.areas.defense = [
      { id: 'd5', value: 5, kind: 'defense' },
      { id: 'd6', value: 6, kind: 'defense' },
    ];
    g.players.A.areas.meditation = [];
    g.players.B.areas.attack = [];
    g.players.B.areas.defense = [{ id: 'bd6', value: 6, kind: 'defense' }];
    g.players.B.areas.meditation = [];

    // 对方没有 5 点 → 5 点防御骰可视为攻击骰；对方有 6 点 → 6 点暂不可
    const attackOpts = getLegalActions(g).filter((a) => a.t === 'attack');
    expect(attackOpts).toEqual([{ t: 'attack', costSlots: [{ dieIds: ['d5'], treated: true }] }]);

    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['d5'], treated: true }] });
    expect(g.pendingAttack).not.toBeNull();
    expect(g.pendingAttack?.value).toBe(5);
    expect(g.pendingAttack?.bonusValue).toBe(0);
    expect(g.pendingAttack?.sourceValue).toBe(5);

    // B 用 6 点防御骰抵挡后，对方已无 6 点能力骰 → 6 点防御骰也可以视为攻击骰
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['bd6'] }] });
    expect(g.pending).toBeNull();
    const attackOpts2 = getLegalActions(g).filter((a) => a.t === 'attack');
    expect(attackOpts2).toEqual([{ t: 'attack', costSlots: [{ dieIds: ['d6'], treated: true }] }]);
  });

  it('FAQ 25.1.1 边界：对方区域存在该点数时不可视为；未激活奇袭时也不可（非法动作不改状态）', () => {
    const g = lifengGame();
    toMain(g);
    activate(g, 'A', '025', 'left');
    g.players.A.areas.attack = [];
    g.players.A.areas.defense = [{ id: 'd5', value: 5, kind: 'defense' }];
    g.players.A.areas.meditation = [];
    g.players.B.areas.attack = [{ id: 'b5', value: 5, kind: 'attack' }];
    g.players.B.areas.defense = [];
    g.players.B.areas.meditation = [];
    expect(() => applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['d5'], treated: true }] })).toThrow();
    expect(allDice(g, 'A').map((d) => d.id)).toEqual(['d5']);
    expect(g.pendingAttack).toBeNull();

    const g2 = lifengGame();
    toMain(g2);
    g2.players.A.areas.attack = [];
    g2.players.A.areas.defense = [{ id: 'd5', value: 5, kind: 'defense' }];
    g2.players.A.areas.meditation = [];
    g2.players.B.areas.attack = [];
    g2.players.B.areas.defense = [];
    g2.players.B.areas.meditation = [];
    expect(() => applyAction(g2, { t: 'attack', costSlots: [{ dieIds: ['d5'], treated: true }] })).toThrow();
    expect(allDice(g2, 'A').map((d) => d.id)).toEqual(['d5']);
    expect(g2.pendingAttack).toBeNull();
  });

  it('横贯（持续·右）：本回合第 2 次攻击 +2（与其它加成同属性取最大）', () => {
    const g = lifengGame();
    toMain(g);
    activate(g, 'A', '025', 'right');
    g.players.A.areas.attack = [
      { id: 'a1', value: 3, kind: 'attack' },
      { id: 'a2', value: 3, kind: 'attack' },
    ];
    g.players.A.areas.defense = [];
    g.players.A.areas.meditation = [];
    g.players.B.areas.attack = [];
    g.players.B.areas.defense = [];
    g.players.B.areas.meditation = [];

    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g.pendingAttack?.value).toBe(3);
    expect(g.pendingAttack?.bonusValue).toBe(0);
    applyAction(g, { t: 'block' });

    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a2'] }] });
    expect(g.pendingAttack?.value).toBe(5);
    expect(g.pendingAttack?.bonusValue).toBe(2);
    expect(g.pendingAttack?.bonusLabel).toBe('横贯');
    applyAction(g, { t: 'block' });

    // 同属性取最大：既有 +5 覆盖横贯的 +2（不是 2+5=7）
    const g2 = lifengGame();
    toMain(g2);
    activate(g2, 'A', '025', 'right');
    g2.players.A.areas.attack = [
      { id: 'b1', value: 3, kind: 'attack' },
      { id: 'b2', value: 3, kind: 'attack' },
    ];
    g2.players.A.areas.defense = [];
    g2.players.A.areas.meditation = [];
    g2.players.B.areas.attack = [];
    g2.players.B.areas.defense = [];
    g2.players.B.areas.meditation = [];
    applyAction(g2, { t: 'attack', costSlots: [{ dieIds: ['b1'] }] });
    applyAction(g2, { t: 'block' });
    g2.players.A.buffs.push({ attr: 'attackDamage', add: 5, duration: 'thisTurn', source: '测试' });
    applyAction(g2, { t: 'attack', costSlots: [{ dieIds: ['b2'] }] });
    expect(g2.pendingAttack?.bonusValue).toBe(5);
    expect(g2.pendingAttack?.value).toBe(8);
    applyAction(g2, { t: 'block' });
  });

  it('FAQ 25.2.1 / 25.2.3：被抵挡后横贯只列点数严格小于「攻击骰点数」的能力骰；不发动无副作用', () => {
    const g = lifengGame();
    toMain(g);
    activate(g, 'A', '025', 'right');
    g.players.A.areas.attack = [{ id: 'a1', value: 3, kind: 'attack' }];
    g.players.A.areas.defense = [];
    g.players.A.areas.meditation = [];
    g.players.B.areas.attack = [{ id: 'b1', value: 1, kind: 'attack' }];
    g.players.B.areas.defense = [{ id: 'bd', value: 6, kind: 'defense' }];
    g.players.B.areas.meditation = [
      { id: 'b2', value: 2, kind: 'meditation' },
      { id: 'b5', value: 5, kind: 'meditation' },
    ];

    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g.pendingAttack?.value).toBe(3);
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['bd'] }] });
    expect(g.pending?.kind).toBe('hengguan');
    expect(g.pending && g.pending.kind === 'hengguan' ? g.pending.value : -1).toBe(3);
    const opts = getLegalActions(g).filter((a) => a.t === 'hengguan');
    expect(opts).toEqual([
      { t: 'hengguan' },
      { t: 'hengguan', dieId: 'b1' },
      { t: 'hengguan', dieId: 'b2' },
    ]);

    // 不发动：双方骰子数量/点数完全不变
    const beforeA = allDice(g, 'A').map((d) => ({ id: d.id, value: d.value }));
    const beforeB = allDice(g, 'B').map((d) => ({ id: d.id, value: d.value }));
    applyAction(g, { t: 'hengguan' });
    expect(g.pending).toBeNull();
    expect(allDice(g, 'A').map((d) => ({ id: d.id, value: d.value }))).toEqual(beforeA);
    expect(allDice(g, 'B').map((d) => ({ id: d.id, value: d.value }))).toEqual(beforeB);
  });

  it('FAQ 25.2.3：横贯比较攻击骰点数、不含伤害修正（攻击 3 点 +2 → 仍只弃置 <3 的骰）', () => {
    const g = lifengGame();
    toMain(g);
    activate(g, 'A', '025', 'right');
    g.players.A.areas.attack = [
      { id: 'pre', value: 1, kind: 'attack' },
      { id: 'a3', value: 3, kind: 'attack' },
    ];
    g.players.A.areas.defense = [];
    g.players.A.areas.meditation = [];
    g.players.B.areas.attack = [{ id: 'b1', value: 1, kind: 'attack' }];
    g.players.B.areas.defense = [{ id: 'bd', value: 6, kind: 'defense' }];
    g.players.B.areas.meditation = [
      { id: 'b2', value: 2, kind: 'meditation' },
      { id: 'b5', value: 5, kind: 'meditation' },
    ];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['pre'] }] });
    applyAction(g, { t: 'block' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a3'] }] });
    expect(g.pendingAttack?.baseValue).toBe(3);
    expect(g.pendingAttack?.value).toBe(5); // 3 + 横贯 2
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['bd'] }] });
    expect(g.pending?.kind).toBe('hengguan');
    expect(g.pending && g.pending.kind === 'hengguan' ? g.pending.value : -1).toBe(3);
    const opts = getLegalActions(g).filter((a) => a.t === 'hengguan');
    expect(opts).toEqual([
      { t: 'hengguan' },
      { t: 'hengguan', dieId: 'b1' },
      { t: 'hengguan', dieId: 'b2' },
    ]);
    applyAction(g, { t: 'hengguan' });
  });

  it('横贯（触发）：对方没有任何点数严格小于该攻击的能力骰时不弹待决策', () => {
    const g = lifengGame();
    toMain(g);
    activate(g, 'A', '025', 'right');
    g.players.A.areas.attack = [{ id: 'a1', value: 3, kind: 'attack' }];
    g.players.A.areas.defense = [];
    g.players.A.areas.meditation = [];
    g.players.B.areas.attack = [{ id: 'b3', value: 3, kind: 'attack' }];
    g.players.B.areas.defense = [{ id: 'bd', value: 6, kind: 'defense' }];
    g.players.B.areas.meditation = [{ id: 'b5', value: 5, kind: 'meditation' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['bd'] }] });
    expect(g.pending).toBeNull();
  });
});

describe('026 哀歌（陷阵 / 威压）', () => {
  it('FAQ 26.1.1：重掷阶段结束弹陷阵（生命最低方选择，并列=当前回合玩家）；弃 1 得另外两类各 1', () => {
    // 双方生命并列 50 → 当前回合玩家 A 选择
    const g = lifengGame();
    toReroll(g, 'A');
    activate(g, 'A', '026', 'left');
    g.players.A.areas.attack = [{ id: 'aAtk', value: 3, kind: 'attack' }];
    g.players.A.areas.defense = [{ id: 'aDef', value: 2, kind: 'defense' }];
    g.players.A.areas.meditation = [{ id: 'aMed', value: 5, kind: 'meditation' }];
    applyAction(g, { t: 'advance' });
    expect(g.pending?.kind).toBe('xianzhenPick');
    expect(g.pending && g.pending.kind === 'xianzhenPick' ? g.pending.player : null).toBe('A');
    expect(g.pending && g.pending.kind === 'xianzhenPick' ? g.pending.owner : null).toBe('A');
    applyAction(g, { t: 'xianzhenResolve', dieId: 'aAtk' });
    expect(g.players.A.areas.attack.map((d) => d.id)).toEqual([]);
    expect(g.players.A.areas.defense.length).toBe(2);
    expect(g.players.A.areas.meditation.length).toBe(2);

    // 对方生命更低 → 由对方（B）选择
    const g2 = lifengGame();
    toReroll(g2, 'A');
    activate(g2, 'A', '026', 'left');
    g2.players.B.life = 40;
    g2.players.A.areas.attack = [{ id: 'bAtk', value: 3, kind: 'attack' }];
    g2.players.A.areas.defense = [];
    g2.players.A.areas.meditation = [];
    applyAction(g2, { t: 'advance' });
    expect(g2.pending?.kind).toBe('xianzhenPick');
    expect(g2.pending && g2.pending.kind === 'xianzhenPick' ? g2.pending.player : null).toBe('B');
    applyAction(g2, { t: 'xianzhenResolve', dieId: 'bAtk' });
    expect(g2.players.A.areas.attack.map((d) => d.id)).toEqual([]);
    expect(g2.players.A.areas.defense.length).toBe(1);
    expect(g2.players.A.areas.meditation.length).toBe(1);
  });

  it('FAQ 26.1.1 边界：重掷阶段结束时持有者没有任何能力骰 → 不弹陷阵，也不获得骰子', () => {
    const g = lifengGame();
    toReroll(g, 'A');
    activate(g, 'A', '026', 'left');
    g.players.A.areas.attack = [];
    g.players.A.areas.defense = [];
    g.players.A.areas.meditation = [];
    applyAction(g, { t: 'advance' });
    expect(g.pending).toBeNull();
    expect(allDice(g, 'A').length).toBe(0);
  });

  it('FAQ 26.2.1：威压先于该骰基础效果结算（攻击已生成时先问威压，此时不能抵挡）', () => {
    const g = lifengGame();
    toMain(g);
    activate(g, 'A', '026', 'right');
    g.players.A.areas.attack = [{ id: 'a1', value: 3, kind: 'attack' }];
    g.players.A.areas.defense = [{ id: 'aDef', value: 2, kind: 'defense' }];
    g.players.A.areas.meditation = [];
    g.players.B.areas.attack = [];
    g.players.B.areas.defense = [{ id: 'bd', value: 4, kind: 'defense' }];
    g.players.B.areas.meditation = [];

    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g.pendingAttack).not.toBeNull();
    expect(g.pending?.kind).toBe('weiyaPick');
    expect(() => applyAction(g, { t: 'block' })).toThrow();

    applyAction(g, { t: 'weiyaPick', owner: 'self', dieId: 'aDef' });
    expect(g.pending).toBeNull();
    expect(g.pendingAttack).not.toBeNull();
    expect(g.players.A.areas.defense).toEqual([{ id: 'aDef', value: 4, kind: 'defense' }]);
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['bd'] }] });
  });

  it('威压：可改对方某颗能力骰为 4；省略 dieId = 不发动；每回合不限次数', () => {
    const g = lifengGame();
    toMain(g);
    activate(g, 'A', '026', 'right');
    g.players.A.areas.attack = [
      { id: 'a1', value: 3, kind: 'attack' },
      { id: 'a2', value: 3, kind: 'attack' },
    ];
    g.players.A.areas.defense = [];
    g.players.A.areas.meditation = [];
    g.players.B.areas.attack = [];
    g.players.B.areas.defense = [{ id: 'bd', value: 1, kind: 'defense' }];
    g.players.B.areas.meditation = [];

    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g.pending?.kind).toBe('weiyaPick');
    applyAction(g, { t: 'weiyaPick', owner: 'opp', dieId: 'bd' });
    expect(g.players.B.areas.defense).toEqual([{ id: 'bd', value: 4, kind: 'defense' }]);
    applyAction(g, { t: 'block' });

    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a2'] }] });
    expect(g.pending?.kind).toBe('weiyaPick');
    const beforeA = allDice(g, 'A').map((d) => ({ id: d.id, value: d.value }));
    const beforeB = allDice(g, 'B').map((d) => ({ id: d.id, value: d.value }));
    applyAction(g, { t: 'weiyaPick', owner: 'self' }); // 不发动
    expect(g.pending).toBeNull();
    expect(allDice(g, 'A').map((d) => ({ id: d.id, value: d.value }))).toEqual(beforeA);
    expect(allDice(g, 'B').map((d) => ({ id: d.id, value: d.value }))).toEqual(beforeB);
    applyAction(g, { t: 'block' });
  });

  it('FAQ 26.2.1 边界：支付后双方都没有任何能力骰 → 不弹威压', () => {
    const g = lifengGame();
    toMain(g);
    activate(g, 'A', '026', 'right');
    g.players.A.areas.attack = [{ id: 'a1', value: 3, kind: 'attack' }];
    g.players.A.areas.defense = [];
    g.players.A.areas.meditation = [];
    g.players.B.areas.attack = [];
    g.players.B.areas.defense = [];
    g.players.B.areas.meditation = [];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g.pending).toBeNull();
    expect(g.pendingAttack).not.toBeNull();
    applyAction(g, { t: 'block' });
  });
});

describe('027 寒光（凛冽之音）', () => {
  it('FAQ 27.1.1 / 27.1.2：充能后任何玩家重掷 2 颗 → 被重掷方受 2 点真实伤害（另一方可不受影响）', () => {
    const g = lifengGame();
    toReroll(g, 'A');
    applyAction(g, { t: 'advance' }); // A 的第 2 个回合：尘起阶段
    g.players.A.areas.meditation.push({ id: 'medA', value: 3, kind: 'meditation' });
    applyAction(g, { t: 'dustRise', artifactId: '027', costSlots: [{ dieIds: ['medA'] }] });
    expect(art(g, 'A', '027').chargeLayer).toBe(1);
    expect(g.rerollPunish.A).toBe(true);

    applyAction(g, { t: 'advance' }); // 主要阶段
    toReroll(g, 'B');
    g.players.B.areas.attack = [
      { id: 'br1', value: 1, kind: 'attack' },
      { id: 'br2', value: 2, kind: 'attack' },
    ];
    g.players.B.areas.defense = [];
    g.players.B.areas.meditation = [];
    const aLife = g.players.A.life;
    const bLife = g.players.B.life;
    applyAction(g, { t: 'reroll', dieIds: ['br1', 'br2'] });
    expect(g.players.B.life).toBe(bLife - 2);
    expect(g.players.A.life).toBe(aLife);
  });

  it('时限（用户场景修正）：惩罚持续到持有者「尘起阶段开始」——其下个回合的**重掷阶段**仍会受伤', () => {
    const g = lifengGame();
    toReroll(g, 'A');
    applyAction(g, { t: 'advance' });
    g.players.A.areas.meditation.push({ id: 'medA', value: 3, kind: 'meditation' });
    applyAction(g, { t: 'dustRise', artifactId: '027', costSlots: [{ dieIds: ['medA'] }] });
    expect(g.rerollPunish.A).toBe(true);
    applyAction(g, { t: 'advance' }); // → A 的主要阶段

    // A 的**下个回合**：这是重掷阶段（在尘起阶段**之前**）→ 惩罚仍在，A 重掷同样受伤
    toReroll(g, 'A');
    expect(g.rerollPunish.A).toBe(true);
    g.players.A.areas.attack = [
      { id: 'ar1', value: 1, kind: 'attack' },
      { id: 'ar2', value: 2, kind: 'attack' },
    ];
    g.players.A.areas.defense = [];
    g.players.A.areas.meditation = [];
    const aLife = g.players.A.life;
    applyAction(g, { t: 'reroll', dieIds: ['ar1', 'ar2'] });
    expect(g.players.A.life).toBe(aLife - 2);

    // 进入 A 的尘起阶段 → 此刻才清除
    applyAction(g, { t: 'advance' });
    expect(g.phase).toBe('dustRise');
    expect(g.rerollPunish.A).toBe(false);
  });

  it('FAQ 27.1.3：必杀取 1–6 各 1 颗；使用攻击骰前弹 hanguangPick 且可 move 落区', () => {
    const g = lifengGame();
    toMain(g);
    const card = art(g, 'A', '027');
    card.chargeLayer = 2;
    card.activeMarkerSide = 'left';
    g.players.A.areas.attack = [{ id: 'a1', value: 2, kind: 'attack' }];
    g.players.A.areas.defense = [];
    g.players.A.areas.meditation = [];
    g.players.B.areas.attack = [];
    g.players.B.areas.defense = [{ id: 'bd', value: 6, kind: 'defense' }];
    g.players.B.areas.meditation = [];

    applyAction(g, { t: 'skill', artifactId: '027', side: 'only' });
    expect(card.heldDice?.map((d) => d.value)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(g.ultimatesUsed).toContain('hanguang.ultimate');
    expect(canUseHanguang(g, 'A')).toBe(true);

    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g.pending?.kind).toBe('hanguangPick');
    applyAction(g, { t: 'hanguangPick', pick: 'move', dieId: '027-held-3' });
    // 3 点按 026 分布落入攻击区；用于攻击的 a1 已被消耗
    expect(g.players.A.areas.attack).toEqual([{ id: '027-held-3', value: 3, kind: 'attack' }]);
    expect(card.heldDice?.map((d) => d.value)).toEqual([1, 2, 4, 5, 6]);
    expect(g.pendingAttack?.value).toBe(2);
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['bd'] }] });
  });

  it('FAQ 27.1.3：必杀 discard 可弃置对方同点数骰（先弃对方唯一防御骰，攻击直接造成伤害）', () => {
    const g = lifengGame();
    toMain(g);
    const card = art(g, 'A', '027');
    card.chargeLayer = 2;
    card.activeMarkerSide = 'left';
    g.players.A.areas.attack = [{ id: 'a1', value: 2, kind: 'attack' }];
    g.players.A.areas.defense = [];
    g.players.A.areas.meditation = [];
    g.players.B.areas.attack = [];
    g.players.B.areas.defense = [{ id: 'bd3', value: 3, kind: 'defense' }];
    g.players.B.areas.meditation = [];
    applyAction(g, { t: 'skill', artifactId: '027', side: 'only' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g.pending?.kind).toBe('hanguangPick');
    applyAction(g, { t: 'hanguangPick', pick: 'discard', dieId: '027-held-3', targetDieId: 'bd3' });
    expect(g.players.B.areas.defense.map((d) => d.id)).toEqual([]);
    expect(card.heldDice?.some((d) => d.id === '027-held-3')).toBe(false);
    expect(g.pendingAttack).not.toBeNull();
    // 对方已无防御骰 → 无法抵挡
    expect(getLegalActions(g).some((a) => a.t === 'block' && a.costSlots)).toBe(false);
    const life = g.players.B.life;
    applyAction(g, { t: 'block' });
    expect(g.players.B.life).toBe(life - 2);
  });

  it('必杀 discard：目标点数不同 → 抛错且不改变状态', () => {
    const g = lifengGame();
    toMain(g);
    const card = art(g, 'A', '027');
    card.chargeLayer = 2;
    card.activeMarkerSide = 'left';
    g.players.A.areas.attack = [{ id: 'a1', value: 2, kind: 'attack' }];
    g.players.A.areas.defense = [];
    g.players.A.areas.meditation = [];
    g.players.B.areas.attack = [];
    g.players.B.areas.defense = [{ id: 'bd5', value: 5, kind: 'defense' }];
    g.players.B.areas.meditation = [];
    applyAction(g, { t: 'skill', artifactId: '027', side: 'only' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g.pending?.kind).toBe('hanguangPick');
    const heldBefore = card.heldDice!.map((d) => d.id);
    expect(() =>
      applyAction(g, { t: 'hanguangPick', pick: 'discard', dieId: '027-held-3', targetDieId: 'bd5' }),
    ).toThrow();
    expect(card.heldDice!.map((d) => d.id)).toEqual(heldBefore);
    expect(g.players.B.areas.defense.map((d) => d.id)).toEqual(['bd5']);
    expect(g.pending?.kind).toBe('hanguangPick');
  });

  it('必杀：神器上的骰用完后不再弹 hanguangPick；回合结束时清空', () => {
    const g = lifengGame();
    toMain(g);
    const card = art(g, 'A', '027');
    card.chargeLayer = 2;
    card.activeMarkerSide = 'left';
    g.players.A.areas.attack = [{ id: 'a1', value: 2, kind: 'attack' }];
    g.players.A.areas.defense = [];
    g.players.A.areas.meditation = [];
    applyAction(g, { t: 'skill', artifactId: '027', side: 'only' });
    expect(card.heldDice?.length).toBe(6);
    card.heldDice = []; // 模拟 6 颗全部用完
    expect(canUseHanguang(g, 'A')).toBe(false);
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g.pending).toBeNull();
    expect(g.pendingAttack).not.toBeNull();
    applyAction(g, { t: 'block' });

    // 未用完也会在回合结束时清空
    const g2 = lifengGame();
    toMain(g2);
    const card2 = art(g2, 'A', '027');
    card2.chargeLayer = 2;
    card2.activeMarkerSide = 'left';
    applyAction(g2, { t: 'skill', artifactId: '027', side: 'only' });
    expect(card2.heldDice?.length).toBe(6);
    applyAction(g2, { t: 'advance' }); // 结束 A 的主要阶段 → 回合结束
    expect(card2.heldDice?.length).toBe(0);
  });

  it('未发动必杀时攻击不弹任何新 pending', () => {
    const g = lifengGame();
    toMain(g);
    g.players.A.areas.attack = [{ id: 'a1', value: 2, kind: 'attack' }];
    g.players.A.areas.defense = [];
    g.players.A.areas.meditation = [];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g.pending).toBeNull();
    expect(g.pendingAttack).not.toBeNull();
    applyAction(g, { t: 'block' });
  });
});

describe('027 寒光·必杀：真实路径（充能 → 按钮 → 发动）', () => {
  it('尘起充能 2 次完成激活后，必杀必须出现在 getLegalActions；发动后神器上有 1–6 各 1 颗', () => {
    const g = lifengGame();
    const card = art(g, 'A', '027');
    const step = (pred: () => boolean, max = 200): void => {
      let i = 0;
      while (!pred() && i++ < max && g.phase !== 'gameOver') applyAction(g, { t: 'advance' });
    };
    const atChargeable = (): boolean => g.activePlayer === 'A' && g.phase === 'dustRise' && !g.dustRiseActed;

    // 第 1 次充能（A 的第一回合尘起阶段）
    step(atChargeable);
    g.players.A.areas.meditation.push({ id: 'cm1', value: 3, kind: 'meditation' });
    applyAction(g, { t: 'dustRise', artifactId: '027', costSlots: [{ dieIds: ['cm1'] }] });
    expect(card.chargeLayer).toBe(1);
    expect(card.activeMarkerSide).toBeNull(); // 未激活

    // 离开本阶段 → 第 2 次充能（A 的下一个尘起阶段）→ 激活
    applyAction(g, { t: 'advance' });
    step(atChargeable);
    expect(g.phase).toBe('dustRise');
    g.players.A.areas.meditation.push({ id: 'cm2', value: 5, kind: 'meditation' });
    applyAction(g, { t: 'dustRise', artifactId: '027', costSlots: [{ dieIds: ['cm2'] }] });
    expect(card.chargeLayer).toBe(2);
    expect(card.activeMarkerSide).not.toBeNull(); // 已激活

    // 进入主要阶段：必杀动作必须已被枚举出来（本次「按钮不出现」bug 的回归点）
    applyAction(g, { t: 'advance' });
    expect(g.phase).toBe('main');
    const offered = getLegalActions(g).some(
      (a) => a.t === 'skill' && a.artifactId === '027' && a.side === 'only',
    );
    expect(offered).toBe(true);

    // 发动必杀 → 取 1–6 点各 1 颗置于本神器上
    applyAction(g, { t: 'skill', artifactId: '027', side: 'only' });
    expect(card.heldDice?.map((d) => d.value)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(g.ultimatesUsed).toContain('hanguang.ultimate');
  });
});

describe('027 凛冽之音 × 其它技能（联动）', () => {
  it('023「共振」由技能产生的重掷同样触发惩罚（谁被重掷谁受伤）', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['025', '026', '027'],
      heroB: ['022', '023', '024'],
    });
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.rerollPunish.A = true; // 等价于 A 已充能 027（本用例只验证"技能产生的重掷"这条路径）
    const b023 = g.players.B.artifacts.find((a) => a.id === '023')!;
    b023.activeMarkerSide = 'right'; // 共振（启动·右）
    g.players.B.areas.meditation = [{ id: 'bm', value: 2, kind: 'meditation' }];
    g.players.B.areas.attack = [];
    g.players.B.areas.defense = [];
    const life = g.players.B.life;
    applyAction(g, { t: 'skill', artifactId: '023', side: 'right', params: { dieId: 'bm' } });
    expect(g.players.B.life).toBe(life - 1); // 重掷 1 颗 → 1 点真实伤害
    expect(g.pending?.kind).toBe('gongzhenPick');
  });
});
describe('026 威压：触发来源与「不算使用」的边界', () => {
  it('尘起支付冥想骰会触发威压（reason=dustRise），结算完成后才落到陷阵侧', () => {
    const g = lifengGame();
    toReroll(g, 'A');
    applyAction(g, { t: 'advance' }); // → A 的尘起阶段
    const card = art(g, 'A', '026');
    card.activeMarkerSide = 'right';
    card.armedSide = 'right';
    g.players.B.areas.attack = [{ id: 'bd', value: 2, kind: 'attack' }]; // 有可改目标
    g.players.A.areas.meditation = [{ id: 'md', value: 3, kind: 'meditation' }];
    applyAction(g, { t: 'dustRise', artifactId: '026', costSlots: [{ dieIds: ['md'] }] });
    expect(g.pending?.kind).toBe('weiyaPick');
    expect(g.pending && g.pending.kind === 'weiyaPick' ? g.pending.reason : null).toBe('dustRise');
    applyAction(g, { t: 'weiyaPick', owner: 'self' }); // 不发动
    expect(card.activeMarkerSide).toBe('left'); // 已切换到陷阵
  });

  it('尘印支付 / 重掷 都不触发威压（不耗骰 或 不算「使用」）', () => {
    // 尘印
    const g = lifengGame();
    toReroll(g, 'A');
    applyAction(g, { t: 'advance' });
    const card = art(g, 'A', '026');
    card.activeMarkerSide = 'right';
    card.armedSide = 'right';
    g.players.B.areas.attack = [{ id: 'bd', value: 2, kind: 'attack' }];
    g.players.A.hasDustSeal = true;
    applyAction(g, { t: 'dustRise', artifactId: '026', useSeal: true });
    expect(g.pending).toBeNull();

    // 重掷
    const g2 = lifengGame();
    toReroll(g2, 'A');
    const card2 = art(g2, 'A', '026');
    card2.activeMarkerSide = 'right';
    g2.players.A.areas.attack = [
      { id: 'x1', value: 1, kind: 'attack' },
      { id: 'x2', value: 2, kind: 'attack' },
    ];
    applyAction(g2, { t: 'reroll', dieIds: ['x1', 'x2'] });
    expect(g2.pending).toBeNull();
  });
});
describe('026 陷阵 × 013 雷暴（额外重掷阶段，待办 §G 修复回归）', () => {
  it('013 插入的额外重掷阶段结束时，同样触发陷阵（并列 → 由重掷者本人选择）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['013', '026', '003'], heroB: ['004', '005', '006'] });
    skipInitialReroll(g);
    art(g, 'A', '013').activeMarkerSide = 'right'; // 雷暴·持续（对方重掷阶段结束时插入额外重掷阶段）
    art(g, 'A', '026').activeMarkerSide = 'left'; // 陷阵·持续
    g.phase = 'reroll';
    g.activePlayer = 'A';
    g.extraReroll = { player: 'A', resume: 'B' }; // 额外重掷阶段归属 A
    g.players.A.areas.meditation = [{ id: 'm1', value: 3, kind: 'meditation' }];
    g.players.A.life = 40;
    g.players.B.life = 40; // 生命并列 → chooser = 重掷者本人

    applyAction(g, { t: 'advance' }); // 结束额外重掷阶段

    expect(g.pending?.kind).toBe('xianzhenPick');
    expect(g.pending && g.pending.kind === 'xianzhenPick' ? g.pending.owner : null).toBe('A');
    expect(g.pending && g.pending.kind === 'xianzhenPick' ? g.pending.player : null).toBe('A');
  });
});

describe('消耗语义（走 paySlots）→ 触发 026 威压（概念一致性修复回归）', () => {
  it('022「填弹」（消耗 1–6 能力骰）会触发 026 威压，reason=skill', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['022', '026', '003'], heroB: ['004', '005', '006'] });
    skipInitialReroll(g);
    toMain(g);
    const fill = art(g, 'A', '022');
    fill.activeMarkerSide = 'left';
    fill.armedSide = 'left';
    fill.armedTurn = g.turnIndex;
    art(g, 'A', '026').activeMarkerSide = 'right'; // 威压（触发）
    g.players.A.areas.attack = [{ id: 'a2', value: 2, kind: 'attack' }];
    g.players.A.areas.defense = [];
    g.players.A.areas.meditation = [];
    g.players.B.areas.defense = [{ id: 'bd1', value: 1, kind: 'defense' }]; // 供威压改点
    applyAction(g, { t: 'skill', artifactId: '022', side: 'left', params: { dieIds: ['a2'] } });
    expect(g.pending?.kind).toBe('weiyaPick');
    expect(g.pending && g.pending.kind === 'weiyaPick' ? g.pending.reason : null).toBe('skill');
  });
});