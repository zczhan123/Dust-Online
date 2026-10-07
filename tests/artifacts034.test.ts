import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll, getLegalActions } from '../src/core/engine/game';
import { fxTake } from '../src/core/engine/fx';
import type { GameState, PlayerId } from '../src/core/model/types';

/** A 持 034/002/003（034 第 1 列，002 第 2 列提供分布），B 持 004/005/006 */
const g034 = (): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['034', '002', '003'], heroB: ['004', '005', '006'] });
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
const armLeft = (g: GameState) => {
  const a = art(g, 'A', '034');
  a.activeMarkerSide = 'left';
  a.armedSide = 'left';
  a.armedTurn = g.turnIndex;
};

describe('034 金刚（破障 / 不动菩提）', () => {
  it('激活（两侧同效）：清空存放骰 → 放入 3 个点数互不相同的骰', () => {
    const g = g034();
    toMain(g);
    const a = art(g, 'A', '034');
    a.activeMarkerSide = 'left';
    a.armedSide = 'left';
    a.armedTurn = g.turnIndex;
    g.pending = { kind: 'activationResolve', player: 'A', artifactId: '034', side: 'left' };
    applyAction(g, { t: 'skill', artifactId: '034', side: 'left', params: { pips: [1, 2, 3] } });
    expect(a.heldDice?.map((d) => d.value)).toEqual([1, 2, 3]);
    // 再次激活（模拟另一回合）：清空后放入新的 3 个
    g.skillsUsedThisTurn = [];
    a.armedSide = 'left';
    a.armedTurn = g.turnIndex;
    g.pending = { kind: 'activationResolve', player: 'A', artifactId: '034', side: 'left' };
    applyAction(g, { t: 'skill', artifactId: '034', side: 'left', params: { pips: [4, 5, 6] } });
    expect(a.heldDice?.map((d) => d.value)).toEqual([4, 5, 6]);
  });

  it('激活：3 个点数必须互不相同（否则抛错且不改状态）', () => {
    const g = g034();
    toMain(g);
    const a = art(g, 'A', '034');
    a.activeMarkerSide = 'left';
    a.armedSide = 'left';
    a.armedTurn = g.turnIndex;
    g.pending = { kind: 'activationResolve', player: 'A', artifactId: '034', side: 'left' };
    expect(() =>
      applyAction(g, { t: 'skill', artifactId: '034', side: 'left', params: { pips: [1, 1, 2] } }),
    ).toThrow();
    expect(a.heldDice ?? []).toEqual([]);
  });

  it('破障·持续：神器上的骰可当能力骰使用（类型按第二列分布）——用 3 点存放骰发起攻击', () => {
    const g = g034();
    toMain(g);
    armLeft(g);
    clear(g, 'A');
    clear(g, 'B');
    // 002 分布：攻=3/4 → 3 点存放骰视为攻击骰
    art(g, 'A', '034').heldDice = [{ id: 'h3', value: 3 }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['h3'] }] });
    expect(g.pendingAttack?.value).toBe(3);
    expect(art(g, 'A', '034').heldDice?.length ?? 0).toBe(0);
  });

  it('破障：用神器上的存放骰当能力骰支付 → 发 jingang.pozhang.continuous 事件（供界面弹「破障」）', () => {
    const g = g034();
    toMain(g);
    armLeft(g);
    clear(g, 'A');
    clear(g, 'B');
    art(g, 'A', '034').heldDice = [{ id: 'h3', value: 3 }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['h3'] }] });
    expect(fxTake().some((e) => e.kind === 'skillFired' && e.skillKey === 'jingang.pozhang.continuous')).toBe(true);
  });

  it('破障·持续：未激活破障（切到另一侧）时，存放骰不可当能力骰用', () => {
    const g = g034();
    toMain(g);
    const a = art(g, 'A', '034');
    a.activeMarkerSide = 'right'; // 不动菩提侧 → 破障持续不生效
    clear(g, 'A');
    a.heldDice = [{ id: 'h3', value: 3 }];
    expect(() => applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['h3'] }] })).toThrow();
  });

  it('破障·持续：类型不匹配则不可用（2 点存放骰按分布为冥想 → 不能当攻击骰）', () => {
    const g = g034();
    toMain(g);
    armLeft(g);
    clear(g, 'A');
    art(g, 'A', '034').heldDice = [{ id: 'h2', value: 2 }]; // 002：冥=2/5
    expect(() => applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['h2'] }] })).toThrow();
  });
});

