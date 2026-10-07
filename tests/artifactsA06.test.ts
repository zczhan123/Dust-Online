import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll } from '../src/core/engine/game';
import { ARTIFACTS } from '../src/core/content/artifacts';
import { battleNotes } from '../src/core/engine/battleNotes';
import { doAttack, resolveBlock, virtualAttack } from '../src/core/engine/combat';
import { consumeDice } from '../src/core/engine/skills';
import { paySlots } from '../src/core/engine/effects';
import { fxReset, fxTake } from '../src/core/engine/fx';
import type { GameState, PlayerId } from '../src/core/model/types';

/** A 持 A06 虚臾（异相版 016）+ 002（第二列提供分布）+ 003；B 持 004/005/006 */
const gA06 = (): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['A06', '002', '003'], heroB: ['004', '005', '006'] });
  skipInitialReroll(g);
  return g;
};

const art = (g: GameState, who: PlayerId, id: string) => g.players[who].artifacts.find((a) => a.id === id)!;

/** 让 A06 处于「该侧已激活」状态（两项都是持续技能，只需指定激活侧） */
const arm = (g: GameState, who: PlayerId, id: string, side: 'left' | 'right'): void => {
  const a = art(g, who, id);
  a.activeMarkerSide = side;
  a.armedSide = side;
  a.armedTurn = g.turnIndex;
};

const clear = (g: GameState, who: PlayerId): void => {
  g.players[who].areas.attack = [];
  g.players[who].areas.defense = [];
  g.players[who].areas.meditation = [];
};

/** 模拟此前「勾魂」已把 X 个攻击骰置于本神器上（X=2） */
const setHeld = (g: GameState): void => {
  art(g, 'A', 'A06').heldDice = [
    { id: 'g4', value: 4 },
    { id: 'g2', value: 2 },
  ];
};

const toMain = (g: GameState): void => {
  let guard = 0;
  while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) applyAction(g, { t: 'advance' });
};

describe('A06 虚臾（异相）·内容数据守卫', () => {
  it('技能精确匹配（左勾魂 / 右幽魂不散，均为持续）；第一列、镰刀、速度4、意志8、名称虚臾', () => {
    expect(ARTIFACTS['A06'].id).toBe('A06');
    expect(ARTIFACTS['A06'].name).toBe('虚臾');
    expect(ARTIFACTS['A06'].weapon).toBe('镰刀');
    expect(ARTIFACTS['A06'].column).toBe(1);
    expect(ARTIFACTS['A06'].speed).toBe(4);
    expect(ARTIFACTS['A06'].will).toBe(8);
    expect(ARTIFACTS['A06'].skills).toEqual([
      { side: 'left', kind: 'continuous', key: 'xuyu.alt.gouhun' },
      { side: 'right', kind: 'continuous', key: 'xuyu.alt.youhun' },
    ]);
  });
});

