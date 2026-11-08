// 2026-11-08 批：待决策提示的「来源句」+「换视角时序」（全模式共用）。
//
// 用户实测（1v1）：
//   ① 问「高塔铁幕·触发」时，看不出是谁、用哪个技能打的多少真伤 → 提示栏要补来源句；
//   ② 问「灵能屏障·触发」时，看不到"这一刀" → 补与 2v2 守方投票**同一份**的 `attackInfoParts`；
//   ③ 问这两者时，攻击动画 / `-X` 飘字还没播完、画面还停在攻方 → 现在只有**骰子类**动画才值得等。
//
// 本文件锁：文案（三种来源）+ 提示双段 + `holdView` 判定（1v1 源码口径 / 2v2 真实 DOM 行为）。
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyAction, createGame, createTwoVTwoGame, skipInitialReroll } from '../src/core/engine/game';
import { dealTrueDamage } from '../src/core/engine/combat';
import { fxPeek, fxPush, fxReset, fxSetSource, fxTake } from '../src/core/engine/fx';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import { render2v2Game } from '../src/ui/battle2v2View';
import type { Action, GameState } from '../src/core/model/types';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';
import { toMain } from './helpers';

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

const hooksFor = (): RenderHooks => {
  const ui = freshUi();
  return {
    onAction: (_a: Action) => {},
    ui,
    propose: (action, label) => {
      ui.pendingConfirm = { action, label };
    },
    requestRender: () => {},
    onRestart: () => {},
  };
};

const hintOf = (root: HTMLElement): string => root.querySelector('.hint-phase')?.textContent ?? '';

/** B 持 009（三件 only 侧：充能 / 触发 / 必杀）、A 持 004（锋芒在 right 侧）。 */
const guwangGame = (): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '002', '003'], heroB: ['009', '002', '003'] });
  skipInitialReroll(g);
  toMain(g);
  const gw = g.players.B.artifacts.find((a) => a.id === '009')!;
  gw.activeMarkerSide = 'left'; // 009 是 only 侧：只要有标记即视为激活
  g.players.B.areas.defense = [{ id: 'bd', value: 3, kind: 'defense' }];
  return g;
};

describe('009 高塔铁幕：询问时先写清"谁发动了什么、多少真伤"', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
  });

  it('神器来源 →「玩家A 发动「锋芒」，对你造成 2 点真实伤害；高塔铁幕：…」', () => {
    const g = guwangGame();
    fxReset();
    fxSetSource({ player: 'A', artifactId: '004', side: 'right', skillKey: 'fengmang.trigger' });
    dealTrueDamage(g, 'B', 2, 'A');
    expect(g.pending?.kind).toBe('guwangCancel');
    renderGame(g, root, hooksFor());
    const hint = hintOf(root);
    expect(hint).toContain('玩家A');
    expect(hint).toContain('发动「锋芒」，');
    expect(hint).toContain('对你造成 2 点真实伤害；');
    expect(hint).toContain('高塔铁幕：可消耗 1 个防御骰取消。');
    // 技能名按**所属方**上色（神器持有人 A → 蓝）
    expect(root.querySelector('.hint-phase .hint-skill.player-A')).not.toBeNull();
  });

  it('战术牌来源 → 用战术牌名（T08 无情）', () => {
    const g = guwangGame();
    fxReset();
    fxSetSource({ player: 'A', tacticId: 'T08' });
    dealTrueDamage(g, 'B', 2, 'A');
    renderGame(g, root, hooksFor());
    const hint = hintOf(root);
    expect(hint).toContain('发动「无情」，');
    expect(hint).toContain('对你造成 2 点真实伤害；');
  });

  it('没有来源信息 → 退回原文案（不出现"发动「」"这种空名）', () => {
    const g = guwangGame();
    fxReset();
    dealTrueDamage(g, 'B', 2, 'A');
    renderGame(g, root, hooksFor());
    const hint = hintOf(root);
    expect(hint).toBe('高塔铁幕：受到 2 点真实伤害，可消耗 1 个防御骰取消。');
    expect(hint).not.toContain('发动');
  });
});

