import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupGame } from '../src/core/engine/setup';
import { createGame, applyAction, skipInitialReroll, beginTurn } from '../src/core/engine/game';
import { effectiveWill } from '../src/core/engine/derive';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import { dealTrueDamage } from '../src/core/engine/combat';
import type { Action, GameState } from '../src/core/model/types';

const freshUi = (prefs?: Partial<UiState['prefs']>): UiState => ({
  rerollSelected: new Set(),
  selection: null,
  pendingConfirm: null,
  convertPick: null,
  fengmangPick: null,
  hanguangPick: null,
  quanzhi: null,
  dustFlow: null,
  prefs: { showSkillText: false, cardArt: 'thumb', density: 'compact', mirrorEnemy: false, preset: 'desktop', logCollapsed: false, zoomMode: 'off', zoomPercent: 90, ...prefs },
  settingsOpen: false,
  logOpen: false,
  logPop: false,
  detail: null,
  error: null,
});

const hooksFor = (
  onAction: (a: Action) => void = () => {},
  prefs?: Partial<UiState['prefs']>,
): RenderHooks => {
  const ui = freshUi(prefs);
  return {
    onAction,
    ui,
    propose: (action, label) => { ui.pendingConfirm = { action, label }; },
    requestRender: () => {},
    onRestart: () => {},
  };
};

/** 带重绘的挂载：propose 会写入 pendingConfirm 并重绘，模拟 main.ts */
const mount = (state: GameState, root: HTMLElement, onAction: (a: Action) => void = vi.fn()) => {
  const ui = freshUi();
  const hooks: RenderHooks = {
    onAction,
    ui,
    propose: (action, label) => { ui.pendingConfirm = { action, label }; renderGame(state, root, hooks); },
    requestRender: () => renderGame(state, root, hooks),
    onRestart: () => {},
  };
  renderGame(state, root, hooks);
  return { ui, hooks, onAction };
};