describe('A06「勾魂」（左激活·持续）', () => {
  it('用点数不在本神器上的攻击骰造成伤害后，把该攻击骰永久置于本神器上', () => {
    const g = gA06();
    arm(g, 'A', 'A06', 'left');
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.attack = [{ id: 'a5', value: 5, kind: 'attack' }];
    doAttack(g, 'A', [{ dieIds: ['a5'] }]);
    resolveBlock(g); // B 不抵挡 → 造成伤害（5）
    const held = art(g, 'A', 'A06').heldDice ?? [];
    expect(held.map((d) => d.value)).toEqual([5]);
    expect(g.players.B.life).toBe(g.players.B.lifeMax - 5);
  });

  it('发出 `gouhun` 动效事件（攻击骰飞向神器标题栏、变灰）', () => {
    const g = gA06();
    arm(g, 'A', 'A06', 'left');
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.attack = [{ id: 'a5', value: 5, kind: 'attack' }];
    fxReset();
    doAttack(g, 'A', [{ dieIds: ['a5'] }]);
    resolveBlock(g);
    const e = fxTake().find((x) => x.kind === 'gouhun');
    expect(e).toMatchObject({ kind: 'gouhun', player: 'A', artifactId: 'A06', value: 5 });
    if (e && e.kind === 'gouhun') expect(e.chipId).toBe('A-A06-held-5');
  });

  it('同值（5）再次造成伤害不重复放置；用值 3 造成伤害则追加', () => {
    const g = gA06();
    arm(g, 'A', 'A06', 'left');
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.attack = [{ id: 'a5', value: 5, kind: 'attack' }];
    doAttack(g, 'A', [{ dieIds: ['a5'] }]);
    resolveBlock(g);
    expect(art(g, 'A', 'A06').heldDice?.map((d) => d.value)).toEqual([5]);

    g.players.A.areas.attack = [{ id: 'a5b', value: 5, kind: 'attack' }];
    doAttack(g, 'A', [{ dieIds: ['a5b'] }]);
    resolveBlock(g);
    expect(art(g, 'A', 'A06').heldDice?.map((d) => d.value)).toEqual([5]); // 不重复

    g.players.A.areas.attack = [{ id: 'a3', value: 3, kind: 'attack' }];
    doAttack(g, 'A', [{ dieIds: ['a3'] }]);
    resolveBlock(g);
    expect(art(g, 'A', 'A06').heldDice?.map((d) => d.value)).toEqual([5, 3]); // 追加
  });

  it('被抵挡（0 伤害）不放置', () => {
    const g = gA06();
    arm(g, 'A', 'A06', 'left');
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.attack = [{ id: 'a5', value: 5, kind: 'attack' }];
    g.players.B.areas.defense = [{ id: 'bd', value: 3, kind: 'defense' }];
    doAttack(g, 'A', [{ dieIds: ['a5'] }]);
    resolveBlock(g, [{ dieIds: ['bd'] }]); // 抵挡 → 0 伤害
    expect(g.players.B.life).toBe(g.players.B.lifeMax);
    expect(art(g, 'A', 'A06').heldDice ?? []).toEqual([]);
  });

  it('虚拟攻击（physical=false）造成伤害也不放置', () => {
    const g = gA06();
    arm(g, 'A', 'A06', 'left');
    clear(g, 'A');
    clear(g, 'B');
    virtualAttack(g, 'A', 5);
    expect(g.pendingAttack?.physical).toBe(false);
    resolveBlock(g); // 未抵挡 → 造成伤害，但非物理攻击
    expect(g.players.B.life).toBe(g.players.B.lifeMax - 5);
    expect(art(g, 'A', 'A06').heldDice ?? []).toEqual([]);
  });
});

