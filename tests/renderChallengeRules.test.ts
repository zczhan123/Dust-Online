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

  it('真实之剑（甲）：源骰在**防御骰区**、飞出去时也要隐去（开飞当场消失、重绘不复活）', () => {
    vi.useFakeTimers();
    try {
      const state = createChallengeGame({ seed: 1, cardId: 'Z04', challenger: ['001', '002', '003'] });
      // 造"真实之剑一次攻击等待响应"的局面：**防御骰区**一颗真骰 + 以它为 sourceDieId 的待抵挡
      state.players.B.areas.attack = [];
      state.players.B.areas.defense = [{ id: 'bd9', value: 6, kind: 'defense' }];
      state.challenge!.activeSkill = 1; // z04-1 真实之剑
      state.pendingAttack = {
        attacker: 'B',
        value: 6,
        unblockable: false,
        physical: false,
        baseValue: 6,
        sourceDieId: 'bd9',
        dieStyle: 'solid',
      };
      const { root, hooks } = mount(state);
      const sel = '.panel--challenge .area[data-kind="defense"] .die[data-id="bd9"]';
      expect(root.querySelector(sel)).not.toBeNull(); // ① 渲染当下还在（等到"开飞"才排除）
      vi.advanceTimersByTime(5000); // ② 推进到"开飞那一刻"
      expect(root.querySelector(sel)).toBeNull(); // 当场就没了（治"停留"）
      renderGame(state, root, hooks); // ③ 再重绘（＝挑战者点抵挡/不抵挡那一帧）
      expect(root.querySelector(sel)).toBeNull(); // 仍然没有（治"复活"）
    } finally {
      vi.useRealTimers();
    }
  });

  it('Z05 绝境天神：「生效中」只随"生命差攻击加成>0"亮/灭（不是常亮）', () => {
    const rowOf = (root: HTMLElement): HTMLElement | null => {
      const rows = Array.from(root.querySelectorAll<HTMLElement>('.challenge-skill'));
      return rows.find((r) => r.querySelector('.csk-name')?.textContent === '绝境天神') ?? null;
    };
    const state = createChallengeGame({ seed: 1, cardId: 'Z05', challenger: ['001', '002', '003'] });
    state.players.B.life = 50;
    let { root } = mount(state);
    expect(rowOf(root)?.classList.contains('is-on')).toBe(false); // 满血 → 不亮

    state.players.B.life = 40; // 低 10 点 → 攻击 +1
    ({ root } = mount(state));
    expect(rowOf(root)?.classList.contains('is-on')).toBe(true);
    expect(rowOf(root)?.querySelector('.csk-on-pill')?.textContent).toBe('生效中');
  });

  it('Z06 无光领域：**不显示「生效中」药丸**（它有自己的触发弹名时机，无需常亮）', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z06', challenger: ['001', '002', '003'] });
    const { root } = mount(state);
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.challenge-skill'));
    const row = rows.find((r) => r.querySelector('.csk-name')?.textContent === '无光领域') ?? null;
    expect(row).toBeTruthy();
    expect(row!.classList.contains('is-on')).toBe(false);
    expect(row!.querySelector('.csk-on-pill')).toBeNull();
    // 指示物徽标照旧（那是另一件事）
    expect(root.querySelector('.challenge-token')?.textContent ?? '').toContain('无光领域指示物');
  });

  it('Z09 威压：卡面级规则 → 该行常亮「生效中」', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z09', challenger: ['001', '002', '003'] });
    const { root } = mount(state);
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.challenge-skill'));
    const row = rows.find((r) => r.querySelector('.csk-name')?.textContent === '威压') ?? null;
    expect(row).toBeTruthy();
    expect(row!.classList.contains('is-on')).toBe(true);
    expect(row!.querySelector('.csk-on-pill')?.textContent).toBe('生效中');
  });

  it('Z09 威压：主要阶段提示栏「威压」按 **B** 上色（对面规则）', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z09', challenger: ['001', '002', '003'] });
    state.phase = 'main';
    state.activePlayer = 'A';
    const { root } = mount(state);
    const notes = root.querySelector('.hint-notes');
    expect(notes).toBeTruthy();
    const skill = notes!.querySelector('.hint-skill.player-B');
    expect(skill?.textContent).toBe('「威压」');
    expect(notes!.textContent).toContain('每次攻击最多造成 4 点伤害');
  });

  it('提示栏：加成来源按"发起攻击方"上色（昔传发起＝B 红）', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z05', challenger: ['001', '002', '003'] });
    state.pendingAttack = {
      attacker: 'B',
      value: 8,
      baseValue: 6,
      bonusValue: 2,
      bonusLabel: '绝境天神',
      unblockable: false,
      physical: false,
      sourceSkill: '数罪并罚',
      sourceSkillOwner: 'B',
    };
    const { root } = mount(state);
    const skills = Array.from(root.querySelectorAll<HTMLElement>('.hint-skill'));
    const label = skills.find((s) => s.textContent === '「绝境天神」');
    expect(label).toBeTruthy();
    expect(label!.classList.contains('player-B')).toBe(true); // 不再素色
  });

  it('Z06 面板：黑白指示物徽标显示当前面（黑底/白底 + 紫字）', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z06', challenger: ['001', '002', '003'] });
    let { root } = mount(state);
    let tok = root.querySelector<HTMLElement>('.challenge-token');
    expect(tok?.textContent).toBe('无光领域指示物·黑');
    expect(tok?.classList.contains('challenge-token--black')).toBe(true);

    state.challenge!.token = 'white';
    ({ root } = mount(state));
    tok = root.querySelector<HTMLElement>('.challenge-token');
    expect(tok?.textContent).toBe('无光领域指示物·白');
    expect(tok?.classList.contains('challenge-token--white')).toBe(true);
  });

  it('Z06 面板：死即新生单独一行（序号 x）、不进技能表；用掉后置灰', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z06', challenger: ['001', '002', '003'] });
    const { root } = mount(state);
    const drow = root.querySelector<HTMLElement>('.challenge-skill--death');
    expect(drow?.querySelector('.csk-no')?.textContent).toBe('x');
    expect(drow?.textContent).toContain('死即新生');
    expect(drow?.classList.contains('is-used')).toBe(false);
    const tableNames = Array.from(root.querySelectorAll('.challenge-skill-table .csk-name')).map((n) => n.textContent);
    expect(tableNames).not.toContain('死即新生'); // 只单独一行、不重复进技能表

    state.challenge!.deathUsed = true;
    const r2 = mount(state);
    expect(r2.root.querySelector<HTMLElement>('.challenge-skill--death')?.classList.contains('is-used')).toBe(true);
  });

  it('Z06 面板：指示物徽标在驱动骰区**最右**（直接子元素、排在骰子容器之后）', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z06', challenger: ['001', '002', '003'] });
    const { root } = mount(state);
    const area = root.querySelector<HTMLElement>('.area--driven')!;
    const last = area.lastElementChild as HTMLElement;
    expect(last.classList.contains('challenge-token')).toBe(true); // 排最后 → 给 margin-left:auto 推到右端
    expect(area.querySelector('.area-label .challenge-token')).toBeNull(); // 不再塞在标题里
  });

  it('提示栏：勾魂镰本回合 +2 伤害可见、技能名按所属方上色', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z06', challenger: ['001', '002', '003'] });
    state.pendingAttack = {
      attacker: 'B',
      value: 8,
      baseValue: 6,
      bonusValue: 2,
      bonusLabel: '勾魂镰·黑',
      unblockable: false,
      physical: false,
      sourceSkill: '勾魂镰·黑',
      sourceSkillOwner: 'B',
    };
    const { root } = mount(state);
    const hint = (root.querySelector('.hint') as HTMLElement).textContent ?? '';
    expect(hint).toContain('（「勾魂镰·黑」加成 2 伤害）');
    const sk = Array.from(root.querySelectorAll<HTMLElement>('.hint-skill')).find((s) => s.textContent === '勾魂镰·黑');
    expect(sk?.classList.contains('player-B')).toBe(true);
  });

  it('提示栏：冥界行走本回合生效时，被攻击提示写明"造成伤害后回复一半生命"', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z06', challenger: ['001', '002', '003'] });
    state.challenge!.mingjieHeal = true;
    state.pendingAttack = {
      attacker: 'B',
      value: 7,
      baseValue: 7,
      unblockable: false,
      physical: false,
      sourceSkill: '勾魂镰·黑',
      sourceSkillOwner: 'B',
    };
    const { root } = mount(state);
    const hint = (root.querySelector('.hint') as HTMLElement).textContent ?? '';
    expect(hint).toContain('（造成伤害后「冥界行走·白」回复该攻击点数一半的生命（向上取整））');
    const sk = Array.from(root.querySelectorAll<HTMLElement>('.hint-skill')).find((s) => s.textContent === '冥界行走·白');
    expect(sk?.classList.contains('player-B')).toBe(true);
  });

  it('挑战面板计数＝与神器 004 同款药丸（`badge badge-count`）；Z07 显示 `N/∞`；围攻单独一行', () => {
    // Z02：计数 3 上限 → 药丸（不再是无圆角/无内边距的裸橙块）
    const z2 = createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });
    z2.challenge!.count = 1;
    const c2 = mount(z2).root.querySelector<HTMLElement>('.panel--challenge .badge-count');
    expect(c2?.classList.contains('badge')).toBe(true);
    expect(c2?.textContent).toBe('计数 1/3');

    // Z07：后端不封顶 → 显示 ∞
    const state = createChallengeGame({ seed: 1, cardId: 'Z07', challenger: ['001', '002', '003'] });
    state.challenge!.count = 2;
    const { root } = mount(state);
    const c7 = root.querySelector<HTMLElement>('.panel--challenge .badge-count');
    expect(c7?.classList.contains('badge')).toBe(true);
    expect(c7?.textContent).toBe('计数 2/∞');
    const drow = root.querySelector<HTMLElement>('.challenge-skill--death');
    expect(drow?.querySelector('.csk-no')?.textContent).toBe('x');
    expect(drow?.textContent).toContain('围攻');
  });

  it('挑战代决·骰片面板：`pick` 类代决渲染骰片、**选满 n 才可确认**（点骰片即选）', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z07', challenger: ['001', '002', '003'] });
    state.players.A.areas.defense = [
      { id: 'd1', value: 1, kind: 'defense' },
      { id: 'd2', value: 1, kind: 'defense' },
      { id: 'd3', value: 1, kind: 'defense' },
      { id: 'd4', value: 1, kind: 'defense' },
    ];
    state.pending = {
      kind: 'challengePick',
      player: 'A',
      prompt: '「蛮王之牙」：弃置挑战者 3 个防御骰',
      options: [{ id: 'd1,d2,d3', label: '防1、防1、防1' }],
      pick: {
        pool: [
          { id: 'd1', value: 1, kind: 'defense' },
          { id: 'd2', value: 1, kind: 'defense' },
          { id: 'd3', value: 1, kind: 'defense' },
          { id: 'd4', value: 1, kind: 'defense' },
        ],
        n: 3,
      },
    };
    const { root } = mount(state);
    const panel = root.querySelector('.actionzone .selector');
    expect(panel).toBeTruthy();
    expect(panel!.querySelectorAll('.pay-dice .pay-die').length).toBe(4);
    // 骰片文案＝「防N」（不是裸数字）
    expect(Array.from(panel!.querySelectorAll('.pay-dice .pay-die')).map((n) => n.textContent)).toEqual(['防1', '防1', '防1', '防1']);
    // 骰片颜色＝**骰子归属**（此处骰子是挑战者的 → 蓝 `die-A`）
    expect(Array.from(panel!.querySelectorAll('.pay-dice .pay-die')).every((n) => n.classList.contains('die-A'))).toBe(true);
    const ok0 = panel!.querySelector<HTMLButtonElement>('[data-act="challengePickConfirm"]')!;
    expect(ok0.disabled).toBe(true); // 未选满

    // 骰区（挑战者防御骰）也**可点**（双入口）
    expect(root.querySelector('.area[data-kind="defense"] .die[data-id="d1"]')?.classList.contains('clickable')).toBe(true);

    // 点 3 颗骰片 → 可确认
    const chips = Array.from(panel!.querySelectorAll<HTMLElement>('.pay-dice .pay-die'));
    chips[0].click();
    chips[1].click();
    chips[2].click();
    const panel2 = root.querySelector('.actionzone .selector')!;
    expect(panel2.querySelectorAll('.pay-dice .pay-die.selected').length).toBe(3);
    const ok2 = panel2.querySelector<HTMLButtonElement>('[data-act="challengePickConfirm"]')!;
    expect(ok2.disabled).toBe(false);
  });

  it('挑战代决·骰片颜色按**骰子归属**：`pick.owner="B"` → 骰片红（传奇自己的骰）', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z07', challenger: ['001', '002', '003'] });
    // 传奇驱动骰（＝要被移动的骰）
    state.challenge!.driven = [
      { id: 'r1', value: 3, kind: 'meditation' },
      { id: 'r2', value: 3, kind: 'meditation' },
      { id: 'r3', value: 5, kind: 'meditation' },
    ];
    state.pending = {
      kind: 'challengePick',
      player: 'A', // 代决者是挑战者
      prompt: '「尘起」：防御骰区还能放 3 颗，请选择移入哪几颗',
      options: [{ id: 'r1,r2,r3', label: '3点、3点、5点' }],
      pick: {
        pool: [
          { id: 'r1', value: 3, kind: 'defense' },
          { id: 'r2', value: 3, kind: 'defense' },
          { id: 'r3', value: 5, kind: 'defense' },
        ],
        n: 3,
        owner: 'B', // ★ 骰子是传奇自己的
      },
    };
    const { root } = mount(state);
    const chips = Array.from(root.querySelectorAll<HTMLElement>('.actionzone .selector .pay-dice .pay-die'));
    expect(chips.length).toBe(3);
    expect(chips.every((c) => c.classList.contains('die-B'))).toBe(true); // 红（按归属）
    expect(chips.some((c) => c.classList.contains('die-A'))).toBe(false); // 不是"代决者 A"的蓝
    // 双入口也按归属：传奇「临时驱动骰区域」里的骰子同样可点
    expect(root.querySelector('.challenge-staging .die[data-id="r1"]')?.classList.contains('clickable')).toBe(true);
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

describe('挑战模式 · 被攻击提示（遁入暗影 / 加伤 / 第 K/N 组）', () => {
  it('昔传发起攻击时（等你选是否抵挡）：提示"攻击 + 加成 + 第 K/N 组"，**不再**显示"正在结算"', () => {
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
    expect(hint).toContain('（第 1 / 2 组）'); // 遁入暗影：每组 1 段 → 只有组序号
    expect(hint).not.toContain('正在结算'); // 不再被"正在结算"遮蔽
  });

  it('电刑/数罪并罚多段：提示"（第 K / N 组 · 本组第 j / m 次）"，技能名按所属方上色', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z05', challenger: ['001', '002', '003'] });
    state.pendingAttack = {
      attacker: 'B',
      value: 3,
      unblockable: false,
      physical: false,
      baseValue: 3,
      sourceSkill: '电刑',
      sourceSkillOwner: 'B',
      legendGroup: { index: 1, total: 2, sub: 3, subTotal: 3 },
    };
    const { root } = mount(state);
    const hint = (root.querySelector('.hint') as HTMLElement).textContent ?? '';
    expect(hint).toContain('（第 1 / 2 组 · 本组第 3 / 3 次）'); // 组 + 组内序号
    const skill = Array.from(root.querySelectorAll<HTMLElement>('.hint-skill')).find(
      (s) => s.textContent === '电刑',
    );
    expect(skill?.classList.contains('player-B')).toBe(true); // 技能名＝昔传(B) 玩家色
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

describe('挑战模式 · Z04 D1（开局选骰）提示栏', () => {
  it('D1 代决：提示栏写「轮到 昔日传奇 操作」+ 原样提示语（不是"玩家A"、无"强制执行"）', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z04', challenger: ['001', '002', '003'] });
    state.pending = {
      kind: 'challengePick',
      player: 'A',
      tag: 'assign',
      prompt: '检测到「梦醒时分」「顿悟」的驱动骰分配有 1 种以上选择，请代决。',
      options: [
        { id: 'd2', label: '梦醒时分吃 4×2点' },
        { id: 'd5', label: '梦醒时分吃 4×5点' },
      ],
    };
    const { root } = mount(state);
    const hint = root.querySelector('.hint') as HTMLElement;
    expect(hint.querySelector('.hint-player')!.textContent).toBe('昔日传奇');
    expect(hint.textContent).toContain('检测到「梦醒时分」「顿悟」的驱动骰分配有 1 种以上选择，请代决。');
    expect(hint.textContent).not.toContain('强制执行');
  });
});
