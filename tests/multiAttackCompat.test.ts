// @vitest-environment node
// §19⑨「多段攻击三件套」门禁：自动盘点源码里的多段来源 + 禁止裸调 doAttack 造多段 + 联动用例。
// 新增第 4 个多段来源（走 attackQueue / virtualQueue）而没登记 → 本文件必须变红。
import { describe, it, expect } from 'vitest';
import { createGame, createChallengeGame, applyAction, skipInitialReroll, getLegalActions } from '../src/core/engine/game';
import { dianxingValuesOf } from '../src/core/engine/combat';
import type { GameState } from '../src/core/model/types';

/** 引擎源码原文（Vite `?raw` 导入，避免依赖 node 类型） */
const RAW = import.meta.glob('../src/core/engine/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** 多段攻击的"来源"＝创建 attackQueue / virtualQueue 的任何非空赋值（`= null` / `= undefined` / `===` 不算） */
const SOURCE_RE = /g\.(attackQueue|virtualQueue)\s*=\s*(?!\s*(?:null|undefined)\b)(?!=)/;
/** 来源上方必须有的锚注释：`// §19⑨ 多段攻击源：<技能名>` */
const ANCHOR_RE = /§19⑨ 多段攻击源：(.+)/;

interface Hit {
  file: string;
  line: number;
  queue: 'attackQueue' | 'virtualQueue';
  prev: string;
}

const engineFiles = Object.entries(RAW).map(([path, src]) => [path.split('/').pop()!, src] as const);
const fileSrc = (name: string): string => engineFiles.find(([f]) => f === name)?.[1] ?? '';

function collectHits(): Hit[] {
  const hits: Hit[] = [];
  for (const [file, src] of engineFiles) {
    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = SOURCE_RE.exec(lines[i]);
      if (!m) continue;
      hits.push({
        file,
        line: i + 1,
        queue: m[1] as Hit['queue'],
        prev: lines.slice(Math.max(0, i - 3), i).join('\n'),
      });
    }
  }
  return hits;
}

const g013 = (heroA: [string, string, string] = ['013', '002', '003']): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA, heroB: ['004', '005', '006'] });
  skipInitialReroll(g);
  g.phase = 'main';
  g.activePlayer = 'A';
  return g;
};

describe('§19⑨ 多段攻击三件套 · 门禁（自动盘点源码）', () => {
  const hits = collectHits();

  it('源码里的多段来源：game.ts（attackQueue + virtualQueue）+ skills.ts（virtualQueue）', () => {
    const uniq = [...new Set(hits.map((h) => `${h.file}:${h.queue}`))].sort();
    expect(uniq).toEqual(['game.ts:attackQueue', 'game.ts:virtualQueue', 'skills.ts:virtualQueue']);
  });

  it('每个来源上方都有 `§19⑨ 多段攻击源：…` 锚注释，且登记的成员覆盖全部多段技能', () => {
    const missing = hits.filter((h) => !ANCHOR_RE.test(h.prev));
    expect(missing.map((h) => `${h.file}:${h.line}`)).toEqual([]); // 新来源没加锚注释 → 这里红
    const allAnchors = hits.map((h) => ANCHOR_RE.exec(h.prev)![1]).join('|');
    for (const name of ['013', 'A08', 'A01', '裁雨流', '枭首', '战争横扫', '战车', '拔城', '真实之剑', '无上剑术', '数罪并罚', '电刑', '虚无形态', '勾魂镰', '圆舞', '兽魂', '蛮王之牙', '尘起', '处刑通牒', '战鬼的残杀', '横贯', '白昼之火', '陨落', '涤罪大剑术', '血祭', '破障']) {
      expect(allAnchors).toContain(name);
    }
  });

  it('禁止裸调 doAttack 造多段：调用点只允许出现在 game.ts（combat.ts 仅定义 1 处）', () => {
    const offenders: string[] = [];
    for (const [file, src] of engineFiles) {
      const n = (src.match(/\bdoAttack\(/g) ?? []).length;
      if (file === 'combat.ts') {
        if (n !== 1) offenders.push(`combat.ts x${n}`); // 只应有函数定义
        continue;
      }
      if (file !== 'game.ts' && n > 0) offenders.push(`${file} x${n}`);
    }
    expect(offenders).toEqual([]);
    expect(fileSrc('game.ts').includes('doAttack(')).toBe(true); // 正常使用仍在 game.ts
  });
});

describe('§19⑨ 多段攻击三件套 · 点数唯一来源', () => {
  it('013 电刑 = 1/2/3；A08 将至的电刑 = 1/3/6', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['013', '002', '003'], heroB: ['004', '005', '006'] });
    skipInitialReroll(g);
    g.players.A.artifacts.find((a) => a.id === '013')!.activeMarkerSide = 'left';
    expect(dianxingValuesOf(g.players.A)).toEqual([1, 2, 3]);

    const g2 = createGame({ seed: 1, firstPlayer: 'A', heroA: ['A08', '002', '003'], heroB: ['004', '005', '006'] });
    skipInitialReroll(g2);
    g2.players.A.artifacts.find((a) => a.id === 'A08')!.activeMarkerSide = 'left';
    expect(dianxingValuesOf(g2.players.A)).toEqual([1, 3, 6]);
  });
});

