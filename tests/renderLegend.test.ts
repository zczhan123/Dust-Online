import { describe, it, expect } from 'vitest';
import { setupGame } from '../src/core/engine/setup';
import { getLegalActions } from '../src/core/engine/game';
import { LEGENDS, LEGEND_DUSTFALL_REQ } from '../src/core/content/legends';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import type { GameState } from '../src/core/model/types';

const mount = (
  state: GameState,
  prefs?: Partial<UiState['prefs']>,
): { root: HTMLElement; ui: UiState } => {
  const root = document.createElement('div');
  const ui: UiState = {
    rerollSelected: new Set(),
    selection: null,
    pendingConfirm: null,
    convertPick: null,
    fengmangPick: null,
    hanguangPick: null,
    quanzhi: null,
    dustFlow: null,
    prefs: {
      showSkillText: false,
      cardArt: 'thumb',
      density: 'compact',
      mirrorEnemy: false,
      preset: 'desktop',
      logCollapsed: false,
      zoomMode: 'off',
      zoomPercent: 90,
      ...prefs,
    },
    settingsOpen: false,
    logOpen: false,
    logPop: false,
    detail: null,
    error: null,
  };
  const hooks: RenderHooks = {
    onAction: () => {},
    ui,
    propose: () => {},
    requestRender: () => renderGame(state, root, hooks),
    onRestart: () => {},
  };
  renderGame(state, root, hooks);
  return { root, ui };
};

const render = (state: GameState, prefs?: Partial<UiState['prefs']>): HTMLElement =>
  mount(state, prefs).root;

const kinds = (panel: Element): (string | undefined)[] =>
  Array.from(panel.querySelectorAll('.areas .area')).map((a) => (a as HTMLElement).dataset.kind);

