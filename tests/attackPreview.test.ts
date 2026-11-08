// 2v2 守方投票前的"这一刀"＝**引擎试算**（2026-11-07）。
//
// 投票发生在派发之前，但守方要能看到点数/伤害/加成。绝不能另写一份伤害公式，
// 所以在**状态副本**上跑一次真实的 `applyAction`，读出 `pendingAttack`。
// 本文件锁住三件事：① 试算数值 = 真正结算数值；② 真局一个字节不改；③ 骰子 id 计数器不被吃掉。
import { describe, it, expect } from 'vitest';
import { applyAction, createTwoVTwoGame } from '../src/core/engine/game';
import { getDieIdCounter } from '../src/core/model/dice';
import { previewPendingAttack } from '../src/ui/attackPreview';
import { attackInfoParts } from '../src/ui/render';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';
import type { Action } from '../src/core/model/types';

const setup = (): TwoVTwoSetup => ({
  seats: {
    A1: ['010', '011', '012'],
    A2: ['001', '002', '003'],
    B1: ['004', '005', '006'],
    B2: ['007', '008', '009'],
  },
  firstTeam: 'A',
  seed: 7,
  dice: {
    A1: { attack: [3, 4], defense: [2], meditation: [] },
    B1: { attack: [], defense: [], meditation: [] },
    B2: { attack: [], defense: [], meditation: [] },
  },
});

describe('投票前试算（previewPendingAttack）', () => {
  it('普通攻击：试算的点数/伤害 = 真正结算的，且不改真局、不吃骰子 id', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    g.stance = 'defensePicks';
    const dieId = g.players.A1.areas.attack[0]!.id;
    const action = { t: 'attack', costSlots: [{ dieIds: [dieId] }] } as Action;

    const before = JSON.stringify(g);
    const counterBefore = getDieIdCounter();
    const preview = previewPendingAttack(g, action);
    expect(preview).not.toBeNull();
    // 真局完全没变（含随机数、骰区、待决策）
    expect(JSON.stringify(g)).toBe(before);
    // 骰子 id 计数器被复原
    expect(getDieIdCounter()).toBe(counterBefore);

    applyAction(g, { ...action, target: 'B2' } as Action);
    const real = g.pendingAttack!;
    expect(preview!.baseValue).toBe(real.baseValue);
    expect(preview!.value).toBe(real.value);
    expect(preview!.bonusValue ?? 0).toBe(real.bonusValue ?? 0);
    expect(!!preview!.unblockable).toBe(!!real.unblockable);
  });

  it('技能攻击（005 影袭）：试算命中有技能来源与点数', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'B1';
    g.stance = 'defensePicks';
    const art = g.players.B1.artifacts.find((a) => a.id === '005')!;
    art.activeMarkerSide = 'left';
    g.players.B1.areas.attack = [{ id: 'yx-a', value: 3, kind: 'attack' }] as never;
    const action = {
      t: 'skill',
      artifactId: '005',
      side: 'left',
      params: { dieId: 'yx-a', x: 2 },
    } as Action;

    const preview = previewPendingAttack(g, action);
    expect(preview).not.toBeNull();
    expect(preview!.baseValue).toBe(2);
    expect(preview!.sourceSkill).toBe('影袭');
    // 真局仍在"未派发"状态
    expect(g.pendingAttack ?? null).toBeNull();
    expect(g.players.B1.areas.attack[0]!.value).toBe(3);
  });

  it('文案：与 1v1 同一来源（attackInfoParts）；2v2 多"预计"、不含减半', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    const dieId = g.players.A1.areas.attack[0]!.id;
    const preview = previewPendingAttack(g, { t: 'attack', costSlots: [{ dieIds: [dieId] }] } as Action)!;
    const pa = { ...preview, unblockable: true, unblockableLabel: '中央突破', halveReason: '灵能屏障' };
    const text2v2 = attackInfoParts(g, pa, (s) => `玩家${s}`, {
      showAttacker: true,
      estimated: true,
    })
      .map((p) => p.text)
      .join('');
    expect(text2v2).toContain('玩家A1');
    expect(text2v2).toContain('用');
    expect(text2v2).toContain(`预计 ${preview.value} 伤害`);
    expect(text2v2).toContain('（不可抵挡·「中央突破」）');
    // 投票阶段不显示"减半"（屏障要等选中座位后才会发生）
    expect(text2v2).not.toContain('减半');

    // 1v1：原文（不传 opts）——"被 N 点攻击骰…，本次 M 伤害"
    const text1v1 = attackInfoParts(g, { ...pa, halveReason: undefined, unblockableLabel: undefined }, (s) => `玩家${s}`)
      .map((p) => p.text)
      .join('');
    expect(text1v1).toContain(`被 ${preview.sourceValue} 点攻击骰攻击，本次 ${preview.value} 伤害`);
    expect(text1v1).toContain('（不可抵挡）');
  });
});
