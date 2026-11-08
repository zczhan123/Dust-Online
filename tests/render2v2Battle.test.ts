import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render2v2Battle } from '../src/ui/battle2v2View';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';

const setup = (): TwoVTwoSetup => ({
  seats: {
    A1: ['001', '002', '003'],
    A2: ['004', '005', '006'],
    B1: ['007', '008', '009'],
    B2: ['010', '011', '012'],
  },
  firstTeam: 'A',
});

const mount = (): { root: HTMLElement; back: ReturnType<typeof vi.fn> } => {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const back = vi.fn();
  render2v2Battle(root, setup(), back);
  return { root, back };
};

beforeEach(() => {
  document.documentElement.classList.remove('mode-2v2');
  document.body.innerHTML = '';
  try {
    localStorage.removeItem('dust.prefs.v1');
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  document.documentElement.classList.remove('mode-2v2');
  vi.restoreAllMocks();
});

describe('2v2 战斗界面壳（阶段 0.6）', () => {
  it('四席 / 两条团队生命 / 12 件神器 / 12 个骰区 / 座位名', () => {
    const { root } = mount();
    expect(document.documentElement.classList.contains('mode-2v2')).toBe(true);

    const players = Array.from(root.querySelectorAll<HTMLElement>('.player[data-player]'));
    expect(players.map((p) => p.dataset.player)).toEqual(['B1', 'B2', 'A2', 'A1']);
    expect(root.querySelectorAll('.player .card[data-artifact]')).toHaveLength(12);
    expect(root.querySelectorAll('.player .area[data-kind]')).toHaveLength(12);
    expect(root.querySelectorAll('.lifeline--team')).toHaveLength(2);
    expect(Array.from(root.querySelectorAll<HTMLElement>('.lifeline--team')).map((l) => l.dataset.team)).toEqual(['B', 'A']);

    for (const label of ['玩家A1', '玩家A2', '玩家B1', '玩家B2']) {
      expect(root.textContent).toContain(label);
    }
    expect(root.querySelector('.b2v2-badge')?.textContent).toContain('界面壳');
    expect(root.querySelectorAll('.b2v2-seat-tag')).toHaveLength(0);
    expect(root.querySelectorAll('.actionzone')).toHaveLength(1);
    expect(root.querySelectorAll('.player-gap')).toHaveLength(0);
  });

  it('卡图 / 卡头信息 / 技能药丸 / 尘落 / 尘印 / 对齐槽', () => {
    const { root } = mount();
    expect(root.querySelectorAll('.card-art-img')).toHaveLength(12);
    for (const text of ['速度', '意志', '生命', '充能', '分布']) {
      expect(root.textContent).toContain(text);
    }
    expect(root.querySelectorAll('.skill-part').length).toBeGreaterThan(0);
    expect(root.querySelector('.hint-dust')?.textContent).toContain('尘落');
    expect(root.querySelector('.hint-dust')?.textContent).toContain('/ 10');
    expect(root.querySelectorAll('.area-seal')).toHaveLength(1);
    expect(root.querySelector('.area-seal')?.textContent).toBe('尘印');
    expect(root.querySelectorAll('.player-gap')).toHaveLength(0);
    const legendSlots = Array.from(root.querySelectorAll<HTMLElement>('[data-role="legend-tactic-slot"]'));
    expect(legendSlots).toHaveLength(4);
    expect(legendSlots.every((s) => s.hidden)).toBe(true);
    expect(root.querySelector<HTMLElement>('.player[data-player="B2"]')?.style.getPropertyValue('--pc')).toBe('#f472b6');
    const b2die = root.querySelector<HTMLElement>('.player[data-player="B2"] .die')!;
    expect(b2die.style.background.replace(/\s/g, '')).toBe('rgb(244,114,182)');
  });

  it('030 同卡两个「寰宇飞升」药丸态左右并排居中，类型药丸结构一致', () => {
    const prefs = JSON.parse(localStorage.getItem('dust.prefs.v1') ?? '{}');
    localStorage.setItem('dust.prefs.v1', JSON.stringify({ ...prefs, showSkillText: false }));
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const cfg = setup();
    cfg.seats.B2 = ['010', '011', '030'];
    render2v2Battle(root, cfg, vi.fn());

    const card = root.querySelector('.card[data-artifact="030"]')!;
    const group = card.querySelector('.skills--inline--only')!;
    expect(group).not.toBeNull();
    expect(card.querySelector('.skills--borrow')).toBeNull();
    expect(group.querySelectorAll('.skill')).toHaveLength(1);
    const parts = Array.from(group.querySelectorAll<HTMLElement>('.skill-part'));
    expect(parts).toHaveLength(2);
    expect(parts.map((p) => p.querySelector('.skill-type')?.textContent)).toEqual(['持续', '必杀']);
    expect(parts.map((p) => p.querySelector('.skill-name')?.textContent)).toEqual(['寰宇飞升', '寰宇飞升']);
  });

  it('009 孤王三个 only 技能按 2+1 换行', () => {
    localStorage.setItem('dust.prefs.v1', JSON.stringify({ showSkillText: false }));
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const cfg = setup();
    cfg.seats.B2 = ['010', '011', '009'];
    render2v2Battle(root, cfg, vi.fn());

    const group = root.querySelector('.card[data-artifact="009"] .skills--inline--only')!;
    expect(group).not.toBeNull();
    expect(group.querySelectorAll('.skill')).toHaveLength(1);
    expect(group.querySelectorAll('.skill-part')).toHaveLength(3);
  });

  it('5 字 / 7 字技能名走借位布局，并只锁类型和名字不换行', () => {
    localStorage.setItem('dust.prefs.v1', JSON.stringify({ showSkillText: false }));
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const cfg = setup();
    cfg.seats.B2 = ['A03', 'A08', 'C01'];
    render2v2Battle(root, cfg, vi.fn());

    for (const id of ['A03', 'A08', 'C01']) {
      const card = root.querySelector(`.card[data-artifact="${id}"]`)!;
      expect(card.querySelector('.skills--borrow')).not.toBeNull();
      expect(card.querySelectorAll('.skill--name-wide').length).toBeGreaterThan(0);
      expect(card.querySelectorAll('.skill-part-head--nowrap').length).toBeGreaterThan(0);
    }
    const c01 = root.querySelector('.card[data-artifact="C01"]')!;
    expect(Array.from(c01.querySelectorAll('.skill-name')).map((n) => n.textContent)).toContain('极之境·裁雨流');
    expect(
      Array.from(c01.querySelectorAll('.skill-part-head--nowrap .skill-name')).map((n) => n.textContent),
    ).toContain('极之境·裁雨流');
  });

  it('镜像只影响上方团队', () => {
    localStorage.setItem('dust.prefs.v1', JSON.stringify({ mirrorEnemy: true, showSkillText: false }));
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const cfg = setup();
    cfg.firstTeam = 'B';
    render2v2Battle(root, cfg, vi.fn());

    const ids = (seat: string): (string | undefined)[] =>
      Array.from(root.querySelectorAll<HTMLElement>(`.player[data-player="${seat}"] .card`)).map(
        (c) => c.dataset.artifact,
      );
    expect(ids('A1')).toEqual(['003', '002', '001']);
    expect(ids('B1')).toEqual(['007', '008', '009']);
  });

  it('设置：可打开、切换技能描述、关闭', () => {
    const { root } = mount();
    const rowButton = (label: string, text: string): HTMLButtonElement => {
      const row = Array.from(root.querySelectorAll<HTMLElement>('.settings-row')).find(
        (r) => r.querySelector('.settings-label')?.textContent === label,
      );
      return Array.from(row!.querySelectorAll<HTMLButtonElement>('.settings-opt')).find(
        (b) => b.textContent === text,
      )!;
    };

    root.querySelector<HTMLElement>('[data-act="settingsOpen"]')!.click();
    expect(root.querySelector('.settings-overlay')).not.toBeNull();
    expect(root.querySelector('.board--2v2')?.classList.contains('show-text')).toBe(true);

    rowButton('显示技能描述', '隐藏').click();
    expect(root.querySelector('.board--2v2')?.classList.contains('show-text')).toBe(false);
    rowButton('显示技能描述', '显示').click();
    expect(root.querySelector('.board--2v2')?.classList.contains('show-text')).toBe(true);
    expect(document.documentElement.classList.contains('mode-2v2-show-text')).toBe(false);

    root.querySelector<HTMLElement>('[data-act="settingsClose"]')!.click();
    expect(root.querySelector('.settings-overlay')).toBeNull();
  });

  it('战报：展开为左栏，收起为拉手+抽屉', () => {
    const { root } = mount();
    const rowButton = (label: string, text: string): HTMLButtonElement => {
      const row = Array.from(root.querySelectorAll<HTMLElement>('.settings-row')).find(
        (r) => r.querySelector('.settings-label')?.textContent === label,
      );
      return Array.from(row!.querySelectorAll<HTMLButtonElement>('.settings-opt')).find(
        (b) => b.textContent === text,
      )!;
    };

    expect(root.querySelector('.sidebar .log')).not.toBeNull();
    expect(root.querySelector('.log-tab')).toBeNull();

    root.querySelector<HTMLElement>('[data-act="settingsOpen"]')!.click();
    rowButton('战报栏', '收起').click();
    root.querySelector<HTMLElement>('[data-act="settingsClose"]')!.click();
    expect(root.querySelector('.sidebar')).toBeNull();
    expect(root.querySelector('.log-tab')).not.toBeNull();

    root.querySelector<HTMLElement>('.log-tab')!.click();
    expect(root.querySelector('.log-drawer .log')).not.toBeNull();
    root.querySelector<HTMLElement>('.log-overlay')!.click();
    expect(root.querySelector('.log-drawer')).toBeNull();
  });

  it('攻守标记可切换', () => {
    const { root } = mount();
    const token = () => root.querySelector<HTMLElement>('.stance-token')!;
    expect(token().dataset.side).toBe('atk');
    token().click();
    expect(token().dataset.side).toBe('def');
    expect(root.querySelector('.hint-notes')?.textContent).toContain('守方投票');
    token().click();
    expect(token().dataset.side).toBe('atk');
  });

  it('队内投票：并入同一个操作栏；不一致清空重投，一致则决定', () => {
    const { root } = mount();
    expect(root.querySelector('.actionzone .b2v2-vote')).toBeNull();
    root.querySelector<HTMLElement>('.stance-token')!.click();
    expect(root.querySelector('.actionzone .actionlist .b2v2-vote')).not.toBeNull();
    expect(root.querySelectorAll('.b2v2-vote')).toHaveLength(1);
    expect(root.querySelector('.b2v2-vote-title')).toBeNull();
    expect(root.querySelector('.b2v2-vote-status')).toBeNull();
    expect(root.querySelector('.hint-notes')?.textContent).toBe('守方投票：等待双方投票…');

    const cols = Array.from(root.querySelectorAll<HTMLElement>('.b2v2-vote-col'));
    expect(cols.map((c) => c.dataset.voter)).toEqual(['B1', 'B2']);
    expect(root.querySelectorAll('.b2v2-vote-col .option-btn')).toHaveLength(4);

    root.querySelector<HTMLElement>('[data-voter="B1"] [data-choice="B2"]')!.click();
    root.querySelector<HTMLElement>('[data-voter="B2"] [data-choice="B1"]')!.click();
    expect(root.querySelector('.hint-notes')?.textContent).toBe('守方投票：选择不一致，请重新投票');
    expect(root.querySelectorAll('.b2v2-vote-col .option-btn--on')).toHaveLength(0);

    root.querySelector<HTMLElement>('[data-voter="B1"] [data-choice="B1"]')!.click();
    root.querySelector<HTMLElement>('[data-voter="B2"] [data-choice="B1"]')!.click();
    expect(root.querySelector('.hint-notes')?.textContent).toBe('守方投票：已决定：玩家B1');
    expect(root.querySelectorAll('.b2v2-vote-col .option-btn--on')).toHaveLength(2);
  });

  it('返回按钮退出 2v2 并回调', () => {
    const { root, back } = mount();
    root.querySelector<HTMLElement>('[data-act="b2v2Back"]')!.click();
    expect(back).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList.contains('mode-2v2')).toBe(false);
  });
});
