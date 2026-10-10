import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  HEROES,
  randomColumnPool,
  renderBuildSetup,
  renderChallengeSetup,
  renderHeroSetup,
  renderRotationSetup,
  renderSetup,
  type SetupOptions,
} from '../src/ui/setupScreen';
import { NetSession } from '../src/net/session';
import { InMemoryBus } from '../src/net/memory';
import type { RoomConfig } from '../src/net/protocol';

type El = HTMLElement;
const q = <T extends El = El>(root: El, sel: string): T | null => root.querySelector<T>(sel);
const qa = <T extends El = El>(root: El, sel: string): T[] => Array.from(root.querySelectorAll<T>(sel));
const clickEl = (n: El | null): void => {
  if (!n) throw new Error('missing element');
  n.click();
};
const dbl = (n: El): void => {
  n.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
};
const ab = (root: El, hero: string, side: 'A' | 'B'): El => {
  const n = qa(root, `.pick-ab.${side}`).find((b) => b.dataset.hero === hero);
  if (!n) throw new Error(`missing ab ${hero}/${side}`);
  return n;
};
const candSlotBySrc = (root: El, side: 'A' | 'B', id: string): El | undefined =>
  qa(root, `.pick-col.cand.${side} .pick-slot`).find(
    (s) => s.querySelector('img')?.getAttribute('src') === `./cards/${id}.jpg`,
  );
const colOfId = (id: string): number => {
  for (const k of Object.keys(HEROES) as Array<keyof typeof HEROES>) {
    const i = (HEROES[k] as string[]).indexOf(id);
    if (i >= 0) return i + 1;
  }
  return 0;
};

const HERO_LABEL_ORDER = [
  '雨中剑圣·空',
  '永暗之刃·影',
  '孤塔之王·巴顿二世',
  '地狱的魔女·塔塔萝丝',
  '轰鸣审判官·佐雷',
  '漆黑死神·修',
  '荒野行者·尼萨',
  '黑枪·希瓦',
  '天殇的战鬼·李封',
  '破晓之剑·玛特',
  '受缚邪灵·艾娃',
  '渡世行僧·弥云',
];

let root: El;
beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
});

