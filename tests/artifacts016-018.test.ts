import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll, getLegalActions } from '../src/core/engine/game';
import { effectiveSpeed, effectiveWill, totalDice, emptyDistribution } from '../src/core/engine/derive';
import { hasActiveSkill } from '../src/core/engine/skill-state';
import { areaOf } from '../src/core/model/dice';
import type { DiceKind, GameState, PlayerId } from '../src/core/model/types';

/** A 持 016/017/018（漆黑死神 修），并跳过初始重掷进入第一回合 */
const xiuGame = (): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['016', '017', '018'], heroB: ['001', '002', '003'] });
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

/** 让第三列神器完成充能（激活） */
const charge = (g: GameState, who: PlayerId, id: string): void => {
  const a = art(g, who, id);
  a.chargeLayer = a.chargeReq ?? 0;
  a.activeMarkerSide = 'left';
  a.armedSide = 'left';
  a.armedTurn = g.turnIndex;
};

/** 给某玩家塞入指定骰（先弃掉多余骰，避免结束阶段按意志上限自动弃置，干扰断言） */
const giveDice = (g: GameState, who: PlayerId, dice: { id: string; value: number; kind: DiceKind }[]): void => {
  const p = g.players[who];
  const cap = effectiveWill(p);
  while (totalDice(p) + dice.length > cap) {
    const taken = p.areas.meditation.pop() ?? p.areas.defense.pop() ?? p.areas.attack.pop();
    if (!taken) break;
  }
  for (const d of dice) p.areas[d.kind].push(d);
};

const toMain = (g: GameState): void => {
  let guard = 0;
  while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) applyAction(g, { t: 'advance' });
};



const finishTurn = (g: GameState): void => {
  toMain(g);
  applyAction(g, { t: 'advance' });
};

const until = (g: GameState, pred: () => boolean, max = 60): void => {
  let i = 0;
  while (!pred() && i++ < max && g.phase !== 'gameOver') applyAction(g, { t: 'advance' });
};
const atA = (g: GameState, phase: GameState['phase']) => () => g.activePlayer === 'A' && g.phase === phase;
const atB = (g: GameState, phase: GameState['phase']) => () => g.activePlayer === 'B' && g.phase === phase;

const skillActions = (g: GameState, id: string): string[] =>
  getLegalActions(g)
    .filter((a) => a.t === 'skill' && a.artifactId === id)
    .map((a) => (a.t === 'skill' ? `${a.side}` : ''));

