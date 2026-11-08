// 010–012 的 2v2 审计批次（010 真实之剑 / 011 顿悟 / 012 魔女）。
// 010 不是"一张卡"，是一层**支付面**：攻击 / 抵挡 / 触发代价都能"2 颗当 1 颗（视为 5）"。
import { describe, it, expect } from 'vitest';
import { applyAction, createTwoVTwoGame } from '../src/core/engine/game';
import { fxReset, fxTake } from '../src/core/engine/fx';
import { render2v2Game } from '../src/ui/battle2v2View';
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
    A1: { attack: [3, 4], defense: [], meditation: [] },
    B1: { attack: [], defense: [], meditation: [] },
    B2: { attack: [], defense: [], meditation: [] },
  },
});

/** 让某座位的 010「真实之剑」处于已激活（持续式）。 */
const armSword = (g: GameState, seat: 'A1' | 'B1' = 'A1') => {
  const a = g.players[seat].artifacts.find((x) => x.id === '010');
  if (a) a.activeMarkerSide = 'left';
  return g;
};

const mount = (g: GameState) => {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const seen: Array<Record<string, unknown>> = [];
  render2v2Game(root, g, { onAction: (a) => seen.push(a as never), onBack: () => {} });
  return { root, seen };
};

const idsOf = (g: GameState, seat: 'A1' | 'B1', kind: 'attack' | 'defense') =>
  g.players[seat].areas[kind].map((d) => d.id);

const chip = (root: HTMLElement, id: string) =>
  root.querySelector<HTMLElement>(`.convertpick .pay-die[data-id="${id}"]`)!;

const texts = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).map((b) => b.textContent ?? '');

