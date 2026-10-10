import { describe, it, expect } from 'vitest';
import { createChallengeGame, applyAction, skipInitialReroll } from '../src/core/engine/game';
import type { Die, DiceKind, GameState } from '../src/core/model/types';

const die = (id: string, value: number, kind: DiceKind = 'meditation'): Die => ({ id, value, kind });
const make = (mode: 'manual' | 'favor' | 'against' = 'manual') =>
  createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'], settleMode: mode });

/** 把局面停在"轮到传奇、下一条＝遁入暗影（z02-5 = skills[5]）"。 */
function atTundun(g: GameState, drivenVals: number[], defenseVals: number[]): void {
  skipInitialReroll(g);
  g.challenge!.resumeAt = 5;
  g.challenge!.driven = drivenVals.map((v, i) => die(`drv${i}`, v));
  g.players.B.areas.defense = defenseVals.map((v, i) => die(`bd${i}`, v, 'defense'));
  g.players.A.areas.defense = [];
}

const defVals = (g: GameState): number[] => g.players.B.areas.defense.map((d) => d.value).sort((a, b) => a - b);

describe('挑战模式 · 遁入暗影（先移入防御骰区 → 再逐组攻击；放不下时任选 room 颗）', () => {
  it('例①：驱动 3,3,3,5 / 防 2 → 扣驱动(零头留下) → 移入 2 颗 → 攻击 1 次', () => {
    const g = make();
    atTundun(g, [3, 3, 3, 5], [1, 1]);
    applyAction(g, { t: 'challengeStep' }); // 成组：扣驱动骰（零头留下），本步**不攻击、不移入**
    expect(g.pendingAttack).toBeNull();
    expect(g.challenge!.driven.map((d) => d.value).sort((a, b) => a - b)).toEqual([3, 5]); // 零头 3 与孤独 5 留下
    expect(defVals(g)).toEqual([1, 1]); // 尚未移入
    expect(g.challenge!.deferred).toMatchObject({ skillId: 'z02-5' });
    applyAction(g, { t: 'challengeStep' }); // 移入（room=2 ≥ 总数 2 → 全移，不问）
    expect(g.pending).toBeNull();
    expect(defVals(g)).toEqual([1, 1, 3, 3]); // **先**移入
    applyAction(g, { t: 'challengeStep' }); // 移入之后 → 第 1 次攻击
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', baseValue: 2, legendGroup: { index: 1, total: 1 } });
    applyAction(g, { t: 'block' });
    expect(g.challenge!.deferred).toBeUndefined();
  });

  it('例②：驱动 3,3 / 防已满 4 → 不移入、只攻击 1 次', () => {
    const g = make();
    atTundun(g, [3, 3], [1, 1, 1, 1]);
    applyAction(g, { t: 'challengeStep' }); // 成组（扣驱动骰）
    applyAction(g, { t: 'challengeStep' }); // 移入（满 → 0 颗）
    expect(defVals(g)).toEqual([1, 1, 1, 1]); // 满 4 → 不动
    applyAction(g, { t: 'challengeStep' }); // 攻击
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', baseValue: 2 });
    applyAction(g, { t: 'block' });
    expect(g.challenge!.deferred).toBeUndefined();
  });

  it('例③：驱动 3,3,3 / 防 3 → 移入 1 颗（同组内等价 → 不弹面板）', () => {
    const g = make();
    atTundun(g, [3, 3, 3], [1, 1, 1]);
    applyAction(g, { t: 'challengeStep' });
    applyAction(g, { t: 'challengeStep' }); // room=1 < 2，但只有 1 组同点 → 去重后只有 1 种结果 → 不问
    expect(g.pending).toBeNull();
    expect(defVals(g)).toEqual([1, 1, 1, 3]); // 3+1=4，旧的 1 仍在（不挤出）
    applyAction(g, { t: 'challengeStep' });
    expect(g.pendingAttack).toMatchObject({ baseValue: 2 });
    applyAction(g, { t: 'block' });
  });

  it('双组：驱动 3,3,5,5 / 防空 → 全移入 → 两次攻击（带 K/N 序号）', () => {
    const g = make();
    atTundun(g, [3, 3, 5, 5], []);
    applyAction(g, { t: 'challengeStep' }); // 成组
    applyAction(g, { t: 'challengeStep' }); // 移入（room=4 ≥ 4 → 全移）
    expect(defVals(g)).toEqual([3, 3, 5, 5]);
    applyAction(g, { t: 'challengeStep' }); // 第 1 次攻击
    expect(g.pendingAttack).toMatchObject({ baseValue: 2, legendGroup: { index: 1, total: 2 } });
    applyAction(g, { t: 'block' });
    applyAction(g, { t: 'challengeStep' }); // 第 2 次攻击
    expect(g.pendingAttack).toMatchObject({ baseValue: 2, legendGroup: { index: 2, total: 2 } });
    applyAction(g, { t: 'block' });
    expect(g.challenge!.deferred).toBeUndefined();
  });

  it('候选 > 2 组：有利模式只取 2 组（点数最小优先），其余留在 driven', () => {
    const g = make('favor');
    atTundun(g, [2, 2, 4, 4, 6, 6], []);
    applyAction(g, { t: 'challengeStep' });
    expect(g.challenge!.deferred).toMatchObject({ groups: [[2, 2], [4, 4]] });
    expect(g.challenge!.driven.map((d) => d.value).sort((a, b) => a - b)).toEqual([6, 6]);
  });

  it('③ 防御骰已满 4：候选 > 2 组时不再弹"选组"代决 → 默认前 2 组', () => {
    const g = make('manual');
    atTundun(g, [2, 2, 4, 4, 6, 6], [1, 1, 1, 1]); // 昔传防御骰已满 4
    applyAction(g, { t: 'challengeStep' });
    expect(g.pending).toBeNull(); // 不打扰挑战者
    expect(g.challenge!.deferred).toMatchObject({ groups: [[2, 2], [4, 4]] });
  });

  it('③ 未满：候选 > 2 组仍弹"选组"代决', () => {
    const g = make('manual');
    atTundun(g, [2, 2, 4, 4, 6, 6], [1, 1]); // 未满
    applyAction(g, { t: 'challengeStep' });
    expect(g.pending?.kind).toBe('challengePick');
  });

  it('放不下时任选 room 颗（防=3 → room=1）：弹面板选 3点/5点', () => {
    const g = make('manual');
    atTundun(g, [3, 3, 5, 5], [1, 1, 1]); // room = 4-3 = 1
    applyAction(g, { t: 'challengeStep' }); // 成组
    applyAction(g, { t: 'challengeStep' }); // 到"移入"步 → 弹"任选 room 颗"
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    expect(g.pending.options.map((o) => o.label).sort()).toEqual(['3点', '5点']);
    const opt5 = g.pending.options.find((o) => o.label === '5点')!;
    applyAction(g, { t: 'challengePick', id: opt5.id }); // 选 5 点
    applyAction(g, { t: 'challengeStep' }); // 移入所选
    expect(defVals(g)).toEqual([1, 1, 1, 5]);
  });

  it('放不下时任选 room 颗（防=1 → room=3）：选项＝3点3点5点 / 3点5点5点', () => {
    const g = make('manual');
    atTundun(g, [3, 3, 5, 5], [1]); // room = 4-1 = 3
    applyAction(g, { t: 'challengeStep' });
    applyAction(g, { t: 'challengeStep' });
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    const labels = g.pending.options.map((o) => o.label);
    expect(labels).toHaveLength(2);
    expect(labels).toContain('3点、3点、5点');
    expect(labels).toContain('3点、5点、5点');
  });

  it('放不下时·有利/不利：favor 取小值、against 取大值（自动，不弹面板）', () => {
    for (const [mode, expected] of [
      ['favor', [1, 1, 1, 3]], // 取小 → 3 点进防御
      ['against', [1, 1, 1, 5]], // 取大 → 5 点进防御
    ] as const) {
      const g = make(mode);
      atTundun(g, [3, 3, 5, 5], [1, 1, 1]); // room = 1
      applyAction(g, { t: 'challengeStep' }); // 成组
      applyAction(g, { t: 'challengeStep' }); // 自动选 + 移入
      expect(g.pending).toBeNull();
      expect(defVals(g)).toEqual([...expected]);
    }
  });
});
