import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll, getLegalActions } from '../src/core/engine/game';
import { effectiveSpeed, totalDice } from '../src/core/engine/derive';
import { attackDamageBuff, pumpAttackQueue } from '../src/core/engine/combat';
import type { DiceKind, GameState, PlayerId } from '../src/core/model/types';

/** A 持 019/020/021（荒野行者 尼萨），B 持 004/005/006（永暗之刃 影） */
const nisaGame = (heroB: [string, string, string] = ['004', '005', '006']): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['019', '020', '021'], heroB });
  skipInitialReroll(g);
  return g;
};

const art = (g: GameState, who: PlayerId, id: string) => g.players[who].artifacts.find((a) => a.id === id)!;

/** 直接让某神器处于「该侧已激活」状态（等价于完成了一次尘起装填） */
const activate = (g: GameState, who: PlayerId, id: string, side: 'left' | 'right'): void => {
  const a = art(g, who, id);
  a.activeMarkerSide = side;
  a.armedSide = side;
  a.armedTurn = g.turnIndex;
};

const toMain = (g: GameState): void => {
  let guard = 0;
  while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) applyAction(g, { t: 'advance' });
};
const until = (g: GameState, pred: () => boolean, max = 60): void => {
  let i = 0;
  while (!pred() && i++ < max && g.phase !== 'gameOver') {
    if (g.pending?.kind === 'chenaiFreeRise') applyAction(g, { t: 'chenaiFreeRise', accept: false });
    else applyAction(g, { t: 'advance' });
  }
};
const atA = (g: GameState, phase: GameState['phase']) => () => g.activePlayer === 'A' && g.phase === phase;

/** 结束当前回合（从主要阶段推进；遇 019 尘起询问则放弃） */
const finishTurn = (g: GameState): void => {
  toMain(g);
  applyAction(g, { t: 'advance' });
  while (g.pending?.kind === 'chenaiFreeRise') applyAction(g, { t: 'chenaiFreeRise', accept: false });
};

/** 尘起行动（默认用第 1 颗冥想骰支付；不足则补一颗） */
const dustRise = (g: GameState, artifactId: string, side?: 'left' | 'right'): void => {
  const p = g.players[g.activePlayer];
  if (p.areas.meditation.length === 0) p.areas.meditation.push({ id: `med-${g.turnIndex}-${artifactId}`, value: 4, kind: 'meditation' });
  const med = p.areas.meditation[0];
  applyAction(g, { t: 'dustRise', artifactId, ...(side ? { side } : {}), costSlots: [{ dieIds: [med.id] }] });
};