describe('renderGame (read-only snapshot)', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
  });

  it('renders all six artifact names', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    const text = root.textContent ?? '';
    for (const name of ['雨切', '游龙', '明镜', '不祥', '影掠', '完杀']) {
      expect(text).toContain(name);
    }
  });

  it('stacks enemy above self', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    const panels = root.querySelectorAll('.player');
    expect(panels.length).toBe(2);
    expect(panels[0].classList.contains('player--enemy')).toBe(true);
    expect(panels[1].classList.contains('player--self')).toBe(true);
  });

  it('mirrors the enemy area order (reverse of the self order)', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    const enemyAreas = root.querySelectorAll<HTMLElement>('.player--enemy .area');
    const selfAreas = root.querySelectorAll<HTMLElement>('.player--self .area');
    expect(Array.from(enemyAreas).map((e) => e.dataset.kind)).toEqual([
      'meditation',
      'attack',
      'defense',
    ]);
    expect(Array.from(selfAreas).map((e) => e.dataset.kind)).toEqual([
      'defense',
      'attack',
      'meditation',
    ]);
  });

  it('puts self dice areas above the artifact cards；不再显示「玩家A/B」归属标签', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    const self = root.querySelector('.player--self')!;
    // 归属标签已移除：面板首个元素直接是骰区，且全文档不再存在 panel-tag
    expect(root.querySelector('.panel-tag')).toBeNull();
    expect(self.firstElementChild!.classList.contains('areas')).toBe(true);
    const order = Array.from(self.children);
    expect(order.indexOf(self.querySelector('.areas')!)).toBeLessThan(
      order.indexOf(self.querySelector('.cards')!),
    );
  });

  it('renders dice in three areas per player', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    expect(root.querySelectorAll('.area').length).toBe(6);
    expect(root.querySelectorAll('.die').length).toBe(15); // A will 7 + B will 8
  });

  it('shows skill text so skills can be read/switched', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    const text = root.textContent ?? '';
    for (const s of [
      '中央突破', '裁雨流', '龙游万象', '龙腾万丈', '斩神切',
      '淬炼', '锋芒', '影袭', '潜行', '零时枭首',
    ]) {
      expect(text).toContain(s);
    }
    expect(root.querySelectorAll('.card').length).toBe(6);
  });

  it('shows dust seal on the second player', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    // 后手 B 显示在敌人位（自己=A）
    expect(root.querySelectorAll('.player--enemy .badge-seal').length).toBe(1);
    expect(root.querySelectorAll('.player--self .badge-seal').length).toBe(0);
    expect(root.querySelector('.badge-seal')?.textContent).toContain('尘印');
  });

  it('marks the activated skill side differently from the inactive one', () => {
    const state = setupGame({ seed: 1, firstPlayer: 'A' });
    const yuqie = state.players.A.artifacts.find((a) => a.id === '001')!;
    yuqie.activeMarkerSide = 'left';
    renderGame(state, root, hooksFor());
    const card = root.querySelector('.player--self .card[data-artifact="001"]')!;
    expect(card.querySelectorAll('.skill-part--on').length).toBe(1);
    expect(card.querySelectorAll('.skill-part--off').length).toBe(1);
  });

  it('renders one .skill box per shared skill name with one part per entry (009 高塔铁幕)', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['009', '002', '003'] });
    state.players.A.artifacts.find((a) => a.id === '009')!.activeMarkerSide = 'left';
    renderGame(state, root, hooksFor());
    const card = root.querySelector('.player--self .card[data-artifact="009"]')!;
    const boxes = Array.from(card.querySelectorAll('.skill')).filter(
      (b) => b.querySelector('.skill-name')?.textContent === '高塔铁幕',
    );
    expect(boxes.length).toBe(1);
    expect(boxes[0].querySelectorAll('.skill-part').length).toBe(3);
    // 009 全为 only 侧 → 隐藏描述时归入「一行居中」容器
    expect(card.querySelector('.skills--inline--only')).not.toBeNull();
  });

  it('隐藏描述：左右技能分两列（左列=左侧、右列=右侧），011 顺序正确', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['010', '011', '012'] });
    renderGame(state, root, hooksFor());
    const card = root.querySelector('.player--self .card[data-artifact="011"]')!;
    const left = card.querySelector('.skill--left')!;
    const right = card.querySelector('.skill--right')!;
    const names = (el: Element): string[] =>
      Array.from(el.querySelectorAll<HTMLElement>('.skill-part')).map(
        (p) =>
          `${p.querySelector('.skill-type')?.textContent ?? ''}${p.querySelector('.skill-name')?.textContent ?? ''}`,
      );
    expect(names(left)).toEqual(['启动灵能屏障', '触发灵能屏障']);
    expect(names(right)).toEqual(['启动灵能脉冲', '触发灵能脉冲']);
    expect(card.querySelector('.skills--inline--only')).toBeNull();
  });

  it('renders the 006 零时枭首 ultimate as a clickable part when active', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['006', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    const wansha = state.players.A.artifacts.find((a) => a.id === '006')!;
    wansha.activeMarkerSide = 'left';
    state.players.A.areas.attack.push({ id: 'wansha-atk', value: 2, kind: 'attack' });
    renderGame(state, root, hooksFor());
    const card = root.querySelector('.player--self .card[data-artifact="006"]')!;
    const parts = Array.from(card.querySelectorAll<HTMLElement>('.skill-part'));
    const ultimate = parts.find((p) => p.querySelector('.skill-type')?.textContent === '必杀');
    expect(ultimate).toBeTruthy();
    expect(ultimate!.dataset.side).toBe('only');
    expect(ultimate!.classList.contains('clickable')).toBe(true);
  });

  it('shows the dustfall counter in the center band and the log in the left sidebar', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    const band = root.querySelector('.centerband');
    expect(band).not.toBeNull();
    expect(band!.querySelector('.hint-dust')?.textContent).toContain('尘落');
    expect(root.querySelector('.sidebar .log')).not.toBeNull();
  });

  it('renders weapon type in the artifact card title', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    expect(root.textContent ?? '').toContain('雨切（武士刀）');
  });

  it('shows each player life as a progress bar inside their own panel, colored by player', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    // 中段不再有合并生命栏；但保留原占地的右槽（现放「设置」）
    expect(root.querySelector('.vitals')).toBeNull();
    expect(root.querySelector('.centerband-right')).not.toBeNull();
    expect(root.querySelector('.centerband-right .btn-settings')).not.toBeNull();
    // 每个面板各一条生命条，显示本方生命
    expect(root.querySelectorAll('.lifeline')).toHaveLength(2);
    const self = root.querySelector('.player--self .lifeline')!;
    const enemy = root.querySelector('.player--enemy .lifeline')!;
    expect(self.querySelector('.lifeline-hp')!.textContent).toMatch(/^生命 \d+\/\d+$/);
    expect(enemy.querySelector('.lifeline-hp')!.textContent).toMatch(/^生命 \d+\/\d+$/);
    // 进度条按玩家配色
    expect(self.querySelector('.lifeline-fill')!.classList.contains('bg-A')).toBe(true);
    expect(enemy.querySelector('.lifeline-fill')!.classList.contains('bg-B')).toBe(true);
    // 玩家头部/归属标签仍不存在
    expect(root.querySelector('.player-life')).toBeNull();
    expect(root.querySelector('.player-header')).toBeNull();
  });

  it('places the tactic bar under the 1st artifact and the life bar under the 3rd (band)', () => {
    const state = setupGame({ seed: 1, firstPlayer: 'A' });
    state.players.A.tactic = 'T02';
    state.players.B.tactic = 'T02';
    renderGame(state, root, hooksFor());
    for (const role of ['self', 'enemy'] as const) {
      const band = root.querySelector(`.player--${role} .playband`)!;
      expect(band).not.toBeNull();
      const bar = band.querySelector<HTMLElement>(':scope > .tactic-bar')!;
      const life = band.querySelector<HTMLElement>(':scope > .lifeline')!;
      expect(bar).not.toBeNull();
      expect(life).not.toBeNull();
      // 网格列：战术条＝前 2 列（2 个神器宽），生命条＝第 3 列（镜像关闭时）
      expect(bar.style.gridColumn).toBe('1 / span 2');
      expect(life.style.gridColumn).toBe('3');
    }
  });

  it('shows the life bonus as a player-colored pill on the 3rd-column artifact title', () => {
    const state = setupGame({ seed: 1, firstPlayer: 'A' });
    state.players.A.lifeMax = 56; // 生命 50 + 6
    renderGame(state, root, hooksFor());
    const c3 = Array.from(root.querySelectorAll<HTMLElement>('.player--self .card')).find((c) =>
      c.textContent?.includes('第3列'),
    );
    expect(c3).not.toBeUndefined();
    const pill = c3!.querySelector('.card-sub .sub-delta.player-A');
    expect(pill).not.toBeNull();
    expect(pill!.textContent).toBe('+6');
  });

  it('highlights the pending skill name in the hint with the acting player color', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '009'] });
    skipInitialReroll(state);
    const gw = state.players.A.artifacts.find((a) => a.id === '009')!;
    gw.activeMarkerSide = 'left';
    state.players.A.areas.defense = [{ id: 'gd1', value: 4, kind: 'defense' }];
    dealTrueDamage(state, 'A', 6, 'B');
    renderGame(state, root, hooksFor());
    const hi = root.querySelector('.hint-phase .hint-skill')!;
    expect(hi.textContent).toBe('高塔铁幕');
    expect(hi.classList.contains('player-A')).toBe(true);
  });

  it('moves 尘印标记 into the meditation area (display only) and drops the header badge', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    state.players.A.hasDustSeal = true;
    renderGame(state, root, hooksFor());
    const seal = root.querySelector<HTMLElement>(
      '.player--self .area[data-kind="meditation"] .area-seal',
    )!;
    expect(seal.textContent).toBe('尘印标记');
    expect(seal.tagName).toBe('SPAN');
    // 冥想骰区内的最右元素（右对齐）
    const area = root.querySelector('.player--self .area[data-kind="meditation"]')!;
    expect(area.lastElementChild).toBe(seal);
    expect(root.querySelector('.player-header')).toBeNull();
  });

  it('lays out skill rows horizontally when descriptions are hidden', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    renderGame(state, root, hooksFor());
    expect(root.querySelector('.skills--inline')).not.toBeNull();
    renderGame(state, root, hooksFor(() => {}, { showSkillText: true }));
    expect(root.querySelector('.skills--inline')).toBeNull();
  });

  it('removes the 战报 title and the 重开 button (settings stays)', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    expect(root.querySelector('.log-title')).toBeNull();
    expect(root.querySelector('.btn-restart')).toBeNull();
    expect(root.querySelector('.btn-settings')).not.toBeNull();
  });

  it('tags each panel with its player id so the accent line follows the player color', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    const tag = (sel: string) => root.querySelector<HTMLElement>(sel)!.dataset.player;

    renderGame(state, root, hooksFor());
    expect(tag('.player--self')).toBe('A');
    expect(tag('.player--enemy')).toBe('B');

    // 回合切换后：上下两块交换角色，玩家 id 也随之更新（CSS 由此决定线条颜色）
    state.activePlayer = 'B';
    renderGame(state, root, hooksFor());
    expect(tag('.player--self')).toBe('B');
    expect(tag('.player--enemy')).toBe('A');
  });

  it('collapses the log into a left-edge tab drawer when 战报栏 = 收起', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    const ui = freshUi({ logCollapsed: true });
    let hooks: RenderHooks;
    hooks = {
      ui,
      onAction: () => {},
      propose: () => {},
      requestRender: () => renderGame(state, root, hooks),
      onRestart: () => {},
    };
    renderGame(state, root, hooks);

    expect(root.querySelector('.app')!.classList.contains('log-collapsed')).toBe(true);
    // 左上角不再有「设置/战报」按钮组；改为左中贴边拉手
    expect(root.querySelector('.edge-bar')).toBeNull();
    expect(root.querySelector('.log-tab')).not.toBeNull();
    // 设置入口仍在中段右槽
    expect(root.querySelector('.centerband-right .btn-settings')).not.toBeNull();
    expect(root.querySelector('.log-drawer')).toBeNull();

    // 点贴边拉手 → 打开战报抽屉
    root.querySelector<HTMLButtonElement>('.log-tab[data-act="logOpen"]')!.click();
    expect(ui.logOpen).toBe(true);
    expect(root.querySelector('.log-drawer .log')).not.toBeNull();

    // 抽屉里也有「设置」入口，且会先关抽屉（否则被遮罩挡住）
    root.querySelector<HTMLButtonElement>('[data-act="drawerSettingsOpen"]')!.click();
    expect(ui.logOpen).toBe(false);
    expect(ui.settingsOpen).toBe(true);
    root.querySelector<HTMLButtonElement>('.settings-close')!.click();

    // 重新打开抽屉后，点空白处关闭
    root.querySelector<HTMLButtonElement>('.log-tab[data-act="logOpen"]')!.click();
    root.querySelector<HTMLElement>('.log-overlay')!.click();
    expect(ui.logOpen).toBe(false);
    expect(root.querySelector('.log-drawer')).toBeNull();
  });

  it('传奇模式：设置里「战报栏」置灰禁用（非传奇可用）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L01', legendB: 'L02' });
    const { ui, hooks } = mount(g, root);
    ui.settingsOpen = true;
    renderGame(g, root, hooks);
    const row = Array.from(root.querySelectorAll('.settings-row')).find(
      (r) => r.querySelector('.settings-label')?.textContent === '战报栏',
    )!;
    const btns = Array.from(row.querySelectorAll<HTMLButtonElement>('.settings-opt'));
    expect(btns).toHaveLength(2);
    expect(btns.every((b) => b.disabled)).toBe(true);
  });

  it('applies preset combos and switches to 自定义 when a single item is changed', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    const ui = freshUi();
    let hooks: RenderHooks;
    hooks = {
      ui,
      onAction: () => {},
      propose: () => {},
      requestRender: () => renderGame(state, root, hooks),
      onRestart: () => {},
    };
    renderGame(state, root, hooks);
    root.querySelector<HTMLButtonElement>('.btn-settings')!.click();

    const rowBtn = (label: string, text: string) => {
      const row = Array.from(root.querySelectorAll<HTMLElement>('.settings-row')).find(
        (r) => r.querySelector('.settings-label')!.textContent === label,
      )!;
      return Array.from(row.querySelectorAll<HTMLButtonElement>('.settings-opt')).find(
        (b) => b.textContent === text,
      )!;
    };

    // 触屏模式：舒适密度 + 战报收起 + 缩略卡图 + 技能隐藏
    rowBtn('预设组合', '触屏模式').click();
    expect(ui.prefs.preset).toBe('touch');
    expect(ui.prefs.density).toBe('comfortable');
    expect(ui.prefs.logCollapsed).toBe(true);
    expect(ui.prefs.cardArt).toBe('thumb');
    expect(ui.prefs.showSkillText).toBe(false);
    expect(root.querySelectorAll('.card-art--thumb').length).toBeGreaterThan(0);
    // 卡片头部同样可打开技能详情
    expect(root.querySelector('.card .card-head.detail-trigger')).not.toBeNull();

    // 手动改单项 → 自定义
    rowBtn('卡图', '完整').click();
    expect(ui.prefs.preset).toBe('custom');

    // 电脑模式：紧凑密度 + 战报显示 + 完整卡图 + 技能显示
    rowBtn('预设组合', '电脑模式').click();
    expect(ui.prefs.preset).toBe('desktop');
    expect(ui.prefs.density).toBe('compact');
    expect(ui.prefs.logCollapsed).toBe(false);
    expect(ui.prefs.cardArt).toBe('full');
    expect(ui.prefs.showSkillText).toBe(true);
    expect(root.querySelectorAll('.skill-text').length).toBeGreaterThan(0);
  });

  it('applies the 整屏缩放 setting (off / auto / manual with percent)', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    const ui = freshUi();
    let hooks: RenderHooks;
    hooks = {
      ui,
      onAction: () => {},
      propose: () => {},
      requestRender: () => renderGame(state, root, hooks),
      onRestart: () => {},
    };
    renderGame(state, root, hooks);
    expect(root.querySelector('.stage')).not.toBeNull();
    expect(root.querySelector<HTMLElement>('.stage')!.style.transform).toBe('');

    root.querySelector<HTMLButtonElement>('.btn-settings')!.click();
    const rowBtn = (label: string, text: string) => {
      const row = Array.from(root.querySelectorAll<HTMLElement>('.settings-row')).find(
        (r) => r.querySelector('.settings-label')!.textContent === label,
      )!;
      return Array.from(row.querySelectorAll<HTMLButtonElement>('.settings-opt')).find(
        (b) => b.textContent === text,
      )!;
    };

    rowBtn('整屏缩放', '手动').click();
    expect(ui.prefs.zoomMode).toBe('manual');
    expect(root.querySelector<HTMLElement>('.stage')!.style.transform).toBe('scale(0.9)');

    rowBtn('缩放比例 90%', '缩小').click();
    expect(ui.prefs.zoomPercent).toBe(85);
    expect(root.querySelector<HTMLElement>('.stage')!.style.transform).toBe('scale(0.85)');

    rowBtn('整屏缩放', '关').click();
    expect(ui.prefs.zoomMode).toBe('off');
    expect(root.querySelector<HTMLElement>('.stage')!.style.transform).toBe('');
  });

  it('uses the bottom-sheet form of the detail popover on narrow screens', () => {
    const prev = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 600, configurable: true, writable: true });
    try {
      const state = createGame({ seed: 1, firstPlayer: 'A' });
      const { ui } = mount(state, root);
      root
        .querySelector<HTMLElement>('.player--self .card[data-artifact="001"] .card-art')!
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      expect(ui.detail).not.toBeNull();
      const pop = root.querySelector<HTMLElement>('.detail-popover')!;
      expect(pop.classList.contains('detail-popover--sheet')).toBe(true);
      // 窄屏下不写死内联定位（交由 CSS 底部抽屉定位）
      expect(pop.style.left).toBe('');
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: prev, configurable: true, writable: true });
    }
  });

  it('marks a used 「激活」 skill as spent (gray bg + green left border, gray badge)', () => {
    const state = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['013', '014', '015'],
      heroB: ['001', '002', '003'],
    });
    skipInitialReroll(state);
    // 尘起阶段装填 014 左侧 →「激活」类立即强制结算（弹出待决策）
    const med = { id: 'med-act', value: 4, kind: 'meditation' as const };
    state.players.A.areas.meditation.push(med);
    applyAction(state, { t: 'dustRise', artifactId: '014', side: 'left', costSlots: [{ dieIds: [med.id] }] });
    expect(state.pending?.kind).toBe('activationResolve');

    renderGame(state, root, hooksFor());
    const partSel = '.player--self .card[data-artifact="014"] .skill-part[data-key="chengjie.jinghua"]';
    // 正在结算：显示为可用（绿色）
    expect(root.querySelector(partSel)!.classList.contains('skill-part--on')).toBe(true);

    // 解算「净化」（不选任何骰）
    applyAction(state, { t: 'skill', artifactId: '014', side: 'left', params: { targetDieIds: [] } });
    renderGame(state, root, hooksFor());
    const spent = root.querySelector<HTMLElement>(partSel)!;
    expect(spent.classList.contains('skill-part--spent')).toBe(true);
    expect(spent.classList.contains('skill-part--on')).toBe(false);
    expect(
      root.querySelector('.player--self .card[data-artifact="014"] .badge-active')!.classList.contains('badge-active--spent'),
    ).toBe(true);
  });

  it('013 电刑/雷暴 ask: 发动 opens the chooser, one pick-set dispatches directly on 确认', () => {
    const state = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['013', '014', '015'],
      heroB: ['001', '002', '003'],
    });
    skipInitialReroll(state);
    state.players.A.areas.meditation.push({ id: 'm1', value: 4, kind: 'meditation' });
    state.players.A.areas.meditation.push({ id: 'm2', value: 6, kind: 'meditation' });

    state.pending = { kind: 'dianxing', player: 'A' };
    const { ui, onAction } = mount(state, root);
    const labels = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).map(
      (b) => b.textContent,
    );
    // 精确断言（含数量）：这类列表只允许一个渲染来源，重复按钮必须让测试失败
    expect(labels.filter((l) => (l ?? '').includes('电刑'))).toEqual([
      '发动「电刑」（选择 2 颗冥想骰）',
      '不发动「电刑」',
    ]);
    expect(root.querySelector('.hint-phase')!.textContent).toContain('电刑');

    // 点「发动」→ 打开选骰面板（一次列全部可选骰，不再逐颗询问）
    const open = root.querySelector<HTMLButtonElement>('.actionlist [data-act="dianxingOpen"]')!;
    open.click();
    expect(ui.selection?.pendingKind).toBe('dianxing');
    expect(root.querySelector('.selector')).not.toBeNull();

    root.querySelector<HTMLElement>('.player--self .die[data-id="m1"]')!.click();
    root.querySelector<HTMLElement>('.player--self .die[data-id="m2"]')!.click();
    const ok = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
      (b) => b.textContent === '确认',
    )!;
    expect(ok.disabled).toBe(false);
    ok.click();
    // 询问本身即确认：直接派发，不再经过确认条
    expect(onAction).toHaveBeenCalledWith({ t: 'dianxing', dieIds: ['m1', 'm2'] });
    expect(ui.selection).toBeNull();

    state.pending = { kind: 'leibao', player: 'A' };
    renderGame(state, root, hooksFor());
    const labels2 = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).map(
      (b) => b.textContent,
    );
    expect(labels2.filter((l) => (l ?? '').includes('雷暴'))).toEqual([
      '发动「雷暴」（选择要移动的冥想骰）',
      '不发动「雷暴」',
    ]);
    expect(root.querySelector('.hint-phase')!.textContent).toContain('雷暴');
  });

  it('017 帷幕 ask: 非当前玩家也能正确操作（按钮精确、选择器里是对方的能力骰）', () => {
    const state = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['016', '017', '018'],
      heroB: ['001', '002', '003'],
    });
    skipInitialReroll(state);
    // A 持帷幕、轮到的却是 B（跨回合触发的场景）
    state.activePlayer = 'B';
    state.pending = { kind: 'weimu', player: 'A' };
    const bDice = [...state.players.B.areas.attack, ...state.players.B.areas.defense, ...state.players.B.areas.meditation];
    expect(bDice.length).toBeGreaterThan(0);

    const { ui, onAction } = mount(state, root);
    const labels = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).map((b) => b.textContent);
    // 精确断言：只允许这两个（重复按钮会让测试失败）
    expect(labels.filter((l) => (l ?? '').includes('帷幕'))).toEqual([
      '不发动「帷幕」',
      '发动「帷幕」（选择弃置对方 1 个能力骰）',
    ]);
    expect(root.querySelector('.hint-phase')!.textContent).toContain('帷幕');
    expect(root.querySelector('.hint-phase')!.textContent).toContain('对方的重掷阶段结束时');
    // 待决策属于非当前玩家 → 明确标注「（强制执行）」
    expect(root.querySelector('.hint-turn')!.textContent).toContain('（强制执行）');

    const open = root.querySelector<HTMLButtonElement>('.actionlist [data-act="weimuOpen"]')!;
    open.click();
    expect(ui.selection?.pendingKind).toBe('weimu');
    // 选择器里应是「对方」（= 操作者 A 的对手 B）的能力骰
    const chips = Array.from(root.querySelectorAll<HTMLElement>('.selector [data-id]')).map((n) => n.dataset.id);
    for (const d of bDice) expect(chips).toContain(d.id);
    const target = bDice[0].id;
    root.querySelector<HTMLElement>(`.selector [data-id="${target}"]`)!.click();
    const ok = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) => b.textContent === '确认')!;
    expect(ok.disabled).toBe(false);
    ok.click();
    expect(onAction).toHaveBeenCalledWith({ t: 'weimu', accept: true, dieId: target });
  });

  it('018 漆黑绽放 ask: 必杀获得 X 骰后可重掷（非当前玩家也能选）', () => {
    const state = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['016', '017', '018'],
      heroB: ['001', '002', '003'],
    });
    skipInitialReroll(state);
    state.activePlayer = 'A';
    state.pending = { kind: 'zhihaiReroll', player: 'A', x: 3, forced: false };
    const { ui, onAction } = mount(state, root);
    const labels = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).map((b) => b.textContent);
    expect(labels.filter((l) => (l ?? '').includes('重掷'))).toEqual([
      '不重掷',
      '重掷最多 3 颗能力骰（可含刚获得的骰）',
    ]);
    expect(root.querySelector('.hint-phase')!.textContent).toContain('漆黑绽放');

    const open = root.querySelector<HTMLButtonElement>('.actionlist [data-act="zhihaiRerollOpen"]')!;
    open.click();
    expect(ui.selection?.pendingKind).toBe('zhihaiReroll');
    const own = [...state.players.A.areas.attack, ...state.players.A.areas.defense, ...state.players.A.areas.meditation];
    const pick = own.slice(0, 2).map((d) => d.id);
    for (const id of pick) root.querySelector<HTMLElement>(`.selector [data-id="${id}"]`)!.click();
    const ok = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) => b.textContent === '确认')!;
    ok.click();
    expect(onAction).toHaveBeenCalledWith({ t: 'zhihaiReroll', dieIds: pick });
  });

  it('「激活」类装填后：操作栏给出「结算（激活·立即生效）」并打开选择器', () => {
    const state = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['016', '017', '018'],
      heroB: ['001', '002', '003'],
    });
    skipInitialReroll(state);
    // 尘起装填 016 左侧 → 强制待决策
    const med = { id: 'med-v', value: 4, kind: 'meditation' as const };
    state.players.A.areas.meditation.push(med);
    applyAction(state, { t: 'dustRise', artifactId: '016', side: 'left', costSlots: [{ dieIds: [med.id] }] });
    expect(state.pending?.kind).toBe('activationResolve');

    const { ui, onAction } = mount(state, root);
    const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).find((b) =>
      (b.textContent ?? '').includes('虚无形态'),
    );
    expect(btn).toBeTruthy();
    expect(btn!.textContent).toContain('激活·立即生效');
    btn!.click();
    expect(ui.selection?.key).toBe('xuyu.void');
    expect(root.querySelector('.selector')).not.toBeNull();

    // 选择「防御」→ 确认 → 走确认条 → 确认后派发 skill 动作（参数由选择器给出）
    const opt = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) =>
      (b.textContent ?? '').includes('防御'),
    )!;
    opt.click();
    const ok = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) => b.textContent === '确认')!;
    ok.click();
    const confirm = root.querySelector<HTMLButtonElement>('.confirm-row .btn-confirm')!;
    confirm.click();
    expect(onAction).toHaveBeenCalledWith({
      t: 'skill',
      artifactId: '016',
      side: 'left',
      params: { kind: 'defense' },
    });
  });

  it('018 强制发动：提示栏标注「计数达 5·强制发动」，卡面必杀行显示绿帧「强制发动」，解算后转「已使用」', () => {
    const state = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['016', '017', '018'],
      heroB: ['001', '002', '003'],
    });
    skipInitialReroll(state);
    const card = state.players.A.artifacts.find((a) => a.id === '018')!;
    card.chargeLayer = 1;
    card.activeMarkerSide = 'left';
    card.armedSide = 'left';
    card.armedTurn = state.turnIndex;
    card.count = 5;
    state.ultimatesUsed.push('A:zhihai.bloom.ultimate');
    state.pending = { kind: 'zhihaiReroll', player: 'A', x: 5, forced: true };
    renderGame(state, root, hooksFor());
    const hint = root.querySelector('.hint-phase')!.textContent ?? '';
    expect(hint).toContain('强制发动');
    expect(hint).toContain('计数达 5');
    expect(hint).toContain('无论现在是谁的回合');
    const rowSel = '.player--self .card[data-artifact="018"] .skill-part[data-key="zhihai.bloom.ultimate"]';
    expect(root.querySelector(rowSel)!.classList.contains('skill-part--on')).toBe(true);
    expect(root.querySelector(rowSel)!.textContent).toContain('强制发动');

    applyAction(state, { t: 'zhihaiReroll', dieIds: [] });
    renderGame(state, root, hooksFor());
    expect(root.querySelector(rowSel)!.classList.contains('skill-part--disabled')).toBe(true);
    expect(root.querySelector(rowSel)!.classList.contains('skill-part--used')).toBe(true);
    expect(root.querySelector(rowSel)!.textContent).not.toContain('已使用');
    expect((root.querySelector('.hint-phase')!.textContent ?? '').includes('强制发动')).toBe(false);
  });

  it('018 主动发动：提示不含「强制发动」，卡面不显示绿帧', () => {
    const state = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['016', '017', '018'],
      heroB: ['001', '002', '003'],
    });
    skipInitialReroll(state);
    const card = state.players.A.artifacts.find((a) => a.id === '018')!;
    card.chargeLayer = 1;
    card.activeMarkerSide = 'left';
    card.count = 2;
    state.pending = { kind: 'zhihaiReroll', player: 'A', x: 2, forced: false };
    renderGame(state, root, hooksFor());
    const hint = root.querySelector('.hint-phase')!.textContent ?? '';
    expect(hint).toContain('漆黑绽放');
    expect(hint.includes('强制发动')).toBe(false);
    const rowSel = '.player--self .card[data-artifact="018"] .skill-part[data-key="zhihai.bloom.ultimate"]';
    expect((root.querySelector(rowSel)!.textContent ?? '').includes('强制发动')).toBe(false);
  });

  it('计数徽标带上限：018 → 计数 5/5、015 → 计数 4/4、004 → 计数 3/3', () => {
    const xiu = createGame({ seed: 1, firstPlayer: 'A', heroA: ['016', '017', '018'], heroB: ['001', '002', '003'] });
    xiu.players.A.artifacts.find((a) => a.id === '018')!.count = 5;
    renderGame(xiu, root, hooksFor());
    expect(root.querySelector('.card[data-artifact="018"] .badge-count')!.textContent).toBe('计数 5/5');

    // 015 的计数为 0 时不显示徽标；置 4 后应显示 /4
    const zoray = createGame({ seed: 1, firstPlayer: 'A', heroA: ['013', '014', '015'], heroB: ['001', '002', '003'] });
    zoray.players.A.artifacts.find((a) => a.id === '015')!.count = 4;
    renderGame(zoray, root, hooksFor());
    expect(root.querySelector('.card[data-artifact="015"] .badge-count')!.textContent).toBe('计数 4/4');

    const ying = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '005', '006'], heroB: ['001', '002', '003'] });
    ying.players.A.artifacts.find((a) => a.id === '004')!.count = 3;
    renderGame(ying, root, hooksFor());
    expect(root.querySelector('.card[data-artifact="004"] .badge-count')!.textContent).toBe('计数 3/3');
  });

  it('shows 速度/意志 bonuses inline in the player colour (速度 3+2 / 意志 7+1)', () => {
    // 016 虚臾持续：速度 +2（A = 蓝）
    const xiu = createGame({ seed: 1, firstPlayer: 'A', heroA: ['016', '017', '018'], heroB: ['001', '002', '003'] });
    const v = xiu.players.A.artifacts.find((a) => a.id === '016')!;
    v.activeMarkerSide = 'left';
    v.armedSide = 'left';
    renderGame(xiu, root, hooksFor());
    const vsub = root.querySelector('.player--self .card[data-artifact="016"] .card-sub')!;
    expect(vsub.textContent).toContain('速度 3+2');
    const vdelta = vsub.querySelector('.sub-delta')!;
    expect(vdelta.textContent).toBe('+2');
    expect(vdelta.classList.contains('player-A')).toBe(true);
    expect(vdelta.classList.contains('sub-delta')).toBe(true);

    // 008 铁壁持续：意志 +1（第一列 007 显示 意志 7+1）
    const bat = createGame({ seed: 1, firstPlayer: 'A', heroA: ['007', '008', '009'], heroB: ['001', '002', '003'] });
    const shield = bat.players.A.artifacts.find((a) => a.id === '008')!;
    shield.activeMarkerSide = 'left';
    shield.armedSide = 'left';
    renderGame(bat, root, hooksFor());
    const bsub = root.querySelector('.player--self .card[data-artifact="007"] .card-sub')!;
    expect(bsub.textContent).toContain('意志 7+1');
    expect(bsub.querySelector('.sub-delta')!.classList.contains('player-A')).toBe(true);
  });

  it('detail popover shares the same meta line (充能 inline, 计数 with cap, 速度補正)', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['016', '017', '018'], heroB: ['001', '002', '003'] });
    const v = state.players.A.artifacts.find((a) => a.id === '016')!;
    v.activeMarkerSide = 'left';
    const card018 = state.players.A.artifacts.find((a) => a.id === '018')!;
    card018.count = 5;
    const { ui, hooks } = mount(state, root);
    // 直接打开 018 的只读浮窗
    ui.detail = { artifactId: '018', rect: { left: 0, top: 0, width: 10, height: 10 } as DOMRect };
    hooks.requestRender();
    const pop = root.querySelector('.detail-popover')!;
    expect(pop.querySelector('.detail-sub')!.textContent).toContain('计数 5/5');
    expect(pop.querySelector('.detail-sub')!.textContent).toContain('充能');
  });

  it('双方同 id 神器：详情浮窗按玩家取件（点对方卡图显示对方状态）', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '005', '006'], heroB: ['004', '005', '006'] });
    state.players.A.artifacts.find((a) => a.id === '004')!.count = 1;
    state.players.B.artifacts.find((a) => a.id === '004')!.count = 2;
    const { ui, hooks } = mount(state, root);
    // 打开「玩家B 的 004」只读浮窗 → 应显示 B 的计数（2），而非先找到的 A（1）
    ui.detail = { artifactId: '004', player: 'B', rect: { left: 0, top: 0, width: 10, height: 10 } as DOMRect };
    hooks.requestRender();
    const pop = root.querySelector('.detail-popover')!;
    expect(pop.querySelector('.detail-sub')!.textContent).toContain('计数 2/3');
  });

  it('settings buttons have no gear icon', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    renderGame(state, root, hooksFor());
    const btn = root.querySelector<HTMLElement>('[data-act="settingsOpen"]')!;
    expect(btn.textContent).toBe('设置');
    expect(root.textContent ?? '').not.toContain('⚙');
  });

  it('count appears exactly once per card (badge only, no duplication with the meta line)', () => {
    const occurrences = (text: string, needle: string): number => text.split(needle).length - 1;

    // 018：充能 1/1 已满 + 计数 1/5（有激活标记）
    const xiu = createGame({ seed: 1, firstPlayer: 'A', heroA: ['016', '017', '018'], heroB: ['001', '002', '003'] });
    const card018 = xiu.players.A.artifacts.find((a) => a.id === '018')!;
    card018.chargeLayer = 1;
    card018.activeMarkerSide = 'left';
    card018.armedSide = 'left';
    card018.count = 1;
    renderGame(xiu, root, hooksFor());
    const c18 = root.querySelector('.player--self .card[data-artifact="018"]')!;
    const text18 = c18.textContent ?? '';
    expect(occurrences(text18, '计数 1/5')).toBe(1);
    expect(occurrences(text18, '充能 1/1')).toBe(1);
    // 计数仍是独立徽标（橙），不与副标题/充能药丸混淆
    expect(c18.querySelector('.badge-count')!.textContent).toBe('计数 1/5');
    expect(c18.querySelector('.card-sub')!.textContent).not.toContain('计数');

    // 004：计数 3/3（淬炼满）
    const ying = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '005', '006'], heroB: ['001', '002', '003'] });
    ying.players.A.artifacts.find((a) => a.id === '004')!.count = 3;
    renderGame(ying, root, hooksFor());
    const c04 = root.querySelector('.player--self .card[data-artifact="004"]')!;
    expect(occurrences(c04.textContent ?? '', '计数 3/3')).toBe(1);
    expect(c04.querySelector('.badge-count')!.textContent).toBe('计数 3/3');
  });

  it('「已激活」徽标双方统一用绿色家族（不带玩家色），已生效时转灰', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['013', '014', '015'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    const med = { id: 'med-x', value: 4, kind: 'meditation' as const };
    state.players.A.areas.meditation.push(med);
    applyAction(state, { t: 'dustRise', artifactId: '014', side: 'left', costSlots: [{ dieIds: [med.id] }] });
    // B 方也放一个已完成的第三列神器，用于对比"双方同款"
    const b3 = state.players.B.artifacts.find((a) => a.id === '003')!;
    b3.chargeLayer = b3.chargeReq ?? 0;
    b3.activeMarkerSide = 'left';
    renderGame(state, root, hooksFor());

    const badgeA = root.querySelector('.player--self .card[data-artifact="014"] .badge-active')!;
    const badgeB = root.querySelector('.player--enemy .card[data-artifact="003"] .badge-active')!;
    expect(badgeA.textContent).toContain('已激活·');
    expect(badgeB.textContent).toContain('已激活·');
    // 双方一致：绿色家族（CSS 决定），不带玩家色类
    for (const b of [badgeA, badgeB]) {
      expect(b.classList.contains('player-A')).toBe(false);
      expect(b.classList.contains('player-B')).toBe(false);
    }
    expect(badgeA.classList.contains('badge-active--spent')).toBe(false);

    // 「已生效」→ 灰态
    applyAction(state, { t: 'skill', artifactId: '014', side: 'left', params: { targetDieIds: [] } });
    renderGame(state, root, hooksFor());
    const spent = root.querySelector('.player--self .card[data-artifact="014"] .badge-active')!;
    expect(spent.classList.contains('badge-active--spent')).toBe(true);
  });

  it('UI-layer errors render in the hint bar and never touch the game log', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    const { ui, hooks } = mount(state, root);
    const logBefore = state.log.length;
    expect(root.querySelector('.hint-error')).toBeNull();

    ui.error = '非法操作：not main phase';
    hooks.requestRender();
    const err = root.querySelector('.hint-error')!;
    expect(err.textContent).toContain('非法操作：not main phase');
    // 只属于界面：引擎状态与战报不受影响
    expect(state.log.length).toBe(logBefore);
    expect((state.log.map((l) => l.text).join('\n') ?? '').includes('非法操作')).toBe(false);

    ui.error = null;
    hooks.requestRender();
    expect(root.querySelector('.hint-error')).toBeNull();
  });

  it('018 必杀用后：持续行与「已激活」徽标一起转灰（计数保留）', () => {
    const state = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['016', '017', '018'],
      heroB: ['001', '002', '003'],
    });
    skipInitialReroll(state);
    const card = state.players.A.artifacts.find((a) => a.id === '018')!;
    card.chargeLayer = 1;
    card.activeMarkerSide = 'left';
    card.armedSide = 'left';
    card.armedTurn = state.turnIndex;
    card.count = 2;
    const { hooks } = mount(state, root);
    applyAction(state, { t: 'advance' }); // 尘起 → 主要阶段
    hooks.requestRender();
    const sel = '.player--self .card[data-artifact="018"]';
    // 用之前：持续行绿色、已激活徽标不灰
    const durSel = `${sel} .skill-part[data-key="zhihai.bloom"]`;
    const ultSel = `${sel} .skill-part[data-key="zhihai.bloom.ultimate"]`;
    expect(root.querySelector(durSel)!.classList.contains('skill-part--on')).toBe(true);
    expect(root.querySelector(`${sel} .badge-active`)!.classList.contains('badge-active--spent')).toBe(false);

    // 主动发动必杀（计数 2 → 得 2 骰；跳过重掷）
    applyAction(state, { t: 'skill', artifactId: '018', side: 'only', params: {} });
    applyAction(state, { t: 'zhihaiReroll', dieIds: [] });
    hooks.requestRender();

    expect(state.players.A.artifacts.find((a) => a.id === '018')!.continuousLost).toBe(true);
    // 持续行 → 深灰；必杀行 → 已使用灰
    expect(root.querySelector(durSel)!.classList.contains('skill-part--disabled')).toBe(true);
    expect(root.querySelector(durSel)!.classList.contains('skill-part--on')).toBe(false);
    expect(root.querySelector(ultSel)!.classList.contains('skill-part--used')).toBe(true);
    // 已激活徽标 → 同样转灰（文案不变、不加文字）
    const act = root.querySelector(`${sel} .badge-active`)!;
    expect(act.classList.contains('badge-active--spent')).toBe(true);
    expect(act.textContent).toContain('已激活·');
    expect((act.textContent ?? '').includes('失效')).toBe(false);
    // 计数保留
    expect(root.querySelector(`${sel} .badge-count`)!.textContent).toBe('计数 2/5');
  });

  it('019 蛮王之牙：选择器按「X → 种类组合 → 每种 1 颗 → 选 X 项」推进并派发参数', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['019', '020', '021'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 → 主要
    const card = state.players.A.artifacts.find((a) => a.id === '019')!;
    card.activeMarkerSide = 'right'; // 蛮王之牙侧激活
    card.armedSide = 'right';
    state.players.A.areas.attack = [{ id: 'k1', value: 2, kind: 'attack' }];
    const { ui, onAction } = mount(state, root);
    const stepBtns = () => Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).map((b) => b.textContent);
    const clickBtn = (text: string): void => {
      const b = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((x) =>
        (x.textContent ?? '').includes(text),
      );
      if (!b) throw new Error(`no selector button: ${text} @ ${String(stepBtns())}`);
      b.click();
    };
    const btn = root.querySelector<HTMLButtonElement>('.actionlist .btn[data-act="skill"]')!;
    expect(btn.textContent).toContain('蛮王之牙');
    btn.click();
    expect(ui.selection?.key).toBe('chenai.fang');
    // ① 选 X = 1
    expect(stepBtns()).toEqual(expect.arrayContaining(['1 个（选 1 项）', '2 个（选 2 项）', '3 个（选 3 项）']));
    clickBtn('1 个（选 1 项）');
    clickBtn('确认');
    // ② 选种类组合：攻击
    expect(stepBtns()).toEqual(expect.arrayContaining(['攻击', '防御', '冥想']));
    clickBtn('攻击');
    clickBtn('确认');
    // ③ 选 1 颗攻击骰
    root.querySelector<HTMLElement>('.player--self .die[data-id="k1"]')!.click();
    clickBtn('确认');
    // ④ 选第 1 项：② 获得 1 个 3 点攻击骰
    clickBtn('②');
    clickBtn('确认');
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-confirm')!.click();
    const calls = (onAction as unknown as {
      mock: { calls: [{ t: string; artifactId: string; side: string; params: { costSlots: unknown; picks: string[] } }][] };
    }).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const act = calls[calls.length - 1][0];
    expect(act.t).toBe('skill');
    expect(act.artifactId).toBe('019');
    expect(act.side).toBe('right');
    expect(act.params.picks).toEqual(['gain']);
    expect(act.params.costSlots).toEqual([{ dieIds: ['k1'] }]);
  });

  it('020 兽魂：攻击方选择「取消伤害 / 正常造成伤害」（按钮精确，经确认条派发）', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['019', '020', '021'] });
    skipInitialReroll(state);
    state.players.B.artifacts.find((a) => a.id === '020')!.count = 2;
    state.pending = {
      kind: 'shouhunCancel',
      player: 'A',
      owner: 'B',
      attack: { attacker: 'A', value: 3, unblockable: false, physical: true },
      minCount: 1,
    };
    const { onAction } = mount(state, root);
    const labels = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).map((b) => b.textContent);
    expect(labels.filter((l) => (l ?? '').includes('取消'))).toEqual([
      '取消这次伤害（「兽魂」计数 −1）',
      '不取消，正常造成伤害',
    ]);
    expect(root.querySelector('.hint-phase')!.textContent).toContain('兽魂');
    root.querySelector<HTMLButtonElement>('.actionlist .btn[data-act="shouhunCancel"]')!.click();
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-confirm')!.click();
    expect(onAction).toHaveBeenCalledWith({ t: 'shouhunCancel', cancel: true });
  });

  it('021：计数徽标带上限（计数 5/5），已激活后的尘起入口显示「续充」', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['019', '020', '021'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    const card = state.players.A.artifacts.find((a) => a.id === '021')!;
    card.chargeLayer = 1;
    card.activeMarkerSide = 'left';
    card.count = 5;
    renderGame(state, root, hooksFor());
    expect(root.querySelector('.player--self .card[data-artifact="021"] .badge-count')!.textContent).toBe('计数 5/5');
    // 计数已满 → 不再出现尘起入口
    const labels = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).map((b) => b.textContent);
    expect(labels.some((l) => (l ?? '').includes('续充'))).toBe(false);
    // 计数降到 2 → 出现「续充」入口
    card.count = 2;
    renderGame(state, root, hooksFor());
    const labels2 = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).map((b) => b.textContent);
    expect(labels2.some((l) => (l ?? '').includes('续充「决意」'))).toBe(true);
  });

  it('019 免费额外尘起：入口标注「（免费）」，切换类神器点击后直接派发 free 动作', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['019', '020', '021'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 主要阶段
    state.freeNoCostRise = 1;
    state.players.A.artifacts.find((a) => a.id === '020')!.activeMarkerSide = 'left'; // 020 有标记 → 切换
    const { onAction } = mount(state, root);
    const free = root.querySelector<HTMLButtonElement>('.actionlist .btn[data-act="dustRise"][data-artifact="020"]');
    expect(free).not.toBeNull();
    expect(free!.dataset.free).toBe('1');
    expect(free!.textContent).toContain('（免费）');
    free!.click(); // 切换类神器：直接派发（无需选侧/支付）
    expect(onAction).toHaveBeenCalledWith({ t: 'dustRise', artifactId: '020', free: true, side: 'right' });
  });

  it('022 填弹：顺点约束实时校验（不满足时禁用确认并提示）', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['022', '023', '024'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // → 主要阶段
    const card = state.players.A.artifacts.find((a) => a.id === '022')!;
    card.activeMarkerSide = 'left';
    card.armedSide = 'left';
    state.players.A.areas.attack = [
      { id: 'p1', value: 2, kind: 'attack' },
      { id: 'p2', value: 4, kind: 'attack' },
      { id: 'p3', value: 3, kind: 'attack' },
    ];
    const { ui } = mount(state, root);
    root.querySelector<HTMLButtonElement>('.actionlist .btn[data-act="skill"]')!.click();
    expect(ui.selection?.key).toBe('siji.tiandan');
    const ok = () => Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) => b.textContent === '确认')!;
    const die = (id: string) => root.querySelector<HTMLElement>(`.player--self .die[data-id="${id}"]`)!;
    die('p1').click();
    die('p2').click(); // 2 + 4 不是顺点
    expect(ok().disabled).toBe(true);
    expect(root.querySelector('.selector-hint')!.textContent).toContain('不是顺点');
    // 取消 4、改选 3 → 2-3 顺点（仍满足 1..6 颗）
    die('p2').click();
    die('p3').click();
    expect(ok().disabled).toBe(false);
    expect(root.querySelector('.selector-hint')!.textContent).toContain('顺点 ✓');
  });

  it('022 处刑通牒：使用攻击骰前给出「不发动 / ① / ②」三个按钮（精确）', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['022', '023', '024'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    state.pending = { kind: 'sijiChuxing', player: 'A', costSlots: [{ dieIds: ['x'] }] };
    renderGame(state, root, hooksFor());
    const labels = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).map((b) => b.textContent);
    expect(labels.filter((l) => (l ?? '').includes('处刑通牒') || (l ?? '').startsWith('①') || (l ?? '').startsWith('②'))).toEqual([
      '不发动「处刑通牒」',
      '① 本次攻击伤害 +1 且不可抵挡',
      '② 本次攻击伤害 +5',
    ]);
    expect(root.querySelector('.hint-phase')!.textContent).toContain('处刑通牒');
  });

  it('023 畏惧：对方用内联骰片消耗 1 颗（非当前玩家操作）', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['022', '023', '024'] });
    skipInitialReroll(state);
    state.activePlayer = 'A';
    state.pending = { kind: 'weijuPay', player: 'B', initiator: 'A', initiatorValue: 5 };
    state.players.B.areas.attack = [{ id: 'bx', value: 2, kind: 'attack' }];
    const { onAction } = mount(state, root);
    const chip = root.querySelector<HTMLElement>('.actionlist-chips .pay-die[data-id="bx"]');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toBe('攻2');
    chip!.click();
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-confirm')!.click();
    expect(onAction).toHaveBeenCalledWith({ t: 'weijuPay', dieId: 'bx' });
  });

  it('023 共振：选 ② 时按重掷后区域给出双方各弃置 2 颗的选择器', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['022', '023', '024'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    state.pending = { kind: 'gongzhenPick', player: 'A', areaKind: 'meditation' };
    state.players.A.areas.meditation = [
      { id: 'ma1', value: 2, kind: 'meditation' },
      { id: 'ma2', value: 3, kind: 'meditation' },
    ];
    state.players.B.areas.meditation = [
      { id: 'mb1', value: 5, kind: 'meditation' },
      { id: 'mb2', value: 6, kind: 'meditation' },
    ];
    const { ui, onAction } = mount(state, root);
    root.querySelector<HTMLButtonElement>('.actionlist .btn[data-act="gongzhenOpen"]')!.click();
    expect(ui.selection?.pendingKind).toBe('gongzhenPick');
    const btn = (t: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) => (b.textContent ?? '').includes(t))!;
    btn('②').click();
    btn('确认').click();
    // 第二步：弃置我方 2 颗
    const die = (id: string) => root.querySelector<HTMLElement>(`.selector .pay-die[data-id="${id}"]`)!;
    die('ma1').click();
    die('ma2').click();
    btn('确认').click();
    // 第三步：弃置对方 2 颗
    die('mb1').click();
    die('mb2').click();
    btn('确认').click();
    expect(onAction).toHaveBeenCalledWith({
      t: 'gongzhenResolve',
      pick: 'discard',
      myIds: ['ma1', 'ma2'],
      oppIds: ['mb1', 'mb2'],
    });
  });

  it('024 充能：强制选择器（选哪一方 → 哪颗骰 → 目标区域）', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['022', '023', '024'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    state.pending = { kind: 'chargeResolve', player: 'A', artifactId: '024' };
    state.players.A.areas.attack = [{ id: 'ka', value: 4, kind: 'attack' }];
    const { ui, onAction } = mount(state, root);
    // 充能待决策 → 操作栏给出「凶弹业舞」按钮（charge 技能可开选择器）
    const open = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).find((b) =>
      (b.textContent ?? '').includes('凶弹业舞'),
    )!;
    expect(open).toBeTruthy();
    open.click();
    expect(ui.selection?.key).toBe('kuangwu.charge');
    const btn = (t: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) => (b.textContent ?? '').includes(t))!;
    btn('我方的能力骰').click();
    btn('确认').click();
    root.querySelector<HTMLElement>('.player--self .die[data-id="ka"]')!.click();
    btn('确认').click();
    btn('冥想骰区').click();
    btn('确认').click();
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-confirm')!.click();
    expect(onAction).toHaveBeenCalledWith({
      t: 'skill',
      artifactId: '024',
      side: 'only',
      params: { owner: 'self', dieId: 'ka', toKind: 'meditation' },
    });
  });

  it('024 必杀：方向选项 + 6 个区域各一步（不足 3 颗则尽可能）', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['022', '023', '024'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    const card = state.players.A.artifacts.find((a) => a.id === '024')!;
    card.chargeLayer = 4;
    card.activeMarkerSide = 'left';
    state.players.A.areas.defense = [{ id: 'd1', value: 2, kind: 'defense' }];
    applyAction(state, { t: 'advance' }); // 尘起 → 主要阶段
    const { ui } = mount(state, root);
    const open = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).find((b) =>
      (b.textContent ?? '').includes('凶弹业舞'),
    )!;
    open.click();
    expect(ui.selection?.key).toBe('kuangwu.ultimate');
    // 第 1 步是方向选项；共 1（方向）+ 6（区域）步
    expect(root.querySelector('.selector .option-btn')!.textContent).toBe('顺时针');
    expect(root.querySelector('.selector-title')!.textContent).toContain('/7');
  });

  it('被攻击提示：显示「处刑通牒」加成与「畏惧」减半来源', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['022', '023', '024'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    state.pendingAttack = {
      attacker: 'A',
      value: 3,
      unblockable: false,
      physical: true,
      sourceValue: 2,
      bonusValue: 1,
      bonusLabel: '处刑通牒',
      halveReason: '畏惧',
    };
    renderGame(state, root, hooksFor());
    const hint = root.querySelector('.hint-phase')!.textContent ?? '';
    expect(hint).toContain('被 2 点攻击骰攻击，本次 3 伤害');
    expect(hint).toContain('（「处刑通牒」加成 1 伤害）');
    expect(hint).toContain('（「畏惧」减半）');
  });

  it('block prompt shows real damage, bonus source and 请选择', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '002', '003'] });
    skipInitialReroll(state);
    const hint = () => root.querySelector('.hint-phase')!.textContent ?? '';
    const setPA = (over: Record<string, unknown>): void => {
      state.pendingAttack = {
        attacker: 'A',
        value: 3,
        unblockable: false,
        physical: true,
        sourceDieId: 'sd',
        sourceValue: 3,
        ...over,
      };
      renderGame(state, root, hooksFor());
    };

    // 无加成
    setPA({});
    expect(hint()).toBe('被 3 点攻击骰攻击，本次 3 伤害；请选择');

    // 计数类加成（004 锋芒）
    const fm = state.players.A.artifacts.find((a) => a.id === '004')!;
    fm.activeMarkerSide = 'right';
    fm.count = 2;
    setPA({ value: 5 });
    expect(hint()).toBe('被 3 点攻击骰攻击，本次 5 伤害（「锋芒」加成 2 伤害）；请选择');

    // 普通增益（带来源 008 王家之拳）
    fm.activeMarkerSide = null;
    fm.count = 0;
    state.players.A.buffs.push({
      attr: 'attackDamage',
      add: 1,
      duration: 'thisTurn',
      source: '王家之拳',
    });
    setPA({ value: 4 });
    expect(hint()).toBe('被 3 点攻击骰攻击，本次 4 伤害（「王家之拳」加成 1 伤害）；请选择');
    state.players.A.buffs = [];

    // 不可抵挡
    setPA({ unblockable: true });
    expect(hint()).toBe('被 3 点攻击骰攻击，本次 3 伤害（不可抵挡）；请选择');

    // 虚拟攻击（无攻击骰）
    setPA({ sourceDieId: undefined, sourceValue: undefined, physical: false });
    expect(hint()).toBe('本次 3 伤害（技能攻击，无攻击骰）；请选择');
  });

  it('mirrors the enemy artifact order only when 镜像神器摆放 is on', () => {
    const state = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['001', '002', '003'],
      heroB: ['004', '005', '006'],
    });
    const cardIds = (sel: string) =>
      Array.from(root.querySelectorAll<HTMLElement>(`${sel} .cards .card`)).map(
        (e) => e.dataset.artifact,
      );

    // 默认关：双方都是 列1,列2,列3
    renderGame(state, root, hooksFor());
    expect(cardIds('.player--enemy')).toEqual(['004', '005', '006']);
    expect(cardIds('.player--self')).toEqual(['001', '002', '003']);

    // 开启：敌方镜像为 列3,列2,列1；自己不变
    renderGame(state, root, hooksFor(() => {}, { mirrorEnemy: true }));
    expect(cardIds('.player--enemy')).toEqual(['006', '005', '004']);
    expect(cardIds('.player--self')).toEqual(['001', '002', '003']);
  });

  it('keeps mirroring attached to the on-top (enemy) panel when the active player flips', () => {
    const state = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['001', '002', '003'],
      heroB: ['004', '005', '006'],
    });
    const cardIds = (sel: string) =>
      Array.from(root.querySelectorAll<HTMLElement>(`${sel} .cards .card`)).map(
        (e) => e.dataset.artifact,
      );

    // A 行动：上方=敌方 B（镜像）
    renderGame(state, root, hooksFor(() => {}, { mirrorEnemy: true }));
    expect(cardIds('.player--enemy')).toEqual(['006', '005', '004']);

    // 切到 B 行动：上方=敌方 A（镜像），下方=自己 B（正常）
    state.activePlayer = 'B';
    renderGame(state, root, hooksFor(() => {}, { mirrorEnemy: true }));
    expect(cardIds('.player--enemy')).toEqual(['003', '002', '001']);
    expect(cardIds('.player--self')).toEqual(['004', '005', '006']);
  });

  it('shows count and charge badges when present', () => {
    const state = setupGame({ seed: 1, firstPlayer: 'A' });
    state.players.B.artifacts.find((a) => a.id === '004')!.count = 2; // 不祥
    state.players.A.artifacts.find((a) => a.id === '003')!.chargeLayer = 2; // 明镜
    renderGame(state, root, hooksFor());
    const text = root.textContent ?? '';
    expect(text).toContain('计数 2');
    expect(text).toContain('充能 2/4');
  });

  it('marks a fully charged column-3 artifact and does not offer charging', () => {
    const state = setupGame({ seed: 1, firstPlayer: 'A' });
    const mj = state.players.A.artifacts.find((a) => a.id === '003')!;
    mj.chargeLayer = 4; // 明镜 满充能（真实流程会在完成充能时放上激活标记）
    mj.activeMarkerSide = 'left';
    mj.armedSide = 'left';
    renderGame(state, root, hooksFor());
    const card = root.querySelector('.player--self .card[data-artifact="003"]')!;
    // 充能并入副标题（与「生命」同一样式、位于徽标之前），不再有单独的充能徽标与「（已满）」文案
    expect(card.querySelector('.badge-charge')).toBeNull();
    const sub = card.querySelector('.card-sub')!;
    expect(sub.textContent).toContain('充能 4/4');
    expect(sub.textContent).not.toContain('已满');
    // 「充能」是纯文本；只有 y/x 是黄色药丸，且满充能也不换绿色变体
    const chargePill = sub.querySelector('.sub-charge')!;
    expect(chargePill).not.toBeNull();
    expect(chargePill.textContent).toBe('4/4');
    expect(chargePill.classList.contains('sub-charge--full')).toBe(false);
    // 充能提示排在「已激活」徽标之前
    const active = card.querySelector('.badge-active')!;
    expect(active).not.toBeNull();
    expect((sub.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
    expect(card.querySelectorAll('.clickable').length).toBe(0);
  });

  it('does not offer 淬炼 once 不祥 count reaches 3', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    const buxiang = state.players.A.artifacts.find((a) => a.id === '004')!;
    buxiang.activeMarkerSide = 'left';
    buxiang.count = 3;
    renderGame(state, root, hooksFor());
    const text = root.textContent ?? '';
    expect(text).not.toContain('启动技能：淬炼');
    const box = root.querySelector<HTMLElement>(
      '.player--self .card[data-artifact="004"] .skill-part--disabled',
    );
    expect(box).not.toBeNull();
    // 计数满：只靠「计数 3/3」+ 深灰禁用表达，不再有「已满」徽标/红底
    expect((box!.textContent ?? '').includes('已满')).toBe(false);
    expect(root.querySelector('.player--self .card[data-artifact="004"] .badge-count')!.textContent).toBe('计数 3/3');
    expect(box!.classList.contains('skill-part--full')).toBe(false);
    expect(box!.classList.contains('clickable')).toBe(false);
  });
});

