import { describe, it, expect, vi } from 'vitest';
import { createGame, applyAction, skipInitialReroll } from '../src/core/engine/game';
import { totalDice } from '../src/core/engine/derive';
import { battleNotes } from '../src/core/engine/battleNotes';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import type { GameState, PlayerId } from '../src/core/model/types';

/** A 持 A01/002/003（A01 第三列，002 第二列提供分布），B 默认持 009/002/003 */
const gA01 = (heroB: [string, string, string] = ['009', '002', '003']): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['A01', '002', '003'], heroB });
  skipInitialReroll(g);
  return g;
};

const art = (g: GameState, who: PlayerId, id: string) => g.players[who].artifacts.find((a) => a.id === id)!;

const toMain = (g: GameState): void => {
  let guard = 0;
  while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) applyAction(g, { t: 'advance' });
};

const clear = (g: GameState, who: PlayerId): void => {
  g.players[who].areas.attack = [];
  g.players[who].areas.defense = [];
  g.players[who].areas.meditation = [];
};

/** 把 A01 充到差 1 层，然后在尘起阶段走一次尘起（用 1 冥想骰支付）→ 触发充能（并完成充能） */
const chargeA01 = (g: GameState): void => {
  const a = art(g, 'A', 'A01');
  a.chargeLayer = (a.chargeReq ?? 1) - 1;
  const med = { id: `med-${g.turnIndex}-a01`, value: 4, kind: 'meditation' as const };
  g.players.A.areas.meditation.push(med);
  applyAction(g, { t: 'dustRise', artifactId: 'A01', costSlots: [{ dieIds: [med.id] }] });
};

describe('A01 孤王（异相）·不败之王·充能', () => {
  it('充能触发序列：A 视为 5 点 → B 视为 3 点 ×2，逐次发起、攻击者可不同，最后清空队列', () => {
    const g = gA01();
    clear(g, 'A');
    clear(g, 'B');
    chargeA01(g);
    // 第一次：A 的 5 点虚拟攻击（无实体攻击骰）
    expect(g.pendingAttack).toMatchObject({ attacker: 'A', value: 5, physical: false });
    expect(g.virtualQueue).toHaveLength(2);
    applyAction(g, { t: 'block' }); // B 不抵挡
    // 第二次：B 的 3 点
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', value: 3, physical: false });
    applyAction(g, { t: 'block' }); // A 不抵挡
    // 第三次：B 的 3 点
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', value: 3, physical: false });
    applyAction(g, { t: 'block' }); // A 不抵挡
    expect(g.pendingAttack).toBeNull();
    expect(g.virtualQueue).toBeNull();
  });

  it('逐次结算：B 不抵挡掉 5；A 不抵挡分别掉 3、3（合计 6）', () => {
    const g = gA01();
    clear(g, 'A');
    clear(g, 'B');
    const bLife = g.players.B.life;
    const aLife = g.players.A.life;
    chargeA01(g);
    applyAction(g, { t: 'block' });
    expect(g.players.B.life).toBe(bLife - 5);
    expect(g.players.A.life).toBe(aLife);
    applyAction(g, { t: 'block' });
    expect(g.players.A.life).toBe(aLife - 3);
    applyAction(g, { t: 'block' });
    expect(g.players.A.life).toBe(aLife - 6);
    expect(g.players.B.life).toBe(bLife - 5);
  });

  it('三次攻击都能被防御骰抵挡（抵挡则不造成伤害，且消耗对应防御骰）', () => {
    const g = gA01();
    clear(g, 'A');
    clear(g, 'B');
    g.players.B.areas.defense = [{ id: 'bd', value: 2, kind: 'defense' }];
    g.players.A.areas.defense = [
      { id: 'ad1', value: 3, kind: 'defense' },
      { id: 'ad2', value: 4, kind: 'defense' },
    ];
    const bLife = g.players.B.life;
    const aLife = g.players.A.life;
    chargeA01(g);
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['bd'] }] });
    expect(g.players.B.life).toBe(bLife);
    expect(g.players.B.areas.defense).toHaveLength(0);
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['ad1'] }] });
    expect(g.players.A.life).toBe(aLife);
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['ad2'] }] });
    expect(g.players.A.life).toBe(aLife);
    expect(g.players.A.areas.defense).toHaveLength(0);
    expect(g.virtualQueue).toBeNull();
  });

  it('不消耗骰：充能效果与三段攻击均不使用、不获得任何骰（免费尘起触发，双方区域骰数量不变）', () => {
    const g = gA01();
    toMain(g);
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.meditation = [{ id: 'am', value: 4, kind: 'meditation' }];
    g.players.B.areas.attack = [{ id: 'ba', value: 2, kind: 'attack' }];
    g.freeNoCostRise = 1;
    art(g, 'A', 'A01').chargeLayer = (art(g, 'A', 'A01').chargeReq ?? 1) - 1;
    const beforeA = totalDice(g.players.A);
    const beforeB = totalDice(g.players.B);
    applyAction(g, { t: 'dustRise', artifactId: 'A01', free: true });
    expect(totalDice(g.players.A)).toBe(beforeA);
    expect(totalDice(g.players.B)).toBe(beforeB);
    applyAction(g, { t: 'block' });
    applyAction(g, { t: 'block' });
    applyAction(g, { t: 'block' });
    expect(totalDice(g.players.A)).toBe(beforeA);
    expect(totalDice(g.players.B)).toBe(beforeB);
  });

  it('加成归属：B 的攻击伤害加成只作用于 B 的两次 3 点攻击，不影响 A 的 5 点攻击', () => {
    const g = gA01();
    clear(g, 'A');
    clear(g, 'B');
    g.players.B.buffs.push({ attr: 'attackDamage', add: 2, duration: 'thisTurn', source: '测试' });
    chargeA01(g);
    // A 的第一段：5 点，不因 B 的加成而改变
    expect(g.pendingAttack).toMatchObject({ attacker: 'A', value: 5, bonusValue: 0 });
    applyAction(g, { t: 'block' });
    // B 的两段：3 + 2 = 5
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', value: 5, bonusValue: 2 });
    applyAction(g, { t: 'block' });
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', value: 5, bonusValue: 2 });
    applyAction(g, { t: 'block' });
  });
});