describe('011 灵能屏障：询问时先说清"这一刀"（与 2v2 投票同一份文案）', () => {
  it('提示栏 = 攻击信息 + ｜ + 灵能屏障', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['011', '002', '003'] });
    skipInitialReroll(g);
    toMain(g);
    const dw = g.players.B.artifacts.find((a) => a.id === '011')!;
    dw.activeMarkerSide = 'left'; // 左＝灵能屏障·触发
    g.players.A.areas.attack = [{ id: 'a-atk', value: 3, kind: 'attack' }];
    g.players.B.areas.meditation = [{ id: 'b-med', value: 5, kind: 'meditation' }];
    g.activePlayer = 'A';

    // 发起攻击 → 引擎挂起 «dunwuHalve»（011 屏障）
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a-atk'] }] } as Action);
    expect(g.pending?.kind).toBe('dunwuHalve');
    expect(g.pendingAttack).not.toBeNull();

    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    renderGame(g, root, hooksFor());
    const hint = hintOf(root);
    // 1) "这一刀"：攻击方名字 + 点数 + 伤害（与 2v2 投票面板同源 `attackInfoParts`）
    expect(hint).toContain('玩家A');
    expect(hint).toContain('用 3 点攻击骰攻击');
    expect(hint).toContain('预计 3 伤害');
    // 2) 分隔 + 屏障怎么用
    expect(hint).toContain('｜');
    expect(hint).toContain('灵能屏障：可消耗 1 个冥想骰，使本次攻击伤害减半。');
    // 顺序：先"这一刀"，再"灵能屏障"
    expect(hint.indexOf('攻击骰攻击')).toBeLessThan(hint.indexOf('灵能屏障'));
  });
});

describe('换视角时序：只有骰子类动画才"先播完再切"', () => {
  it('1v1 源码口径：`holdView` 不再因"只有生命浮动"而延迟（去掉 lifeItems）', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'ui', 'render.ts'), 'utf8');
    const at = src.indexOf('const holdView =');
    expect(at).toBeGreaterThan(0);
    const block = src.slice(at, src.indexOf('const renderSelf', at));
    // 生命浮动仍在 `willAnimate` 里（浮动照播），但**不得**作为"必须等"的理由
    expect(block).not.toContain('lifeItems');
    expect(block).toContain('attackChanging');
    expect(block).toContain('hasBubble');
  });

  it('fxPeek 只读：不消费缓冲区（否则 2v2 的 holdView 判定会把动画事件吃掉）', () => {
    fxReset();
    fxPush({ kind: 'reroll', player: 'A', dieIds: ['x'] });
    expect(fxPeek()).toHaveLength(1);
    expect(fxPeek()).toHaveLength(1); // 连续 peek 不变
    expect(fxTake()).toHaveLength(1);
    expect(fxPeek()).toHaveLength(0);
  });

  const setup2v2 = (): TwoVTwoSetup => ({
    seats: {
      A1: ['010', '011', '012'],
      A2: ['001', '002', '003'],
      B1: ['004', '005', '006'],
      B2: ['007', '008', '009'],
    },
    firstTeam: 'A',
    seed: 7,
    dice: {
      A1: { attack: [3, 4], defense: [2], meditation: [] },
      B1: { attack: [], defense: [], meditation: [] },
      B2: { attack: [], defense: [], meditation: [] },
    },
  });

  const mount2v2 = (g: GameState, root: HTMLElement) =>
    render2v2Game(root, g, { onAction: (a) => void a, onBack: () => {} });

  /** 屏幕座位顺序：先上排（两人），后下排（两人）。 */
  const seatOrder = (root: HTMLElement): string[] =>
    Array.from(root.querySelectorAll<HTMLElement>('.main > .side-row .player[data-player]')).map(
      (p) => p.dataset.player ?? '',
    );

  it('2v2：待决策出现、这一帧**只有生命变化** → 立即切到决策方（不等）', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const g = createTwoVTwoGame(setup2v2());
    g.phase = 'main';
    g.activePlayer = 'A1';
    mount2v2(g, root);
    expect(seatOrder(root)).toEqual(['B1', 'B2', 'A2', 'A1']);

    // 009 询问（决策人 B2）——没有任何骰子变化
    g.pending = { kind: 'guwangCancel', player: 'B2', amount: 2, source: 'A1' } as never;
    mount2v2(g, root);
    expect(seatOrder(root)).toEqual(['A2', 'A1', 'B1', 'B2']);
  });

  it('2v2：这一帧有骰子被消耗 → 仍"先播完再切"（旧视角保留）', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const g = createTwoVTwoGame(setup2v2());
    g.phase = 'main';
    g.activePlayer = 'A1';
    mount2v2(g, root);
    expect(seatOrder(root)).toEqual(['B1', 'B2', 'A2', 'A1']);

    // 同上出现待决策，但这一帧还有"骰子被消耗"（A1 的防御骰消失）
    g.pending = { kind: 'guwangCancel', player: 'B2', amount: 2, source: 'A1' } as never;
    g.players.A1.areas.defense = [];
    mount2v2(g, root);
    // 仍在旧视角（A 队在下），等动画播完再切
    expect(seatOrder(root)).toEqual(['B1', 'B2', 'A2', 'A1']);
  });
});
