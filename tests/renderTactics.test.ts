// 战术牌·战斗界面：战前「抽 2 留 1」弹窗 + 战斗中的战术牌横条
import { describe, it, expect } from 'vitest';
import { createGame, applyAction, getLegalActions } from '../src/core/engine/game';
import { effectiveWill, emptyDistribution } from '../src/core/engine/derive';
import { areaOf } from '../src/core/model/dice';
import { TACTIC_BY_ID } from '../src/core/content/tactics';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import type { Action, GameState } from '../src/core/model/types';

const makeUi = (showSkillText = false): UiState => ({
  rerollSelected: new Set(),
  selection: null,
  pendingConfirm: null,
  convertPick: null,
  fengmangPick: null,
  hanguangPick: null,
  quanzhi: null,
  dustFlow: null,
  prefs: {
    showSkillText,
    cardArt: 'thumb',
    density: 'compact',
    mirrorEnemy: false,
    preset: 'desktop',
    logCollapsed: false,
    zoomMode: 'off',
    zoomPercent: 90,
  },
  settingsOpen: false,
  logOpen: false,
  logPop: false,
  detail: null,
  error: null,
});

const mount = (state: GameState, showSkillText = false): { root: HTMLElement; acts: Action[]; ui: UiState } => {
  const root = document.createElement('div');
  const acts: Action[] = [];
  const ui = makeUi(showSkillText);
  const hooks: RenderHooks = {
    onAction: (a) => { acts.push(a); renderGame(state, root, hooks); },
    ui,
    propose: (a) => { acts.push(a); renderGame(state, root, hooks); },
    requestRender: () => renderGame(state, root, hooks),
    onRestart: () => {},
  };
  renderGame(state, root, hooks);
  return { root, acts, ui };
};

describe('战术牌·战前弹窗（战斗界面）', () => {
  it('显示当前选者的 2 张（卡图+名字+效果）；点击派发 tacticPick', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tactics: true });
    const { root, acts } = mount(g);
    const cards = Array.from(root.querySelectorAll<HTMLButtonElement>('.tactic-choose-card'));
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.dataset.id)).toEqual([...g.tacticHand]);
    expect(cards.every((c) => !!c.querySelector('img'))).toBe(true);
    expect(root.querySelector('.tactic-choose-title')!.textContent).toContain('玩家A');
    cards[1].click();
    expect(acts).toEqual([{ t: 'tacticPick', id: g.tacticHand[1] }]);
  });
});

describe('战斗界面·战术牌横条', () => {
  const played = (): GameState => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tactics: true });
    let guard = 0;
    while (g.phase === 'tactics' && guard++ < 20) {
      if (g.pending) applyAction(g, getLegalActions(g)[0]);
      else if (g.tacticQueue[0]) applyAction(g, { t: 'tacticPick', id: g.tacticHand[0] });
      else break;
    }
    return g;
  };

  it('双方各一条横条（名字）；默认不显示效果文本，开启后显示全文', () => {
    const g = played();
    const { root } = mount(g, false);
    const bars = Array.from(root.querySelectorAll('.tactic-bar'));
    expect(bars).toHaveLength(2);
    const names = Array.from(root.querySelectorAll('.tactic-bar-name')).map((n) => n.textContent).sort();
    expect(names).toEqual(
      [
        TACTIC_BY_ID[g.players.A.tactic as string]!.name,
        TACTIC_BY_ID[g.players.B.tactic as string]!.name,
      ].sort(),
    );
    expect(root.querySelectorAll('.tactic-bar-eff')).toHaveLength(0); // 关＝只名字

    const { root: root2 } = mount(g, true);
    expect(root2.querySelectorAll('.tactic-bar-eff')).toHaveLength(2);
    expect(root2.querySelector('.tactic-bar-eff')!.textContent!.length).toBeGreaterThan(0);
  });

  it('右键名字 → 战术牌详情浮窗（含裁切卡图 + 效果）', () => {
    const g = played();
    const { root, ui } = mount(g);
    const nameBtn = root.querySelector<HTMLElement>('.tactic-bar-name')!;
    expect(nameBtn.dataset.tactic).toBeTruthy(); // 供"连续右键"遮罩转发识别
    nameBtn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(ui.detail?.artifactId).toBeTruthy();
    const pop = root.querySelector('.detail-popover--tactic');
    expect(pop).not.toBeNull();
    expect(pop!.querySelector('img')!.getAttribute('src')).toMatch(/^\.\/tactics\/T0[0-9]\.jpg$/);
    expect(pop!.querySelector('.detail-tactic-eff')!.textContent!.length).toBeGreaterThan(0);
  });

  it('「战术」药丸常显：隐藏技能描述时仍保留（复用 .skill-type 外观）', () => {
    const g = played();
    const { root } = mount(g); // showSkillText=false
    const bar = root.querySelector('.tactic-bar')!;
    const kind = bar.querySelector('.tactic-bar-kind')!;
    expect(kind.textContent).toBe('战术');
    expect(kind.classList.contains('skill-type')).toBe(true);
    expect(bar.querySelector('.tactic-bar-eff')).toBeNull();
  });

  it('无战术牌 → 不渲染横条', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' }); // 未开战术牌
    const { root } = mount(g);
    expect(root.querySelectorAll('.tactic-bar')).toHaveLength(0);
  });
});