describe('021 决意（野火燎原）', () => {
  it('首次充能完成 = 激活：受到 8 点真实伤害、计数 1（FAQ 21.1.1）', () => {
    const g = nisaGame();
    until(g, atA(g, 'dustRise'));
    const card = art(g, 'A', '021');
    const life = g.players.A.life;
    dustRise(g, '021');
    expect(g.players.A.life).toBe(life - 8);
    expect(card.count).toBe(1);
    expect(card.chargeLayer).toBe(1);
    expect(card.activeMarkerSide).toBe('left');
  });

  it('可对已激活的本神器继续充能：计数 +1（上限 5）、回复＝计数的生命（FAQ 21.1.1）', () => {
    const g = nisaGame();
    until(g, atA(g, 'dustRise'));
    const card = art(g, 'A', '021');
    // 第 1 次（激活）：8 伤 + 计数 1
    dustRise(g, '021');
    expect(card.count).toBe(1);
    const lifeAfterFirst = g.players.A.life;
    // 第 2 次：计数 2、回复 2
    finishTurn(g);
    until(g, atA(g, 'dustRise'));
    dustRise(g, '021');
    expect(card.count).toBe(2);
    expect(g.players.A.life).toBe(lifeAfterFirst + 2);
    // 第 3–5 次：计数 3/4/5，回复 3/4/5（回复不超过生命上限）
    for (const want of [3, 4, 5]) {
      const before = g.players.A.life;
      finishTurn(g);
      until(g, atA(g, 'dustRise'));
      dustRise(g, '021');
      expect(card.count).toBe(want);
      expect(g.players.A.life).toBe(Math.min(g.players.A.lifeMax, before + want));
    }
    // 计数 5 后不能再被尘起选中（FAQ 21.1.4）
    finishTurn(g);
    until(g, atA(g, 'dustRise'));
    expect(getLegalActions(g).some((a) => a.t === 'dustRise' && a.artifactId === '021')).toBe(false);
  });

  it('持续分层：计数 1+ 攻击 +1；计数 3+ 同时速度 +1（叠加，FAQ 21.1.2）', () => {
    const g = nisaGame();
    toMain(g);
    const card = art(g, 'A', '021');
    activate(g, 'A', '021', 'left');
    expect(attackDamageBuff(g, 'A')).toBe(0);
    expect(effectiveSpeed(g.players.A)).toBe(4);
    card.count = 1;
    expect(attackDamageBuff(g, 'A')).toBe(1);
    expect(effectiveSpeed(g.players.A)).toBe(4);
    card.count = 3;
    expect(attackDamageBuff(g, 'A')).toBe(1);
    expect(effectiveSpeed(g.players.A)).toBe(5);
    card.count = 5;
    expect(attackDamageBuff(g, 'A')).toBe(1);
    expect(effectiveSpeed(g.players.A)).toBe(5);
  });

  it('计数 5：被抵挡时仍造成一半伤害，且「被抵挡 / 造成伤害」两类效果都可触发（FAQ 21.1.3）', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['004', '017', '021'],
      heroB: ['001', '002', '003'],
    });
    skipInitialReroll(g);
    toMain(g);
    const card = art(g, 'A', '021');
    activate(g, 'A', '021', 'left');
    activate(g, 'A', '004', 'right'); // 锋芒·触发（你的攻击被抵挡后）
    activate(g, 'A', '017', 'right'); // 冥界行走·持续（你的攻击造成伤害后）
    card.count = 5;
    g.players.A.life = 30; // 便于观察回血
    g.players.A.areas.attack.push({ id: 'a-atk', value: 5, kind: 'attack' });
    g.players.B.areas.defense.push({ id: 'b-def', value: 2, kind: 'defense' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a-atk'] }] });
    const bLife = g.players.B.life;
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['b-def'] }] });
    // 被抵挡 → 半伤 floor((5+1)/2) = 3 造成伤害；A 的「造成伤害后」（冥界行走）回 ceil(5/2)=3
    expect(g.players.B.life).toBe(bLife - 3);
    expect(g.players.A.life).toBe(33);
    // 同时「被抵挡后」（锋芒）也询问 → 两类效果都触发（FAQ 21.1.3）
    expect(g.pending?.kind).toBe('fengmang');
    applyAction(g, { t: 'fengmang', accept: false });
  });

  it('1 点攻击被技能减半为 0：既不算被抵挡、也不算造成伤害（FAQ 21.1.6 / 21.1.7）', () => {
    // A 持 001（裁雨流：造成伤害后触发）；B 持 013/011/015（011 灵能屏障）
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['001', '002', '003'],
      heroB: ['013', '011', '015'],
    });
    skipInitialReroll(g);
    toMain(g);
    activate(g, 'B', '011', 'left'); // 011 的「灵能屏障·触发」在该侧
    g.players.A.areas.attack.push({ id: 'a1', value: 1, kind: 'attack' });
    g.players.B.areas.meditation.push({ id: 'b-med', value: 2, kind: 'meditation' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g.pending?.kind).toBe('dunwuHalve');
    applyAction(g, { t: 'dunwuHalve', accept: true, meditationDieId: 'b-med' }); // 1 → 0
    expect(g.pendingAttack?.value).toBe(0);
    const bLife = g.players.B.life;
    applyAction(g, { t: 'block' }); // 不抵挡，但伤害为 0
    expect(g.players.B.life).toBe(bLife);
    // 伤害为 0 → 既不算被抵挡（013 雷暴不触发）也不算造成伤害（001 裁雨流不触发）
    expect(g.pending).toBeNull();
  });

  it('与「灵能屏障」并存：同种削减不叠加，只减半一次（FAQ 21.1.5）', () => {
    // B 持 013/011/015（含 011 灵能屏障）：A（021 计数 5）攻击 6 点，B 先减半再抵挡 → 仍造成一半（3 点）
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['019', '020', '021'],
      heroB: ['013', '011', '015'],
    });
    skipInitialReroll(g);
    toMain(g);
    activate(g, 'B', '011', 'left'); // 011 的「灵能屏障·触发」需要该侧激活
    const card = art(g, 'A', '021');
    activate(g, 'A', '021', 'left');
    card.count = 5;
    g.players.A.areas.attack.push({ id: 'a6', value: 6, kind: 'attack' });
    g.players.B.areas.defense.push({ id: 'b-def', value: 2, kind: 'defense' });
    g.players.B.areas.meditation.push({ id: 'b-med', value: 3, kind: 'meditation' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a6'] }] });
    // 011 灵能屏障触发：B 花 1 冥想骰使伤害减半（6 → 3）
    expect(g.pending?.kind).toBe('dunwuHalve');
    applyAction(g, { t: 'dunwuHalve', accept: true, meditationDieId: 'b-med' });
    expect(g.pendingAttack?.value).toBe(3);
    const bLife = g.players.B.life;
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['b-def'] }] });
    expect(g.players.B.life).toBe(bLife - 3); // 只减半一次（不是四分之一 = 1，也不是 0）
  });
});