describe('renderGame (interaction)', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
  });

  it('renders a two-line hint: turn line and phase guidance', () => {
    renderGame(createGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    const hint = root.querySelector('.hint');
    expect(hint).not.toBeNull();
    expect(hint!.textContent ?? '').toContain('轮到 玩家A 操作');
    expect((hint!.textContent ?? '').length).toBeGreaterThan(0);
  });

  it('renders an operation list with buttons in the main phase', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    renderGame(state, root, hooksFor());
    expect(root.querySelectorAll('.actionlist .btn').length).toBeGreaterThan(0);
  });

  it('puts the action zone and the vitals bar inside the center band', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    renderGame(state, root, hooksFor());
    const band = root.querySelector('.centerband')!;
    const zone = band.querySelector('.centerband-left .actionzone')!;
    // 提示栏与操作栏合并进同一块
    expect(zone.querySelector('.hint')).not.toBeNull();
    expect(zone.querySelector('.actionlist')).not.toBeNull();
    // 尘落在操作栏提示行右上角
    expect(zone.querySelector('.hint .hint-dust')?.textContent).toContain('尘落');
    // 中段不再有独立生命栏（生命改为面板内进度条）；右槽保留并放「设置」
    expect(band.querySelector('.vitals')).toBeNull();
    expect(band.querySelector('.centerband-right .btn-settings')).not.toBeNull();
    // 左栏顶部不再有设置行（设置已移到右槽）
    expect(root.querySelector('.sidebar-head')).toBeNull();
  });

  it('orders dice areas as 防御/攻击/冥想 so the attack area sits in the middle', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    renderGame(state, root, hooksFor());
    const kinds = Array.from(root.querySelectorAll<HTMLElement>('.player--self .area')).map(
      (e) => e.dataset.kind,
    );
    expect(kinds).toEqual(['defense', 'attack', 'meditation']);
  });

  it('renders every skill type inline with its effect text when descriptions are shown', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    renderGame(state, root, hooksFor(() => {}, { showSkillText: true }));
    const heads = Array.from(root.querySelectorAll('.skill-part-head'));
    expect(heads.length).toBeGreaterThan(0);
    for (const h of heads) {
      expect(h.querySelector('.skill-type')).not.toBeNull();
      expect(h.querySelector('.skill-text')).not.toBeNull();
    }
  });

  it('hides skill descriptions by default (name + type badge only)', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    renderGame(state, root, hooksFor());
    expect(root.querySelectorAll('.skill-part-head').length).toBeGreaterThan(0);
    expect(root.querySelectorAll('.skill-text').length).toBe(0);
    // 技能名仍在（且与类型徽标同行 → 那一行就是点击发动的目标）
    expect(root.querySelector('.skill-part-head .skill-name')).not.toBeNull();
    expect((root.textContent ?? '').length).toBeGreaterThan(0);
  });

  it('opens a read-only skill detail popover by right-clicking the card art (not left-click)', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'] });
    const { ui } = mount(state, root);
    expect(root.querySelector('.detail-popover')).toBeNull();

    const art = root.querySelector<HTMLElement>(
      '.player--self .card[data-artifact="001"] .card-art',
    )!;
    expect(art.classList.contains('detail-trigger')).toBe(true);
    // 左键不再打开详情
    art.click();
    expect(ui.detail).toBeNull();
    // 右键打开
    art.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(ui.detail!.artifactId).toBe('001');

    const pop = root.querySelector<HTMLElement>('.detail-popover')!;
    expect(pop.dataset.artifact).toBe('001');
    // 浮窗内始终有完整描述
    expect(pop.querySelectorAll('.skill-text').length).toBeGreaterThan(0);
    expect(pop.textContent).toContain('中央突破');

    // 关闭
    root.querySelector<HTMLButtonElement>('.detail-popover .detail-close')!.click();
    expect(ui.detail).toBeNull();
    expect(root.querySelector('.detail-popover')).toBeNull();
  });

  it('uses thumbnail card art by default and full art when configured', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    renderGame(state, root, hooksFor());
    expect(root.querySelectorAll('.card-art--thumb').length).toBeGreaterThan(0);

    renderGame(state, root, hooksFor(() => {}, { cardArt: 'full' }));
    expect(root.querySelectorAll('.card-art--thumb').length).toBe(0);
  });

  it('applies the density class from prefs', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    renderGame(state, root, hooksFor());
    expect(root.querySelector('.app')!.classList.contains('density-compact')).toBe(true);
    renderGame(state, root, hooksFor(() => {}, { density: 'comfortable' }));
    expect(root.querySelector('.app')!.classList.contains('density-comfortable')).toBe(true);
  });

  it('opens the settings panel and persists pref changes via onPrefsChange', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    const ui = freshUi();
    const saved: Array<UiState['prefs']> = [];
    const hooks: RenderHooks = {
      ui,
      onAction: () => {},
      propose: () => {},
      requestRender: () => renderGame(state, root, hooks),
      onRestart: () => {},
      onPrefsChange: (p) => saved.push(p),
    };
    renderGame(state, root, hooks);

    const openBtn = root.querySelector<HTMLButtonElement>('.btn-settings')!;
    expect(openBtn).not.toBeNull();
    openBtn.click();
    expect(ui.settingsOpen).toBe(true);
    expect(root.querySelector('.settings-panel')).not.toBeNull();

    // 「显示技能描述 → 显示」
    const showOpt = Array.from(
      root.querySelectorAll<HTMLButtonElement>('.settings-row .settings-opt'),
    ).find((b) => b.textContent === '显示')!;
    showOpt.click();
    expect(ui.prefs.showSkillText).toBe(true);
    expect(saved[saved.length - 1].showSkillText).toBe(true);
    expect(root.querySelectorAll('.skill-text').length).toBeGreaterThan(0);

    // 「卡图 → 完整」
    const fullOpt = Array.from(
      root.querySelectorAll<HTMLButtonElement>('.settings-row .settings-opt'),
    ).find((b) => b.textContent === '完整')!;
    fullOpt.click();
    expect(ui.prefs.cardArt).toBe('full');
    expect(root.querySelectorAll('.card-art--thumb').length).toBe(0);

    // 恢复默认
    const reset = root.querySelector<HTMLButtonElement>('[data-act="settingsReset"]')!;
    reset.click();
    expect(ui.prefs).toEqual({
      showSkillText: true,
      cardArt: 'full',
      density: 'compact',
      mirrorEnemy: false,
      preset: 'desktop',
      logCollapsed: false,
      zoomMode: 'off',
      zoomPercent: 90,
    });
    // 恢复默认 = 电脑模式（技能显示 + 完整卡图）
    expect(root.querySelectorAll('.skill-text').length).toBeGreaterThan(0);
    expect(root.querySelectorAll('.card-art--thumb').length).toBe(0);

    // 关闭
    root.querySelector<HTMLButtonElement>('.settings-close')!.click();
    expect(ui.settingsOpen).toBe(false);
    expect(root.querySelector('.settings-panel')).toBeNull();
  });

  it('never renders an internal skill key (e.g. wansha.ultimate) in the UI', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['006', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' });
    const wansha = state.players.A.artifacts.find((a) => a.id === '006')!;
    wansha.chargeLayer = wansha.chargeReq ?? 4;
    wansha.activeMarkerSide = 'left';
    state.players.A.areas.attack.push({ id: 'atk-x', value: 4, kind: 'attack' });
    renderGame(state, root, hooksFor());
    const text = root.textContent ?? '';
    expect(text).not.toMatch(/[a-z]+\.[a-z]+/i);
    expect(text).toContain('零时枭首');
  });

  it('recolors a fully charged 完杀: 充能 disabled, 必杀 green', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['006', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' });
    const wansha = state.players.A.artifacts.find((a) => a.id === '006')!;
    wansha.chargeLayer = wansha.chargeReq ?? 4;
    wansha.activeMarkerSide = 'left';
    renderGame(state, root, hooksFor());
    const parts = Array.from(
      root.querySelectorAll<HTMLElement>('.player--self .card[data-artifact="006"] .skill-part'),
    );
    const charge = parts.find((p) => p.dataset.key === 'wansha.charge')!;
    const ult = parts.find((p) => p.dataset.key === 'wansha.ultimate')!;
    expect(charge.classList.contains('skill-part--disabled')).toBe(true);
    expect(charge.classList.contains('skill-part--on')).toBe(false);
    expect(ult.classList.contains('skill-part--on')).toBe(true);
  });

  it('distinguishes disabled (darker grey) from inactive (light grey) and used ultimate', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' });
    const buxiang = state.players.A.artifacts.find((a) => a.id === '004')!;
    buxiang.activeMarkerSide = 'left';
    buxiang.count = 3;
    renderGame(state, root, hooksFor());
    const cuilian = root.querySelector<HTMLElement>(
      '.player--self .card[data-artifact="004"] .skill-part[data-key="buxiang.cuilian"]',
    )!;
    expect(cuilian.classList.contains('skill-part--disabled')).toBe(true);
    // 右（未激活的持续）应为浅灰 off，而非 disabled
    const fengmang = root.querySelector<HTMLElement>(
      '.player--self .card[data-artifact="004"] .skill-part[data-side="right"]',
    )!;
    expect(fengmang.classList.contains('skill-part--off')).toBe(true);
    expect(fengmang.classList.contains('skill-part--disabled')).toBe(false);
  });

  it('marks a used ultimate row as disabled', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['006', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' });
    const wansha = state.players.A.artifacts.find((a) => a.id === '006')!;
    wansha.chargeLayer = wansha.chargeReq ?? 4;
    wansha.activeMarkerSide = 'left';
    state.ultimatesUsed.push('A:wansha.ultimate');
    renderGame(state, root, hooksFor());
    const ult = root.querySelector<HTMLElement>(
      '.player--self .card[data-artifact="006"] .skill-part[data-key="wansha.ultimate"]',
    )!;
    expect(ult.classList.contains('skill-part--disabled')).toBe(true);
  });

  it('clicking a legal attack die proposes a confirm, and 确认 dispatches it', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    const die = state.players.A.areas.attack[0];
    const { ui, onAction } = mount(state, root);

    const dieEl = root.querySelector<HTMLElement>(
      `.player--self .die[data-id="${die.id}"]`,
    );
    expect(dieEl).not.toBeNull();
    expect(dieEl!.classList.contains('clickable')).toBe(true);
    dieEl!.click();
    expect(onAction).not.toHaveBeenCalled();
    expect(ui.pendingConfirm).not.toBeNull();
    expect(ui.pendingConfirm!.action).toEqual({ t: 'attack', costSlots: [{ dieIds: [die.id] }] });

    const confirmBtn = root.querySelector<HTMLButtonElement>('.confirm-row .btn-confirm');
    expect(confirmBtn).not.toBeNull();
    confirmBtn!.click();
    expect(onAction).toHaveBeenCalledWith({ t: 'attack', costSlots: [{ dieIds: [die.id] }] });
  });

  it('renders attack dice as compact chips (label + die chips) in the operation list', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    const { ui } = mount(state, root);

    const chips = root.querySelectorAll<HTMLButtonElement>(
      '.actionlist-chips .pay-die[data-act="attack"]',
    );
    expect(chips.length).toBeGreaterThan(0);
    expect(chips[0].classList.contains('die-A')).toBe(true);
    expect(root.querySelector('.actionlist-chips .chip-label')!.textContent).toBe('攻击');
    const textBtn = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).find(
      (b) => (b.textContent ?? '').includes('点攻击骰'),
    );
    expect(textBtn).toBeUndefined();

    chips[0].click();
    expect(ui.pendingConfirm).not.toBeNull();
    expect(ui.pendingConfirm!.action.t).toBe('attack');
  });

  it('clicking a parameterized skill card opens the dice chooser (no default dispatch)', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    const yuqie = state.players.A.artifacts.find((a) => a.id === '001')!;
    yuqie.activeMarkerSide = 'left';
    state.players.A.areas.meditation.push(
      { id: 'test-m1', value: 2, kind: 'meditation' },
    );

    const { ui, onAction } = mount(state, root);

    const box = root.querySelector<HTMLElement>(
      '.player--self .card[data-artifact="001"] .skill-part.clickable',
    );
    expect(box).not.toBeNull();
    box!.click();
    expect(onAction).not.toHaveBeenCalled();
    expect(ui.selection).not.toBeNull();
    expect(root.querySelector('.selector')).not.toBeNull();
  });

  it('enters the skill chooser from the operation list', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    const buxiang = state.players.A.artifacts.find((a) => a.id === '004')!;
    buxiang.activeMarkerSide = 'left';
    state.players.A.areas.attack.push({ id: 'atk-test', value: 3, kind: 'attack' });

    const { ui } = mount(state, root);

    const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).find((b) =>
      (b.textContent ?? '').includes('淬炼'),
    );
    expect(btn).toBeTruthy();
    btn!.click();
    expect(ui.selection).not.toBeNull();
    expect(root.querySelector('.selector')).not.toBeNull();
  });

  it('completes the chooser, proposes the skill, and dispatches only after 确认', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    const buxiang = state.players.A.artifacts.find((a) => a.id === '004')!;
    buxiang.activeMarkerSide = 'left';
    state.players.A.areas.attack.push({ id: 'atk-test', value: 3, kind: 'attack' });

    const { ui, onAction } = mount(state, root);

    const openBtn = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).find((b) =>
      (b.textContent ?? '').includes('淬炼'),
    )!;
    openBtn.click();

    const die = root.querySelector<HTMLElement>('.player--self .die[data-id="atk-test"]');
    expect(die).not.toBeNull();
    die!.click();

    const okBtn = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
      (b) => b.textContent === '确认',
    );
    expect(okBtn).toBeTruthy();
    expect(okBtn!.disabled).toBe(false);
    okBtn!.click();

    expect(onAction).not.toHaveBeenCalled();
    expect(ui.pendingConfirm).not.toBeNull();
    expect(ui.pendingConfirm!.action).toEqual({
      t: 'skill',
      artifactId: '004',
      side: 'left',
      params: { costSlots: [{ dieIds: ['atk-test'] }] },
    });

    const confirmBtn = root.querySelector<HTMLButtonElement>('.confirm-row .btn-confirm');
    expect(confirmBtn).not.toBeNull();
    confirmBtn!.click();
    expect(onAction).toHaveBeenCalledWith({
      t: 'skill',
      artifactId: '004',
      side: 'left',
      params: { costSlots: [{ dieIds: ['atk-test'] }] },
    });
  });

  it('cancels a pending confirm without dispatching', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    const die = state.players.A.areas.attack[0];
    const { ui, onAction } = mount(state, root);

    root.querySelector<HTMLElement>(`.player--self .die[data-id="${die.id}"]`)!.click();
    expect(ui.pendingConfirm).not.toBeNull();

    const cancelBtn = root.querySelector<HTMLButtonElement>('.confirm-row .btn-cancel');
    expect(cancelBtn).not.toBeNull();
    cancelBtn!.click();
    expect(ui.pendingConfirm).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('shows the log newest-first', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    state.log.length = 0;
    state.log.push(
      { turn: 0, phase: 'main', text: '第一条' },
      { turn: 0, phase: 'main', text: '第二条' },
      { turn: 0, phase: 'main', text: '第三条' },
    );
    renderGame(state, root, hooksFor());
    const lines = root.querySelectorAll('.log .log-line');
    expect(lines.length).toBe(3);
    expect(lines[0].textContent).toContain('第三条');
    expect(lines[2].textContent).toContain('第一条');
  });

  it('marks a used ultimate via the --used colour state (no 已使用 badge) and disables it', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    state.ultimatesUsed.push('A:mingjing.ultimate');
    state.players.A.artifacts.find((a) => a.id === '003')!.activeMarkerSide = 'left';
    renderGame(state, root, hooksFor());
    const used = root.querySelectorAll<HTMLElement>('.player--self .skill-part--used');
    expect(used.length).toBe(1);
    expect(used[0].querySelector('.badge-used')).toBeNull();
    expect(used[0].textContent).not.toContain('已使用');
    expect(used[0].classList.contains('clickable')).toBe(false);
  });

  it('shows a game-over modal with the winner and a working restart button', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    state.phase = 'gameOver';
    state.winner = 'B';
    const onRestart = vi.fn();
    renderGame(state, root, { ...hooksFor(), onRestart });
    const modal = root.querySelector('.gameover-modal');
    expect(modal).not.toBeNull();
    expect(modal!.textContent).toContain('玩家B');
    expect(modal!.textContent).toContain('获胜');
    const btn = root.querySelector<HTMLButtonElement>('.gameover-restart');
    expect(btn).not.toBeNull();
    btn!.click();
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('colors dice by owner class (die-A / die-B)', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    renderGame(state, root, hooksFor());
    const dice = root.querySelectorAll('.die');
    expect(dice.length).toBe(15);
    for (const d of Array.from(dice)) {
      expect(d.classList.contains('die-A') !== d.classList.contains('die-B')).toBe(true);
    }
    expect(root.querySelectorAll('.player--self .die.die-A').length).toBe(7); // A will 7
    expect(root.querySelectorAll('.player--enemy .die.die-B').length).toBe(8); // B will 8
  });

  it('shows the defender as the acting player while an attack is pending (colored)', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // -> main
    state.players.A.areas.attack.push({ id: 'atk', value: 5, kind: 'attack' });
    applyAction(state, { t: 'attack', costSlots: [{ dieIds: ['atk'] }] });
    renderGame(state, root, hooksFor());
    const turn = root.querySelector('.hint-turn')!;
    expect(turn.textContent).toContain('玩家B'); // 轮到防御方
    expect(turn.querySelector('.player-B')).not.toBeNull(); // 玩家名按颜色类标出
    expect(root.querySelector('.hint .hint-phase')).not.toBeNull(); // 提示在同一行
  });

  it('renders the card art image for each artifact', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    const imgs = root.querySelectorAll<HTMLImageElement>('img.card-art-img');
    expect(imgs.length).toBe(6);
    const srcs = Array.from(imgs).map((i) => i.getAttribute('src'));
    expect(srcs).toContain('/cards/001.jpg');
    expect(srcs).toContain('/cards/006.jpg');
  });

  it('opens the 007 chooser with an option step and completes 震荡斩击 with explicit params', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['007', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // -> main
    state.players.A.artifacts.find((a) => a.id === '007')!.activeMarkerSide = 'right';
    state.players.A.areas.attack = [
      { id: 'c1', value: 2, kind: 'attack' },
      { id: 'c2', value: 3, kind: 'attack' },
      { id: 'c3', value: 4, kind: 'attack' },
      { id: 'c4', value: 5, kind: 'attack' },
    ];
    state.players.B.areas.attack = [
      { id: 'o1', value: 1, kind: 'attack' },
      { id: 'o2', value: 1, kind: 'attack' },
    ];

    const { ui, onAction } = mount(state, root);

    const box = root.querySelector<HTMLElement>(
      '.player--self .card[data-artifact="007"] .skill-part[data-side="right"].clickable',
    );
    expect(box).not.toBeNull();
    box!.click();
    expect(onAction).not.toHaveBeenCalled();
    expect(ui.selection).not.toBeNull();
    expect(ui.selection!.key).toBe('zhuzai.smash');
    expect(root.querySelector('.selector')).not.toBeNull();

    // step 1: option
    const optBtn = root.querySelector<HTMLButtonElement>('.option-btn[data-option="attack"]');
    expect(optBtn).not.toBeNull();
    optBtn!.click();
    const ok1 = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
      (b) => b.textContent === '确认',
    )!;
    expect(ok1.disabled).toBe(false);
    ok1.click();

    // step 2: pick 4 own attack dice
    for (const id of ['c1', 'c2', 'c3', 'c4']) {
      const d = root.querySelector<HTMLElement>(`.player--self .die[data-id="${id}"]`)!;
      expect(d).not.toBeNull();
      d.click();
    }
    const ok2 = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
      (b) => b.textContent === '确认',
    )!;
    expect(ok2.disabled).toBe(false);
    ok2.click();

    // step 3: pick opponent attack dice (0-4); choose one
    const od = root.querySelector<HTMLElement>('.player--enemy .die[data-id="o1"]')!;
    expect(od).not.toBeNull();
    od.click();
    const ok3 = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
      (b) => b.textContent === '确认',
    )!;
    ok3.click();

    expect(onAction).not.toHaveBeenCalled();
    expect(ui.pendingConfirm).not.toBeNull();
    expect(ui.pendingConfirm!.action).toEqual({
      t: 'skill',
      artifactId: '007',
      side: 'right',
      params: {
        kind: 'attack',
        costSlots: [{ dieIds: ['c1'] }, { dieIds: ['c2'] }, { dieIds: ['c3'] }, { dieIds: ['c4'] }],
        opponentDiscardIds: ['o1'],
      },
    });
  });

  it('opens the 008 王家之拳 chooser and proposes explicit meditation/defense params', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '008', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // -> main
    state.players.A.artifacts.find((a) => a.id === '008')!.activeMarkerSide = 'right';
    state.players.A.areas = {
      attack: [],
      defense: [
        { id: 'd1', value: 1, kind: 'defense' },
        { id: 'd2', value: 6, kind: 'defense' },
      ],
      meditation: [
        { id: 'm1', value: 3, kind: 'meditation' },
        { id: 'm2', value: 4, kind: 'meditation' },
      ],
    };

    const { ui, onAction } = mount(state, root);

    const box = root.querySelector<HTMLElement>(
      '.player--self .card[data-artifact="008"] .skill-part[data-side="right"].clickable',
    );
    expect(box).not.toBeNull();
    box!.click();
    expect(onAction).not.toHaveBeenCalled();
    expect(ui.selection).not.toBeNull();
    expect(ui.selection!.key).toBe('tiebi.fist');
    expect(root.querySelector('.selector')).not.toBeNull();

    // step 1: pick exactly 2 meditation dice
    for (const id of ['m1', 'm2']) {
      root.querySelector<HTMLElement>(`.player--self .die[data-id="${id}"]`)!.click();
    }
    let ok = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
      (b) => b.textContent === '确认',
    )!;
    expect(ok.disabled).toBe(false);
    ok.click();

    // step 2: pick the 2 defense dice to discard
    for (const id of ['d1', 'd2']) {
      root.querySelector<HTMLElement>(`.player--self .die[data-id="${id}"]`)!.click();
    }
    ok = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
      (b) => b.textContent === '确认',
    )!;
    expect(ok.disabled).toBe(false);
    ok.click();

    expect(onAction).not.toHaveBeenCalled();
    expect(ui.pendingConfirm).not.toBeNull();
    expect(ui.pendingConfirm!.action).toEqual({
      t: 'skill',
      artifactId: '008',
      side: 'right',
      params: { costSlots: [{ dieIds: ['m1'] }, { dieIds: ['m2'] }], defenseDieIds: ['d1', 'd2'] },
    });
  });

  it('renders the 009 高塔铁幕 charge prompt with one button per opponent attack die', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '009'] });
    skipInitialReroll(state);
    state.players.A.areas.meditation.push({ id: 'mm', value: 2, kind: 'meditation' });
    state.players.B.areas.attack = [
      { id: 'oa1', value: 5, kind: 'attack' },
      { id: 'oa2', value: 3, kind: 'attack' },
    ];
    applyAction(state, { t: 'dustRise', artifactId: '009', costSlots: [{ dieIds: ['mm'] }] });
    expect(state.pending!.kind).toBe('guwangCharge');

    renderGame(state, root, hooksFor());
    expect(root.querySelector('.hint-phase')?.textContent).toContain('高塔铁幕');
    // 骰子选项统一用骰片（攻5 / 攻3），「不变更」保持文字按钮
    const plain = root.querySelectorAll<HTMLButtonElement>('.actionlist .btn[data-act="guwangCharge"]');
    expect(plain.length).toBe(1);
    expect(plain[0].textContent).toBe('不变更');
    const chips = Array.from(
      root.querySelectorAll<HTMLButtonElement>('.actionlist-chips .pay-die[data-act="guwangCharge"]'),
    ).map((c) => c.textContent);
    expect(chips).toContain('攻5');
    expect(chips).toContain('攻3');
    expect(state.pending!.kind).toBe('guwangCharge'); // 渲染不应改变状态
  });

  it('骰片行的后缀括号只出现一次且位于整行末尾（多颗候选骰合并成一行）', () => {
    // 009 高塔铁幕：A 有 2 颗防御骰 → 「取消（消耗 [防…][防…]）」应只有 1 个右括号且在末尾
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '009'] });
    skipInitialReroll(state);
    const gw = state.players.A.artifacts.find((a) => a.id === '009')!;
    gw.activeMarkerSide = 'left';
    state.players.A.areas.defense = [
      { id: 'gd1', value: 4, kind: 'defense' },
      { id: 'gd2', value: 2, kind: 'defense' },
      { id: 'gd3', value: 6, kind: 'defense' },
    ];
    dealTrueDamage(state, 'A', 6, 'B');
    renderGame(state, root, hooksFor());
    const row = root.querySelector<HTMLElement>('.actionlist-chips')!;
    const txt = row.textContent ?? '';
    expect(txt).toContain('发动「高塔铁幕」取消（消耗');
    expect(txt.split('）').length - 1).toBe(1); // 右括号恰好 1 个
    expect(txt.endsWith('）')).toBe(true); // 且位于末尾
    expect(row.lastElementChild!.textContent).toBe('）'); // 末尾节点就是后缀
    expect(row.querySelectorAll('.pay-die[data-act="guwangCancel"]').length).toBe(3);
  });

  it('渲染 009 高塔铁幕 触发提示（取消 / 承受伤害）', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '009'] });
    skipInitialReroll(state);
    const gw = state.players.A.artifacts.find((a) => a.id === '009')!;
    gw.activeMarkerSide = 'left';
    state.players.A.areas.defense = [{ id: 'gd1', value: 4, kind: 'defense' }];
    dealTrueDamage(state, 'A', 6, 'B');
    expect(state.pending!.kind).toBe('guwangCancel');

    renderGame(state, root, hooksFor());
    expect(root.querySelector('.hint-phase')?.textContent).toContain('高塔铁幕');
    // 「承受伤害」文字按钮 + 「取消（消耗 防4）」骰片行
    const take = root.querySelector<HTMLButtonElement>('.actionlist .btn[data-act="guwangCancel"]');
    expect(take!.textContent).toBe('不发动「高塔铁幕」');
    const row = root.querySelector<HTMLElement>('.actionlist-chips')!;
    expect(row.textContent).toContain('发动「高塔铁幕」取消（消耗');
    expect(row.textContent!.endsWith('）')).toBe(true);
    expect(row.querySelector('.pay-die[data-act="guwangCancel"]')!.textContent).toBe('防4');
    expect(state.pending!.kind).toBe('guwangCancel'); // 渲染不应改变状态
  });

  it('renders the 010 深红 杀意 prompt with accept / decline buttons', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['010', '002', '003'] });
    skipInitialReroll(state);
    state.players.A.artifacts.find((a) => a.id === '010')!.activeMarkerSide = 'right';
    state.players.A.areas = {
      attack: [
        { id: 'a1', value: 2, kind: 'attack' },
        { id: 'a2', value: 3, kind: 'attack' },
        { id: 'a3', value: 4, kind: 'attack' },
      ],
      defense: [
        { id: 'd1', value: 1, kind: 'defense' },
        { id: 'd2', value: 6, kind: 'defense' },
      ],
      meditation: [{ id: 'm1', value: 5, kind: 'meditation' }],
    };
    state.firstRound.A = false;
    beginTurn(state);
    expect(state.pending!.kind).toBe('shenhongKill');

    renderGame(state, root, hooksFor());
    expect(root.querySelector('.hint-phase')?.textContent).toContain('杀意');
    const btns = root.querySelectorAll<HTMLButtonElement>('.actionlist .btn[data-act="shenhongKill"]');
    expect(btns.length).toBe(2);
    const labels = Array.from(btns).map((b) => b.textContent);
    expect(labels).toContain('发动「杀意」（3 真伤 + 回2）');
    expect(labels).toContain('不发动「杀意」');
    expect(state.pending!.kind).toBe('shenhongKill'); // 渲染不应改变状态
  });

  it('opens the 011 灵能屏障 chooser and proposes explicit defense dice params', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['011', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // -> main
    state.players.A.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'left';
    state.players.A.areas = {
      attack: [],
      defense: [
        { id: 'd1', value: 1, kind: 'defense' },
        { id: 'd2', value: 6, kind: 'defense' },
        { id: 'd3', value: 1, kind: 'defense' },
      ],
      meditation: [],
    };

    const { ui, onAction } = mount(state, root);

    const box = root.querySelector<HTMLElement>(
      '.player--self .card[data-artifact="011"] .skill-part[data-side="left"].clickable',
    );
    expect(box).not.toBeNull();
    box!.click();
    expect(onAction).not.toHaveBeenCalled();
    expect(ui.selection).not.toBeNull();
    expect(ui.selection!.key).toBe('dunwu.barrier.activate');
    expect(root.querySelector('.selector')).not.toBeNull();

    for (const id of ['d1', 'd2']) {
      root.querySelector<HTMLElement>(`.player--self .die[data-id="${id}"]`)!.click();
    }
    const ok = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
      (b) => b.textContent === '确认',
    )!;
    expect(ok.disabled).toBe(false);
    ok.click();

    expect(onAction).not.toHaveBeenCalled();
    expect(ui.pendingConfirm).not.toBeNull();
    expect(ui.pendingConfirm!.action).toEqual({
      t: 'skill',
      artifactId: '011',
      side: 'left',
      params: { costSlots: [{ dieIds: ['d1'] }, { dieIds: ['d2'] }] },
    });
  });

  it('opens the 011 灵能脉冲 chooser and proposes explicit attack dice params', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['011', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // -> main
    state.players.A.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'right';
    state.players.A.areas = {
      attack: [
        { id: 'a1', value: 2, kind: 'attack' },
        { id: 'a2', value: 4, kind: 'attack' },
        { id: 'a3', value: 2, kind: 'attack' },
      ],
      defense: [],
      meditation: [],
    };

    const { ui, onAction } = mount(state, root);

    const box = root.querySelector<HTMLElement>(
      '.player--self .card[data-artifact="011"] .skill-part[data-side="right"].clickable',
    );
    expect(box).not.toBeNull();
    box!.click();
    expect(onAction).not.toHaveBeenCalled();
    expect(ui.selection).not.toBeNull();
    expect(ui.selection!.key).toBe('dunwu.pulse.activate');
    expect(root.querySelector('.selector')).not.toBeNull();

    for (const id of ['a1', 'a2', 'a3']) {
      root.querySelector<HTMLElement>(`.player--self .die[data-id="${id}"]`)!.click();
    }
    const ok = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
      (b) => b.textContent === '确认',
    )!;
    expect(ok.disabled).toBe(false);
    ok.click();

    expect(onAction).not.toHaveBeenCalled();
    expect(ui.pendingConfirm).not.toBeNull();
    expect(ui.pendingConfirm!.action).toEqual({
      t: 'skill',
      artifactId: '011',
      side: 'right',
      params: { costSlots: [{ dieIds: ['a1'] }, { dieIds: ['a2'] }, { dieIds: ['a3'] }] },
    });
  });

  it('灵能屏障 骰片行：多颗冥想骰时括号只出现一次且在末尾', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroB: ['011', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // A -> main
    state.players.B.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'left';
    state.players.B.areas.meditation = [
      { id: 'bm1', value: 3, kind: 'meditation' },
      { id: 'bm2', value: 2, kind: 'meditation' },
      { id: 'bm3', value: 6, kind: 'meditation' },
    ];
    state.players.A.areas.attack = [{ id: 'atk', value: 5, kind: 'attack' }];
    applyAction(state, { t: 'attack', costSlots: [{ dieIds: ['atk'] }] });
    expect(state.pending!.kind).toBe('dunwuHalve');

    renderGame(state, root, hooksFor());
    const row = root.querySelector<HTMLElement>('.actionlist-chips')!;
    const txt = row.textContent ?? '';
    expect(txt.startsWith('发动「灵能屏障」伤害减半（消耗')).toBe(true);
    expect(txt.split('）').length - 1).toBe(1); // 右括号恰好 1 个
    expect(txt.endsWith('）')).toBe(true); // 且在整行末尾
    expect(row.lastElementChild!.textContent).toBe('）');
    expect(row.querySelectorAll('.pay-die[data-act="dunwuHalve"]').length).toBe(3);
  });

  it('renders the 011 灵能屏障 触发 prompt with halve / decline buttons', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroB: ['011', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // A -> main
    state.players.B.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'left';
    state.players.B.areas.meditation = [{ id: 'bm1', value: 3, kind: 'meditation' }];
    state.players.A.areas.attack = [{ id: 'atk', value: 5, kind: 'attack' }];
    applyAction(state, { t: 'attack', costSlots: [{ dieIds: ['atk'] }] });
    expect(state.pending!.kind).toBe('dunwuHalve');

    renderGame(state, root, hooksFor());
    expect(root.querySelector('.hint-phase')?.textContent).toContain('灵能屏障');
    // 「不减半」文字按钮 + 「伤害减半（消耗 冥3）」骰片行
    const decline = root.querySelector<HTMLButtonElement>('.actionlist .btn[data-act="dunwuHalve"]');
    expect(decline!.textContent).toBe('不发动「灵能屏障」');
    const halveRow = root.querySelector<HTMLElement>('.actionlist-chips')!;
    expect(halveRow.textContent).toContain('发动「灵能屏障」伤害减半（消耗');
    expect(halveRow.querySelector('.pay-die[data-act="dunwuHalve"]')!.textContent).toBe('冥3');
    expect(state.pending!.kind).toBe('dunwuHalve'); // 渲染不应改变状态
  });

  it('renders the 011 灵能脉冲 触发 prompt with activate / decline buttons', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    state.pending = { kind: 'dunwuPulse', player: 'A', amount: 2 };

    renderGame(state, root, hooksFor());
    expect(root.querySelector('.hint-phase')?.textContent).toContain('灵能脉冲');
    const btns = root.querySelectorAll<HTMLButtonElement>('.actionlist .btn[data-act="dunwuPulse"]');
    expect(btns.length).toBe(2);
    const labels = Array.from(btns).map((b) => b.textContent);
    expect(labels).toContain('发动「灵能脉冲」（2 点真实伤害）');
    expect(labels).toContain('不发动「灵能脉冲」');
    expect(state.pending!.kind).toBe('dunwuPulse'); // 渲染不应改变状态
  });

  it('锋芒: opens a selection panel instead of enumerating 攻×冥 combos', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' });
    state.players.A.artifacts.find((a) => a.id === '004')!.activeMarkerSide = 'right';
    state.players.A.areas.attack = [
      { id: 'a1', value: 5, kind: 'attack' },
      { id: 'a2', value: 3, kind: 'attack' },
    ];
    state.players.A.areas.meditation = [{ id: 'mm', value: 2, kind: 'meditation' }];
    state.players.B.areas.defense = [{ id: 'd1', value: 3, kind: 'defense' }];
    applyAction(state, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    applyAction(state, { t: 'block', costSlots: [{ dieIds: ['d1'] }] });
    expect(state.pending!.kind).toBe('fengmang');

    const { ui, onAction } = mount(state, root);
    // 不再逐条枚举「攻×冥」组合
    const combos = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).filter(
      (b) => (b.textContent ?? '').includes('发动（消耗'),
    );
    expect(combos.length).toBe(0);
    const open = root.querySelector<HTMLButtonElement>('.actionlist .btn[data-act="fengmangOpen"]')!;
    expect(open.textContent).toBe('发动「锋芒」');
    expect(root.querySelector('.actionlist .btn[data-act="fengmang"]')).not.toBeNull(); // 不发动

    open.click();
    expect(ui.fengmangPick).not.toBeNull();
    const chips = Array.from(root.querySelectorAll<HTMLElement>('.convertpick .pay-die')).map(
      (c) => c.textContent,
    );
    expect(chips).toEqual(['攻3', '冥2']);

    root.querySelector<HTMLElement>('.convertpick .pay-die[data-id="a2"]')!.click();
    root.querySelector<HTMLElement>('.convertpick .pay-die[data-id="mm"]')!.click();
    const ok = root.querySelector<HTMLButtonElement>('.convertpick .btn-confirm')!;
    expect(ok.disabled).toBe(false);
    ok.click();

    expect(ui.fengmangPick).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
    expect(ui.pendingConfirm!.action).toEqual({
      t: 'fengmang',
      accept: true,
      attackDieId: 'a2',
      meditationDieId: 'mm',
    });
  });

  it('chooser dice step shows chips mirroring the area dice (dual entry)', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' });
    state.players.A.artifacts.find((a) => a.id === '004')!.activeMarkerSide = 'left';
    state.players.A.areas.attack = [{ id: 'atk-test', value: 3, kind: 'attack' }];

    const { ui } = mount(state, root);
    const openBtn = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).find((b) =>
      (b.textContent ?? '').includes('淬炼'),
    )!;
    openBtn.click();

    const chip = root.querySelector<HTMLElement>('.selector .pay-die[data-id="atk-test"]')!;
    expect(chip.textContent).toBe('攻3');
    chip.click();
    expect(ui.selection!.currentSel.has('atk-test')).toBe(true);
    expect(
      root.querySelector('.player--self .die[data-id="atk-test"]')!.classList.contains('selected'),
    ).toBe(true);

    // 再从骰区点同一颗 → 取消（两个入口共享同一状态）
    root.querySelector<HTMLElement>('.player--self .die[data-id="atk-test"]')!.click();
    expect(ui.selection!.currentSel.has('atk-test')).toBe(false);
  });

  it('置换攻击 picker also allows clicking the area dice (dual entry)', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['010', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' });
    state.players.A.artifacts.find((a) => a.id === '010')!.activeMarkerSide = 'left';
    state.players.A.areas = {
      attack: [],
      defense: [{ id: 'pd1', value: 2, kind: 'defense' }],
      meditation: [{ id: 'pm1', value: 3, kind: 'meditation' }],
    };

    const { ui } = mount(state, root);
    const openBtn = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).find((b) =>
      (b.textContent ?? '').includes('使用「真实之剑」置换进行攻击'),
    )!;
    openBtn.click();
    expect(ui.convertPick).not.toBeNull();

    const areaDie = root.querySelector<HTMLElement>('.player--self .die[data-id="pd1"]')!;
    expect(areaDie.classList.contains('clickable')).toBe(true);
    areaDie.click();
    expect(
      root.querySelector('.player--self .die[data-id="pd1"]')!.classList.contains('selected'),
    ).toBe(true);
    expect(
      root.querySelector('.convertpick .pay-die[data-id="pd1"]')!.classList.contains('selected'),
    ).toBe(true);

    root.querySelector<HTMLElement>('.player--self .die[data-id="pm1"]')!.click();
    expect(ui.convertPick).toBeNull();
    expect(ui.pendingConfirm!.action).toEqual({
      t: 'attack',
      costSlots: [{ dieIds: ['pd1', 'pm1'] }],
    });
  });

  it('opens the 012 梦醒时分 chooser and proposes explicit destination + meditation dice params', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['012', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // -> main
    state.players.A.artifacts.find((a) => a.id === '012')!.activeMarkerSide = 'left';
    state.players.A.areas = {
      attack: [],
      defense: [],
      meditation: [
        { id: 'm1', value: 2, kind: 'meditation' },
        { id: 'm2', value: 5, kind: 'meditation' },
        { id: 'm3', value: 3, kind: 'meditation' },
        { id: 'm4', value: 6, kind: 'meditation' },
      ],
    };

    const { ui, onAction } = mount(state, root);

    const box = root.querySelector<HTMLElement>(
      '.player--self .card[data-artifact="012"] .skill-part[data-side="only"].clickable',
    );
    expect(box).not.toBeNull();
    box!.click();
    expect(onAction).not.toHaveBeenCalled();
    expect(ui.selection).not.toBeNull();
    expect(ui.selection!.key).toBe('monv.ultimate');
    expect(root.querySelector('.selector')).not.toBeNull();

    const defenseOption = root.querySelector<HTMLElement>('.selector .option-btn[data-option="defense"]');
    expect(defenseOption).not.toBeNull();
    defenseOption!.click();
    const okOption = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
      (b) => b.textContent === '确认',
    )!;
    expect(okOption.disabled).toBe(false);
    okOption.click();

    for (const id of ['m1', 'm2']) {
      root.querySelector<HTMLElement>(`.player--self .die[data-id="${id}"]`)!.click();
    }
    const ok = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
      (b) => b.textContent === '确认',
    )!;
    expect(ok.disabled).toBe(false);
    ok.click();

    expect(onAction).not.toHaveBeenCalled();
    expect(ui.pendingConfirm).not.toBeNull();
    expect(ui.pendingConfirm!.action).toEqual({
      t: 'skill',
      artifactId: '012',
      side: 'only',
      params: { to: 'defense', meditationDieIds: ['m1', 'm2'] },
    });
  });

  it('offers 置换攻击 when 真实之剑 is active: pick 2 dice then confirm', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['010', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    state.players.A.artifacts.find((a) => a.id === '010')!.activeMarkerSide = 'left';
    state.players.A.areas = {
      attack: [],
      defense: [{ id: 'pd1', value: 2, kind: 'defense' }],
      meditation: [{ id: 'pm1', value: 3, kind: 'meditation' }],
    };

    const { ui, onAction } = mount(state, root);

    const openBtn = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).find(
      (b) => (b.textContent ?? '').includes('使用「真实之剑」置换进行攻击'),
    );
    expect(openBtn).toBeTruthy();
    openBtn!.click();
    expect(onAction).not.toHaveBeenCalled();
    expect(ui.convertPick).not.toBeNull();
    expect(root.querySelector('.convertpick')).not.toBeNull();

    // 单步：直接选 2 颗能力骰（无 4换2 / 6换3 之类）
    root.querySelector<HTMLElement>('.convertpick .pay-die[data-id="pd1"]')!.click();
    root.querySelector<HTMLElement>('.convertpick .pay-die[data-id="pm1"]')!.click();

    // 选满 2 颗 → 走统一确认条（不直接执行）
    expect(ui.convertPick).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
    expect(ui.pendingConfirm).not.toBeNull();
    expect(ui.pendingConfirm!.action).toEqual({
      t: 'attack',
      costSlots: [{ dieIds: ['pd1', 'pm1'] }],
    });
    expect(ui.pendingConfirm!.label).toContain('置换攻击');

    const confirmBtn = root.querySelector<HTMLButtonElement>('.confirm-row .btn-confirm')!;
    confirmBtn.click();
    expect(onAction).toHaveBeenCalledWith({
      t: 'attack',
      costSlots: [{ dieIds: ['pd1', 'pm1'] }],
    });
  });

  it('re-opens the 置换攻击 picker on each click (one conversion per click)', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['010', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' });
    state.players.A.artifacts.find((a) => a.id === '010')!.activeMarkerSide = 'left';
    state.players.A.areas = {
      attack: [],
      defense: [
        { id: 'pd1', value: 2, kind: 'defense' },
        { id: 'pd2', value: 4, kind: 'defense' },
      ],
      meditation: [
        { id: 'pm1', value: 3, kind: 'meditation' },
        { id: 'pm2', value: 5, kind: 'meditation' },
      ],
    };
    const { ui } = mount(state, root);
    const findBtn = () =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).find((b) =>
        (b.textContent ?? '').includes('使用「真实之剑」置换进行攻击'),
      );

    findBtn()!.click();
    expect(ui.convertPick).not.toBeNull();
    root.querySelector<HTMLButtonElement>('.convertpick .btn-cancel')!.click();
    expect(ui.convertPick).toBeNull();

    // 同一入口可再次点击 = 第二次置换攻击
    expect(findBtn()).toBeTruthy();
    findBtn()!.click();
    expect(ui.convertPick).not.toBeNull();
  });

  it('does not offer 置换攻击 when 真实之剑 is not active', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['010', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    state.players.A.areas = {
      attack: [],
      defense: [{ id: 'pd1', value: 2, kind: 'defense' }],
      meditation: [{ id: 'pm1', value: 3, kind: 'meditation' }],
    };

    renderGame(state, root, hooksFor());
    const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).find(
      (b) => (b.textContent ?? '').includes('使用「真实之剑」置换进行攻击'),
    );
    expect(btn).toBeUndefined();
  });

  it('cancels the 置换支付 panel without dispatching', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['010', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    state.players.A.artifacts.find((a) => a.id === '010')!.activeMarkerSide = 'left';
    state.players.A.areas = {
      attack: [],
      defense: [{ id: 'pd1', value: 2, kind: 'defense' }],
      meditation: [{ id: 'pm1', value: 3, kind: 'meditation' }],
    };

    const { ui, onAction } = mount(state, root);

    const openBtn = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).find(
      (b) => (b.textContent ?? '').includes('使用「真实之剑」置换进行攻击'),
    )!;
    openBtn.click();
    expect(ui.convertPick).not.toBeNull();

    root.querySelector<HTMLButtonElement>('.convertpick .btn-cancel')!.click();
    expect(ui.convertPick).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('offers 3 slots even with only 2 attack dice: 灵能脉冲 + 真实之剑 (N=3, M=1)', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['010', '011', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    state.players.A.artifacts.find((a) => a.id === '010')!.activeMarkerSide = 'left'; // 真实之剑
    state.players.A.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'right'; // 灵能脉冲
    state.players.A.areas = {
      attack: [
        { id: 'atk1', value: 2, kind: 'attack' },
        { id: 'atk2', value: 3, kind: 'attack' },
      ],
      defense: [{ id: 'def1', value: 4, kind: 'defense' }],
      meditation: [
        { id: 'med1', value: 5, kind: 'meditation' },
        { id: 'med2', value: 6, kind: 'meditation' },
      ],
    };

    const { ui, onAction } = mount(state, root);
    const numberBtn = (label: string) =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .number-btn')).find(
        (b) => b.textContent === label,
      );
    const okBtn = () =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
        (b) => b.textContent === '确认',
      )!;
    const clickDie = (id: string) =>
      root.querySelector<HTMLElement>(`.player--self .die[data-id="${id}"]`)!.click();

    root
      .querySelector<HTMLElement>(
        '.player--self .card[data-artifact="011"] .skill-part[data-side="right"].clickable',
      )!
      .click();
    expect(ui.selection!.key).toBe('dunwu.pulse.activate');

    // ① 结算数量：应提供 1/2/3（不再被「只有 2 颗攻击骰」限制为 2 格）
    expect(numberBtn('1 颗')).toBeTruthy();
    expect(numberBtn('2 颗')).toBeTruthy();
    expect(numberBtn('3 颗')).toBeTruthy();
    numberBtn('3 颗')!.click();
    okBtn().click();

    // ② 置换数量：N=3 时 0 颗不可行（只有 2 颗真实攻击骰），只能置换 1–2 颗
    expect(numberBtn('不置换')).toBeUndefined();
    expect(numberBtn('置换 1 颗')).toBeTruthy();
    expect(numberBtn('置换 2 颗')).toBeTruthy();
    numberBtn('置换 1 颗')!.click();
    okBtn().click();

    // ③ 真实攻击骰：N−M = 2 颗
    clickDie('atk1');
    clickDie('atk2');
    okBtn().click();

    // ④ 置换用的任意骰：2M = 2 颗（不含已作真实骰的 atk1/atk2）
    clickDie('def1');
    clickDie('med1');
    okBtn().click();

    expect(onAction).not.toHaveBeenCalled();
    expect(ui.pendingConfirm).not.toBeNull();
    expect(ui.pendingConfirm!.label).toBe(
      '发动「灵能脉冲」：消耗 3 颗攻击骰（2/3/5点），其中 1 颗攻击骰是用「真实之剑」置换',
    );
    expect(ui.pendingConfirm!.action).toEqual({
      t: 'skill',
      artifactId: '011',
      side: 'right',
      params: {
        costSlots: [{ dieIds: ['atk1'] }, { dieIds: ['atk2'] }, { dieIds: ['def1', 'med1'] }],
      },
    });
  });

  it('shows the active skill name in the card badge (已激活·技能名)', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['010', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' });
    state.players.A.artifacts.find((a) => a.id === '010')!.activeMarkerSide = 'left';
    renderGame(state, root, hooksFor());
    const badge = root.querySelector<HTMLElement>(
      '.player--self .card[data-artifact="010"] .badge-active',
    )!;
    expect(badge.textContent).toBe('已激活·真实之剑');

    // 第三列（技能在 only 侧）显示对应技能名，而非「左侧」
    const state2 = createGame({ seed: 1, firstPlayer: 'A', heroA: ['006', '002', '003'] });
    skipInitialReroll(state2);
    applyAction(state2, { t: 'advance' });
    const wansha = state2.players.A.artifacts.find((a) => a.id === '006')!;
    wansha.chargeLayer = wansha.chargeReq ?? 4;
    wansha.activeMarkerSide = 'left';
    renderGame(state2, root, hooksFor());
    const badge2 = root.querySelector<HTMLElement>(
      '.player--self .card[data-artifact="006"] .badge-active',
    )!;
    expect(badge2.textContent).toBe('已激活·零时枭首');
  });

  it('shows the kind prefix on attack/block chips (攻N / 防N)', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' });
    renderGame(state, root, hooksFor());
    const chip = root.querySelector<HTMLButtonElement>(
      '.actionlist-chips .pay-die[data-act="attack"]',
    )!;
    expect(chip.textContent).toMatch(/^攻\d$/);
  });

  it('uses the normal all-real dice step for a skill cost when 真实之剑 is inactive', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['010', '011', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    state.players.A.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'left'; // 灵能屏障（010 未激活）
    state.players.A.areas = {
      attack: [
        { id: 'na1', value: 2, kind: 'attack' },
        { id: 'na2', value: 3, kind: 'attack' },
      ],
      defense: [{ id: 'nd1', value: 4, kind: 'defense' }],
      meditation: [],
    };

    const { ui, onAction } = mount(state, root);

    const box = root.querySelector<HTMLElement>(
      '.player--self .card[data-artifact="011"] .skill-part[data-side="left"].clickable',
    );
    expect(box).not.toBeNull();
    box!.click();
    expect(ui.selection).not.toBeNull();
    // 未激活 010：仍是普通选骰步骤，没有 slots 面板
    expect(root.querySelector('.selector .paypanel--slots')).toBeNull();

    root.querySelector<HTMLElement>('.player--self .die[data-id="nd1"]')!.click();
    const ok = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
      (b) => b.textContent === '确认',
    )!;
    expect(ok.disabled).toBe(false);
    ok.click();

    expect(onAction).not.toHaveBeenCalled();
    expect(ui.pendingConfirm).not.toBeNull();
    expect(ui.pendingConfirm!.action).toEqual({
      t: 'skill',
      artifactId: '011',
      side: 'left',
      params: { costSlots: [{ dieIds: ['nd1'] }] },
    });
  });

  it('025 横贯（触发）：操作栏给出「不发动」+ 选择器，仅列点数严格小于该攻击的对方骰', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['025', '026', '027'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    state.pending = { kind: 'hengguan', player: 'A', value: 3 };
    state.players.B.areas.attack = [{ id: 'b1', value: 1, kind: 'attack' }];
    state.players.B.areas.defense = [{ id: 'b5', value: 5, kind: 'defense' }];
    state.players.B.areas.meditation = [];

    const { ui, onAction } = mount(state, root);
    const labels = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).map((b) => b.textContent);
    expect(labels.filter((l) => (l ?? '').includes('横贯'))).toEqual([
      '不发动「横贯」',
      '发动「横贯」（选择要弃置的能力骰）',
    ]);
    expect(root.querySelector('.hint-phase')!.textContent).toContain('横贯');

    root.querySelector<HTMLButtonElement>('.actionlist [data-act="hengguanOpen"]')!.click();
    expect(ui.selection?.pendingKind).toBe('hengguan');
    const chip = (id: string) => root.querySelector<HTMLElement>(`.selector .pay-die[data-id="${id}"]`);
    expect(chip('b1')!.classList.contains('clickable')).toBe(true);
    expect(chip('b5')!.classList.contains('clickable')).toBe(false); // 5 ≥ 3 不可弃置
    chip('b1')!.click();
    const ok = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) => b.textContent === '确认')!;
    expect(ok.disabled).toBe(false);
    ok.click();
    expect(onAction).toHaveBeenCalledWith({ t: 'hengguan', dieId: 'b1' });
  });

  it('025 横贯（触发）：不发动经确认条派发（无副作用路径）', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['025', '026', '027'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    state.pending = { kind: 'hengguan', player: 'A', value: 3 };
    state.players.B.areas.defense = [{ id: 'b1', value: 1, kind: 'defense' }];
    const { onAction } = mount(state, root);
    root.querySelector<HTMLButtonElement>('.actionlist .btn[data-act="hengguan"]')!.click();
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-confirm')!.click();
    expect(onAction).toHaveBeenCalledWith({ t: 'hengguan' });
  });

  it('026 威压：选择器可变更对方 1 颗能力骰为固定值，或「不发动」', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['025', '026', '027'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    state.pending = { kind: 'weiyaPick', player: 'A', value: 4, reason: 'attack' };
    state.players.A.areas.attack = [{ id: 'a1', value: 3, kind: 'attack' }];
    state.players.B.areas.defense = [{ id: 'bd', value: 1, kind: 'defense' }];

    const { ui, onAction } = mount(state, root);
    const labels = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).map((b) => b.textContent);
    expect(labels.filter((l) => (l ?? '').includes('威压'))).toEqual([
      '不发动「威压」',
      '发动「威压」（选择要变更的能力骰）',
    ]);
    expect(root.querySelector('.hint-phase')!.textContent).toContain('威压');

    root.querySelector<HTMLButtonElement>('.actionlist [data-act="weiyaOpen"]')!.click();
    expect(ui.selection?.pendingKind).toBe('weiyaPick');
    const btn = (t: string) =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) => (b.textContent ?? '').includes(t))!;
    btn('对方的能力骰').click();
    btn('确认').click();
    // 第二步：仅列对方能力骰
    expect(root.querySelector('.selector .pay-die[data-id="a1"]')).toBeNull();
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="bd"]')!.click();
    btn('确认').click();
    expect(onAction).toHaveBeenCalledWith({ t: 'weiyaPick', owner: 'opp', dieId: 'bd' });
  });

  it('026 陷阵：强制选择（无「不发动」），仅一个选择器入口', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['025', '026', '027'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    state.pending = { kind: 'xianzhenPick', player: 'A', owner: 'A' };
    state.players.A.areas.attack = [{ id: 'xa', value: 3, kind: 'attack' }];
    state.players.A.areas.defense = [];
    state.players.A.areas.meditation = [];

    const { ui, onAction } = mount(state, root);
    const labels = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).map((b) => b.textContent);
    expect(labels.some((l) => (l ?? '').includes('不发动'))).toBe(false);
    expect(labels.filter((l) => (l ?? '').includes('陷阵'))).toEqual(['「陷阵」：选择要弃置的能力骰']);
    expect(root.querySelector('.hint-phase')!.textContent).toContain('陷阵');

    root.querySelector<HTMLButtonElement>('.actionlist [data-act="xianzhenOpen"]')!.click();
    expect(ui.selection?.pendingKind).toBe('xianzhenPick');
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="xa"]')!.click();
    const ok = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) => b.textContent === '确认')!;
    expect(ok.disabled).toBe(false);
    ok.click();
    expect(onAction).toHaveBeenCalledWith({ t: 'xianzhenResolve', dieId: 'xa' });
  });

  it('027 寒光·必杀：卡片标题行显示纯点数骰片（无标签）；两步式走 ①移入', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['025', '026', '027'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    const card = state.players.A.artifacts.find((a) => a.id === '027')!;
    card.heldDice = [
      { id: 'h3', value: 3 },
      { id: 'h5', value: 5 },
    ];
    state.pending = { kind: 'hanguangPick', player: 'A', costSlots: [] };
    state.players.B.areas.attack = [];
    state.players.B.areas.defense = [{ id: 'bd3', value: 3, kind: 'defense' }];
    state.players.B.areas.meditation = [];

    const { ui, onAction } = mount(state, root);
    const selfCard = root.querySelector<HTMLElement>('.player--self .card[data-artifact="027"]')!;
    // 位置：在卡片标题行（.card-head）内，且带 --head 修饰类；**不再有标签**
    const head = selfCard.querySelector('.card-head')!;
    expect(head.querySelector('.card-held--head')).not.toBeNull();
    expect(selfCard.querySelector('.chip-label')).toBeNull();
    // 骰片：纯点数（无 ◆、无攻/防/冥前缀）
    const heldChips = Array.from(selfCard.querySelectorAll<HTMLElement>('.card-held--head .pay-die--held')).map((c) => c.textContent);
    expect(heldChips).toEqual(['3', '5']);
    expect(root.querySelector('.selector-title')!.textContent).toContain('凛冽之音');

    // 第一步：模式按钮（对方有 3 点 → ②可选）
    const moveMode = root.querySelector<HTMLButtonElement>('.selector [data-act="hanguangMode-move"]')!;
    const discMode = root.querySelector<HTMLButtonElement>('.selector [data-act="hanguangMode-discard"]')!;
    expect(moveMode).not.toBeNull();
    expect(discMode.disabled).toBe(false);
    // 未选模式：没有骰片可点
    expect(root.querySelector('.selector [data-act="hanguangDie"]')).toBeNull();

    // 选 ① → 出现骰片（纯点数）→ 选 h3 → 确认
    moveMode.click();
    const dieChips = Array.from(root.querySelectorAll<HTMLElement>('.selector [data-act="hanguangDie"]')).map((c) => c.textContent);
    expect(dieChips).toEqual(['3', '5']);
    root.querySelector<HTMLButtonElement>('.selector [data-act="hanguangDie"][data-id="h3"]')!.click();
    const commit = root.querySelector<HTMLButtonElement>('.selector [data-act="hanguangCommit"]')!;
    expect(commit).not.toBeNull();
    commit.click();
    expect(ui.pendingConfirm!.action).toEqual({ t: 'hanguangPick', pick: 'move', dieId: 'h3' });
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-confirm')!.click();
    expect(onAction).toHaveBeenCalledWith({ t: 'hanguangPick', pick: 'move', dieId: 'h3' });
  });

  it('027 寒光·必杀：② 路径 —— 选模式 → 选骰 → 选对方同点数骰 → 派发 discard', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['025', '026', '027'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    const card = state.players.A.artifacts.find((a) => a.id === '027')!;
    card.heldDice = [{ id: 'h3', value: 3 }];
    state.pending = { kind: 'hanguangPick', player: 'A', costSlots: [] };
    state.players.B.areas.attack = [];
    state.players.B.areas.defense = [{ id: 'bd3', value: 3, kind: 'defense' }];
    state.players.B.areas.meditation = [];

    const { ui, onAction } = mount(state, root);
    root.querySelector<HTMLButtonElement>('.selector [data-act="hanguangMode-discard"]')!.click();
    root.querySelector<HTMLButtonElement>('.selector [data-act="hanguangDie"][data-id="h3"]')!.click();
    const target = root.querySelector<HTMLButtonElement>('.selector [data-act="hanguangDiscard"][data-id="bd3"]')!;
    expect(target.textContent).toBe('防3');
    target.click();
    expect(ui.pendingConfirm!.action).toEqual({
      t: 'hanguangPick',
      pick: 'discard',
      dieId: 'h3',
      targetDieId: 'bd3',
    });
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-confirm')!.click();
    expect(onAction).toHaveBeenCalledWith({
      t: 'hanguangPick',
      pick: 'discard',
      dieId: 'h3',
      targetDieId: 'bd3',
    });
  });

  it('027 寒光·必杀：对方无同点数骰时 ② 置灰；卡面骰片可点且与面板共享选中状态（双入口）', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['025', '026', '027'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    const card = state.players.A.artifacts.find((a) => a.id === '027')!;
    card.heldDice = [{ id: 'h3', value: 3 }];
    state.pending = { kind: 'hanguangPick', player: 'A', costSlots: [] };
    state.players.B.areas.attack = [];
    state.players.B.areas.defense = [{ id: 'bd5', value: 5, kind: 'defense' }]; // 与 3 点不同 → ②不可用
    state.players.B.areas.meditation = [];

    const { ui } = mount(state, root);
    const discMode = root.querySelector<HTMLButtonElement>('.selector [data-act="hanguangMode-discard"]')!;
    expect(discMode.disabled).toBe(true);
    expect(discMode.title).toContain('对方没有');

    // 卡面骰片是可点的按钮（第二个入口）
    const cardChip = root.querySelector<HTMLButtonElement>(
      '.player--self .card[data-artifact="027"] .card-held .pay-die[data-id="h3"]',
    )!;
    expect(cardChip.tagName).toBe('BUTTON');
    cardChip.click();
    expect(ui.hanguangPick).toEqual({ mode: null, dieId: 'h3' }); // 未选模式也记住选中

    // 选 ① 后面板骰片应是「已选中」（共享同一状态）
    root.querySelector<HTMLButtonElement>('.selector [data-act="hanguangMode-move"]')!.click();
    const panelChip = root.querySelector<HTMLButtonElement>('.selector [data-act="hanguangDie"][data-id="h3"]')!;
    expect(panelChip.classList.contains('selected')).toBe(true);
    // 两个入口各一处，不做重复渲染
    expect(root.querySelectorAll('.pay-die--held[data-id="h3"]').length).toBe(2);
  });

  it('027 寒光·必杀：神器上没有骰子时不渲染该行（回合结束清空后即无）', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['025', '026', '027'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    state.players.A.artifacts.find((a) => a.id === '027')!.heldDice = [];
    mount(state, root);
    expect(root.querySelector('.player--self .card[data-artifact="027"] .card-held')).toBeNull();
  });

  it('025 奇袭：可视为攻击骰的能力骰在攻击行标注「→ 攻击」且样式区分（不重复）', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['025', '026', '027'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // -> main
    const card = state.players.A.artifacts.find((a) => a.id === '025')!;
    card.activeMarkerSide = 'left';
    card.armedSide = 'left';
    state.players.A.areas.attack = [];
    state.players.A.areas.defense = [{ id: 'd5', value: 5, kind: 'defense' }];
    state.players.A.areas.meditation = [];
    state.players.B.areas.attack = [];
    state.players.B.areas.defense = [];
    state.players.B.areas.meditation = [];

    renderGame(state, root, hooksFor());
    const treated = root.querySelectorAll<HTMLButtonElement>('.actionlist-chips .pay-die--treated');
    expect(treated.length).toBe(1);
    expect(treated[0].textContent).toBe('防5 → 攻击');
    expect(treated[0].dataset.treated).toBe('1');
    // 攻击动作只渲染一次（无真攻击骰时恰好 1 个骰片）
    expect(root.querySelectorAll('.actionlist-chips .pay-die[data-act="attack"]').length).toBe(1);
  });
});

