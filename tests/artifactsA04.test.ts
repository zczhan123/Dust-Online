import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll, getLegalActions } from '../src/core/engine/game';
import { ARTIFACTS, makeArtifact } from '../src/core/content/artifacts';
import { battleNotes } from '../src/core/engine/battleNotes';
import { effectiveSpeed } from '../src/core/engine/derive';
import { attackDamageBonus, resolveBlock } from '../src/core/engine/combat';
import { abilityDicePool } from '../src/core/engine/effects';
import type { GameState, PlayerId, PlayerState } from '../src/core/model/types';

/** A 持 A04（第 2 列）+ 001（第 1 列提供速度/意志）+ 003（第 3 列提供生命），B 持 004/005/006 */
const gA04 = (): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', 'A04', '003'], heroB: ['004', '005', '006'] });
  skipInitialReroll(g);
  return g;
};
/** 对照用：A 持基础 020（与 A04 同列、同 001/003 搭配） */
const g020 = (): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '020', '003'], heroB: ['004', '005', '006'] });
  skipInitialReroll(g);
  return g;
};

const art = (g: GameState, who: PlayerId, id: string) => g.players[who].artifacts.find((a) => a.id === id)!;

const toMain = (g: GameState): void => {
  let guard = 0;
  while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) applyAction(g, { t: 'advance' });
};

/** 直接让某神器处于「该侧已激活」状态（等价于完成了一次尘起装填） */
const activate = (g: GameState, who: PlayerId, id: string, side: 'left' | 'right'): void => {
  const a = art(g, who, id);
  a.activeMarkerSide = side;
  a.armedSide = side;
  a.armedTurn = g.turnIndex;
};

/** 只挂一件（或多件）神器的裸 PlayerState（用于属性推导单测，参考 derive.test.ts） */
const singlePlayer = (ids: string[]): PlayerState => ({
  id: 'A',
  areas: { attack: [], defense: [], meditation: [] },
  artifacts: ids.map(makeArtifact),
  life: 50,
  lifeMax: 50,
  markers: 0,
  hasDustSeal: false,
  damagedThisTurn: false,
  attackHalvedNextTurn: false,
  dealtDamageThisTurn: false,
  noDamageLastTurn: false,
  lifeTens: 0,
  tiandanGainedThisTurn: 0,
  turnsTaken: 0,
  tacticOnceUsed: false,
  tacticHeldDie: null,
  tacticGuess: null,
  buffs: [],
});

describe('A04 兽魂（异相）·内容数据守卫', () => {
  it('四条技能精确匹配（左右激活 + 左右持续）；第二列、countCap=2、分布精确', () => {
    expect(ARTIFACTS['A04'].id).toBe('A04');
    expect(ARTIFACTS['A04'].column).toBe(2);
    expect(ARTIFACTS['A04'].countCap).toBe(2);
    expect(ARTIFACTS['A04'].distribution).toEqual({ defense: [1, 6], attack: [2, 3], meditation: [4, 5] });
    expect(ARTIFACTS['A04'].skills).toEqual([
      { side: 'left', kind: 'activation', key: 'shouhun.alt.xiong' },
      { side: 'left', kind: 'continuous', key: 'shouhun.alt.xiong.continuous' },
      { side: 'right', kind: 'activation', key: 'shouhun.alt.lang' },
      { side: 'right', kind: 'continuous', key: 'shouhun.alt.lang.continuous' },
    ]);
  });
});

describe('A04 灵界熊魂 / 灵界狼魂·激活（计数重设为 2）', () => {
  it('走 activationResolve 结算左/右侧激活 → count 重设为 2、待决策清空', () => {
    for (const side of ['left', 'right'] as const) {
      const g = gA04();
      toMain(g);
      const a = art(g, 'A', 'A04');
      a.count = 0;
      a.activeMarkerSide = side;
      a.armedSide = side;
      a.armedTurn = g.turnIndex;
      g.pending = { kind: 'activationResolve', player: 'A', artifactId: 'A04', side };
      // 默认动作（AI/测试）：无参数的 skill 动作
      expect(getLegalActions(g)).toEqual([{ t: 'skill', artifactId: 'A04', side, params: {} }]);
      applyAction(g, { t: 'skill', artifactId: 'A04', side, params: {} });
      expect(a.count).toBe(2);
      expect(g.pending).toBeNull();
    }
  });
});

describe('A04 持续加成', () => {
  it('灵界熊魂（左·持续）：攻击伤害 + 计数，label = 灵界熊魂', () => {
    const g = gA04();
    toMain(g);
    const a = art(g, 'A', 'A04');
    a.count = 2;
    activate(g, 'A', 'A04', 'left');
    expect(attackDamageBonus(g, 'A')).toEqual({ value: 2, label: '灵界熊魂' });
  });

  it('灵界狼魂（右·持续）：速度 + 计数（单件 A04 时 effectiveSpeed = 2）', () => {
    const p = singlePlayer(['A04']);
    expect(effectiveSpeed(p)).toBe(0);
    p.artifacts[0].count = 2;
    p.artifacts[0].activeMarkerSide = 'right';
    expect(effectiveSpeed(p)).toBe(2);
  });

  it('灵界狼魂在主对局中：001 基础速度 4 + 计数 2 = 6', () => {
    const g = gA04();
    toMain(g);
    art(g, 'A', 'A04').count = 2;
    activate(g, 'A', 'A04', 'right');
    expect(effectiveSpeed(g.players.A)).toBe(6);
  });
});