describe('016 虚臾（虚无形态 / 献祭）', () => {
  it('「虚无形态」：装填左侧即强制结算 → 受 10 真伤 + 获得 3 点骰直至总数达意志上限（FAQ 16.1.1）', () => {
    const g = xiuGame();
    until(g, atA(g, 'dustRise'));
    // 只留 3 个冥想骰：尘起消耗 1 个 → 剩 2 个 → 可补 8-2=6 个
    g.players.A.areas.attack = [];
    g.players.A.areas.defense = [];
    g.players.A.areas.meditation = [
      { id: 'm1', value: 2, kind: 'meditation' },
      { id: 'm2', value: 5, kind: 'meditation' },
      { id: 'm3', value: 3, kind: 'meditation' },
    ];
    const life = g.players.A.life;
    applyAction(g, { t: 'dustRise', artifactId: '016', side: 'left', costSlots: [{ dieIds: ['m1'] }] });
    // 装填即强制：出现待决策，不能跳过
    expect(g.pending?.kind).toBe('activationResolve');
    expect(() => applyAction(g, { t: 'advance' })).toThrow();
    expect(effectiveWill(g.players.A)).toBe(8);
    expect(totalDice(g.players.A)).toBe(2);

    applyAction(g, { t: 'skill', artifactId: '016', side: 'left', params: { kind: 'attack' } });
    expect(g.players.A.life).toBe(life - 10); // 10 点真实伤害
    const gained = g.players.A.areas.attack.filter((d) => d.value === 3);
    expect(gained.length).toBe(6); // 8 - 2 = 6
    expect(totalDice(g.players.A)).toBe(8);
  });

  it('「虚无形态」持续：仅左侧激活时速度 +2；切到右侧后失去', () => {
    const g = xiuGame();
    expect(effectiveSpeed(g.players.A)).toBe(3);
    activate(g, 'A', '016', 'left');
    expect(effectiveSpeed(g.players.A)).toBe(5);
    activate(g, 'A', '016', 'right');
    expect(effectiveSpeed(g.players.A)).toBe(3);
  });

  it('「献祭」①：受 4 真伤 → 获得 3 个随机点数能力骰并按其点数落区', () => {
    const g = xiuGame();
    toMain(g);
    activate(g, 'A', '016', 'right');
    const dist = emptyDistribution(g.players.A)!;
    g.players.A.areas.attack = [];
    g.players.A.areas.defense = [];
    g.players.A.areas.meditation = [];
    const life = g.players.A.life;
    applyAction(g, { t: 'skill', artifactId: '016', side: 'right', params: { choice: 'dice' } });
    expect(g.players.A.life).toBe(life - 4);
    expect(totalDice(g.players.A)).toBe(3);
    for (const k of ['attack', 'defense', 'meditation'] as DiceKind[]) {
      for (const d of g.players.A.areas[k]) expect(areaOf(d.value, dist)).toBe(k);
    }
  });

  it('「献祭」②：本回合攻击伤害 +2（回合结束清除）', () => {
    const g = xiuGame();
    toMain(g);
    activate(g, 'A', '016', 'right');
    g.players.A.areas.attack.push({ id: 'atk', value: 2, kind: 'attack' });
    const life = g.players.A.life;
    applyAction(g, { t: 'skill', artifactId: '016', side: 'right', params: { choice: 'damage' } });
    expect(g.players.A.life).toBe(life - 4);
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['atk'] }] });
    expect(g.pendingAttack?.value).toBe(4); // 2 + 2
    applyAction(g, { t: 'block' });
    // 回合结束 → thisTurn buff 清除
    finishTurn(g);
    until(g, atA(g, 'main'));
    g.players.A.areas.attack.push({ id: 'atk2', value: 2, kind: 'attack' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['atk2'] }] });
    expect(g.pendingAttack?.value).toBe(2);
    applyAction(g, { t: 'block' });
  });

  it('FAQ 16.2.1：「献祭」可让能力骰总数超意志上限，但结束阶段弃回上限', () => {
    const g = xiuGame();
    toMain(g);
    activate(g, 'A', '016', 'right');
    g.players.A.areas.attack = [];
    g.players.A.areas.defense = [];
    g.players.A.areas.meditation = [];
    // 意志上限 8：先塞满 8 颗，再献祭 ① 拿 3 颗 → 11 > 8
    for (let i = 0; i < 8; i++) g.players.A.areas.meditation.push({ id: `x${i}`, value: 3, kind: 'meditation' });
    applyAction(g, { t: 'skill', artifactId: '016', side: 'right', params: { choice: 'dice' } });
    expect(totalDice(g.players.A)).toBe(11);
    finishTurn(g);
    expect(totalDice(g.players.A)).toBe(effectiveWill(g.players.A)); // 结束阶段弃回上限
  });
});

