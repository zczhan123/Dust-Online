// 「真实之剑」代价选择 · S3 新版交互：**选真骰（点几颗＝几格）→（不足/想加）选置换源 → 直接发动**
// 覆盖：步数（固定/可变）、死路预防（P2 realMin）、buildParams 组装、1 颗款保持不变、isDirectCost 判定。
import { describe, it, expect } from 'vitest';
import { createGame, skipInitialReroll } from '../src/core/engine/game';
import { SKILL_SELECTION, isDirectCost } from '../src/ui/skillSelection';
import type { DiceKind, GameState, PlayerId } from '../src/core/model/types';

const arm = (g: GameState, who: PlayerId, id: string, side: 'left' | 'right') => {
  const a = g.players[who].artifacts.find((x) => x.id === id)!;
  a.activeMarkerSide = side;
  a.armedSide = side;
  a.armedTurn = g.turnIndex;
};
const die = (id: string, value: number, kind: DiceKind) => ({ id, value, kind });
const stepsOf = (g: GameState, key: string, chosenDice: string[][] = []) =>
  SKILL_SELECTION[key].steps({ state: g, player: 'A', chosenDice, options: [], numbers: [], slots: [] });

/** A：010 真实之剑 + 011（可变款）+ 003；B 随便 */
const mk = (): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['010', '011', '003'], heroB: ['001', '002', '006'] });
  skipInitialReroll(g);
  arm(g, 'A', '010', 'left'); // 真实之剑·持续
  return g;
};
const setAreas = (g: GameState, a: Partial<Record<DiceKind, { id: string; value: number; kind: DiceKind }[]>>) => {
  for (const k of ['attack', 'defense', 'meditation'] as DiceKind[]) g.players.A.areas[k] = a[k] ?? [];
};