describe('renderGame · 传奇模式布局（预设·带传奇）', () => {
  it('带传奇：无左侧栏；中段出现战报格；传奇框是面板直接子节点（不在神器行内）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L01', legendB: 'L02' });
    const root = render(g);
    expect(root.querySelectorAll('.sidebar')).toHaveLength(0);
    expect(root.querySelectorAll('.centerband-log')).toHaveLength(1);
    // 设置按钮移到中段右侧空槽（战报格顶部不再放设置）
    expect(root.querySelector('.centerband-right .btn-settings')).not.toBeNull();
    expect(root.querySelectorAll('.card-legend')).toHaveLength(2);
    expect(root.querySelectorAll('.player--legend')).toHaveLength(2);
    expect(root.querySelectorAll('.area-spacer')).toHaveLength(0);
    // 面板直接子节点 = [传奇列, 右列]；传奇框在传奇列里、右列 = 神器/band/骰区
    const selfPanel = root.querySelector('.player--self')!;
    expect(selfPanel.children).toHaveLength(2);
    expect(selfPanel.querySelector('.legend-col > .card-legend')).not.toBeNull();
    expect(selfPanel.querySelector('.right-col > .cards')).not.toBeNull();
    expect(selfPanel.querySelector('.cards > .card-legend')).toBeNull();
    expect(selfPanel.querySelectorAll('.cards > .card')).toHaveLength(3);
    expect(selfPanel.querySelectorAll('.playband > .lifeline')).toHaveLength(1);
    expect(root.querySelector('.player--self .card-legend')!.getAttribute('data-legend')).toBe('L01');
    expect(root.querySelector('.player--self .card-legend .card-name')!.textContent).toBe('雨中剑圣 空');
    // 名字后跟「传奇英雄」小字（.card-sub）
    expect(root.querySelector('.player--self .card-legend .card-head .card-sub')!.textContent).toBe('传奇英雄');
    // 传奇模式：无战报贴边拉手（战报常驻中段战报格）
    expect(root.querySelector('.log-tab')).toBeNull();
  });

  it('传奇框面板图＝黑底板（无「传奇」徽标）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L01', legendB: 'L02' });
    const root = render(g, { cardArt: 'full' });
    const self = root.querySelector('.player--self .card-legend')!;
    expect(self.querySelectorAll('.card-legend-badge')).toHaveLength(0);
    const art = self.querySelector('.card-legend-art')!;
    expect(art).not.toBeNull();
    expect(art.querySelector('img')!.getAttribute('src')).toBe('./legend/L01.jpg');
  });

  it('不带传奇：保持现状（左侧栏在；无传奇框/留空格/中段战报格）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    const root = render(g);
    expect(root.querySelectorAll('.sidebar')).toHaveLength(1);
    expect(root.querySelectorAll('.card-legend')).toHaveLength(0);
    expect(root.querySelectorAll('.player--legend')).toHaveLength(0);
    expect(root.querySelectorAll('.area-spacer')).toHaveLength(0);
    expect(root.querySelectorAll('.centerband-log')).toHaveLength(0);
  });

  it('骰区顺序：敌方恒为镜像（与镜像开关无关）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L01', legendB: 'L02' });
    for (const mirrorEnemy of [false, true]) {
      const root = render(g, { mirrorEnemy });
      expect(kinds(root.querySelector('.player--enemy')!)).toEqual(['meditation', 'attack', 'defense']);
      expect(kinds(root.querySelector('.player--self')!)).toEqual(['defense', 'attack', 'meditation']);
    }
  });

  it('镜像神器摆放：敌方传奇翻到右侧（player--legend-right）并整行反序；我方不动', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L01', legendB: 'L02' });
    const root = render(g, { mirrorEnemy: true });
    const enemy = root.querySelector('.player--enemy')!;
    const self = root.querySelector('.player--self')!;
    expect(enemy.classList.contains('player--legend-right')).toBe(true);
    expect(self.classList.contains('player--legend-right')).toBe(false);
    // 敌方神器行整行反序（B 默认 004/005/006 → 006/005/004）
    expect(Array.from(enemy.querySelectorAll('.cards > .card')).map((c) => (c as HTMLElement).dataset.artifact))
      .toEqual(['006', '005', '004']);
    // 传奇框在传奇列里（不在神器行内）
    expect(enemy.querySelector('.legend-col > .card-legend')).not.toBeNull();
    // 骰区顺序仍恒镜像
    expect(kinds(enemy)).toEqual(['meditation', 'attack', 'defense']);
  });

  it('传奇卡图「缩略」：统一横条 + 按眼睛锚定（--legend-eye-y 已写入）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L01', legendB: 'L02' });
    const root = render(g, { cardArt: 'thumb' });
    expect(root.querySelectorAll('.player--legend-thumb')).toHaveLength(2);
    const art = root.querySelector('.player--self .card-legend-art')!;
    expect(art.classList.contains('card-legend-art--thumb')).toBe(true);
    const style = (art.getAttribute('style') ?? '').replace(/\s/g, '');
    expect(style).toContain('aspect-ratio');
    expect(style).toContain('--legend-eye-y');
    const img = art.querySelector('img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('./legend/L01.jpg');
  });

  it('传奇卡图「完整」：用整图、面板走顶部对齐（player--legend-full）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L01', legendB: 'L02' });
    const root = render(g, { cardArt: 'full' });
    expect(root.querySelectorAll('.player--legend-full')).toHaveLength(2);
    expect(root.querySelectorAll('.player--legend-thumb')).toHaveLength(0);
    const art = root.querySelector('.player--self .card-legend-art')!;
    expect(art.classList.contains('card-legend-art--thumb')).toBe(false);
  });

  it('传奇面板·隐藏描述：用独立的 .skills--inline-legend（不受神器「两列/居中」改动影响）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L01', legendB: 'L02' });
    const root = render(g, { showSkillText: false });
    const skills = root.querySelector('.player--self .card-legend .skills')!;
    expect(skills.classList.contains('skills--inline-legend')).toBe(true);
    expect(skills.classList.contains('skills--inline')).toBe(false);
    expect(skills.classList.contains('skills--inline--only')).toBe(false);
  });
});