describe('2v2 010 真实之剑（置换支付面）', () => {
  it('攻击：选满 2 颗后**不退回普通攻击界面**，目标与骰片同一行；确认条文案写明"置换"', () => {
    const g = armSword(createTwoVTwoGame(setup()));
    g.phase = 'main';
    g.activePlayer = 'A1';
    g.stance = 'attackPicks';
    const [d1, d2] = idsOf(g, 'A1', 'attack');
    const { root, seen } = mount(g);

    const entry = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).find(
      (b) => b.textContent === '使用「真实之剑」置换进行攻击',
    );
    expect(entry).toBeTruthy();
    expect(entry!.className).toBe('btn btn-convert');
    entry!.click();

    expect(root.querySelector('.convertpick')).not.toBeNull();
    expect(root.querySelector('.convertpick-title')?.textContent).toBe('使用「真实之剑」置换进行攻击');
    // 2v2＝两行布局：第 1 行文字、第 2 行按钮；提示文案已简化
    expect(root.querySelector('.convertpick--stacked')).not.toBeNull();
    expect(root.querySelector('.convertpick-head')?.textContent).toContain(
      '选 2 颗能力骰（视为 5 点）· 已选 0/2',
    );
    const btnRow = root.querySelector('.convertpick-row')!;
    expect(btnRow.querySelectorAll('.pay-die').length).toBeGreaterThan(0);
    expect(btnRow.querySelector('.btn-cancel')).not.toBeNull();
    chip(root, d1!).click();
    chip(root, d2!).click();

    // ① 目标**就在置换面板里**（同一行），不是普通攻击那套目标行
    const inline = root.querySelectorAll<HTMLElement>('.convertpick .convertpick-targets .b2v2-target');
    expect(Array.from(inline).map((b) => b.dataset.choice)).toEqual(['B1', 'B2']);
    // ② 普通攻击界面不许回来：没有置换入口按钮、没有通用目标行、没有攻击骰片行
    expect(texts(root)).not.toContain('使用「真实之剑」置换进行攻击');
    expect(root.querySelectorAll('.actionlist > .option-row .b2v2-target')).toHaveLength(0);

    inline[1]!.click();
    // ③ 确认条文案：与 1v1 同一句 + 打谁
    const label = root.querySelector('.confirm-row .confirm-label')?.textContent ?? '';
    expect(label).toContain('置换攻击：消耗 2 颗能力骰 → 1 颗攻击骰（点数按 5）');
    expect(label).toContain('→ 玩家B2');
    expect(label).not.toContain('使用 4 点攻击骰');

    root.querySelector<HTMLButtonElement>('.confirm-row .btn-skill')!.click();
    expect(seen[0]).toMatchObject({
      t: 'attack',
      target: 'B2',
      costSlots: [{ dieIds: [d1, d2] }],
    });

    // 引擎侧：2 颗源骰合并成 1 颗（视为 5），并发 `pay`（groups 一组 2 颗）供支付动画合并成灰 5
    fxReset();
    applyAction(g, seen[0] as never);
    expect(g.pendingAttack).toMatchObject({ attacker: 'A1', defender: 'B2', baseValue: 5 });
    const pay = fxTake().find((e) => e.kind === 'pay');
    expect(pay).toBeTruthy();
    if (pay && pay.kind === 'pay') {
      expect(pay.groups).toHaveLength(1);
      expect(pay.groups[0]).toEqual([d1, d2]);
    }
  });

  it('攻击·守方选择：选满 2 颗 → 先出**投票**（不摆目标、不进确认条）', () => {
    const g = armSword(createTwoVTwoGame(setup()));
    g.phase = 'main';
    g.activePlayer = 'A1';
    g.stance = 'defensePicks';
    const [d1, d2] = idsOf(g, 'A1', 'attack');
    const { root } = mount(g);

    // 攻守标记不限制"谁能发起攻击"（§3.1）→ 守方选择时入口照常出现
    const entry = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).find(
      (b) => b.textContent === '使用「真实之剑」置换进行攻击',
    );
    expect(entry).toBeTruthy();
    entry!.click();
    chip(root, d1!).click();
    chip(root, d2!).click();

    // 守方投票面板（两人各一组按钮），没有目标组、没有确认条
    expect(root.querySelector('.b2v2-vote')).not.toBeNull();
    expect(root.querySelector('.convertpick-targets')).toBeNull();
    expect(root.querySelector('.confirm-row')).toBeNull();
  });

  it('攻击：没有 010（或未激活）→ 没有置换入口', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    g.stance = 'attackPicks';
    const { root } = mount(g); // 未 armSword
    expect(texts(root)).not.toContain('使用「真实之剑」置换进行攻击');
  });

  it('攻击：只有 1 颗骰 → 没有置换入口', () => {
    const g = armSword(createTwoVTwoGame(setup()));
    g.phase = 'main';
    g.activePlayer = 'A1';
    g.stance = 'attackPicks';
    g.players.A1.areas.attack = [{ id: 'only-1', value: 3, kind: 'attack' }] as never;
    const { root } = mount(g);
    expect(texts(root)).not.toContain('使用「真实之剑」置换进行攻击');
  });

  it('抵挡：守方持 010 + ≥2 颗骰 → 出现抵挡置换入口，动作带 by', () => {
    const cfg = setup();
    cfg.seats.B1 = ['010', '002', '003'];
    cfg.dice = {
      A1: { attack: [], defense: [], meditation: [] },
      B1: { attack: [], defense: [2, 3], meditation: [] },
    };
    const g = armSword(createTwoVTwoGame(cfg), 'B1');
    g.phase = 'main';
    g.activePlayer = 'A1';
    g.pendingAttack = {
      attacker: 'A1',
      defender: 'B1',
      value: 3,
      baseValue: 3,
      physical: true,
      unblockable: false,
    } as never;
    const [d1, d2] = idsOf(g, 'B1', 'defense');
    const { root, seen } = mount(g);

    const entry = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).find(
      (b) => b.textContent === '使用「真实之剑」置换进行抵挡',
    );
    expect(entry).toBeTruthy();
    entry!.click();
    expect(root.querySelector('.convertpick-title')?.textContent).toBe('使用「真实之剑」置换进行抵挡');
    chip(root, d1!).click();
    chip(root, d2!).click();
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-skill')!.click();
    expect(seen[0]).toMatchObject({ t: 'block', by: 'B1', costSlots: [{ dieIds: [d1, d2] }] });
  });

  it('抵挡：攻击不可抵挡时不给置换抵挡入口', () => {
    const cfg = setup();
    cfg.seats.B1 = ['010', '002', '003'];
    cfg.dice = { B1: { attack: [], defense: [2, 3], meditation: [] } };
    const g = armSword(createTwoVTwoGame(cfg), 'B1');
    g.phase = 'main';
    g.activePlayer = 'A1';
    g.pendingAttack = {
      attacker: 'A1',
      defender: 'B1',
      value: 3,
      baseValue: 3,
      physical: true,
      unblockable: true,
    } as never;
    const { root } = mount(g);
    expect(texts(root)).not.toContain('使用「真实之剑」置换进行抵挡');
  });

  it('触发代价（009 取消）：有「2 颗顶 1」入口，走同一个选择器并派发 costSlots', () => {
    const g = armSword(createTwoVTwoGame(setup()));
    g.phase = 'main';
    g.activePlayer = 'A1';
    g.pending = { kind: 'guwangCancel', player: 'A1', amount: 3 } as never;
    const [d1, d2] = idsOf(g, 'A1', 'attack');
    const { root, seen } = mount(g);

    const entry = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).find(
      (b) => b.textContent === '用「真实之剑」置换：2 颗任意骰代替 1 颗',
    );
    expect(entry).toBeTruthy();
    entry!.click();
    expect(root.querySelector('.selector')).not.toBeNull();
    root.querySelector<HTMLElement>(`.selector .pay-die[data-id="${d1}"]`)!.click();
    root.querySelector<HTMLElement>(`.selector .pay-die[data-id="${d2}"]`)!.click();
    root.querySelector<HTMLButtonElement>('.selector .btn-confirm')!.click();
    expect(seen[0]).toMatchObject({
      t: 'guwangCancel',
      cancel: true,
      costSlots: [{ dieIds: [d1, d2] }],
    });
  });

  it('触发代价（011 减半 / 023 畏惧）：两处都有「2 颗顶 1」入口', () => {
    for (const kind of ['dunwuHalve', 'weijuPay'] as const) {
      const g = armSword(createTwoVTwoGame(setup()));
      g.phase = 'main';
      g.activePlayer = 'A1';
      g.pending =
        kind === 'dunwuHalve'
          ? ({ kind, player: 'A1', amount: 4 } as never)
          : ({ kind, player: 'A1', reason: 'defense' } as never);
      const { root } = mount(g);
      expect(texts(root)).toContain('用「真实之剑」置换：2 颗任意骰代替 1 颗');
    }
  });

  it('010 杀意：一行「目标 [B1] [B2] [不发动「杀意」]」，点目标即提出动作', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    g.pending = { kind: 'shenhongKill', player: 'A1' } as never;
    const { root, seen } = mount(g);

    const row = root.querySelector<HTMLElement>('.actionlist .option-row--decide')!;
    expect(row).not.toBeNull();
    expect(row.querySelector('.selector-hint')?.textContent).toBe('目标');
    // 精确断言：目标两颗 + 一个带技能名的"放弃"，没有独立的「发动」按钮、没有裸的「不发动」
    expect(Array.from(row.querySelectorAll('button')).map((b) => b.textContent)).toEqual([
      '玩家B1',
      '玩家B2',
      '不发动「杀意」',
    ]);
    // 整块操作列表只有这一行（一个动作只有一个渲染来源，不能重复渲染）
    expect(texts(root)).toEqual(['玩家B1', '玩家B2', '不发动「杀意」']);

    row.querySelector<HTMLElement>('[data-choice="B2"]')!.click();
    expect(root.querySelector('.confirm-row .confirm-label')?.textContent).toBe(
      '发动「杀意」（3 真伤 + 回2） → 玩家B2？',
    );
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-skill')!.click();
    expect(seen[0]).toMatchObject({ t: 'shenhongKill', accept: true, target: 'B2' });
  });

  it('010 杀意·不发动：按钮带技能名，确认条同样带技能名', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    g.pending = { kind: 'shenhongKill', player: 'A1' } as never;
    const { root, seen } = mount(g);

    root.querySelector<HTMLElement>('[data-choice="decline"]')!.click();
    expect(root.querySelector('.confirm-row .confirm-label')?.textContent).toBe('不发动「杀意」？');
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-skill')!.click();
    expect(seen[0]).toMatchObject({ t: 'shenhongKill', accept: false });
    expect(seen[0]).not.toHaveProperty('target');
  });

  it('尘起：复用 1v1 的「使用真实之剑置换能力骰」入口（2 颗顶 1 颗冥想）', () => {
    const g = armSword(createTwoVTwoGame(setup()));
    g.phase = 'dustRise';
    g.activePlayer = 'A1';
    g.dustRiseNormalCount = 0;
    g.freeDustRise = 0;
    g.players.A1.areas.meditation = [{ id: 'm-1', value: 2, kind: 'meditation' }] as never;
    g.players.A1.areas.attack = [
      { id: 'x-1', value: 3, kind: 'attack' },
      { id: 'x-2', value: 4, kind: 'attack' },
    ] as never;
    const { root, seen } = mount(g);

    const dust = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).find(
      (b) => (b.dataset.act ?? '') === 'dustRise',
    );
    expect(dust).toBeTruthy();
    dust!.click();
    // 010 是「持续+触发」→ 尘起＝切换（侧向唯一），直接进支付步
    expect(root.querySelector('.dustflow')).not.toBeNull();

    const conv = root.querySelector<HTMLButtonElement>('.dustflow .btn-convert');
    expect(conv).not.toBeNull();
    expect(conv!.textContent).toBe('使用「真实之剑」置换能力骰');
    conv!.click();
    expect(root.querySelector('.dustflow-hint')?.textContent).toContain('已选 0/2');

    root.querySelector<HTMLElement>('.dustflow .pay-die[data-id="x-1"]')!.click();
    root.querySelector<HTMLElement>('.dustflow .pay-die[data-id="x-2"]')!.click();
    expect(seen[0]).toMatchObject({ t: 'dustRise', costSlots: [{ dieIds: ['x-1', 'x-2'] }] });
  });
});

