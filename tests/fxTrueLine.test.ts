import { describe, it, expect } from 'vitest';
import { createGame } from '../src/core/engine/game';
import { dealTrueDamage, applyDeferredTrueDamage } from '../src/core/engine/combat';
import { fxReset, fxTake, fxSetSource, fxTrueLine, type FxEvent } from '../src/core/engine/fx';

const lines = (evs: FxEvent[]) =>
  evs.filter((e): e is Extract<FxEvent, { kind: 'trueLine' }> => e.kind === 'trueLine');

describe('真伤白墨线 · trueLine 事件（发动即报，落血唯一处发）', () => {
  it('设了"发动卡"上下文 → dealTrueDamage 发一条（卡片 + 来源 + 目标 + 伤害量）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    fxReset();
    fxSetSource({ player: 'A', artifactId: '010', side: 'left', skillKey: 'shenhong.kill' });
    dealTrueDamage(g, 'B', 3, 'A');
    const ls = lines(fxTake());
    expect(ls).toHaveLength(1);
    expect(ls[0].source).toBe('A');
    expect(ls[0].target).toBe('B');
    expect(ls[0].amount).toBe(3);
    expect(ls[0].card).toEqual({ player: 'A', artifactId: '010', side: 'left', skillKey: 'shenhong.kill' });
  });

  it('无"发动卡"上下文 → 仍发一条（card=null → 界面退回来源方面板锚点）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    fxReset();
    dealTrueDamage(g, 'B', 2, 'A');
    const ls = lines(fxTake());
    expect(ls).toHaveLength(1);
    expect(ls[0].card).toBeNull();
  });

  it('自伤（source===target）照发；战术卡上下文用 tacticId', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    fxReset();
    fxSetSource({ player: 'B', tacticId: 'T08' });
    dealTrueDamage(g, 'B', 2, 'B');
    const ls = lines(fxTake());
    expect(ls).toHaveLength(1);
    expect(ls[0].source).toBe('B');
    expect(ls[0].target).toBe('B');
    expect(ls[0].card).toEqual({ player: 'B', tacticId: 'T08' });
  });

  it('延后真伤（applyDeferredTrueDamage）不重发（避免 009 与原始技能重复飞线）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    fxReset();
    applyDeferredTrueDamage(g, 'B', 4);
    expect(lines(fxTake())).toHaveLength(0);
  });

  it('skipLine（T09 放行重走）/ 伤害量 ≤0 → 不发', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    fxReset();
    dealTrueDamage(g, 'B', 3, 'A', { skipLine: true });
    dealTrueDamage(g, 'B', 0, 'A');
    expect(lines(fxTake())).toHaveLength(0);
  });

  it('fxReset 清空"发动卡"上下文（下一条线 card=null）', () => {
    fxSetSource({ player: 'A', artifactId: '010', side: 'left' });
    fxReset();
    fxTrueLine('A', 'B', 1);
    expect(lines(fxTake())[0].card).toBeNull();
  });

  it('「生命下降」（drop=true，033 抹零）：仍发线，事件带 drop 标记（界面据此"不抖"）', () => {
    fxReset();
    fxTrueLine('A', 'B', 7, true);
    const ls = lines(fxTake());
    expect(ls).toHaveLength(1);
    expect(ls[0].drop).toBe(true);
    expect(ls[0].amount).toBe(7);
  });
});
