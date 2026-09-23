import type { PlayerId } from '../core/model/types';
import { APP_VERSION_LABEL } from '../version';

export const HEROES = {
  kong: ['001', '002', '003'] as [string, string, string], // 雨中剑圣 空
  ying: ['004', '005', '006'] as [string, string, string], // 永暗之刃 影
  batton: ['007', '008', '009'] as [string, string, string], // 孤塔之王 巴顿二世
  tata: ['010', '011', '012'] as [string, string, string], // 地狱的魔女 塔塔萝丝
  zoray: ['013', '014', '015'] as [string, string, string], // 轰鸣审判官 佐雷
  xiu: ['016', '017', '018'] as [string, string, string], // 漆黑死神 修
  nisa: ['019', '020', '021'] as [string, string, string], // 荒野行者 尼萨
  xiva: ['022', '023', '024'] as [string, string, string], // 黑枪 希瓦
  lifeng: ['025', '026', '027'] as [string, string, string], // 天殇的战鬼 李封
  mate: ['028', '029', '030'] as [string, string, string], // 破晓之剑 玛特
  aiwa: ['031', '032', '033'] as [string, string, string], // 受缚邪灵 艾娃
  miyun: ['034', '035', '036'] as [string, string, string], // 渡世行僧 弥云
};

const HERO_KEYS = ['kong', 'ying', 'batton', 'tata', 'zoray', 'xiu', 'nisa', 'xiva', 'lifeng', 'mate', 'aiwa', 'miyun'] as const;
const HERO_LABELS: Record<(typeof HERO_KEYS)[number], string> = {
  kong: '雨中剑圣·空',
  ying: '永暗之刃·影',
  batton: '孤塔之王·巴顿二世',
  tata: '地狱的魔女·塔塔萝丝',
  zoray: '轰鸣审判官·佐雷',
  xiu: '漆黑死神·修',
  nisa: '荒野行者·尼萨',
  xiva: '黑枪·希瓦',
  lifeng: '天殇的战鬼·李封',
  mate: '破晓之剑·玛特',
  aiwa: '受缚邪灵·艾娃',
  miyun: '渡世行僧·弥云',
};

export interface SetupOptions {
  heroA: [string, string, string];
  heroB: [string, string, string];
  firstPlayer: PlayerId;
}

type HeroChoice = (typeof HERO_KEYS)[number] | 'random';
type FirstChoice = 'A' | 'B' | 'random';

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

function choiceButton(
  role: string,
  value: string,
  label: string,
  onSelect: () => void,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'choice';
  b.dataset.role = role;
  b.dataset.value = value;
  b.textContent = label;
  b.addEventListener('click', onSelect);
  return b;
}

function disabledChoice(role: string, value: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'choice choice--soon';
  b.dataset.role = role;
  b.dataset.value = value;
  b.disabled = true;
  b.title = '开发中';
  b.textContent = label;
  return b;
}

function placeholderRow(
  label: string,
  role: string,
  defs: Array<[string, string, boolean]>,
): HTMLElement {
  const row = el('div', 'setup-row');
  const lab = el('span', 'setup-label');
  lab.textContent = label;
  row.appendChild(lab);
  const group = el('div', 'choice-group');
  for (const [value, text, soon] of defs) {
    if (soon) {
      group.appendChild(disabledChoice(role, value, `${text}（开发中）`));
    } else {
      const b = choiceButton(role, value, text, () => {});
      b.classList.add('selected');
      group.appendChild(b);
    }
  }
  row.appendChild(group);
  return row;
}

