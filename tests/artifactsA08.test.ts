import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll, getLegalActions } from '../src/core/engine/game';
import { ARTIFACTS } from '../src/core/content/artifacts';
import { effectiveSpeed, baseSpeed } from '../src/core/engine/derive';
import { hasActiveSkill } from '../src/core/engine/skill-state';
import { battleNotes } from '../src/core/engine/battleNotes';
import { queueRerollEndTriggers, pumpPending } from '../src/core/engine/pending';
import { afterAttackResolved, finalizeAttackResolution } from '../src/core/engine/combat';
import type { GameState, PendingAttack, PlayerId } from '../src/core/model/types';

/** A 持 A08 鸣雷（异相版 013，第一列）+ 002（第二列）+ 003（第三列）；B 持 004/005/006 */
const gA08 = (heroA: [string, string, string] = ['A08', '002', '003']): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA, heroB: ['004', '005', '006'] });
  skipInitialReroll(g);
  return g;
};

const art = (g: GameState, who: PlayerId, id: string) => g.players[who].artifacts.find((a) => a.id === id)!;

const die = (id: string, value: number, kind: 'attack' | 'defense' | 'meditation') => ({ id, value, kind });

/** 结束阶段超出意志上限时的选择器：按默认（AI）弃骰后继续 */
const autoEndDiscard = (g: GameState): boolean => {
  if (g.pending?.kind === 'endDiscard') {
    applyAction(g, getLegalActions(g)[0]);
    return true;
  }
  return false;
};

/** 推进到「主要阶段」（必要时跳过尘起） */
const toMain = (g: GameState): void => {
  let guard = 0;
  while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) {
    if (autoEndDiscard(g)) continue;
    applyAction(g, { t: 'advance' });
  }
};

/** 反复推进（advance）直到谓词成立（guard 防死循环） */
const until = (g: GameState, pred: () => boolean, max = 40): void => {
  let i = 0;
  while (!pred() && i++ < max && g.phase !== 'gameOver') {
    if (autoEndDiscard(g)) continue;
    applyAction(g, { t: 'advance' });
  }
};
const atA = (g: GameState, phase: GameState['phase']) => () =>
  g.activePlayer === 'A' && g.phase === phase;

/** 在当前回合的尘起阶段，为指定神器支付 1 颗冥想骰完成 激活/切换 */
const dustRise = (g: GameState, artifactId: string, side?: 'left' | 'right'): void => {
  const player: PlayerId = g.activePlayer;
  const p = g.players[player];
  let med = p.areas.meditation[0];
  if (!med) {
    med = { id: `med-${g.turnIndex}-${artifactId}`, value: 4, kind: 'meditation' };
    p.areas.meditation.push(med);
  }
  applyAction(g, {
    t: 'dustRise',
    artifactId,
    ...(side ? { side } : {}),
    costSlots: [{ dieIds: [med.id] }],
  });
};

/** 直接让 A08 处于「已激活」的某一侧（不经过尘起流程，供单点断言） */
const armA08 = (g: GameState, side: 'left' | 'right'): void => {
  const a = art(g, 'A', 'A08');
  a.activeMarkerSide = side;
  a.armedSide = side;
  a.armedTurn = g.turnIndex;
};

describe('A08 鸣雷（异相版 013）·内容数据守卫', () => {
  it('name 鸣雷 / 长枪 / 第一列 / speed 2 / will 8；技能精确匹配', () => {
    const a = ARTIFACTS['A08'];
    expect(a.id).toBe('A08');
    expect(a.name).toBe('鸣雷');
    expect(a.weapon).toBe('长枪');
    expect(a.column).toBe(1);
    expect(a.speed).toBe(2);
    expect(a.will).toBe(8);
    expect(a.skills).toEqual([
      { side: 'left', kind: 'trigger', key: 'minglei.alt.dianxing' },
      { side: 'right', kind: 'trigger', key: 'minglei.leibao.trigger' },
      { side: 'right', kind: 'continuous', key: 'minglei.alt.leibao.continuous' },
    ]);
  });
});