describe('战术牌·战前「战斗开始时」弹窗', () => {
  it('T02「先机」：2 个先手选项；点击派发 tacticFirst', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T04', tacticB: 'T02' });
    expect(g.pending?.kind).toBe('tacticFirst');
    const { root, acts } = mount(g);
    const cards = Array.from(root.querySelectorAll<HTMLButtonElement>('.tactic-first-card'));
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.dataset.who)).toEqual(['A', 'B']);
    cards[1].click();
    expect(acts).toEqual([{ t: 'tacticFirst', who: 'B' }]);
  });

  it('T01「谨慎」：每个点数一行 6 个选项；选满且合规后才可确认；显示分布提示', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T01', tacticB: 'T04' });
    expect(g.pending?.kind).toBe('tacticDice');
    const will = effectiveWill(g.players.A);
    const dist = emptyDistribution(g.players.A)!;
    const chosen: number[] = [];
    for (const kind of ['attack', 'defense', 'meditation'] as const) {
      for (let i = 0; i < 4 && chosen.length < will && dist[kind].length > 0; i++) chosen.push(dist[kind][0]);
    }
    const { root, acts } = mount(g);

    // 点数→类型映射（静态）
    const map = root.querySelector('.tactic-dice-map')!;
    expect(map.textContent).toContain('你的分布');
    for (const kind of ['attack', 'defense', 'meditation'] as const) {
      expect(map.textContent).toContain(dist[kind].join('·'));
    }

    const rows = Array.from(root.querySelectorAll<HTMLElement>('.tactic-dice-row'));
    expect(rows).toHaveLength(will);
    const statNums = Array.from(root.querySelectorAll<HTMLElement>('.tactic-dice-dist-n'));
    expect(statNums).toHaveLength(3); // 攻/防/冥
    expect(statNums.map((n) => n.textContent)).toEqual(['0', '0', '0']); // 未选

    const confirm = root.querySelector<HTMLButtonElement>('.tactic-dice-confirm')!;
    expect(confirm.disabled).toBe(true);
    rows.forEach((row, i) => {
      const btns = Array.from(row.querySelectorAll<HTMLButtonElement>('.tactic-dice-num'));
      btns.find((b) => Number(b.dataset.val) === chosen[i])!.click();
    });

    // 每行类型标签 = 该点数的类型
    const KIND_SHORT: Record<string, string> = { attack: '攻', defense: '防', meditation: '冥' };
    rows.forEach((row, i) => {
      expect(row.querySelector('.tactic-dice-kind')!.textContent).toBe(KIND_SHORT[areaOf(chosen[i], dist)]);
    });
    // 底部统计 = 已选各类数量（精确）
    const expectCounts = { attack: 0, defense: 0, meditation: 0 } as Record<string, number>;
    for (const v of chosen) expectCounts[areaOf(v, dist)] += 1;
    expect(statNums.map((n) => n.textContent)).toEqual([
      String(expectCounts.attack),
      String(expectCounts.defense),
      String(expectCounts.meditation),
    ]);

    expect(confirm.disabled).toBe(false);
    confirm.click();
    const a = acts[0] as Extract<Action, { t: 'tacticDice' }>;
    expect(a.t).toBe('tacticDice');
    expect(a.values).toEqual(chosen);
  });

  it('T01「谨慎」：某类型超过 4 → 该统计数字转红 + 禁止确认', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T01', tacticB: 'T04' });
    const will = effectiveWill(g.players.A);
    expect(will).toBeGreaterThan(4); // 本用例前提
    const dist = emptyDistribution(g.players.A)!;
    const { root } = mount(g);
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.tactic-dice-row'));
    // 每行都选攻击类型的同一个点数 → 攻击数 = will > 4
    rows.forEach((row) => {
      const btns = Array.from(row.querySelectorAll<HTMLButtonElement>('.tactic-dice-num'));
      btns.find((b) => Number(b.dataset.val) === dist.attack[0])!.click();
    });
    const statNums = Array.from(root.querySelectorAll<HTMLElement>('.tactic-dice-dist-n'));
    expect(statNums[0].textContent).toBe(String(will)); // 攻
    expect(statNums[0].classList.contains('over')).toBe(true);
    expect(statNums[1].classList.contains('over')).toBe(false);
    expect(root.querySelector<HTMLButtonElement>('.tactic-dice-confirm')!.disabled).toBe(true);
    expect(root.querySelector('.tactic-dice-err')!.textContent).toContain('不能超过 4');
  });
});