describe('战报栏 · 右键放大弹窗', () => {
  it('右键战报栏 → 弹出放大弹窗（全量）；点弹窗外面关闭', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    g.log.push(
      { turn: 1, phase: 'main', text: '事件一' },
      { turn: 1, phase: 'main', text: '事件二' },
      { turn: 2, phase: 'end', text: '事件三' },
    );
    const { root, ui } = mount(g);
    const log = root.querySelector('.log--zoomable');
    expect(log).not.toBeNull();
    expect(root.querySelector('.logpop-modal')).toBeNull();

    log!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(ui.logPop).toBe(true);
    const modal = root.querySelector('.logpop-modal');
    expect(modal).not.toBeNull();
    // 放大弹窗＝全量（最新在上）
    expect(Array.from(modal!.querySelectorAll('.log--pop .log-line')).map((n) => n.textContent)).toEqual([
      'T2·结束：事件三',
      'T1·主要：事件二',
      'T1·主要：事件一',
    ]);

    // 无头部/关闭按钮；点弹窗外面（遮罩）关闭
    expect(root.querySelector('.logpop-head')).toBeNull();
    (root.querySelector('.logpop-overlay') as HTMLElement).click();
    expect(ui.logPop).toBe(false);
    expect(root.querySelector('.logpop-modal')).toBeNull();
  });

  it('内联战报只显示最近 30 条；放大弹窗显示全部', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    for (let i = 0; i < 35; i++) g.log.push({ turn: i + 1, phase: 'main', text: `第${i + 1}条` });
    const { root, ui } = mount(g);
    expect(root.querySelectorAll('.log--zoomable .log-line')).toHaveLength(30);
    ui.logPop = true;
    renderGame(g, root, { onAction: () => {}, ui, propose: () => {}, requestRender: () => {}, onRestart: () => {} });
    expect(root.querySelectorAll('.log--pop .log-line')).toHaveLength(35);
  });
});

describe('非当前回合玩家的待决策（复仇之灵强制尘起）', () => {
  it('操作列表出现尘起按钮（不是「无可用操作」）', () => {
    const g = setupGame({
      seed: 1,
      firstPlayer: 'A',
      legendB: 'L05',
      heroB: ['013', '014', '015'],
    });
    g.phase = 'main';
    g.activePlayer = 'A'; // 当前回合 = A；待决策 = B
    g.pending = { kind: 'fuchouRise', player: 'B' };
    const root = render(g);
    expect(root.querySelectorAll('.actionlist .btn-dust').length).toBeGreaterThan(0);
    expect(root.querySelector('.actionlist-empty')).toBeNull(); // 不出现「（无可用操作）」
  });
});

describe('面板技能按钮文案（快速操作栏）', () => {
  const labels = (root: HTMLElement): string[] =>
    Array.from(root.querySelectorAll('.actionlist button')).map((b) => b.textContent ?? '');

  it('「启动」类面板技能 → 「启动技能：无光领域」（不出现「发动必杀：「」」）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L06', heroA: ['016', '017', '018'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    const ls = labels(render(g));
    expect(ls).toContain('启动技能：无光领域');
    expect(ls.some((t) => t.includes('发动必杀：「」'))).toBe(false);
  });

  it('「必杀」类面板技能 → 「发动必杀：「绝地惊雷」」', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L05', heroA: ['013', '014', '015'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.dustfall = 3; // 绝地惊雷：尘落前置 3
    expect(labels(render(g))).toContain('发动必杀：「绝地惊雷」');
  });

  it('神器 018「漆黑绽放」的必杀按钮文案正确（防回归）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', heroA: ['016', '017', '018'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    const art018 = g.players.A.artifacts.find((a) => a.id === '018')!;
    art018.activeMarkerSide = 'left'; // 已激活 → 技能可用
    art018.count = 1; // 计数 ≥1 才可主动发动
    expect(labels(render(g))).toContain('发动必杀：「漆黑绽放」');
  });
});