describe('dust-rise 2-step flow', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
  });

  const dustState = (hero: [string, string, string] = ['001', '002', '003']) => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: hero });
    skipInitialReroll(state);
    if (state.players.A.areas.meditation.length === 0) {
      state.players.A.areas.meditation.push({ id: 'dm', value: 3, kind: 'meditation' });
    }
    return state;
  };

  const clickEntry = (label: string): void => {
    const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).find(
      (b) => b.textContent === label,
    );
    expect(btn, `entry ${label}`).toBeTruthy();
    btn!.click();
  };

  /** 打开尘起条目；若是「激活」则自动选左侧进入支付步骤 */
  const openPay = (label: string): void => {
    clickEntry(label);
    const side = root.querySelector<HTMLButtonElement>('.dustflow-side-btn[data-side="left"]');
    if (side) side.click();
  };

  it('shows one 激活「雨切」 entry, no ·左/·右 suffix, and no card-face dust buttons', () => {
    renderGame(dustState(), root, hooksFor());
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn'));
    expect(buttons.some((b) => b.textContent === '激活「雨切」')).toBe(true);
    expect(root.textContent ?? '').not.toContain('激活·');
    expect(root.querySelectorAll('.card-actions').length).toBe(0);
  });

  it('opens side step by skill name, then pay step, and dispatches on a meditation die', () => {
    const state = dustState();
    const med = state.players.A.areas.meditation[0];
    const { ui, onAction } = mount(state, root);

    clickEntry('激活「雨切」');
    expect(onAction).not.toHaveBeenCalled();
    expect(ui.dustFlow).not.toBeNull();
    expect(ui.dustFlow!.step).toBe('side');

    const sideBox = root.querySelector('.dustflow-side');
    expect(sideBox).not.toBeNull();
    expect(sideBox!.textContent ?? '').toContain('中央突破');
    expect(sideBox!.textContent ?? '').toContain('裁雨流');

    const leftBtn = root.querySelector<HTMLButtonElement>(
      '.dustflow-side-btn[data-side="left"]',
    )!;
    expect(leftBtn.textContent).toBe('中央突破');
    leftBtn.click();
    expect(ui.dustFlow!.step).toBe('pay');
    expect(ui.dustFlow!.side).toBe('left');

    const dieEl = root.querySelector<HTMLElement>(`.dustflow .pay-die[data-id="${med.id}"]`)!;
    expect(dieEl).not.toBeNull();
    expect(dieEl.classList.contains('die-A')).toBe(true);
    dieEl.click();
    expect(onAction).toHaveBeenCalledWith({
      t: 'dustRise',
      artifactId: '001',
      side: 'left',
      costSlots: [{ dieIds: [med.id] }],
    });
    expect(ui.dustFlow).toBeNull();
  });

  it('offers 使用尘印标记 only when the active player holds the seal', () => {
    mount(dustState(), root);
    openPay('激活「雨切」');
    expect(root.querySelector('.dustflow')!.textContent ?? '').not.toContain('使用尘印标记');

    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
    const state = dustState();
    state.players.A.hasDustSeal = true;
    mount(state, root);
    openPay('激活「雨切」');
    expect(root.querySelector('.dustflow')!.textContent ?? '').toContain('使用尘印标记');
  });

  it('offers 使用「真实之剑」置换能力骰 only when 010 真实之剑 is active', () => {
    mount(dustState(), root);
    openPay('激活「雨切」');
    expect(root.querySelector('.dustflow')!.textContent ?? '').not.toContain('真实之剑');

    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
    const state = dustState(['010', '002', '003']);
    state.players.A.artifacts.find((a) => a.id === '010')!.activeMarkerSide = 'left';
    mount(state, root);
    openPay('激活「游龙」');
    expect(root.querySelector('.dustflow')!.textContent ?? '').toContain(
      '使用「真实之剑」置换能力骰',
    );
  });

  it('labels a column-3 artifact 充能「明镜」 and skips the side step', () => {
    const { ui } = mount(dustState(), root);
    clickEntry('充能「明镜」');
    expect(ui.dustFlow).not.toBeNull();
    expect(ui.dustFlow!.step).toBe('pay');
    expect(ui.dustFlow!.kind).toBe('charge');
    expect(root.querySelector('.dustflow-side')).toBeNull();
    expect(root.querySelector('.dustflow-pay')).not.toBeNull();
  });
});

