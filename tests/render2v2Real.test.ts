import { describe, it, expect, vi } from 'vitest';
import { createTwoVTwoGame } from '../src/core/engine/game';
import { effectiveWill } from '../src/core/engine/derive';
import { render2v2Game } from '../src/ui/battle2v2View';
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

describe('2v2 真实可操作界面', () => {
  it('四席、团队生命和真实操作按钮都在', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    expect(root.querySelectorAll('.player[data-player]')).toHaveLength(4);
    expect(root.querySelectorAll('.card[data-artifact]')).toHaveLength(12);
    expect(root.querySelectorAll('.card-art')).toHaveLength(12);
    expect(root.querySelectorAll('.card-name')).toHaveLength(12);
    expect(root.querySelectorAll('.team-head')).toHaveLength(4);
    expect(root.querySelectorAll('.card-head .badge-active')).toHaveLength(0);
    expect(root.querySelectorAll('.lifeline--team')).toHaveLength(2);
    expect(root.querySelectorAll('.badge-seal')).toHaveLength(1);
    expect(
      root.querySelector('.player[data-player="B2"] .area[data-kind="meditation"] .area-seal')?.textContent,
    ).toBe('尘印');
    expect(root.querySelector('.sidebar .log-line')).not.toBeNull();
    expect(root.querySelector('.btn-settings')).not.toBeNull();
    expect(root.querySelector('.stance-token')).not.toBeNull();
    expect(root.querySelector('.hint-dust .hint-dust-num')?.textContent).toBe('0');
    expect(root.querySelectorAll('.ph-right--active')).toHaveLength(1);
    expect(root.querySelectorAll('.team-head--acting')).toHaveLength(1);
    expect(root.querySelector('.actionlist')?.children.length).toBeGreaterThan(0);
  });

  it('对局中不显示顶栏/返回/阶段药丸', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    expect(root.querySelector('.b2v2-topbar')).toBeNull();
    expect(root.querySelector('.b2v2-back')).toBeNull();
    expect(root.querySelector('.b2v2-badge')).toBeNull();
  });
});

  it('点击卡图打开技能详情', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    root.querySelector<HTMLElement>('.card[data-artifact]')!.click();
    expect(root.querySelector('.detail-popover .detail-title')?.textContent).toBeTruthy();
    expect(root.querySelector('.detail-popover .detail-sub')?.textContent).toContain('第');
    expect(root.querySelector('.detail-popover .detail-sub')?.textContent).toContain('生命');
    expect(root.querySelector('.detail-popover .skills .skill .skill-part')).not.toBeNull();
    expect(root.querySelector('.detail-close')?.classList.contains('btn-cancel')).toBe(true);
    root.querySelector<HTMLButtonElement>('.detail-close')!.click();
    expect(root.querySelector('.detail-overlay')).toBeNull();
  });

  it('神器卡头复用 1v1 的座位增益、计数和真实存放骰', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    const art = state.players.A1.artifacts[0];
    state.players.A1.buffs.push({ attr: 'speed', add: 2, duration: 'thisTurn' });
    art.count = 2;
    art.countCap = undefined;
    art.heldDice = [{ id: 'held-a', value: 5 }];
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    const card = root.querySelector<HTMLElement>('.player[data-player="A1"] .card[data-artifact="001"]')!;
    const delta = card.querySelector('.sub-delta');
    expect(delta?.classList.contains('player-A1')).toBe(true);
    expect(delta?.previousSibling?.textContent ?? '').not.toMatch(/　$/);
    expect(card.querySelector('.badge-count')?.textContent).toBe('计数 2');
    expect(card.querySelectorAll('.pay-die--held')).toHaveLength(1);
  });

  it('设置改动同步到 board 状态；战报可收起', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    root.querySelector<HTMLButtonElement>('.btn-settings')!.click();
    const clickRow = (label: string, text: string): void => {
      const row = Array.from(root.querySelectorAll<HTMLElement>('.settings-row')).find(
        (r) => r.querySelector('.settings-label')?.textContent === label,
      );
      const btn = Array.from(row?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(
        (b) => b.textContent === text,
      );
      btn!.click();
    };
    clickRow('显示技能描述', '显示');
    expect(root.querySelector('.board--2v2')?.classList.contains('show-text')).toBe(true);
    clickRow('界面密度', '舒适');
    expect(root.querySelector('.board--2v2')?.classList.contains('density-comfortable')).toBe(true);
    clickRow('战报栏', '收起');
    expect(root.querySelector('.sidebar')).toBeNull();
    expect(root.querySelector('.log-tab')).not.toBeNull();
  });

  it('手动缩放复用 1v1 设置面板', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    root.querySelector<HTMLButtonElement>('.btn-settings')!.click();
    const row = (label: string): HTMLElement | undefined =>
      Array.from(root.querySelectorAll<HTMLElement>('.settings-row')).find((r) =>
        r.querySelector('.settings-label')?.textContent?.startsWith(label),
      );
    const clickIn = (label: string, text: string): void => {
      const b = Array.from(row(label)?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(
        (x) => x.textContent === text,
      );
      b!.click();
    };
    clickIn('整屏缩放', '手动');
    const zoomLabel = row('缩放比例')?.querySelector('.settings-label')?.textContent ?? '';
    expect(zoomLabel).toMatch(/^缩放比例 \d+%$/);
    const before = zoomLabel;
    clickIn('缩放比例', '缩小');
    expect(row('缩放比例')?.querySelector('.settings-label')?.textContent).not.toBe(before);
    expect(root.querySelector<HTMLElement>('.stage')?.style.transform).toContain('scale(');
    const input = root.querySelector<HTMLInputElement>('.settings-zoom-input')!;
    input.value = '150';
    input.dispatchEvent(new Event('change'));
    expect(root.querySelector<HTMLElement>('.stage')?.style.transform).toBe('scale(1.5)');
  });

  it('攻击先由守方两名座位投票选防守者', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.phase = 'main';
    state.stance = 'defensePicks';
    state.players.A1.areas.attack = [{ id: 'a1-atk', value: 4, kind: 'attack' }] as never;
    const seen: unknown[] = [];
    render2v2Game(root, state, { onAction: (a) => seen.push(a), onBack: () => {} });
    const attack = root.querySelector<HTMLButtonElement>('.actionlist-chips .pay-die[data-act="attack"]');
    expect(attack).toBeTruthy();
    attack!.click();
    expect(root.querySelector('.b2v2-vote')).not.toBeNull();
    expect(root.querySelectorAll('.b2v2-target')).toHaveLength(0);
    // 第 1 行「这一刀」（攻击方名字上色）＋ 第 2 行提示（不再写"谁发起攻击"）
    expect(root.querySelector('.b2v2-vote-info')?.textContent).toContain('玩家A1');
    expect(root.querySelector('.b2v2-vote-tip')?.textContent).toBe(
      '请两位守方玩家投票决定由谁承受本次攻击；投票不一致会重新选择。',
    );
    const sideRows = Array.from(root.querySelectorAll<HTMLElement>('.main > .side-row'));
    const bottomRow = sideRows[sideRows.length - 1];
    const bottomSeats = Array.from(bottomRow?.querySelectorAll<HTMLElement>('.player[data-player]') ?? []).map(
      (p) => p.dataset.player,
    );
    expect(bottomSeats).toEqual(['B1', 'B2']);
    const areaKinds = (row?: HTMLElement): string[] =>
      Array.from(row?.querySelectorAll<HTMLElement>('.player:first-child .area') ?? []).map(
        (a) => a.dataset.kind ?? '',
      );
    expect(areaKinds(sideRows[0])).toEqual(['meditation', 'attack', 'defense']);
    expect(areaKinds(bottomRow)).toEqual(['defense', 'attack', 'meditation']);
    expect(
      root.querySelector('[data-voter="B1"] [data-choice="B2"]')?.classList.contains('player-B2'),
    ).toBe(true);
    root.querySelector<HTMLElement>('[data-voter="B1"] [data-choice="B2"]')!.click();
    root.querySelector<HTMLElement>('[data-voter="B2"] [data-choice="B2"]')!.click();
    expect(seen[0]).toMatchObject({ t: 'attack', target: 'B2' });
  });

  it('攻方选择时由攻方点名目标，不进入守方投票', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.phase = 'main';
    state.stance = 'attackPicks';
    state.players.A1.areas.attack = [{ id: 'a1-atk2', value: 4, kind: 'attack' }] as never;
    const seen: unknown[] = [];
    render2v2Game(root, state, { onAction: (a) => seen.push(a), onBack: () => {} });
    root.querySelector<HTMLButtonElement>('.actionlist-chips .pay-die[data-act="attack"]')!.click();
    expect(root.querySelector('.b2v2-vote')).toBeNull();
    expect(root.querySelector('.actionlist-chips .pay-die[data-act="attack"]')?.classList.contains('selected')).toBe(true);
    const targetButton = root.querySelector<HTMLElement>('.option-row [data-choice="B2"]')!;
    const endTurn = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).find(
      (b) => b.textContent === '结束回合',
    )!;
    expect((targetButton.compareDocumentPosition(endTurn) & 4) !== 0).toBe(true);
    targetButton.click();
    expect(root.querySelector('.confirm-label')?.textContent).toContain('B2');
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-skill')!.click();
    expect(seen[0]).toMatchObject({ t: 'attack', target: 'B2' });
    expect((seen[0] as { costSlots: { dieIds: string[] }[] }).costSlots[0].dieIds).toEqual(['a1-atk2']);
  });

  it('攻方也可先选目标，再点攻击骰直接进确认', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.phase = 'main';
    state.stance = 'attackPicks';
    state.players.A1.areas.attack = [{ id: 'a1-atk3', value: 4, kind: 'attack' }] as never;
    const seen: unknown[] = [];
    render2v2Game(root, state, { onAction: (a) => seen.push(a), onBack: () => {} });
    const target = root.querySelector<HTMLElement>('.option-row [data-choice="B2"]')!;
    expect(target).not.toBeNull();
    target.click();
    expect(root.querySelector('.selector-title')).toBeNull();
    expect(root.querySelector('.option-row [data-choice="B2"]')?.classList.contains('player-B2')).toBe(true);
    const attack = root.querySelector<HTMLButtonElement>('.actionlist-chips .pay-die[data-act="attack"]')!;
    attack.click();
    expect(root.querySelector('.confirm-label')?.textContent).toContain('B2');
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-skill')!.click();
    expect(seen[0]).toMatchObject({ t: 'attack', target: 'B2' });
  });

  it('对局结束后显示胜者与重开/返回', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.phase = 'gameOver';
    state.winner = 'A';
    const onRestart = vi.fn();
    const onBack = vi.fn();
    render2v2Game(root, state, { onAction: () => {}, onBack, onRestart });
    expect(root.querySelector('.b2v2-gameover')).not.toBeNull();
    expect(root.querySelector('.b2v2-gameover-winner')?.textContent).toBe('A 队胜利');
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.b2v2-gameover button'));
    expect(buttons.map((b) => b.textContent)).toEqual(['再来一局', '返回']);
    buttons[0]!.click();
    expect(onRestart).toHaveBeenCalledOnce();
    buttons[1]!.click();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('待抵挡时只能由实际防守座位抵挡', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.phase = 'main';
    state.activePlayer = 'A1';
    state.pendingAttack = {
      attacker: 'A1',
      defender: 'B1',
      value: 3,
      unblockable: false,
      physical: true,
    };
    state.players.B1.areas.defense = [{ id: 'b1-def', value: 4, kind: 'defense' }] as never;
    const seen: unknown[] = [];
    render2v2Game(root, state, { onAction: (a) => seen.push(a), onBack: () => {} });
    const block = root.querySelector<HTMLButtonElement>('.actionlist-chips .pay-die[data-act="block"]');
    expect(block).toBeTruthy();
    block!.click();
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-skill')!.click();
    expect(seen[0]).toMatchObject({ t: 'block', by: 'B1' });
  });

  it('有防御骰时「不抵挡」走确认；完全无抵挡才直接跳过', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.phase = 'main';
    state.activePlayer = 'A1';
    state.pendingAttack = {
      attacker: 'A1',
      defender: 'B1',
      value: 3,
      unblockable: false,
      physical: true,
    };
    state.players.B1.areas.defense = [{ id: 'b1-def', value: 4, kind: 'defense' }] as never;
    const seen: unknown[] = [];
    render2v2Game(root, state, { onAction: (a) => seen.push(a), onBack: () => {} });
    const noBlock = root.querySelector<HTMLButtonElement>('.actionlist > button[data-act="block"]');
    expect(noBlock).toBeTruthy();
    noBlock!.click();
    expect(root.querySelector('.confirm-label')?.textContent).toContain('不抵挡');
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-skill')!.click();
    expect(seen[0]).toMatchObject({ t: 'block', by: 'B1' });

    state.players.B1.areas.defense = [] as never;
    seen.length = 0;
    render2v2Game(root, state, { onAction: (a) => seen.push(a), onBack: () => {} });
    root.querySelector<HTMLButtonElement>('.actionlist > button[data-act="block"]')!.click();
    expect(seen[0]).toMatchObject({ t: 'block', by: 'B1' });
  });

  it('操作按钮不显示内部动作 key', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.phase = 'reroll';
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    const texts = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).map(
      (b) => b.textContent ?? '',
    );
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(/^[a-z][a-zA-Z]*$/.test(text), text).toBe(false);
    expect(texts.some((text) => text.startsWith('重掷'))).toBe(true);
  });

  it('尘起复用 1v1 流程：可选侧、显示尘印、冥想骰用骰片', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.phase = 'dustRise';
    state.activePlayer = 'A1';
    state.players.A1.hasDustSeal = true;
    state.players.A1.areas.meditation = [{ id: 'a1-med', value: 2, kind: 'meditation' }] as never;
    const seen: unknown[] = [];
    render2v2Game(root, state, { onAction: (a) => seen.push(a), onBack: () => {} });
    const dust = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).find(
      (b) => b.dataset.act === 'dustRise',
    );
    expect(dust).toBeTruthy();
    dust!.click();
    expect(root.querySelector('.dustflow')).not.toBeNull();
    const side = root.querySelector<HTMLButtonElement>('.dustflow-side-btn');
    if (side) side.click();
    expect(root.querySelector('.dustflow--pay')).not.toBeNull();
    expect(root.querySelector('.dustflow .btn-seal')).not.toBeNull();
    const die = root.querySelector<HTMLElement>('.dustflow .pay-dice .pay-die[data-id="a1-med"]');
    expect(die).not.toBeNull();
    die!.click();
    expect(seen[0]).toMatchObject({ t: 'dustRise', costSlots: [{ dieIds: ['a1-med'] }] });
  });

  it('结束弃骰由玩家选择具体骰子', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.phase = 'main';
    state.activePlayer = 'A1';
    state.players.A1.areas.attack = [
      { id: 'ed-a1', value: 1, kind: 'attack' },
      { id: 'ed-a2', value: 2, kind: 'attack' },
      { id: 'ed-a3', value: 3, kind: 'attack' },
      { id: 'ed-a4', value: 4, kind: 'attack' },
    ] as never;
    state.players.A1.areas.defense = [
      { id: 'ed-d1', value: 2, kind: 'defense' },
      { id: 'ed-d2', value: 3, kind: 'defense' },
      { id: 'ed-d3', value: 4, kind: 'defense' },
    ] as never;
    state.players.A1.areas.meditation = [
      { id: 'ed-m1', value: 4, kind: 'meditation' },
      { id: 'ed-m2', value: 5, kind: 'meditation' },
      { id: 'ed-m3', value: 6, kind: 'meditation' },
    ] as never;
    state.pending = { kind: 'endDiscard', player: 'A1' } as never;
    const seen: unknown[] = [];
    render2v2Game(root, state, { onAction: (a) => seen.push(a), onBack: () => {} });
    // 1v1 同款：入口按钮（btn btn-skill）→ 选骰面板（.pay-die 骰片，不是 .option-btn 文字按钮）
    const open = root.querySelector<HTMLButtonElement>('[data-act="endDiscardOpen"]');
    expect(open).not.toBeNull();
    expect(open!.className).toBe('btn btn-skill');
    expect(open!.textContent).toBe('结束阶段：弃置超出意志上限的能力骰');
    expect(seen).toHaveLength(0); // 入口按钮不派发动作，只是打开面板
    open!.click();
    expect(root.querySelector('.selector')).not.toBeNull();
    expect(root.querySelector('.selector .option-btn')).toBeNull();
    const allDice = root.querySelectorAll<HTMLElement>('.selector .pay-dice .pay-die');
    expect(allDice.length).toBe(10);
    const need = Math.max(0, 10 - effectiveWill(state.players.A1));
    expect(need).toBeGreaterThan(0);
    expect(root.querySelector<HTMLButtonElement>('.selector .btn-confirm')!.disabled).toBe(true);
    // 每次点击后整块面板重绘 → 必须重新查一次（旧元素里的数组是渲染时的快照）
    for (let i = 0; i < need; i += 1) {
      root.querySelectorAll<HTMLElement>('.selector .pay-dice .pay-die')[i]!.click();
    }
    const confirm = root.querySelector<HTMLButtonElement>('.selector .btn-confirm');
    expect(confirm).not.toBeNull();
    expect(confirm!.disabled).toBe(false);
    confirm!.click();
    // 待决策选择器不弹确认条：直接派发
    expect(root.querySelector('.confirm-row')).toBeNull();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ t: 'endDiscardResolve' });
    expect((seen[0] as { dieIds: string[] }).dieIds).toHaveLength(need);
  });

  it('万丈明光由玩家选择弃置的两颗骰', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.phase = 'main';
    state.activePlayer = 'A1';
    state.players.A1.areas.attack = [
      { id: 'wz-a', value: 1, kind: 'attack' },
      { id: 'wz-b', value: 2, kind: 'attack' },
    ] as never;
    state.players.A1.areas.defense = [] as never;
    state.players.A1.areas.meditation = [] as never;
    state.pending = { kind: 'wanzhangDiscard', player: 'A1' } as never;
    const seen: unknown[] = [];
    render2v2Game(root, state, { onAction: (a) => seen.push(a), onBack: () => {} });
    const open = root.querySelector<HTMLButtonElement>('[data-act="wanzhangOpen"]');
    expect(open).not.toBeNull();
    expect(open!.className).toBe('btn btn-skill');
    expect(open!.textContent).toBe('「万丈明光」：弃置能力骰');
    open!.click();
    expect(root.querySelector('.selector .option-btn')).toBeNull();
    const chips = root.querySelectorAll<HTMLElement>('.selector .pay-dice .pay-die');
    expect(chips.length).toBe(2);
    expect(root.querySelector<HTMLButtonElement>('.selector .btn-confirm')!.disabled).toBe(true);
    root.querySelectorAll<HTMLElement>('.selector .pay-dice .pay-die')[0]!.click();
    root.querySelectorAll<HTMLElement>('.selector .pay-dice .pay-die')[1]!.click();
    const confirm = root.querySelector<HTMLButtonElement>('.selector .btn-confirm');
    expect(confirm!.disabled).toBe(false);
    confirm!.click();
    expect(root.querySelector('.confirm-row')).toBeNull();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ t: 'wanzhangDiscard', dieIds: ['wz-a', 'wz-b'] });
  });


  it('尘起阶段每个神器只有一个入口，不重复渲染候选动作', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.phase = 'dustRise';
    state.activePlayer = 'A1';
    state.players.A1.areas.meditation = [{ id: 'dust-m1', value: 1, kind: 'meditation' }] as never;
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    expect(root.querySelectorAll('.actionlist [data-act="dustRise"]')).toHaveLength(3);
  });

  it('技能按钮打开技能选择器，不强制先选玩家', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.phase = 'main';
    state.activePlayer = 'A1';
    const art = state.players.A1.artifacts.find((a) => a.id === '002')!;
    art.activeMarkerSide = 'right';
    art.armedSide = 'right';
    art.armedTurn = state.turnIndex;
    state.players.A1.areas.meditation = [
      { id: 'sk-m1', value: 1, kind: 'meditation' },
      { id: 'sk-m2', value: 2, kind: 'meditation' },
      { id: 'sk-m3', value: 3, kind: 'meditation' },
    ] as never;
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    const skill = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).find(
      (b) => b.textContent === '启动技能：龙腾万丈',
    );
    expect(skill).toBeTruthy();
    skill!.click();
    expect(root.querySelector('.selector')).not.toBeNull();
    expect(root.querySelector('.selector .pay-dice .pay-die')).not.toBeNull();
    expect(root.querySelector('.option-row [data-choice]')).toBeNull();
  });

  it('死亡亦逝由玩家选择保留规则并弃骰', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.phase = 'main';
    state.activePlayer = 'A1';
    state.players.A1.areas.attack = [
      { id: 'tl-1', value: 1, kind: 'attack' },
      { id: 'tl-2', value: 1, kind: 'attack' },
      { id: 'tl-3', value: 2, kind: 'attack' },
    ] as never;
    state.players.A1.areas.defense = [] as never;
    state.players.A1.areas.meditation = [] as never;
    state.pending = { kind: 'tiaolingPick', player: 'A1' } as never;
    const seen: unknown[] = [];
    render2v2Game(root, state, { onAction: (a) => seen.push(a), onBack: () => {} });
    const open = root.querySelector<HTMLButtonElement>('[data-act="tiaolingOpen"]');
    expect(open).not.toBeNull();
    expect(open!.className).toBe('btn btn-skill');
    expect(open!.textContent).toBe('「死亡亦逝」：弃置自己的能力骰');
    open!.click();
    // ① 选规则（option 步在 2v2 点击即推进，无确认条）
    const options = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .option-btn'));
    expect(options.map((b) => b.dataset.choice)).toEqual(['same', 'diff']);
    options[0]!.click();
    // ② 骰片选择（.pay-die），要把 tl-3（2 点）弃掉才能"剩余全相同"
    const chips = root.querySelectorAll<HTMLElement>('.selector .pay-dice .pay-die');
    expect(chips.length).toBe(3);
    expect(root.querySelector<HTMLButtonElement>('.selector .btn-confirm')!.disabled).toBe(true);
    root.querySelector<HTMLElement>('.selector .pay-dice .pay-die[data-id="tl-3"]')!.click();
    const confirm = root.querySelector<HTMLButtonElement>('.selector .btn-confirm');
    expect(confirm!.disabled).toBe(false);
    confirm!.click();
    expect(root.querySelector('.confirm-row')).toBeNull();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ t: 'tiaolingResolve', pick: 'same', dieIds: ['tl-3'] });
  });

  it('全知复用 1v1 分配面板', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.phase = 'main';
    state.activePlayer = 'A1';
    state.players.A1.areas.attack = [
      { id: 'qz-1', value: 1, kind: 'attack' },
      { id: 'qz-2', value: 1, kind: 'attack' },
      { id: 'qz-3', value: 2, kind: 'attack' },
    ] as never;
    state.players.A1.areas.defense = [] as never;
    state.players.A1.areas.meditation = [] as never;
    state.pending = { kind: 'quanzhiAssign', player: 'A1' } as never;
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    expect(root.querySelector('.selector-title')?.textContent).toContain('全知');
  });

  it('换阶段不会把所有骰子当成新获得的骰子', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const rect = { left: 0, top: 0, width: 80, height: 24, right: 80, bottom: 24, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect);
    const state = createTwoVTwoGame(setup());
    state.phase = 'main';
    state.activePlayer = 'A1';
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    const count = root.querySelectorAll('.die').length;
    const beforeFx = document.querySelectorAll('#fx-layer .fx-die').length;
    state.phase = 'dustRise';
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    expect(root.querySelectorAll('.die').length).toBe(count);
    expect(document.querySelectorAll('#fx-layer .fx-die').length).toBe(beforeFx);
    spy.mockRestore();
    document.getElementById('fx-layer')?.remove();
  });

  it('换手时补播「回合开始」和跨阶段横幅', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const rect = { left: 0, top: 0, width: 80, height: 24, right: 80, bottom: 24, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect);
    const state = createTwoVTwoGame(setup());
    state.phase = 'main';
    state.activePlayer = 'A1';
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    state.activePlayer = 'B1';
    state.phase = 'main';
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    const banners = Array.from(document.querySelectorAll('.fx-banner')).map((b) => b.textContent);
    expect(banners).toContain('玩家B1 · 回合开始');
    expect(banners).toContain('尘起阶段');
    expect(banners).toContain('主要阶段');
    spy.mockRestore();
    document.getElementById('fx-layer')?.remove();
  });

  it('阶段显示中文标签，不暴露内部 phase key', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.phase = 'main';
    state.activePlayer = 'A1';
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    expect(root.querySelector('.hint-phase')?.textContent).toContain('主要阶段');
    expect(root.querySelector('.hint-phase')?.textContent).not.toContain('main');
  });

  it('真实骰子保留引擎 id 和座位 class，动画可追踪', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.phase = 'main';
    state.activePlayer = 'A1';
    state.players.A1.areas.attack = [{ id: 'real-a1-attack', value: 4, kind: 'attack' }] as never;
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    const die = root.querySelector<HTMLElement>('.die[data-id="real-a1-attack"]');
    expect(die).not.toBeNull();
    expect(die!.classList.contains('die-A1')).toBe(true);
    expect(die!.dataset.value).toBe('4');
  });

  it('团队生命变化走共享生命飘字/血条动画', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const rect = { left: 0, top: 0, width: 80, height: 24, right: 80, bottom: 24, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect);
    const oldAnimate = Element.prototype.animate;
    const animate = vi.fn();
    Element.prototype.animate = animate as never;
    const state = createTwoVTwoGame(setup());
    state.phase = 'main';
    state.activePlayer = 'A1';
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    state.teams!.A.life -= 5;
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    expect(document.querySelector('.fx-text--dmg')).not.toBeNull();
    expect(animate).toHaveBeenCalled();
    Element.prototype.animate = oldAnimate;
    spy.mockRestore();
    document.getElementById('fx-layer')?.remove();
  });

  it('攻击动画从攻方攻击区连到目标座位生命条端点', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const rect = { left: 0, top: 0, width: 80, height: 24, right: 80, bottom: 24, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect);
    const state = createTwoVTwoGame(setup());
    state.phase = 'main';
    state.activePlayer = 'A1';
    state.pendingAttack = {
      attacker: 'A1',
      defender: 'B1',
      value: 4,
      baseValue: 4,
      physical: true,
      unblockable: false,
    } as never;
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    expect(document.querySelector('#fx-layer .fx-die')).not.toBeNull();
    spy.mockRestore();
    document.getElementById('fx-layer')?.remove();
  });

  it('初始重掷可选具体骰，按钮为重掷选中(N)', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.activePlayer = 'A1';
    state.phase = 'initialReroll';
    const seen: unknown[] = [];
    render2v2Game(root, state, { onAction: (a) => seen.push(a), onBack: () => {} });
    const dice = Array.from(root.querySelectorAll<HTMLElement>('.player[data-player="A1"] .die')).slice(0, 2);
    expect(dice).toHaveLength(2);
    dice.forEach((d) => d.click());
    const reroll = root.querySelector<HTMLButtonElement>('.actionlist .btn-reroll');
    expect(reroll?.textContent).toContain('重掷选中(2)');
    reroll!.click();
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-skill')!.click();
    expect(seen[0]).toMatchObject({ t: 'reroll' });
    expect((seen[0] as { dieIds: string[] }).dieIds).toHaveLength(2);
  });

  it('2v2 战报保留真实座位名，不重复拼接 actor', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.phase = 'main';
    state.log = [{ turn: 0, phase: 'main', text: '玩家A1 使用 4 点攻击骰攻击 玩家B1' }];
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    root.querySelector<HTMLElement>('.log-tab')?.click();
    const text = root.querySelector('.log')?.textContent ?? '';
    expect(text).toContain('T0·主要：');
    expect(text).toContain('玩家A1 使用 4 点攻击骰攻击 玩家B1');
    expect(text).not.toContain('A1 玩家A1');
  });

  it('快速操作栏提示复用 1v1 阶段提示，并写明攻击目标', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.activePlayer = 'A1';
    state.phase = 'initialReroll';
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    expect(root.querySelector('.hint-phase')?.textContent).toContain('初始重掷');

    state.phase = 'main';
    state.pendingAttack = {
      attacker: 'A1',
      defender: 'B1',
      value: 4,
      baseValue: 4,
      physical: true,
      unblockable: false,
    } as never;
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    const hint = root.querySelector('.hint-phase')?.textContent ?? '';
    expect(hint).toContain('目标');
    expect(hint).toContain('玩家B1');
    expect(hint).not.toContain('main');
  });
