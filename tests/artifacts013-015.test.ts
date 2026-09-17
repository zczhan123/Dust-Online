import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll, getLegalActions } from '../src/core/engine/game';
import { effectiveWill } from '../src/core/engine/derive';
import { attackDamageBuff } from '../src/core/engine/combat';
import type { GameState, PlayerId } from '../src/core/model/types';

/** A 持 013/014/015（佐雷），并跳过初始重掷进入第一回合 */
const zorayGame = (): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['013', '014', '015'] });
  skipInitialReroll(g);
  return g;
};

const art = (g: GameState, id: string) => g.players.A.artifacts.find((a) => a.id === id)!;

/** 让第三列神器完成充能（激活） */
const charge = (g: GameState, id: string): void => {
  const a = art(g, id);
  a.chargeLayer = a.chargeReq ?? 0;
  a.activeMarkerSide = 'left';
  a.armedSide = 'left';
  a.armedTurn = g.turnIndex;
};

/** 推进到「主要阶段」（必要时跳过尘起） */
const toMain = (g: GameState): void => {
  let guard = 0;
  while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 10) {
    applyAction(g, { t: 'advance' });
  }
};

/** 推进到「尘起阶段」 */
const toDustRise = (g: GameState): void => {
  let guard = 0;
  while (g.phase !== 'dustRise' && g.phase !== 'gameOver' && guard++ < 10) {
    applyAction(g, { t: 'advance' });
  }
};

/** 在当前回合的尘起阶段，为指定神器支付 1 颗冥想骰完成 激活/切换 */
const dustRise = (g: GameState, artifactId: string, side?: 'left' | 'right'): void => {
  const player: PlayerId = g.activePlayer;
  const p = g.players[player];
  let med = p.areas.meditation[0];
  if (!med) {
    med = { id: `med-${g.turnIndex}-${artifactId}`, value: 4, kind: 'meditation' };
    p.areas.meditation.push(med);
  }
  applyAction(g, {
    t: 'dustRise',
    artifactId,
    ...(side ? { side } : {}),
    costSlots: [{ dieIds: [med.id] }],
  });
};

/** 结束当前回合（从主要阶段推进） */
const finishTurn = (g: GameState): void => {
  toMain(g);
  applyAction(g, { t: 'advance' });
};

/** 反复推进（advance）直到谓词成立（guard 防死循环） */
const until = (g: GameState, pred: () => boolean, max = 40): void => {
  let i = 0;
  while (!pred() && i++ < max && g.phase !== 'gameOver') applyAction(g, { t: 'advance' });
};
const atA = (g: GameState, phase: GameState['phase']) => () =>
  g.activePlayer === 'A' && g.phase === phase;

describe('015 残响（持续 + 必杀）', () => {
  it('未激活时：持续不生效（意志不加、攻击伤害不加、计数不衰减）', () => {
    const g = zorayGame();
    const a = art(g, '015');
    a.count = 3;
    expect(effectiveWill(g.players.A)).toBe(9);
    expect(attackDamageBuff(g, 'A')).toBe(0);
    finishTurn(g);
    expect(a.count).toBe(3);
  });

  it('激活后：意志 +1、攻击伤害 +计数；回合结束计数 -1（最低 0）', () => {
    const g = zorayGame();
    charge(g, '015');
    expect(effectiveWill(g.players.A)).toBe(10);

    const a = art(g, '015');
    a.count = 2;
    expect(attackDamageBuff(g, 'A')).toBe(2);

    finishTurn(g); // A 的回合结束 → 计数 2 → 1
    expect(a.count).toBe(1);

    a.count = 0;
    finishTurn(g); // 归 0 后不再变负
    expect(a.count).toBe(0);
  });

  it('必杀「绝境天神」：计数 = ⌊(初始生命−当前生命)/10⌋，上限 4，且为一次性', () => {
    const g = zorayGame();
    charge(g, '015');
    g.players.A.life = 30; // 50-30=20 → 2 层
    toMain(g);
    applyAction(g, { t: 'skill', artifactId: '015', side: 'only' });
    expect(art(g, '015').count).toBe(2);
    expect(g.ultimatesUsed).toContain('canxiang.juejing.ultimate');

    const g2 = zorayGame();
    charge(g2, '015');
    g2.players.A.life = 1;
    toMain(g2);
    applyAction(g2, { t: 'skill', artifactId: '015', side: 'only' });
    expect(art(g2, '015').count).toBe(4); // 上限 4
    expect(() => applyAction(g2, { t: 'skill', artifactId: '015', side: 'only' })).toThrow();
  });
});

describe('014 惩戒（激活类规则）', () => {
  const available = (g: GameState): string[] =>
    getLegalActions(g)
      .filter((a) => a.t === 'skill' && a.artifactId === '014')
      .map((a) => (a.t === 'skill' ? a.side : ''));

  it('未激活时不可用；切入左侧后仅该侧可用；之后回合失效；切换/切回重新装填', () => {
    const g = zorayGame();
    toMain(g);
    expect(available(g)).toEqual([]); // 未激活任何一侧

    const s = zorayGame();
    // 回合 1：尘起切入左侧
    until(s, atA(s, 'dustRise'));
    dustRise(s, '014', 'left');
    expect(art(s, '014').armedSide).toBe('left');
    expect(art(s, '014').armedTurn).toBe(s.turnIndex);
    until(s, atA(s, 'main'));
    expect(available(s)).toEqual(['left']); // 切入当回合可用

    // 结束本回合，并在下一个 A 回合「不尘起」直接进入主要阶段 → 上回合的激活已失效
    toMain(s);
    applyAction(s, { t: 'advance' });
    until(s, atA(s, 'main'));
    expect(available(s)).toEqual([]);

    // 结束本回合；再下一个 A 回合：尘起切换 → 右侧可用
    toMain(s);
    applyAction(s, { t: 'advance' });
    until(s, atA(s, 'dustRise'));
    dustRise(s, '014'); // 无 side → 切换到另一侧
    expect(art(s, '014').activeMarkerSide).toBe('right');
    until(s, atA(s, 'main'));
    expect(available(s)).toEqual(['right']);

    // 结束本回合；再下一个 A 回合：切回左侧 → 重新装填
    toMain(s);
    applyAction(s, { t: 'advance' });
    until(s, atA(s, 'dustRise'));
    dustRise(s, '014');
    expect(art(s, '014').activeMarkerSide).toBe('left');
    until(s, atA(s, 'main'));
    expect(available(s)).toEqual(['left']);
  });
});