describe('战斗提示（.hint-notes）', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
  });

  const mainState = (heroA: [string, string, string]): GameState => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // -> main
    return state;
  };

  it('主要阶段且有条目时渲染独立一行，技能名带玩家配色', () => {
    const state = mainState(['004', '005', '006']);
    expect(state.phase).toBe('main');
    const card = state.players.A.artifacts.find((a) => a.id === '004')!;
    card.activeMarkerSide = 'right';
    card.count = 3;

    renderGame(state, root, hooksFor());
    const line = root.querySelector('.hint-notes');
    expect(line).not.toBeNull();
    const text = line!.textContent ?? '';
    expect(text.startsWith('攻击提示：')).toBe(true);
    expect(text).toContain('「锋芒」攻击伤害 +3');
    expect(line!.querySelector('.hint-skill.player-A')?.textContent).toBe('「锋芒」');
  });

  it('主要阶段但无条目时不渲染该行', () => {
    const state = mainState(['001', '002', '003']);
    expect(state.phase).toBe('main');
    renderGame(state, root, hooksFor());
    expect(root.querySelector('.hint-notes')).toBeNull();
  });

  it('非主要阶段不渲染该行', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '005', '006'] });
    skipInitialReroll(state);
    const card = state.players.A.artifacts.find((a) => a.id === '004')!;
    card.activeMarkerSide = 'right';
    card.count = 3;
    expect(state.phase).not.toBe('main');

    renderGame(state, root, hooksFor());
    expect(root.querySelector('.hint-notes')).toBeNull();
  });
});
describe('设置页背景类（setup-page）', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
  });

  it('渲染对局时移除设置页背景类（且不会自己加上）', () => {
    root.classList.add('setup-page');
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    expect(root.classList.contains('setup-page')).toBe(false);
  });
});
describe('026/027 归属与提示（用户反馈回归）', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
  });

  it('归属回归（截图场景）：B 持威压、B 攻击触发 → 提示必须是「轮到 玩家B 操作」', () => {
    const state = createGame({ seed: 1, firstPlayer: 'B', heroA: ['001', '002', '003'], heroB: ['025', '026', '027'] });
    skipInitialReroll(state);
    state.players.B.artifacts.find((a) => a.id === '026')!.activeMarkerSide = 'right'; // 威压（触发·右）
    state.phase = 'main';
    state.activePlayer = 'B';
    state.players.B.areas.attack = [{ id: 'ba', value: 3, kind: 'attack' }];
    state.players.B.areas.defense = [];
    state.players.B.areas.meditation = [];
    state.players.A.areas.attack = [];
    state.players.A.areas.defense = [{ id: 'ad', value: 5, kind: 'defense' }];
    state.players.A.areas.meditation = [];

    applyAction(state, { t: 'attack', costSlots: [{ dieIds: ['ba'] }] });
    // 攻击已生成 + 威压待决策同时存在（旧实现会把"操作者"算成被攻击方 A）
    expect(state.pendingAttack).not.toBeNull();
    expect(state.pending?.kind).toBe('weiyaPick');
    expect(state.pending && state.pending.kind === 'weiyaPick' ? state.pending.player : null).toBe('B');

    renderGame(state, root, hooksFor());
    const turn = root.querySelector('.hint-turn')!.textContent ?? '';
    expect(turn).toContain('玩家B');
    expect(turn).not.toContain('玩家A');
    // 提示里写明"谁的卡"
    expect(root.querySelector('.hint-phase')!.textContent).toContain('玩家B 的「哀歌」');
  });

  it('凛冽之音：惩罚生效时提示栏常驻、重掷按钮写明将受伤害', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['025', '026', '027'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    state.rerollPunish.A = true;
    state.phase = 'reroll';
    state.activePlayer = 'A';
    state.players.A.areas.attack = [
      { id: 'r1', value: 1, kind: 'attack' },
      { id: 'r2', value: 2, kind: 'attack' },
    ];
    const hooks = hooksFor();
    hooks.ui.rerollSelected.add('r1');
    hooks.ui.rerollSelected.add('r2');
    renderGame(state, root, hooks);
    expect(root.querySelector('.hint-global')!.textContent).toBe(
      '玩家A「凛冽之音」生效中——任何玩家重掷能力骰后，被重掷方受到等量真实伤害',
    );
    const btn = root.querySelector<HTMLButtonElement>('.btn-reroll')!;
    expect(btn.textContent).toContain('将受 2 点真实伤害');
    btn.click();
    expect(hooks.ui.pendingConfirm!.label).toBe('重掷 2 颗（「凛冽之音」：将受 2 点真实伤害）');
  });

  it('A07 历王之血之印：生效期提示栏常驻 + 双方持续技能行/激活徽标转灰', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', 'A07'], heroB: ['004', '005', '006'] });
    skipInitialReroll(state);
    state.phase = 'main';
    state.activePlayer = 'A';
    // 模拟 A07 必杀已生效：双方所有神器本回合持续失效
    for (const id of ['A', 'B'] as const) {
      for (const a of state.players[id].artifacts) a.continuousLostThisTurn = true;
    }
    state.players.A.artifacts.find((a) => a.id === '002')!.activeMarkerSide = 'left'; // 龙游万象·左持续
    state.players.B.artifacts.find((a) => a.id === '004')!.activeMarkerSide = 'right'; // 锋芒·右（持续/触发）
    renderGame(state, root, hooksFor());

    expect(root.querySelector('.hint-global')!.textContent).toContain('「历王之血之印」生效中——本回合双方所有持续式效果失效');
    // 持续技能行转灰（深灰 disabled）
    expect(
      root.querySelector('.player--self .card[data-artifact="002"] .skill-part[data-side="left"]')!.classList.contains('skill-part--disabled'),
    ).toBe(true);
    expect(
      root.querySelector('.player--enemy .card[data-artifact="004"] .skill-part[data-side="right"]')!.classList.contains('skill-part--disabled'),
    ).toBe(true);
    // 「已激活」徽标转灰
    expect(root.querySelector('.player--self .card[data-artifact="002"] .badge-active')!.classList.contains('badge-active--spent')).toBe(true);
  });

  it('024 必杀按钮文案写明「发动必杀」而不是「启动技能」（避免与充能混淆）', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['022', '023', '024'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    const card = state.players.A.artifacts.find((a) => a.id === '024')!;
    card.chargeLayer = card.chargeReq ?? 0;
    card.activeMarkerSide = 'left';
    state.phase = 'main';
    renderGame(state, root, hooksFor());
    const labels = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).map((b) => b.textContent ?? '');
    expect(labels).toContain('发动必杀：「凶弹业舞」');
    expect(labels.some((l) => l === '启动技能：凶弹业舞')).toBe(false);
  });
});
describe('重掷阶段提示：可重掷次数（龙游万象 / 雷暴额外阶段）', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
  });

  const rerollState = (heroA: [string, string, string] = ['001', '002', '003']) => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA, heroB: ['004', '005', '006'] });
    skipInitialReroll(g);
    g.phase = 'reroll';
    g.activePlayer = 'A';
    g.rerollUsed = 0;
    return g;
  };

  it('「龙游万象」激活 → 提示可重掷 2 次并标注来源（玩家色）', () => {
    const g = rerollState();
    g.players.A.artifacts.find((a) => a.id === '002')!.activeMarkerSide = 'left'; // 龙游万象（持续·左）
    renderGame(g, root, hooksFor());
    const hint = root.querySelector('.hint-phase')!.textContent ?? '';
    expect(hint).toContain('本阶段可重掷 2 次（已用 0）');
    expect(hint).toContain('「龙游万象」');
    expect(root.querySelector('.hint-phase .hint-skill.player-A')).not.toBeNull();
  });

  it('未激活「龙游万象」→ 可重掷 1 次（不标注来源）', () => {
    const g = rerollState();
    renderGame(g, root, hooksFor());
    const hint = root.querySelector('.hint-phase')!.textContent ?? '';
    expect(hint).toContain('本阶段可重掷 1 次（已用 0）');
    expect(hint).not.toContain('「龙游万象」');
  });

  it('013 雷暴插入的额外重掷阶段 → 仅 1 次（游龙不叠加），并标注来源', () => {
    const g = rerollState();
    g.players.A.artifacts.find((a) => a.id === '002')!.activeMarkerSide = 'left'; // 即使有游龙也仍是 1 次
    g.extraReroll = { player: 'A', resume: 'B' };
    renderGame(g, root, hooksFor());
    const hint = root.querySelector('.hint-phase')!.textContent ?? '';
    expect(hint).toContain('本阶段可重掷 1 次（已用 0）');
    expect(hint).toContain('「雷暴」插入的额外重掷阶段：仅 1 次');
  });
});
describe('文案与选中态修复（用户反馈）', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
  });

  it('畏惧：提示写明"随后比较双方消耗的能力骰点数大小"', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['019', '020', '021'], heroB: ['022', '023', '024'] });
    skipInitialReroll(state);
    state.pending = { kind: 'weijuPay', player: 'A', initiator: 'B', initiatorValue: 2 };
    renderGame(state, root, hooksFor());
    const hint = root.querySelector('.hint-phase')!.textContent ?? '';
    expect(hint).toContain('比较双方消耗的能力骰点数大小');
    expect(hint).toContain('1 视为大于 6');
  });

  it('确认条文案按技能区分：共振=「重掷 1 颗骰」（不再串成影袭的「降低」）', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['022', '023', '024'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    state.phase = 'main';
    state.players.A.artifacts.find((a) => a.id === '023')!.activeMarkerSide = 'right'; // 共振（启动·右）
    state.players.A.areas.meditation = [{ id: 'm1', value: 2, kind: 'meditation' }];
    const { ui } = mount(state, root);
    // 点操作栏的「共振」按钮 → 打开选择器 → 选 1 颗骰 → 确认
    const open = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).find((b) =>
      (b.textContent ?? '').includes('共振'),
    )!;
    open.click();
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="m1"]')!.click();
    const ok = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
      (b) => b.textContent === '确认',
    )!;
    ok.click();
    const label = ui.pendingConfirm!.label;
    expect(label).toContain('重掷 1 颗骰');
    expect(label).not.toContain('降低');
  });

  it('选择器「选项」按钮：未选中无标记，点选后恰好一个带 option-btn--on', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['025', '026', '027'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    state.players.A.artifacts.find((a) => a.id === '026')!.activeMarkerSide = 'right'; // 威压
    state.pending = { kind: 'weiyaPick', player: 'A', value: 4, reason: 'attack' };
    state.players.B.areas.attack = [{ id: 'bd', value: 2, kind: 'attack' }];
    const { ui } = mount(state, root);
    root.querySelector<HTMLButtonElement>('.actionlist [data-act="weiyaOpen"]')!.click();
    expect(ui.selection).not.toBeNull();
    const opts = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .option-btn'));
    expect(opts.length).toBe(2);
    expect(opts.filter((b) => b.classList.contains('option-btn--on')).length).toBe(0);
    opts[0].click();
    const after = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .option-btn'));
    const on = after.filter((b) => b.classList.contains('option-btn--on'));
    expect(on.length).toBe(1);
    expect(on[0].dataset.option).toBe('self');
  });

  it('028 天罚：抵挡提示写明受「白昼之火」影响只能用冥想骰；候选只有冥想骰可点', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['028', '029', '030'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    state.phase = 'main';
    state.pending = null;
    state.pendingAttack = null;
    const A = state.players.A;
    const B = state.players.B;
    A.areas.attack = [{ id: 'a1', value: 1, kind: 'attack' }];
    A.areas.defense = [];
    A.areas.meditation = [];
    B.areas.attack = [];
    B.areas.defense = [{ id: 'bd', value: 3, kind: 'defense' }];
    B.areas.meditation = [{ id: 'bm', value: 4, kind: 'meditation' }];
    state.tianfa.A = { blockKind: 'meditation', value: 6, damageCount: 0 };
    applyAction(state, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });

    mount(state, root);
    const hint = root.querySelector('.hint-phase')!.textContent ?? '';
    expect(hint).toContain('「白昼之火」');
    expect(hint).toContain('只能用冥想骰抵挡');
    // 只能用冥想骰抵挡：防御骰不可点，冥想骰可点
    expect(root.querySelector<HTMLElement>('.die[data-id="bd"]')!.dataset.act).not.toBe('block');
    expect(root.querySelector<HTMLElement>('.die[data-id="bm"]')!.dataset.act).toBe('block');
  });

  it('029 全知：专用面板——全量骰片、一组一组加入、完成→预览→确认', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['028', '029', '030'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    state.pending = { kind: 'quanzhiAssign', player: 'A' };
    state.players.A.areas.attack = [
      { id: 'q3a', value: 3, kind: 'attack' },
      { id: 'q3b', value: 3, kind: 'attack' },
      { id: 'q4', value: 4, kind: 'attack' },
      { id: 'q5', value: 5, kind: 'attack' },
      { id: 'q6', value: 6, kind: 'attack' },
    ];
    state.players.A.areas.defense = [];
    state.players.A.areas.meditation = [];

    const { ui, onAction } = mount(state, root);
    const labels = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).map((b) => b.textContent);
    expect(labels.filter((l) => (l ?? '').includes('全知'))).toEqual(['「全知」：分配全部能力骰落区']);
    root.querySelector<HTMLButtonElement>('.actionlist [data-act="quanzhiOpen"]')!.click();
    expect(ui.quanzhi).not.toBeNull();

    const chip = (id: string) => root.querySelector<HTMLElement>(`.selector .pay-die[data-id="${id}"]`)!;
    const act = (a: string) => root.querySelector<HTMLButtonElement>(`.selector [data-act="${a}"]`)!;
    // 2 颗不同点 → 不构成一组，不能加入
    chip('q4').click();
    chip('q5').click();
    expect(act('quanzhiAdd').disabled).toBe(true);
    // 取消这两颗，改选 2 颗同点 3 → 加入防御组
    chip('q4').click();
    chip('q5').click();
    chip('q3a').click();
    chip('q3b').click();
    expect(act('quanzhiAdd').disabled).toBe(false);
    expect(act('quanzhiAdd').textContent).toContain('防御');
    act('quanzhiAdd').click();
    expect(chip('q3a').classList.contains('pay-die--used')).toBe(true); // 已入组不可再选
    // 3 颗连续 → 加入攻击组
    chip('q4').click();
    chip('q5').click();
    chip('q6').click();
    expect(act('quanzhiAdd').textContent).toContain('攻击');
    act('quanzhiAdd').click();
    // 完成选组 → 预览 → 确认
    act('quanzhiDone').click();
    expect(root.querySelector('.selector [data-act="quanzhiConfirm"]')).not.toBeNull();
    act('quanzhiConfirm').click();
    expect(ui.quanzhi).toBeNull();
    expect(onAction).toHaveBeenCalledWith({
      t: 'quanzhiAssign',
      assign: { q3a: 'defense', q3b: 'defense', q4: 'attack', q5: 'attack', q6: 'attack' },
    });
  });

  it('029 全知：预览「取消」回到第一步并清空已入组', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['028', '029', '030'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    state.pending = { kind: 'quanzhiAssign', player: 'A' };
    state.players.A.areas.attack = [
      { id: 'q3a', value: 3, kind: 'attack' },
      { id: 'q3b', value: 3, kind: 'attack' },
    ];
    state.players.A.areas.defense = [];
    state.players.A.areas.meditation = [];
    const { ui } = mount(state, root);
    root.querySelector<HTMLButtonElement>('.actionlist [data-act="quanzhiOpen"]')!.click();
    const chip = (id: string) => root.querySelector<HTMLElement>(`.selector .pay-die[data-id="${id}"]`)!;
    const act = (a: string) => root.querySelector<HTMLButtonElement>(`.selector [data-act="${a}"]`)!;
    chip('q3a').click();
    chip('q3b').click();
    act('quanzhiAdd').click();
    act('quanzhiDone').click();
    expect(ui.quanzhi?.preview).toBe(true);
    act('quanzhiCancel').click();
    expect(ui.quanzhi).toEqual({ groups: [], selected: [], preview: false });
  });

  it('029 全知：剩余仍可分组时「完成选组」禁用（强制分组）；「自动补完剩余」后可完成', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['028', '029', '030'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    state.pending = { kind: 'quanzhiAssign', player: 'A' };
    state.players.A.areas.attack = [
      { id: 'p3a', value: 3, kind: 'attack' },
      { id: 'p3b', value: 3, kind: 'attack' },
      { id: 'p4', value: 4, kind: 'attack' },
      { id: 'p5', value: 5, kind: 'attack' },
      { id: 'p6', value: 6, kind: 'attack' },
    ];
    state.players.A.areas.defense = [];
    state.players.A.areas.meditation = [];
    const { ui, onAction } = mount(state, root);
    root.querySelector<HTMLButtonElement>('.actionlist [data-act="quanzhiOpen"]')!.click();
    const act = (a: string) => root.querySelector<HTMLButtonElement>(`.selector [data-act="${a}"]`)!;
    // 一组未放 → 剩余 {3,3} 与 {4,5,6} 可分组 → 完成禁用 + 红字提示
    expect(act('quanzhiDone').disabled).toBe(true);
    expect(root.querySelector('.selector-hint--bad')).not.toBeNull();
    // 自动补完剩余 → 完成可用 → 预览 → 确认
    act('quanzhiAuto').click();
    expect(act('quanzhiDone').disabled).toBe(false);
    act('quanzhiDone').click();
    act('quanzhiConfirm').click();
    expect(ui.quanzhi).toBeNull();
    expect(onAction).toHaveBeenCalledWith({
      t: 'quanzhiAssign',
      assign: { p3a: 'defense', p3b: 'defense', p4: 'attack', p5: 'attack', p6: 'attack' },
    });
  });

  it('029 神圣干涉：装填后操作栏给出结算入口，选择器先选统一点数再选最多 3 颗', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['028', '029', '030'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    state.players.A.areas.meditation = [
      { id: 'm1', value: 2, kind: 'meditation' },
      { id: 'm2', value: 3, kind: 'meditation' },
    ];
    const a = state.players.A.artifacts.find((x) => x.id === '029')!;
    a.activeMarkerSide = 'right';
    a.armedSide = 'right';
    a.armedTurn = state.turnIndex;
    state.pending = { kind: 'activationResolve', player: 'A', artifactId: '029', side: 'right' };

    const { ui, onAction } = mount(state, root);
    const btn = root.querySelector<HTMLButtonElement>('.actionlist .btn[data-act="skill"]');
    expect(btn).toBeTruthy();
    btn!.click();
    expect(ui.selection?.key).toBe('zhenyan.ganshe');
    // 第一步：选统一点数（6）
    const opt = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .option-btn')).find((b) => b.dataset.option === '6')!;
    opt.click();
    Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) => b.textContent === '确认')!.click();
    // 第二步：选 1 颗骰
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="m1"]')!.click();
    Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) => b.textContent === '确认')!.click();
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-confirm')!.click();
    expect(onAction).toHaveBeenCalledWith({
      t: 'skill',
      artifactId: '029',
      side: 'right',
      params: { value: 6, dieIds: ['m1'] },
    });
  });

  it('030 寰宇飞升（必杀）：操作栏技能按钮 → 选择器要求恰好 4 个冥想骰', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['028', '029', '030'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    state.phase = 'main';
    state.pending = null;
    state.pendingAttack = null;
    const a = state.players.A.artifacts.find((x) => x.id === '030')!;
    a.activeMarkerSide = 'left';
    state.players.A.areas.meditation = [1, 2, 3, 4].map((v) => ({ id: `m${v}`, value: v, kind: 'meditation' as const }));
    state.players.A.areas.attack = [];
    state.players.A.areas.defense = [];

    const { ui, onAction } = mount(state, root);
    const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn[data-act="skill"]')).find((b) =>
      (b.textContent ?? '').includes('寰宇飞升'),
    )!;
    expect(btn).toBeTruthy();
    btn.click();
    expect(ui.selection?.key).toBe('jiushu.huanyu.ultimate');
    for (const v of [1, 2, 3, 4]) root.querySelector<HTMLElement>(`.selector .pay-die[data-id="m${v}"]`)!.click();
    Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) => b.textContent === '确认')!.click();
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-confirm')!.click();
    expect(onAction).toHaveBeenCalledWith({
      t: 'skill',
      artifactId: '030',
      side: 'only',
      params: {
        costSlots: [{ dieIds: ['m1'] }, { dieIds: ['m2'] }, { dieIds: ['m3'] }, { dieIds: ['m4'] }],
      },
    });
  });

  it('031 恶兆·清算：装填后打开选择器，弃置对方恰好 X 颗', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['031', '032', '033'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    state.players.A.areas.meditation = [{ id: 'mv', value: 4, kind: 'meditation' }];
    const a = state.players.A.artifacts.find((x) => x.id === '031')!;
    a.activeMarkerSide = 'right';
    a.armedSide = 'right';
    a.armedTurn = state.turnIndex;
    a.count = 2;
    state.players.B.areas.attack = [
      { id: 'b1', value: 1, kind: 'attack' },
      { id: 'b2', value: 2, kind: 'attack' },
      { id: 'b3', value: 3, kind: 'attack' },
    ];
    state.pending = { kind: 'activationResolve', player: 'A', artifactId: '031', side: 'right' };
    const { ui, onAction } = mount(state, root);
    root.querySelector<HTMLButtonElement>('.actionlist .btn[data-act="skill"]')!.click();
    expect(ui.selection?.key).toBe('ezhao.qingsuan');
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="b1"]')!.click();
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="b2"]')!.click();
    Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) => b.textContent === '确认')!.click();
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-confirm')!.click();
    expect(onAction).toHaveBeenCalledWith({
      t: 'skill',
      artifactId: '031',
      side: 'right',
      params: { dieIds: ['b1', 'b2'] },
    });
  });

  it('032 梦魇·恶意（启动）：选择 1 个攻击骰', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['031', '032', '033'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    state.phase = 'main';
    state.pending = null;
    state.pendingAttack = null;
    const a = state.players.A.artifacts.find((x) => x.id === '032')!;
    a.activeMarkerSide = 'right';
    state.players.A.areas.attack = [{ id: 'atk', value: 3, kind: 'attack' }];
    state.players.A.areas.defense = [];
    state.players.A.areas.meditation = [];
    const { ui, onAction } = mount(state, root);
    const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn[data-act="skill"]')).find((b) =>
      (b.textContent ?? '').includes('恶意'),
    )!;
    btn.click();
    expect(ui.selection?.key).toBe('mengyan.eyi');
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="atk"]')!.click();
    Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) => b.textContent === '确认')!.click();
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-confirm')!.click();
    expect(onAction).toHaveBeenCalledWith({
      t: 'skill',
      artifactId: '032',
      side: 'right',
      params: { costSlots: [{ dieIds: ['atk'] }] },
    });
  });

  it('032 梦魇·低语：操作入口 → 类型选择器（待决策直接派发）', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['031', '032', '033'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    state.phase = 'main';
    state.activePlayer = 'A';
    state.pending = { kind: 'kuyu', player: 'A' };
    state.players.A.areas.meditation = [{ id: 'm', value: 1, kind: 'meditation' }];
    const { ui, onAction } = mount(state, root);
    root.querySelector<HTMLButtonElement>('.actionlist [data-act="kuyuOpen"]')!.click();
    expect(ui.selection?.pendingKind).toBe('kuyu');
    const opt = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .option-btn')).find(
      (b) => b.dataset.option === 'defense',
    )!;
    opt.click();
    Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) => b.textContent === '确认')!.click();
    expect(onAction).toHaveBeenCalledWith({ t: 'kuyuResolve', area: 'defense' });
  });

  it('033 凋零·死亡亦逝：①/② + 弃骰选择器（待决策直接派发）', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['031', '032', '033'], heroB: ['001', '002', '003'] });
    skipInitialReroll(state);
    state.pending = { kind: 'tiaolingPick', player: 'A' };
    state.players.A.areas.attack = [3, 3, 5, 6].map((v, i) => ({ id: `d${i}`, value: v, kind: 'attack' as const }));
    state.players.A.areas.defense = [];
    state.players.A.areas.meditation = [];
    const { ui, onAction } = mount(state, root);
    root.querySelector<HTMLButtonElement>('.actionlist [data-act="tiaolingOpen"]')!.click();
    expect(ui.selection?.pendingKind).toBe('tiaolingPick');
    const opt = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .option-btn')).find(
      (b) => b.dataset.option === 'diff',
    )!;
    opt.click();
    Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) => b.textContent === '确认')!.click();
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="d1"]')!.click();
    Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) => b.textContent === '确认')!.click();
    expect(onAction).toHaveBeenCalledWith({ t: 'tiaolingResolve', pick: 'diff', dieIds: ['d1'] });
  });

  it('035 千劫·超度：选择 2 颗同点冥想骰 → 选目标玩家/区域', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '035', '003'], heroB: ['004', '005', '006'] });
    skipInitialReroll(state);
    state.phase = 'main';
    state.pending = null;
    state.pendingAttack = null;
    const a = state.players.A.artifacts.find((x) => x.id === '035')!;
    a.activeMarkerSide = 'right';
    state.players.A.areas.meditation = [
      { id: 'k1', value: 3, kind: 'meditation' },
      { id: 'k2', value: 3, kind: 'meditation' },
    ];
    state.players.A.areas.attack = [];
    state.players.A.areas.defense = [];
    const { ui, onAction } = mount(state, root);
    const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn[data-act="skill"]')).find((b) =>
      (b.textContent ?? '').includes('超度'),
    )!;
    btn.click();
    expect(ui.selection?.key).toBe('qianjie.chaodu');
    const confirm = () =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) => b.textContent === '确认')!;
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="k1"]')!.click();
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="k2"]')!.click();
    confirm().click();
    // 选目标玩家
    Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .option-btn')).find((b) => b.dataset.option === 'opponent')!.click();
    confirm().click();
    // 选目标区域
    Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .option-btn')).find((b) => b.dataset.option === 'attack')!.click();
    confirm().click();
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-confirm')!.click();
    expect(onAction).toHaveBeenCalledWith({
      t: 'skill',
      artifactId: '035',
      side: 'right',
      params: { costSlots: [{ dieIds: ['k1'] }, { dieIds: ['k2'] }], targetOwner: 'opponent', targetKind: 'attack' },
    });
  });

  it('035 千劫·万丈明光：操作入口 → 弃 2 个能力骰选择器', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '035', '003'], heroB: ['004', '005', '006'] });
    skipInitialReroll(state);
    state.pending = { kind: 'wanzhangDiscard', player: 'A' };
    state.players.A.areas.meditation = [1, 2, 3].map((v) => ({ id: `w${v}`, value: v, kind: 'meditation' as const }));
    state.players.A.areas.attack = [];
    state.players.A.areas.defense = [];
    const { ui, onAction } = mount(state, root);
    root.querySelector<HTMLButtonElement>('.actionlist [data-act="wanzhangOpen"]')!.click();
    expect(ui.selection?.pendingKind).toBe('wanzhangDiscard');
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="w1"]')!.click();
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="w2"]')!.click();
    Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) => b.textContent === '确认')!.click();
    expect(onAction).toHaveBeenCalledWith({ t: 'wanzhangDiscard', dieIds: ['w1', 'w2'] });
  });

  it('036 无相·万象俱灭（充能）：选择弃置一方 1 颗骰', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '036'], heroB: ['004', '005', '006'] });
    skipInitialReroll(state);
    state.pending = { kind: 'chargeResolve', player: 'A', artifactId: '036' };
    state.players.A.areas.meditation = [{ id: 'm1', value: 1, kind: 'meditation' }];
    state.players.B.areas.attack = [{ id: 'b1', value: 2, kind: 'attack' }];
    const { ui, onAction } = mount(state, root);
    root.querySelector<HTMLButtonElement>('.actionlist .btn[data-act="skill"]')!.click();
    expect(ui.selection?.key).toBe('wuxiang.charge');
    const confirm = () =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) => b.textContent === '确认')!;
    Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .option-btn')).find((b) => b.dataset.option === 'opponent')!.click();
    confirm().click();
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="b1"]')!.click();
    confirm().click();
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-confirm')!.click();
    expect(onAction).toHaveBeenCalledWith({
      t: 'skill',
      artifactId: '036',
      side: 'only',
      params: { owner: 'opponent', dieId: 'b1' },
    });
  });

  it('034 金刚·激活：一次选 3 个互不相同的点数存放到神器上', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['034', '002', '003'], heroB: ['004', '005', '006'] });
    skipInitialReroll(state);
    const a = state.players.A.artifacts.find((x) => x.id === '034')!;
    a.activeMarkerSide = 'left';
    a.armedSide = 'left';
    a.armedTurn = state.turnIndex;
    state.pending = { kind: 'activationResolve', player: 'A', artifactId: '034', side: 'left' };
    const { ui, onAction } = mount(state, root);
    root.querySelector<HTMLButtonElement>('.actionlist .btn[data-act="skill"]')!.click();
    expect(ui.selection?.key).toBe('jingang.pozhang');
    const confirm = () =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) => b.textContent === '确认')!;
    const pip = (v: string) =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .option-btn[data-pip]')).find((b) => b.dataset.pip === v)!;
    // 单步面板：未选满 3 个时「确认」不可用
    expect(confirm().disabled).toBe(true);
    pip('1').click();
    pip('2').click();
    pip('3').click();
    confirm().click();
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-confirm')!.click();
    expect(onAction).toHaveBeenCalledWith({
      t: 'skill',
      artifactId: '034',
      side: 'left',
      params: { pips: [1, 2, 3] },
    });
  });

  it('034 破障 × 035 超度：可用「神器上存放的骰」支付（新的支付来源）', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['034', '035', '036'], heroB: ['004', '005', '006'] });
    skipInitialReroll(state);
    state.phase = 'main';
    state.pending = null;
    state.pendingAttack = null;
    const a34 = state.players.A.artifacts.find((x) => x.id === '034')!;
    a34.activeMarkerSide = 'left'; // 破障（持续）生效
    a34.heldDice = [{ id: 'hd2', value: 2 }]; // 035 分布：冥 = 2/5 → 2 点为冥想
    state.players.A.artifacts.find((x) => x.id === '035')!.activeMarkerSide = 'right'; // 超度
    state.players.A.areas.meditation = [{ id: 'm2', value: 2, kind: 'meditation' }];
    state.players.A.areas.attack = [];
    state.players.A.areas.defense = [];
    const { ui, onAction } = mount(state, root);
    const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn[data-act="skill"]')).find((b) =>
      (b.textContent ?? '').includes('超度'),
    )!;
    btn.click();
    expect(ui.selection?.key).toBe('qianjie.chaodu');
    const chip = (id: string) => root.querySelector<HTMLElement>(`.selector .pay-die[data-id="${id}"]`)!;
    chip('hd2').click();
    chip('m2').click();
    const confirm = () =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) => b.textContent === '确认')!;
    confirm().click();
    Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .option-btn')).find((b) => b.dataset.option === 'opponent')!.click();
    confirm().click();
    Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .option-btn')).find((b) => b.dataset.option === 'attack')!.click();
    confirm().click();
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-confirm')!.click();
    expect(onAction).toHaveBeenCalledWith({
      t: 'skill',
      artifactId: '035',
      side: 'right',
      params: {
        costSlots: [{ dieIds: ['hd2'] }, { dieIds: ['m2'] }],
        targetOwner: 'opponent',
        targetKind: 'attack',
      },
    });
  });
});

