import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll, getLegalActions } from '../src/core/engine/game';
import type { GameState, PlayerId } from '../src/core/model/types';

/** A 持 022/023/024（黑枪 希瓦），B 持 004/005/006（永暗之刃 影） */
const xivaGame = (heroB: [string, string, string] = ['004', '005', '006']): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['022', '023', '024'], heroB });
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
const until = (g: GameState, pred: () => boolean, max = 60): void => {
  let i = 0;
  while (!pred() && i++ < max && g.phase !== 'gameOver') {
    if (g.pending?.kind === 'chenaiFreeRise') applyAction(g, { t: 'chenaiFreeRise', accept: false });
    else applyAction(g, { t: 'advance' });
  }
};
const atA = (g: GameState, phase: GameState['phase']) => () => g.activePlayer === 'A' && g.phase === phase;
const allDice = (g: GameState, who: PlayerId) => [
  ...g.players[who].areas.attack,
  ...g.players[who].areas.defense,
  ...g.players[who].areas.meditation,
];

describe('022 死契（填弹 / 处刑通牒）', () => {
  it('「填弹」：消耗 1–6 颗；≥2 颗必须顺点（不回绕）；计数 +X 且上限 6', () => {
    // 顺点 3-4-5 → 计数 +3
    const g = xivaGame();
    toMain(g);
    activate(g, 'A', '022', 'left');
    const card = art(g, 'A', '022');
    g.players.A.areas.attack = [
      { id: 'a3', value: 3, kind: 'attack' },
      { id: 'a4', value: 4, kind: 'attack' },
      { id: 'a5', value: 5, kind: 'attack' },
    ];
    g.players.A.areas.defense = [];
    g.players.A.areas.meditation = [];
    applyAction(g, { t: 'skill', artifactId: '022', side: 'left', params: { dieIds: ['a3', 'a4', 'a5'] } });
    expect(card.count).toBe(3);
    expect(allDice(g, 'A').length).toBe(0);

    // 非法组合（同一回合内、且不改变状态）：不顺点 / 回绕 / 0 颗 / 7 颗 / 重复 id
    const g2 = xivaGame();
    toMain(g2);
    activate(g2, 'A', '022', 'left');
    const card2 = art(g2, 'A', '022');
    g2.players.A.areas.attack = [5, 6, 1, 2, 3].map((v, i) => ({ id: `x${i}`, value: v, kind: 'attack' as const }));
    g2.players.A.areas.defense = [{ id: 'd2', value: 2, kind: 'defense' }];
    const before = allDice(g2, 'A').length;
    // 2 与 6 不顺点
    expect(() =>
      applyAction(g2, { t: 'skill', artifactId: '022', side: 'left', params: { dieIds: ['x1', 'd2'] } }),
    ).toThrow();
    // 5-6-1-2-3（回绕）不是顺点
    expect(() =>
      applyAction(g2, {
        t: 'skill',
        artifactId: '022',
        side: 'left',
        params: { dieIds: ['x0', 'x1', 'x2', 'x3', 'x4'] },
      }),
    ).toThrow();
    // 0 颗 / 7 颗 / 重复
    expect(() => applyAction(g2, { t: 'skill', artifactId: '022', side: 'left', params: { dieIds: [] } })).toThrow();
    expect(() =>
      applyAction(g2, {
        t: 'skill',
        artifactId: '022',
        side: 'left',
        params: { dieIds: ['x0', 'x1', 'x2', 'x3', 'x4', 'd2', 'x0'] },
      }),
    ).toThrow();
    expect(allDice(g2, 'A').length).toBe(before);
    expect(card2.count).toBe(0);
    // 单颗无顺点要求 → 合法
    applyAction(g2, { t: 'skill', artifactId: '022', side: 'left', params: { dieIds: ['d2'] } });
    expect(card2.count).toBe(1);
  });

  it('FAQ 22.1.1：一次消耗 6 个顺点骰 → 经「灵能脉冲·触发」造成 6 点真实伤害', () => {
    // A 持 022（一列）+ 011（二列，含灵能脉冲触发）+ 015（三列）
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['022', '011', '015'], heroB: ['001', '002', '003'] });
    skipInitialReroll(g);
    toMain(g);
    activate(g, 'A', '022', 'left');
    activate(g, 'A', '011', 'right'); // 灵能脉冲·触发在该侧
    g.players.A.areas.attack = [1, 2, 3, 4, 5, 6].map((v) => ({ id: `k${v}`, value: v, kind: 'attack' as const }));
    const life = g.players.B.life;
    applyAction(g, {
      t: 'skill',
      artifactId: '022',
      side: 'left',
      params: { dieIds: ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'] },
    });
    expect(art(g, 'A', '022').count).toBe(6);
    // 022 消耗 6 颗 → 011 灵能脉冲·触发 → 6 点真实伤害
    expect(g.pending?.kind).toBe('dunwuPulse');
    applyAction(g, { t: 'dunwuPulse', accept: true });
    expect(g.players.B.life).toBe(life - 6);
  });

  it('「处刑通牒」：使用攻击骰前必须先决定（优先于抵挡与「灵能屏障」）；① 不可抵挡、② +5（与既有加成取最大）', () => {
    const g = xivaGame();
    toMain(g);
    activate(g, 'A', '022', 'right'); // 处刑通牒·触发
    const card = art(g, 'A', '022');
    card.count = 3;
    g.players.A.areas.attack = [{ id: 'atk', value: 2, kind: 'attack' }];
    g.players.B.areas.defense = [{ id: 'bd', value: 3, kind: 'defense' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['atk'] }] });
    // 攻击被挂起 → 先问处刑通牒（FAQ 22.2.1）
    expect(g.pending?.kind).toBe('sijiChuxing');
    expect(g.pendingAttack).toBeNull();
    // ① 不可抵挡：B 无法用防御骰抵挡
    applyAction(g, { t: 'chuxingPick', pick: 'unblockable' });
    expect(card.count).toBe(2);
    expect(g.pendingAttack?.unblockable).toBe(true);
    expect(g.pendingAttack?.value).toBe(3); // 2 点攻击 + max(0,1) = 3
    const opts = getLegalActions(g);
    expect(opts.some((a) => a.t === 'block' && a.costSlots)).toBe(false);
    const life = g.players.B.life;
    applyAction(g, { t: 'block' });
    expect(g.players.B.life).toBe(life - 3);

    // ② +5：与既有加成取最大（FAQ 22.2.2）
    g.players.A.buffs.push({ attr: 'attackDamage', add: 4, duration: 'thisTurn', source: '测试' });
    g.players.A.areas.attack = [{ id: 'atk2', value: 1, kind: 'attack' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['atk2'] }] });
    expect(g.pending?.kind).toBe('sijiChuxing');
    applyAction(g, { t: 'chuxingPick', pick: 'bonus5' }); // 既有 +4 与 +5 取最大 → 5
    expect(g.pendingAttack?.value).toBe(6); // 1 + 5
    expect(g.pendingAttack?.unblockable).toBe(false);
    applyAction(g, { t: 'block' });
  });

  it('「处刑通牒」：计数为 0 时不再询问；不发动则计数不变、攻击照常', () => {
    const g = xivaGame();
    toMain(g);
    activate(g, 'A', '022', 'right');
    const card = art(g, 'A', '022');
    card.count = 0;
    g.players.A.areas.attack = [{ id: 'a1', value: 2, kind: 'attack' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g.pending).toBeNull();
    expect(g.pendingAttack).not.toBeNull(); // 直接进入攻击结算
    applyAction(g, { t: 'block' });

    // 不发动：计数不变
    card.count = 2;
    g.players.A.areas.attack = [{ id: 'a2', value: 2, kind: 'attack' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a2'] }] });
    expect(g.pending?.kind).toBe('sijiChuxing');
    applyAction(g, { t: 'chuxingPick', pick: 'none' });
    expect(card.count).toBe(2);
    expect(g.pendingAttack?.unblockable).toBe(false);
    applyAction(g, { t: 'block' });
  });
});

describe('023 蛇蝎（畏惧 / 共振）', () => {
  const weijuSetup = (): GameState => {
    const g = xivaGame();
    toMain(g);
    activate(g, 'A', '023', 'left');
    g.players.A.areas.meditation = [{ id: 'my', value: 5, kind: 'meditation' }];
    g.players.B.areas.attack = [{ id: 'theirs', value: 2, kind: 'attack' }];
    return g;
  };

  it('FAQ 23.1.1/23.2.1：我先消耗 → 对方看着点数再消耗 → 对方较小则其下回合攻击伤害减半（含 1 视为大于 6）', () => {
    const g = weijuSetup();
    applyAction(g, { t: 'skill', artifactId: '023', side: 'left', params: { dieId: 'my' } });
    expect(g.pending?.kind).toBe('weijuPay');
    expect(g.pending && g.pending.kind === 'weijuPay' ? g.pending.player : null).toBe('B');
    // 对方消耗 2 点（< 5）→ 其下个回合攻击伤害减半
    applyAction(g, { t: 'weijuPay', dieId: 'theirs' });
    expect(g.players.B.attackHalvedNextTurn).toBe(true);

    // 回到 B 的回合：B 攻击 → 伤害减半（floor）
    toMain(g);
    applyAction(g, { t: 'advance' }); // A 结束回合
    until(g, () => g.activePlayer === 'B' && g.phase === 'main');
    g.players.B.areas.attack.push({ id: 'b-atk', value: 5, kind: 'attack' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['b-atk'] }] });
    expect(g.pendingAttack?.value).toBe(2); // floor(5/2)
    expect(g.pendingAttack?.halveReason).toBe('畏惧');
    applyAction(g, { t: 'block' });
    // B 的回合结束时清除（FAQ：即使没攻击/被抵挡也不保留）
    applyAction(g, { t: 'advance' });
    expect(g.players.B.attackHalvedNextTurn).toBe(false);
  });

  it('FAQ 23.2.1：1 点视为大于 6 点（1 比 6 时 1 胜；1 比其他仍败）', () => {
    // 我 6 点、对方 1 点 → 对方（1）较大 → 不生效
    const g = weijuSetup();
    g.players.A.areas.meditation = [{ id: 'my', value: 6, kind: 'meditation' }];
    g.players.B.areas.attack = [{ id: 'theirs', value: 1, kind: 'attack' }];
    applyAction(g, { t: 'skill', artifactId: '023', side: 'left', params: { dieId: 'my' } });
    applyAction(g, { t: 'weijuPay', dieId: 'theirs' });
    expect(g.players.B.attackHalvedNextTurn).toBe(false);

    // 我 1 点、对方 6 点 → 对方较小 → 生效
    const g2 = weijuSetup();
    g2.players.A.areas.meditation = [{ id: 'my', value: 1, kind: 'meditation' }];
    g2.players.B.areas.attack = [{ id: 'theirs', value: 6, kind: 'attack' }];
    applyAction(g2, { t: 'skill', artifactId: '023', side: 'left', params: { dieId: 'my' } });
    applyAction(g2, { t: 'weijuPay', dieId: 'theirs' });
    expect(g2.players.B.attackHalvedNextTurn).toBe(true);
  });

  it('对方没有能力骰时「畏惧」不能发动（按钮不出现 + 引擎抛错）', () => {
    const g = xivaGame();
    toMain(g);
    activate(g, 'A', '023', 'left');
    g.players.A.areas.meditation = [{ id: 'my', value: 3, kind: 'meditation' }];
    g.players.B.areas.attack = [];
    g.players.B.areas.defense = [];
    g.players.B.areas.meditation = [];
    const offered = getLegalActions(g).some(
      (a) => a.t === 'skill' && a.artifactId === '023' && a.side === 'left',
    );
    expect(offered).toBe(false);
    expect(() =>
      applyAction(g, { t: 'skill', artifactId: '023', side: 'left', params: { dieId: 'my' } }),
    ).toThrow();
  });

  it('「共振」：重掷并落区 → ① 双方各得 2 颗该类型；② 双方各弃置 2 颗（由发起者选择）', () => {
    const g = xivaGame();
    toMain(g);
    activate(g, 'A', '023', 'right');
    g.players.A.areas.meditation = [{ id: 'my', value: 2, kind: 'meditation' }];
    g.players.B.areas.meditation = [
      { id: 'b1', value: 1, kind: 'meditation' },
      { id: 'b2', value: 4, kind: 'meditation' },
      { id: 'b3', value: 6, kind: 'meditation' },
    ];
    applyAction(g, { t: 'skill', artifactId: '023', side: 'right', params: { dieId: 'my' } });
    expect(g.pending?.kind).toBe('gongzhenPick');
    const kind = g.pending && g.pending.kind === 'gongzhenPick' ? g.pending.areaKind : 'meditation';
    const aBefore = g.players.A.areas[kind].length;
    const bBefore = g.players.B.areas[kind].length;
    // ① 双方各获得 2 个该类型随机骰
    applyAction(g, { t: 'gongzhenResolve', pick: 'gain' });
    expect(g.players.A.areas[kind].length).toBe(aBefore + 2);
    expect(g.players.B.areas[kind].length).toBe(bBefore + 2);

    // ② 双方各弃置 2 颗（发起者选择；不足则尽可能）
    const g2 = xivaGame();
    toMain(g2);
    activate(g2, 'A', '023', 'right');
    g2.players.A.areas.meditation = [
      { id: 'a1', value: 2, kind: 'meditation' },
      { id: 'a2', value: 3, kind: 'meditation' },
    ];
    g2.players.B.areas.meditation = [
      { id: 'b1', value: 1, kind: 'meditation' },
      { id: 'b2', value: 4, kind: 'meditation' },
    ];
    applyAction(g2, { t: 'skill', artifactId: '023', side: 'right', params: { dieId: 'a1' } });
    expect(g2.pending?.kind).toBe('gongzhenPick');
    const kind2 = g2.pending && g2.pending.kind === 'gongzhenPick' ? g2.pending.areaKind : 'meditation';
    const myIds = g2.players.A.areas[kind2].slice(0, 2).map((d) => d.id);
    const oppIds = g2.players.B.areas[kind2].slice(0, 2).map((d) => d.id);
    const aCount = g2.players.A.areas[kind2].length;
    const bCount = g2.players.B.areas[kind2].length;
    applyAction(g2, { t: 'gongzhenResolve', pick: 'discard', myIds, oppIds });
    expect(g2.players.A.areas[kind2].length).toBe(Math.max(0, aCount - 2));
    expect(g2.players.B.areas[kind2].length).toBe(Math.max(0, bCount - 2));
  });
});