describe('战术牌横条三态（生效中/已用尽/普通）', () => {
  const barOf = (root: HTMLElement, who: 'A' | 'B') =>
    root.querySelector<HTMLElement>(`.player[data-player="${who}"] .tactic-bar`)!;

  it('开局设置类 T03 → 已用尽（灰）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T03', tacticB: 'T04' });
    const { root } = mount(g);
    expect(barOf(root, 'A').classList.contains('tactic-bar--spent')).toBe(true);
    expect(barOf(root, 'B').classList.contains('tactic-bar--normal')).toBe(true); // T04 普通
  });

  it('T06：对方生命 ≤13 → 生效中（绿 + 「生效中」）；14 → 普通', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T06', tacticB: 'T04' });
    g.players.B.life = 14;
    const { root } = mount(g);
    expect(barOf(root, 'A').classList.contains('tactic-bar--normal')).toBe(true);
    g.players.B.life = 13;
    const { root: root2 } = mount(g);
    const bar = barOf(root2, 'A');
    expect(bar.classList.contains('tactic-bar--active')).toBe(true);
    expect(bar.querySelector('.tactic-bar-state')).toBeNull(); // 只变绿，不再有「生效中」药丸
  });

  it('T05：自己前 3 回合内 → 绿；第 4 回合起 → 灰', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T05', tacticB: 'T04' });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.turnsTaken = 1;
    const { root } = mount(g);
    expect(barOf(root, 'A').classList.contains('tactic-bar--active')).toBe(true);
    g.players.A.turnsTaken = 4;
    const { root: root2 } = mount(g);
    expect(barOf(root2, 'A').classList.contains('tactic-bar--spent')).toBe(true);
  });

  it('T04「末路」：有就绪的必杀 → 生效中（绿）；无 → 普通', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      legendA: 'L02',
      heroA: ['001', '002', '003'],
      heroB: ['001', '002', '003'],
      tacticA: 'T04',
      tacticB: 'T03',
    });
    // 传奇必杀 L02「藏地花」尘落前置 1：尘落 0 → 未就绪
    const { root } = mount(g);
    expect(barOf(root, 'A').classList.contains('tactic-bar--normal')).toBe(true);
    g.dustfall = 1;
    const { root: r2 } = mount(g);
    expect(barOf(r2, 'A').classList.contains('tactic-bar--active')).toBe(true);
    expect(barOf(r2, 'A').querySelector('.tactic-bar-state')).toBeNull(); // 只变绿，不再有药丸
  });

  it('T04「末路」：第三列神器充能满 → 绿；未充能 → 普通', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['001', '002', '003'],
      heroB: ['001', '002', '003'],
      tacticA: 'T04',
      tacticB: 'T03',
    });
    const c3 = g.players.A.artifacts.find((a) => a.column === 3)!;
    const { root } = mount(g);
    expect(barOf(root, 'A').classList.contains('tactic-bar--normal')).toBe(true);
    c3.chargeLayer = c3.chargeReq ?? 0;
    c3.activeMarkerSide = 'left';
    const { root: r2 } = mount(g);
    expect(barOf(r2, 'A').classList.contains('tactic-bar--active')).toBe(true);
  });

  it('T04「末路」+ 没有怜悯（024 未充能）→ 绿', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      legendA: 'L08',
      heroA: ['022', '023', '024'],
      heroB: ['001', '002', '003'],
      tacticA: 'T04',
      tacticB: 'T03',
    });
    expect(g.players.A.artifacts.find((a) => a.id === '024')!.chargeLayer).toBe(0);
    g.dustfall = 4; // 没有怜悯：尘落≥4 → 024 必杀无需充能即就绪
    const { root } = mount(g);
    expect(barOf(root, 'A').classList.contains('tactic-bar--active')).toBe(true);
  });

  it('T07「保守」：未触发＝绿（待命）；已触发（整局 1 次用尽）→ 灰', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T07', tacticB: 'T03' });
    const { root } = mount(g);
    expect(barOf(root, 'A').classList.contains('tactic-bar--active')).toBe(true);
    expect(barOf(root, 'A').querySelector('.tactic-bar-state')).toBeNull(); // 只变绿，不再有药丸
    g.players.A.tacticOnceUsed = true;
    const { root: root2 } = mount(g);
    expect(barOf(root2, 'A').classList.contains('tactic-bar--spent')).toBe(true);
  });

  it('T08「无情」：任一方生命 ≤20 → 绿；否则普通', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T08', tacticB: 'T03' });
    g.players.A.life = 50;
    g.players.B.life = 50;
    const { root } = mount(g);
    expect(barOf(root, 'A').classList.contains('tactic-bar--normal')).toBe(true);
    g.players.B.life = 20;
    const { root: root2 } = mount(g);
    expect(barOf(root2, 'A').classList.contains('tactic-bar--active')).toBe(true);
  });

  it('T09「慈悲」：未用 → 绿；用后（整局 1 次）→ 灰', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T09', tacticB: 'T03' });
    const { root } = mount(g);
    expect(barOf(root, 'A').classList.contains('tactic-bar--active')).toBe(true);
    g.players.A.tacticOnceUsed = true;
    const { root: root2 } = mount(g);
    expect(barOf(root2, 'A').classList.contains('tactic-bar--spent')).toBe(true);
  });

  it('T10「迂回」：未用 → 绿；用后 → 灰', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T10', tacticB: 'T03' });
    const { root } = mount(g);
    expect(barOf(root, 'A').classList.contains('tactic-bar--active')).toBe(true);
    g.players.A.tacticOnceUsed = true;
    const { root: root2 } = mount(g);
    expect(barOf(root2, 'A').classList.contains('tactic-bar--spent')).toBe(true);
  });

  it('T14「赴火」：未触发 → 绿（待命）；触发后 → 灰', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T14', tacticB: 'T03' });
    const { root } = mount(g);
    expect(barOf(root, 'A').classList.contains('tactic-bar--active')).toBe(true);
    g.players.A.tacticOnceUsed = true;
    const { root: root2 } = mount(g);
    expect(barOf(root2, 'A').classList.contains('tactic-bar--spent')).toBe(true);
  });

  it('T15「影子」：未用 → 绿；用后 → 灰；存放骰显示在标题之后', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T15', tacticB: 'T04' });
    const { root } = mount(g);
    expect(barOf(root, 'A').classList.contains('tactic-bar--active')).toBe(true);
    g.players.A.tacticHeldDie = { id: 'h', value: 5 };
    const { root: root2 } = mount(g);
    const hd = barOf(root2, 'A').querySelector('.tactic-held-die')!;
    expect(hd.textContent).toBe('5');
    // 顺序：名字 → 「战术｜」→ 存放骰
    expect(hd.previousElementSibling!.classList.contains('tactic-bar-kind')).toBe(true);
    expect(hd.previousElementSibling!.previousElementSibling!.classList.contains('tactic-bar-name')).toBe(true);
    g.players.A.tacticOnceUsed = true;
    const { root: root3 } = mount(g);
    expect(barOf(root3, 'A').classList.contains('tactic-bar--spent')).toBe(true);
  });

  it('T11「迷烟」/ T12「激进」：首回合内 → 绿；首回合后 → 灰', () => {
    for (const t of ['T11', 'T12']) {
      const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: t, tacticB: 'T04' });
      const { root } = mount(g);
      expect(barOf(root, 'A').classList.contains('tactic-bar--active')).toBe(true);
      g.firstRound.A = false; // 首个回合已结束
      const { root: root2 } = mount(g);
      expect(barOf(root2, 'A').classList.contains('tactic-bar--spent')).toBe(true);
    }
  });

  it('T16「潜伏」（全局）：当前回合第 1 / 第 2 回合 → 绿；其它 → 普通', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T16', tacticB: 'T04' });
    const { root } = mount(g); // 首回合 → 绿
    expect(barOf(root, 'A').classList.contains('tactic-bar--active')).toBe(true);
    g.firstRound.A = false;
    g.players.A.turnsTaken = 2; // 第二个回合 → 绿
    const { root: root2 } = mount(g);
    expect(barOf(root2, 'A').classList.contains('tactic-bar--active')).toBe(true);
    g.players.A.turnsTaken = 3; // 第三个回合 → 普通
    const { root: root3 } = mount(g);
    expect(barOf(root3, 'A').classList.contains('tactic-bar--normal')).toBe(true);
  });

  it('T17「诱敌」：未用 → 绿；用后 → 灰', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T17', tacticB: 'T04' });
    const { root } = mount(g);
    expect(barOf(root, 'A').classList.contains('tactic-bar--active')).toBe(true);
    g.players.A.tacticOnceUsed = true;
    const { root: root2 } = mount(g);
    expect(barOf(root2, 'A').classList.contains('tactic-bar--spent')).toBe(true);
  });

  it('T18「适应」：未用 → 绿；用后 → 灰', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T18', tacticB: 'T04' });
    const { root } = mount(g);
    expect(barOf(root, 'A').classList.contains('tactic-bar--active')).toBe(true);
    g.players.A.tacticOnceUsed = true;
    const { root: root2 } = mount(g);
    expect(barOf(root2, 'A').classList.contains('tactic-bar--spent')).toBe(true);
  });
});