describe('§19⑨ 多段攻击三件套 · 联动（中途待决策解决后自动续段）', () => {
  const med = (id: string, value: number) => ({ id, value, kind: 'meditation' as const });

  it('013/A08（attackQueue）：中途弹出待决策 → 解决后自动开始下一段', () => {
    const g = g013();
    g.players.A.artifacts.find((a) => a.id === '013')!.activeMarkerSide = 'right';
    g.players.A.areas.meditation = [med('m1', 2)];
    g.attackQueue = { player: 'A', values: [6] }; // 第一段已结算，剩下一段
    g.pending = { kind: 'leibao', player: 'A' }; // 中途弹出的待决策
    applyAction(g, getLegalActions(g)[0]);
    expect(g.pending).toBeNull();
    expect(g.pendingAttack?.value ?? g.pendingAttack?.baseValue).toBe(6); // 已自动续段
  });

  it('A01 不败之王（virtualQueue）：中途弹出待决策 → 解决后自动开始下一段', () => {
    const g = g013();
    g.players.A.areas.meditation = [med('m1', 2)];
    g.virtualQueue = [{ attacker: 'A', value: 5, label: '不败之王', owner: 'A' }];
    g.pending = { kind: 'leibao', player: 'A' };
    applyAction(g, getLegalActions(g)[0]);
    expect(g.pending).toBeNull();
    expect(g.pendingAttack?.value ?? g.pendingAttack?.baseValue).toBe(5);
  });

  it('Z03 拔城（virtualQueue，挑战模式）：中途弹出待决策 → 解决后自动开始下一段', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z03', challenger: ['001', '002', '003'] });
    g.virtualQueue = [{ attacker: 'B', value: 5, label: '拔城', owner: 'B' }];
    g.pending = { kind: 'leibao', player: 'A' };
    applyAction(g, getLegalActions(g)[0]);
    expect(g.pending).toBeNull();
    expect(g.pendingAttack?.value ?? g.pendingAttack?.baseValue).toBe(5);
  });

  it('Z05 数罪并罚（virtualQueue，挑战模式）：中途弹出待决策 → 解决后自动开始下一段', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z05', challenger: ['001', '002', '003'] });
    g.virtualQueue = [{ attacker: 'B', value: 6, label: '数罪并罚', owner: 'B' }];
    g.pending = { kind: 'leibao', player: 'A' };
    applyAction(g, getLegalActions(g)[0]);
    expect(g.pending).toBeNull();
    expect(g.pendingAttack?.value ?? g.pendingAttack?.baseValue).toBe(6);
  });

  it('Z08 处刑通牒（virtualQueue，挑战模式）：中途弹出待决策 → 解决后自动开始下一段', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z08', challenger: ['001', '002', '003'] });
    g.virtualQueue = [{ attacker: 'B', value: 4, label: '处刑通牒', owner: 'B' }];
    g.pending = { kind: 'leibao', player: 'A' };
    applyAction(g, getLegalActions(g)[0]);
    expect(g.pending).toBeNull();
    expect(g.pendingAttack?.value ?? g.pendingAttack?.baseValue).toBe(4);
  });
});
