import { describe, it, expect, vi } from 'vitest';
import { createGame, createChallengeGame, skipInitialReroll, applyAction, getLegalActions } from '../src/core/engine/game';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import type { GameState } from '../src/core/model/types';

const freshUi = (): UiState => ({
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
  },
  settingsOpen: false,
  logOpen: false,
  logPop: false,
  detail: null,
  error: null,
});

const mount = (
  state: GameState,
  cardArt: 'thumb' | 'full' = 'thumb',
): { root: HTMLElement; ui: UiState; hooks: RenderHooks } => {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const ui = freshUi();
  ui.prefs.cardArt = cardArt;
  const hooks: RenderHooks = {
    onAction: vi.fn(),
    ui,
    propose: () => {},
    requestRender: () => renderGame(state, root, hooks),
    onRestart: () => {},
  };
  renderGame(state, root, hooks);
  return { root, ui, hooks };
};

describe('挑战模式 · 战斗界面「特殊规则」入口', () => {
  it('挑战模式：设置旁出现「挑战模式特殊规则」按钮', () => {
    const { root } = mount(createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] }));
    expect(root.querySelector('[data-act="challengeRulesOpen"]')).not.toBeNull();
    expect(root.querySelector('[data-act="settingsOpen"]')).not.toBeNull();
  });

  it('标准模式：不出现该按钮', () => {
    const { root } = mount(createGame({ seed: 1, firstPlayer: 'A' }));
    expect(root.querySelector('[data-act="challengeRulesOpen"]')).toBeNull();
  });

  it('点开后浮窗列出 5 条削弱（数据来自 CHALLENGE_RULE_NOTES）', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });
    const { root, ui } = mount(state);
    (root.querySelector('[data-act="challengeRulesOpen"]') as HTMLElement).click();
    expect(ui.challengeRulesOpen).toBe(true);
    const text = root.textContent ?? '';
    for (const t of ['013 鸣雷·雷暴（持续）', '017 幽冥·帷幕', '028 天罚·白昼之火（含异相 A05）', '023 蛇蝎·共振', '020 兽魂']) {
      expect(text).toContain(t);
    }
    // 关闭
    (root.querySelector('[data-act="challengeRulesClose"]') as HTMLElement).click();
    expect(ui.challengeRulesOpen).toBe(false);
    expect(root.querySelector('[data-act="challengeRulesOverlay"]')).toBeNull();
  });
});

