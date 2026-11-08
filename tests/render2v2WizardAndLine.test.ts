// 2v2：① 技能向导走完不能留下"僵尸面板"（灵能脉冲后操作栏全空的事故）；
//       ② 换视角时黑线不能在旧朝向下画（否则镜像后看起来从守方区域飞出）。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createTwoVTwoGame, applyAction } from '../src/core/engine/game';
import { render2v2Game } from '../src/ui/battle2v2View';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';

const setup = (): TwoVTwoSetup => ({
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

describe('2v2 技能向导：派发后不许留"只有标题、没有按钮"的僵尸面板', () => {
  it('灵能脉冲·激活 → 触发 pending(dunwuPulse) → 操作栏必须摆出待决策（不能全空）', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.phase = 'main';
    state.activePlayer = 'A1';
    state.stance = 'attackPicks';
    const art = state.players.A1.artifacts.find((a) => a.id === '011')!;
    art.activeMarkerSide = 'right'; // 右侧＝灵能脉冲（启动 + 触发）都生效
    state.players.A1.areas.attack = [
      { id: 'at1', value: 3, kind: 'attack' },
      { id: 'at2', value: 4, kind: 'attack' },
    ] as never;

    // 模拟 main.ts：派发 → 引擎 → 整页重建（这正是当初暴露 bug 的路径）
    const render = (): void =>
      render2v2Game(root, state, {
        onAction: (a) => {
          applyAction(state, a as never);
          render();
        },
        onBack: () => {},
      });
    render();

    const skill = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).find(
      (b) => b.textContent === '启动技能：灵能脉冲',
    )!;
    expect(skill).toBeTruthy();
    skill.click();
    root.querySelector<HTMLElement>('.selector .pay-dice [data-id="at1"]')!.click();
    root.querySelector<HTMLButtonElement>('.selector .btn-skill')!.click();

    // 引擎侧：确实进入了灵能脉冲·触发的待决策
    expect(state.pending?.kind).toBe('dunwuPulse');

    // 界面侧：没有僵尸向导；待决策＝「目标 [B1] [B2] [不发动「灵能脉冲」]」一行
    expect(root.querySelector('.selector')).toBeNull();
    const decide = root.querySelector<HTMLElement>('.actionlist .option-row--decide');
    expect(decide).not.toBeNull();
    const choices = Array.from(decide!.querySelectorAll<HTMLElement>('[data-choice]')).map(
      (b) => b.dataset.choice,
    );
    expect(choices).toEqual(['B1', 'B2', 'decline']);
    expect(root.querySelector('.actionlist')!.textContent).toContain('不发动「灵能脉冲」');
    // 操作栏不许是空的
    expect(root.querySelectorAll('.actionlist button').length).toBeGreaterThan(0);
  });
});

describe('2v2 黑线：换视角帧不画，切完在新朝向下补画（源码门禁）', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../src/ui/battle2v2View.ts'),
    'utf8',
  );

  it('黑线在攻击起步时画（不再有"切完补画" / deferLine）', () => {
    expect(src).not.toContain('deferLine');
    expect(src).not.toContain('drawAttackLine(root, paNow.attacker');
    // 攻击起步显式画线（默认 true）
    expect(src).toContain('line: true,');
    // 换视角仍然等本帧动画（含黑线）播完
    expect(src).toContain('run2v2Motions(root, state, prevDice, prevStored, fxEvents, lifeDeltas, deferAdds)');
    expect(src).toContain('window.setTimeout(finishViewSwitch, Math.max(0, settle) + 20);');
  });

  it('两行布局只由 2v2 传（1v1 不传 layout → 仍是单行 DOM）', () => {
    const r = fs.readFileSync(path.resolve(__dirname, '../src/ui/render.ts'), 'utf8');
    const v = fs.readFileSync(path.resolve(__dirname, '../src/ui/battle2v2View.ts'), 'utf8');
    expect(v).toContain("{ layout: 'stacked' }");
    expect(r).not.toContain("layout: 'stacked'");
  });
});

describe('2v2 置换支付动画：不许盖住停在中间的攻击骰（源码门禁）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../src/ui/battle2v2View.ts'), 'utf8');
  const motion = fs.readFileSync(path.resolve(__dirname, '../src/ui/motion.ts'), 'utf8');
  const render = fs.readFileSync(path.resolve(__dirname, '../src/ui/render.ts'), 'utf8');

  it('抵挡支付被识别成 blockPay/blockSub，并交给攻击池（不画单颗防御骰）', () => {
    expect(src).toContain('const blockSub = blockPay ? subOf(blockPay) : null;');
    expect(src).toContain('substitution: blockSub,');
    expect(src).toContain('blockDie: blockSub ? null :');
    // 抵挡那笔支付必须排除出通用 playPayments，否则会在中间合并成灰 5 盖住攻击骰
    expect(src).toContain('p !== attackPay && p !== blockPay');
  });

  it('其余支付（灵能屏障/触发置换）在有攻击骰停着时右移一格（1v1 / 2v2 共用）', () => {
    expect(motion).toContain('const shift = attackPool ? (DIE_W + DIE_GAP) / 2 : 0;');
    // 两个模式都走同一个默认行为（不再需要调用方传参）
    expect(src).toContain('playPayments(root, otherPays)');
    expect(render).toContain('playPayments(root, otherPays)');
  });
});
