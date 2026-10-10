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

  it('Z03（孤塔之王 · 防御骰无上限）：防御信息框显示「防御骰无上限 ｜ 只抵挡伤害 ≥ 2 的攻击」', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z03', challenger: ['001', '002', '003'] });
    const { root } = mount(state);
    const info = root.querySelector('.panel--challenge .playband--single > .challenge-legacy-info') as HTMLElement | null;
    expect(info?.textContent).toBe('防御骰上限 无　｜　只会抵挡伤害 ≥ 2 的攻击');
  });

  it('完整模式：卡图不加裁剪类（整张全图）', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });
    const { root } = mount(state, 'full');
    const thumb = root.querySelector('.panel--challenge .challenge-thumb')!;
    expect(thumb.classList.contains('challenge-thumb--crop')).toBe(false);
  });

  it('枭首：已"飞出去"的骰子从攻击骰区**数据层排除**（重绘也不复活）', () => {
    vi.useFakeTimers();
    try {
      const state = createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });
      // 造"枭首一次攻击等待响应"的局面：攻击骰区一颗真骰 + 以它为 sourceDieId 的待抵挡
      state.players.B.areas.attack = [{ id: 'bx1', value: 6, kind: 'attack' }];
      state.challenge!.activeSkill = 4;
      state.challenge!.resumeAt = 4;
      state.pendingAttack = {
        attacker: 'B',
        value: 6,
        unblockable: false,
        physical: false,
        baseValue: 6,
        sourceDieId: 'bx1',
        dieStyle: 'solid',
      };
      const { root, hooks } = mount(state);
      const sel = '.panel--challenge .area[data-kind="attack"] .die[data-id="bx1"]';
      expect(root.querySelector(sel)).not.toBeNull(); // ① 渲染当下还在（等到"开飞"才排除）
      vi.advanceTimersByTime(5000); // ② 推进到"开飞那一刻"
      expect(root.querySelector(sel)).toBeNull(); // 当场就没了（治"停留"）
      renderGame(state, root, hooks); // ③ 再重绘（＝挑战者点抵挡/不抵挡那一帧）
      expect(root.querySelector(sel)).toBeNull(); // 仍然没有（治"复活"）
    } finally {
      vi.useRealTimers();
    }
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

  it('右键卡图缩略 → 打开技能详情浮窗；关闭后消失（不再显示整张大图）', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });
    const { root } = mount(state);
    const thumb = root.querySelector('[data-act="challengeSkillsOpen"]') as HTMLElement;
    thumb.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    const overlay = root.querySelector('[data-act="challengeSkillsOverlay"]');
    expect(overlay).not.toBeNull();
    expect(overlay!.querySelector('img')).toBeNull(); // 不再显示整张大图
    expect(overlay!.textContent).toContain('锋芒');
    (root.querySelector('[data-act="challengeSkillsClose"]') as HTMLElement).click();
    expect(root.querySelector('[data-act="challengeSkillsOverlay"]')).toBeNull();
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

describe('挑战模式 · 面板细节（尘落徽标 / 锋芒常亮）', () => {
  it('挑战模式：操作栏不渲染「尘落」徽标；标准模式仍渲染', () => {
    const c = mount(createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] }));
    expect(c.root.querySelector('.hint-dust')).toBeNull();
    const s = mount(createGame({ seed: 1, firstPlayer: 'A' }));
    expect(s.root.querySelector('.hint-dust')).not.toBeNull();
  });

  it('持续生效：Z02「锋芒」计数>0 → 该行 is-on + 药丸「生效中」；计数=0 不亮', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });
    state.challenge!.count = 0;
    let { root } = mount(state);
    let row = Array.from(root.querySelectorAll('.panel--challenge .challenge-skill')).find((r) =>
      r.textContent.includes('锋芒'),
    ) as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.classList.contains('is-on')).toBe(false);

    state.challenge!.count = 2;
    ({ root } = mount(state));
    row = Array.from(root.querySelectorAll('.panel--challenge .challenge-skill')).find((r) =>
      r.textContent.includes('锋芒'),
    ) as HTMLElement;
    expect(row.classList.contains('is-on')).toBe(true);
    expect(row.querySelector('.csk-on-pill')?.textContent).toBe('生效中');
  });

  it('操作栏：B 侧称「昔日传奇」（非「玩家B」）；昔传技能名用其玩家色 player-B；A 侧仍「玩家A」', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });
    state.activePlayer = 'B';
    state.challenge!.resumeAt = 1;
    state.challenge!.activeSkill = 1; // 锋芒
    const { root } = mount(state);
    const hint = root.querySelector('.hint') as HTMLElement;
    const who = hint.querySelector('.hint-player') as HTMLElement;
    expect(who.textContent).toBe('昔日传奇');
    expect(who.classList.contains('player-B')).toBe(true);
    // "正在结算"的技能名：用昔传玩家色（裸名）
    const phaseSkill = hint.querySelector('.hint-phase .hint-skill.player-B') as HTMLElement;
    expect(phaseSkill).not.toBeNull();
    expect(phaseSkill.textContent).toBe('锋芒');
    // 挑战者(A)仍是「玩家A」、蓝色
    const aWho = root.querySelector('.lifeline-who.player-A') as HTMLElement;
    expect(aWho.textContent).toBe('玩家A');
  });

  it('挑战：设置旁显示当前「结算模式」徽标（自选/有利/不利）', () => {
    const fav = mount(
      createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'], settleMode: 'favor' }),
    );
    const badge = fav.root.querySelector('.settle-mode-badge') as HTMLElement;
    expect(badge.textContent).toBe('结算：有利');
    expect(badge.dataset.settle).toBe('favor');

    const man = mount(createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] }));
    expect((man.root.querySelector('.settle-mode-badge') as HTMLElement).textContent).toBe('结算：自选');
  });
});

describe('挑战模式 · 被攻击提示（遁入暗影 / 加伤 / 第 K/N 次）', () => {
  it('昔传发起攻击时（等你选是否抵挡）：提示"攻击 + 加成 + 第 K/N 次"，**不再**显示"正在结算"', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });
    state.activePlayer = 'B';
    state.challenge!.resumeAt = 5; // 遁入暗影
    state.challenge!.activeSkill = 5;
    state.challenge!.count = 1; // 锋芒 +1
    state.pendingAttack = {
      attacker: 'B',
      value: 3,
      unblockable: false,
      physical: false,
      baseValue: 2,
      sourceSkill: '遁入暗影',
      sourceSkillOwner: 'B',
      bonusValue: 1,
      bonusLabel: '传奇锋芒',
      legendGroup: { index: 1, total: 2 },
    };
    const { root } = mount(state);
    const hint = (root.querySelector('.hint') as HTMLElement).textContent ?? '';
    expect(hint).toContain('发起攻击'); // 攻击提示显示出来了（原被"正在结算"盖住）
    expect(hint).toContain('加成 1 伤害'); // 加伤可见
    expect(hint).toContain('（第 1 / 2 次）'); // 遁入暗影的 K/N 序号
    expect(hint).not.toContain('正在结算'); // 不再被"正在结算"遮蔽
  });

  it('昔传仅"结算中"（未发起攻击）：提示栏仍显示"正在结算：遁入暗影"（原行为不变）', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });
    state.activePlayer = 'B';
    state.challenge!.resumeAt = 5;
    state.challenge!.activeSkill = 5;
    const { root } = mount(state);
    const hint = (root.querySelector('.hint') as HTMLElement).textContent ?? '';
    expect(hint).toContain('正在结算');
    expect(hint).toContain('遁入暗影');
  });
});