describe('renderHeroSetup（预设模式 · 3 栏）', () => {
  it('结构：3 栏 / 12 行（单列名 + A/B）/ 顶栏文案 / 附加模组禁用', () => {
    renderHeroSetup(root, () => {});
    expect(root.classList.contains('setup-page')).toBe(true);
    const board = q(root, '.pick-board')!;
    expect(board.classList.contains('yuxuan')).toBe(true);
    expect(board.children).toHaveLength(3);
    expect(qa(root, '.pick-cell')).toHaveLength(12);
    expect(qa(root, '.pick-cell .pick-name').map((n) => n.textContent)).toEqual(HERO_LABEL_ORDER);
    expect(qa(root, '.pick-cell .pick-ab')).toHaveLength(24);
    expect(q(root, '.pick-ttl')!.textContent).toBe('预设模式');
    expect(q(root, '.pick-back')!.textContent).toBe('返回');
    expect(q(root, '.pick-start')!.textContent).toBe('开始游戏');
    // 预设：「使用传奇英雄面板」「使用战术牌」两个开关均可用（战术牌＝进战斗后抽 2 留 1）
    const swLab = (t: string): HTMLElement =>
      qa(root, '.pick-sw .pick-swlab').find((n) => n.textContent === t)!.parentElement!;
    expect(swLab('使用传奇英雄面板').classList.contains('is-disabled')).toBe(false);
    expect(swLab('使用战术牌').classList.contains('is-disabled')).toBe(false);
    expect(qa(root, '.pick-sw.is-disabled')).toHaveLength(0);
    expect(q(root, '.pick-tbtn[data-first="random"]')!.classList.contains('on')).toBe(true);
    expect(qa(root, '.pick-col.confirm.A .pick-slot.empty .pick-colno').map((n) => n.textContent)).toEqual([
      '第一列',
      '第二列',
      '第三列',
    ]);
  });

  it('传奇英雄面板：开关打开且已选英雄 → 确认列头出现迷你头像入口；点击打开面板浮窗', () => {
    renderHeroSetup(root, () => {});
    ab(root, 'kong', 'A').click();
    expect(root.querySelector('.pick-col.confirm.A .pick-legend-chip')).toBeNull();
    qa(root, '.pick-sw .pick-swlab').find((n) => n.textContent === '使用传奇英雄面板')!.parentElement!.click();
    const chip = root.querySelector<HTMLElement>('.pick-col.confirm.A .pick-legend-chip')!;
    expect(chip).not.toBeNull();
    expect(chip.querySelector('img')!.getAttribute('src')).toBe('./legend/L01.jpg');
    expect(chip.querySelector('.pick-legend-lab')!.textContent).toBe('传奇英雄技能');
    chip.click();
    const modal = root.querySelector<HTMLElement>('.pick-modal')!;
    expect(modal.classList.contains('on')).toBe(true);
    expect(modal.querySelector('img')!.getAttribute('src')).toBe('./legend/L01.jpg');
  });

  it('传奇英雄面板弹窗：黑底板头像 + LEGEND_TEXT 技能（弹框缩小）', () => {
    renderHeroSetup(root, () => {});
    ab(root, 'kong', 'A').click();
    qa(root, '.pick-sw .pick-swlab').find((n) => n.textContent === '使用传奇英雄面板')!.parentElement!.click();
    root.querySelector<HTMLElement>('.pick-col.confirm.A .pick-legend-chip')!.click();
    const boxEl = q(root, '.pick-modal-box')!;
    expect(boxEl.classList.contains('legend')).toBe(true);
    const av = boxEl.querySelector('.pick-modal-av')!;
    expect(av).not.toBeNull();
    expect(av.querySelector('img')!.getAttribute('src')).toBe('./legend/L01.jpg');
    expect(qa(boxEl, '.pick-sk-t').map((n) => n.textContent)).toEqual([
      '雨落狂流持续',
      '雨落狂流触发',
      '断苇一斩触发',
    ]);
    expect(qa(boxEl, '.pick-sk-type').map((n) => n.textContent)).toEqual(['持续', '触发', '触发']);
  });

  it('点 A 选定英雄 → 确认列出现其 3 张卡；确定盖章；取消清空', () => {
    renderHeroSetup(root, () => {});
    ab(root, 'kong', 'A').click();
    expect(qa(root, '.pick-col.confirm.A .pick-slot img').map((i) => i.getAttribute('src'))).toEqual([
      './cards/001.jpg',
      './cards/002.jpg',
      './cards/003.jpg',
    ]);
    expect(q(root, '.pick-col.confirm.A .pick-chead .sub')!.textContent).toBe('雨中剑圣·空');
    clickEl(q(root, '.pick-col.confirm.A .pick-ok'));
    expect(qa(root, '.pick-col.confirm.A .pick-seal')).toHaveLength(1);
    clickEl(q(root, '.pick-col.confirm.A .pick-cbtn'));
    expect(qa(root, '.pick-col.confirm.A .pick-slot img')).toHaveLength(0);
    expect(qa(root, '.pick-col.confirm.A .pick-seal')).toHaveLength(0);
  });

  it('同一英雄互斥：A 选 kong 后，B 行 kong 的按钮禁用且不生效', () => {
    renderHeroSetup(root, () => {});
    ab(root, 'kong', 'A').click();
    const bBtn = ab(root, 'kong', 'B');
    expect(bBtn.classList.contains('is-taken')).toBe(true);
    bBtn.click();
    expect(q(root, '.pick-col.confirm.A .pick-chead .sub')!.textContent).toBe('雨中剑圣·空');
    expect(qa(root, '.pick-col.confirm.B .pick-slot img')).toHaveLength(0);
  });

  it('开始游戏：先手与双方英雄正确', () => {
    const onStart = vi.fn();
    renderHeroSetup(root, onStart);
    ab(root, 'kong', 'A').click();
    ab(root, 'ying', 'B').click();
    clickEl(q(root, '.pick-tbtn[data-first="A"]'));
    clickEl(q(root, '.pick-start'));
    expect(onStart).toHaveBeenCalledTimes(1);
    const o = onStart.mock.calls[0][0] as SetupOptions;
    expect(o.heroA).toEqual(['001', '002', '003']);
    expect(o.heroB).toEqual(['004', '005', '006']);
    expect(o.firstPlayer).toBe('A');
  });

  it('传奇英雄面板：开启后 onStart 带上双方面板 id（按所选英雄绑定）', () => {
    const onStart = vi.fn();
    renderHeroSetup(root, onStart);
    qa(root, '.pick-sw .pick-swlab').find((n) => n.textContent === '使用传奇英雄面板')!.parentElement!.click();
    ab(root, 'ying', 'A').click();
    ab(root, 'batton', 'B').click();
    clickEl(q(root, '.pick-tbtn[data-first="A"]'));
    clickEl(q(root, '.pick-start'));
    const o = onStart.mock.calls[0][0] as SetupOptions;
    expect(o.legendA).toBe('L02');
    expect(o.legendB).toBe('L03');
  });

  it('传奇英雄面板：未开启则不带 legend 字段', () => {
    const onStart = vi.fn();
    renderHeroSetup(root, onStart);
    ab(root, 'kong', 'A').click();
    ab(root, 'ying', 'B').click();
    clickEl(q(root, '.pick-tbtn[data-first="A"]'));
    clickEl(q(root, '.pick-start'));
    const o = onStart.mock.calls[0][0] as SetupOptions;
    expect(o.legendA).toBeUndefined();
    expect(o.legendB).toBeUndefined();
  });

  it('未选的一方随机补足，且双方不同英雄', () => {
    const onStart = vi.fn();
    renderHeroSetup(root, onStart);
    ab(root, 'batton', 'A').click();
    clickEl(q(root, '.pick-start'));
    const o = onStart.mock.calls[0][0] as SetupOptions;
    expect(o.heroA).toEqual(['007', '008', '009']);
    expect(new Set(o.heroB).size).toBe(3);
    expect(o.heroB).not.toEqual(['007', '008', '009']);
  });

  it('返回 →「左右互搏」玩法菜单', () => {
    renderHeroSetup(root, () => {});
    clickEl(q(root, '.pick-back'));
    expect(qa(root, '.menu .menu-item .word').map((n) => n.textContent)).toEqual([
      '轮选模式',
      '预设模式',
      '构筑模式',
    ]);
  });
});