describe('024 狂舞（凶弹业舞）', () => {
  it('充能：每次充能都弹出强制选择（把任意玩家 1 颗骰移到该玩家另一区域，保留点数）', () => {
    const g = xivaGame();
    const card = art(g, 'A', '024');
    until(g, atA(g, 'dustRise'));
    // 第 1 次充能（0/4）
    g.players.A.areas.meditation.push({ id: 'med', value: 4, kind: 'meditation' });
    applyAction(g, { t: 'dustRise', artifactId: '024', costSlots: [{ dieIds: ['med'] }] });
    expect(g.pending?.kind).toBe('chargeResolve');
    expect(card.chargeLayer).toBe(1);
    // 选择：把 B 的 1 颗攻击骰移到 B 的冥想骰区
    g.players.B.areas.attack = [{ id: 'bx', value: 6, kind: 'attack' }];
    applyAction(g, {
      t: 'skill',
      artifactId: '024',
      side: 'only',
      params: { owner: 'opponent', dieId: 'bx', toKind: 'meditation' },
    });
    expect(g.players.B.areas.meditation.some((d) => d.id === 'bx' && d.value === 6)).toBe(true);
    expect(g.players.B.areas.attack.some((d) => d.id === 'bx')).toBe(false);
  });

  it('FAQ 24.1.1：必杀按顺时针旋转 6 个区域的骰子（可跨玩家），复现该例分布', () => {
    const g = xivaGame();
    toMain(g);
    const card = art(g, 'A', '024');
    card.chargeLayer = 4;
    card.activeMarkerSide = 'left';
    card.armedSide = 'left';
    // 我：防 1、攻 4、冥 2；对方：冥 0、攻 0、防 3
    g.players.A.areas.defense = [{ id: 'md', value: 2, kind: 'defense' }];
    g.players.A.areas.attack = [1, 2, 3, 4].map((v) => ({ id: `ma${v}`, value: v, kind: 'attack' as const }));
    g.players.A.areas.meditation = [5, 6].map((v) => ({ id: `mm${v}`, value: v, kind: 'meditation' as const }));
    g.players.B.areas.meditation = [];
    g.players.B.areas.attack = [];
    g.players.B.areas.defense = [1, 2, 3].map((v) => ({ id: `bd${v}`, value: v, kind: 'defense' as const }));

    applyAction(g, {
      t: 'skill',
      artifactId: '024',
      side: 'only',
      params: {
        direction: 'cw',
        groups: [
          ['mm5', 'mm6'], // 我冥想 2 颗 → 我攻击
          ['ma1', 'ma2', 'ma3'], // 我攻击 3 颗（4 选 3）→ 我防御
          ['md'], // 我防御 1 颗 → 对方冥想
          [], // 对方冥想 0 颗
          [], // 对方攻击 0 颗
          ['bd1', 'bd2', 'bd3'], // 对方防御 3 颗 → 我冥想
        ],
      },
    });
    expect(g.players.B.areas.meditation.length).toBe(1); // 得到我的防御骰
    expect(g.players.B.areas.attack.length).toBe(0);
    expect(g.players.B.areas.defense.length).toBe(0);
    expect(g.players.A.areas.defense.length).toBe(3); // 我的攻击骰 3 颗
    expect(g.players.A.areas.attack.length).toBe(3); // 我的冥想骰 2 + 剩下的 1 颗攻击骰? （见下）
    expect(g.players.A.areas.meditation.length).toBe(3); // 对方防御骰 3 颗
    // 我的攻击区：原本 4 颗，移走 3 颗 → 剩 1 颗；再接收我的 2 颗冥想骰 → 3 颗
    expect(g.players.A.areas.attack.map((d) => d.id).sort()).toEqual(['ma4', 'mm5', 'mm6']);
  });

  it('024 必杀每局仅一次（ultimatesUsed）', () => {
    const g = xivaGame();
    toMain(g);
    const card = art(g, 'A', '024');
    card.chargeLayer = 4;
    card.activeMarkerSide = 'left';
    applyAction(g, { t: 'skill', artifactId: '024', side: 'only', params: { direction: 'cw', groups: [[], [], [], [], [], []] } });
    expect(g.ultimatesUsed).toContain('kuangwu.ultimate');
    expect(getLegalActions(g).some((a) => a.t === 'skill' && a.artifactId === '024')).toBe(false);
  });
});

describe('010 真实之剑 × 023 畏惧（置换「消耗 1 颗任意能力骰」）', () => {
  it('用 2 颗任意能力骰置换 1 颗，点数视为 5', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['010', '023', '024'], heroB: ['004', '005', '006'] });
    skipInitialReroll(g);
    toMain(g);
    activate(g, 'A', '010', 'left'); // 真实之剑·持续
    activate(g, 'A', '023', 'left'); // 畏惧·启动
    g.players.A.areas.attack = [{ id: 'a1', value: 2, kind: 'attack' }];
    g.players.A.areas.defense = [{ id: 'a2', value: 3, kind: 'defense' }];
    g.players.A.areas.meditation = [];
    g.players.B.areas.attack = [{ id: 'bd', value: 4, kind: 'attack' }];
    applyAction(g, { t: 'skill', artifactId: '023', side: 'left', params: { costSlots: [{ dieIds: ['a1', 'a2'] }] } });
    expect(g.pending?.kind).toBe('weijuPay');
    expect(g.pending && g.pending.kind === 'weijuPay' ? g.pending.initiatorValue : null).toBe(5);
    expect(g.players.A.areas.attack).toHaveLength(0);
    expect(g.players.A.areas.defense).toHaveLength(0);
  });
});