describe('真实之剑代价 · S3（选真骰 → 选置换源）', () => {
  it('固定款「龙腾万丈」(3 冥想)：步① 点几颗＝几格；真骰够时只剩 1 步', () => {
    const g = mk();
    setAreas(g, { meditation: [die('m1', 2, 'meditation'), die('m2', 4, 'meditation'), die('m3', 6, 'meditation')] });
    const s0 = stepsOf(g, 'youlong.tengwan');
    expect(s0.map((s) => s.kind)).toEqual(['dice', 'dice']); // 步①「选真骰」+ 备用「选置换源」
    expect(s0[0].kind === 'dice' ? s0[0].min : null).toBe(3); // 池里只有 3 颗 → 必须全用真骰
    expect(s0[0].kind === 'dice' ? s0[0].max : null).toBe(3);
    // 真骰选满 3 颗后：置换步消失（本屏 1 步即完成）
    const sFull = stepsOf(g, 'youlong.tengwan', [['m1', 'm2', 'm3']]);
    expect(sFull.map((s) => s.kind)).toEqual(['dice']);

    // 只选 1 颗真骰 → 出现"恰好补 4 颗任意骰"（2 组置换）
    const s1 = stepsOf(g, 'youlong.tengwan', [['m1']]);
    expect(s1.map((s) => s.kind)).toEqual(['dice', 'dice']);
    expect(s1[1].kind === 'dice' ? s1[1].min : null).toBe(4);
    expect(s1[1].kind === 'dice' ? s1[1].max : null).toBe(4);
  });

  it('防呆 P2（死路预防）：龙腾 3、手里 2 冥想 + 2 其它 → 真骰**至少选 2 颗**', () => {
    const g = mk();
    setAreas(g, {
      meditation: [die('m1', 2, 'meditation'), die('m2', 4, 'meditation')],
      attack: [die('a1', 1, 'attack'), die('a2', 3, 'attack')],
    });
    const s = stepsOf(g, 'youlong.tengwan');
    // realMin = max(0, 2×3 − 池总数 4) = 2 → 不允许只选 1 颗（否则置换源不够）
    expect(s[0].kind === 'dice' ? s[0].min : null).toBe(2);
  });

  it('可变款「灵能屏障」(1–3 防御)：步① 1–3；步② 允许偶数颗（0＝不置换，奇数非法）', () => {
    const g = mk();
    arm(g, 'A', '011', 'left'); // 灵能屏障（可变速）
    setAreas(g, {
      defense: [die('d1', 2, 'defense'), die('d2', 4, 'defense')],
      meditation: [die('m1', 5, 'meditation')],
    });
    const s0 = stepsOf(g, 'dunwu.barrier.activate');
    expect(s0.map((s) => s.kind)).toEqual(['dice', 'dice']);
    expect(s0[0].kind === 'dice' ? s0[0].min : null).toBe(0); // 允许 0 颗真骰（这几格全用置换）
    expect(s0[0].kind === 'dice' ? s0[0].max : null).toBe(3);

    // 真骰 0 颗 → 步②至少 2 颗置换源（＝1 格，满足下限 1 格）
    const s0sub = s0[1];
    expect(s0sub.kind === 'dice' ? s0sub.min : null).toBe(2);

    const s1 = stepsOf(g, 'dunwu.barrier.activate', [['d1']]);
    const sub = s1[1];
    expect(sub.kind === 'dice' ? sub.min : null).toBe(0); // 已有 1 颗真骰 → 不置换也合法
    expect(sub.kind === 'dice' ? (sub.validate?.([{ id: 'x', value: 1, kind: 'attack' }]) as { ok: boolean }).ok : null).toBe(false); // 奇数颗非法
    expect(sub.kind === 'dice' ? (sub.validate?.([{ id: 'x', value: 1, kind: 'attack' }, { id: 'y', value: 2, kind: 'attack' }]) as { ok: boolean }).ok : null).toBe(true);
  });

  it('buildParams：真骰 + 置换组 → costSlots（多组也正确）', () => {
    const g = mk();
    setAreas(g, { meditation: [die('m1', 2, 'meditation'), die('m2', 4, 'meditation')], attack: [die('a1', 1, 'attack'), die('a2', 3, 'attack')] });
    const params = SKILL_SELECTION['youlong.tengwan'].buildParams({
      state: g,
      player: 'A',
      chosenDice: [['m1', 'm2'], ['a1', 'a2']], // 2 真骰 + 1 组置换
      options: [],
      numbers: [],
      slots: [],
    });
    expect(params.costSlots).toEqual([{ dieIds: ['m1'] }, { dieIds: ['m2'] }, { dieIds: ['a1', 'a2'] }]);
  });

  it('1 颗款保持不变：恶意 / 零时枭首仍走旧交互，且不直发', () => {
    const g = mk();
    setAreas(g, { attack: [die('a1', 3, 'attack'), die('a2', 5, 'attack')], defense: [die('d1', 2, 'defense')] });
    // 恶意 = 恰好 1 攻击骰（固定）→ 旧交互：①置换几组 ②真骰
    const s = stepsOf(g, 'mengyan.eyi');
    expect(s.map((x) => x.kind)).toEqual(['number', 'dice']);
    expect(isDirectCost(SKILL_SELECTION['mengyan.eyi'], g, 'A')).toBe(false);
  });

  it('isDirectCost：持剑的多颗款=true；未持剑=false', () => {
    const g1 = mk();
    expect(isDirectCost(SKILL_SELECTION['youlong.tengwan'], g1, 'A')).toBe(true);
    const g2 = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '011', '003'], heroB: ['001', '002', '006'] });
    expect(isDirectCost(SKILL_SELECTION['youlong.tengwan'], g2, 'A')).toBe(false);
  });
});