describe('017 幽冥（帷幕 / 冥界行走）', () => {
  it('「帷幕」：对方重掷阶段结束时询问；发动 = 受 2 真伤 + 弃置对方 1 个能力骰（上限固定，不可加码）', () => {
    const g = xiuGame();
    toMain(g);
    activate(g, 'A', '017', 'left'); // A 持帷幕（左侧）
    giveDice(g, 'B', [{ id: 'b1', value: 3, kind: 'attack' }, { id: 'b2', value: 4, kind: 'defense' }]);
    finishTurn(g); // A 回合结束
    until(g, atB(g, 'reroll')); // 推进到 B 的重掷阶段
    applyAction(g, { t: 'advance' }); // B 重掷阶段结束 → 询问 A（帷幕持有者）
    expect(g.pending?.kind).toBe('weimu');
    expect(g.pending && g.pending.kind === 'weimu' ? g.pending.player : null).toBe('A');
    // 只能弃 1 个（不提供「弃 2 个」的加码）
    const opts = getLegalActions(g);
    expect(opts.length).toBe(1 + totalDice(g.players.B)); // 不发动 + B 的全部能力骰（只能弃 1 个）
    expect(opts.some((a) => a.t === 'weimu' && a.accept && a.dieId === 'b1')).toBe(true);

    const aLife = g.players.A.life;
    applyAction(g, { t: 'weimu', accept: true, dieId: 'b1' });
    expect(g.players.A.life).toBe(aLife - 2); // 自己受到 2 点真实伤害
    expect(g.players.B.areas.attack.some((d) => d.id === 'b1')).toBe(false); // 弃置对方 1 个能力骰
    expect(g.pending).toBeNull();
  });

  it('「帷幕」：不发动则无任何副作用', () => {
    const g = xiuGame();
    toMain(g);
    activate(g, 'A', '017', 'left');
    giveDice(g, 'B', [{ id: 'b1', value: 3, kind: 'attack' }]);
    finishTurn(g);
    until(g, atB(g, 'reroll'));
    applyAction(g, { t: 'advance' });
    expect(g.pending?.kind).toBe('weimu');
    const life = g.players.A.life;
    applyAction(g, { t: 'weimu', accept: false });
    expect(g.players.A.life).toBe(life);
    expect(g.players.B.areas.attack.some((d) => d.id === 'b1')).toBe(true);
    expect(g.pending).toBeNull();
  });

  it('「帷幕」在 013 雷暴的额外重掷阶段结束时可以再次触发（FAQ 17.1.2）', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['013', '014', '015'], // A 有雷暴·持续（右侧）
      heroB: ['016', '017', '018'], // B 有帷幕（左侧）
    });
    skipInitialReroll(g);
    toMain(g);
    activate(g, 'A', '013', 'right');
    activate(g, 'B', '017', 'left');
    applyAction(g, { t: 'advance' }); // A 回合结束
    // 推进到 B 的重掷阶段；途中遇到 B 的帷幕（A 重掷阶段结束时触发）一律放弃
    let guard = 0;
    while (!atB(g, 'reroll')() && guard++ < 60 && g.phase !== 'gameOver') {
      if (g.pending?.kind === 'weimu') applyAction(g, { t: 'weimu', accept: false });
      else applyAction(g, { t: 'advance' });
    }
    applyAction(g, { t: 'advance' }); // B 重掷阶段结束 → A 的雷暴（插入额外重掷）
    expect(g.pending?.kind).toBe('leibaoReroll');
    applyAction(g, { t: 'leibaoReroll', accept: true }); // A 插入额外重掷阶段
    expect(g.phase).toBe('reroll');
    expect(g.activePlayer).toBe('A');
    applyAction(g, { t: 'advance' }); // A 的额外重掷阶段结束 → B 的帷幕「再次触发」
    expect(g.pending?.kind).toBe('weimu');
    expect(g.pending && g.pending.kind === 'weimu' ? g.pending.player : null).toBe('B');
    applyAction(g, { t: 'weimu', accept: false });
    expect(g.phase).toBe('dustRise');
  });

  it('「冥界行走」启动：消耗最多 3 个冥想骰 → 获得同等数量随机攻击骰；0/4 抛错', () => {
    const g = xiuGame();
    toMain(g);
    activate(g, 'A', '017', 'right');
    g.players.A.areas.meditation = [
      { id: 'm1', value: 2, kind: 'meditation' },
      { id: 'm2', value: 5, kind: 'meditation' },
      { id: 'm3', value: 6, kind: 'meditation' },
      { id: 'm4', value: 1, kind: 'meditation' },
    ];
    g.players.A.areas.attack = [];
    applyAction(g, {
      t: 'skill',
      artifactId: '017',
      side: 'right',
      params: { costSlots: [{ dieIds: ['m1'] }, { dieIds: ['m2'] }] },
    });
    expect(g.players.A.areas.attack.length).toBe(2);
    expect(g.players.A.areas.meditation.length).toBe(2);

    const g2 = xiuGame();
    toMain(g2);
    activate(g2, 'A', '017', 'right');
    g2.players.A.areas.meditation.push({ id: 'mm', value: 3, kind: 'meditation' });
    expect(() => applyAction(g2, { t: 'skill', artifactId: '017', side: 'right', params: { costSlots: [] } })).toThrow();
    expect(() =>
      applyAction(g2, {
        t: 'skill',
        artifactId: '017',
        side: 'right',
        params: { costSlots: [{ dieIds: ['mm'] }, { dieIds: ['mm'] }, { dieIds: ['mm'] }, { dieIds: ['mm'] }] },
      }),
    ).toThrow();
  });

  it('「冥界行走」持续：攻击造成伤害后回复 ceil(点数/2)（不超上限）；6 点则受 3 真伤', () => {
    const g = xiuGame();
    toMain(g);
    activate(g, 'A', '017', 'right');
    g.players.A.life = 30;
    g.players.A.areas.attack.push({ id: 'a1', value: 1, kind: 'attack' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    applyAction(g, { t: 'block' }); // B 不抵挡 → 造成 1 点伤害 → A 回复 1
    expect(g.players.A.life).toBe(31);

    g.players.A.areas.attack.push({ id: 'a6', value: 6, kind: 'attack' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a6'] }] });
    applyAction(g, { t: 'block' }); // 造成 6 点伤害 → A 受 3 真伤
    expect(g.players.A.life).toBe(28);
  });

  it('「冥界行走」持续：回复不会超过生命上限（FAQ 17.2.1）', () => {
    const g = xiuGame();
    toMain(g);
    activate(g, 'A', '017', 'right');
    g.players.A.life = g.players.A.lifeMax - 1;
    g.players.A.areas.attack.push({ id: 'a5', value: 5, kind: 'attack' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a5'] }] });
    applyAction(g, { t: 'block' });
    expect(g.players.A.life).toBe(g.players.A.lifeMax);
  });
});

describe('018 至黑（漆黑绽放）', () => {
  it('持续：每回合第一次受伤才计数；同回合第二次不加；下个回合再加', () => {
    const g = xiuGame();
    charge(g, 'A', '018');
    const card = art(g, 'A', '018');
    // B 回合：连续两次攻击 A（A 不抵挡）
    finishTurn(g);
    toMain(g);
    giveDice(g, 'B', [{ id: 'b1', value: 2, kind: 'attack' }, { id: 'b2', value: 2, kind: 'attack' }]);
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['b1'] }] });
    applyAction(g, { t: 'block' });
    expect(card.count).toBe(1);
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['b2'] }] });
    applyAction(g, { t: 'block' });
    expect(card.count).toBe(1); // 同回合第二次受伤不计数
    // 结束 B 回合 → A 回合：自己受 4 真伤（献祭）→ 新回合的第一次受伤 → +1
    toMain(g);
    applyAction(g, { t: 'advance' });
    until(g, atA(g, 'main'));
    activate(g, 'A', '016', 'right');
    applyAction(g, { t: 'skill', artifactId: '016', side: 'right', params: { choice: 'dice' } });
    expect(card.count).toBe(2);
  });

  it('未充能（未激活）时持续不生效、也不计数', () => {
    const g = xiuGame();
    const card = art(g, 'A', '018');
    finishTurn(g);
    toMain(g);
    giveDice(g, 'B', [{ id: 'b1', value: 2, kind: 'attack' }]);
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['b1'] }] });
    applyAction(g, { t: 'block' });
    expect(card.count).toBe(0);
  });

  it('计数达 5 → 无论谁的回合都强制发动必杀（获得 5 骰 → 可选重掷 → 失去持续）', () => {
    const g = xiuGame();
    charge(g, 'A', '018');
    const card = art(g, 'A', '018');
    card.count = 4;
    // B 回合攻击 A（不抵挡）→ 第 5 次计数 → 强制必杀
    finishTurn(g);
    toMain(g);
    giveDice(g, 'B', [{ id: 'b1', value: 2, kind: 'attack' }]);
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['b1'] }] });
    const g1 = { before: g.players.A.areas.attack.length + g.players.A.areas.defense.length + g.players.A.areas.meditation.length };
    applyAction(g, { t: 'block' }); // A 不抵挡 → 受伤 → 计数 5 → 强制必杀
    expect(card.count).toBe(5);
    expect(card.continuousLost).toBe(true);
    expect(g.ultimatesUsed).toContain('zhihai.bloom.ultimate');
    expect(g.pending?.kind).toBe('zhihaiReroll');
    expect(g.pending && g.pending.kind === 'zhihaiReroll' ? g.pending.x : 0).toBe(5);
    expect(totalDice(g.players.A)).toBe(g1.before + 5); // 已获得 5 个随机能力骰

    // 强制必杀期间不能继续攻击（攻击与攻击之间是可中断的时点，FAQ 18.1.2）
    expect(() => applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['b1'] }] })).toThrow();

    // 重掷 0 颗也可以（「最多 X 颗」）
    const firstDie = g.players.A.areas.attack[0] ?? g.players.A.areas.defense[0];
    applyAction(g, { t: 'zhihaiReroll', dieIds: firstDie ? [firstDie.id] : [] });
    expect(g.pending).toBeNull();
    expect(g.ultimatesUsed).toContain('zhihai.bloom.ultimate');
  });

  it('计数 1–4 时可主动发动必杀（FAQ 18.1.3）', () => {
    const g = xiuGame();
    charge(g, 'A', '018');
    toMain(g);
    const card = art(g, 'A', '018');
    card.count = 2;
    expect(skillActions(g, '018')).toEqual(['only']);
    const before = totalDice(g.players.A);
    applyAction(g, { t: 'skill', artifactId: '018', side: 'only', params: {} });
    expect(card.continuousLost).toBe(true);
    expect(totalDice(g.players.A)).toBe(before + 2); // 获得 X=2 个随机能力骰
    expect(g.pending?.kind).toBe('zhihaiReroll');
    applyAction(g, { t: 'zhihaiReroll', dieIds: [] });
    // 用过一次后不再提供
    expect(skillActions(g, '018')).toEqual([]);
  });

  it('必杀用后「失去持续式效果」：持续不再算作激活（hasActiveSkill 为假）', () => {
    const g = xiuGame();
    charge(g, 'A', '018');
    toMain(g);
    const card = art(g, 'A', '018');
    card.count = 2;
    expect(hasActiveSkill(g.players.A, 'zhihai.bloom')).toBe(true);
    applyAction(g, { t: 'skill', artifactId: '018', side: 'only', params: {} });
    applyAction(g, { t: 'zhihaiReroll', dieIds: [] });
    expect(card.continuousLost).toBe(true);
    expect(hasActiveSkill(g.players.A, 'zhihai.bloom')).toBe(false); // 通用规则：持续技能一律失效
    expect(card.count).toBe(2); // 计数保留
  });

  it('计数为 0 时不提供主动必杀按钮（X=0 无收益却会失去持续）', () => {
    const g = xiuGame();
    charge(g, 'A', '018');
    toMain(g);
    expect(skillActions(g, '018')).toEqual([]);
  });

  it('「帷幕」的 2 点真实伤害会为「至黑」叠计数（FAQ 17.1.3）', () => {
    const g = xiuGame();
    charge(g, 'A', '018');
    activate(g, 'A', '017', 'left');
    const card = art(g, 'A', '018');
    giveDice(g, 'B', [{ id: 'b1', value: 3, kind: 'attack' }]);
    finishTurn(g); // A 回合结束
    until(g, atB(g, 'reroll')); // B 的重掷阶段
    applyAction(g, { t: 'advance' }); // B 重掷阶段结束 → A 的帷幕
    expect(g.pending?.kind).toBe('weimu');
    expect(card.count).toBe(0);
    applyAction(g, { t: 'weimu', accept: true, dieId: 'b1' }); // A 受 2 真伤 → 计数 +1
    expect(card.count).toBe(1);
    expect(g.players.A.life).toBe(45 - 2);
  });
});