describe('A08「将至的电刑」：使用攻击骰后，消耗 2 冥想 → 依次以 1、3、6 点攻击', () => {
  const setupDianxing = (): GameState => {
    const g = gA08();
    until(g, atA(g, 'dustRise'));
    dustRise(g, 'A08', 'left'); // 电刑在左侧
    until(g, atA(g, 'main'));
    g.players.A.areas.attack.push({ id: 'a-atk', value: 2, kind: 'attack' });
    g.players.A.areas.meditation.push(
      { id: 'm1', value: 3, kind: 'meditation' },
      { id: 'm2', value: 5, kind: 'meditation' },
    );
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a-atk'] }] });
    applyAction(g, { t: 'block' }); // B 不抵挡
    return g;
  };

  it('触发待决策 values 精确 [1,3,6]；getLegalActions 含电刑动作', () => {
    const g = setupDianxing();
    expect(g.pending).toEqual({ kind: 'dianxing', player: 'A', values: [1, 3, 6] });

    const acts = getLegalActions(g);
    expect(acts.some((a) => a.t === 'dianxing' && a.accept === false)).toBe(true);
    const def = acts.find((a) => a.t === 'dianxing' && a.dieIds);
    expect(def && def.t === 'dianxing' ? def.dieIds!.length : 0).toBe(2);
  });

  it('执行：消耗 2 冥想骰 → 逐段 1、3、6 点攻击（队列依次清空）', () => {
    const g = setupDianxing();
    applyAction(g, { t: 'dianxing', dieIds: ['m1', 'm2'] });

    // 消耗的冥想骰已离开冥想区
    expect(g.players.A.areas.meditation.some((d) => d.id === 'm1')).toBe(false);
    expect(g.players.A.areas.meditation.some((d) => d.id === 'm2')).toBe(false);

    // 第 1 段立即结算，余下 3、6 在队列中
    expect(g.pendingAttack?.value).toBe(1);
    expect(g.attackQueue?.values).toEqual([3, 6]);
    applyAction(g, { t: 'block' });
    expect(g.pendingAttack?.value).toBe(3);
    applyAction(g, { t: 'block' });
    expect(g.pendingAttack?.value).toBe(6);
    applyAction(g, { t: 'block' });
    expect(g.pendingAttack).toBeNull();
    expect(g.attackQueue).toBeNull();
    expect(g.pending).toBeNull(); // 虚拟攻击不会再触发「电刑」
  });

  it('不发动：不消耗冥想骰、无追加攻击', () => {
    const g = setupDianxing();
    const medBefore = g.players.A.areas.meditation.map((d) => d.id);
    applyAction(g, { t: 'dianxing', accept: false });
    expect(g.pending).toBeNull();
    expect(g.pendingAttack).toBeNull();
    expect(g.players.A.areas.meditation.map((d) => d.id)).toEqual(medBefore);
  });

  it('边界：dieIds 不为 2 颗 / 非法骰 → 抛错且待决策不被清空', () => {
    const g = setupDianxing();
    expect(() => applyAction(g, { t: 'dianxing', dieIds: ['m1'] })).toThrow();
    expect(() => applyAction(g, { t: 'dianxing', dieIds: ['m1', 'a-atk'] })).toThrow();
    expect(() => applyAction(g, { t: 'dianxing', dieIds: ['m1', 'm1'] })).toThrow();
    expect(g.pending?.kind).toBe('dianxing');
  });

  it('对照基础 013：同一流程 values 为 [1,2,3]', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['013', '002', '003'], heroB: ['004', '005', '006'] });
    skipInitialReroll(g);
    until(g, atA(g, 'dustRise'));
    dustRise(g, '013', 'left');
    until(g, atA(g, 'main'));
    g.players.A.areas.attack.push({ id: 'a-atk', value: 2, kind: 'attack' });
    g.players.A.areas.meditation.push(
      { id: 'm1', value: 3, kind: 'meditation' },
      { id: 'm2', value: 5, kind: 'meditation' },
    );
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a-atk'] }] });
    applyAction(g, { t: 'block' });
    expect(g.pending).toEqual({ kind: 'dianxing', player: 'A', values: [1, 2, 3] });
  });
});