describe('renderBuildSetup（构筑模式 · 5 栏）', () => {
  it('结构：5 栏（确认A/候选A/名单/候选B/确认B）；附加=异相/战术', () => {
    renderBuildSetup(root, () => {});
    const board = q(root, '.pick-board')!;
    expect(board.classList.contains('gouzu')).toBe(true);
    const cols = qa(root, '.pick-board > .pick-col').map((c) => c.className);
    expect(cols).toHaveLength(5);
    expect(cols[0]).toContain('confirm');
    expect(cols[0]).toContain('A');
    expect(cols[1]).toContain('cand');
    expect(cols[1]).toContain('A');
    expect(cols[2]).toContain('names');
    expect(cols[3]).toContain('cand');
    expect(cols[3]).toContain('B');
    expect(cols[4]).toContain('confirm');
    expect(cols[4]).toContain('B');
    expect(q(root, '.pick-ttl')!.textContent).toBe('构筑模式');
    expect(qa(root, '.pick-sw.is-disabled .pick-swlab').map((n) => n.textContent)).toEqual([]); // 构筑：异相/战术均已接入
    expect(qa(root, '.pick-sw .pick-swlab').map((n) => n.textContent)).toEqual(['使用异相神器', '使用战术牌']);
    expect(qa(root, '.pick-col.confirm.A .pick-slot.empty .pick-colno').map((n) => n.textContent)).toEqual([
      '第一列',
      '第二列',
      '第三列',
    ]);
  });

  it('点名 → 候选 3 件；选中→确定 → 按列落入确认列', () => {
    renderBuildSetup(root, () => {});
    ab(root, 'kong', 'A').click();
    expect(q(root, '.pick-col.cand.A .pick-chead .sub')!.textContent).toBe('雨中剑圣·空');
    expect(qa(root, '.pick-col.cand.A .pick-slot')).toHaveLength(3);
    candSlotBySrc(root, 'A', '002')!.click();
    expect(candSlotBySrc(root, 'A', '002')!.classList.contains('picked')).toBe(true);
    clickEl(q(root, '.pick-col.cand.A .pick-ok'));
    const slot = q(root, '.pick-col.confirm.A .pick-slot[data-col="2"]')!;
    expect(slot.querySelector('img')!.getAttribute('src')).toBe('./cards/002.jpg');
  });

  it('双击候选卡 = 直接确定', () => {
    renderBuildSetup(root, () => {});
    ab(root, 'ying', 'A').click();
    dbl(candSlotBySrc(root, 'A', '004')!);
    expect(q(root, '.pick-col.confirm.A .pick-slot[data-col="1"] img')!.getAttribute('src')).toBe(
      './cards/004.jpg',
    );
  });

  it('已被选取：一方确定后，另一方候选同名神器显示「已被选取」', () => {
    renderBuildSetup(root, () => {});
    ab(root, 'kong', 'A').click();
    dbl(candSlotBySrc(root, 'A', '001')!);
    ab(root, 'kong', 'B').click();
    expect(qa(root, '.pick-col.cand.B .pick-slot.taken .pick-taken').map((n) => n.textContent)).toEqual([
      '已被选取',
    ]);
  });

  it('满 3 件 → 印章 + 候选列锁定；取消后解除', () => {
    renderBuildSetup(root, () => {});
    ab(root, 'kong', 'A').click();
    dbl(candSlotBySrc(root, 'A', '001')!);
    dbl(candSlotBySrc(root, 'A', '002')!);
    dbl(candSlotBySrc(root, 'A', '003')!);
    expect(qa(root, '.pick-col.confirm.A .pick-seal')).toHaveLength(1);
    expect(q(root, '.pick-col.cand.A')!.classList.contains('locked')).toBe(true);
    clickEl(q(root, '.pick-col.confirm.A .pick-cbtn'));
    expect(qa(root, '.pick-col.confirm.A .pick-seal')).toHaveLength(0);
    expect(q(root, '.pick-col.cand.A')!.classList.contains('locked')).toBe(false);
  });

  it('开始游戏：双方各 3 件、每列一件、六件互不重复（需双方都确定）', () => {
    const onStart = vi.fn();
    renderBuildSetup(root, onStart);
    ab(root, 'kong', 'A').click();
    dbl(candSlotBySrc(root, 'A', '001')!);
    dbl(candSlotBySrc(root, 'A', '002')!);
    dbl(candSlotBySrc(root, 'A', '003')!);
    clickEl(q(root, '.pick-rand.B')); // B 随机补足并确定
    clickEl(q(root, '.pick-start'));
    const o = onStart.mock.calls[0][0] as SetupOptions;
    expect(o.heroA[0]).toBe('001');
    const all = [...o.heroA, ...o.heroB];
    expect(new Set(all).size).toBe(6);
    for (const trio of [o.heroA, o.heroB]) {
      trio.forEach((id, i) => expect(colOfId(id)).toBe(i + 1));
    }
  });

  it('开始游戏门槛（构筑）：双方都确定神器才能开始；缺一方 → 禁用 + 提示', () => {
    const onStart = vi.fn();
    renderBuildSetup(root, onStart);
    ab(root, 'kong', 'A').click();
    dbl(candSlotBySrc(root, 'A', '001')!);
    dbl(candSlotBySrc(root, 'A', '002')!);
    dbl(candSlotBySrc(root, 'A', '003')!);
    expect(q<HTMLButtonElement>(root, '.pick-start')!.disabled).toBe(true); // B 未确定
    expect(q(root, '.pick-start-hint')!.textContent).toContain('神器');
    clickEl(q(root, '.pick-rand.B'));
    expect(q<HTMLButtonElement>(root, '.pick-start')!.disabled).toBe(false);
    expect(q(root, '.pick-start-hint')).toBeNull();
    clickEl(q(root, '.pick-start'));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('开始游戏门槛（构筑·战术牌）：双方都选战术牌才能开始', () => {
    renderBuildSetup(root, () => {});
    const tacticSwitch = qa(root, '.pick-sw .pick-swlab').find((n) => n.textContent === '使用战术牌')!.parentElement!;
    clickEl(tacticSwitch);
    clickEl(q(root, '.pick-rand.A'));
    clickEl(q(root, '.pick-rand.B'));
    expect(q<HTMLButtonElement>(root, '.pick-start')!.disabled).toBe(true); // 战术牌未选
    expect(q(root, '.pick-start-hint')!.textContent).toContain('战术牌');
    clickEl(q(root, '.pick-col.confirm.A .pick-tactic-rand')); // 仅 A 选 → 仍禁用
    expect(q<HTMLButtonElement>(root, '.pick-start')!.disabled).toBe(true);
    clickEl(q(root, '.pick-col.confirm.B .pick-tactic-rand')); // 双方都选 → 可开始
    expect(q<HTMLButtonElement>(root, '.pick-start')!.disabled).toBe(false);
    expect(q(root, '.pick-start-hint')).toBeNull();
  });

  it('使用战术牌（构筑）：确认列下方出「战策榜」；点选后右上角显示卡图，再点取消', () => {
    renderBuildSetup(root, () => {});
    const tacticSwitch = qa(root, '.pick-sw .pick-swlab').find((n) => n.textContent === '使用战术牌')!.parentElement!;
    clickEl(tacticSwitch);
    // 标题行：玩家A 战术牌 + 随机；榜＝18 个名牌
    expect(q(root, '.pick-col.confirm.A .pick-tactic-title')!.textContent).toBe('玩家A 战术牌');
    expect(q(root, '.pick-col.confirm.A .pick-tactic-rand')!.textContent).toContain('随机');
    expect(qa(root, '.pick-col.confirm.A .pick-tactic .pick-tactic-name')).toHaveLength(18);
    // 点第 1 张（谨慎）→ 右上角卡图
    clickEl(qa(root, '.pick-col.confirm.A .pick-tactic-name')[0]);
    const chip = q(root, '.pick-col.confirm.A .pick-tactic-chip') as HTMLElement;
    expect(chip.dataset.cardId).toBe('T01');
    expect(chip.querySelector('img')!.getAttribute('src')).toBe('./tactics/T01.jpg');
    // 再点同一张 → 取消（回到「未选」占位）
    clickEl(qa(root, '.pick-col.confirm.A .pick-tactic-name').find((n) => n.textContent === '谨慎')!);
    expect(q(root, '.pick-col.confirm.A .pick-tactic-chip')!.classList.contains('empty')).toBe(true);
  });

  it('战术牌唯一性（构筑）：一方选定后，另一方该张显示「已选」且不可点', () => {
    renderBuildSetup(root, () => {});
    clickEl(qa(root, '.pick-sw .pick-swlab').find((n) => n.textContent === '使用战术牌')!.parentElement!);
    // A 选「顽强」(T03)
    clickEl(qa(root, '.pick-col.confirm.A .pick-tactic-name').find((n) => n.textContent === '顽强')!);
    // B 的榜里出现「已选」，且正是 T03；A 侧没有「已选」
    const bTaken = qa(root, '.pick-col.confirm.B .pick-tactic-name.taken');
    expect(bTaken.map((n) => n.textContent)).toEqual(['已选']);
    expect(bTaken[0].dataset.cardId).toBe('T03');
    expect(qa(root, '.pick-col.confirm.A .pick-tactic-name.taken')).toHaveLength(0);
    // 点 B 侧那张「已选」不应改变状态（仍无 chip）
    clickEl(bTaken[0]);
    expect(q(root, '.pick-col.confirm.B .pick-tactic-chip')!.classList.contains('empty')).toBe(true);
  });

  it('构筑：直接选的战术牌会带进 onStart（tacticA/tacticB）', () => {
    const onStart = vi.fn();
    renderBuildSetup(root, onStart);
    clickEl(qa(root, '.pick-sw .pick-swlab').find((n) => n.textContent === '使用战术牌')!.parentElement!);
    clickEl(qa(root, '.pick-col.confirm.A .pick-tactic-name').find((n) => n.textContent === '顽强')!); // T03
    clickEl(qa(root, '.pick-col.confirm.B .pick-tactic-name').find((n) => n.textContent === '先机')!); // T02
    clickEl(q(root, '.pick-rand.A')); // 双方神器都确定（门槛）
    clickEl(q(root, '.pick-rand.B'));
    clickEl(q(root, '.pick-start')!);
    expect(onStart).toHaveBeenCalledTimes(1);
    const o = onStart.mock.calls[0][0] as SetupOptions;
    expect(o.tacticA).toBe('T03');
    expect(o.tacticB).toBe('T02');
    expect(o.tactics ?? false).toBe(false); // 构筑＝直接选，不进抽牌阶段
  });
});

describe('渲染入口 / 菜单', () => {
  it('renderSetup 第二层：「构筑模式」进入构筑界面', () => {
    renderSetup(root, () => {});
    clickEl(q(root, '.menu-item[data-act="jubai"]'));
    clickEl(q(root, '.menu-item[data-act="gouzu"]'));
    expect(q(root, '.pick-board.gouzu')).not.toBeNull();
  });

  it('renderSetup 第二层：「轮选模式」进入轮选准备态', () => {
    renderSetup(root, () => {});
    clickEl(q(root, '.menu-item[data-act="jubai"]'));
    clickEl(q(root, '.menu-item[data-act="lunxuan"]'));
    expect(q(root, '.pick-ttl')!.textContent).toBe('轮选模式 · 准备');
  });
});

describe('renderRotationSetup（轮选模式）', () => {
  const legal = (): HTMLElement[] => qa(root, '.pick-boardwrap .pick-slot.legal');
  const enterAs = (val: 'A' | 'B' | 'random'): void =>
    clickEl(q(root, `.pick-tbtn[data-first="${val}"]`));

  it('准备态 → 点先手即进入：九宫格 9 件 / 第 1 步 / 9 件可选 / 开始游戏禁用', () => {
    renderRotationSetup(root, () => {});
    expect(q(root, '.pick-ttl')!.textContent).toBe('轮选模式 · 准备');
    expect(qa(root, '.pick-tbtn[data-first]')).toHaveLength(3);
    expect(qa(root, '.pick-tbtn.on')).toHaveLength(0); // 三个值不默认选中
    expect(q(root, '.pick-start')).toBeNull(); // 已去掉「进入轮选」
    expect(q(root, '.pick-board')).toBeNull();
    enterAs('random');
    expect(q(root, '.pick-board.lunxuan')).not.toBeNull();
    expect(qa(root, '.pick-boardwrap .pick-slot')).toHaveLength(9);
    expect(q(root, '.pick-step-n')!.textContent).toBe('第 1/6 步');
    expect(legal()).toHaveLength(9);
    const start = q<HTMLButtonElement>(root, '.pick-start')!;
    expect(start.textContent).toBe('开始游戏');
    expect(start.disabled).toBe(true);
  });

  it('准备态可选先手：点玩家B → 进入后先手＝玩家B', () => {
    renderRotationSetup(root, () => {});
    enterAs('B');
    expect(q(root, '.pick-top .pick-tbtn.on.B')!.textContent).toBe('玩家B');
  });

  it('完整 6 步：移除 → 后手选＋另 1 件归先手 → … → 完成；开始游戏回调正确', () => {
    const onStart = vi.fn();
    renderRotationSetup(root, onStart);
    enterAs('random');

    // 步 1：移除 1 件
    legal()[0].click();
    expect(qa(root, '.pick-boardwrap .pick-slot.removed')).toHaveLength(1);
    expect(qa(root, '.pick-boardwrap .pick-removed-tag').map((n) => n.textContent)).toEqual(['已移除']);
    expect(q(root, '.pick-step-n')!.textContent).toBe('第 2/6 步');
    expect(legal()).toHaveLength(2); // 被移除神器所在列剩 2 件

    // 步 2：后手选 1，另 1 件归先手（同列）
    legal()[0].click();
    const aIds = qa(root, '.pick-col.confirm.A .pick-slot[data-card-id]').map((s) => s.getAttribute('data-card-id')!);
    const bIds = qa(root, '.pick-col.confirm.B .pick-slot[data-card-id]').map((s) => s.getAttribute('data-card-id')!);
    expect(aIds).toHaveLength(1);
    expect(bIds).toHaveLength(1);
    expect(colOfId(aIds[0])).toBe(colOfId(bIds[0]));
    expect(q(root, '.pick-step-n')!.textContent).toBe('第 3/6 步');

    // 步 3：先手任选 1
    legal()[0].click();
    expect(q(root, '.pick-step-n')!.textContent).toBe('第 4/6 步');

    // 步 4：连点两次（各列一次）
    legal()[0].click();
    expect(q(root, '.pick-step-n')!.textContent).toBe('第 4/6 步');
    legal()[0].click();
    expect(q(root, '.pick-step-n')!.textContent).toBe('第 5/6 步');

    // 步 5：先手补最后 1 件 → 完成
    expect(legal()).toHaveLength(2);
    legal()[0].click();
    expect(q(root, '.pick-step-n')!.textContent).toBe('已完成');
    expect(qa(root, '.pick-boardwrap .pick-slot.removed')).toHaveLength(3);
    expect(qa(root, '.pick-boardwrap .pick-slot.taken')).toHaveLength(6);

    const start = q<HTMLButtonElement>(root, '.pick-start')!;
    expect(start.disabled).toBe(false);
    start.click();
    expect(onStart).toHaveBeenCalledTimes(1);
    const o = onStart.mock.calls[0][0] as SetupOptions;
    expect(new Set([...o.heroA, ...o.heroB]).size).toBe(6);
    for (const trio of [o.heroA, o.heroB]) trio.forEach((id, i) => expect(colOfId(id)).toBe(i + 1));
  });

  it('重新随机：重置进度与九宫格', () => {
    renderRotationSetup(root, () => {});
    enterAs('random');
    legal()[0].click();
    expect(qa(root, '.pick-boardwrap .pick-slot.removed')).toHaveLength(1);
    clickEl(q(root, '.pick-reroll'));
    expect(q(root, '.pick-step-n')!.textContent).toBe('第 1/6 步');
    expect(qa(root, '.pick-boardwrap .pick-slot.removed')).toHaveLength(0);
    expect(legal()).toHaveLength(9);
  });
});

describe('联机 · 轮选（setupScreen）', () => {
  const cfg: RoomConfig = {
    mode: 'draft',
    first: 'host',
    alt: false,
    legend: false,
    tactics: false,
    turnSeconds: 30,
    allowSpectators: true,
    note: '',
  };
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  const second = (): El => document.body.appendChild(document.createElement('div'));

  it('来客首帧牌池为空 → 占位「等待房主发牌…」（不建格、不报错）；房主重随广播到达后出 9 格', async () => {
    const bus = new InMemoryBus();
    const host = new NetSession(bus.connect(), '房主');
    const guest = new NetSession(bus.connect(), '来客');
    await flush();
    const roomId = host.createRoom(cfg);
    await flush();
    renderRotationSetup(root, () => {}, { session: host, onExit: () => {} }); // 房主先渲染（无来客）
    const rootG = second();
    guest.joinRoom(roomId);
    renderRotationSetup(rootG, () => {}, { session: guest, onExit: () => {} }); // 立刻挂来客 UI（广播未到）
    expect(q(rootG, '.pick-gridwait')!.textContent).toContain('等待房主发牌');
    expect(qa(rootG, '.pick-boardwrap .pick-slot')).toHaveLength(0);
    await flush(); // 房主"来客加入→重随+广播"到达
    expect(qa(rootG, '.pick-boardwrap .pick-slot')).toHaveLength(9);
    host.close();
    guest.close();
  });

  it('非操作者（来客）九宫格"还没被选走"的置灰、不可点（无 legal），仍带 data-card-id（可看技能）', async () => {
    const bus = new InMemoryBus();
    const host = new NetSession(bus.connect(), '房主');
    const guest = new NetSession(bus.connect(), '来客');
    await flush();
    const roomId = host.createRoom(cfg);
    await flush();
    renderRotationSetup(root, () => {}, { session: host, onExit: () => {} });
    const rootG = second();
    guest.joinRoom(roomId);
    renderRotationSetup(rootG, () => {}, { session: guest, onExit: () => {} });
    await flush();
    // 来客＝非操作者（先手 A）：9 格全置灰、无可点框、仍可右键看技能
    expect(qa(rootG, '.pick-boardwrap .pick-slot')).toHaveLength(9);
    expect(qa(rootG, '.pick-boardwrap .pick-slot--wait')).toHaveLength(9);
    expect(qa(rootG, '.pick-boardwrap .pick-slot.legal')).toHaveLength(0);
    expect(q(rootG, '.pick-boardwrap .pick-slot--wait[data-card-id]')).not.toBeNull();
    // 房主＝操作者：不置灰、9 格可点
    expect(qa(root, '.pick-boardwrap .pick-slot--wait')).toHaveLength(0);
    expect(qa(root, '.pick-boardwrap .pick-slot.legal')).toHaveLength(9);
    host.close();
    guest.close();
  });

  it('「重新随机」门禁：来客禁用；房主(来客已到·未开始)可点；房主单人(无来客)禁用', async () => {
    const bus = new InMemoryBus();
    const host = new NetSession(bus.connect(), '房主');
    const guest = new NetSession(bus.connect(), '来客');
    await flush();
    const roomId = host.createRoom(cfg);
    await flush();
    renderRotationSetup(root, () => {}, { session: host, onExit: () => {} });
    const rootG = second();
    guest.joinRoom(roomId);
    renderRotationSetup(rootG, () => {}, { session: guest, onExit: () => {} });
    await flush();
    expect(q<HTMLButtonElement>(rootG, '.pick-reroll')!.disabled).toBe(true); // 来客不能重随
    expect(q<HTMLButtonElement>(root, '.pick-reroll')!.disabled).toBe(false); // 房主可
    host.close();
    guest.close();

    const bus2 = new InMemoryBus();
    const host2 = new NetSession(bus2.connect(), '房主');
    await flush();
    host2.createRoom(cfg);
    await flush();
    const rootH = second();
    renderRotationSetup(rootH, () => {}, { session: host2, onExit: () => {} });
    expect(q<HTMLButtonElement>(rootH, '.pick-reroll')!.disabled).toBe(true); // 来客未到 → 禁用
    host2.close();
  });
});

describe('详情浮窗（右键 / 单实例替换 / 离开后解除监听）', () => {
  let origEfp: unknown;
  beforeEach(() => {
    origEfp = (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
  });
  afterEach(() => {
    if (origEfp) (document as unknown as { elementFromPoint: unknown }).elementFromPoint = origEfp;
    else delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
  });

  it('右键卡打开弹窗；再右键另一张＝单实例替换；返回后监听解除', async () => {
    renderHeroSetup(root, () => {});
    ab(root, 'kong', 'A').click();
    const slots = qa(root, '.pick-col.confirm.A .pick-slot[data-card-id]');
    expect(slots).toHaveLength(3);

    (document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => slots[0];
    const e1 = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 });
    root.dispatchEvent(e1);
    expect(e1.defaultPrevented).toBe(true);
    expect(q(root, '.pick-modal.on')).not.toBeNull();
    const src1 = q(root, '.pick-modal-box img')!.getAttribute('src');

    await new Promise((r) => setTimeout(r, 150)); // 越过切换节流（120ms）
    (document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => slots[1];
    const e2 = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 120 });
    root.dispatchEvent(e2);
    expect(qa(root, '.pick-modal')).toHaveLength(1);
    expect(q(root, '.pick-modal-box img')!.getAttribute('src')).not.toBe(src1);

    clickEl(q(root, '.pick-back'));
    const e3 = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 });
    root.dispatchEvent(e3);
    expect(e3.defaultPrevented).toBe(false);
  });
});

