import { describe, it, expect } from 'vitest';
import { createTwoVTwoGame } from '../src/core/engine/game';
import { fxReset, fxTake, type FxEvent } from '../src/core/engine/fx';
import { SKILL_HANDLERS } from '../src/core/engine/skills';
import { SeededRng } from '../src/core/rng/rng';
import { render2v2Game } from '../src/ui/battle2v2View';
import { SKILL_SELECTION, compactNumbers, type SelectStep } from '../src/ui/skillSelection';
import type { GameState, PlayerId } from '../src/core/model/types';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';

const setup = (): TwoVTwoSetup => ({
  seats: {
    A1: ['001', '002', '003'],
    A2: ['004', '005', '006'],
    B1: ['007', '008', '009'],
    B2: ['010', '011', '012'],
  },
  firstTeam: 'A',
  seed: 7,
});

const setup034 = (): TwoVTwoSetup => ({
  seats: {
    A1: ['034', '002', '006'],
    A2: ['004', '005', '006'],
    B1: ['007', '008', '009'],
    B2: ['010', '011', '012'],
  },
  firstTeam: 'A',
  seed: 7,
});

const args = (state: GameState, player: PlayerId, target?: PlayerId) => ({
  state,
  player,
  chosenDice: [],
  options: [],
  numbers: [],
  slots: [],
  target,
});

const ctx = (g: GameState, player: PlayerId, artifactId: string) => ({
  g,
  player,
  artifact: g.players[player].artifacts.find((a) => a.id === artifactId)!,
  params: {},
  rng: new SeededRng(1),
  endMainPhase: () => {},
});