describe('挑战模式 · 对手面板（D 方案）', () => {
  it('面板头含称号/点数分布；卡图缩略指向压缩后的挑战卡图；技能列 6 行；第三区＝驱动骰槽', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });
    const { root } = mount(state);
    const panel = root.querySelector('.panel--challenge')!;
    expect(panel).not.toBeNull();
    expect(panel.querySelector('.player-title')?.textContent).toContain('永暗之刃');
    expect(panel.querySelector('.player-header .skill-type')?.textContent).toBe('昔日传奇');
    expect(panel.querySelector('.card-sub')?.textContent).toBe('生命 50');
    expect(panel.querySelectorAll('.card-sub')[1]?.textContent).toBe('分布 防3 攻1/2/6 冥4/5');
    // 标题栏不再含"防御骰上限/规则"（已移到防御信息框）
    expect(panel.querySelector('.player-header')?.textContent).not.toContain('防御骰上限');
    // 防御信息框：在 band 第 3 列（＝防御骰区正下方），与骰区直角相接（不是并进骰区框里）
    const info = panel.querySelector('.playband--single > .challenge-legacy-info') as HTMLElement | null;
    expect(info?.textContent).toBe('防御骰上限 4　｜　只抵挡伤害 ≥ 3 的攻击');
    expect(info?.style.gridColumn).toBe('3');
    expect(panel.querySelector('.area--legend-def')).toBeNull();
    // 生命条占两列（驱动骰槽列 + 攻击骰区列）
    expect((panel.querySelector('.playband--single > .lifeline') as HTMLElement).style.gridColumn).toBe(
      '1 / span 2',
    );
    // 技能描述补全（照卡面）＋ 条件文案已精简
    expect(panel.textContent).toContain('尽可能弃置挑战者的防御骰');
    expect(panel.textContent).toContain('（满足1、2、3、4点时发动）');
    const img = panel.querySelector('.challenge-thumb img');
    expect(img?.getAttribute('src')).toBe('./challenges/Z002.jpg');
    // 缩略图模式（prefs.cardArt='thumb' 是本用例默认）＝裁掉上下标题条/留白；完整模式＝不加裁剪类
    expect(panel.querySelector('.challenge-thumb')?.classList.contains('challenge-thumb--crop')).toBe(true);
    expect(panel.querySelectorAll('.challenge-skill-table .challenge-skill').length).toBe(6);
    expect(panel.querySelector('.challenge-staging')).not.toBeNull();
    expect(panel.querySelector('.challenge-staging .csk-staging-lab')?.textContent).toBe('临时驱动骰区域');
    expect(panel.querySelector('.area--driven .area-label')?.textContent).toBe('驱动骰槽');
    // 标准模式下不出现该面板
    const std = mount(createGame({ seed: 1, firstPlayer: 'A' }));
    expect(std.root.querySelector('.panel--challenge')).toBeNull();
  });

  it('完整模式：卡图不加裁剪类（整张全图）', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });
    const { root } = mount(state, 'full');
    const thumb = root.querySelector('.panel--challenge .challenge-thumb')!;
    expect(thumb.classList.contains('challenge-thumb--crop')).toBe(false);
  });

  it('传奇过场：投掷帧 / challengeStep 帧重绘都不抛错（jsdom 下动画整体跳过）', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });
    const { root, hooks } = mount(state);
    skipInitialReroll(state); // → 传奇回合开始（legendRoll 帧）
    expect(() => renderGame(state, root, hooks)).not.toThrow();
    applyAction(state, { t: 'challengeStep' }); // → 发动一条技能（legendSkill 帧）
    expect(() => renderGame(state, root, hooks)).not.toThrow();
    if (getLegalActions(state).some((a) => a.t === 'challengeStep')) {
      applyAction(state, { t: 'challengeStep' });
    }
    expect(() => renderGame(state, root, hooks)).not.toThrow();
  });

  it('传奇骰子按身份上色：临时驱动骰区域 / 驱动骰槽 用 die-B（红），不用灰色 die-drv', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });
    state.challenge!.driven = [
      { id: 'drv1', value: 3, kind: 'meditation' },
      { id: 'drv2', value: 5, kind: 'meditation' },
    ];
    state.challenge!.slot = [{ id: 'sl1', value: 6, kind: 'meditation' }];
    const { root } = mount(state);
    expect(root.querySelectorAll('.challenge-staging .die.die-B').length).toBe(2);
    expect(root.querySelectorAll('.area--driven .die.die-B').length).toBe(1);
    expect(root.querySelector('.die.die-drv')).toBeNull();
  });

  it('正在结算的技能高亮（activeSkill 下标）', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });
    state.challenge!.activeSkill = 2;
    const { root } = mount(state);
    const rows = Array.from(root.querySelectorAll('.panel--challenge .challenge-skill'));
    expect(rows[2].classList.contains('is-active')).toBe(true);
    expect(rows.filter((r) => r.classList.contains('is-active')).length).toBe(1);
  });

  it('点卡图缩略 → 打开大图浮窗；关闭后消失', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });
    const { root } = mount(state);
    (root.querySelector('[data-act="challengeCardOpen"]') as HTMLElement).click();
    const overlay = root.querySelector('[data-act="challengeCardOverlay"]');
    expect(overlay).not.toBeNull();
    (root.querySelector('[data-act="challengeCardClose"]') as HTMLElement).click();
    expect(root.querySelector('[data-act="challengeCardOverlay"]')).toBeNull();
  });

  it('代决待决策：提示语 + 候选按钮（challengePick）', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });
    state.pending = {
      kind: 'challengePick',
      player: 'A',
      prompt: '「葬敌的完杀」：留哪 1 颗防御骰？',
      options: [
        { id: 'd1', label: '防2' },
        { id: 'd5', label: '防5' },
      ],
    };
    const { root } = mount(state);
    const t = root.textContent ?? '';
    expect(t).toContain('挑战模式 · 代决：「葬敌的完杀」：留哪 1 颗防御骰？');
    expect(t).toContain('防2');
    expect(t).toContain('防5');
  });
});