describe('034 金刚：存放骰的合法出现范围（使用/消耗 vs 弃置）', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  it('破障生效时，「弃置」类面板（万丈明光）不出现金刚的存放骰', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['034', '035', '036'], heroB: ['004', '005', '006'] });
    skipInitialReroll(state);
    state.phase = 'main';
    state.pending = null;
    state.pendingAttack = null;
    const a34 = state.players.A.artifacts.find((x) => x.id === '034')!;
    a34.activeMarkerSide = 'left'; // 破障（持续）生效
    a34.heldDice = [{ id: 'hd3', value: 3 }];
    state.players.A.areas.attack = [{ id: 'a1', value: 1, kind: 'attack' }];
    state.players.A.areas.defense = [];
    state.players.A.areas.meditation = [{ id: 'm1', value: 1, kind: 'meditation' }];
    const { ui, hooks } = mount(state, root);
    ui.selection = {
      key: '@wanzhangDiscard',
      artifactId: '',
      side: 'only',
      stepIndex: 0,
      chosenDice: [],
      options: [],
      currentSel: new Set<string>(),
      numbers: [],
      slots: [],
      slotModes: [],
      pendingKind: 'wanzhangDiscard',
    };
    hooks.requestRender();
    expect(root.querySelector('.selector')).not.toBeNull();
    // 弃置类步骤：绝不出现神器上的存放骰
    expect(root.querySelector('.selector .pay-die[data-id="hd3"]')).toBeNull();
    // 区域内的真骰仍在（可正常弃置）
    expect(root.querySelector('.selector .pay-die[data-id="a1"]')).not.toBeNull();
    expect(root.querySelector('.selector .pay-die[data-id="m1"]')).not.toBeNull();
  });

  it('支付步的存放骰「按该步类型过滤」：冥想骰步只出现视为冥想的存放骰', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['034', '002', '003'], heroB: ['004', '005', '006'] });
    skipInitialReroll(state);
    state.phase = 'main';
    state.pending = null;
    state.pendingAttack = null;
    const a34 = state.players.A.artifacts.find((x) => x.id === '034')!;
    a34.activeMarkerSide = 'left';
    a34.heldDice = [
      { id: 'hMed2', value: 2 }, // 002 分布：冥 = 2/5
      { id: 'hAtk3', value: 3 }, // 002 分布：攻 = 3/4
    ];
    state.players.A.areas = { attack: [], defense: [], meditation: [{ id: 'm2', value: 2, kind: 'meditation' }] };
    const { ui, hooks } = mount(state, root);
    // 龙腾万丈（无 010）→ 单个 dice 步（areas=冥想、allowArtifact）
    ui.selection = {
      key: 'youlong.tengwan',
      artifactId: '002',
      side: 'right',
      stepIndex: 0,
      chosenDice: [],
      options: [],
      currentSel: new Set<string>(),
      numbers: [],
      slots: [],
      slotModes: [],
    };
    hooks.requestRender();
    expect(root.querySelector('.selector .pay-die--held[data-id="hMed2"]')).not.toBeNull();
    expect(root.querySelector('.selector .pay-die--held[data-id="hAtk3"]')).toBeNull();
  });

  it('确定/取消顺序全站统一：confirm-row 与 selector-actions 都是「确认 → 取消」', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(state);
    state.phase = 'main';
    const { ui, hooks } = mount(state, root);

    // ① 确认条（confirm-row）
    ui.pendingConfirm = { action: { t: 'advance' } as Action, label: '测试确认' };
    hooks.requestRender();
    expect(
      Array.from(root.querySelectorAll<HTMLButtonElement>('.confirm-row .btn')).map((b) => b.textContent),
    ).toEqual(['确认', '取消']);

    // ② 选择器（.selector-actions）
    ui.pendingConfirm = null;
    ui.selection = {
      key: '@wanzhangDiscard',
      artifactId: '',
      side: 'only',
      stepIndex: 0,
      chosenDice: [],
      options: [],
      currentSel: new Set<string>(),
      numbers: [],
      slots: [],
      slotModes: [],
      pendingKind: 'wanzhangDiscard',
    };
    hooks.requestRender();
    expect(
      Array.from(root.querySelectorAll<HTMLButtonElement>('.selector-actions .btn')).map((b) => b.textContent),
    ).toEqual(['确认', '取消']);
  });

  it('027 待决策期间，其它神器（034）卡面上的存放骰不可点，只有 027 的可点', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['034', '035', '027'], heroB: ['004', '005', '006'] });
    skipInitialReroll(state);
    const a34 = state.players.A.artifacts.find((x) => x.id === '034')!;
    a34.activeMarkerSide = 'left';
    a34.heldDice = [{ id: 'hdX', value: 3 }];
    const a27 = state.players.A.artifacts.find((x) => x.id === '027')!;
    a27.heldDice = [1, 2, 3, 4, 5, 6].map((v) => ({ id: `027-held-${v}`, value: v }));
    state.pending = { kind: 'hanguangPick', player: 'A', costSlots: [] };
    mount(state, root);
    const hdX = root.querySelector<HTMLElement>('.card-held .pay-die[data-id="hdX"]');
    expect(hdX).not.toBeNull();
    expect(hdX!.classList.contains('clickable')).toBe(false);
    // 存放骰现在显示在**卡片标题行内**、且无标签
    expect(hdX!.closest('.card-head')).not.toBeNull();
    expect(hdX!.closest('.card')!.querySelector('.chip-label')).toBeNull();
    const h27 = root.querySelector<HTMLElement>('.card-held .pay-die[data-id="027-held-1"]');
    expect(h27).not.toBeNull();
    expect(h27!.classList.contains('clickable')).toBe(true);
  });

  it('破障存放骰（攻击）在操作列表以中性骰片出现，点击即提出攻击', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['034', '002', '003'], heroB: ['004', '005', '006'] });
    skipInitialReroll(state);
    state.phase = 'main';
    state.activePlayer = 'A';
    state.pending = null;
    state.pendingAttack = null;
    const a34 = state.players.A.artifacts.find((x) => x.id === '034')!;
    a34.activeMarkerSide = 'left'; // 破障（持续）生效
    a34.heldDice = [{ id: 'hd3', value: 3 }]; // 002 分布：3 → 攻击
    state.players.A.areas.attack = [];
    state.players.A.areas.defense = [];
    state.players.A.areas.meditation = [];
    const { ui } = mount(state, root);
    const chip = root.querySelector<HTMLButtonElement>('.actionlist-chips .pay-die--held[data-id="hd3"]');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toBe('3');
    chip!.click();
    expect(ui.pendingConfirm?.action).toEqual({ t: 'attack', costSlots: [{ dieIds: ['hd3'] }] });
  });
});
describe('010 真实之剑·置换入口（触发类「消耗 1 颗」）', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  it('011 灵能屏障·触发待决策：持 010 的防御方能打开置换面板并派发 costSlots', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['010', '011', '012'] });
    skipInitialReroll(state);
    state.phase = 'main';
    state.activePlayer = 'A';
    state.pending = null;
    state.pendingAttack = null;
    state.players.B.artifacts.find((x) => x.id === '010')!.activeMarkerSide = 'left'; // 真实之剑·持续
    state.players.B.artifacts.find((x) => x.id === '011')!.activeMarkerSide = 'left'; // 灵能屏障·触发
    state.players.B.areas.meditation = [{ id: 'bm1', value: 3, kind: 'meditation' }];
    state.players.B.areas.attack = [{ id: 'ba1', value: 2, kind: 'attack' }];
    state.players.B.areas.defense = [];
    state.pending = { kind: 'dunwuHalve', player: 'B' };
    const { ui, onAction } = mount(state, root);
    const open = root.querySelector<HTMLButtonElement>('.actionlist .btn[data-act="dunwuHalveConvert"]');
    expect(open).not.toBeNull();
    open!.click();
    expect(ui.selection?.key).toBe('@dunwuHalveConvert');
    const chip = (id: string) => root.querySelector<HTMLElement>(`.selector .pay-die[data-id="${id}"]`)!;
    chip('bm1').click();
    chip('ba1').click();
    Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) => b.textContent === '确认')!.click();
    expect(onAction).toHaveBeenCalledWith({ t: 'dunwuHalve', accept: true, costSlots: [{ dieIds: ['bm1', 'ba1'] }] });
  });
});

