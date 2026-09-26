import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll, getLegalActions } from '../src/core/engine/game';
import { ARTIFACTS } from '../src/core/content/artifacts';
import { battleNotes } from '../src/core/engine/battleNotes';
import { totalDice } from '../src/core/engine/derive';
import { hasActiveSkill } from '../src/core/engine/skill-state';
import { SKILL_SELECTION } from '../src/ui/skillSelection';
import type { GameState, PlayerId } from '../src/core/model/types';

/** A 持 A03/002/003（A03 第 1 列，002 第 2 列提供分布），B 持 004/005/006 */
const gA03 = (): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['A03', '002', '003'], heroB: ['004', '005', '006'] });
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
const armSide = (g: GameState, who: PlayerId, id: string, side: 'left' | 'right'): void => {
  const a = art(g, who, id);
  a.activeMarkerSide = side;
  a.armedSide = side;
  a.armedTurn = g.turnIndex;
};
/** 走 activationResolve 待决策真正结算 A03 的激活侧 */
const activateA03 = (g: GameState, who: PlayerId, side: 'left' | 'right', pips: number[]): void => {
  g.activePlayer = who;
  g.skillsUsedThisTurn = [];
  const a = art(g, who, 'A03');
  a.activeMarkerSide = side;
  a.armedSide = side;
  a.armedTurn = g.turnIndex;
  g.pending = { kind: 'activationResolve', player: who, artifactId: 'A03', side };
  applyAction(g, { t: 'skill', artifactId: 'A03', side, params: { pips } });
};

describe('A03 金刚（异相）·内容数据守卫', () => {
  it('四条技能登记精确匹配（左右激活 + 复用 034 的持续/触发 key）', () => {
    expect(ARTIFACTS['A03'].skills).toEqual([
      { side: 'left', kind: 'activation', key: 'jingang.alt.pozhang' },
      { side: 'left', kind: 'continuous', key: 'jingang.pozhang.continuous' },
      { side: 'right', kind: 'activation', key: 'jingang.alt.puti' },
      { side: 'right', kind: 'trigger', key: 'jingang.puti.trigger' },
    ]);
  });
});

describe('A03 修罗的破障 / 修罗的菩提·激活（2 个任意点数，可相同）', () => {
  it('激活：[3,3] 与 [1,6] 都放入对应点数的 2 颗存放骰', () => {
    const g = gA03();
    toMain(g);
    activateA03(g, 'A', 'left', [3, 3]);
    expect(art(g, 'A', 'A03').heldDice?.map((d) => d.value)).toEqual([3, 3]);

    const g2 = gA03();
    toMain(g2);
    activateA03(g2, 'A', 'right', [1, 6]);
    expect(art(g2, 'A', 'A03').heldDice?.map((d) => d.value)).toEqual([1, 6]);
  });

  it('激活边界：数量不符 / 点数越界 → 抛错且 heldDice 保持原样（不改状态）', () => {
    const g = gA03();
    toMain(g);
    const a = art(g, 'A', 'A03');
    a.activeMarkerSide = 'left';
    a.armedSide = 'left';
    a.armedTurn = g.turnIndex;
    a.heldDice = [{ id: 'orig', value: 5 }];
    const original = [{ id: 'orig', value: 5 }];
    for (const pips of [[1], [1, 2, 3], [0, 1], [1, 7]]) {
      g.pending = { kind: 'activationResolve', player: 'A', artifactId: 'A03', side: 'left' };
      expect(() => applyAction(g, { t: 'skill', artifactId: 'A03', side: 'left', params: { pips } })).toThrow();
      expect(a.heldDice).toEqual(original);
    }
  });

  it('再次激活：清空旧存放骰，只剩新的 2 颗', () => {
    const g = gA03();
    toMain(g);
    const a = art(g, 'A', 'A03');
    a.heldDice = [
      { id: 'old1', value: 6 },
      { id: 'old2', value: 5 },
      { id: 'old3', value: 4 },
    ];
    activateA03(g, 'A', 'left', [2, 2]);
    expect(a.heldDice?.map((d) => d.value)).toEqual([2, 2]);
  });

  it('AI/测试默认参数：activationResolve 下 getLegalActions 给出 pips [1,1]', () => {
    const g = gA03();
    toMain(g);
    const a = art(g, 'A', 'A03');
    a.activeMarkerSide = 'left';
    a.armedSide = 'left';
    a.armedTurn = g.turnIndex;
    g.pending = { kind: 'activationResolve', player: 'A', artifactId: 'A03', side: 'left' };
    const acts = getLegalActions(g);
    expect(acts).toContainEqual({ t: 'skill', artifactId: 'A03', side: 'left', params: { pips: [1, 1] } });
  });
});