describe('A08「将至的雷暴·触发」：攻击被抵挡后，移动最多 2 个冥想骰到攻击区（保留点数）', () => {
  const setupLeibao = (): GameState => {
    const g = gA08();
    until(g, atA(g, 'dustRise'));
    dustRise(g, 'A08', 'right'); // 雷暴在右侧
    until(g, atA(g, 'main'));
    g.players.A.areas.attack.push({ id: 'a-atk', value: 4, kind: 'attack' });
    g.players.A.areas.meditation.push(
      { id: 'm1', value: 2, kind: 'meditation' },
      { id: 'm2', value: 6, kind: 'meditation' },
    );
    g.players.B.areas.defense.push({ id: 'b-def', value: 3, kind: 'defense' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a-atk'] }] });
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['b-def'] }] }); // 被抵挡
    return g;
  };

  it('被抵挡 → pending kind=leibao；执行移动 1 颗到攻击区并保留点数', () => {
    const g = setupLeibao();
    expect(g.pending).toEqual({ kind: 'leibao', player: 'A' });

    applyAction(g, { t: 'leibao', dieIds: ['m1'] });
    expect(g.players.A.areas.attack.some((d) => d.id === 'm1' && d.value === 2)).toBe(true);
    expect(g.players.A.areas.meditation.some((d) => d.id === 'm1')).toBe(false);
    expect(g.pending).toBeNull();
  });

  it('最多 2 颗：一次移动 2 颗（保留各自点数）', () => {
    const g = setupLeibao();
    applyAction(g, { t: 'leibao', dieIds: ['m1', 'm2'] });
    expect(g.players.A.areas.attack.some((d) => d.id === 'm1' && d.value === 2)).toBe(true);
    expect(g.players.A.areas.attack.some((d) => d.id === 'm2' && d.value === 6)).toBe(true);
    expect(g.pending).toBeNull();
  });

  it('边界：超过 2 颗 / 非冥想骰 / 重复骰 → 抛错且待决策不被清空', () => {
    const g = setupLeibao();
    g.players.A.areas.meditation.push({ id: 'm3', value: 1, kind: 'meditation' });
    expect(() => applyAction(g, { t: 'leibao', dieIds: ['m1', 'm2', 'm3'] })).toThrow();
    expect(() => applyAction(g, { t: 'leibao', dieIds: ['a-atk'] })).toThrow();
    expect(() => applyAction(g, { t: 'leibao', dieIds: ['m1', 'm1'] })).toThrow();
    expect(g.pending?.kind).toBe('leibao');
  });

  it('不发动：0 颗 = 无效果（冥想骰不动）', () => {
    const g = setupLeibao();
    const medBefore = g.players.A.areas.meditation.map((d) => d.id);
    applyAction(g, { t: 'leibao', dieIds: [] });
    expect(g.pending).toBeNull();
    expect(g.players.A.areas.meditation.map((d) => d.id)).toEqual(medBefore);
  });
});

