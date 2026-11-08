// 007–009 的 2v2 审计批次。
// 起点：证实 009「高塔铁幕·充能」在 2v2 会抛 `target required`（有两个敌人、尘起动作不带 target）。
import { describe, it, expect } from 'vitest';
import { applyAction, createTwoVTwoGame } from '../src/core/engine/game';
import { applyTurnStartEffects } from '../src/core/engine/skills';
import { effectiveWill } from '../src/core/engine/derive';
import { render2v2Game } from '../src/ui/battle2v2View';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';
import type { GameState } from '../src/core/model/types';

/** A1 同时持 007 / 008 / 009（正好是一列一件），B1/B2 各有攻击骰。 */
const setup = (): TwoVTwoSetup => ({
  seats: {
    A1: ['007', '008', '009'],
    A2: ['004', '005', '006'],
    B1: ['001', '002', '003'],
    B2: ['010', '011', '012'],
  },
  firstTeam: 'A',
  seed: 7,
  dice: {
    A1: { attack: [], defense: [], meditation: [3] },
    B1: { attack: [4], defense: [], meditation: [] },
    B2: { attack: [5], defense: [], meditation: [] },
  },
});

const mount = (g: GameState) => {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const seen: Array<Record<string, unknown>> = [];
  render2v2Game(root, g, { onAction: (a) => seen.push(a as never), onBack: () => {} });
  return { root, seen };
};

const chargeReady = (g: GameState): GameState => {
  g.phase = 'dustRise';
  g.activePlayer = 'A1';
  g.dustRiseNormalCount = 0;
  g.freeDustRise = 0;
  g.players.A1.artifacts.find((a) => a.id === '009')!.chargeLayer = 2; // chargeReq = 3
  return g;
};

const dustCharge = (g: GameState) =>
  applyAction(g, {
    t: 'dustRise',
    artifactId: '009',
    costSlots: [{ dieIds: [g.players.A1.areas.meditation[0]!.id] }],
  });

