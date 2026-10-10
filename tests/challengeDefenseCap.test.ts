import { describe, it, expect } from 'vitest';
import { createChallengeGame, applyChallengeSkill, resolveLegendDeferred, applyAction } from '../src/core/engine/game';
import { CHALLENGES } from '../src/core/content/challenges';
import type { Die, DiceKind } from '../src/core/model/types';

/** `src/core/engine/*.ts` 源码原文（Vite `?raw`）：门禁用。 */
const RAW = import.meta.glob('../src/core/engine/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;
const srcOf = (name: string): string =>
  Object.entries(RAW).find(([k]) => k.endsWith(`/${name}.ts`))?.[1] ?? '';

const die = (id: string, value: number, kind: DiceKind = 'meditation'): Die => ({ id, value, kind });
const CARD = CHALLENGES.find((c) => c.id === 'Z01')!;
const SK = (id: string) => CARD.skills!.find((s) => s.id === id)!;
const make = () => createChallengeGame({ seed: 1, cardId: 'Z01', challenger: ['001', '002', '003'] });

/** Z01 上限＝5；龙腾万丈（z01-3）得 4 个随机能力骰 → 最大/最小进攻击区、其余 2 进防御区（**防御移入延后到 deferred**）。 */
const longteng = (g: ReturnType<typeof make>): void => {
  applyChallengeSkill(g, CARD, SK('z01-3'), [die('k1', 2), die('k2', 2), die('k3', 5)]);
  resolveLegendDeferred(g, CARD); // 移入步
  const pd = g.pending;
  if (pd && pd.kind === 'challengePick') {
    // 只剩部分位、两颗中间骰不同 → 挑战者代决；取第一个选项
    applyAction(g, { t: 'challengePick', id: pd.options[0].id });
    resolveLegendDeferred(g, CARD);
  }
};

describe('挑战模式 · 传奇防御骰上限（满上限时新骰直接弃置，不挤旧）', () => {
  it('Z01 上限 5：防御骰已满 5 时，龙腾万丈的新防御骰**直接弃置**（攻击骰照常）', () => {
    const g = make();
    g.players.B.areas.defense = [1, 2, 3, 4, 5].map((v, i) => die(`bd${i}`, v, 'defense'));
    g.players.B.areas.attack = [];
    longteng(g);
    // 防御骰仍是最初那 5 颗（新骰不进、旧骰不挤）
    expect(g.players.B.areas.defense.map((d) => d.id)).toEqual(['bd0', 'bd1', 'bd2', 'bd3', 'bd4']);
    expect(g.players.B.areas.defense.map((d) => d.value)).toEqual([1, 2, 3, 4, 5]);
    // 攻击骰（最大 + 最小）照常获得 2 颗
    expect(g.players.B.areas.attack).toHaveLength(2);
  });

  it('Z01 上限 5：未满时正常补入，旧骰保留', () => {
    const g = make();
    g.players.B.areas.defense = [die('bd0', 1, 'defense'), die('bd1', 2, 'defense')];
    g.players.B.areas.attack = [];
    longteng(g);
    expect(g.players.B.areas.defense).toHaveLength(4); // 2 旧 + 2 新 ≤ 5
    expect(g.players.B.areas.defense.slice(0, 2).map((d) => d.id)).toEqual(['bd0', 'bd1']); // 旧的不动
  });

  it('Z01 上限 5：满 4 时再补 2 → 只进 1 颗（到 5 为止，其余弃置）', () => {
    const g = make();
    g.players.B.areas.defense = [1, 2, 3, 4].map((v, i) => die(`bd${i}`, v, 'defense'));
    g.players.B.areas.attack = [];
    longteng(g);
    expect(g.players.B.areas.defense).toHaveLength(5); // 4 旧 + 1 新
    expect(g.players.B.areas.defense.slice(0, 4).map((d) => d.id)).toEqual(['bd0', 'bd1', 'bd2', 'bd3']);
  });
});

describe('挑战模式 · 传奇防御骰上限 · 门禁（源码扫描）', () => {
  it('game.ts / combat.ts 内 **0 处**直接 `areas.defense.push`（传奇加防御骰只走 `addLegendDefense`）', () => {
    for (const f of ['game', 'combat']) {
      const src = srcOf(f);
      expect(src.length).toBeGreaterThan(0); // 确认读到了源码
      expect(src.match(/\.areas\.defense\.push\(/g) ?? []).toEqual([]);
    }
  });

  it('challenge.ts 的 `addLegendDefense` 是**唯一**往防御骰区 push 的地方', () => {
    const src = srcOf('challenge');
    expect(src.length).toBeGreaterThan(0);
    expect((src.match(/\.areas\.defense\.push\(/g) ?? []).length).toBe(1);
  });
});