describe('2v2 011 顿悟', () => {
  it('屏障·触发：用骰片选冥想骰（不是文字按钮）+「不发动」', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    g.players.A1.areas.meditation = [{ id: 'med-1', value: 2, kind: 'meditation' }] as never;
    g.pending = { kind: 'dunwuHalve', player: 'A1', amount: 4 } as never;
    const { root, seen } = mount(g);

    const chips = Array.from(
      root.querySelectorAll<HTMLElement>('.actionlist .pay-die[data-act="dunwuHalve"]'),
    );
    expect(chips.map((c) => c.textContent)).toEqual(['冥2']);
    expect(chips[0]!.className).toContain('die-A1');
    expect(root.querySelector('.actionlist button.btn[data-act="dunwuHalve"]')?.textContent).toBe(
      '不发动「灵能屏障」',
    );

    chips[0]!.click();
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-skill')!.click();
    expect(seen[0]).toMatchObject({
      t: 'dunwuHalve',
      accept: true,
      meditationDieId: 'med-1',
    });
  });

  it('脉冲·触发：与杀意同一形状（通用规则）；提示栏格式固定', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    g.pending = { kind: 'dunwuPulse', player: 'A1', amount: 3 } as never;
    const { root, seen } = mount(g);

    // 提示栏：`轮到 <玩家色名字> 操作 <玩家色技能名>：…`
    expect(root.querySelector('.hint-turn')?.textContent).toBe('轮到 玩家A1 操作');
    const who = root.querySelector<HTMLElement>('.hint-turn .hint-player')!;
    expect(who.textContent).toBe('玩家A1');
    expect(who.className).toContain('player-A1');
    const skill = root.querySelector<HTMLElement>('.hint-phase .hint-skill')!;
    expect(skill.textContent).toBe('灵能脉冲');
    expect(skill.className).toContain('player-A1');
    expect(root.querySelector('.hint-phase')?.textContent).toBe(
      '灵能脉冲：可造成 3 点真实伤害（本次消耗 3 颗能力骰）。',
    );

    // 与杀意完全同形状（只有技能名不同）
    const row = root.querySelector<HTMLElement>('.actionlist .option-row--decide')!;
    expect(Array.from(row.querySelectorAll('button')).map((b) => b.textContent)).toEqual([
      '玩家B1',
      '玩家B2',
      '不发动「灵能脉冲」',
    ]);
    expect(texts(root)).toEqual(['玩家B1', '玩家B2', '不发动「灵能脉冲」']);

    const seats = Array.from(root.querySelectorAll<HTMLElement>('.actionlist .b2v2-target'));
    expect(seats.map((b) => b.dataset.choice)).toEqual(['B1', 'B2']);
    seats[0]!.click();
    expect(root.querySelector('.confirm-row .confirm-label')?.textContent).toBe(
      '发动「灵能脉冲」（3 点真实伤害） → 玩家B1？',
    );
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-skill')!.click();
    expect(seen[0]).toMatchObject({ t: 'dunwuPulse', accept: true, target: 'B1' });
  });

  it('屏障·启动：选 2 颗防御骰 → 得 4 颗冥想骰（引擎落地）', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    const a = g.players.A1.artifacts.find((x) => x.id === '011')!;
    a.activeMarkerSide = 'left';
    a.armedSide = 'left';
    a.armedTurn = g.turnIndex;
    g.players.A1.areas.defense = [
      { id: 'df-1', value: 2, kind: 'defense' },
      { id: 'df-2', value: 3, kind: 'defense' },
    ] as never;
    g.players.A1.areas.meditation = [] as never;
    const { root, seen } = mount(g);

    const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).find(
      (b) => b.textContent === '启动技能：灵能屏障',
    );
    expect(btn).toBeTruthy();
    btn!.click();
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="df-1"]')!.click();
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="df-2"]')!.click();
    root.querySelector<HTMLButtonElement>('.selector .btn-skill')!.click();

    expect(seen).toHaveLength(1);
    const action = seen[0] as { t: string; params?: { costSlots?: { dieIds: string[] }[] } };
    expect(action.t).toBe('skill');
    expect(action.params?.costSlots?.flatMap((s) => s.dieIds)).toEqual(['df-1', 'df-2']);

    applyAction(g, action as never);
    expect(g.players.A1.areas.defense).toHaveLength(0);
    expect(g.players.A1.areas.meditation).toHaveLength(4);
  });

  it('卡面四态：激活左侧 → 左边两行 on，右边两行 off', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    const a = g.players.A1.artifacts.find((x) => x.id === '011')!;
    a.activeMarkerSide = 'left';
    const { root } = mount(g);
    const card = root.querySelector<HTMLElement>('.player[data-player="A1"] .card[data-artifact="011"]')!;
    const rows = Array.from(card.querySelectorAll<HTMLElement>('.skill-part'));
    expect(rows.map((r) => r.className.match(/skill-part--(on|off|disabled|spent)/)?.[0])).toEqual([
      'skill-part--on',
      'skill-part--on',
      'skill-part--off',
      'skill-part--off',
    ]);
  });
});