describe('renderChallengeSetup（挑战模式 · 选择界面）', () => {
  const abOf = (hero: string, act: 'pick' | 'legend'): HTMLElement => {
    const n = qa(root, '.pick-ab').find((b) => b.dataset.hero === hero && b.dataset.act === act);
    if (!n) throw new Error(`missing ${hero}/${act}`);
    return n;
  };
  const modalOpen = (): void => {
    const pt = q(root, '.pick-portrait')!;
    pt.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
  };

  it('结构：4 列 / 12 行(挑·传) / 昔日传奇头像+信息 / 附加禁用 / 开始挑战禁用', () => {
    renderChallengeSetup(root, () => {});
    const board = q(root, '.pick-board.jiaozhan')!;
    expect(board).not.toBeNull();
    expect(board.children).toHaveLength(4);
    expect(qa(root, '.pick-cell')).toHaveLength(12);
    expect(qa(root, '.pick-ab')).toHaveLength(24);
    expect(q(root, '.pick-ab[data-act="pick"]')!.textContent).toBe('挑');
    expect(q(root, '.pick-ab[data-act="legend"]')!.textContent).toBe('传');
    expect(q(root, '.pick-legend-full')!.textContent).toBe('传说中的“雨中剑圣”');
    expect(q(root, '.pick-portrait img')!.getAttribute('src')).toBe('/legend/L01.jpg');
    expect(q(root, '.pick-legend-info')!.textContent).toContain('生命 50');
    expect(qa(root, '.pick-legend-arts .pick-slot')).toHaveLength(3);
    expect(qa(root, '.pick-sw.is-disabled')).toHaveLength(0); // 挑战：异相/战术均已接入
    expect(qa(root, '.pick-sw .pick-swlab').map((n) => n.textContent)).toEqual(['使用异相神器', '使用战术牌']);
    expect((q(root, '.pick-start') as HTMLButtonElement).disabled).toBe(true);
  });

  it('使用战术牌（挑战者）：确认列下方出「挑战者 战术牌」；点选后右上角显示卡图', () => {
    renderChallengeSetup(root, () => {});
    const tacticSwitch = qa(root, '.pick-sw .pick-swlab').find((n) => n.textContent === '使用战术牌')!.parentElement!;
    clickEl(tacticSwitch);
    expect(q(root, '.pick-col.confirm .pick-tactic-title')!.textContent).toBe('挑战者 战术牌');
    expect(qa(root, '.pick-col.confirm .pick-tactic .pick-tactic-name')).toHaveLength(18);
    clickEl(qa(root, '.pick-col.confirm .pick-tactic-name').find((n) => n.textContent === '先机')!);
    const chip = q(root, '.pick-col.confirm .pick-tactic-chip') as HTMLElement;
    expect(chip.dataset.cardId).toBe('T02');
    expect(chip.querySelector('img')!.getAttribute('src')).toBe('./tactics/T02.jpg');
  });

  it('传：把该英雄设为昔日传奇（名字/头像/信息随动；未转写显示"待转写"）', () => {
    renderChallengeSetup(root, () => {});
    abOf('xiu', 'legend').click();
    expect(q(root, '.pick-legend-full')!.textContent).toBe('传说中的“漆黑死神”');
    expect(q(root, '.pick-portrait img')!.getAttribute('src')).toBe('/legend/L06.jpg');
    expect(q(root, '.pick-legend-info')!.textContent).toContain('待转写');
  });

  it('传 Z03（孤塔之王）：已转写且无上限 → 显示「防御骰上限 无」（不是"待转写"）', () => {
    renderChallengeSetup(root, () => {});
    abOf('batton', 'legend').click();
    expect(q(root, '.pick-legend-full')!.textContent).toBe('传说中的“孤塔之王”');
    expect(q(root, '.pick-legend-info')!.textContent).toContain('生命 70');
    expect(q(root, '.pick-legend-info')!.textContent).toContain('防御骰上限 无');
    expect(q(root, '.pick-legend-info')!.textContent).not.toContain('待转写');
    modalOpen();
    expect(q(root, '.pick-chal-meta')!.textContent).toContain('防御骰上限 无');
  });

  it('挑：候选切到该英雄；点候选卡 → 落入挑战者确认对应列', () => {
    renderChallengeSetup(root, () => {});
    abOf('ying', 'pick').click();
    expect(q(root, '.pick-col.cand.A .pick-chead .sub')!.textContent).toBe('永暗之刃·影');
    const cands = qa(root, '.pick-col.cand.A .pick-slot');
    expect(cands).toHaveLength(3);
    cands[0].click(); // 004 → 第一列
    expect(q(root, '.pick-col.confirm.A .pick-slot img')!.getAttribute('src')).toBe('./cards/004.jpg');
  });

  it('头像右键 → 弹窗显示结构化技能（6 条 + 条件文本）', () => {
    renderChallengeSetup(root, () => {});
    modalOpen();
    expect(q(root, '.pick-modal.on')).not.toBeNull();
    expect(q(root, '.pick-chal-title')!.textContent).toBe('传说中的“雨中剑圣”');
    expect(qa(root, '.pick-modal .pick-sk')).toHaveLength(6);
    expect(qa(root, '.pick-chal-phrase').map((n) => n.textContent)).toEqual([
      '（必检）',
      '（必检）',
      '（满足5颗2/5点时发动；怜悯*：第一回合跳过检查）',
      '（满足3颗2/5点时发动）',
      '（必检）',
      '（满足任意颗3/4点时发动）',
    ]);
  });

  it('取消：清空挑战者确认', () => {
    renderChallengeSetup(root, () => {});
    qa(root, '.pick-col.cand.A .pick-slot')[0].click();
    expect(qa(root, '.pick-col.confirm.A .pick-slot img')).toHaveLength(1);
    clickEl(q(root, '.pick-col.confirm.A .pick-cbtn'));
    expect(qa(root, '.pick-col.confirm.A .pick-slot img')).toHaveLength(0);
  });

  it('挑战者候选：已选中的神器显示「已被选取」、不可再点；取消后恢复', () => {
    renderChallengeSetup(root, () => {});
    qa(root, '.pick-col.cand.A .pick-slot')[0].click(); // 取 001
    expect(qa(root, '.pick-col.cand.A .pick-slot.taken .pick-taken').map((n) => n.textContent)).toEqual([
      '已被选取',
    ]);
    expect(qa(root, '.pick-col.cand.A .pick-slot img')).toHaveLength(2);
    clickEl(q(root, '.pick-col.confirm.A .pick-cbtn'));
    expect(qa(root, '.pick-col.cand.A .pick-slot.taken')).toHaveLength(0);
    expect(qa(root, '.pick-col.cand.A .pick-slot img')).toHaveLength(3);
  });

  it('选满 3 件 → 自动确认（印章）+ 候选列锁定；取消后解除', () => {
    renderChallengeSetup(root, () => {});
    for (let n = 0; n < 3; n++) {
      const c = qa(root, '.pick-col.cand.A .pick-slot').find((s) => s.querySelector('img'));
      c!.click();
    }
    expect(q(root, '.pick-col.confirm.A')!.classList.contains('confirmed')).toBe(true);
    expect(qa(root, '.pick-col.confirm.A .pick-seal')).toHaveLength(1);
    expect(q(root, '.pick-col.cand.A')!.classList.contains('locked')).toBe(true);
    clickEl(q(root, '.pick-col.confirm.A .pick-cbtn'));
    expect(q(root, '.pick-col.confirm.A')!.classList.contains('confirmed')).toBe(false);
    expect(q(root, '.pick-col.cand.A')!.classList.contains('locked')).toBe(false);
  });

  it('右键候选卡 → 神器详情弹窗；昔日传奇预置神器不可右键', () => {
    const orig = (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
    try {
      renderChallengeSetup(root, () => {});
      const slot = q(root, '.pick-col.cand.A .pick-slot[data-card-id]')!;
      expect(slot.dataset.cardId).toBe('001');
      expect(q(root, '.pick-legend-arts .pick-slot[data-card-id]')).toBeNull();
      (document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => slot;
      root.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }));
      expect(qa(root, '.pick-modal.on img').map((i) => i.getAttribute('src'))).toEqual(['./cards/001.jpg']);
    } finally {
      if (orig) (document as unknown as { elementFromPoint: unknown }).elementFromPoint = orig;
      else delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
    }
  });

  it('结算模式：三选一（有利/不利/自选）、默认「自选」、必填单选、点击切换', () => {
    renderChallengeSetup(root, () => {});
    const seg = (val: string): HTMLElement => qa(root, '.pick-seg-btn').find((b) => b.dataset.settle === val)!;
    const labels = qa(root, '.pick-seg-btn').map((b) => b.textContent);
    expect(labels).toEqual(['结算玩家有利', '结算玩家不利', '结算玩家自选']);
    expect(labels[labels.length - 1]).toBe('结算玩家自选'); // 自选在最右
    expect(seg('manual').classList.contains('on')).toBe(true); // 默认自选
    expect(seg('favor').classList.contains('on')).toBe(false);
    seg('against').click();
    expect(seg('manual').classList.contains('on')).toBe(false);
    expect(seg('against').classList.contains('on')).toBe(true);
    seg('against').click(); // 必填：点当前项不取消
    expect(seg('against').classList.contains('on')).toBe(true);
  });
});