describe('A04 取消伤害（阈值 2 + 由持有者决定）', () => {
  const armPendingAttack = (g: GameState, attacker: PlayerId = 'B', value = 5): void => {
    g.pendingAttack = { attacker, value, unblockable: false, physical: true };
    g.pending = null;
  };

  it('计数 1 < 阈值 2：不挂起待决策，直接结算，防守方 A 掉 5 血', () => {
    const g = gA04();
    toMain(g);
    const a = art(g, 'A', 'A04');
    a.count = 1;
    activate(g, 'A', 'A04', 'left');
    armPendingAttack(g);
    const life = g.players.A.life;
    resolveBlock(g);
    expect(g.pending).toBeNull();
    expect(g.players.A.life).toBe(life - 5);
  });

  it('计数 2：挂起 shouhunCancel，决策人 = 持有者 A、owner = A、minCount = 2；取消 → 不掉血、计数 2→1', () => {
    const g = gA04();
    toMain(g);
    const a = art(g, 'A', 'A04');
    a.count = 2;
    activate(g, 'A', 'A04', 'left');
    armPendingAttack(g);
    resolveBlock(g);
    const pd = g.pending;
    expect(pd?.kind).toBe('shouhunCancel');
    if (pd?.kind === 'shouhunCancel') {
      expect(pd.player).toBe('A');
      expect(pd.owner).toBe('A');
      expect(pd.minCount).toBe(2);
    }
    // 两个选项都必须可枚举
    expect(getLegalActions(g)).toEqual([
      { t: 'shouhunCancel', cancel: true },
      { t: 'shouhunCancel', cancel: false },
    ]);
    const life = g.players.A.life;
    applyAction(g, { t: 'shouhunCancel', cancel: true });
    expect(g.players.A.life).toBe(life);
    expect(a.count).toBe(1);
    expect(g.pending).toBeNull();
  });

  it('计数 2：选择不取消 → 正常造成 5 点伤害、计数保持 2', () => {
    const g = gA04();
    toMain(g);
    const a = art(g, 'A', 'A04');
    a.count = 2;
    activate(g, 'A', 'A04', 'left');
    armPendingAttack(g);
    resolveBlock(g);
    const life = g.players.A.life;
    applyAction(g, { t: 'shouhunCancel', cancel: false });
    expect(g.players.A.life).toBe(life - 5);
    expect(a.count).toBe(2);
  });

  it('对照基础 020：同场景下决策人 = 攻击方 B、阈值 = 1（证明异相改了决策人与阈值）', () => {
    const g = g020();
    toMain(g);
    const a = art(g, 'A', '020');
    a.count = 2;
    activate(g, 'A', '020', 'left');
    armPendingAttack(g);
    resolveBlock(g);
    const pd = g.pending;
    expect(pd?.kind).toBe('shouhunCancel');
    if (pd?.kind === 'shouhunCancel') {
      expect(pd.player).toBe('B');
      expect(pd.owner).toBe('A');
      expect(pd.minCount).toBe(1);
    }
    const life = g.players.A.life;
    applyAction(g, { t: 'shouhunCancel', cancel: false });
    expect(g.players.A.life).toBe(life - 5);
  });
});

describe('A04 战斗提示 / §19', () => {
  it('battleNotes：A04 未激活时不产生任何兽魂/灵界常驻提示（取消伤害走即时 pending）', () => {
    const g = gA04();
    toMain(g);
    expect(g.activePlayer).toBe('A');
    const labels = battleNotes(g, 'A').map((n) => n.label);
    expect(labels).toEqual([]);
    for (const name of ['兽魂', '灵界熊魂', '灵界狼魂']) expect(labels).not.toContain(name);
    expect(labels.some((l) => /兽魂|灵界/.test(l))).toBe(false);
  });

  it('battleNotes：灵界熊魂（持续）激活时只登记「攻击伤害加成」，不登记取消类常驻条目', () => {
    const g = gA04();
    toMain(g);
    const a = art(g, 'A', 'A04');
    a.count = 2;
    activate(g, 'A', 'A04', 'left');
    expect(battleNotes(g, 'A')).toEqual([{ label: '灵界熊魂', text: '攻击伤害 +2' }]);
  });

  it('§19：A04 技能无骰代价、不产生存放骰，与 034 同队也不改变支付来源集合', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['034', 'A04', '003'], heroB: ['004', '005', '006'] });
    skipInitialReroll(g);
    toMain(g);
    const before = abilityDicePool(g, 'A')
      .map((d) => `${d.source}:${d.id}`)
      .sort();
    const a = art(g, 'A', 'A04');
    a.count = 2;
    activate(g, 'A', 'A04', 'left');
    expect(a.heldDice ?? []).toEqual([]);
    const after = abilityDicePool(g, 'A')
      .map((d) => `${d.source}:${d.id}`)
      .sort();
    expect(after).toEqual(before);
  });
});