describe('A01 孤王（异相）·不败之王·必杀（复用 009 处理器）', () => {
  it('同名互不影响：A 用 A01 必杀后，B 的 009 必杀仍可使用（按玩家作用域记录）', () => {
    const g = gA01(['009', '002', '003']);
    toMain(g);
    const a01 = art(g, 'A', 'A01');
    a01.activeMarkerSide = 'left';
    a01.armedSide = 'left';
    a01.armedTurn = g.turnIndex;
    applyAction(g, { t: 'skill', artifactId: 'A01', side: 'only' });
    expect(g.ultimatesUsed).toContain('A:guwang.ultimate');
    expect(g.ultimatesUsed).not.toContain('B:guwang.ultimate');

    // B 的 009 未被 A 的 A01 顶掉 → 之后仍能发动其必杀
    toMain(g);
    expect(g.activePlayer).toBe('B');
    const gw = art(g, 'B', '009');
    gw.activeMarkerSide = 'left';
    gw.armedSide = 'left';
    gw.armedTurn = g.turnIndex;
    applyAction(g, { t: 'skill', artifactId: '009', side: 'only' });
    expect(g.ultimatesUsed).toContain('B:guwang.ultimate');
    expect(g.ultimatesUsed).toHaveLength(2);
  });
});

describe('A01 孤王（异相）·battleNotes', () => {
  it('充能是自动结算、非主要阶段可选项 → 不产生任何 A01 相关的主阶段战斗提示', () => {
    const g = gA01();
    toMain(g);
    art(g, 'A', 'A01').activeMarkerSide = 'left';
    expect(g.activePlayer).toBe('A');
    expect(g.pendingAttack).toBeNull();
    const notes = battleNotes(g, 'A');
    expect(notes.filter((n) => n.label === '不败之王' || n.text.includes('不败之王'))).toEqual([]);
    expect(notes).toEqual([]);
  });
});

describe('A01 孤王（异相）·攻击提示（提示栏写明"由该技能引起"）', () => {
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
    detail: null,
    error: null,
  });

  const mount = (state: GameState): HTMLElement => {
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
    return root;
  };

  it('持有者发起段：玩家A「不败之王」发起攻击，本次 5 伤害（无攻击骰）', () => {
    const g = gA01();
    clear(g, 'A');
    clear(g, 'B');
    chargeA01(g);
    const hint = mount(g).querySelector('.hint-phase')!.textContent ?? '';
    expect(hint).toContain('玩家A');
    expect(hint).toContain('「不败之王」发起攻击');
    expect(hint).toContain('本次 5 伤害（无攻击骰）');
  });

  it('他人因效果发起段：玩家B 因对方「不败之王」效果而发起攻击，本次 3 伤害（无攻击骰）', () => {
    const g = gA01();
    clear(g, 'A');
    clear(g, 'B');
    chargeA01(g);
    applyAction(g, { t: 'block' }); // 结算第一段 → 进入 B 的三点攻击
    const hint = mount(g).querySelector('.hint-phase')!.textContent ?? '';
    expect(hint).toContain('玩家B 因对方「不败之王」效果而发起攻击');
    expect(hint).toContain('本次 3 伤害（无攻击骰）');
  });
});
