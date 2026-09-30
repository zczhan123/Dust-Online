import { describe, it, expect, vi } from 'vitest';
import { createGame, applyAction, skipInitialReroll, getLegalActions } from '../src/core/engine/game';
import { hasActiveSkill } from '../src/core/engine/skill-state';
import { battleNotes } from '../src/core/engine/battleNotes';
import { ARTIFACTS } from '../src/core/content/artifacts';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import type { Action, GameState, PlayerId } from '../src/core/model/types';

/**
 * A02 深红（异相）：真实之剑（持续·左，复用 010 的 key `shenhong.sword`）+
 * 哀悼（触发·右，`shenhong.alt.aidao`：补充 ≤3 → 2 真伤 + 弃置对方 1 个防御骰）。
 * 全部使用**真实内容数据**（A02 已带 skills），不再注入。
 */

const baseGame = (): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['A02', '002', '003'], heroB: ['004', '005', '006'] });
  skipInitialReroll(g);
  return g;
};
const art = (g: GameState, who: PlayerId, id: string) => g.players[who].artifacts.find((a) => a.id === id)!;
const arm = (g: GameState, who: PlayerId, id: string, side: 'left' | 'right'): void => {
  const a = art(g, who, id);
  a.activeMarkerSide = side;
  a.armedSide = side;
  a.armedTurn = g.turnIndex;
};
const toMain = (g: GameState): void => {
  g.phase = 'main';
  g.pending = null;
  g.pendingAttack = null;
  g.skillsUsedThisTurn = [];
};

const advanceUntilPending = (g: GameState): void => {
  let guard = 0;
  while (!g.pending && g.phase !== 'gameOver' && guard++ < 60) applyAction(g, { t: 'advance' });
};

const logs = (g: GameState): string => g.log.map((l) => l.text).join('\n');

describe('A02 深红（异相）·内容数据守卫', () => {
  it('skills 精确登记：左「真实之剑」同 key 复用 010；右「哀悼」独立 key', () => {
    expect(ARTIFACTS['A02'].skills).toEqual([
      { side: 'left', kind: 'continuous', key: 'shenhong.sword' },
      { side: 'right', kind: 'trigger', key: 'shenhong.alt.aidao' },
    ]);
  });
});

describe('A02 深红（异相）·哀悼（触发）', () => {
  it('触发：右侧激活且补充 ≤3（速度 3）→ 弹出 aidao', () => {
    const g = baseGame();
    arm(g, 'A', 'A02', 'right');
    advanceUntilPending(g);
    expect(g.pending).toMatchObject({ kind: 'aidao', player: 'A' });
  });

  it('不触发：左侧未激活 / 右侧未激活时不弹出 aidao', () => {
    // 完全未激活
    const g1 = baseGame();
    advanceUntilPending(g1);
    expect(g1.pending?.kind).not.toBe('aidao');

    // 仅左侧（真实之剑）激活
    const g2 = baseGame();
    arm(g2, 'A', 'A02', 'left');
    advanceUntilPending(g2);
    expect(g2.pending?.kind).not.toBe('aidao');
  });

  it('不触发：实际补充 = 4 时（速度 4 / 意志 30）', () => {
    const g = baseGame();
    arm(g, 'A', 'A02', 'right');
    const a = art(g, 'A', 'A02');
    a.speed = 4;
    a.will = 30; // 保证补充 = min(4, 30-现有) = 4
    advanceUntilPending(g);
    expect(g.pending?.kind).not.toBe('aidao');
  });

  it('接受：2 点真实伤害 + 弃置对方 1 个防御骰（由持有者选、只限区域内）', () => {
    const g = baseGame();
    g.players.B.areas.defense = [
      { id: 'bd1', value: 3, kind: 'defense' },
      { id: 'bd2', value: 5, kind: 'defense' },
    ];
    g.players.B.areas.meditation = [];
    g.players.B.areas.attack = [];
    g.pending = { kind: 'aidao', player: 'A' };
    // 精确：有防御骰时**不给**"不弃骰"的发动选项，只有"不发动" + 每颗防御骰一个（由持有者选）
    expect(getLegalActions(g)).toEqual([
      { t: 'aidao', accept: false },
      { t: 'aidao', accept: true, defenseDieId: 'bd1' },
      { t: 'aidao', accept: true, defenseDieId: 'bd2' },
    ]);
    const life0 = g.players.B.life;
    applyAction(g, { t: 'aidao', accept: true, defenseDieId: 'bd2' });
    expect(g.players.B.life).toBe(life0 - 2);
    expect(g.players.B.areas.defense.map((d) => d.id)).toEqual(['bd1']);
  });

  it('有防御骰却未指定要弃哪颗 → 抛错且不改状态（"尽可能执行"）', () => {
    const g = baseGame();
    g.players.B.areas.defense = [{ id: 'bd1', value: 3, kind: 'defense' }];
    g.pending = { kind: 'aidao', player: 'A' };
    const life0 = g.players.B.life;
    expect(() => applyAction(g, { t: 'aidao', accept: true })).toThrow();
    expect(g.pending).toMatchObject({ kind: 'aidao', player: 'A' }); // 待决策仍在
    expect(g.players.B.life).toBe(life0);
    expect(g.players.B.areas.defense).toHaveLength(1);
  });

  it('对方无防御骰：仅"不发动/发动（仅扣血）"，发动只造成 2 点真实伤害', () => {
    const g = baseGame();
    g.players.B.areas.defense = [];
    g.pending = { kind: 'aidao', player: 'A' };
    expect(getLegalActions(g)).toEqual([
      { t: 'aidao', accept: false },
      { t: 'aidao', accept: true },
    ]);
    const life0 = g.players.B.life;
    applyAction(g, { t: 'aidao', accept: true });
    expect(g.players.B.life).toBe(life0 - 2);
  });

  it('不发动：无任何副作用', () => {
    const g = baseGame();
    g.players.B.areas.defense = [{ id: 'bd1', value: 3, kind: 'defense' }];
    g.pending = { kind: 'aidao', player: 'A' };
    const life0 = g.players.B.life;
    applyAction(g, { t: 'aidao', accept: false });
    expect(g.players.B.life).toBe(life0);
    expect(g.players.B.areas.defense).toHaveLength(1);
  });
});