describe('传奇面板 · 尘落前置（引擎与界面同一来源，防 UI 副本漏项）', () => {
  /** 该面板技能的「必杀」动作是否出现在合法动作里（引擎侧门槛） */
  const ultLegal = (g: GameState, legendId: string): boolean =>
    getLegalActions(g).some((a) => a.t === 'skill' && a.artifactId === legendId);

  /** 面板技能行（卡面）是否显示为可用（绿色） */
  const rowOn = (root: HTMLElement, legendId: string, key: string): boolean =>
    !!root
      .querySelector(`.card-legend[data-legend="${legendId}"] .skill-part[data-key="${key}"]`)
      ?.classList.contains('skill-part--on');

  const toMain = (g: GameState): GameState => {
    g.phase = 'main';
    g.activePlayer = 'A';
    return g;
  };

  it('L05「绝地惊雷」（尘落前置 3）：尘落 2 → 行非绿且引擎不给动作；尘落 3 → 行绿且有动作', () => {
    const g = toMain(setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L05', heroA: ['013', '014', '015'] }));

    g.dustfall = 2;
    const before = render(g);
    expect(rowOn(before, 'L05', 'zoray.juedi')).toBe(false);
    expect(ultLegal(g, 'L05')).toBe(false);

    g.dustfall = 3;
    const after = render(g);
    expect(rowOn(after, 'L05', 'zoray.juedi')).toBe(true);
    expect(ultLegal(g, 'L05')).toBe(true);
  });

  it('L02「潸然的葬敌花」（尘落前置 1）：尘落 0 → 行非绿且无动作；尘落 1 → 行绿且有动作', () => {
    const g = toMain(setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L02', heroA: ['004', '005', '006'] }));

    g.dustfall = 0;
    const before = render(g);
    expect(rowOn(before, 'L02', 'ying.zangdihua')).toBe(false);
    expect(ultLegal(g, 'L02')).toBe(false);

    g.dustfall = 1;
    const after = render(g);
    expect(rowOn(after, 'L02', 'ying.zangdihua')).toBe(true);
    expect(ultLegal(g, 'L02')).toBe(true);
  });

  it('门禁：LEGEND_DUSTFALL_REQ 每个前置技能，在 req−1 / req 两点「引擎动作有无 === 界面是否绿」', () => {
    const keys = Object.keys(LEGEND_DUSTFALL_REQ);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const req = LEGEND_DUSTFALL_REQ[key];
      const legendId = Object.keys(LEGENDS).find((id) => LEGENDS[id].skills.some((s) => s.key === key));
      expect(legendId, `前置技能 ${key} 必须属于某个传奇面板`).toBeTruthy();
      const trio = LEGENDS[legendId!].artifacts;
      for (const [dustfall, want] of [
        [req - 1, false],
        [req, true],
      ] as const) {
        const g = toMain(setupGame({ seed: 1, firstPlayer: 'A', legendA: legendId!, heroA: trio }));
        g.dustfall = dustfall;
        // 中和"尘落前置"以外的前提（如 L07「不屈咆哮」还需「决意」计数 ≥1），让本门禁只测尘落前置
        for (const a of g.players.A.artifacts) {
          a.activeMarkerSide = 'left';
          a.armedSide = 'left';
          a.armedTurn = g.turnIndex;
          a.count = 1;
        }
        expect(rowOn(render(g), legendId!, key), `${key} @尘落=${dustfall} 界面绿态`).toBe(want);
        // 引擎侧"可用"：必杀 → 该面板的必杀动作；**持续**（L08「没有怜悯」）→ 它授予的 024 必杀动作出现
        //（后者要先把 024 恢复成"未激活、未充能"，否则正常路径也会给必杀动作、区分不出来）
        if (key === 'xiva.meiyoulianmin') {
          const a024 = g.players.A.artifacts.find((x) => x.id === '024');
          if (a024) {
            a024.activeMarkerSide = null;
            a024.chargeLayer = 0;
          }
        }
        const engineHas =
          key === 'xiva.meiyoulianmin'
            ? getLegalActions(g).some((x) => x.t === 'skill' && x.artifactId === '024')
            : ultLegal(g, legendId!);
        expect(engineHas, `${key} @尘落=${dustfall} 引擎动作`).toBe(want);
      }
    }
  });
});
