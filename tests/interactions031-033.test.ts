import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll } from '../src/core/engine/game';
import type { GameState, PlayerId } from '../src/core/model/types';

/**
 * 031–033 的跨卡联动 / §19 抽检。
 * 覆盖：① 真实之剑(010) × 032「恶意·启动」置换；033「死亡亦逝」× 015「残响」的回合结束时点顺序。
 */
const toMain = (g: GameState): void => {
  let guard = 0;
  while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) applyAction(g, { t: 'advance' });
};
const art = (g: GameState, who: PlayerId, id: string) => g.players[who].artifacts.find((a) => a.id === id)!;
const arm = (g: GameState, who: PlayerId, id: string, side: 'left' | 'right'): void => {
  const a = art(g, who, id);
  a.activeMarkerSide = side;
  a.armedSide = side;
  a.armedTurn = g.turnIndex;
};
const clear = (g: GameState, who: PlayerId): void => {
  g.players[who].areas.attack = [];
  g.players[who].areas.defense = [];
  g.players[who].areas.meditation = [];
};
const logs = (g: GameState): string => g.log.map((l) => l.text).join('\n');

describe('§19-① 真实之剑（010）× 032 恶意（启动）', () => {
  it('010 激活时，可用 2 颗任意骰置换出 1 个攻击骰位来支付「恶意」', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['010', '032', '033'], heroB: ['001', '002', '003'] });
    skipInitialReroll(g);
    toMain(g);
    arm(g, 'A', '010', 'left'); // 真实之剑
    arm(g, 'A', '032', 'right'); // 恶意（启动 + 持续）
    clear(g, 'A');
    g.players.A.areas.meditation = [
      { id: 'm1', value: 1, kind: 'meditation' },
      { id: 'm2', value: 2, kind: 'meditation' },
    ];
    applyAction(g, {
      t: 'skill',
      artifactId: '032',
      side: 'right',
      params: { costSlots: [{ dieIds: ['m1', 'm2'] }] },
    });
    // 消耗 2 颗（置换）→ 又获得 2 颗冥想骰 → 净剩 2
    expect(g.players.A.areas.meditation.length).toBe(2);
    expect(logs(g)).toContain('真实之剑');
  });
});

describe('033 死亡亦逝 × 015 残响：回合结束时点顺序', () => {
  it('B 回合结束：先结算「死亡亦逝」待决策，再结算 015 残响计数 −1', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['031', '032', '033'], heroB: ['013', '014', '015'] });
    skipInitialReroll(g);
    // A 的 033 已激活（持续对双方回合结束生效）
    art(g, 'A', '033').activeMarkerSide = 'left';
    // B 的 015 已激活且计数 2
    art(g, 'B', '015').activeMarkerSide = 'left';
    art(g, 'B', '015').count = 2;
    // B 的回合
    g.phase = 'main';
    g.activePlayer = 'B';
    clear(g, 'B');
    g.players.B.areas.meditation = [{ id: 'bm', value: 3, kind: 'meditation' }];
    applyAction(g, { t: 'advance' }); // B 主要阶段结束 → 033 待决策
    expect(g.pending?.kind).toBe('tiaolingPick');
    applyAction(g, { t: 'tiaolingResolve', pick: 'same', dieIds: [] }); // 剩 1 颗 → 全相同 ✓
    // 回合真正结束 → 015 残响计数 −1
    expect(art(g, 'B', '015').count).toBe(1);
    expect(g.activePlayer).toBe('A');
  });
});