describe('T10「迂回」放置面板（快速操作栏内嵌·单行）', () => {
  it('2 组区域按钮；选满后确认 → 派发 yuhuiPlace', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T10', tacticB: 'T04' });
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    g.pending = { kind: 'yuhuiPlace', player: 'A' };
    const { root, acts } = mount(g);
    expect(root.querySelector('.tactic-choose-overlay')).toBeNull(); // 不再用全屏弹窗
    expect(root.querySelector('.actionzone .yuhui-panel')).not.toBeNull();
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.yuhui-panel .option-row'));
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelectorAll('.option-btn')).toHaveLength(3);
    const confirm = root.querySelector<HTMLButtonElement>('.yuhui-panel .btn-confirm')!;
    expect(confirm.disabled).toBe(true);
    rows[0].querySelectorAll<HTMLButtonElement>('.option-btn')[0].click(); // 攻
    rows[1].querySelectorAll<HTMLButtonElement>('.option-btn')[2].click(); // 冥
    expect(confirm.disabled).toBe(false);
    confirm.click();
    expect(acts).toContainEqual({ t: 'yuhuiPlace', areas: ['attack', 'meditation'] });
  });
});

describe('T09「慈悲」按钮 / T12「激进」提醒', () => {
  it('T09：触发时给出「发动/不发动」按钮（此前缺失）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T09', tacticB: 'T04' });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.pending = { kind: 'ciBei', player: 'A', target: 'B', amount: 3 };
    const { root, acts } = mount(g);
    const labels = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).map(
      (b) => b.textContent,
    );
    expect(labels).toContain('发动「慈悲」（取消 3 点伤害，改为回复 3 点生命）');
    expect(labels).toContain('不发动「慈悲」');
    Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button'))
      .find((b) => b.textContent!.startsWith('发动「慈悲」'))!
      .click();
    expect(acts).toContainEqual({ t: 'ciBei', accept: true });
  });

  it('T12：尘起阶段提示含「激进」额外充能', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T12', tacticB: 'T04' });
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    const { root } = mount(g);
    const hint = root.querySelector('.hint-phase')!.textContent!;
    expect(hint).toContain('「激进」');
    expect(hint).toContain('额外充能');
  });
});