describe('A03 修罗的破障·持续（复用 034 破障实现）', () => {
  it('激活左侧后，存放骰可当能力骰使用（攻击走 paySlots），用后从 heldDice 移除', () => {
    const g = gA03();
    toMain(g);
    armSide(g, 'A', 'A03', 'left');
    clear(g, 'A');
    clear(g, 'B');
    art(g, 'A', 'A03').heldDice = [{ id: 'h3', value: 3 }]; // 002：攻=3/4 → 攻击骰
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['h3'] }] });
    expect(g.pendingAttack?.value).toBe(3);
    expect(art(g, 'A', 'A03').heldDice?.length ?? 0).toBe(0);
  });

  it('未激活（切到另一侧）时，存放骰不可当能力骰用（抛错）', () => {
    const g = gA03();
    toMain(g);
    const a = art(g, 'A', 'A03');
    a.activeMarkerSide = 'right'; // 破障·持续在左侧，未激活
    clear(g, 'A');
    a.heldDice = [{ id: 'h3', value: 3 }];
    expect(() => applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['h3'] }] })).toThrow();
  });

  it('§19⑥ 存放骰不属区域：不计入 totalDice/区域数量，与 heldDice 相互独立', () => {
    const g = gA03();
    toMain(g);
    clear(g, 'A');
    const before = totalDice(g.players.A);
    activateA03(g, 'A', 'left', [2, 4]);
    const a = art(g, 'A', 'A03');
    expect(a.heldDice?.map((d) => d.value)).toEqual([2, 4]);
    expect(totalDice(g.players.A)).toBe(before);
    // 六个区域里都不含存放骰（弃置/移动类选择器的候选来源是区域骰）
    const areaCount =
      g.players.A.areas.attack.length + g.players.A.areas.defense.length + g.players.A.areas.meditation.length;
    expect(areaCount).toBe(0);
    const areaIds = [
      ...g.players.A.areas.attack,
      ...g.players.A.areas.defense,
      ...g.players.A.areas.meditation,
    ].map((d) => d.id);
    for (const h of a.heldDice ?? []) expect(areaIds).not.toContain(h.id);
    expect(a.heldDice).toHaveLength(2);
  });
});

describe('A03 修罗的菩提·触发（复用 034 不动菩提触发）', () => {
  it('对方用防御骰抵挡后，可移除同点数存放骰取消该抵挡 → 攻击照常造成伤害', () => {
    const g = gA03();
    toMain(g);
    const a = art(g, 'A', 'A03');
    armSide(g, 'A', 'A03', 'right');
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
});

describe('A03 与 034 同名持续 key 互不影响', () => {
  it('A 持 A03、B 持 034，各自激活后存放骰 id 前缀不同、互不串', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['A03', '002', '003'], heroB: ['034', '002', '003'] });
    skipInitialReroll(g);
    toMain(g);
    const activate = (who: PlayerId, id: string, pips: number[]): void => {
      g.activePlayer = who;
      g.skillsUsedThisTurn = [];
      const a = art(g, who, id);
      a.activeMarkerSide = 'left';
      a.armedSide = 'left';
      a.armedTurn = g.turnIndex;
      g.pending = { kind: 'activationResolve', player: who, artifactId: id, side: 'left' };
      applyAction(g, { t: 'skill', artifactId: id, side: 'left', params: { pips } });
    };
    activate('A', 'A03', [3, 3]);
    activate('B', '034', [1, 2, 3]);
    const idsA = art(g, 'A', 'A03').heldDice!.map((d) => d.id);
    const idsB = art(g, 'B', '034').heldDice!.map((d) => d.id);
    expect(idsA).toHaveLength(2);
    expect(idsB).toHaveLength(3);
    expect(idsA.every((id) => id.startsWith('A-A03-'))).toBe(true);
    expect(idsB.every((id) => id.startsWith('B-034-'))).toBe(true);
    expect(idsA.some((id) => idsB.includes(id))).toBe(false);
    // 双方各持同名持续 key，但持有者互不干扰
    expect(hasActiveSkill(g.players.A, 'jingang.pozhang.continuous')).toBe(true);
    expect(hasActiveSkill(g.players.B, 'jingang.pozhang.continuous')).toBe(true);
    expect(art(g, 'A', 'A03').heldDice).toHaveLength(2);
    expect(art(g, 'B', '034').heldDice).toHaveLength(3);
  });
});

describe('A03 战斗提示 / UI 选择器', () => {
  it('battleNotes：A03 的激活/持续/触发都不产生常驻攻击提示', () => {
    const g = gA03();
    toMain(g);
    const a = art(g, 'A', 'A03');
    a.activeMarkerSide = 'left';
    a.armedSide = 'left';
    a.armedTurn = g.turnIndex;
    a.heldDice = [{ id: 'h3', value: 3 }];
    const notes = battleNotes(g, 'A');
    expect(notes).toEqual([]);
    const labels = notes.map((n) => n.label);
    for (const name of ['金刚', '破障', '修罗的破障', '菩提', '修罗的菩提']) {
      expect(labels).not.toContain(name);
    }
  });

  it('UI 选择器：两步 pips（每步 1 颗），buildParams 合成可重复的 pips；左右共用同一选择器', () => {
    const g = gA03();
    const sel = SKILL_SELECTION['jingang.alt.pozhang'];
    expect(sel).toBe(SKILL_SELECTION['jingang.alt.puti']);
    const args = { state: g, player: 'A' as PlayerId, chosenDice: [], options: [], numbers: [], slots: [] };
    const steps = sel.steps(args);
    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s.kind)).toEqual(['pips', 'pips']);
    expect(sel.buildParams({ ...args, chosenDice: [['3'], ['3']] })).toEqual({ pips: [3, 3] });
    expect(sel.buildParams({ ...args, chosenDice: [['1'], ['6']] })).toEqual({ pips: [1, 6] });
  });
});
