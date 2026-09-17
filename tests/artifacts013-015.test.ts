import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll, getLegalActions } from '../src/core/engine/game';
import { effectiveWill } from '../src/core/engine/derive';
import { attackDamageBuff } from '../src/core/engine/combat';
import type { GameState, PlayerId } from '../src/core/model/types';

/** A 持 013/014/015（佐雷），并跳过初始重掷进入第一回合 */
const zorayGame = (): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['013', '014', '015'], heroB: ['001', '002', '003'] });
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

  it('「净化」：把对方 1 点骰变 6 点并按其分布落区；≥1 变更 → 自己得 2 冥想并受 2 真伤', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['013', '014', '015'],
      heroB: ['001', '002', '003'],
    });
    skipInitialReroll(g);
    until(g, atA(g, 'dustRise'));
    dustRise(g, '014', 'left');
    until(g, atA(g, 'main'));

    // 对方（B）第二列 = 002，分布 防{1,6} 攻{3,4} 冥{2,5} → 6 点落到「防御区」
    g.players.B.areas.attack = [
      { id: 'b1', value: 1, kind: 'attack' },
      { id: 'b2', value: 2, kind: 'attack' },
    ];
    g.players.B.areas.meditation.push({ id: 'bm1', value: 1, kind: 'meditation' });
    const lifeBefore = g.players.A.life;
    const medBefore = g.players.A.areas.meditation.length;

    applyAction(g, {
      t: 'skill',
      artifactId: '014',
      side: 'left',
      params: { targetDieIds: ['b1', 'bm1'] },
    });

    expect(g.players.B.areas.defense.some((d) => d.id === 'b1' && d.value === 6)).toBe(true);
    expect(g.players.B.areas.defense.some((d) => d.id === 'bm1' && d.value === 6)).toBe(true);
    expect(g.players.A.life).toBe(lifeBefore - 2); // 受到 2 点真实伤害
    expect(g.players.A.areas.meditation.length).toBe(medBefore + 2); // 获得 2 个随机冥想骰
  });

  it('「净化」：选 0 个 → 不受伤、不得冥想骰（也校验只能改 1 点骰）', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['013', '014', '015'],
      heroB: ['001', '002', '003'],
    });
    skipInitialReroll(g);
    until(g, atA(g, 'dustRise'));
    dustRise(g, '014', 'left');
    until(g, atA(g, 'main'));

    g.players.B.areas.attack = [{ id: 'b9', value: 3, kind: 'attack' }];
    const lifeBefore = g.players.A.life;
    const medBefore = g.players.A.areas.meditation.length;

    applyAction(g, { t: 'skill', artifactId: '014', side: 'left', params: { targetDieIds: [] } });
    expect(g.players.A.life).toBe(lifeBefore);
    expect(g.players.A.areas.meditation.length).toBe(medBefore);

    // 非 1 点骰不可变更（引擎抛错，不静默）
    expect(() =>
      applyAction(g, {
        t: 'skill',
        artifactId: '014',
        side: 'left',
        params: { targetDieIds: ['b9'] },
      }),
    ).toThrow();
  });

  it('「数罪并罚」：改自己的 1 点骰为 6 点并按 014 分布（6 → 攻击区）落区', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['013', '014', '015'], heroB: ['001', '002', '003'] });
    skipInitialReroll(g);
    until(g, atA(g, 'dustRise'));
    dustRise(g, '014', 'left'); // 先激活左侧
    until(g, atA(g, 'main'));
    applyAction(g, { t: 'advance' }); // 结束回合
    until(g, atA(g, 'dustRise'));
    dustRise(g, '014'); // 切换 → 右侧（数罪并罚）
    expect(art(g, '014').activeMarkerSide).toBe('right');
    until(g, atA(g, 'main'));

    g.players.A.areas.meditation.push({ id: 'a1', value: 1, kind: 'meditation' });
    const lifeBefore = g.players.A.life;
    applyAction(g, {
      t: 'skill',
      artifactId: '014',
      side: 'right',
      params: { targetDieIds: ['a1'] },
    });
    // 014 分布 防{1,4} 攻{2,6} 冥{3,5} → 6 点 → 攻击区
    expect(g.players.A.areas.attack.some((d) => d.id === 'a1' && d.value === 6)).toBe(true);
    expect(g.players.A.life).toBe(lifeBefore - 2);
  });
});

