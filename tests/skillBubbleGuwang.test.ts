// 009「高塔铁幕」·触发：发动时卡图要弹技能名（skillFired / guwang.trigger）（2026-11-07）。
//
// 用户反馈：009 触发时"卡图没有弹文字动画"，而 011 灵能屏障有 → 查证发现 **1v1 本身也漏了**
// （`case 'guwangCancel'` 没发 fxSkillFired），本次 1v1 一起补回，全模式（含 2v2）生效。
// 门禁：① 发动（消耗防御骰取消真伤）→ 有 skillFired；② 不发动（吃真伤）→ 没有。
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAction, createGame } from '../src/core/engine/game';
import { fxReset, fxTake } from '../src/core/engine/fx';
import type { GameState } from '../src/core/model/types';

/** 起一局，把 009 装到 B 的第三列并"已激活"，再挂上 guwangCancel 待决策。 */
const withGuwangCancel = (amount = 3): GameState => {
  const g = createGame({ seed: 11, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['007', '008', '009'] });
  g.phase = 'main';
  g.activePlayer = 'A';
  const art = g.players.B.artifacts.find((a) => a.id === '009')!;
  art.activeMarkerSide = 'right'; // 第三列 `side:'only'`：标记非空即视为生效
  g.players.B.areas.defense = [{ id: 'B-d1', value: 4, kind: 'defense' }];
  g.pending = { kind: 'guwangCancel', player: 'B', amount } as never;
  fxReset();
  return g;
};

const fired = () =>
  fxTake()
    .filter((e) => e.kind === 'skillFired')
    .map((e) => (e.kind === 'skillFired' ? e.skillKey : undefined));

beforeEach(() => fxReset());

describe('009 高塔铁幕·触发 → 卡图弹技能名', () => {
  it('发动（消耗 1 防御骰取消真伤）→ fxTake 含 skillFired / guwang.trigger', () => {
    const g = withGuwangCancel(3);
    applyAction(g, { t: 'guwangCancel', cancel: true, defenseDieId: 'B-d1' } as never);
    expect(fired()).toEqual(['guwang.trigger']);
  });

  it('不发动（吃 3 点真伤）→ 不弹技能名', () => {
    const g = withGuwangCancel(3);
    applyAction(g, { t: 'guwangCancel', cancel: false } as never);
    expect(fired()).toEqual([]);
  });
});