describe('2v2 批次 004–006', () => {
  it('004 锋芒：2v2 选择 1 攻击 + 1 冥想后提交完整 fengmang 动作', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.phase = 'main';
    state.activePlayer = 'A2';
    state.players.A2.areas.attack = [{ id: 'fm-a', value: 2, kind: 'attack' }] as never;
    state.players.A2.areas.meditation = [{ id: 'fm-m', value: 3, kind: 'meditation' }] as never;
    state.pending = {
      kind: 'fengmang',
      player: 'A2',
      defenderId: 'B1',
      value: 3,
    } as never;
    const seen: unknown[] = [];
    render2v2Game(root, state, { onAction: (a) => seen.push(a), onBack: () => {} });

    const open = root.querySelector<HTMLButtonElement>('[data-act="fengmangOpen"]')!;
    expect(open).not.toBeNull();
    open.click();

    expect(root.querySelector('.convertpick')).not.toBeNull();
    root.querySelector<HTMLElement>('.convertpick [data-id="fm-a"]')!.click();
    root.querySelector<HTMLElement>('.convertpick [data-id="fm-m"]')!.click();
    const confirm = root.querySelector<HTMLButtonElement>('.convertpick .btn-confirm')!;
    expect(confirm.disabled).toBe(false);
    confirm.click();

    expect(root.querySelector('.confirm-row')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-skill')!.click();
    expect(seen[0]).toMatchObject({
      t: 'fengmang',
      accept: true,
      attackDieId: 'fm-a',
      meditationDieId: 'fm-m',
    });
  });

  it('005 影袭：2v2 步骤不含 seat（目标由攻守标记决定），buildParams 用压缩后的数字', () => {
    const g = createTwoVTwoGame(setup());
    const spec = SKILL_SELECTION['yingle.yingxi'];
    const die = g.players.A2.areas.attack[0];
    // 未选骰：只有「选骰」一步
    expect(spec.steps(args(g, 'A2')).map((s) => s.kind)).toEqual(['dice']);
    // 选骰后：多出「选数字 X」；此时数字在**绝对下标 1**
    const steps = spec.steps({ ...args(g, 'A2'), chosenDice: [[die.id]] });
    expect(steps.map((s) => s.kind)).toEqual(['dice', 'number']);
    // 2v2 必须与 1v1 同口径：先压缩再交给 buildParams（否则 numbers[0] 为空 → x must be >= 1）
    const compacted = compactNumbers(steps, [0, 2]);
    expect(compacted).toEqual([2]);
    expect(spec.buildParams({ ...args(g, 'A2'), chosenDice: [[die.id]], numbers: compacted })).toEqual({
      dieId: die.id,
      x: 2,
    });
  });

  it('005 影袭：2v2 技能按钮用技能名（不是神器名）', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.phase = 'main';
    state.activePlayer = 'A2';
    const art = state.players.A2.artifacts.find((a) => a.id === '005')!;
    art.activeMarkerSide = 'left';
    state.players.A2.areas.attack = [{ id: 'yx-a', value: 3, kind: 'attack' }] as never;
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });

    const texts = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).map(
      (b) => b.textContent ?? '',
    );
    expect(texts).toContain('启动技能：影袭');
    expect(texts).not.toContain('启动技能：影掠');
  });

  it('005 影袭：2v2 攻方选择 → 技能步骤跑完再选目标 → 确认条', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.phase = 'main';
    state.activePlayer = 'A2';
    state.stance = 'attackPicks';
    const art = state.players.A2.artifacts.find((a) => a.id === '005')!;
    art.activeMarkerSide = 'left';
    state.players.A2.areas.attack = [{ id: 'yx-a', value: 3, kind: 'attack' }] as never;
    const seen: Array<Record<string, unknown>> = [];
    render2v2Game(root, state, { onAction: (a) => seen.push(a as never), onBack: () => {} });

    const skill = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).find(
      (b) => b.textContent === '启动技能：影袭',
    )!;
    skill.click();
    // 第 1 步：选骰（骰片，不是 seat）
    expect(root.querySelector('.selector .b2v2-target')).toBeNull();
    root.querySelector<HTMLElement>('.selector .pay-dice [data-id="yx-a"]')!.click();
    root.querySelector<HTMLButtonElement>('.selector .btn-skill')!.click();
    // 第 2 步：选 X（只有一个可点数字：x 只能是 1，因为 3-1=2 点）
    const numbers = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .option-btn'));
    expect(numbers.map((b) => b.dataset.choice)).toEqual(['1', '2']);
    numbers[1].click();
    // 步骤跑完 → 出现目标行（不是第一敌人自动落定）
    const targets = Array.from(root.querySelectorAll<HTMLElement>('.actionlist .b2v2-target'));
    expect(targets.map((b) => b.dataset.choice)).toEqual(['B1', 'B2']);
    targets[1].click();
    expect(root.querySelector('.confirm-row')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-skill')!.click();
    expect(seen[0]).toMatchObject({
      t: 'skill',
      artifactId: '005',
      params: { dieId: 'yx-a', x: 2 },
      target: 'B2',
    });
  });

  it('005 影袭：2v2 守方选择 → 技能步骤跑完后先进投票，不直接派发', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.phase = 'main';
    state.activePlayer = 'A2';
    state.stance = 'defensePicks';
    const art = state.players.A2.artifacts.find((a) => a.id === '005')!;
    art.activeMarkerSide = 'left';
    state.players.A2.areas.attack = [{ id: 'yx-a', value: 3, kind: 'attack' }] as never;
    const seen: unknown[] = [];
    render2v2Game(root, state, { onAction: (a) => seen.push(a), onBack: () => {} });

    const skill = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).find(
      (b) => b.textContent === '启动技能：影袭',
    )!;
    skill.click();
    root.querySelector<HTMLElement>('.selector .pay-dice [data-id="yx-a"]')!.click();
    root.querySelector<HTMLButtonElement>('.selector .btn-skill')!.click();
    root.querySelector<HTMLButtonElement>('.selector .option-btn[data-choice="2"]')!.click();
    expect(root.querySelector('[data-role="team-vote"]')).not.toBeNull();
    expect(seen).toHaveLength(0);
  });

  it('005 影袭：引擎使用所选目标 B2 发起虚拟攻击', () => {
    const cfg = setup();
    cfg.dice = {
      A2: { attack: [3], defense: [], meditation: [] },
      B1: { attack: [], defense: [1], meditation: [] },
      B2: { attack: [], defense: [1, 6], meditation: [] },
    };
    const g = createTwoVTwoGame(cfg);
    const die = g.players.A2.areas.attack[0];
    SKILL_HANDLERS['yingle.yingxi'].run({
      ...ctx(g, 'A2', '005'),
      params: { dieId: die.id, x: 1 },
      target: 'B2',
    });
    expect(g.pendingAttack?.defender).toBe('B2');
  });

  it('005 影袭：引擎先报 move（下降骰改点换区）再发起虚拟攻击', () => {
    // 1v1 的观感顺序＝「下降骰飞中间 → 回骰区 → 才打灰骰」。
    // 引擎侧对应＝先 `fxPush({kind:'move'})`（界面据此延迟攻击起步），再 `virtualAttack`。
    const cfg = setup();
    cfg.dice = {
      A2: { attack: [3], defense: [], meditation: [] },
      B1: { attack: [], defense: [1], meditation: [] },
      B2: { attack: [], defense: [1, 6], meditation: [] },
    };
    const g = createTwoVTwoGame(cfg);
    const die = g.players.A2.areas.attack[0]!;
    fxReset();
    SKILL_HANDLERS['yingle.yingxi'].run({
      ...ctx(g, 'A2', '005'),
      params: { dieId: die.id, x: 1 },
      target: 'B2',
    });
    const events = fxTake();
    // 这一刀只有"搬家"这一条 fx（虚拟攻击本身走 pendingAttack，不发 fx）
    expect(events.map((e) => e.kind)).toEqual(['move']);
    const mv = events[0] as Extract<FxEvent, { kind: 'move' }>;
    expect(mv.player).toBe('A2');
    expect(mv.dieIds).toEqual([die.id]);
    // 那颗骰已经改点、并换了区域（3 → 2）
    const after = (
      ['attack', 'defense', 'meditation'] as const
    )
      .flatMap((k) => g.players.A2.areas[k])
      .find((d) => d.id === die.id)!;
    expect(after.value).toBe(2);
    // 虚拟攻击确实已发起（灰骰），点数为 X
    expect(g.pendingAttack).toMatchObject({
      attacker: 'A2',
      defender: 'B2',
      physical: false,
      baseValue: 1,
      sourceSkill: '影袭',
    });
  });

  it('006 必杀：2v2 攻击骰支付步骤允许 034 存放骰', () => {
    const g = createTwoVTwoGame(setup034());
    const steps = SKILL_SELECTION['wansha.ultimate'].steps(args(g, 'A1', 'B2'));
    const cost = steps.find(
      (s): s is Extract<SelectStep, { kind: 'dice' }> =>
        s.kind === 'dice' && s.owner === 'self' && s.areas.includes('attack'),
    );
    expect(cost?.allowArtifact).toBe(true);
  });

  it('006 必杀：可以用 034 存放的攻击骰支付，并弃置所选目标防御骰', () => {
    const cfg = setup034();
    cfg.dice = {
      A1: { attack: [], defense: [], meditation: [] },
      B1: { attack: [], defense: [1], meditation: [] },
      B2: { attack: [], defense: [2, 3], meditation: [] },
    };
    const g = createTwoVTwoGame(cfg);
    const a034 = g.players.A1.artifacts.find((a) => a.id === '034')!;
    a034.activeMarkerSide = 'left';
    a034.heldDice = [{ id: 'held-atk3', value: 3 }];
    const b1 = g.players.B1.areas.defense.length;
    const b2 = g.players.B2.areas.defense.length;

    SKILL_HANDLERS['wansha.ultimate'].run({
      ...ctx(g, 'A1', '006'),
      params: {
        costSlots: [{ dieIds: ['held-atk3'] }],
        opponentDefenseDieIds: g.players.B2.areas.defense.map((d) => d.id),
      },
      target: 'B2',
    });

    expect(a034.heldDice).toHaveLength(0);
    expect(g.players.B1.areas.defense.length).toBe(b1);
    expect(g.players.B2.areas.defense.length).toBe(0);
    expect(g.players.A1.areas.attack.length).toBe(0);
    expect(b2).toBe(2);
  });
});