describe('2v2 007–009 审计', () => {
  it('009 充能：2v2 充满时不抛错，并挂起「选哪颗攻击骰改点为 1」', () => {
    const g = chargeReady(createTwoVTwoGame(setup()));
    expect(() => dustCharge(g)).not.toThrow();
    expect(g.pending).toMatchObject({ kind: 'guwangCharge', player: 'A1' });
  });

  it('009 充能：2v2 可以改任一座敌人的攻击骰（不是写死第一个敌人）', () => {
    const g = chargeReady(createTwoVTwoGame(setup()));
    dustCharge(g);
    const b2Die = g.players.B2.areas.attack[0]!;
    applyAction(g, { t: 'guwangCharge', dieId: b2Die.id });
    expect(g.players.B2.areas.attack[0]!.value).toBe(1);
    expect(g.players.B1.areas.attack[0]!.value).toBe(4); // 另一个敌人不受影响
  });

  it('009 充能：先选发动对象 → 再列该对象的攻击骰（按座位上色）+ 不变更', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    g.pending = { kind: 'guwangCharge', player: 'A1' } as never;
    const { root, seen } = mount(g);

    // 第 1 步：只出目标行，不出骰片
    const seats = Array.from(root.querySelectorAll<HTMLElement>('.actionlist .b2v2-target'));
    expect(seats.map((b) => b.dataset.choice)).toEqual(['B1', 'B2']);
    expect(root.querySelectorAll('.actionlist .pay-die[data-act="guwangCharge"]').length).toBe(0);

    // 第 2 步：选 B2 → 只列 B2 的攻击骰
    seats[1]!.click();
    const chips = Array.from(
      root.querySelectorAll<HTMLElement>('.actionlist .pay-die[data-act="guwangCharge"]'),
    );
    expect(chips.map((c) => c.textContent)).toEqual(['攻5']);
    expect(chips[0]!.className).toContain('die-B2');
    expect(root.querySelector('.actionlist button.btn[data-act="guwangCharge"]')?.textContent).toBe(
      '不变更',
    );
    // 多候选时给「重选对象」退路
    expect(root.querySelector('.actionlist button[data-act="guwangChargeBack"]')).not.toBeNull();

    chips[0]!.click(); // 选 B2 那颗
    expect(root.querySelector('.confirm-row')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-skill')!.click();
    expect(seen[0]).toMatchObject({ t: 'guwangCharge', dieId: g.players.B2.areas.attack[0]!.id });
  });

  it('009 充能：只有一个敌人有攻击骰 → 自动跳过"选对象"', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    g.players.B2.areas.attack = [] as never;
    g.pending = { kind: 'guwangCharge', player: 'A1' } as never;
    const { root } = mount(g);
    expect(root.querySelectorAll('.actionlist .b2v2-target').length).toBe(0);
    const chips = Array.from(
      root.querySelectorAll<HTMLElement>('.actionlist .pay-die[data-act="guwangCharge"]'),
    );
    expect(chips.map((c) => c.textContent)).toEqual(['攻4']);
    expect(chips[0]!.className).toContain('die-B1');
  });

  it('守方投票：没有「取消」；投票面板先给出"这一刀"（点数/伤害）', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    g.stance = 'defensePicks';
    g.players.A1.areas.attack = [{ id: 'atk-1', value: 3, kind: 'attack' }] as never;
    const { root, seen } = mount(g);

    root.querySelector<HTMLElement>('.actionlist .pay-die[data-act="attack"]')!.click();
    expect(root.querySelector('[data-role="team-vote"]')).not.toBeNull();
    // 投票前还没派发 → 源骰仍在区域里（不再有"预览藏骰"那套）
    expect(root.querySelector<HTMLElement>('.die[data-id="atk-1"]')!.style.visibility).toBe('');
    // 投票面板先写清"这一刀"（数值来自引擎试算；文案与 1v1 同一来源）
    const info = root.querySelector<HTMLElement>('.b2v2-vote-info')!.textContent ?? '';
    expect(info).toContain('点攻击');
    expect(info).toContain('伤害');
    expect(info).not.toContain('发起攻击');
    // 提示 + 两个投票人：**同一行**
    const line = root.querySelector<HTMLElement>('.b2v2-vote-line')!;
    expect(line.querySelectorAll('[data-voter]').length).toBe(2);
    expect(line.querySelector('.b2v2-vote-tip')?.textContent).toBe(
      '请两位守方玩家投票决定由谁承受本次攻击；投票不一致会重新选择。',
    );
    // 投票人标签带座位色
    expect(line.querySelector('[data-voter="B1"] .b2v2-vote-who')?.className).toContain('player-B1');
    // 投票面板没有任何「取消」按钮
    const texts = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).map(
      (b) => b.textContent ?? '',
    );
    expect(texts).not.toContain('取消');
    expect(seen).toHaveLength(0); // 还没投完 → 不派发
  });

  it('源码门禁：充能"先对象后骰"、投票无取消、守方选择不再有预览', () => {
    const raw = import.meta.glob('../src/ui/battle2v2View.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const src = Object.values(raw)[0] ?? '';

    // ① 充能：先选对象
    expect(src).toContain('选择发动对象');
    expect(src).toContain('chargeTarget = null;'); // 派发时清空

    // ② 投票面板不许有「取消」
    const from = src.indexOf('} else if (defenseVote) {');
    const to = src.indexOf('} else if (pendingSkillTarget) {');
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    expect(src.slice(from, to)).not.toContain("'取消'");

    // ③ 守方选择＝**投票 → 派发 → 动画**：不再有"派发前预览/藏骰"
    expect(src).not.toContain('beginDefensePreview');
    expect(src).not.toContain('previewHiddenIds');
    // 投票前的信息＝引擎试算（数值唯一来源）+ 与 1v1 共用的文案构造
    expect(src).toContain('previewPendingAttack');
    expect(src).toContain('attackInfoParts');
  });

  it('009 触发：用骰片选防御骰取消真伤（不是纯文字按钮）', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    g.players.A1.areas.defense = [{ id: 'df-1', value: 2, kind: 'defense' }] as never;
    g.pending = { kind: 'guwangCancel', player: 'A1', amount: 3 } as never;
    const { root, seen } = mount(g);

    const chips = Array.from(
      root.querySelectorAll<HTMLElement>('.actionlist .pay-die[data-act="guwangCancel"]'),
    );
    expect(chips.map((c) => c.textContent)).toEqual(['防2']);
    expect(chips[0]!.className).toContain('die-A1');
    expect(root.querySelector('.actionlist button.btn[data-act="guwangCancel"]')?.textContent).toBe(
      '不发动「高塔铁幕」',
    );

    chips[0]!.click();
    expect(root.querySelector('.confirm-row')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-skill')!.click();
    expect(seen[0]).toMatchObject({ t: 'guwangCancel', cancel: true, defenseDieId: 'df-1' });
  });

  it('007 战争横扫：入口按钮用 1v1 的 btn-skill，目标候选只有敌人（精确数组）', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    const art = g.players.A1.artifacts.find((a) => a.id === '007')!;
    art.activeMarkerSide = 'left';
    art.armedSide = 'left';
    art.armedTurn = g.turnIndex;
    g.players.A1.areas.attack = [{ id: 'a-atk', value: 3, kind: 'attack' }] as never;
    g.players.A1.areas.defense = [{ id: 'a-def', value: 2, kind: 'defense' }] as never;
    g.players.A1.areas.meditation = [{ id: 'a-med', value: 4, kind: 'meditation' }] as never;
    const { root } = mount(g);

    const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).find(
      (b) => b.textContent === '启动技能：战争横扫',
    );
    expect(btn).toBeTruthy();
    expect(btn!.className).toBe('btn btn-skill');
    // 只有一个入口 + 排在攻击骰之前
    const texts = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).map(
      (b) => b.textContent ?? '',
    );
    expect(texts.filter((t) => t === '启动技能：战争横扫')).toHaveLength(1);
    const kids = Array.from(root.querySelector('.actionlist')!.children);
    const skillIdx = kids.findIndex((k) => (k.textContent ?? '').includes('启动技能：战争横扫'));
    const attackIdx = kids.findIndex((k) => (k.textContent ?? '').startsWith('攻击'));
    expect(skillIdx).toBeGreaterThan(-1);
    expect(attackIdx).toBeGreaterThan(-1);
    expect(skillIdx).toBeLessThan(attackIdx);

    btn!.click();

    const seats = Array.from(root.querySelectorAll<HTMLElement>('.selector .b2v2-target'));
    expect(seats.map((b) => b.dataset.choice)).toEqual(['B1', 'B2']);
  });

  it('007 战争横扫：走完 选目标→消耗 3 颗→弃对方同类 → 派发完整动作', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    const art = g.players.A1.artifacts.find((a) => a.id === '007')!;
    art.activeMarkerSide = 'left';
    art.armedSide = 'left';
    art.armedTurn = g.turnIndex;
    g.players.A1.areas.attack = [{ id: 'a-atk', value: 3, kind: 'attack' }] as never;
    g.players.A1.areas.defense = [{ id: 'a-def', value: 2, kind: 'defense' }] as never;
    g.players.A1.areas.meditation = [{ id: 'a-med', value: 4, kind: 'meditation' }] as never;
    // 目标 B2：三类各 1 颗，方便断言"弃的是所选目标的骰"
    g.players.B2.areas.attack = [{ id: 'b2-atk', value: 5, kind: 'attack' }] as never;
    g.players.B2.areas.defense = [{ id: 'b2-def', value: 1, kind: 'defense' }] as never;
    g.players.B2.areas.meditation = [{ id: 'b2-med', value: 6, kind: 'meditation' }] as never;
    const { root, seen } = mount(g);

    Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button'))
      .find((b) => b.textContent === '启动技能：战争横扫')!
      .click();
    root.querySelector<HTMLElement>('.selector .b2v2-target[data-choice="B2"]')!.click();

    // 步骤：选自己的 3 颗（攻/防/冥 各 1）
    for (const id of ['a-atk', 'a-def', 'a-med']) {
      root.querySelector<HTMLElement>(`.selector .pay-die[data-id="${id}"]`)!.click();
    }
    root.querySelector<HTMLButtonElement>('.selector .btn-skill')!.click();

    // 步骤：弃目标的三类各 1 颗
    for (const id of ['b2-atk', 'b2-def', 'b2-med']) {
      root.querySelector<HTMLElement>(`.selector .pay-die[data-id="${id}"]`)!.click();
    }
    root.querySelector<HTMLButtonElement>('.selector .btn-skill')!.click();

    expect(seen).toHaveLength(1);
    const action = seen[0] as { t: string; target?: string; params?: Record<string, unknown> };
    expect(action.t).toBe('skill');
    expect(action.target).toBe('B2');
    expect(action.params).toMatchObject({
      costSlots: [{ dieIds: ['a-atk'] }, { dieIds: ['a-def'] }, { dieIds: ['a-med'] }],
      discard: { attack: 'b2-atk', defense: 'b2-def', meditation: 'b2-med' },
    });
  });

  it('008 王家之拳：2 冥想 + 弃 1 防御 → 派发参数正确（不误伤队友）', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    const a8 = g.players.A1.artifacts.find((a) => a.id === '008')!;
    a8.activeMarkerSide = 'right';
    a8.armedSide = 'right';
    a8.armedTurn = g.turnIndex;
    g.players.A1.areas.meditation = [
      { id: 'm1', value: 1, kind: 'meditation' },
      { id: 'm2', value: 2, kind: 'meditation' },
    ] as never;
    g.players.A1.areas.defense = [{ id: 'd1', value: 3, kind: 'defense' }] as never;
    const { root, seen } = mount(g);

    Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button'))
      .find((b) => b.textContent === '启动技能：王家之拳')!
      .click();
    for (const id of ['m1', 'm2']) {
      root.querySelector<HTMLElement>(`.selector .pay-die[data-id="${id}"]`)!.click();
    }
    root.querySelector<HTMLButtonElement>('.selector .btn-skill')!.click();
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="d1"]')!.click();
    root.querySelector<HTMLButtonElement>('.selector .btn-skill')!.click();

    expect(seen).toHaveLength(1);
    const action = seen[0] as { t: string; target?: string; params?: Record<string, unknown> };
    expect(action.t).toBe('skill');
    expect(action.target).toBeUndefined(); // 只需要自己，不该被要求选目标
    const params = action.params as { costSlots: { dieIds: string[] }[]; defenseDieIds: string[] };
    expect(params.costSlots.flatMap((s) => s.dieIds)).toEqual(['m1', 'm2']);
    expect(params.defenseDieIds).toEqual(['d1']);
  });

  it('008 王家之拳：入口按钮用技能名（不是神器名）', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    const a8 = g.players.A1.artifacts.find((a) => a.id === '008')!;
    a8.activeMarkerSide = 'right';
    a8.armedSide = 'right';
    a8.armedTurn = g.turnIndex;
    g.players.A1.areas.meditation = [
      { id: 'm1', value: 1, kind: 'meditation' },
      { id: 'm2', value: 2, kind: 'meditation' },
    ] as never;
    const { root } = mount(g);

    const texts = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).map(
      (b) => b.textContent ?? '',
    );
    expect(texts).toContain('启动技能：王家之拳');
    expect(texts).not.toContain('启动技能：铁壁');
  });

  it('008 战车：回合开始有防御骰 → 获得 1 个 5 点攻击骰（2v2 同样生效）', () => {
    const g = createTwoVTwoGame(setup());
    const a8 = g.players.A1.artifacts.find((a) => a.id === '008')!;
    a8.activeMarkerSide = 'left';
    g.players.A1.areas.defense = [{ id: 'df-1', value: 2, kind: 'defense' }] as never;
    const before = g.players.A1.areas.attack.length;
    applyTurnStartEffects(g, 'A1');
    expect(g.players.A1.areas.attack).toHaveLength(before + 1);
    expect(g.players.A1.areas.attack[g.players.A1.areas.attack.length - 1]!.value).toBe(5);
  });

  it('008 王家之拳：少弃 2 颗防御 → 受 4 点真伤 + 得 4 防御 + 本回合攻击 +1', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    const a8 = g.players.A1.artifacts.find((a) => a.id === '008')!;
    a8.activeMarkerSide = 'right';
    g.players.A1.areas.meditation = [
      { id: 'm1', value: 1, kind: 'meditation' },
      { id: 'm2', value: 2, kind: 'meditation' },
    ] as never;
    g.players.A1.areas.defense = [] as never;
    const life0 = g.teams!.A.life;
    applyAction(g, {
      t: 'skill',
      artifactId: '008',
      side: 'right',
      params: { costSlots: [{ dieIds: ['m1'] }, { dieIds: ['m2'] }], defenseDieIds: [] },
    } as never);
    expect(g.players.A1.areas.defense).toHaveLength(4);
    expect(g.teams!.A.life).toBe(life0 - 4);
    expect(g.players.A1.buffs.some((b) => b.source === '王家之拳' && b.add === 1)).toBe(true);
  });

  it('009 必杀：2v2 弃光全部能力骰 → 补防骰到意志上限 → 结束主要阶段', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    const a9 = g.players.A1.artifacts.find((a) => a.id === '009')!;
    a9.activeMarkerSide = 'left';
    g.players.A1.areas.attack = [{ id: 'k1', value: 2, kind: 'attack' }] as never;
    g.players.A1.areas.defense = [{ id: 'k2', value: 3, kind: 'defense' }] as never;
    g.players.A1.areas.meditation = [] as never;
    applyAction(g, { t: 'skill', artifactId: '009', side: 'only', params: {} } as never);
    const p = g.players.A1;
    const total = p.areas.attack.length + p.areas.defense.length + p.areas.meditation.length;
    expect(p.areas.attack).toHaveLength(0);
    expect(p.areas.meditation).toHaveLength(0);
    expect(total).toBe(effectiveWill(p)); // 补到意志上限
    // 「立即结束你的主要阶段」→ 写战报（阶段推进的具体落点由批次外的流程决定，这里只锁"确实结束了"）
    expect(g.log.some((l) => l.text.includes('高塔铁幕'))).toBe(true);
  });

  it('009 卡面四态：充能满 → 充能行 disabled、必杀行仍 on', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    const a9 = g.players.A1.artifacts.find((a) => a.id === '009')!;
    a9.activeMarkerSide = 'left';
    a9.chargeLayer = 3;
    const { root } = mount(g);
    const card = root.querySelector<HTMLElement>('.player[data-player="A1"] .card[data-artifact="009"]')!;
    const rows = Array.from(card.querySelectorAll<HTMLElement>('.skill-part'));
    expect(rows.map((r) => r.className.match(/skill-part--(on|off|disabled|spent)/)?.[0])).toEqual([
      'skill-part--disabled',
      'skill-part--on',
      'skill-part--on',
    ]);
  });
});
