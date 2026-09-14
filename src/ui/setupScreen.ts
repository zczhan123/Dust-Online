import type { PlayerId } from '../core/model/types';

export const HEROES = {
  kong: ['001', '002', '003'] as [string, string, string], // 雨中剑圣 空
  ying: ['004', '005', '006'] as [string, string, string], // 永暗之刃 影
};

export interface SetupOptions {
  heroA: [string, string, string];
  heroB: [string, string, string];
  firstPlayer: PlayerId;
}

type HeroChoice = 'kong' | 'ying' | 'random';
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

  let heroChoice: HeroChoice = 'random';
  let firstChoice: FirstChoice = 'random';

  const heroRow = el('div', 'setup-row');
  const heroLabel = el('span', 'setup-label');
  heroLabel.textContent = '玩家A 的英雄：';
  heroRow.appendChild(heroLabel);

  const heroGroup = el('div', 'choice-group');
  const heroButtons: Array<{ value: HeroChoice; node: HTMLButtonElement }> = [];
  const heroDefs: Array<[HeroChoice, string]> = [
    ['kong', '雨中剑圣·空'],
    ['ying', '永暗之刃·影'],
    ['random', '随机'],
  ];
  for (const [value, label] of heroDefs) {
    const node = choiceButton('heroA', value, label, () => {
      heroChoice = value;
      sync();
    });
    heroButtons.push({ value, node });
    heroGroup.appendChild(node);
  }
  heroRow.appendChild(heroGroup);
  wrap.appendChild(heroRow);

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
    const heroA: [string, string, string] =
      heroChoice === 'random'
        ? Math.random() < 0.5
          ? HEROES.kong
          : HEROES.ying
        : HEROES[heroChoice];
    const heroB: [string, string, string] = heroA === HEROES.kong ? HEROES.ying : HEROES.kong;
    const firstPlayer: PlayerId =
      firstChoice === 'random' ? (Math.random() < 0.5 ? 'A' : 'B') : firstChoice;
    onStart({ heroA, heroB, firstPlayer });
  });
  wrap.appendChild(start);

  function sync(): void {
    for (const { value, node } of heroButtons) {
      node.classList.toggle('selected', value === heroChoice);
    }
    for (const { value, node } of firstButtons) {
      node.classList.toggle('selected', value === firstChoice);
    }
  }

  sync();
  root.appendChild(wrap);
}