describe('A08「将至的雷暴·持续」：速度 +2（去掉基础 013 的额外重掷阶段）', () => {
  it('未激活时速度 = 基础 2；激活右侧后 effectiveSpeed = 4', () => {
    const g = gA08();
    expect(baseSpeed(g.players.A)).toBe(2);
    expect(effectiveSpeed(g.players.A)).toBe(2);
    armA08(g, 'right');
    expect(hasActiveSkill(g.players.A, 'minglei.alt.leibao.continuous')).toBe(true);
    expect(effectiveSpeed(g.players.A)).toBe(4);
  });

  it('A08 不含基础 013 的 minglei.leibao.continuous（无额外重掷阶段）', () => {
    const g = gA08();
    armA08(g, 'right');
    expect(hasActiveSkill(g.players.A, 'minglei.alt.leibao.continuous')).toBe(true);
    expect(hasActiveSkill(g.players.A, 'minglei.leibao.continuous')).toBe(false);

    // 集成：B 重掷阶段结束时不会挂起 leibaoReroll
    queueRerollEndTriggers(g, 'B');
    expect(g.pendingQueue.some((p) => p.kind === 'leibaoReroll')).toBe(false);
  });

  it('对照基础 013：激活右侧会挂起 leibaoReroll（额外重掷阶段）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['013', '002', '003'], heroB: ['004', '005', '006'] });
    skipInitialReroll(g);
    const a = g.players.A.artifacts.find((x) => x.id === '013')!;
    a.activeMarkerSide = 'right';
    a.armedSide = 'right';
    a.armedTurn = g.turnIndex;
    expect(hasActiveSkill(g.players.A, 'minglei.leibao.continuous')).toBe(true);
    queueRerollEndTriggers(g, 'B');
    expect(g.pendingQueue.some((p) => p.kind === 'leibaoReroll')).toBe(true);
  });
});

describe('A08 战斗提示（battleNotes）登记', () => {
  it('激活右侧且可支付 → 含「将至的雷暴」条目（与 013 共用 key、按神器取卡面名）；无速度类条目；未激活时不含', () => {
    const g = gA08();
    toMain(g);
    // 未激活：不出现雷暴提示
    expect(battleNotes(g, 'A').some((n) => n.label === '将至的雷暴')).toBe(false);

    armA08(g, 'right');
    g.players.A.areas.meditation.push({ id: 'm-note', value: 3, kind: 'meditation' });

    const notes = battleNotes(g, 'A');
    expect(notes).toContainEqual({
      label: '将至的雷暴',
      text: '攻击被抵挡时，可将最多 2 个冥想骰移到攻击骰区',
    });
    // 「速度 +2」是持续加成，不属于攻击提示，不应出现
    expect(notes.every((n) => !n.label.includes('速度') && !n.text.includes('速度'))).toBe(true);
  });
});

describe('电刑类技能的多段兼容性（2026-09-26 立规）', () => {
  it('028「陨落」反击：防守方为 A08 时用攻击骰抵挡 → 触发 A08 电刑（values [1,3,6]）', () => {
    const g = gA08();
    toMain(g);
    g.activePlayer = 'B'; // 攻击方＝B
    art(g, 'A', 'A08').activeMarkerSide = 'left'; // A08 已激活
    g.players.A.areas.meditation = [die('m1', 1, 'meditation'), die('m2', 2, 'meditation')];
    const pa = { attacker: 'B', value: 3, baseValue: 3, blockKind: 'attack' } as PendingAttack;
    finalizeAttackResolution(g, pa, true); // 被抵挡
    expect(g.pending?.kind).toBe('dianxing');
    expect((g.pending as { values?: number[] }).values).toEqual([1, 3, 6]);
  });

  it('多段攻击中途某段被抵挡 → 「雷暴」不再被"是否处于序列"抑制', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['013', '002', '003'], heroB: ['004', '005', '006'] });
    skipInitialReroll(g);
    toMain(g);
    g.activePlayer = 'A';
    art(g, 'A', '013').activeMarkerSide = 'right'; // 雷暴（触发·右）
    g.players.A.areas.meditation = [die('m1', 1, 'meditation')];
    g.attackQueue = { player: 'A', values: [6] }; // 模拟"多段进行中"
    const pa = { attacker: 'A', value: 3, baseValue: 3, physical: false } as PendingAttack;
    afterAttackResolved(g, pa, { blocked: true, damageDealt: 0 });
    pumpPending(g);
    expect(g.pending?.kind).toBe('leibao');
  });
});