describe('034 金刚·不动菩提（触发：取消对方使用防御/攻击骰的效果）', () => {
  it('对方用防御骰抵挡后，可移除同点数存放骰取消该抵挡 → 攻击照常造成伤害', () => {
    const g = g034();
    toMain(g);
    const a = art(g, 'A', '034');
    a.activeMarkerSide = 'right';
    a.armedSide = 'right';
    a.armedTurn = g.turnIndex;
    a.heldDice = [{ id: 'hv', value: 2 }];
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.attack = [{ id: 'a1', value: 4, kind: 'attack' }];
    g.players.B.areas.defense = [{ id: 'bd', value: 2, kind: 'defense' }];
    const lifeB = g.players.B.life;
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['bd'] }] });
    expect(g.pending?.kind).toBe('putiPick');
    applyAction(g, { t: 'putiResolve', accept: true });
    expect(g.players.B.life).toBe(lifeB - 4);
    expect(a.heldDice?.length ?? 0).toBe(0);
  });

  it('取消攻击 → attackJoin(cancel)；且攻击骰先"停中间"(pendingAttack 保留)', () => {
    const g = g034();
    toMain(g);
    const a = art(g, 'A', '034');
    a.activeMarkerSide = 'right';
    a.armedSide = 'right';
    a.armedTurn = g.turnIndex;
    a.heldDice = [{ id: 'hv', value: 3 }];
    g.activePlayer = 'B';
    clear(g, 'A');
    clear(g, 'B');
    g.players.B.areas.attack = [{ id: 'b1', value: 3, kind: 'attack' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['b1'] }] });
    expect(g.pending?.kind).toBe('putiPick');
    expect(g.pendingAttack).not.toBeNull(); // 攻击骰已停中间（供 034 并排）
    applyAction(g, { t: 'putiResolve', accept: true });
    expect(fxTake()).toContainEqual({ kind: 'attackJoin', player: 'A', mode: 'cancel', dieIds: ['hv'], value: 3 });
  });

  it('取消防御 → 抵挡先"停住"(block.park) + 发动 attackJoin(cancel)', () => {
    const g = g034();
    toMain(g);
    const a = art(g, 'A', '034');
    a.activeMarkerSide = 'right';
    a.armedSide = 'right';
    a.armedTurn = g.turnIndex;
    a.heldDice = [{ id: 'hv', value: 2 }];
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.attack = [{ id: 'a1', value: 4, kind: 'attack' }];
    g.players.B.areas.defense = [{ id: 'bd', value: 2, kind: 'defense' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['bd'] }] });
    expect(g.pending?.kind).toBe('putiPick');
    expect(g.pendingAttack).not.toBeNull(); // 攻击骰保留（停中间）等 034
    expect(fxTake()).toContainEqual({ kind: 'block', player: 'B', dieIds: ['bd'], park: true });
    applyAction(g, { t: 'putiResolve', accept: true });
    expect(fxTake()).toContainEqual({ kind: 'attackJoin', player: 'A', mode: 'cancel', dieIds: ['hv'], value: 2 });
  });

  it('不动菩提·不发动 → 抵挡照常生效（伤害 0）', () => {
    const g = g034();
    toMain(g);
    const a = art(g, 'A', '034');
    a.activeMarkerSide = 'right';
    a.armedSide = 'right';
    a.armedTurn = g.turnIndex;
    a.heldDice = [{ id: 'hv', value: 2 }];
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.attack = [{ id: 'a1', value: 4, kind: 'attack' }];
    g.players.B.areas.defense = [{ id: 'bd', value: 2, kind: 'defense' }];
    const lifeB = g.players.B.life;
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['bd'] }] });
    applyAction(g, { t: 'putiResolve', accept: false });
    expect(g.players.B.life).toBe(lifeB);
    expect(a.heldDice?.length).toBe(1);
  });

  it('对方使用攻击骰后，可移除同点数存放骰取消该攻击', () => {
    const g = g034();
    toMain(g);
    const a = art(g, 'A', '034');
    a.activeMarkerSide = 'right';
    a.heldDice = [{ id: 'hv', value: 3 }];
    g.activePlayer = 'B';
    clear(g, 'A');
    clear(g, 'B');
    g.players.B.areas.attack = [{ id: 'b1', value: 3, kind: 'attack' }];
    const lifeA = g.players.A.life;
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['b1'] }] });
    expect(g.pending?.kind).toBe('putiPick');
    applyAction(g, { t: 'putiResolve', accept: true });
    expect(g.players.A.life).toBe(lifeA);
    expect(g.pendingAttack).toBeNull();
    expect(a.heldDice?.length ?? 0).toBe(0);
  });
});