describe('战术牌详情浮窗：技能描述含"±生命值"（tacticDisplayText）', () => {
  const openA = (g: GameState): string => {
    const { root } = mount(g);
    const nameBtn = root.querySelector<HTMLElement>('.player[data-player="A"] .tactic-bar-name')!;
    nameBtn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    const pop = root.querySelector('.detail-popover--tactic')!;
    return pop.querySelector('.detail-tactic-eff')!.textContent!;
  };

  it('T03「顽强」（effectText 为空）：显示「提高你的初始生命6点」，不是"待转写"', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T03', tacticB: 'T04' });
    const txt = openA(g);
    expect(txt).toContain('提高你的初始生命6点');
    expect(txt).not.toContain('待转写');
  });

  it('T01「谨慎」：结尾含「提高你的初始生命2点。」', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T01', tacticB: 'T04' });
    expect(openA(g)).toContain('提高你的初始生命2点。');
  });
});

describe('T15「影子」选点数面板', () => {
  it('6 个点数按钮；选后确认 → 派发 yingziPick', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T15', tacticB: 'T04' });
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    g.pending = { kind: 'yingziPick', player: 'A' };
    const { root, acts } = mount(g);
    const nums = Array.from(root.querySelectorAll<HTMLButtonElement>('.yingzi-panel .number-btn'));
    expect(nums).toHaveLength(6);
    const confirm = root.querySelector<HTMLButtonElement>('.yingzi-panel .btn-confirm')!;
    expect(confirm.disabled).toBe(true);
    nums[4].click(); // 5
    expect(confirm.disabled).toBe(false);
    confirm.click();
    expect(acts).toContainEqual({ t: 'yingziPick', value: 5 });
  });
});