describe('结束阶段：超出意志上限的选择器（自选弃骰）', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  it('入口 → 打开选择器 → 选骰确认派发 endDiscardResolve（自选而非自动）', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(state);
    state.phase = 'end';
    state.activePlayer = 'A';
    const p = state.players.A;
    const will = effectiveWill(p);
    p.areas.attack = [{ id: 'a1', value: 1, kind: 'attack' }];
    p.areas.defense = [{ id: 'd1', value: 2, kind: 'defense' }];
    p.areas.meditation = [];
    for (let i = 0; i < will - 1; i++) p.areas.meditation.push({ id: `m${i}`, value: 3, kind: 'meditation' });
    state.pending = { kind: 'endDiscard', player: 'A' };
    const { ui, onAction } = mount(state, root);
    const open = root.querySelector<HTMLButtonElement>('.actionlist .btn[data-act="endDiscardOpen"]');
    expect(open).not.toBeNull();
    open!.click();
    expect(ui.selection?.key).toBe('@endDiscard');
    const chip = (id: string) => root.querySelector<HTMLElement>(`.selector .pay-die[data-id="${id}"]`)!;
    chip('a1').click();
    Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) => b.textContent === '确认')!.click();
    expect(onAction).toHaveBeenCalledWith({ t: 'endDiscardResolve', dieIds: ['a1'] });
  });
});