describe('A02 深红（异相）·§19 六项必查', () => {
  it('§19⑥ 034 破障兼容：存放骰不属任何区域 → 不能作为哀悼的弃置目标', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['A02', '002', '003'], heroB: ['034', '002', '003'] });
    skipInitialReroll(g);
    arm(g, 'A', 'A02', 'right');
    const b034 = art(g, 'B', '034');
    b034.activeMarkerSide = 'left'; // 破障（持续）生效
    b034.heldDice = [{ id: 'B-034-j3-0', value: 3 }]; // 不在区域
    advanceUntilPending(g);
    expect(g.pending).toMatchObject({ kind: 'aidao', player: 'A' });
    g.players.B.areas.defense = [{ id: 'bd1', value: 3, kind: 'defense' }];

    const legal = getLegalActions(g);
    const dieActions = legal.filter(
      (a): a is Extract<Action, { t: 'aidao' }> => a.t === 'aidao' && a.accept && !!a.defenseDieId,
    );
    // 精确集合：只有 B 区域的防御骰，绝不含 034 存放骰
    expect(dieActions.map((a) => a.defenseDieId)).toEqual(['bd1']);
    expect(legal).not.toContainEqual({ t: 'aidao', accept: true, defenseDieId: 'B-034-j3-0' });
  });

  it('§19① 真实之剑置换：A02 左侧激活 = key shenhong.sword 生效，可用 2 颗任意骰顶 1 格支付「龙腾万丈」', () => {
    const g = baseGame();
    toMain(g);
    arm(g, 'A', 'A02', 'left'); // 真实之剑（与 010 同 key）
    arm(g, 'A', '002', 'right'); // 龙腾万丈（消耗 3 冥想骰）
    g.players.A.areas.meditation = [{ id: 'm1', value: 5, kind: 'meditation' }];
    g.players.A.areas.attack = [
      { id: 'a1', value: 1, kind: 'attack' },
      { id: 'a2', value: 2, kind: 'attack' },
    ];
    g.players.A.areas.defense = [
      { id: 'd1', value: 3, kind: 'defense' },
      { id: 'd2', value: 4, kind: 'defense' },
    ];
    expect(hasActiveSkill(g.players.A, 'shenhong.sword')).toBe(true);

    applyAction(g, {
      t: 'skill',
      artifactId: '002',
      side: 'right',
      params: {
        // 1 真冥想 + 2 组置换（各 2 颗任意骰）
        costSlots: [{ dieIds: ['m1'] }, { dieIds: ['a1', 'a2'] }, { dieIds: ['d1', 'd2'] }],
      },
    });
    // 5 颗旧骰全部消耗，获得 4 颗新骰
    expect(g.players.A.areas.meditation).toHaveLength(0);
    expect(g.players.A.areas.attack.length + g.players.A.areas.defense.length).toBe(4);
    expect(logs(g)).toContain('真实之剑');
  });

  it('§19① 反证：未激活真实之剑时，同上「2 颗顶 1」支付被拒绝且不改状态', () => {
    const g = baseGame();
    toMain(g);
    arm(g, 'A', 'A02', 'right'); // 哀悼侧 → 真实之剑不生效
    arm(g, 'A', '002', 'right');
    g.players.A.areas.meditation = [{ id: 'm1', value: 5, kind: 'meditation' }];
    g.players.A.areas.attack = [
      { id: 'a1', value: 1, kind: 'attack' },
      { id: 'a2', value: 2, kind: 'attack' },
    ];
    g.players.A.areas.defense = [
      { id: 'd1', value: 3, kind: 'defense' },
      { id: 'd2', value: 4, kind: 'defense' },
    ];
    expect(hasActiveSkill(g.players.A, 'shenhong.sword')).toBe(false);
    expect(() =>
      applyAction(g, {
        t: 'skill',
        artifactId: '002',
        side: 'right',
        params: {
          costSlots: [{ dieIds: ['m1'] }, { dieIds: ['a1', 'a2'] }, { dieIds: ['d1', 'd2'] }],
        },
      }),
    ).toThrow();
    expect(g.players.A.areas.meditation.map((d) => d.id)).toEqual(['m1']);
    expect(g.players.A.areas.attack.map((d) => d.id)).toEqual(['a1', 'a2']);
    expect(g.players.A.areas.defense.map((d) => d.id)).toEqual(['d1', 'd2']);
  });

  it('同名互不影响：A 持 A02、B 持 010（同 key）→ 各自激活状态互不串', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['A02', '002', '003'], heroB: ['010', '002', '003'] });
    skipInitialReroll(g);
    const a02 = art(g, 'A', 'A02');
    const s10 = art(g, 'B', '010');
    expect(hasActiveSkill(g.players.A, 'shenhong.sword')).toBe(false);
    expect(hasActiveSkill(g.players.B, 'shenhong.sword')).toBe(false);

    a02.activeMarkerSide = 'left';
    expect(hasActiveSkill(g.players.A, 'shenhong.sword')).toBe(true);
    expect(hasActiveSkill(g.players.B, 'shenhong.sword')).toBe(false); // B 不受影响

    a02.activeMarkerSide = null;
    s10.activeMarkerSide = 'left';
    expect(hasActiveSkill(g.players.A, 'shenhong.sword')).toBe(false); // A 不受影响
    expect(hasActiveSkill(g.players.B, 'shenhong.sword')).toBe(true);
  });
});

