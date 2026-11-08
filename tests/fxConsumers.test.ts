// 引擎旁路事件（`FxEvent`）与 2v2 界面的「消费登记表」门禁。
// 目的：引擎以后新增一种 fx 事件时，2v2 **必须**要么实现、要么在此登记「不适用 + 理由」，
//      不允许静默漏播（历史事故：011/034 的 attackJoin、A06 的 gouhun 在 2v2 全部没有动画）。
import { describe, it, expect } from 'vitest';

const raw = import.meta.glob('../src/{core/engine/fx,ui/battle2v2View}.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const pick = (name: string): string => {
  const key = Object.keys(raw).find((k) => k.endsWith(`/${name}`));
  return key ? raw[key]! : '';
};

const FX_SRC = pick('fx.ts');
const VIEW_SRC = pick('battle2v2View.ts');

/** 2v2 真的接了动画的事件（必须能在 `battle2v2View.ts` 里找到按 kind 的分支）。 */
const CONSUMED = [
  'pay',
  'reroll',
  'block',
  'attackJoin',
  'move',
  'hanguang',
  'weiju',
  'rise',
  'skillFired',
  'trueLine',
  'holdAttackDie',
  'gouhun',
] as const;

/** 2v2 里**不存在**的机制（每条必须写清理由；空理由视为没登记）。 */
const NOT_APPLICABLE: Record<string, string> = {
  heal: '2v2 是团队共享生命，走 teamLifeDeltas2v2() 的团队生命差动画，不消费单人 heal 事件',
  tacticFired: '2v2 规则不带战术牌（TwoVTwoSetup 只有四席神器 + 先手 + 种子），战术气泡不会出现',
  reset: 'L04「我将在下个梦境与你再度相逢」是传奇英雄面板技能，2v2 没有传奇面板 → 不会重开',
  legendRoll: '挑战模式·昔日传奇专属（驱动骰），2v2 没有传奇席位',
  legendSkill: '挑战模式·昔日传奇专属（技能过场），2v2 没有传奇席位',
};

const kindsOf = (src: string): string[] =>
  [...new Set([...src.matchAll(/kind:\s*'([A-Za-z]+)'/g)].map((m) => m[1]!))].sort();

describe('FxEvent 消费登记（2v2 不许静默漏动画）', () => {
  const allKinds = kindsOf(FX_SRC);

  it('从 fx.ts 里读到了全部事件种类', () => {
    expect(FX_SRC.length).toBeGreaterThan(1000);
    expect(VIEW_SRC.length).toBeGreaterThan(10000);
    expect(allKinds.length).toBeGreaterThanOrEqual(17);
  });

  it('每一种 fx 事件都二选一：2v2 已消费 / 已登记不适用（带理由）', () => {
    const missing: string[] = [];
    for (const kind of allKinds) {
      if ((CONSUMED as readonly string[]).includes(kind)) continue;
      const reason = NOT_APPLICABLE[kind];
      if (!reason || reason.trim().length < 10) missing.push(kind);
    }
    expect(missing).toEqual([]);
  });

  it('登记表里没有"已消失的事件"（引擎改名/删除后要同步清理）', () => {
    const stale = [...CONSUMED, ...Object.keys(NOT_APPLICABLE)].filter((k) => !allKinds.includes(k));
    expect(stale).toEqual([]);
  });

  it('登记为"已消费"的事件，源码里真的有按 kind 的分支', () => {
    const notFound = CONSUMED.filter((k) => !VIEW_SRC.includes(`'${k}'`));
    expect(notFound).toEqual([]);
  });
});