// 035 超度 · 同点数代价（持真实之剑）：① 选 2 颗同点冥想骰（0–2）→ ② 不足时选置换源 → 选区域（直发）
describe('035 超度 · 同点数代价（持真实之剑）', () => {
  const mk035 = (): GameState => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['010', '035', '003'], heroB: ['001', '002', '006'] });
    skipInitialReroll(g);
    arm(g, 'A', '010', 'left');
    return g;
  };
  const withArgs = (g: GameState, chosenDice: string[][], options: string[] = []) =>
    SKILL_SELECTION['qianjie.chaodu'].steps({
      state: g,
      player: 'A',
      chosenDice,
      options,
      numbers: [],
      slots: [],
    });
  const dv = (id: string, value: number): { id: string; value: number; kind: DiceKind } => ({
    id,
    value,
    kind: 'meditation',
  });

  it('步①：0–2 颗；2 颗须同点、1 颗须 5 点（否则非法）', () => {
    const g = mk035();
    setAreas(g, {
      meditation: [die('m1', 2, 'meditation'), die('m2', 2, 'meditation'), die('m5', 5, 'meditation'), die('m3', 3, 'meditation')],
    });
    const s = withArgs(g, []);
    expect(s.map((x) => x.kind)).toEqual(['dice', 'dice', 'option', 'option']); // 真骰 0 → 还带置换步
    const d0 = s[0];
    if (d0.kind !== 'dice') throw new Error('expect dice');
    expect(d0.min).toBe(0);
    expect(d0.max).toBe(2);
    expect(d0.validate!([dv('a', 2), dv('b', 2)]).ok).toBe(true); // 两颗同点 ✓
    expect(d0.validate!([dv('a', 2), dv('b', 3)]).ok).toBe(false); // 不同点 ✗
    expect(d0.validate!([dv('a', 5)]).ok).toBe(true); // 1 颗 5 点 ✓
    expect(d0.validate!([dv('a', 2)]).ok).toBe(false); // 1 颗非 5 ✗
    expect(d0.validate!([]).ok).toBe(true); // 0 颗 ✓
  });

  it('步②：真骰 2 颗同点 → 无置换步；真骰 0/1 颗 → 恰好补 2×(2−真骰) 颗', () => {
    const g = mk035();
    setAreas(g, {
      meditation: [die('m1', 2, 'meditation'), die('m2', 2, 'meditation'), die('m5', 5, 'meditation')],
      defense: [die('d1', 1, 'defense'), die('d2', 4, 'defense')],
    });
    expect(withArgs(g, [['m1', 'm2']]).map((x) => x.kind)).toEqual(['dice', 'option', 'option']); // 够 2 颗 → 无置换
    const s1 = withArgs(g, [['m5']]);
    expect(s1[1].kind === 'dice' ? s1[1].min : null).toBe(2);
    const s0 = withArgs(g, [[]]);
    expect(s0[1].kind === 'dice' ? s0[1].min : null).toBe(4);
  });

  it('buildParams：三条合法路都组装成"2 格"costSlots + 目标参数', () => {
    const g = mk035();
    setAreas(g, {
      meditation: [die('m1', 2, 'meditation'), die('m2', 2, 'meditation'), die('m5', 5, 'meditation')],
      defense: [die('d1', 1, 'defense'), die('d2', 4, 'defense')],
    });
    const bp = (chosenDice: string[][], options: string[] = []) =>
      SKILL_SELECTION['qianjie.chaodu'].buildParams({
        state: g,
        player: 'A',
        chosenDice,
        options,
        numbers: [],
        slots: [],
      }) as { costSlots: { dieIds: string[] }[]; targetOwner: string; targetKind: string };

    // ① 2 颗真·同点
    expect(bp([['m1', 'm2']], ['opponent', 'defense']).costSlots).toEqual([
      { dieIds: ['m1'] },
      { dieIds: ['m2'] },
    ]);
    // ② 1 颗真 5 点 + 1 组置换
    const b2 = bp([['m5'], ['d1', 'd2']], ['self', 'attack']);
    expect(b2.costSlots).toEqual([{ dieIds: ['m5'] }, { dieIds: ['d1', 'd2'] }]);
    expect(b2.targetOwner).toBe('self');
    expect(b2.targetKind).toBe('attack');
    // ③ 2 组置换
    expect(bp([[], ['d1', 'd2', 'm1', 'm2']], ['opponent', 'meditation']).costSlots).toEqual([
      { dieIds: ['d1', 'd2'] },
      { dieIds: ['m1', 'm2'] },
    ]);
  });

  it('isDirectCost：持剑=true（直发）；未持剑=false（仍走确认条）', () => {
    const g1 = mk035();
    expect(isDirectCost(SKILL_SELECTION['qianjie.chaodu'], g1, 'A')).toBe(true);
    const g2 = createGame({ seed: 1, firstPlayer: 'A', heroA: ['035', '011', '001'], heroB: ['002', '004', '006'] });
    expect(isDirectCost(SKILL_SELECTION['qianjie.chaodu'], g2, 'A')).toBe(false);
  });
});
