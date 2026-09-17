import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupGame } from '../src/core/engine/setup';
import { createGame, applyAction, skipInitialReroll, beginTurn } from '../src/core/engine/game';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import { dealTrueDamage } from '../src/core/engine/combat';
import type { Action, GameState } from '../src/core/model/types';

const freshUi = (prefs?: Partial<UiState['prefs']>): UiState => ({
  rerollSelected: new Set(),
  selection: null,
  pendingConfirm: null,
  convertPick: null,
  fengmangPick: null,
  dustFlow: null,
  prefs: { showSkillText: false, cardArt: 'thumb', density: 'compact', mirrorEnemy: false, preset: 'desktop', logCollapsed: false, ...prefs },
  settingsOpen: false,
  logOpen: false,
  detail: null,
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

  it('puts self dice areas above the artifact cards (no player header)', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    const self = root.querySelector('.player--self')!;
    expect(self.firstElementChild!.classList.contains('areas')).toBe(true);
    // 「玩家A/B」头部已移除
    expect(self.querySelector('.player-header')).toBeNull();
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

  it('shows both players life in the merged vitals bar, colored by player', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    const lifeA = root.querySelector('.centerband .vitals-life.life-A');
    const lifeB = root.querySelector('.centerband .vitals-life.life-B');
    expect(lifeA).not.toBeNull();
    expect(lifeB).not.toBeNull();
    expect(lifeA!.textContent).toContain('生命');
    // 原来的玩家头部生命显示已移除
    expect(root.querySelector('.player-life')).toBeNull();
    // 颜色圆圈：从玩家头部移到生命值栏（头部已整体移除）
    expect(root.querySelector('.player-header')).toBeNull();
    expect(root.querySelector('.vitals .dot-A')).not.toBeNull();
    expect(root.querySelector('.vitals .dot-B')).not.toBeNull();
  });

  it('orders the two life rows as [enemy, self] so they flip with the active player', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    const rowIds = () =>
      Array.from(root.querySelectorAll<HTMLElement>('.vitals .vitals-item')).map((e) =>
        e.classList.contains('vitals-A') ? 'A' : 'B',
      );

    renderGame(state, root, hooksFor());
    // A 行动 → 自己=A 在下、敌人=B 在上
    expect(rowIds()).toEqual(['B', 'A']);

    state.activePlayer = 'B';
    renderGame(state, root, hooksFor());
    expect(rowIds()).toEqual(['A', 'B']);
  });

  it('highlights the pending skill name in the hint with the acting player color', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '009'] });
    skipInitialReroll(state);
    const gw = state.players.A.artifacts.find((a) => a.id === '009')!;
    gw.activeMarkerSide = 'left';
    state.players.A.areas.defense = [{ id: 'gd1', value: 4, kind: 'defense' }];
    dealTrueDamage(state, 'A', 6);
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

  it('collapses the log into an edge-button drawer when 战报栏 = 收起', () => {
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
    expect(root.querySelector('.edge-bar [data-act="edgeSettingsOpen"]')).not.toBeNull();
    expect(root.querySelector('.log-drawer')).toBeNull();

    // 贴边按钮组里有「设置」入口（避免收起战报后无法进设置）
    const edgeSettings = root.querySelector<HTMLButtonElement>(
      '.edge-bar [data-act="edgeSettingsOpen"]',
    )!;
    expect(edgeSettings).not.toBeNull();
    edgeSettings.click();
    expect(ui.settingsOpen).toBe(true);
    root.querySelector<HTMLButtonElement>('.settings-close')!.click();
    expect(ui.settingsOpen).toBe(false);

    root.querySelector<HTMLButtonElement>('.edge-bar [data-act="logOpen"]')!.click();
    expect(ui.logOpen).toBe(true);
    expect(root.querySelector('.log-drawer .log')).not.toBeNull();

    // 抽屉里也有「设置」入口，且会先关抽屉（否则被遮罩挡住）
    root.querySelector<HTMLButtonElement>('[data-act="drawerSettingsOpen"]')!.click();
    expect(ui.logOpen).toBe(false);
    expect(ui.settingsOpen).toBe(true);
    root.querySelector<HTMLButtonElement>('.settings-close')!.click();

    // 重新打开抽屉后，点空白处关闭
    root.querySelector<HTMLButtonElement>('.edge-bar [data-act="logOpen"]')!.click();
    root.querySelector<HTMLElement>('.log-overlay')!.click();
    expect(ui.logOpen).toBe(false);
    expect(root.querySelector('.log-drawer')).toBeNull();
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

    // 触屏模式：密度=舒适、战报收起
    rowBtn('预设组合', '触屏模式').click();
    expect(ui.prefs.preset).toBe('touch');
    expect(ui.prefs.density).toBe('comfortable');
    expect(ui.prefs.logCollapsed).toBe(true);

    // 手动改单项 → 自定义
    rowBtn('卡图', '完整').click();
    expect(ui.prefs.preset).toBe('custom');
    expect(root.querySelector('.settings-row .settings-opt')!.textContent).toBeDefined();

    // 电脑模式：密度=紧凑、战报显示
    rowBtn('预设组合', '电脑模式').click();
    expect(ui.prefs.preset).toBe('desktop');
    expect(ui.prefs.density).toBe('compact');
    expect(ui.prefs.logCollapsed).toBe(false);
  });

  it('uses the bottom-sheet form of the detail popover on narrow screens', () => {
    const prev = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 600, configurable: true, writable: true });
    try {
      const state = createGame({ seed: 1, firstPlayer: 'A' });
      const { ui } = mount(state, root);
      root
        .querySelector<HTMLElement>('.player--self .card[data-artifact="001"] .card-art')!
        .click();
      expect(ui.detail).not.toBeNull();
      const pop = root.querySelector<HTMLElement>('.detail-popover')!;
      expect(pop.classList.contains('detail-popover--sheet')).toBe(true);
      // 窄屏下不写死内联定位（交由 CSS 底部抽屉定位）
      expect(pop.style.left).toBe('');
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: prev, configurable: true, writable: true });
    }
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
    state.players.A.artifacts.find((a) => a.id === '003')!.chargeLayer = 4; // 明镜 满充能
    renderGame(state, root, hooksFor());
    expect(root.textContent ?? '').toContain('充能 4/4（已满）');
    const card = root.querySelector('.player--self .card[data-artifact="003"]')!;
    const badge = card.querySelector('.badge-charge');
    expect(badge).not.toBeNull();
    expect(badge!.classList.contains('badge-charge--full')).toBe(true);
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
    expect(box!.classList.contains('skill-part--full')).toBe(true);
    expect(box!.textContent).toContain('已满');
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
    expect(band.querySelector('.centerband-right .vitals')).not.toBeNull();
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

  it('opens a read-only skill detail popover by clicking the card art', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'] });
    const { ui } = mount(state, root);
    expect(root.querySelector('.detail-popover')).toBeNull();

    const art = root.querySelector<HTMLElement>(
      '.player--self .card[data-artifact="001"] .card-art',
    )!;
    expect(art.classList.contains('detail-trigger')).toBe(true);
    art.click();
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
      showSkillText: false,
      cardArt: 'thumb',
      density: 'compact',
      mirrorEnemy: false,
      preset: 'desktop',
      logCollapsed: false,
    });
    expect(root.querySelectorAll('.skill-text').length).toBe(0);

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
    state.ultimatesUsed.push('wansha.ultimate');
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

  it('marks a used ultimate with a 已使用 badge and disables it', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    state.ultimatesUsed.push('mingjing.ultimate');
    state.players.A.artifacts.find((a) => a.id === '003')!.activeMarkerSide = 'left';
    renderGame(state, root, hooksFor());
    const used = root.querySelectorAll<HTMLElement>('.player--self .skill-part--used');
    expect(used.length).toBe(1);
    expect(used[0].textContent).toContain('已使用');
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

  it('renders the 009 高塔铁幕 trigger prompt with cancel / take-damage buttons', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '009'] });
    skipInitialReroll(state);
    const gw = state.players.A.artifacts.find((a) => a.id === '009')!;
    gw.activeMarkerSide = 'left';
    state.players.A.areas.defense = [{ id: 'gd1', value: 4, kind: 'defense' }];
    dealTrueDamage(state, 'A', 6);
    expect(state.pending!.kind).toBe('guwangCancel');

    renderGame(state, root, hooksFor());
    expect(root.querySelector('.hint-phase')?.textContent).toContain('高塔铁幕');
    // 「承受伤害」文字按钮 + 「取消（消耗 防4）」骰片行
    const take = root.querySelector<HTMLButtonElement>('.actionlist .btn[data-act="guwangCancel"]');
    expect(take!.textContent).toBe('承受伤害');
    const row = root.querySelector<HTMLElement>('.actionlist-chips')!;
    expect(row.textContent).toContain('取消（消耗');
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
    expect(labels).toContain('发动杀意（3 真伤 + 回2）');
    expect(labels).toContain('不发动');
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
    expect(decline!.textContent).toBe('不减半');
    const halveRow = root.querySelector<HTMLElement>('.actionlist-chips')!;
    expect(halveRow.textContent).toContain('伤害减半（消耗');
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
    expect(labels).toContain('发动脉冲（2 点真实伤害）');
    expect(labels).toContain('不发动');
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