describe('A06「幽魂不散」（右激活·持续）', () => {
  it('使用冥想骰尘起后获得 min(1, 剩余额度) 个 X=2 点攻击骰', () => {
    const g = gA06();
    arm(g, 'A', 'A06', 'right');
    setHeld(g);
    clear(g, 'A');
    clear(g, 'B');
    expect(g.phase).toBe('dustRise');
    expect(g.activePlayer).toBe('A');
    g.players.A.areas.meditation = [{ id: 'm1', value: 3, kind: 'meditation' }];

    applyAction(g, { t: 'dustRise', artifactId: 'A06', costSlots: [{ dieIds: ['m1'] }] });

    const gained = g.players.A.areas.attack;
    expect(gained.map((d) => d.value)).toEqual([2]);
    expect(gained[0].kind).toBe('attack');
    expect(g.hunhunGained.A).toBe(1);
  });

  it('对方回合中使用防御骰抵挡也触发（证明跨回合可触发）', () => {
    const g = gA06();
    arm(g, 'A', 'A06', 'right');
    setHeld(g);
    clear(g, 'A');
    clear(g, 'B');
    g.activePlayer = 'B';
    g.pendingAttack = { attacker: 'B', value: 5, unblockable: false, physical: true };
    g.players.A.areas.defense = [{ id: 'ad', value: 4, kind: 'defense' }];

    resolveBlock(g, [{ dieIds: ['ad'] }]);

    expect(g.pendingAttack).toBeNull();
    expect(g.players.A.areas.attack.map((d) => d.value)).toEqual([2]);
    expect(g.hunhunGained.A).toBe(1);
  });

  it('弃置防御/冥想骰（技能效果 consumeDice）也触发', () => {
    const g = gA06();
    arm(g, 'A', 'A06', 'right');
    setHeld(g);
    clear(g, 'A');
    g.players.A.areas.meditation = [{ id: 'm1', value: 6, kind: 'meditation' }];

    consumeDice(g, g.players.A, 'meditation', ['m1']);

    expect(g.players.A.areas.attack.map((d) => d.value)).toEqual([2]);
    expect(g.hunhunGained.A).toBe(1);
  });

  it('「消耗」（paySlots reason=skill）不触发', () => {
    const g = gA06();
    arm(g, 'A', 'A06', 'right');
    setHeld(g);
    clear(g, 'A');
    g.players.A.areas.meditation = [{ id: 'm1', value: 3, kind: 'meditation' }];

    paySlots(g, 'A', [{ kind: 'meditation' }], [{ dieIds: ['m1'] }], undefined, 'skill');

    expect(g.players.A.areas.attack).toEqual([]);
    expect(g.hunhunGained.A).toBe(0);
  });

  it('每玩家回合上限 2：一次弃置 3 颗只得到 2 个；再触发不再获得', () => {
    const g = gA06();
    arm(g, 'A', 'A06', 'right');
    setHeld(g);
    clear(g, 'A');
    g.players.A.areas.meditation = [
      { id: 'm1', value: 1, kind: 'meditation' },
      { id: 'm2', value: 2, kind: 'meditation' },
      { id: 'm3', value: 3, kind: 'meditation' },
      { id: 'm4', value: 4, kind: 'meditation' },
    ];

    consumeDice(g, g.players.A, 'meditation', ['m1', 'm2', 'm3']);
    expect(g.players.A.areas.attack.map((d) => d.value)).toEqual([2, 2]);
    expect(g.hunhunGained.A).toBe(2);

    consumeDice(g, g.players.A, 'meditation', ['m4']);
    expect(g.players.A.areas.attack.map((d) => d.value)).toEqual([2, 2]); // 额度已满，不再获得
    expect(g.hunhunGained.A).toBeLessThanOrEqual(2);
  });

  it('X=0（本神器上无攻击骰）时不获得', () => {
    const g = gA06();
    arm(g, 'A', 'A06', 'right');
    clear(g, 'A');
    art(g, 'A', 'A06').heldDice = [];
    g.players.A.areas.meditation = [{ id: 'm1', value: 3, kind: 'meditation' }];

    consumeDice(g, g.players.A, 'meditation', ['m1']);

    expect(g.players.A.areas.attack).toEqual([]);
    expect(g.hunhunGained.A).toBe(0);
  });
});

describe('A06 战斗提示 battleNotes', () => {
  const allText = (g: GameState): string =>
    battleNotes(g, 'A')
      .map((n) => `${n.label}｜${n.text}`)
      .join('　');

  it('勾魂（持续·左）：激活时出现条目；幽魂不散 / 神器名「虚臾」不出现', () => {
    const g = gA06();
    toMain(g);
    expect(g.phase).toBe('main');
    // 未激活 → 不出现
    expect(allText(g)).not.toContain('勾魂');
    // 激活勾魂（左侧）→ 出现
    arm(g, 'A', 'A06', 'left');
    expect(allText(g)).toContain('勾魂');
    // 幽魂不散 / 神器名「虚臾」不出现
    expect(allText(g)).not.toContain('幽魂不散');
    expect(allText(g)).not.toContain('虚臾');
    // 只激活右（幽魂不散）→ 勾魂不出现
    arm(g, 'A', 'A06', 'right');
    expect(allText(g)).not.toContain('勾魂');
  });
});
