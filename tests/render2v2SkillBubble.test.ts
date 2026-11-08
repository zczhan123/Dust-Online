import { describe, it, expect } from 'vitest';
import { createTwoVTwoGame } from '../src/core/engine/game';
import { render2v2Game } from '../src/ui/battle2v2View';
import { bubbleDuration, createBubbleQueue, type BubbleOpts, type BubbleVariant } from '../src/ui/motion';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';

const setup = (): TwoVTwoSetup => ({
  seats: {
    A1: ['001', '002', '003'],
    A2: ['004', '005', '006'],
    B1: ['007', '008', '009'],
    B2: ['010', '011', '012'],
  },
  firstTeam: 'A',
  seed: 7,
});

/**
 * 2v2 技能气泡 / 操作列表口径门禁。
 *
 * 真实事故：① 技能名显示成神器名（「影掠」）；② 3 列神器「充能完了先弹技能名、后弹充能」；
 * ③ 004 锋芒在 2v2 漏跳过 → 引擎枚举的每条「1 攻 + 1 冥」组合都变成按钮。
 */
describe('2v2 技能气泡', () => {
  it('004 锋芒：只出「发动「锋芒」」+「不发动」，不泄漏任何组合按钮', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame({ ...setup(), startPhase: false });
    state.phase = 'main';
    state.activePlayer = 'A2';
    state.players.A2.areas.attack = [{ id: 'fm-a', value: 2, kind: 'attack' }] as never;
    state.players.A2.areas.meditation = [{ id: 'fm-m', value: 3, kind: 'meditation' }] as never;
    state.pending = {
      kind: 'fengmang',
      player: 'A2',
      defenderId: 'B1',
      value: 3,
    } as never;

    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });

    const open = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-act="fengmangOpen"]'));
    expect(open).toHaveLength(1);
    expect(open[0].textContent).toBe('发动「锋芒」');
    expect(open[0].className).toBe('btn btn-skill');

    const decline = Array.from(
      root.querySelectorAll<HTMLButtonElement>('[data-act="fengmangDecline"]'),
    );
    expect(decline).toHaveLength(1);
    expect(decline[0].textContent).toBe('不发动');
    // 与 1v1 一致：普通 `btn`（不能被染成技能绿按钮）
    expect(decline[0].className).toBe('btn');

    // 通用循环必须跳过 fengmang：一个 `data-act="fengmang"` 都不许出现
    expect(root.querySelectorAll('[data-act="fengmang"]')).toHaveLength(0);

    // 精确集合：操作列表里所有含「锋芒」的按钮只有那一个
    const texts = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).map(
      (b) => b.textContent ?? '',
    );
    expect(texts.filter((t) => t.includes('锋芒'))).toEqual(['发动「锋芒」']);
    expect(texts.filter((t) => t.includes('不发动'))).toEqual(['不发动']);
  });
});

describe('createBubbleQueue（1v1 / 2v2 共用的同卡串行队列）', () => {
  type Call = { text: string; variant: BubbleVariant; delayMs: number };

  function makeQueue() {
    const calls: Call[] = [];
    const queue = createBubbleQueue(
      document.createElement('div'),
      (_root, _target, text, variant, opts: BubbleOpts) => {
        calls.push({ text, variant, delayMs: opts.delayMs ?? 0 });
        return 0;
      },
    );
    return { queue, calls };
  }

  it('同一个 key 依次弹：后一条的 delay ＝ 前一条播完时刻', () => {
    const { queue, calls } = makeQueue();
    const dur = bubbleDuration('use');
    queue.play('A:005', null, '影袭', 'use');
    queue.play('A:005', null, '影袭', 'use');

    expect(calls.map((c) => c.text)).toEqual(['影袭', '影袭']);
    expect(calls[0].delayMs).toBe(0);
    expect(calls[1].delayMs).toBe(dur);
    expect(queue.endAt('A:005')).toBe(dur * 2);
    expect(queue.total).toBe(dur * 2);
  });

  it('不同 key 各自并行（互不等待）', () => {
    const { queue, calls } = makeQueue();
    const dur = bubbleDuration('use');
    queue.play('A:005', null, '影袭', 'use');
    queue.play('B:012', null, '梦醒时分', 'use');

    expect(calls.map((c) => c.delayMs)).toEqual([0, 0]);
    expect(queue.endAt('B:012')).toBe(dur);
    // total 取所有 key 里最晚结束的那条
    expect(queue.total).toBe(dur);
  });

  it('显式 delayMs 叠加在该 key 的排队时刻之上', () => {
    const { queue, calls } = makeQueue();
    const dur = bubbleDuration('open');
    queue.play('A:009', null, '充能', 'open', { delayMs: 120 });
    queue.play('A:009', null, '高塔铁幕', 'use');

    // 充能：0 + 120
    expect(calls[0].delayMs).toBe(120);
    // 技能名：等充能（120 + 1000）排完 → 1120
    expect(calls[1].delayMs).toBe(120 + bubbleDuration('open'));
    expect(queue.endAt('A:009')).toBe(120 + dur + bubbleDuration('use'));
  });

  it('未排过的 key，endAt 为 0', () => {
    const { queue } = makeQueue();
    expect(queue.endAt('nobody')).toBe(0);
    expect(queue.total).toBe(0);
  });
});
