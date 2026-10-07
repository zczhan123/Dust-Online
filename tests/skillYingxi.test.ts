import { describe, it, expect } from 'vitest';
import { applyAction, createGame, skipInitialReroll } from '../src/core/engine/game';
import { fxReset, fxTake } from '../src/core/engine/fx';
import type { Artifact, GameState } from '../src/core/model/types';

/** 给 A 上一件 005（影袭·左，已激活）+ 一颗可被降点的骰。 */
const setup = (): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A' });
  skipInitialReroll(g);
  g.activePlayer = 'A';
  g.phase = 'main';
  g.players.A.artifacts = [
    {
      id: '005',
      name: '影刃',
      column: 2,
      distribution: { defense: [3], attack: [1, 2, 6], meditation: [4, 5] },
      skills: [{ side: 'left', kind: 'activate', key: 'yingle.yingxi' }],
      activeMarkerSide: 'left',
      heldDice: [],
      count: 0,
    } as unknown as Artifact,
  ];
  g.players.A.areas.attack = [];
  g.players.A.areas.defense = [];
  g.players.A.areas.meditation = [{ id: 'md1', value: 5, kind: 'meditation' }];
  return g;
};

describe('005「影袭」：降点换区 → 发 move 动效（旧位→中间翻面→新区域）+ 随后虚拟攻击', () => {
  it('md1（5 点，冥想）降 2 → 3 点（防御），并发一条 move 事件', () => {
    const g = setup();
    fxReset();
    applyAction(g, { t: 'skill', artifactId: '005', side: 'left', params: { dieId: 'md1', x: 2 } });
    // 骰子：冥想 → 防御，值 5 → 3
    expect(g.players.A.areas.meditation.some((d) => d.id === 'md1')).toBe(false);
    const moved = g.players.A.areas.defense.find((d) => d.id === 'md1');
    expect(moved?.value).toBe(3);
    // 动效旁路：move（供"中间翻面、回新区域"，并计入代价时长让攻击等它播完）
    expect(fxTake().some((e) => e.kind === 'move' && e.player === 'A' && e.dieIds.includes('md1'))).toBe(true);
    // 随后发起了虚拟攻击
    expect(g.pendingAttack).not.toBeNull();
  });
});