describe('T17「诱敌」选择面板', () => {
  it('选来源区域 → 选骰（≤3）→ 选目标区域 → 派发 youdiMove', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T17', tacticB: 'T04' });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.areas.attack = [{ id: 'x', value: 3, kind: 'attack' }];
    g.players.A.areas.defense = [];
    g.pending = { kind: 'youdiMove', player: 'A' };
    const { root, acts } = mount(g);
    const panel = root.querySelector<HTMLElement>('.youdi-panel')!;
    const rows = panel.querySelectorAll<HTMLElement>('.option-row');
    rows[0].querySelectorAll<HTMLButtonElement>('.option-btn')[0].click(); // 从＝攻
    panel.querySelector<HTMLElement>('.youdi-dice .pay-die')!.click(); // 选 1 颗
    rows[1].querySelectorAll<HTMLButtonElement>('.option-btn')[1].click(); // 到＝防
    const confirm = panel.querySelector<HTMLButtonElement>('.btn-confirm')!;
    expect(confirm.disabled).toBe(false);
    confirm.click();
    expect(acts).toContainEqual({ t: 'youdiMove', from: 'attack', to: 'defense', dieIds: ['x'] });
  });
});

describe('T18「适应」选择面板', () => {
  it('选 1 颗骰 + 选点数 → 派发 shipeiPick', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T18', tacticB: 'T04' });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.areas.attack = [{ id: 'x', value: 3, kind: 'attack' }];
    g.pending = { kind: 'shipeiPick', player: 'A', dieIds: ['x'], replaceByDist: false };
    const { root, acts } = mount(g);
    const panel = root.querySelector<HTMLElement>('.shipei-panel')!;
    panel.querySelector<HTMLElement>('.shipei-dice .pay-die')!.click(); // 选骰
    panel.querySelectorAll<HTMLButtonElement>('.number-btn')[5].click(); // 6 点
    const confirm = panel.querySelector<HTMLButtonElement>('.btn-confirm')!;
    expect(confirm.disabled).toBe(false);
    confirm.click();
    expect(acts).toContainEqual({ t: 'shipeiPick', dieId: 'x', value: 6 });
  });
});