describe('异相（A01–A03）· 选择界面', () => {
  const anomalySwitch = (): HTMLElement =>
    qa(root, '.pick-sw').find((w) => w.querySelector('.pick-swlab')?.textContent === '使用异相神器')!;

  it('预设模式不提供「使用异相神器」开关', () => {
    renderHeroSetup(root, () => {});
    const labels = qa(root, '.pick-sw .pick-swlab').map((n) => n.textContent);
    expect(labels).toEqual(['使用传奇英雄面板', '使用战术牌']);
  });

  it('构筑：开启开关后，有异相映射的卡出现「切换」并可用；无异相映射的没有', () => {
    renderBuildSetup(root, () => {});
    expect(anomalySwitch().classList.contains('is-disabled')).toBe(false);
    anomalySwitch().click(); // 开启
    // batton 的第三列 009 → A01
    ab(root, 'batton', 'A').click();
    const base = candSlotBySrc(root, 'A', '009')!;
    expect(base.querySelector('.pick-alt-badge')).toBeNull();
    expect(base.querySelector('.pick-alt-switch')).not.toBeNull();
    (base.querySelector('.pick-alt-switch') as HTMLElement).click();
    const alt = candSlotBySrc(root, 'A', 'A01')!;
    expect(alt.querySelector('.pick-alt-badge')!.textContent).toBe('异相');
    expect(alt.querySelector('.pick-alt-switch')).not.toBeNull();
    // 再点还原
    (alt.querySelector('.pick-alt-switch') as HTMLElement).click();
    expect(candSlotBySrc(root, 'A', '009')).not.toBeUndefined();
    // lifeng（025/026/027）无异相/特典映射
    ab(root, 'lifeng', 'A').click();
    expect(qa(root, '.pick-col.cand.A .pick-alt-switch')).toHaveLength(0);
  });

  it('挑战：候选列同样支持「切换」（010 ↔ A02）', () => {
    renderChallengeSetup(root, () => {});
    anomalySwitch().click();
    qa(root, '.pick-ab').find((b) => b.dataset.hero === 'tata' && b.dataset.act === 'pick')!.click();
    const srcOf = (id: string): HTMLElement | undefined =>
      qa(root, '.pick-col.cand.A .pick-slot').find(
        (s) => s.querySelector('img')?.getAttribute('src') === `./cards/${id}.jpg`,
      );
    const slot = srcOf('010')!;
    (slot.querySelector('.pick-alt-switch') as HTMLElement).click();
    expect(srcOf('A02')).not.toBeUndefined();
    expect(srcOf('A02')!.querySelector('.pick-alt-badge')!.textContent).toBe('异相');
  });

  it('异相落确认区：切换后确定 → 确认区显示异相图（colOf 修复）', () => {
    renderBuildSetup(root, () => {});
    anomalySwitch().click();
    ab(root, 'batton', 'A').click(); // 009（第三列）
    (candSlotBySrc(root, 'A', '009')!.querySelector('.pick-alt-switch') as HTMLElement).click(); // → A01
    candSlotBySrc(root, 'A', 'A01')!.click(); // 选中
    clickEl(q(root, '.pick-col.cand.A .pick-ok'));
    const slot = q(root, '.pick-col.confirm.A .pick-slot[data-col="3"]')!;
    expect(slot.querySelector('img')!.getAttribute('src')).toBe('./cards/A01.jpg');
    expect(slot.querySelector('.pick-alt-badge')!.textContent).toBe('异相');
  });

  it('徽标 / 切换挂在卡图内层（.pick-art-inner）', () => {
    renderBuildSetup(root, () => {});
    anomalySwitch().click();
    ab(root, 'batton', 'A').click();
    const inner = candSlotBySrc(root, 'A', '009')!.querySelector('.pick-art-inner');
    expect(inner).not.toBeNull();
    expect(inner!.querySelector('.pick-alt-switch')).not.toBeNull();
  });

  it('普通/异相＝两件：对方拿了普通 009 → 本侧候选自动切到异相 A01（切换钮禁用），可点选并确定', () => {
    renderBuildSetup(root, () => {});
    anomalySwitch().click();
    // B 选 batton 并确定其第三列 009
    ab(root, 'batton', 'B').click();
    dbl(candSlotBySrc(root, 'B', '009')!);
    // A 选 batton：第三列 009 已被 B 拿走 → 自动显示异相 A01（按钮保留但禁用）
    ab(root, 'batton', 'A').click();
    const alt = candSlotBySrc(root, 'A', 'A01')!;
    expect(alt).not.toBeUndefined();
    expect(alt.querySelector('.pick-alt-badge')!.textContent).toBe('异相');
    expect(alt.querySelector('.pick-alt-switch')!.classList.contains('is-disabled')).toBe(true);
    // 点选 A01 → 确定 → 确认区第三列为 A01
    alt.click();
    clickEl(q(root, '.pick-col.cand.A .pick-ok'));
    expect(q(root, '.pick-col.confirm.A .pick-slot[data-col="3"] img')!.getAttribute('src')).toBe('./cards/A01.jpg');
  });

  it('普通/异相＝两件：本侧拿了异相 A01 → 对方仍可选普通 009', () => {
    renderBuildSetup(root, () => {});
    anomalySwitch().click();
    ab(root, 'batton', 'A').click();
    (candSlotBySrc(root, 'A', '009')!.querySelector('.pick-alt-switch') as HTMLElement).click(); // → A01
    candSlotBySrc(root, 'A', 'A01')!.click();
    clickEl(q(root, '.pick-col.cand.A .pick-ok')); // A 确定 A01
    // B 选 batton：第三列 009 仍可正常显示（非「已被选取」）
    ab(root, 'batton', 'B').click();
    expect(candSlotBySrc(root, 'B', '009')).not.toBeUndefined();
    expect(q(root, '.pick-col.cand.B .pick-slot.taken')).toBeNull();
  });

  it('构筑·随机（开异相）：可随机到异相版（每列"普通+异相"等概率）', () => {
    renderBuildSetup(root, () => {});
    anomalySwitch().click();
    const pool3 = randomColumnPool(2, true, []);
    const idx = pool3.indexOf('A01');
    expect(idx).toBeGreaterThanOrEqual(0);
    const spy = vi.spyOn(Math, 'random');
    spy.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce((idx + 0.5) / pool3.length);
    clickEl(q(root, '.pick-rand.A'));
    spy.mockRestore();
    expect(q(root, '.pick-col.confirm.A .pick-slot[data-col="3"] img')!.getAttribute('src')).toBe('./cards/A01.jpg');
  });
});
