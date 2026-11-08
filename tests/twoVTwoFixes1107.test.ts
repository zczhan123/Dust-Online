// 2026-11-07 修的三处：
//  ① 009「高塔铁幕」选「不取消」时，2v2 会抛 `expected exactly one enemy for B2`（`opponentOf` 不适用于 4 人）
//  ② 「不可抵挡」要写明来源（001 中央突破 / 022 处刑通牒）
//  ③ A05「深空之火」不能被写成「白昼之火」（按 `tianfa` 的 key 取卡名）
import { describe, it, expect } from 'vitest';
import { applyAction, createTwoVTwoGame } from '../src/core/engine/game';
import { attackInfoParts } from '../src/ui/render';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';
import type { GameState } from '../src/core/model/types';

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

const text = (g: GameState, pa: GameState['pendingAttack']): string =>
  attackInfoParts(g, pa!, (s) => `玩家${s}`)
    .map((p) => p.text)
    .join('');

describe('009 高塔铁幕·触发：2v2 选「不取消」', () => {
  it('真伤落到具体座位，不再抛 expected exactly one enemy', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    // B2 持 009 并已生效；A1 对 B2 造成真伤 → 挂 guwangCancel（来源 A1）
    const art = g.players.B2.artifacts.find((a) => a.id === '009')!;
    art.activeMarkerSide = 'right';
    g.players.B2.areas.defense = [{ id: 'b2-d1', value: 4, kind: 'defense' }];
    g.pending = { kind: 'guwangCancel', player: 'B2', amount: 3, source: 'A1' } as never;
    const before = g.teams!.B.life;
    expect(() => applyAction(g, { t: 'guwangCancel', cancel: false } as never)).not.toThrow();
    expect(g.teams!.B.life).toBe(before - 3);
  });
});

describe('「不可抵挡」要写来源', () => {
  it('001 中央突破 → （不可抵挡·「中央突破」）', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    const dieId = g.players.A1.areas.attack[0]!.id;
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: [dieId] }], target: 'B1' } as never);
    // 手动模拟"本回合攻击不可抵挡"的来源标记
    g.pendingAttack!.unblockableLabel = '中央突破';
    g.pendingAttack!.unblockable = true;
    expect(text(g, g.pendingAttack)).toContain('（不可抵挡·「中央突破」）');
  });
});

describe('A05 深空之火 的卡名', () => {
  it('blockKind=meditation + key=tianfa.alt.shenkong → 深空之火（不是白昼之火）', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    g.tianfa.A1 = { blockKind: 'meditation', damageCount: 0, key: 'tianfa.alt.shenkong' } as never;
    const dieId = g.players.A1.areas.attack[0]!.id;
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: [dieId] }], target: 'B1' } as never);
    const t = text(g, g.pendingAttack);
    expect(t).toContain('「深空之火」');
    expect(t).not.toContain('白昼之火');
  });
});