describe('T13「远见」', () => {
  it('战前弹窗：玩家A/B 两个猜测选项；点击派发 tacticGuess', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T13', tacticB: 'T04' });
    expect(g.pending?.kind).toBe('tacticGuess');
    const { root, acts } = mount(g);
    const cards = Array.from(root.querySelectorAll<HTMLButtonElement>('.tactic-first-card'));
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.dataset.who)).toEqual(['A', 'B']);
    expect(root.querySelector('.tactic-choose-title')!.textContent).toContain('「远见」');
    cards[1].click();
    expect(acts).toEqual([{ t: 'tacticGuess', who: 'B' }]);
  });

  it('横条：猜测持久显示「猜玩家X」，位于标题之后、效果文本之前', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T13', tacticB: 'T04' });
    applyAction(g, { t: 'tacticGuess', who: 'B' });
    const { root } = mount(g, true);
    const gd = root.querySelector('.tactic-guess')!;
    expect(gd).not.toBeNull();
    expect(gd.textContent).toBe('猜玩家B');
    const bar = gd.closest('.tactic-bar')!;
    const name = bar.querySelector('.tactic-bar-name')!;
    const eff = bar.querySelector('.tactic-bar-eff')!;
    expect(name.compareDocumentPosition(gd) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(gd.compareDocumentPosition(eff) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('奖励面板：选点数 + 选区域 → 确认派发 yuanjianGain', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T13', tacticB: 'T04' });
    applyAction(g, { t: 'tacticGuess', who: 'B' });
    g.pending = { kind: 'yuanjianGain', player: 'A' };
    const { root, acts } = mount(g);
    const panel = root.querySelector<HTMLElement>('.yuanjian-panel')!;
    expect(panel).not.toBeNull();
    expect(panel.querySelectorAll('.number-btn')).toHaveLength(6);
    expect(panel.querySelectorAll('.option-btn')).toHaveLength(3);
    const confirm = panel.querySelector<HTMLButtonElement>('.btn-confirm')!;
    expect(confirm.disabled).toBe(true);
    panel.querySelectorAll<HTMLButtonElement>('.number-btn')[3].click(); // 4 点
    panel.querySelectorAll<HTMLButtonElement>('.option-btn')[2].click(); // 冥
    expect(confirm.disabled).toBe(false);
    confirm.click();
    expect(acts).toEqual([{ t: 'yuanjianGain', value: 4, area: 'meditation' }]);
  });
});