describe('034 破障：存放骰作为「使用」支付与触发「消耗」的合法动作', () => {
  it('攻击：按分布为攻击的存放骰可作为攻击骰（合法动作 + 结算消耗）', () => {
    const g = g034();
    toMain(g);
    armLeft(g);
    clear(g, 'A');
    art(g, 'A', '034').heldDice = [{ id: 'hd3', value: 3 }]; // 002 分布：3 → 攻击
    clear(g, 'B');
    const legal = getLegalActions(g);
    expect(legal).toContainEqual({ t: 'attack', costSlots: [{ dieIds: ['hd3'] }] });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['hd3'] }] });
    expect(art(g, 'A', '034').heldDice).toHaveLength(0);
    expect(g.pendingAttack?.value).toBe(3);
  });

  it('抵挡：按分布为防御的存放骰可作为抵挡骰', () => {
    const g = g034();
    toMain(g);
    armLeft(g);
    clear(g, 'A');
    art(g, 'A', '034').heldDice = [{ id: 'hd1', value: 1 }]; // 1 → 防御
    g.pendingAttack = { attacker: 'B', value: 4, unblockable: false, physical: true, baseValue: 4 };
    const legal = getLegalActions(g);
    expect(legal).toContainEqual({ t: 'block', costSlots: [{ dieIds: ['hd1'] }] });
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['hd1'] }] });
    expect(art(g, 'A', '034').heldDice).toHaveLength(0);
  });

  it('011 灵能屏障·触发：按分布为冥想的存放骰可作为「消耗 1 颗冥想骰」', () => {
    const g = g034();
    toMain(g);
    armLeft(g);
    clear(g, 'A');
    art(g, 'A', '034').heldDice = [{ id: 'hd2', value: 2 }]; // 2 → 冥想
    g.pendingAttack = { attacker: 'B', value: 5, unblockable: false, physical: true, baseValue: 5 };
    g.pending = { kind: 'dunwuHalve', player: 'A' };
    const legal = getLegalActions(g);
    expect(legal).toContainEqual({ t: 'dunwuHalve', accept: true, meditationDieId: 'hd2' });
    applyAction(g, { t: 'dunwuHalve', accept: true, meditationDieId: 'hd2' });
    expect(art(g, 'A', '034').heldDice).toHaveLength(0);
    expect(g.pendingAttack!.value).toBe(2);
  });

  it('023 畏惧·对方支付：存放骰可作为「消耗 1 颗任意能力骰」', () => {
    const g = g034();
    toMain(g);
    armLeft(g);
    clear(g, 'A');
    art(g, 'A', '034').heldDice = [{ id: 'hd4', value: 4 }];
    g.pending = { kind: 'weijuPay', player: 'A', initiator: 'B', initiatorValue: 3 };
    const legal = getLegalActions(g);
    expect(legal).toContainEqual({ t: 'weijuPay', dieId: 'hd4' });
  });

  it('004 锋芒·触发：存放攻击骰 + 存放冥想骰可作为代价', () => {
    const g = g034();
    toMain(g);
    armLeft(g);
    clear(g, 'A');
    art(g, 'A', '034').heldDice = [
      { id: 'ha', value: 3 }, // 攻击
      { id: 'hm', value: 2 }, // 冥想
    ];
    g.pending = { kind: 'fengmang', player: 'A', defenderId: 'B', value: 4 };
    const legal = getLegalActions(g);
    expect(legal).toContainEqual({ t: 'fengmang', accept: true, attackDieId: 'ha', meditationDieId: 'hm' });
    applyAction(g, { t: 'fengmang', accept: true, attackDieId: 'ha', meditationDieId: 'hm' });
    expect(art(g, 'A', '034').heldDice).toHaveLength(0);
  });

  it('存放骰 id 带玩家前缀：双方各持同型神器（034）并激活 → id 不撞串、互不影响', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['034', '002', '003'], heroB: ['034', '002', '003'] });
    skipInitialReroll(g);
    toMain(g);
    const activate = (who: PlayerId): void => {
      g.activePlayer = who;
      g.skillsUsedThisTurn = [];
      const a = art(g, who, '034');
      a.activeMarkerSide = 'left';
      a.armedSide = 'left';
      a.armedTurn = g.turnIndex;
      g.pending = { kind: 'activationResolve', player: who, artifactId: '034', side: 'left' };
      applyAction(g, { t: 'skill', artifactId: '034', side: 'left', params: { pips: [1, 2, 3] } });
    };
    activate('A');
    activate('B');
    const idsA = art(g, 'A', '034').heldDice!.map((d) => d.id);
    const idsB = art(g, 'B', '034').heldDice!.map((d) => d.id);
    expect(idsA.every((id) => id.startsWith('A-034-'))).toBe(true);
    expect(idsB.every((id) => id.startsWith('B-034-'))).toBe(true);
    expect(idsA.some((id) => idsB.includes(id))).toBe(false);
  });
});