export function renderSetup(root: HTMLElement, onStart: (opts: SetupOptions) => void): void {
  root.innerHTML = '';
  // 设置页背景（封面）：进入对局时由 renderGame 移除
  root.classList.add('setup-page');

  const wrap = el('div', 'setup');

  const title = el('h1', 'setup-title');
  title.textContent = '尘起时刻 · 开始新对局';
  wrap.appendChild(title);

  // 游戏模式（占位：仅“左右互搏”可用，其余开发中）
  wrap.appendChild(
    placeholderRow('游戏模式：', 'mode', [
      ['hotseat', '左右互搏', false],
      ['ai', 'AI 模式', true],
      ['local', '本地联机', true],
      ['online', '互联网联机', true],
    ]),
  );
  // 选将模式（占位：仅“直接选英雄”可用，其余开发中）
  wrap.appendChild(
    placeholderRow('选将模式：', 'draft', [
      ['hero', '直接选英雄', false],
      ['draft', '轮选模式', true],
      ['free', '自由模式', true],
      ['random', '随机模式', true],
    ]),
  );

  let heroAChoice: HeroChoice = 'random';
  let heroBChoice: HeroChoice = 'random';
  let firstChoice: FirstChoice = 'random';

  const heroDefs: Array<[HeroChoice, string]> = [
    ...HERO_KEYS.map((k) => [k, HERO_LABELS[k]] as [HeroChoice, string]),
    ['random', '随机'],
  ];

  const matrix = el('div', 'hero-matrix');
  const head = el('div', 'hero-matrix-row hero-matrix-head');
  head.appendChild(el('span', 'setup-label'));
  const headA = el('span', 'hero-cell');
  headA.textContent = '玩家A';
  const headB = el('span', 'hero-cell');
  headB.textContent = '玩家B';
  head.appendChild(headA);
  head.appendChild(headB);
  matrix.appendChild(head);

  const heroAButtons: Array<{ value: HeroChoice; node: HTMLButtonElement }> = [];
  const heroBButtons: Array<{ value: HeroChoice; node: HTMLButtonElement }> = [];
  for (const [value, label] of heroDefs) {
    const row = el('div', 'hero-matrix-row');
    const lab = el('span', 'setup-label');
    lab.textContent = label;
    row.appendChild(lab);

    const cellA = el('div', 'hero-cell');
    const nodeA = choiceButton('heroA', value, '○', () => {
      heroAChoice = value;
      sync();
    });
    heroAButtons.push({ value, node: nodeA });
    cellA.appendChild(nodeA);
    row.appendChild(cellA);

    const cellB = el('div', 'hero-cell');
    const nodeB = choiceButton('heroB', value, '○', () => {
      heroBChoice = value;
      sync();
    });
    heroBButtons.push({ value, node: nodeB });
    cellB.appendChild(nodeB);
    row.appendChild(cellB);

    matrix.appendChild(row);
  }
  wrap.appendChild(matrix);

  const firstRow = el('div', 'setup-row');
  const firstLabel = el('span', 'setup-label');
  firstLabel.textContent = '先手：';
  firstRow.appendChild(firstLabel);

  const firstGroup = el('div', 'choice-group');
  const firstButtons: Array<{ value: FirstChoice; node: HTMLButtonElement }> = [];
  const firstDefs: Array<[FirstChoice, string]> = [
    ['A', '玩家A 先手'],
    ['B', '玩家B 先手'],
    ['random', '随机'],
  ];
  for (const [value, label] of firstDefs) {
    const node = choiceButton('first', value, label, () => {
      firstChoice = value;
      sync();
    });
    firstButtons.push({ value, node });
    firstGroup.appendChild(node);
  }
  firstRow.appendChild(firstGroup);
  wrap.appendChild(firstRow);

  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'setup-start';
  start.textContent = '开始游戏';
  start.addEventListener('click', () => {
    const pickKey = (
      pool: ReadonlyArray<(typeof HERO_KEYS)[number]>,
    ): (typeof HERO_KEYS)[number] => pool[Math.floor(Math.random() * pool.length)];
    let heroAKey = heroAChoice === 'random' ? pickKey(HERO_KEYS) : heroAChoice;
    const heroBKey =
      heroBChoice === 'random'
        ? pickKey(HERO_KEYS.filter((k) => k !== heroAKey))
        : heroBChoice;
    if (heroAKey === heroBKey) {
      heroAKey = pickKey(HERO_KEYS.filter((k) => k !== heroBKey));
    }
    const heroA: [string, string, string] = HEROES[heroAKey];
    const heroB: [string, string, string] = HEROES[heroBKey];
    const firstPlayer: PlayerId =
      firstChoice === 'random' ? (Math.random() < 0.5 ? 'A' : 'B') : firstChoice;
    onStart({ heroA, heroB, firstPlayer });
  });
  wrap.appendChild(start);

  function sync(): void {
    for (const { value, node } of heroAButtons) {
      node.classList.toggle('selected', value === heroAChoice);
      const muted = value !== 'random' && value === heroBChoice;
      node.classList.toggle('choice--muted', muted);
      node.disabled = muted;
    }
    for (const { value, node } of heroBButtons) {
      node.classList.toggle('selected', value === heroBChoice);
      const muted = value !== 'random' && value === heroAChoice;
      node.classList.toggle('choice--muted', muted);
      node.disabled = muted;
    }
    for (const { value, node } of firstButtons) {
      node.classList.toggle('selected', value === firstChoice);
    }
  }

  sync();

  // 首页右下角：一行小字显示版本号（唯一来源 package.json → __APP_VERSION__）
  const version = el('div', 'app-version');
  version.textContent = APP_VERSION_LABEL;
  wrap.appendChild(version);

  root.appendChild(wrap);
}