describe('013 鸣雷（电刑 / 雷暴）', () => {
  it('「电刑」：使用攻击骰后可用；消耗 2 冥想骰 → 依次以 1、2、3 点攻击（逐段独立结算）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['013', '014', '015'], heroB: ['001', '002', '003'] });
    skipInitialReroll(g);
    // 激活 013 左侧（电刑）
    until(g, atA(g, 'dustRise'));
    dustRise(g, '013', 'left');
    until(g, atA(g, 'main'));

    // 未使用攻击骰前：不提供「电刑」
    const skillActions = () =>
      getLegalActions(g).filter((a) => a.t === 'skill' && a.artifactId === '013');
    expect(skillActions()).toEqual([]);

    // 使用 1 个攻击骰（B 不抵挡）
    g.players.A.areas.attack.push({ id: 'a-atk', value: 2, kind: 'attack' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a-atk'] }] });
    applyAction(g, { t: 'block' }); // 不抵挡 → 造成伤害
    expect(g.attackedThisTurn).toBe(true);

    // 提供「电刑」（需 2 个冥想骰）
    const g2 = g;
    g2.players.A.areas.meditation.push({ id: 'm1', value: 3, kind: 'meditation' });
    g2.players.A.areas.meditation.push({ id: 'm2', value: 5, kind: 'meditation' });
    expect(skillActions().length).toBe(1);

    applyAction(g2, {
      t: 'skill',
      artifactId: '013',
      side: 'left',
      params: { costSlots: [{ dieIds: ['m1'] }, { dieIds: ['m2'] }] },
    });
    // 第一段（1 点）待抵挡
    expect(g2.pendingAttack?.value).toBe(1);
    applyAction(g2, { t: 'block' }); // 不抵挡 → 扣血
    expect(g2.pendingAttack?.value).toBe(2); // 第二段
    applyAction(g2, { t: 'block' });
    expect(g2.pendingAttack?.value).toBe(3); // 第三段
    applyAction(g2, { t: 'block' });
    expect(g2.pendingAttack).toBeNull();
    expect(g2.attackQueue).toBeNull();
    void skillActions;
  });

  it('「雷暴·触发」：攻击被抵挡后可把最多 2 个冥想骰移到攻击骰区（保留点数）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['013', '014', '015'], heroB: ['001', '002', '003'] });
    skipInitialReroll(g);
    until(g, atA(g, 'dustRise'));
    dustRise(g, '013', 'right'); // 雷暴在右侧
    until(g, atA(g, 'main'));

    g.players.A.areas.attack.push({ id: 'a-atk', value: 4, kind: 'attack' });
    g.players.A.areas.meditation.push({ id: 'm1', value: 2, kind: 'meditation' });
    g.players.B.areas.defense.push({ id: 'b-def', value: 3, kind: 'defense' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a-atk'] }] });
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['b-def'] }] }); // 被抵挡
    expect(g.attackBlockedThisTurn).toBe(true);

    applyAction(g, {
      t: 'skill',
      artifactId: '013',
      side: 'right',
      params: { moveIds: ['m1'] },
    });
    expect(g.players.A.areas.attack.some((d) => d.id === 'm1' && d.value === 2)).toBe(true);
    expect(g.players.A.areas.meditation.some((d) => d.id === 'm1')).toBe(false);
    expect(g.attackBlockedThisTurn).toBe(false); // 每次被抵挡后至多发动一次
  });

  it('「雷暴·持续」：对方重掷阶段结束时询问；接受 → 插入额外重掷阶段（重掷 1 次后恢复原流程）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['013', '014', '015'], heroB: ['001', '002', '003'] });
    skipInitialReroll(g);
    // A 激活 013 右侧（雷暴触发 + 持续）
    until(g, atA(g, 'dustRise'));
    dustRise(g, '013', 'right');
    until(g, atA(g, 'main'));
    applyAction(g, { t: 'advance' }); // 结束 A 回合 → B 回合

    // B 的重掷阶段结束时 → 询问 A
    until(g, () => g.activePlayer === 'B' && g.phase === 'reroll');
    applyAction(g, { t: 'advance' }); // 结束 B 的重掷阶段
    expect(g.pending?.kind).toBe('leibaoReroll');
    expect(getLegalActions(g).map((a) => a.t)).toEqual(['leibaoReroll', 'leibaoReroll']);

    applyAction(g, { t: 'leibaoReroll', accept: true });
    expect(g.extraReroll).toEqual({ player: 'A', resume: 'B' });
    expect(g.activePlayer).toBe('A');
    expect(g.phase).toBe('reroll');
    // 额外重掷阶段：allowance = 1（游龙不叠加），速度限制照常
    const rr = getLegalActions(g).filter((a) => a.t === 'reroll');
    expect(rr.length).toBeGreaterThan(0);
    applyAction(g, rr[0]);
    expect(g.rerollUsed).toBe(1);
    expect(getLegalActions(g).some((a) => a.t === 'reroll')).toBe(false); // 只允许 1 次

    applyAction(g, { t: 'advance' }); // 结束额外重掷阶段
    expect(g.extraReroll).toBeNull();
    expect(g.activePlayer).toBe('B'); // 交还原玩家
    expect(g.phase).toBe('dustRise');
  });

  it('「雷暴·持续」：放弃时不改变流程', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['013', '014', '015'], heroB: ['001', '002', '003'] });
    skipInitialReroll(g);
    until(g, atA(g, 'dustRise'));
    dustRise(g, '013', 'right');
    until(g, atA(g, 'main'));
    applyAction(g, { t: 'advance' });
    until(g, () => g.activePlayer === 'B' && g.phase === 'reroll');
    applyAction(g, { t: 'advance' });
    applyAction(g, { t: 'leibaoReroll', accept: false });
    expect(g.extraReroll).toBeNull();
    expect(g.activePlayer).toBe('B');
    expect(g.phase).toBe('dustRise');
  });
});
