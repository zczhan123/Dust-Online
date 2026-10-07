import { describe, it, expect, vi } from 'vitest';
import { createGame, createChallengeGame } from '../src/core/engine/game';
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

const mount = (state: GameState): { root: HTMLElement; ui: UiState } => {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const ui = freshUi();
  const hooks: RenderHooks = {
    onAction: vi.fn(),
    ui,
    propose: () => {},
    requestRender: () => renderGame(state, root, hooks),
    onRestart: () => {},
  };
  renderGame(state, root, hooks);
  return { root, ui };
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
    expect(panel.textContent).toContain('生命 50　｜　防御骰上限 4　｜　只抵挡伤害 ≥ 3 的攻击');
    expect(panel.querySelectorAll('.card-sub')[1]?.textContent).toBe('分布 防3 攻1/2/6 冥4/5');
    const img = panel.querySelector('.challenge-thumb img');
    expect(img?.getAttribute('src')).toBe('./challenges/Z002.jpg');
    expect(panel.querySelectorAll('.challenge-skill-table .challenge-skill').length).toBe(6);
    expect(panel.querySelector('.challenge-staging')).not.toBeNull();
    expect(panel.querySelector('.area--driven .area-label')?.textContent).toContain('驱动骰槽');
    // 标准模式下不出现该面板
    const std = mount(createGame({ seed: 1, firstPlayer: 'A' }));
    expect(std.root.querySelector('.panel--challenge')).toBeNull();
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