describe('A02 深红（异相）·battleNotes', () => {
  it('持续是支付能力、哀悼是补充阶段触发 → 主阶段不产生 A02 相关战斗提示', () => {
    const g = baseGame();
    toMain(g);
    arm(g, 'A', 'A02', 'left'); // 即便真实之剑激活
    expect(g.activePlayer).toBe('A');
    expect(g.pendingAttack).toBeNull();
    const notes = battleNotes(g, 'A');
    expect(notes.some((n) => n.label === '真实之剑' || n.label === '哀悼' || n.text.includes('哀悼') || n.text.includes('真实之剑'))).toBe(false);
    expect(notes).toEqual([]);
  });
});

describe('A02 深红（异相）·UI', () => {
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

  const mount = (state: GameState): { root: HTMLElement; ui: UiState; onAction: ReturnType<typeof vi.fn> } => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const ui = freshUi();
    const onAction = vi.fn();
    const hooks: RenderHooks = {
      onAction,
      ui,
      propose: (action, label) => {
        ui.pendingConfirm = { action, label };
        renderGame(state, root, hooks);
      },
      requestRender: () => renderGame(state, root, hooks),
      onRestart: () => {},
    };
    renderGame(state, root, hooks);
    return { root, ui, onAction };
  };

  it('提示语 + 按钮（精确）：不发动 / 每颗对方防御骰一个骰片（无"保留/不弃骰"选项）', () => {
    const g = baseGame();
    g.players.B.areas.defense = [
      { id: 'bd1', value: 3, kind: 'defense' },
      { id: 'bd2', value: 5, kind: 'defense' },
    ];
    g.pending = { kind: 'aidao', player: 'A' };
    const { root, onAction } = mount(g);

    expect(root.querySelector('.hint-phase')!.textContent).toContain('哀悼');

    // 纯文字按钮：只剩"不发动"（带 defenseDieId 的一律走骰片；有骰时不再给"不弃骰"的发动项）
    const labels = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).map((b) => b.textContent);
    expect(labels.filter((l) => (l ?? '').includes('哀悼'))).toEqual(['不发动「哀悼」']);

    // 骰片：对方防御骰以骰片呈现（防3 / 防5），点击 → 确认 → 派发
    const chip = root.querySelector<HTMLElement>('.actionlist-chips .pay-die[data-id="bd1"]')!;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toBe('防3');
    expect(chip.classList.contains('die-B')).toBe(true);
    expect(root.querySelector('.actionlist-chips .pay-die[data-id="bd2"]')!.textContent).toBe('防5');

    chip.click();
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-confirm')!.click();
    expect(onAction).toHaveBeenCalledWith({ t: 'aidao', accept: true, defenseDieId: 'bd1' });
  });
});