describe('2v2 012 魔女', () => {
  const armMonv = (g: GameState) => {
    const a = g.players.A1.artifacts.find((x) => x.id === '012')!;
    a.activeMarkerSide = 'left';
    a.chargeLayer = 1;
    return g;
  };

  it('梦醒时分（持续）：速度 +X 显示在第 1 列卡头（X＝冥想骰数，最多 3）', () => {
    const g = armMonv(createTwoVTwoGame(setup()));
    g.phase = 'main';
    g.activePlayer = 'A1';
    g.players.A1.areas.meditation = [
      { id: 'mv-1', value: 2, kind: 'meditation' },
      { id: 'mv-2', value: 5, kind: 'meditation' },
    ] as never;
    const { root } = mount(g);
    const sub = root.querySelector<HTMLElement>(
      '.player[data-player="A1"] .card[data-artifact="010"] .card-sub',
    )!;
    const delta = sub.querySelector<HTMLElement>('.sub-delta');
    expect(delta?.textContent).toBe('+2'); // 010 基础速度 4 → 4+2
  });

  it('必杀：先选目标区域 → 选 1–3 颗冥想骰 → 派发并真的移动（点数不变）', () => {
    const g = armMonv(createTwoVTwoGame(setup()));
    g.phase = 'main';
    g.activePlayer = 'A1';
    g.players.A1.areas.meditation = [
      { id: 'mv-1', value: 2, kind: 'meditation' },
      { id: 'mv-2', value: 5, kind: 'meditation' },
      { id: 'mv-3', value: 6, kind: 'meditation' },
    ] as never;
    const { root, seen } = mount(g);

    const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).find(
      (b) => b.textContent === '发动必杀：「梦醒时分」',
    );
    expect(btn).toBeTruthy();
    btn!.click();

    // 第 1 步：选区域
    const opts = Array.from(root.querySelectorAll<HTMLElement>('.selector .option-btn'));
    expect(opts.map((b) => b.dataset.choice)).toEqual(['attack', 'defense']);
    opts[0]!.click();

    // 第 2 步：选 1–3 颗冥想骰
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="mv-1"]')!.click();
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="mv-2"]')!.click();
    root.querySelector<HTMLButtonElement>('.selector .btn-skill')!.click();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      t: 'skill',
      artifactId: '012',
      side: 'only',
      params: { to: 'attack', meditationDieIds: ['mv-1', 'mv-2'] },
    });

    applyAction(g, seen[0] as never);
    expect(g.players.A1.areas.meditation.map((d) => d.id)).toEqual(['mv-3']);
    // 原有攻击骰 [3,4] 不动，移动过来的 2 颗追加在后（点数不变）
    expect(g.players.A1.areas.attack.map((d) => d.value)).toEqual([3, 4, 2, 5]);
  });

  it('卡面四态：充能完成后「持续」与「必杀」都是 on', () => {
    const g = armMonv(createTwoVTwoGame(setup()));
    g.phase = 'main';
    g.activePlayer = 'A1';
    const { root } = mount(g);
    const card = root.querySelector<HTMLElement>('.player[data-player="A1"] .card[data-artifact="012"]')!;
    const rows = Array.from(card.querySelectorAll<HTMLElement>('.skill-part'));
    expect(rows.map((r) => r.className.match(/skill-part--(on|off|disabled|spent)/)?.[0])).toEqual([
      'skill-part--on',
      'skill-part--on',
    ]);
  });
});