describe('020 兽魂（熊之心 / 狼之血）', () => {
  it('激活：将本神器计数重设为 2；两侧都能重置（尘起装填即强制结算）', () => {
    const g = nisaGame();
    until(g, atA(g, 'dustRise'));
    const card = art(g, 'A', '020');
    card.count = 0;
    dustRise(g, '020', 'left');
    expect(card.count).toBe(2);
    expect(card.activeMarkerSide).toBe('left');
    // 下一回合切到右侧 → 再次把计数重设为 2
    card.count = 0;
    finishTurn(g);
    until(g, atA(g, 'dustRise'));
    dustRise(g, '020'); // 无 side → 切换到另一侧
    expect(card.activeMarkerSide).toBe('right');
    expect(card.count).toBe(2);
  });

  it('持续：熊之心 = 攻击伤害 + 计数；狼之血 = 速度 + 计数（同属性取最大）', () => {
    const g = nisaGame();
    toMain(g);
    const card = art(g, 'A', '020');
    card.count = 2;
    activate(g, 'A', '020', 'left');
    expect(attackDamageBuff(g, 'A')).toBe(2);
    expect(effectiveSpeed(g.players.A)).toBe(4);
    activate(g, 'A', '020', 'right');
    expect(attackDamageBuff(g, 'A')).toBe(0);
    expect(effectiveSpeed(g.players.A)).toBe(6);
  });

  it('20.1.1：防守方先决定防御骰，之后才由攻击方决定「取消伤害 / 正常造成伤害」', () => {
    // B 持 020（兽魂）；A 用 3 点攻击骰攻击 B
    const g = createGame({ seed: 1, firstPlayer: 'B', heroA: ['001', '002', '003'], heroB: ['019', '020', '021'] });
    skipInitialReroll(g);
    // 推进到 A 回合（B 先手）
    toMain(g);
    finishTurn(g); // B 回合结束 → A 回合
    until(g, atA(g, 'main'));
    const card = art(g, 'B', '020');
    card.count = 2;
    activate(g, 'B', '020', 'left');
    g.players.A.areas.attack.push({ id: 'a3', value: 3, kind: 'attack' });
    g.players.B.areas.defense.push({ id: 'bd', value: 2, kind: 'defense' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a3'] }] });
    // 此时候选只有「抵挡 / 不抵挡」——兽魂的取消询问尚未出现（必须在防御骰决定之后）
    const opts = getLegalActions(g);
    expect(opts.some((a) => a.t === 'block')).toBe(true);
    expect(g.pending).toBeNull();
    applyAction(g, { t: 'block' }); // 不抵挡 → 兽魂询问（攻击方 = A 决定）
    expect(g.pending?.kind).toBe('shouhunCancel');
    expect(g.pending && g.pending.kind === 'shouhunCancel' ? g.pending.player : null).toBe('A');
    const bLife = g.players.B.life;
    applyAction(g, { t: 'shouhunCancel', cancel: true }); // 取消伤害 → 计数 −1
    expect(g.players.B.life).toBe(bLife);
    expect(card.count).toBe(1);
    // 计数仍 ≥1：再攻击一次仍会询问 → 这次选择「不取消」→ 正常造成伤害
    g.players.A.areas.attack.push({ id: 'a4', value: 4, kind: 'attack' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a4'] }] });
    applyAction(g, { t: 'block' });
    expect(g.pending?.kind).toBe('shouhunCancel');
    applyAction(g, { t: 'shouhunCancel', cancel: false });
    expect(g.players.B.life).toBe(bLife - 4);
    expect(card.count).toBe(1);
    // 计数归 0（让攻击方取消一次）后不再询问：再攻击直接造成伤害
    card.count = 1;
    g.players.A.areas.attack.push({ id: 'a5', value: 2, kind: 'attack' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a5'] }] });
    applyAction(g, { t: 'block' });
    expect(g.pending?.kind).toBe('shouhunCancel');
    applyAction(g, { t: 'shouhunCancel', cancel: true }); // 2 → 0
    expect(card.count).toBe(0);
    g.players.A.areas.attack.push({ id: 'a6', value: 2, kind: 'attack' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a6'] }] });
    applyAction(g, { t: 'block' });
    expect(g.pending).toBeNull();
    expect(g.players.B.life).toBe(bLife - 6);
  });

  it('20.1.2：标记已在该侧时不能重复激活（只能切到另一侧）', () => {
    const g = nisaGame();
    until(g, atA(g, 'dustRise'));
    activate(g, 'A', '020', 'left');
    const acts = getLegalActions(g).filter((a) => a.t === 'dustRise' && a.artifactId === '020');
    expect(acts.every((a) => (a.t === 'dustRise' ? a.side === 'right' : false))).toBe(true);
  });
});

describe('019 尘哀（尘起 / 蛮王之牙）', () => {
  const fangParams = (kinds: DiceKind[], picks: string[]) => {
    const slots = kinds.map((k) => ({ kind: k }));
    return { slots, picks };
  };

  it('蛮王之牙：消耗 X 个种类各不相同的能力骰 → 选 X 项（可重复）；刷新启动次数 + 标记移到另一侧', () => {
    const g = nisaGame();
    toMain(g);
    activate(g, 'A', '019', 'right');
    const card = art(g, 'A', '019');
    g.players.A.areas.attack = [{ id: 'k1', value: 2, kind: 'attack' }];
    g.players.A.areas.defense = [{ id: 'k2', value: 4, kind: 'defense' }];
    g.players.A.areas.meditation = [{ id: 'k3', value: 5, kind: 'meditation' }];
    g.players.B.areas.defense = [{ id: 'b1', value: 3, kind: 'defense' }, { id: 'b2', value: 4, kind: 'defense' }];
    const { picks } = fangParams(['attack', 'defense', 'meditation'], ['discard', 'gain', 'gain']);
    applyAction(g, {
      t: 'skill',
      artifactId: '019',
      side: 'right',
      params: { costSlots: [{ dieIds: ['k1'] }, { dieIds: ['k2'] }, { dieIds: ['k3'] }], picks },
    });
    // ①×1：弃置对方 1 个防御骰；②×2：获得 2 个 3 点攻击骰
    expect(g.players.B.areas.defense.length).toBe(1);
    expect(g.players.A.areas.attack.filter((d) => d.value === 3).length).toBe(2);
    expect(totalDice(g.players.A)).toBe(2);
    // 刷新启动次数（本回合可再次启动）+ 标记移到另一侧
    expect(g.skillsUsedThisTurn.includes('A:chenai.fang')).toBe(false);
    expect(card.activeMarkerSide).toBe('left');
  });

  it('蛮王之牙：种类重复 / 项数不符 → 抛错且不改变状态', () => {
    const g = nisaGame();
    toMain(g);
    activate(g, 'A', '019', 'right');
    g.players.A.areas.attack = [{ id: 'k1', value: 2, kind: 'attack' }, { id: 'k2', value: 3, kind: 'attack' }];
    const before = totalDice(g.players.A);
    // 两个同类（攻击 + 攻击）→ 违反「种类各不相同」
    expect(() =>
      applyAction(g, {
        t: 'skill',
        artifactId: '019',
        side: 'right',
        params: { costSlots: [{ dieIds: ['k1'] }, { dieIds: ['k2'] }], picks: ['gain', 'gain'] },
      }),
    ).toThrow();
    // 项数与消耗数不符
    expect(() =>
      applyAction(g, {
        t: 'skill',
        artifactId: '019',
        side: 'right',
        params: { costSlots: [{ dieIds: ['k1'] }], picks: [] },
      }),
    ).toThrow();
    expect(totalDice(g.players.A)).toBe(before);
  });

  it('尘起：自己回合通过攻击造成伤害后询问（每回合 1 次）→ 免费尘起可立即使用并翻回标记（FAQ 19.1.1 / 19.2.1）', () => {
    const g = nisaGame();
    toMain(g);
    activate(g, 'A', '019', 'right'); // 标记在「蛮王之牙」侧
    const card = art(g, 'A', '019');
    // 启动「蛮王之牙」（消耗 1 枚任意骰 + 选②）→ 标记自动移到「尘起」侧（该侧从而激活）
    g.players.A.areas.attack.push({ id: 'cost1', value: 2, kind: 'attack' });
    applyAction(g, {
      t: 'skill',
      artifactId: '019',
      side: 'right',
      params: { costSlots: [{ dieIds: ['cost1'] }], picks: ['gain'] },
    });
    expect(card.activeMarkerSide).toBe('left');
    // 攻击造成伤害 → 「尘起」触发
    g.players.A.areas.attack.push({ id: 'a-atk', value: 3, kind: 'attack' });
    const medBefore = g.players.A.areas.meditation.length;
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a-atk'] }] });
    applyAction(g, { t: 'block' }); // B 不抵挡 → 造成伤害 → 019 尘起询问
    expect(g.pending?.kind).toBe('chenaiFreeRise');
    applyAction(g, { t: 'chenaiFreeRise', accept: true });
    expect(g.freeNoCostRise).toBe(1);
    // 立即用免费尘起把「尘哀」切回蛮王之牙一侧（不耗冥想骰、不占每回合 1 次）
    applyAction(g, { t: 'dustRise', artifactId: '019', side: 'right', free: true });
    expect(card.activeMarkerSide).toBe('right');
    expect(g.freeNoCostRise).toBe(0);
    expect(g.players.A.areas.meditation.length).toBe(medBefore);
    expect(g.dustRiseNormalCount).toBe(0);
    // 启动次数已刷新 → 本回合可再次启动蛮王之牙（FAQ 19.2.1：最多两次）
    const again = getLegalActions(g).some((a) => a.t === 'skill' && a.artifactId === '019' && a.side === 'right');
    expect(again).toBe(true);
    // 同回合第二次造成伤害不再触发（每回合 1 次）
    g.players.A.areas.attack.push({ id: 'a-atk2', value: 3, kind: 'attack' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a-atk2'] }] });
    applyAction(g, { t: 'block' });
    expect(g.pending?.kind ?? null).not.toBe('chenaiFreeRise');
  });
});

describe('兽魂：多段攻击中「取消伤害」后后续段必须继续（回归 2026-09-25）', () => {
  it('020（阈值1）：取消第一段后第二段照常发起', () => {
    const g = nisaGame();
    toMain(g);
    activate(g, 'A', '020', 'left'); // 熊之心（持续生效）
    art(g, 'A', '020').count = 2;
    g.players.A.areas = { attack: [], defense: [], meditation: [] };
    // 模拟 013 电刑：B 连续两段攻击（5 点、3 点）
    g.attackQueue = { player: 'B', values: [5, 3] };
    pumpAttackQueue(g);
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', value: 5 });

    applyAction(g, { t: 'block' }); // A 不抵挡 → 兽魂触发
    expect(g.pending).toMatchObject({ kind: 'shouhunCancel', owner: 'A' });

    applyAction(g, { t: 'shouhunCancel', cancel: true }); // 取消 → 队列必须继续
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', value: 3 });
    expect(g.attackQueue).toBeNull();
  });

  it('A04（阈值2）：取消第一段（2→1）后第二段照常发起；计数 < 阈值 → 第二段不再提示、直接受伤', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', 'A04', '003'], heroB: ['004', '005', '006'] });
    skipInitialReroll(g);
    toMain(g);
    activate(g, 'A', 'A04', 'left');
    art(g, 'A', 'A04').count = 2;
    g.players.A.areas = { attack: [], defense: [], meditation: [] };
    g.attackQueue = { player: 'B', values: [5, 3] };
    pumpAttackQueue(g);

    applyAction(g, { t: 'block' });
    expect(g.pending).toMatchObject({ kind: 'shouhunCancel', player: 'A', owner: 'A', minCount: 2 });
    applyAction(g, { t: 'shouhunCancel', cancel: true });
    expect(art(g, 'A', 'A04').count).toBe(1);
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', value: 3 }); // 第二段继续

    const life = g.players.A.life;
    applyAction(g, { t: 'block' }); // 第二段：计数1 < 2 → 不再提示
    expect(g.pending?.kind ?? null).not.toBe('shouhunCancel');
    expect(g.players.A.life).toBe(life - 3);
  });
});
