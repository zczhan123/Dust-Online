import type { PlayerId } from '../core/model/types';
import { ARTIFACT_TEXT } from '../core/content/artifactText';
import { LEGEND_TEXT } from '../core/content/legendText';
import { ALT_OF, ARTIFACTS, BASE_OF, isAltArtifact, SPECIAL_ARTIFACT_NOTE } from '../core/content/artifacts';
import { LEGEND_OF_HERO, legendImageUrl, legendOfTrio } from '../core/content/legends';
import { TACTICS, TACTIC_BY_ID, tacticImageUrl, tacticDisplayText, isTacticId } from '../core/content/tactics';
import { CHALLENGES, slotPhrase, ADJUSTED_ARTIFACTS, ADJUSTED_TACTICS, type ChallengeCard } from '../core/content/challenges';
import { APP_VERSION_LABEL } from '../version';
import { renderLobby } from './lobby';
import { createOnlineShell, type OnlineCtx, type OnlineShell } from './online';
import { enterOnlineBattle } from './onlineMode';
import { attachSettleTip, hideSettleTip } from './settleTip';

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
type HeroKey = (typeof HERO_KEYS)[number];
const HERO_LABELS: Record<HeroKey, string> = {
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
  /** 预设模式·带传奇：该方传奇英雄面板 id（L01–L12）；未开启传奇时为 undefined */
  legendA?: string;
  legendB?: string;
  /** 使用战术牌（预设/轮选）：进入战斗后「抽 2 留 1」 */
  tactics?: boolean;
  /** 战术牌·直接指定（构筑）：该方本场战术牌 id */
  tacticA?: string;
  tacticB?: string;
  /** 单人挑战：所选挑战卡 id（有则走 createChallengeGame；`heroA`＝挑战者构筑、`heroB` 忽略） */
  challengeCardId?: string;
  /** 单人挑战：结算模式（`manual` 自选 / `favor` 有利 / `against` 不利） */
  settleMode?: 'manual' | 'favor' | 'against';
}

type Side = 'A' | 'B';
// 内部 id 固定为 'yuxuan'（历史命名，勿改，仅内部标识）；该模式的界面文案一律为「预设模式」。
type PickerMode = 'yuxuan' | 'gouzu';

const COL_LABELS = ['第一列', '第二列', '第三列'];
/** 卡图相对路径（相对 index.html；dev=/cards、build/子路径也成立） */
const cardUrl = (id: string): string => `./cards/${id}.jpg`;

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}
function button(className: string, text: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  return b;
}

/** 异相徽标（卡槽左上角，纯显示）。 */
function addAltBadge(slot: HTMLElement): void {
  const b = el('span', 'pick-alt-badge');
  b.textContent = '异相';
  slot.appendChild(b);
}
/** 特典徽标（C01 等；不能在正式比赛中使用）。 */
function addSpecialBadge(slot: HTMLElement): void {
  const b = el('span', 'pick-special-badge');
  b.textContent = '特典';
  b.title = '特典神器：不能在正式比赛中使用';
  slot.appendChild(b);
}
/** 挑战模式「调整」徽标（红底白字；**仅挑战模式的选择界面**用）。`below`＝该卡已有「异相」→ 排在其下。 */
function addAdjustBadge(slot: HTMLElement, below: boolean): void {
  const b = el('span', `pick-adjust-badge${below ? ' pick-adjust-badge--below' : ''}`);
  b.textContent = '调整';
  slot.appendChild(b);
}
/** 「切换」按钮（卡槽右上角）＝ 原版 ↔ 异相。`disabled` 时保留按钮但不可点（用于"另一版已被对方选走、已自动切版"）。 */
function addAltSwitch(slot: HTMLElement, onToggle: () => void, disabled = false): void {
  const t = el('span', 'pick-alt-switch');
  t.textContent = '切换';
  if (disabled) {
    t.classList.add('is-disabled');
  } else {
    t.addEventListener('click', (e) => { e.stopPropagation(); onToggle(); });
  }
  slot.appendChild(t);
}

/** 构筑「随机」每列的候选池＝每个英雄该列的**普通版**（异相开关开、且有异相映射时**并含异相版**），排除 excludeIds。 */
export function randomColumnPool(column: number, anomaly: boolean, excludeIds: string[]): string[] {
  const out: string[] = [];
  for (const k of HERO_KEYS) {
    const base = HEROES[k][column];
    const variants = anomaly && ALT_OF[base] ? [base, ALT_OF[base]] : [base];
    for (const id of variants) {
      if (excludeIds.includes(id) || out.includes(id)) continue;
      out.push(id);
    }
  }
  return out;
}

/** 图鉴查询外链（新标签打开） */
const MENU_EXTERNAL = 'http://www.dusttool.top/';
/** 注入一次性的墨刷痕 SVG 滤镜（供首页菜单与预设/构筑页使用；仅 UI，不涉引擎） */
export function ensureInkFilter(): void {
  if (document.getElementById('dust-ink-svg')) return;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('id', 'dust-ink-svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  const filter = document.createElementNS(ns, 'filter');
  filter.setAttribute('id', 'dust-ink');
  filter.setAttribute('x', '-25%');
  filter.setAttribute('y', '-70%');
  filter.setAttribute('width', '150%');
  filter.setAttribute('height', '240%');
  const turb = document.createElementNS(ns, 'feTurbulence');
  turb.setAttribute('type', 'fractalNoise');
  turb.setAttribute('baseFrequency', '0.05 0.9');
  turb.setAttribute('numOctaves', '4');
  turb.setAttribute('seed', '9');
  turb.setAttribute('result', 'n');
  const disp = document.createElementNS(ns, 'feDisplacementMap');
  disp.setAttribute('in', 'SourceGraphic');
  disp.setAttribute('in2', 'n');
  disp.setAttribute('scale', '17');
  disp.setAttribute('xChannelSelector', 'R');
  disp.setAttribute('yChannelSelector', 'G');
  filter.appendChild(turb);
  filter.appendChild(disp);
  svg.appendChild(filter);
  document.body.appendChild(svg);
}

/**
 * 卡图详情浮窗（右键 / 长按；点击处附近弹出、窄屏回退居中；`scale(.4→1)` 入场；单实例替换）。
 * 监听挂在 `root` 上，随传入的 `signal` 一起解除（离开页面即清理）。
 */
function createCardInspector(
  root: HTMLElement,
  signal: AbortSignal,
  // legendText：`L0N` 图代表「传奇英雄面板」时（仅预设/构筑），显示 `LEGEND_TEXT` 技能；
  // 否则（如挑战页的「昔日传奇」）只显示图，避免张冠李戴。
  opts?: { legendText?: boolean },
): { modal: HTMLElement; consumeLp: () => boolean; open: (id: string, x: number | null, y: number | null, soft: boolean) => void } {
  const modal = el('div', 'pick-modal');
  const box = el('div', 'pick-modal-box');
  modal.appendChild(box);
  let lpTimer: number | null = null;
  let lpFired = false;
  let lastOpen = 0;
  const consumeLp = (): boolean => {
    if (lpFired) { lpFired = false; return true; }
    return false;
  };
  function cardIdAt(x: number, y: number): string | null {
    const wasOn = modal.classList.contains('on');
    if (wasOn) { modal.style.visibility = 'hidden'; modal.style.pointerEvents = 'none'; }
    let id: string | null = null;
    try {
      const efp = document.elementFromPoint;
      const hit = typeof efp === 'function' ? efp.call(document, x, y) : null;
      const slot = hit && hit.closest ? (hit.closest('[data-card-id]') as HTMLElement | null) : null;
      if (slot) id = slot.dataset.cardId ?? null;
    } finally {
      if (wasOn) { modal.style.visibility = ''; modal.style.pointerEvents = ''; }
    }
    return id;
  }
  function position(x: number | null, y: number | null): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    box.style.left = '0px';
    box.style.top = '0px';
    box.style.transformOrigin = 'center center';
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const tiny = vw < 560 || vh < 460 || w > vw - 16 || h > vh - 16 || x == null || y == null;
    if (tiny) {
      box.style.left = Math.max(8, (vw - w) / 2) + 'px';
      box.style.top = Math.max(8, (vh - h) / 2) + 'px';
      box.style.transformOrigin = 'center center';
    } else {
      const gap = 12;
      const m = 8;
      let l = x + gap;
      if (l + w > vw - m) l = x - w - gap;
      l = Math.max(m, Math.min(l, vw - w - m));
      let t = y + gap;
      if (t + h > vh - m) t = y - h - gap;
      t = Math.max(m, Math.min(t, vh - h - m));
      box.style.left = l + 'px';
      box.style.top = t + 'px';
      box.style.transformOrigin = (x - l) + 'px ' + (y - t) + 'px';
    }
    box.style.animation = 'none';
    void box.offsetWidth;
    box.style.animation = '';
  }
  function close(): void {
    modal.classList.remove('on');
  }
  function open(id: string, x: number | null, y: number | null, soft: boolean): void {
    box.innerHTML = '';
    const isLegend = /^L\d{2}$/.test(id);
    const isTactic = isTacticId(id);
    const legendText = isLegend && opts?.legendText ? LEGEND_TEXT[id] : undefined;
    box.classList.toggle('legend', !!legendText);
    box.classList.toggle('tactic', isTactic);
    const tactic = isTactic ? TACTIC_BY_ID[id] : undefined;
    const img = document.createElement('img');
    img.src = isTactic ? tacticImageUrl(id) : isLegend ? legendImageUrl(id) : cardUrl(id);
    img.alt = '';
    img.addEventListener('error', () => {
      const ph = el('div', 'pick-img-missing');
      ph.textContent = '（卡图占位）';
      img.replaceWith(ph);
    });
    // 图片异步加载：加载完再定位一次（否则按"尺寸未定"算位置 → 竖版大图会跑出屏幕）
    img.addEventListener('load', () => { if (modal.classList.contains('on')) position(x, y); });
    if (legendText) {
      // 面板头像：黑底板（上下两条黑边；同 chip/战斗框规则），限宽居中，技能列表为主体
      const av = el('div', 'pick-modal-av');
      av.appendChild(img);
      box.appendChild(av);
    } else {
      box.appendChild(img);
    }
    if (tactic) {
      const row = el('div', 'pick-sk');
      const t = el('div', 'pick-sk-t');
      t.textContent = tactic.name;
      const ty = el('span', 'pick-sk-type');
      ty.textContent = '战术';
      t.appendChild(ty);
      const d = el('div', 'pick-sk-d');
      d.textContent = tacticDisplayText(tactic) || '（效果文本待转写）';
      row.appendChild(t);
      row.appendChild(d);
      box.appendChild(row);
    }
    const data = legendText ?? (isLegend || isTactic ? undefined : ARTIFACT_TEXT[id]);
    if (data) {
      for (const sk of data.skills) {
        const row = el('div', 'pick-sk');
        const t = el('div', 'pick-sk-t');
        t.textContent = sk.name;
        const ty = el('span', 'pick-sk-type');
        ty.textContent = sk.type;
        t.appendChild(ty);
        const d = el('div', 'pick-sk-d');
        d.textContent = sk.text;
        row.appendChild(t);
        row.appendChild(d);
        box.appendChild(row);
      }
    }
    // 特典神器（`special`）：技能描述**之后**追加一行提示
    if (!isLegend && !isTactic && ARTIFACTS[id]?.special) {
      const note = el('div', 'pick-special-note');
      note.textContent = SPECIAL_ARTIFACT_NOTE;
      box.appendChild(note);
    }
    modal.classList.add('on');
    box.classList.toggle('soft', soft);
    position(x, y);
  }
  function handle(x: number, y: number, kind: 'mouse' | 'touch'): boolean {
    const r = box.getBoundingClientRect();
    const on = modal.classList.contains('on');
    const inside = on && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    if (inside) {
      if (kind === 'mouse') close();
      return true;
    }
    const id = cardIdAt(x, y);
    if (!id) {
      if (on) { close(); return true; }
      return false;
    }
    const now = performance.now();
    if (on && now - lastOpen < 120) return true;
    lastOpen = now;
    open(id, x, y, on);
    return true;
  }
  root.addEventListener('contextmenu', (e) => {
    if (handle(e.clientX, e.clientY, 'mouse')) e.preventDefault();
  }, { capture: true, signal });
  root.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (!t) return;
    lpFired = false;
    const x = t.clientX;
    const y = t.clientY;
    if (lpTimer != null) clearTimeout(lpTimer);
    lpTimer = window.setTimeout(() => {
      lpFired = true;
      handle(x, y, 'touch');
    }, 500);
  }, { passive: true, signal });
  const cancelLp = (): void => {
    if (lpTimer != null) { clearTimeout(lpTimer); lpTimer = null; }
  };
  root.addEventListener('touchmove', cancelLp, { passive: true, signal });
  root.addEventListener('touchcancel', cancelLp, { passive: true, signal });
  root.addEventListener('touchend', cancelLp, { passive: true, signal });
  modal.addEventListener('click', (e) => {
    if (e.target === modal && !consumeLp()) close();
  }, { signal });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  }, { signal });
  return { modal, consumeLp, open };
}

/** 「关于游戏」弹窗：主创 / 开发方式 / 版本 / 版权声明（以后的更新与打赏信息也写在这里）。 */
function openAboutModal(): void {
  const overlay = el('div', 'settings-overlay about-overlay');
  const box = el('div', 'settings-panel about-panel');
  const head = el('div', 'settings-head');
  const title = el('div', 'settings-title');
  title.textContent = '关于游戏';
  head.appendChild(title);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-cancel settings-close';
  close.dataset.act = 'aboutClose';
  close.textContent = '✕';
  const bye = (): void => {
    hideSettleTip();
    overlay.remove();
  };
  close.addEventListener('click', bye);
  head.appendChild(close);
  box.appendChild(head);

  const body = el('div', 'about-body');
  const line = (text: string, cls = ''): void => {
    const p = el('div', `about-line${cls ? ` ${cls}` : ''}`);
    p.textContent = text;
    body.appendChild(p);
  };
  line('《尘起时刻》线上版', 'about-title');
  line('策划与实现：群友「无言的双子龙」');
  line('开发方式：OpenCode + DeepSeek V4.1 Flash 协作开发');
  line(`当前版本：${APP_VERSION_LABEL}`, 'about-meta');
  line('原作《尘起时刻》的卡牌、规则与美术版权归原作者所有；本作为非商业同人实现，仅供交流与娱乐。', 'about-note');
  box.appendChild(body);

  overlay.appendChild(box);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) bye();
  });
  document.body.appendChild(overlay);
}

/** 首页（同页多级）：第一层＝模式菜单；第二层＝「左右互搏」的 3 个玩法 */
export function renderSetup(root: HTMLElement, onStart: (opts: SetupOptions) => void): void {
  renderMenu(root, onStart, 'home');
}

function renderMenu(
  root: HTMLElement,
  onStart: (opts: SetupOptions) => void,
  level: 'home' | 'jubai',
): void {
  root.innerHTML = '';
  root.classList.add('setup-page');
  ensureInkFilter();

  const surface = el('div', 'menu-surface');

  // 左上：标题（行书）
  const brand = el('div', 'menu-brand');
  const cn = el('span', 'menu-brand-cn');
  cn.textContent = '尘起时刻';
  const ver = el('span', 'menu-brand-ver');
  ver.textContent = '线上版';
  const stroke = el('div', 'menu-brand-stroke');
  brand.appendChild(cn);
  brand.appendChild(ver);
  brand.appendChild(stroke);
  surface.appendChild(brand);

  const wrap = el('div', 'menu-wrap');
  const menu = el('div', 'menu');
  const go = (lvl: 'home' | 'jubai'): void => renderMenu(root, onStart, lvl);

  if (level === 'jubai') {
    // 「← 返回」：贴左基准线，位于 3 项之上
    const back = button('menu-back', '← 返回');
    back.dataset.act = 'back';
    back.addEventListener('click', () => go('home'));
    menu.appendChild(back);

    const three: Array<[string, 'lunxuan' | 'yuxuan' | 'gouzu']> = [
      ['轮选模式', 'lunxuan'],
      ['预设模式', 'yuxuan'],
      ['构筑模式', 'gouzu'],
    ];
    for (const [label, act] of three) {
      const item = button('menu-item', '');
      item.dataset.act = act;
      const word = el('span', 'word');
      word.textContent = label;
      item.appendChild(word);
      // 预设 → renderHeroSetup；构筑 → renderBuildSetup；轮选暂无界面（点击无反应）
      if (act === 'yuxuan') item.addEventListener('click', () => renderHeroSetup(root, onStart));
      if (act === 'gouzu') item.addEventListener('click', () => renderBuildSetup(root, onStart));
      if (act === 'lunxuan') item.addEventListener('click', () => renderRotationSetup(root, onStart));
      menu.appendChild(item);
    }
  } else {
    const live = (label: string): void => {
      const item = button('menu-item', '');
      item.dataset.act = 'jubai';
      const word = el('span', 'word');
      word.textContent = label;
      item.appendChild(word);
      item.addEventListener('click', () => go('jubai'));
      menu.appendChild(item);
    };
    const online = button('menu-item', '');
    online.dataset.act = 'online';
    const onlineWord = el('span', 'word');
    onlineWord.textContent = '联机游戏';
    online.appendChild(onlineWord);
    online.addEventListener('click', () => renderLobby(root, () => renderMenu(root, onStart, 'home'), onStart));
    menu.appendChild(online);
    live('左右互搏');
    const challenge = button('menu-item', '');
    challenge.dataset.act = 'challenge';
    const cw = el('span', 'word');
    cw.textContent = '挑战模式';
    challenge.appendChild(cw);
    challenge.addEventListener('click', () => renderChallengeSetup(root, onStart));
    menu.appendChild(challenge);
    const link = document.createElement('a');
    link.className = 'menu-item';
    link.href = MENU_EXTERNAL;
    link.target = '_blank';
    link.rel = 'noopener';
    const lw = el('span', 'word');
    lw.textContent = '图鉴查询';
    link.appendChild(lw);
    menu.appendChild(link);
    // 「关于游戏」：主创 / 开发方式 / 版本 / 版权声明（以后的更新与打赏信息也写在这个弹窗里）
    const about = button('menu-item', '');
    about.dataset.act = 'about';
    const aw = el('span', 'word');
    aw.textContent = '关于游戏';
    about.appendChild(aw);
    about.addEventListener('click', () => openAboutModal());
    menu.appendChild(about);
  }

  wrap.appendChild(menu);
  surface.appendChild(wrap);

  // 首页右下角版本号（沿用 .app-version）
  const version = el('div', 'app-version');
  version.textContent = APP_VERSION_LABEL;
  surface.appendChild(version);

  root.appendChild(surface);
}

/** 「左右互搏 · 预设模式」：3 栏（A 确认列 / 中栏名单 / B 确认列）。 */
export function renderHeroSetup(root: HTMLElement, onStart: (opts: SetupOptions) => void, online?: OnlineCtx): void {
  renderPicker(root, onStart, 'yuxuan', online);
}

/** 「左右互搏 · 构筑模式」：5 栏（A 确认 / A 候选 / 中栏名单 / B 候选 / B 确认）。 */
export function renderBuildSetup(root: HTMLElement, onStart: (opts: SetupOptions) => void, online?: OnlineCtx): void {
  renderPicker(root, onStart, 'gouzu', online);
}

/**
 * 战斗牌（战术牌）选择块（预设/构筑/挑战共用）：
 * 标题行（左）＝标题 +「随机」；右上角＝已选卡图；名牌自动流入 4 列网格（首名行 2 个 + 其后每行 4 个）。
 * 右键/长按名牌 → 详情浮窗（靠全局 `data-card-id`）。
 */
function tacticSection(opts: {
  title: string;
  current: string | null;
  /** 对方已选（该张显示「已选」、不可点；随机也避开） */
  taken?: string[];
  inspector: { consumeLp: () => boolean };
  onPick: (id: string | null) => void;
  onRandom: (id: string) => void;
  /** 挑战模式：已选战术若在 `ADJUSTED_TACTICS` 名单里 → 卡图左上角打「调整」徽标（其它模式不传） */
  challenge?: boolean;
}): HTMLElement {
  const taken = opts.taken ?? [];
  const wrap = el('div', 'pick-tactic');
  const head = el('div', 'pick-tactic-head');
  const title = el('span', 'pick-tactic-title');
  title.textContent = opts.title;
  head.appendChild(title);
  const rnd = button('pick-tactic-rand', '随机');
  rnd.addEventListener('click', () => {
    if (opts.inspector.consumeLp()) return;
    const avail = TACTICS.filter((t) => !taken.includes(t.id)).map((t) => t.id);
    if (avail.length === 0) return;
    opts.onRandom(avail[Math.floor(Math.random() * avail.length)]);
  });
  head.appendChild(rnd);
  wrap.appendChild(head);
  const cur = opts.current;
  const chip = el('span', `pick-tactic-chip${cur ? '' : ' empty'}`);
  if (cur) {
    chip.dataset.cardId = cur;
    chip.title = TACTIC_BY_ID[cur]?.name ?? cur;
    const img = document.createElement('img');
    img.src = tacticImageUrl(cur);
    img.alt = '';
    img.draggable = false;
    chip.appendChild(img);
    // 挑战模式：「调整」名单里的战术（如 T02「先机」）→ 与神器同一款红底白字徽标
    if (opts.challenge && ADJUSTED_TACTICS.includes(cur)) {
      const adj = el('span', 'pick-adjust-badge');
      adj.textContent = '调整';
      chip.appendChild(adj);
    }
  }
  wrap.appendChild(chip);
  for (const t of TACTICS) {
    const isTaken = taken.includes(t.id);
    const b = el('div', 'pick-tactic-name' + (isTaken ? ' taken' : '') + (cur === t.id && !isTaken ? ' on' : ''));
    b.dataset.cardId = t.id;
    b.textContent = isTaken ? '已选' : t.name;
    if (!isTaken) {
      b.addEventListener('click', () => {
        if (opts.inspector.consumeLp()) return;
        opts.onPick(cur === t.id ? null : t.id);
      });
    }
    wrap.appendChild(b);
  }
  return wrap;
}

/**
 * 预设 / 构筑共用的分栏选择器。
 * - 预设：点中栏某行的 `A`/`B`＝直接选定该英雄（互搏「开始游戏」即可开局）。
 * - 构筑：点 `A`/`B`＝把该英雄 3 件放进对应「候选列」；选中一件→`确定`→按列号落入「确认列」；
 *   双击候选卡＝选中并确定；任一方已确定的神器在候选里显示「已被选取」。
 * - 关联的附加模组（传奇/异相/战术）**暂未接引擎** → 显示但禁用（横线）。
 */
function renderPicker(root: HTMLElement, onStart: (opts: SetupOptions) => void, mode: PickerMode, online?: OnlineCtx): void {
  root.innerHTML = '';
  root.classList.add('setup-page');
  ensureInkFilter();

  // 离开本页（返回/开局）时移除文档级监听，避免把右键抑制带到对战页
  const ac = new AbortController();
  const signal = ac.signal;

  const owner: Record<number, Side> = {}; // 预设：heroIdx -> side
  const cand: Record<Side, number | null> = { A: null, B: null }; // 构筑：候选区英雄 idx
  const pick: Record<Side, string | null> = { A: null, B: null }; // 构筑：候选区选中神器
  const slots: Record<Side, (string | null)[]> = { A: [null, null, null], B: [null, null, null] }; // 构筑：按列固定格
  const confirmed: Record<Side, boolean> = { A: false, B: false };
  let first: 'A' | 'B' | 'random' = 'random';
  let anomaly = false; // 「使用异相神器」开关
  let legendOn = false; // 「使用传奇英雄面板」开关（仅预设模式）
  let tacticOn = false; // 「使用战术牌」开关（构筑；预设/轮选后续接入）
  const tacticPick: Record<Side, string | null> = { A: null, B: null }; // 已选战斗牌 id
  const candAlt: Record<Side, boolean[]> = { A: [false, false, false], B: [false, false, false] };
  let anim: { side: Side; ids: string[] } | null = null;
  let ANIM: { side: Side; ids: string[] } | null = null;

  const surface = el('div', 'pick-surface');
  const top = el('div', 'pick-top');
  const board = el('div', 'pick-board');
  surface.appendChild(top);
  surface.appendChild(board);
  const version = el('div', 'app-version');
  version.textContent = APP_VERSION_LABEL;
  surface.appendChild(version);

  const inspector = createCardInspector(root, signal, { legendText: true });
  root.appendChild(surface);
  root.appendChild(inspector.modal);

  // 联机外壳（3a）：顶栏换成"退出房间 / 标题·联机 / 双方名 / 聊天 / 房间设置"；选择逻辑暂不变
  let shell: OnlineShell | null = null;
  if (online) {
    shell = createOnlineShell(
      {
        session: online.session,
        onExit: () => {
          ac.abort();
          shell?.dispose();
          online.session.close(); // 离场关闭会话（否则旧 BroadcastChannel 还在应答 → "在线人数"虚高）
          online.onExit();
        },
      },
      root,
    );
  }

  // ── 联机选择同步（3b）：预设/构筑＝各自选自己（只同步"我这一侧"，对端只读）──
  const mySide: Side | null = online?.session.state.myPlayer ?? null;
  const onlineOn = !!(online && mySide);
  const oppSide: Side | null = mySide === 'A' ? 'B' : mySide === 'B' ? 'A' : null;
  const selMode: 'preset' | 'build' = mode === 'yuxuan' ? 'preset' : 'build';
  if (onlineOn && online) {
    const cfg = online.session.state.config; // 附加开关取自房间配置（两端一致、只读）
    if (cfg) {
      anomaly = cfg.alt;
      legendOn = cfg.legend;
      tacticOn = cfg.tactics;
    }
  }
  const mySnap = (): unknown =>
    mode === 'yuxuan'
      ? {
          heroes: Object.keys(owner)
            .map(Number)
            .filter((i) => owner[i] === mySide),
          confirmed: mySide ? confirmed[mySide] : false,
        }
      : {
          slots: mySide ? slots[mySide] : [null, null, null],
          confirmed: mySide ? confirmed[mySide] : false,
          tacticPick: mySide ? tacticPick[mySide] : null,
          candAlt: mySide ? candAlt[mySide] : [false, false, false],
        };
  const bcast = (): void => {
    if (onlineOn && online && mySide) online.session.sendSel(selMode, mySide, 'merge', mySnap());
  };
  const guestJoined = (): boolean => !!online && online.session.state.members.some((m) => m.role === 'guest');
  const readOnly = (side: Side): boolean => onlineOn && (side !== mySide || !guestJoined());
  const onlineReady = (): boolean => onlineOn && !!mySide && confirmed[mySide!] && !!oppSide && confirmed[oppSide];
  if (onlineOn && online) {
    const sess = online.session;
    let applied: unknown = null;
    sess.subscribe((s) => {
      const sel = s.sel;
      if (!sel || sel === applied || !oppSide || sel.mode !== selMode || sel.side !== oppSide) return;
      applied = sel;
      const d = sel.data as {
        heroes?: number[];
        confirmed?: boolean;
        slots?: (string | null)[];
        tacticPick?: string | null;
        candAlt?: boolean[];
      };
      if (mode === 'yuxuan') {
        for (const k of Object.keys(owner)) if (owner[Number(k)] === oppSide) delete owner[Number(k)];
        for (const h of d.heroes ?? []) owner[h] = oppSide;
        confirmed[oppSide] = !!d.confirmed;
      } else {
        slots[oppSide] = d.slots ?? [null, null, null];
        confirmed[oppSide] = !!d.confirmed;
        tacticPick[oppSide] = d.tacticPick ?? null;
        candAlt[oppSide] = d.candAlt ?? [false, false, false];
      }
      render();
    });
    bcast(); // 进场先广播一次"我这一侧"状态
    // 访客加入 / 离开 → 重绘（解锁 / 锁住选择）
    let lastGj = guestJoined();
    sess.subscribe(() => {
      const gj = guestJoined();
      if (gj !== lastGj) {
        lastGj = gj;
        render();
      }
    });
    // 对局一旦生成（房主 startGame / 访客收到 start）→ 进战斗界面
    let battleEntered = false;
    sess.subscribe((s) => {
      if (battleEntered || !s.game) return;
      battleEntered = true;
      ac.abort();
      shell?.dispose();
      enterOnlineBattle(sess);
    });
  }

  /** 开局（仅房主）：把最终 SetupOptions + seed 广播，两端各自建局 */
  const hostStart = (): void => {
    if (!onlineOn || !online || online.session.state.role !== 'host') return;
    ac.abort();
    shell?.dispose();
    online.session.startGame(buildStartSetup());
  };

  // ── 小工具 ──
  const sides: Side[] = ['A', 'B'];
  const other = (s: Side): Side => (s === 'A' ? 'B' : 'A');
  const heroIds = (idx: number): [string, string, string] => HEROES[HERO_KEYS[idx]];
  const heroLabel = (idx: number): string => HERO_LABELS[HERO_KEYS[idx]];
  // 异相 id 先解析回原版，再按其所在列返回（0–2）
  const colOf = (id: string): number => {
    const b = BASE_OF[id] ?? id;
    const i = HERO_KEYS.findIndex((k) => (HEROES[k] as string[]).includes(b));
    return (HEROES[HERO_KEYS[i]] as string[]).indexOf(b);
  };
  const ownerIdx = (side: Side): number | null => {
    for (const k of Object.keys(owner)) if (owner[Number(k)] === side) return Number(k);
    return null;
  };
  const jiaIds = (side: Side): string[] => {
    const i = ownerIdx(side);
    return i == null ? [] : heroIds(i).slice();
  };
  const jiaLabel = (side: Side): string => {
    const i = ownerIdx(side);
    return i == null ? '未选' : heroLabel(i);
  };
  const filled = (side: Side): number => slots[side].filter(Boolean).length;
  const takenAnywhere = (id: string): boolean =>
    sides.some((s) => slots[s].some((x) => x === id));

  // ── 顶栏 ──
  function buildTop(): void {
    top.innerHTML = '';
    if (shell) {
      shell.bar(top, mode === 'yuxuan' ? '预设模式' : '构筑模式', { onStart: hostStart, canStart: onlineReady() });
      return;
    }
    const back = button('pick-back', '返回');
    back.addEventListener('click', () => {
      ac.abort();
      renderMenu(root, onStart, 'jubai');
    });
    top.appendChild(back);

    const ttl = el('span', 'pick-ttl');
    ttl.textContent = mode === 'yuxuan' ? '预设模式' : '构筑模式';
    top.appendChild(ttl);

    const g1 = el('span', 'pick-grp');
    const l1 = el('span', 'pick-lab');
    l1.textContent = '先手选择';
    g1.appendChild(l1);
    const firstDefs: Array<[string, 'A' | 'B' | 'random']> = [
      ['玩家A', 'A'],
      ['玩家B', 'B'],
      ['随机', 'random'],
    ];
    for (const [label, val] of firstDefs) {
      const c = el('span', 'pick-tbtn' + (first === val ? ' on' + (val === 'A' ? ' A' : val === 'B' ? ' B' : '') : ''));
      c.dataset.first = val;
      c.textContent = label;
      c.addEventListener('click', () => {
        first = val;
        render();
      });
      g1.appendChild(c);
    }
    top.appendChild(g1);

    const g2 = el('span', 'pick-grp');
    const l2 = el('span', 'pick-lab');
    l2.textContent = '附加模组';
    g2.appendChild(l2);
    if (mode === 'yuxuan') {
      const w = el('span', 'pick-sw' + (legendOn ? ' on' : ''));
      w.appendChild(el('span', 'pick-dot'));
      const lab = el('span', 'pick-swlab'); lab.textContent = '使用传奇英雄面板'; w.appendChild(lab);
      w.addEventListener('click', () => { legendOn = !legendOn; render(); });
      g2.appendChild(w);
    } else {
      const w = el('span', 'pick-sw' + (anomaly ? ' on' : ''));
      w.appendChild(el('span', 'pick-dot'));
      const lab = el('span', 'pick-swlab'); lab.textContent = '使用异相神器'; w.appendChild(lab);
      w.addEventListener('click', () => { anomaly = !anomaly; render(); });
      g2.appendChild(w);
    }
    {
      // 战术牌：预设＝进战斗后抽 2 留 1（本开关只表示"启用"）；构筑＝在确认列直接选
      const w = el('span', 'pick-sw' + (tacticOn ? ' on' : ''));
      w.appendChild(el('span', 'pick-dot'));
      const lab = el('span', 'pick-swlab'); lab.textContent = '使用战术牌'; w.appendChild(lab);
      w.addEventListener('click', () => { tacticOn = !tacticOn; render(); });
      g2.appendChild(w);
    }
    top.appendChild(g2);

    const start = button('pick-start', '开始游戏');
    start.addEventListener('click', () => {
      ac.abort();
      startGame();
    });
    // 「开始游戏」门槛：**仅构筑**——双方都"确定"神器（战术牌开关开时还需都选战术牌）才能开始；
    // 预设模式保持原状（未选的一方随机补足）。
    const bothPicked = confirmed.A && confirmed.B;
    const needTactic = mode === 'gouzu' && tacticOn;
    const tacticReady = !needTactic || (!!tacticPick.A && !!tacticPick.B);
    const canStart = mode !== 'gouzu' || (bothPicked && tacticReady);
    start.disabled = !canStart;
    top.appendChild(start);
    if (!canStart) {
      const hint = el('span', 'pick-start-hint');
      hint.textContent = !bothPicked ? '双方都选好 3 件神器才能开始' : '双方都选好战术牌才能开始';
      top.appendChild(hint);
    }
  }

  // ── 卡槽 ──
  function cardSlot(id: string, opts: { side?: Side; ink?: boolean; clickable?: boolean; locked?: boolean; picked?: boolean; onClick?: () => void; onDblClick?: () => void; altSwitch?: (() => void) | null; altSwitchDisabled?: boolean } = {}): HTMLElement {
    const s = el('div', 'pick-slot');
    if (opts.ink) s.classList.add('ink');
    if (ANIM && opts.side === ANIM.side && ANIM.ids.includes(id)) s.classList.add('pop');
    const art = el('div', 'pick-art');
    const inner = el('div', 'pick-art-inner');
    const img = document.createElement('img');
    img.src = cardUrl(id);
    img.alt = '';
    inner.appendChild(img);
    art.appendChild(inner);
    s.appendChild(art);
    s.dataset.cardId = id;
    if (isAltArtifact(id)) addAltBadge(inner);
      if (ARTIFACTS[id]?.special) addSpecialBadge(inner);
    if (opts.altSwitch) addAltSwitch(inner, opts.altSwitch, opts.altSwitchDisabled === true);
    if (opts.clickable && !opts.locked) {
      s.classList.add('clickable');
      if (opts.picked) s.classList.add('picked');
      s.addEventListener('click', () => {
        if (inspector.consumeLp()) return;
        opts.onClick?.();
      });
      if (opts.onDblClick) {
        s.addEventListener('dblclick', () => {
          if (inspector.consumeLp()) return;
          opts.onDblClick?.();
        });
      }
    }
    return s;
  }
  function takenSlot(): HTMLElement {
    const s = el('div', 'pick-slot taken');
    const art = el('div', 'pick-art');
    const lbl = el('span', 'pick-taken');
    lbl.textContent = '已被选取';
    art.appendChild(lbl);
    s.appendChild(art);
    return s;
  }
  function emptySlot(i: number): HTMLElement {
    const s = el('div', 'pick-slot empty');
    const t = el('span', 'pick-colno');
    t.textContent = COL_LABELS[i];
    s.appendChild(t);
    return s;
  }
  function colHead(who: string, sub: string, rightEl?: HTMLElement): HTMLElement {
    const h = el('div', 'pick-chead');
    const w = el('span', 'who');
    w.textContent = who;
    const s = el('span', 'sub');
    s.textContent = sub;
    h.appendChild(w);
    h.appendChild(s);
    if (rightEl) h.appendChild(rightEl);
    return h;
  }
  function seal(): HTMLElement {
    const s = el('div', 'pick-seal');
    s.textContent = '已确认';
    return s;
  }
  function confirmFoot(side: Side, withOk: boolean): HTMLElement {
    const f = el('div', 'pick-foot');
    const canceled = mode === 'yuxuan' ? jiaIds(side).length === 0 : filled(side) === 0;
    const cancel = button('pick-cbtn', '取消');
    cancel.disabled = canceled;
    cancel.addEventListener('click', () => clearSide(side));
    f.appendChild(cancel);
    if (withOk) {
      const hasHero = jiaIds(side).length > 0;
      const ok = button('pick-cbtn pick-ok' + (confirmed[side] ? ' on' : ''), '确定');
      ok.disabled = !hasHero;
      ok.addEventListener('click', () => {
        if (readOnly(side) || jiaIds(side).length === 0) return;
        confirmed[side] = !confirmed[side];
        anim = null;
        bcast();
        render();
      });
      f.appendChild(ok);
    }
    return f;
  }

  // 传奇英雄面板入口（确认列头右对齐）：迷你黑框头像（图片满高 787×740；显示框 787:756＝上下各 +8px 黑边，缩到 36px）+ 标签
  function buildLegendChip(heroIdx: number): HTMLElement {
    const legendId = LEGEND_OF_HERO[HERO_KEYS[heroIdx]];
    const chip = el('span', 'pick-legend-chip');
    chip.dataset.cardId = legendId; // 复用详情浮窗：右键/长按也走同一入口
    const av = el('span', 'pick-legend-av');
    const img = document.createElement('img');
    img.src = legendImageUrl(legendId);
    img.alt = '';
    img.draggable = false;
    av.appendChild(img);
    const lab = el('span', 'pick-legend-lab');
    lab.textContent = '传奇英雄技能';
    chip.appendChild(lab); // 先文字
    chip.appendChild(av); // 后图案
    const pop = (x: number, y: number): void => { inspector.open(legendId, x, y, false); };
    chip.addEventListener('click', (e) => { e.preventDefault(); pop(e.clientX, e.clientY); });
    let t: number | null = null;
    chip.addEventListener('pointerdown', () => {
      t = window.setTimeout(() => { t = null; const r = chip.getBoundingClientRect(); pop(r.left + r.width / 2, r.top); }, 500);
    });
    const clear = (): void => { if (t != null) { window.clearTimeout(t); t = null; } };
    chip.addEventListener('pointerup', clear);
    chip.addEventListener('pointerleave', clear);
    chip.addEventListener('pointercancel', clear);
    return chip;
  }

  // ── 确认列 ──
  function confirmColJia(side: Side): HTMLElement {
    const ids = jiaIds(side);
    const col = el('div', 'pick-col confirm ' + side + (confirmed[side] ? ' confirmed' : ''));
    const idx = ownerIdx(side);
    const chip = mode === 'yuxuan' && legendOn && idx != null ? buildLegendChip(idx) : undefined;
    col.appendChild(colHead('玩家' + side, jiaLabel(side), chip));
    const cards = el('div', 'pick-cards');
    for (let i = 0; i < 3; i++) cards.appendChild(ids[i] ? cardSlot(ids[i], { side }) : emptySlot(i));
    col.appendChild(cards);
    col.appendChild(confirmFoot(side, true));
    if (confirmed[side]) col.appendChild(seal());
    return col;
  }
  function confirmColYi(side: Side): HTMLElement {
    const col = el('div', 'pick-col confirm ' + side + (confirmed[side] ? ' confirmed' : ''));
    col.appendChild(colHead('玩家' + side + ' 神器', '已选 ' + filled(side) + '/3'));
    const cards = el('div', 'pick-cards');
    for (let c = 0; c < 3; c++) {
      const id = slots[side][c];
      if (!id) { cards.appendChild(emptySlot(c)); continue; }
      const slot = cardSlot(id, { side });
      slot.dataset.col = String(c + 1);
      cards.appendChild(slot);
    }
    col.appendChild(cards);
    col.appendChild(confirmFoot(side, false));
    if (mode === 'gouzu' && tacticOn) col.appendChild(tacticBlock(side));
    if (confirmed[side]) col.appendChild(seal());
    return col;
  }

  // ── 战斗牌（战术牌）选择：就地「战策榜」（共用 tacticSection）──
  function tacticBlock(side: Side): HTMLElement {
    const oppPick = tacticPick[other(side)];
    return tacticSection({
      title: `玩家${side} 战术牌`,
      current: tacticPick[side],
      taken: oppPick ? [oppPick] : [],
      inspector,
      onPick: (id) => { if (readOnly(side)) return; tacticPick[side] = id; bcast(); render(); },
      onRandom: (id) => { if (readOnly(side)) return; tacticPick[side] = id; bcast(); render(); },
    });
  }

  // ── 候选列（构筑）──
  function candCol(side: Side): HTMLElement {
    const col = el('div', 'pick-col cand ' + side + (confirmed[side] ? ' locked' : ''));
    const ci = cand[side];
    col.appendChild(colHead('玩家' + side + ' 候选', ci == null ? '先点名' : heroLabel(ci)));
    const cards = el('div', 'pick-cards');
    if (ci == null) {
      for (let i = 0; i < 3; i++) cards.appendChild(emptySlot(i));
    } else {
      const ids = heroIds(ci);
      for (let i = 0; i < 3; i++) {
        const baseId = ids[i];
        const altId = ALT_OF[baseId]; // 该列的异相版（无则 undefined）
        let id = anomaly && candAlt[side][i] && altId ? altId : baseId;
        // 修复：普通 / 异相是"两件"。若"当前偏好的那版"已被对方选走、而另一版空闲 → 自动切到空闲那版
        let forced = false;
        if (anomaly && altId) {
          const otherId = id === baseId ? altId : baseId;
          if (takenAnywhere(id) && !takenAnywhere(otherId)) {
            id = otherId;
            forced = true;
          }
        }
        if (takenAnywhere(id)) { cards.appendChild(takenSlot()); continue; }
        const locked = confirmed[side];
        const slot = cardSlot(id, {
          side,
          ink: true,
          clickable: true,
          locked,
          picked: pick[side] === id,
          onClick: () => {
            if (readOnly(side)) return;
            pick[side] = pick[side] === id ? null : id;
            anim = null;
            render();
          },
          onDblClick: () => {
            pick[side] = id;
            confirmPickYi(side);
          },
          altSwitch: anomaly && !locked && altId
            ? () => { candAlt[side][i] = !candAlt[side][i]; pick[side] = null; anim = null; render(); }
            : null,
          altSwitchDisabled: forced,
        });
        cards.appendChild(slot);
      }
    }
    col.appendChild(cards);
    const foot = el('div', 'pick-foot');
    const ok = button('pick-cbtn pick-ok', '确定');
    ok.disabled = !pick[side] || confirmed[side];
    ok.addEventListener('click', () => confirmPickYi(side));
    foot.appendChild(ok);
    col.appendChild(foot);
    return col;
  }

  // ── 中栏名单 ──
  function namesCol(): HTMLElement {
    const col = el('div', 'pick-col names');
    col.appendChild(colHead('选择英雄', ''));
    const scroll = el('div', 'pick-names');
    const randRow = el('div', 'pick-rand-row');
    for (const side of sides) {
      const b = button('pick-rand ' + side, '玩家' + side + '随机');
      b.addEventListener('click', () => randomAssign(side));
      randRow.appendChild(b);
    }
    scroll.appendChild(randRow);

    HERO_KEYS.forEach((key, i) => {
      const cell = el('div', 'pick-cell');
      cell.dataset.hero = key;
      if (mode === 'yuxuan' && owner[i]) cell.classList.add('is-taken');
      const nm = el('div', 'pick-name');
      nm.textContent = HERO_LABELS[key];
      cell.appendChild(nm);
      const acts = el('div', 'pick-acts');
      for (const side of sides) {
        const b = button('pick-ab ' + side, side);
        b.dataset.hero = key;
        b.dataset.side = side;
        if (mode === 'yuxuan') {
          const o = owner[i];
          if (o === side) b.classList.add('is-mine');
          if (o && o !== side) b.classList.add('is-taken');
          else if (readOnly(side)) b.classList.add('is-disabled');
          else b.addEventListener('click', () => assignHero(i, side));
        } else {
          if (cand[side] === i) b.classList.add('is-cur');
          if (readOnly(side)) b.classList.add('is-disabled');
          else
            b.addEventListener('click', () => {
              cand[side] = cand[side] === i ? null : i;
              candAlt[side] = [false, false, false];
              pick[side] = null;
              anim = null;
              bcast();
              render();
            });
        }
        acts.appendChild(b);
      }
      cell.appendChild(acts);
      scroll.appendChild(cell);
    });
    col.appendChild(scroll);
    return col;
  }

  // ── 修改状态 ──
  function assignHero(i: number, side: Side): void {
    if (readOnly(side)) return;
    if (owner[i] === side) { delete owner[i]; confirmed[side] = false; anim = null; bcast(); render(); return; }
    for (const k of Object.keys(owner)) if (owner[Number(k)] === side) delete owner[Number(k)];
    owner[i] = side;
    confirmed[side] = false;
    anim = { side, ids: heroIds(i).slice() };
    bcast();
    render();
  }
  function randomAssign(side: Side): void {
    if (readOnly(side)) return;
    if (mode === 'yuxuan') {
      const pool = HERO_KEYS.map((_, i) => i).filter((i) => !owner[i] || owner[i] === side);
      if (pool.length === 0) return;
      for (const k of Object.keys(owner)) if (owner[Number(k)] === side) delete owner[Number(k)];
      const idx = pool[Math.floor(Math.random() * pool.length)];
      owner[idx] = side;
      confirmed[side] = false;
      anim = { side, ids: heroIds(idx).slice() };
    } else {
      const o = other(side);
      const next: (string | null)[] = [null, null, null];
      const chosen: string[] = [];
      for (let c = 0; c < 3; c++) {
        const pool = randomColumnPool(c, anomaly, [slots[o][c] ?? '', ...chosen]);
        next[c] = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
        if (next[c]) chosen.push(next[c]!);
      }
      slots[side] = next;
      confirmed[side] = true;
      pick[side] = null;
      candAlt[side] = [false, false, false];
      anim = { side, ids: next.filter(Boolean) as string[] };
    }
    bcast();
    render();
  }
  function confirmPickYi(side: Side): void {
    if (readOnly(side)) return;
    const id = pick[side];
    if (!id || confirmed[side]) return;
    slots[side][colOf(id)] = id;
    pick[side] = null;
    if (filled(side) === 3) confirmed[side] = true;
    anim = { side, ids: [id] };
    bcast();
    render();
  }
  function clearSide(side: Side): void {
    if (readOnly(side)) return;
    if (mode === 'yuxuan') {
      for (const k of Object.keys(owner)) if (owner[Number(k)] === side) delete owner[Number(k)];
    } else {
      slots[side] = [null, null, null];
      pick[side] = null;
    }
    confirmed[side] = false;
    anim = null;
    bcast();
    render();
  }

  // ── 开局 ──
  function buildStartSetup(): SetupOptions {
    let trioA: string[];
    let trioB: string[];
    if (mode === 'yuxuan') {
      const taken = new Set<number>();
      const randHero = (): number => {
        const pool = HERO_KEYS.map((_, i) => i).filter((i) => !taken.has(i));
        return pool[Math.floor(Math.random() * pool.length)];
      };
      const resolve = (side: Side): number => {
        const own = ownerIdx(side);
        const idx = own != null ? own : randHero();
        taken.add(idx);
        return idx;
      };
      const ia = resolve('A');
      let ib = resolve('B');
      if (ib === ia) ib = randHero();
      trioA = heroIds(ia).slice();
      trioB = heroIds(ib).slice();
    } else {
      const resolve = (side: Side, used: Set<string>): string[] => {
        const out: string[] = [];
        for (let c = 0; c < 3; c++) {
          let id = slots[side][c];
          if (!id) {
            const pool = HERO_KEYS.map((k) => HEROES[k][c]).filter((x) => !used.has(x));
            id = pool[Math.floor(Math.random() * pool.length)];
          }
          used.add(id);
          out.push(id);
        }
        return out;
      };
      const used = new Set<string>();
      trioA = resolve('A', used);
      trioB = resolve('B', used);
    }
    const firstPlayer: PlayerId = first === 'random' ? (Math.random() < 0.5 ? 'A' : 'B') : first;
    const withLegend = mode === 'yuxuan' && legendOn;
    return {
      heroA: trioA as [string, string, string],
      heroB: trioB as [string, string, string],
      firstPlayer,
      legendA: withLegend ? legendOfTrio(trioA) : undefined,
      legendB: withLegend ? legendOfTrio(trioB) : undefined,
      tactics: mode === 'yuxuan' && tacticOn,
      // 构筑：直接选定的战术牌 → 带进开局（预设/轮选走"抽 2 留 1"，此处不带）；
      //   **仅当"使用战术牌"开关开启时**才带，避免关掉开关后仍把旧选择带进去。
      tacticA: mode === 'gouzu' && tacticOn ? tacticPick.A ?? undefined : undefined,
      tacticB: mode === 'gouzu' && tacticOn ? tacticPick.B ?? undefined : undefined,
    };
  }
  function startGame(): void {
    onStart(buildStartSetup());
  }

  // ── 渲染 ──
  function buildBoard(): void {
    const locked = onlineOn && !guestJoined();
    board.className = 'pick-board ' + mode + (locked ? ' pick-board--locked' : '');
    board.innerHTML = '';
    if (mode === 'yuxuan') {
      board.appendChild(confirmColJia('A'));
      board.appendChild(namesCol());
      board.appendChild(confirmColJia('B'));
    } else {
      board.appendChild(confirmColYi('A'));
      board.appendChild(candCol('A'));
      board.appendChild(namesCol());
      board.appendChild(candCol('B'));
      board.appendChild(confirmColYi('B'));
    }
  }
  function render(): void {
    ANIM = anim;
    anim = null;
    buildTop();
    buildBoard();
    ANIM = null;
  }

  render();
}

/**
 * 「左右互搏 · 轮选模式」：3 区（`玩家A确认 ｜ 九宫格板(内 3 列) ｜ 玩家B确认`）。
 * 准备态先定先手（默认随机）→ 进入轮选；严格按说明书 page_10 的 6 步流程。
 */
export function renderRotationSetup(root: HTMLElement, onStart: (opts: SetupOptions) => void, online?: OnlineCtx): void {
  root.innerHTML = '';
  root.classList.add('setup-page');
  ensureInkFilter();

  const ac = new AbortController();
  const signal = ac.signal;
  const other = (s: Side): Side => (s === 'A' ? 'B' : 'A');

  let phase: 'prep' | 'draft' = 'prep';
  let firstPlayer: Side = 'A';
  let anomaly = false; // 「使用异相神器」开关
  let tacticOn = false; // 「使用战术牌」开关（轮选：进战斗后抽 2 留 1）
  let pieces: Array<{ col: number; id: string; baseId: string }> = [];
  let removed: boolean[] = [];
  let taken: Record<Side, (string | null)[]> = { A: [null, null, null], B: [null, null, null] };
  let step = 1;
  let removedCol = 0;
  let step4Cols: number[] = [];
  let done = false;
  let animIds: string[] | null = null;
  let ANIM: string[] | null = null;

  const inspector = createCardInspector(root, signal);
  const surface = el('div', 'pick-surface');
  const version = el('div', 'app-version');
  version.textContent = APP_VERSION_LABEL;
  root.appendChild(surface);
  root.appendChild(inspector.modal);

  // ── 联机（3b）：轮选＝"轮到谁谁选"；房主抽池并广播，对端采纳；只有 actor() 能选 ──
  let shell: OnlineShell | null = null;
  const mySideR: Side | null = online?.session.state.myPlayer ?? null;
  const onlineOnR = !!(online && mySideR);
  const guestJoinedR = (): boolean => !!online && online.session.state.members.some((m) => m.role === 'guest');
  if (online && mySideR) {
    const cfg = online.session.state.config;
    const f = cfg?.first ?? 'host';
    firstPlayer = f === 'host' ? 'A' : f === 'guest' ? 'B' : (online.session.state.roomId ?? '').length % 2 === 0 ? 'A' : 'B';
    anomaly = cfg?.alt ?? false;
    tacticOn = cfg?.tactics ?? false;
    phase = 'draft'; // 联机跳过"选先手"准备态
    shell = createOnlineShell(
      {
        session: online.session,
        onExit: () => {
          ac.abort();
          shell?.dispose();
          online.session.close(); // 离场关闭会话（否则旧 BroadcastChannel 还在应答 → "在线人数"虚高）
          online.onExit();
        },
      },
      root,
    );
  }
  const bcastDraft = (): void => {
    if (onlineOnR && online && mySideR)
      online.session.sendSel('draft', mySideR, 'whole', { pieces, removed, taken, step, removedCol, step4Cols, done });
  };
  if (onlineOnR && online) {
    const sess = online.session;
    let applied: unknown = null;
    sess.subscribe((s) => {
      const sel = s.sel;
      if (!sel || sel === applied || sel.mode !== 'draft') return;
      applied = sel;
      const d = sel.data as {
        pieces?: typeof pieces;
        removed?: boolean[];
        taken?: typeof taken;
        step?: number;
        removedCol?: number;
        step4Cols?: number[];
        done?: boolean;
      };
      pieces = d.pieces ?? [];
      removed = d.removed ?? [];
      taken = d.taken ?? { A: [null, null, null], B: [null, null, null] };
      step = d.step ?? 1;
      removedCol = d.removedCol ?? 0;
      step4Cols = d.step4Cols ?? [];
      done = !!d.done;
      phase = 'draft';
      render();
    });
    if (sess.state.role === 'host') {
      drawPool();
      bcastDraft();
    }
    // 访客加入 / 离开 → 重绘（解锁 / 锁住）；**访客加入时房主重随一次牌池并广播**（访客首帧牌池为空）
    let lastGjR = guestJoinedR();
    sess.subscribe(() => {
      const gj = guestJoinedR();
      if (gj !== lastGjR) {
        lastGjR = gj;
        if (gj && sess.state.role === 'host') {
          drawPool();
          bcastDraft();
        }
        render();
      }
    });
    // 对局生成（房主 startGame / 访客收到 start）→ 进战斗界面
    let battleEnteredR = false;
    sess.subscribe((s) => {
      if (battleEnteredR || !s.game) return;
      battleEnteredR = true;
      ac.abort();
      shell?.dispose();
      enterOnlineBattle(sess);
    });
  }
  const hostStartRot = (): void => {
    if (!onlineOnR || !online || online.session.state.role !== 'host' || !done) return;
    ac.abort();
    shell?.dispose();
    online.session.startGame({
      heroA: taken.A as [string, string, string],
      heroB: taken.B as [string, string, string],
      firstPlayer,
      tactics: tacticOn,
    });
  };

  const takenIds = (): string[] => [...taken.A, ...taken.B].filter((x): x is string => !!x);
  const isRemaining = (i: number): boolean => !removed[i] && !takenIds().includes(pieces[i].id);
  const remainingCount = (): number => pieces.filter((_, i) => isRemaining(i)).length;
  const missingCol = (side: Side): number | null => {
    for (let c = 0; c < 3; c++) if (!taken[side][c]) return c;
    return null;
  };
  const actor = (): Side => (step === 2 || step === 4 ? other(firstPlayer) : firstPlayer);
  const remainingCols = (): number[] => {
    const cols: number[] = [];
    for (let c = 0; c < 3; c++) if (pieces.some((p, i) => p.col === c && isRemaining(i))) cols.push(c);
    return cols;
  };
  const isLegal = (i: number): boolean => {
    if (done || phase !== 'draft' || !isRemaining(i)) return false;
    if (onlineOnR && actor() !== mySideR) return false; // 联机：非当前操作者不可点（也不显示可点框）
    const p = pieces[i];
    if (step === 1 || step === 3) return true;
    if (step === 2) return p.col === removedCol;
    if (step === 4) return !step4Cols.includes(p.col);
    if (step === 5) return p.col === missingCol(firstPlayer);
    return false;
  };

  function drawPool(): void {
    pieces = [];
    for (let c = 0; c < 3; c++) {
      const sh = HERO_KEYS.map((k) => HEROES[k][c]);
      for (let i = sh.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [sh[i], sh[j]] = [sh[j], sh[i]];
      }
      for (const id of sh.slice(0, 3)) pieces.push({ col: c, id, baseId: id });
    }
    removed = pieces.map(() => false);
    taken = { A: [null, null, null], B: [null, null, null] };
    step = 1;
    removedCol = 0;
    step4Cols = [];
    done = false;
  }

  function onPick(i: number): void {
    if (onlineOnR && (actor() !== mySideR || !guestJoinedR())) return;
    if (!isLegal(i)) return;
    const p = pieces[i];
    if (step === 1) {
      removed[i] = true;
      removedCol = p.col;
      step = 2;
      animIds = null;
    } else if (step === 2) {
      taken[other(firstPlayer)][p.col] = p.id;
      const mateIdx = pieces.findIndex((q, j) => q.col === p.col && j !== i && isRemaining(j));
      const mate = mateIdx >= 0 ? pieces[mateIdx].id : null;
      if (mate) taken[firstPlayer][p.col] = mate;
      step = 3;
      animIds = mate ? [p.id, mate] : [p.id];
    } else if (step === 3) {
      taken[firstPlayer][p.col] = p.id;
      step = 4;
      step4Cols = [];
      animIds = [p.id];
    } else if (step === 4) {
      taken[other(firstPlayer)][p.col] = p.id;
      step4Cols = [...step4Cols, p.col];
      if (step4Cols.length >= 2) step = 5;
      animIds = [p.id];
    } else if (step === 5) {
      taken[firstPlayer][p.col] = p.id;
      for (let j = 0; j < pieces.length; j++) if (isRemaining(j)) removed[j] = true;
      done = true;
      step = 6;
      animIds = [p.id];
    }
    bcastDraft();
    render();
  }

  function buildTop(): void {
    const top = el('div', 'pick-top');
    if (shell) {
      shell.bar(top, '轮选模式', { onStart: hostStartRot, canStart: done });
      surface.appendChild(top);
      return;
    }
    const back = button('pick-back', '返回');
    back.addEventListener('click', () => { ac.abort(); renderMenu(root, onStart, 'jubai'); });
    top.appendChild(back);

    const ttl = el('span', 'pick-ttl');
    ttl.textContent = '轮选模式';
    if (phase === 'prep') {
      const st = el('span', 'pick-ttl-state');
      st.textContent = ' · 准备';
      ttl.appendChild(st);
    }
    top.appendChild(ttl);

    if (phase === 'draft') {
      const g0 = el('span', 'pick-grp');
      const l0 = el('span', 'pick-lab');
      l0.textContent = '先手';
      g0.appendChild(l0);
      const f = el('span', 'pick-tbtn on ' + firstPlayer);
      f.textContent = '玩家' + firstPlayer;
      g0.appendChild(f);
      top.appendChild(g0);
    }

    const g2 = el('span', 'pick-grp');
    const l2 = el('span', 'pick-lab');
    l2.textContent = '附加模组';
    g2.appendChild(l2);
    for (const label of ['使用异相神器', '使用战术牌']) {
      const on = label === '使用异相神器' ? anomaly : tacticOn;
      const w = el('span', 'pick-sw' + (on ? ' on' : ''));
      w.appendChild(el('span', 'pick-dot'));
      const lab = el('span', 'pick-swlab');
      lab.textContent = label;
      w.appendChild(lab);
      if (label === '使用异相神器') w.addEventListener('click', () => { anomaly = !anomaly; render(); });
      else w.addEventListener('click', () => { tacticOn = !tacticOn; render(); });
      g2.appendChild(w);
    }
    top.appendChild(g2);

    if (phase === 'draft') {
      const start = button('pick-start', '开始游戏');
      start.disabled = !done;
      start.addEventListener('click', () => {
        if (!done) return;
        ac.abort();
        onStart({
          heroA: taken.A as [string, string, string],
          heroB: taken.B as [string, string, string],
          firstPlayer,
          tactics: tacticOn,
        });
      });
      top.appendChild(start);
    }
    surface.appendChild(top);
  }

  function stepText(): string {
    if (done) return '轮选完成，可点「<b>开始游戏</b>」';
    if (step === 1) return '从 9 件中<b>选 1 件移除</b>';
    if (step === 2) return `从「${COL_LABELS[removedCol]}」剩 2 件中<b>选 1 件</b>（另 1 件归先手）`;
    if (step === 3) return `从剩余 ${remainingCount()} 件中<b>任选 1 件</b>`;
    if (step === 4) return `从「${remainingCols().map((c) => COL_LABELS[c]).join('」「')}」<b>各选 1 件</b>（${step4Cols.length + 1}/2）`;
    if (step === 5) {
      const m = missingCol(firstPlayer);
      return `从你缺少的「${m == null ? '' : COL_LABELS[m]}」2 件中<b>选最后 1 件</b>`;
    }
    return '';
  }
  function buildStepbar(): void {
    const bar = el('div', 'pick-stepbar');
    const n = el('span', 'pick-step-n');
    n.textContent = done ? '已完成' : `第 ${step}/6 步`;
    bar.appendChild(n);
    if (!done) {
      const who = el('span', 'pick-step-who ' + actor());
      who.textContent =
        onlineOnR && actor() !== mySideR
          ? `轮到对方（玩家${actor()}）`
          : `${actor() === firstPlayer ? '先手' : '后手'}（玩家${actor()}）`;
      bar.appendChild(who);
    }
    const txt = el('span', 'pick-step-txt');
    txt.innerHTML = stepText();
    bar.appendChild(txt);
    const dots = el('span', 'pick-dots');
    for (let k = 1; k <= 6; k++) {
      const d = el('i', '');
      if (k === step) d.classList.add('on');
      dots.appendChild(d);
    }
    bar.appendChild(dots);
    const reroll = button('pick-reroll', '重新随机');
    // 联机：仅**房主**、且**访客已到**、且**尚未开始**（未移除/未选）才能重随；否则置灰不可点。
    // 重随必须**广播** → 两端一致（否则各画各的）。
    const rerollOff =
      onlineOnR &&
      (!online || online.session.state.role !== 'host' || !guestJoinedR() || step !== 1 || removed.some(Boolean));
    reroll.disabled = rerollOff;
    reroll.addEventListener('click', () => {
      if (rerollOff) return;
      drawPool();
      bcastDraft();
      render();
    });
    bar.appendChild(reroll);
    surface.appendChild(bar);
  }

  function artWithImg(id: string): HTMLElement {
    const art = el('div', 'pick-art');
    const inner = el('div', 'pick-art-inner');
    const img = document.createElement('img');
    img.src = cardUrl(id);
    img.alt = '';
    inner.appendChild(img);
    art.appendChild(inner);
    if (isAltArtifact(id)) addAltBadge(inner);
      if (ARTIFACTS[id]?.special) addSpecialBadge(inner);
    return art;
  }
  function confirmSlot(id: string): HTMLElement {
    const s = el('div', 'pick-slot');
    if (ANIM && ANIM.includes(id)) s.classList.add('pop');
    s.appendChild(artWithImg(id));
    s.dataset.cardId = id;
    return s;
  }
  function emptySlot(c: number): HTMLElement {
    const s = el('div', 'pick-slot empty');
    const t = el('span', 'pick-colno');
    t.textContent = COL_LABELS[c];
    s.appendChild(t);
    return s;
  }
  function gridSlot(i: number): HTMLElement {
    const p = pieces[i];
    const s = el('div', 'pick-slot ink');
    if (removed[i]) {
      s.classList.add('removed');
      const art = artWithImg(p.id);
      const tag = el('span', 'pick-removed-tag');
      tag.textContent = '已移除';
      art.appendChild(tag);
      s.appendChild(art);
    } else if (takenIds().includes(p.id)) {
      s.classList.add('taken');
      const art = el('div', 'pick-art');
      art.textContent = '已被选取';
      s.appendChild(art);
    } else {
      const art = artWithImg(p.id);
      s.appendChild(art);
      const inner = art.querySelector('.pick-art-inner') as HTMLElement;
      s.dataset.cardId = p.id;
      // 联机·非当前操作者：**还没被选走的**格子置灰、不可点（右键/长按看技能保留）
      if (onlineOnR && actor() !== mySideR) s.classList.add('pick-slot--wait');
      if (anomaly && ALT_OF[p.baseId]) {
        addAltSwitch(inner, () => {
          p.id = p.id === p.baseId ? (ALT_OF[p.baseId] ?? p.baseId) : p.baseId;
          animIds = null;
          render();
        });
      }
      if (isLegal(i)) {
        s.classList.add('legal');
        s.tabIndex = 0;
        s.setAttribute('role', 'button');
        s.setAttribute('aria-label', '选取');
        s.addEventListener('click', () => { if (!inspector.consumeLp()) onPick(i); });
        s.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!inspector.consumeLp()) onPick(i);
          }
        });
      }
    }
    return s;
  }
  function colHead(who: string, sub: string): HTMLElement {
    const h = el('div', 'pick-chead');
    const w = el('span', 'who');
    w.textContent = who;
    const s = el('span', 'sub');
    s.textContent = sub;
    h.appendChild(w);
    h.appendChild(s);
    return h;
  }
  function confirmCol(side: Side): HTMLElement {
    const acting = phase === 'draft' && !done && actor() === side;
    const col = el('div', 'pick-col confirm ' + side + (acting ? ' acting' : ''));
    col.appendChild(colHead('玩家' + side + ' 神器', '已选 ' + taken[side].filter(Boolean).length + '/3'));
    const cards = el('div', 'pick-cards');
    for (let c = 0; c < 3; c++) cards.appendChild(taken[side][c] ? confirmSlot(taken[side][c] as string) : emptySlot(c));
    col.appendChild(cards);
    return col;
  }
  function buildBoard(): void {
    const locked = onlineOnR && !guestJoinedR();
    const board = el('div', 'pick-board lunxuan' + (locked ? ' pick-board--locked' : ''));
    board.appendChild(confirmCol('A'));
    if (pieces.length < 9) {
      // 联机：访客首帧牌池尚空（房主"访客加入时重随 + 广播"异步到达）→ 占位，且不让 gridSlot 取到 undefined 报错
      const wait = el('div', 'pick-gridwait');
      wait.textContent = '等待房主发牌…';
      board.appendChild(wait);
    } else {
      const wrap = el('div', 'pick-boardwrap');
      for (let c = 0; c < 3; c++) {
        const g = el('div', 'pick-col grid');
        g.appendChild(colHead(COL_LABELS[c], ''));
        const cards = el('div', 'pick-cards');
        for (let r = 0; r < 3; r++) cards.appendChild(gridSlot(c * 3 + r));
        g.appendChild(cards);
        wrap.appendChild(g);
      }
      board.appendChild(wrap);
    }
    board.appendChild(confirmCol('B'));
    surface.appendChild(board);
  }

  function buildPrepBody(): void {
    const panel = el('div', 'pick-prep');
    const card = el('div', 'pick-prep-card');
    const title = el('div', 'pick-prep-title');
    title.textContent = '选择先手';
    card.appendChild(title);
    const note = el('div', 'pick-prep-note');
    note.textContent = '点选先手，随即进入轮选（随机抽 9 件神器）。';
    card.appendChild(note);
    const chips = el('div', 'pick-prep-chips');
    const defs: Array<[string, 'A' | 'B' | 'random']> = [['玩家A', 'A'], ['玩家B', 'B'], ['随机', 'random']];
    for (const [label, val] of defs) {
      const c = el('span', 'pick-tbtn');
      c.dataset.first = val;
      c.textContent = label;
      c.addEventListener('click', () => enterDraft(val));
      chips.appendChild(c);
    }
    card.appendChild(chips);
    panel.appendChild(card);
    surface.appendChild(panel);
  }
  function enterDraft(val: 'A' | 'B' | 'random'): void {
    firstPlayer = val === 'random' ? (Math.random() < 0.5 ? 'A' : 'B') : val;
    drawPool();
    phase = 'draft';
    render();
  }

  function render(): void {
    ANIM = animIds;
    animIds = null;
    surface.innerHTML = '';
    buildTop();
    if (phase === 'prep') buildPrepBody();
    else { buildStepbar(); buildBoard(); }
    surface.appendChild(version);
    ANIM = null;
  }

  render();
}

/**
 * 「单人挑战 · 选择界面」：4 列（挑战者确认 / 挑战者候选 / 名单〔挑·传〕/ 昔日传奇）。
 * `挑`＝选神器（自由选，每列 1 件）；`传`＝把该英雄定为昔日传奇。仅界面，无引擎。
 */
export function renderChallengeSetup(root: HTMLElement, onStart: (opts: SetupOptions) => void): void {
  root.innerHTML = '';
  root.classList.add('setup-page');
  ensureInkFilter();

  const ac = new AbortController();
  const signal = ac.signal;

  let legendIdx = 0;
  let pickHeroIdx = 0;
  let settleMode: 'manual' | 'favor' | 'against' = 'favor'; // 默认「有利」（规则书标准规则）
  let anomaly = false; // 「使用异相神器」开关
  let tacticOn = false; // 「使用战术牌」开关（挑战者；昔日传奇不配战术牌）
  let tacticPick: string | null = null; // 挑战者已选战斗牌 id
  const candAlt = [false, false, false];
  const slots: (string | null)[] = [null, null, null]; // 挑战者，按列

  const surface = el('div', 'pick-surface');
  const version = el('div', 'app-version');
  version.textContent = APP_VERSION_LABEL;
  root.appendChild(surface);

  const modal = el('div', 'pick-modal');
  const modalBox = el('div', 'pick-modal-box');
  modal.appendChild(modalBox);
  root.appendChild(modal);

  const inspector = createCardInspector(root, signal);
  root.appendChild(inspector.modal);

  function colHead(who: string, sub: string): HTMLElement {
    const h = el('div', 'pick-chead');
    const w = el('span', 'who'); w.textContent = who;
    const s = el('span', 'sub'); s.textContent = sub;
    h.appendChild(w); h.appendChild(s);
    return h;
  }
  function cardImg(id: string, inspect = true, altSwitch?: () => void): HTMLElement {
    const s = el('div', 'pick-slot');
    if (inspect) s.dataset.cardId = id;
    const art = el('div', 'pick-art');
    const inner = el('div', 'pick-art-inner');
    const im = document.createElement('img'); im.src = cardUrl(id); im.alt = '';
    inner.appendChild(im); art.appendChild(inner); s.appendChild(art);
    if (isAltArtifact(id)) addAltBadge(inner);
      if (ARTIFACTS[id]?.special) addSpecialBadge(inner);
    // 挑战模式：「规则调整」涉及的神器 → 红底白字「调整」徽标
    if (ADJUSTED_ARTIFACTS.includes(id)) addAdjustBadge(inner, isAltArtifact(id));
    if (altSwitch) addAltSwitch(inner, altSwitch);
    return s;
  }
  function emptySlot(c: number): HTMLElement {
    const s = el('div', 'pick-slot empty');
    const t = el('span', 'pick-colno'); t.textContent = COL_LABELS[c];
    s.appendChild(t);
    return s;
  }
  function legendFile(idx: number): string { return `L${String(idx + 1).padStart(2, '0')}`; }

  function buildTop(): void {
    const top = el('div', 'pick-top');
    const back = button('pick-back', '返回');
    back.addEventListener('click', () => { ac.abort(); renderMenu(root, onStart, 'home'); });
    top.appendChild(back);
    const ttl = el('span', 'pick-ttl'); ttl.textContent = '挑战模式'; top.appendChild(ttl);
    const g2 = el('span', 'pick-grp');
    const l2 = el('span', 'pick-lab'); l2.textContent = '附加模组'; g2.appendChild(l2);
    for (const label of ['使用异相神器', '使用战术牌']) {
      const on = label === '使用异相神器' ? anomaly : tacticOn;
      const w = el('span', 'pick-sw' + (on ? ' on' : ''));
      w.appendChild(el('span', 'pick-dot'));
      const lab = el('span', 'pick-swlab'); lab.textContent = label;
      w.appendChild(lab);
      if (label === '使用异相神器') w.addEventListener('click', () => { anomaly = !anomaly; render(); });
      else w.addEventListener('click', () => { tacticOn = !tacticOn; render(); });
      g2.appendChild(w);
    }
    top.appendChild(g2);
    const start = button('pick-start', '开始挑战');
    start.dataset.act = 'challengeStart';
    start.disabled = !slots.every((s) => s != null);
    start.addEventListener('click', () => {
      const card = CHALLENGES[legendIdx];
      if (!slots.every((s) => s != null) || !card) return;
      ac.abort();
      onStart({
        heroA: slots as [string, string, string],
        heroB: card.artifacts,
        firstPlayer: 'B', // 说明书：永远从「昔日传奇」回合开始
        challengeCardId: card.id,
        settleMode,
        tacticA: tacticPick ?? undefined,
      });
    });
    top.appendChild(start);
    surface.appendChild(top);
  }

  function confirmCol(): HTMLElement {
    const confirmed = slots.every((s) => s != null);
    const col = el('div', 'pick-col A confirm' + (confirmed ? ' confirmed' : ''));
    col.appendChild(colHead('挑战者', '已选 ' + slots.filter(Boolean).length + '/3'));
    const cards = el('div', 'pick-cards');
    for (let c = 0; c < 3; c++) cards.appendChild(slots[c] ? cardImg(slots[c] as string) : emptySlot(c));
    col.appendChild(cards);
    const foot = el('div', 'pick-foot');
    const cancel = button('pick-cbtn', '取消');
    cancel.disabled = slots.every((s) => !s);
    cancel.addEventListener('click', () => { slots[0] = slots[1] = slots[2] = null; render(); });
    foot.appendChild(cancel);
    col.appendChild(foot);
    if (tacticOn) {
      col.appendChild(tacticSection({
        title: '挑战者 战术牌',
        current: tacticPick,
        inspector,
        onPick: (id) => { tacticPick = id; render(); },
        onRandom: (id) => { tacticPick = id; render(); },
        challenge: true, // 「先机」等调整过的战术要打「调整」徽标
      }));
    }
    if (confirmed) {
      const seal = el('div', 'pick-seal');
      seal.textContent = '已确认';
      col.appendChild(seal);
    }
    return col;
  }

  function takenSlot(): HTMLElement {
    const s = el('div', 'pick-slot taken');
    const art = el('div', 'pick-art');
    const lbl = el('span', 'pick-taken'); lbl.textContent = '已被选取';
    art.appendChild(lbl); s.appendChild(art);
    return s;
  }

  function candCol(): HTMLElement {
    const confirmed = slots.every((s) => s != null);
    const col = el('div', 'pick-col A cand' + (confirmed ? ' locked' : ''));
    col.appendChild(colHead('挑战者 候选', HERO_LABELS[HERO_KEYS[pickHeroIdx]]));
    const cards = el('div', 'pick-cards');
    const ids = HEROES[HERO_KEYS[pickHeroIdx]];
    ids.forEach((baseId, i) => {
      const alt = anomaly && candAlt[i] && !!ALT_OF[baseId];
      const id = alt ? ALT_OF[baseId] : baseId;
      if (slots.includes(id)) { cards.appendChild(takenSlot()); return; }
      const s = cardImg(
        id,
        true,
        anomaly && !confirmed && ALT_OF[baseId] ? () => { candAlt[i] = !candAlt[i]; render(); } : undefined,
      );
      s.classList.add('ink');
      if (!confirmed) {
        s.classList.add('clickable');
        s.addEventListener('click', () => { if (inspector.consumeLp()) return; slots[i] = id; render(); });
      }
      cards.appendChild(s);
    });
    col.appendChild(cards);
    return col;
  }

  function namesCol(): HTMLElement {
    const col = el('div', 'pick-col names');
    col.appendChild(colHead('选择神器 · 选择昔日传奇', ''));
    const sc = el('div', 'pick-names');
    HERO_KEYS.forEach((key, i) => {
      const cell = el('div', 'pick-cell');
      const nm = el('div', 'pick-name'); nm.textContent = HERO_LABELS[key]; cell.appendChild(nm);
      const acts = el('div', 'pick-acts');
      const a = button('pick-ab A', '挑'); if (pickHeroIdx === i) a.classList.add('is-cur');
      a.dataset.hero = key; a.dataset.act = 'pick';
      a.addEventListener('click', () => { pickHeroIdx = i; candAlt[0] = candAlt[1] = candAlt[2] = false; render(); });
      const b = button('pick-ab L', '传'); if (legendIdx === i) b.classList.add('is-cur');
      b.dataset.hero = key; b.dataset.act = 'legend';
      b.addEventListener('click', () => { legendIdx = i; render(); });
      acts.appendChild(a); acts.appendChild(b); cell.appendChild(acts);
      sc.appendChild(cell);
    });
    col.appendChild(sc);
    return col;
  }

  function legendCol(): HTMLElement {
    const card = CHALLENGES[legendIdx];
    const col = el('div', 'pick-col L');
    const head = el('div', 'pick-chead');
    const who = el('span', 'who'); who.textContent = '昔日传奇';
    const full = el('span', 'pick-legend-full'); full.textContent = `传说中的“${card.legacy}”`;
    head.appendChild(who); head.appendChild(full);
    const seg = el('span', 'pick-seg');
    const segBtn = (val: 'manual' | 'favor' | 'against', label: string): void => {
      const b = el('span', 'pick-seg-btn' + (settleMode === val ? ' on' : ''));
      b.textContent = label;
      b.dataset.settle = val;
      b.addEventListener('click', () => {
        if (settleMode === val) return; // 必填：点当前项不取消
        settleMode = val;
        render();
      });
      attachSettleTip(b, val); // 悬浮 / 右键（长按）→ 小弹框说明（文案唯一来源 SETTLE_MODE_TEXT）
      seg.appendChild(b);
    };
    segBtn('favor', '结算玩家有利'); // 默认
    segBtn('against', '结算玩家不利');
    segBtn('manual', '结算玩家自选');
    head.appendChild(seg);
    col.appendChild(head);

    const info = el('div', 'pick-legend-info');
    const life = card.life != null ? `生命 ${card.life}` : '生命 待转写';
    const cap = card.defenseCap != null ? `防御骰上限 ${card.defenseCap}` : card.skills ? '防御骰上限 无' : '防御骰上限 待转写';
    const rule = card.defenseRule ?? '防御规则 待转写';
    info.textContent = `${life}　｜　${cap}　｜　${rule}`;
    col.appendChild(info);

    const pt = el('div', 'pick-portrait');
    const im = document.createElement('img');
    im.src = `./legend/${legendFile(legendIdx)}.jpg`;
    im.alt = card.legacy;
    pt.appendChild(im);
    pt.tabIndex = 0;
    const openAt = (x: number | null, y: number | null): void => openChallengeModal(card, x, y);
    pt.addEventListener('contextmenu', (e) => { e.preventDefault(); openAt(e.clientX, e.clientY); });
    pt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAt(null, null); }
    });
    let lp: number | null = null;
    pt.addEventListener('touchstart', (e) => {
      const t = e.touches[0]; if (!t) return;
      lp = window.setTimeout(() => openAt(t.clientX, t.clientY), 500);
    }, { passive: true });
    const cl = (): void => { if (lp != null) { clearTimeout(lp); lp = null; } };
    pt.addEventListener('touchend', cl);
    pt.addEventListener('touchmove', cl);
    pt.addEventListener('touchcancel', cl);
    col.appendChild(pt);

    const arts = el('div', 'pick-legend-arts');
    for (const id of card.artifacts) { const s = cardImg(id, false); s.classList.add('ink', 'compact'); arts.appendChild(s); }
    col.appendChild(arts);
    return col;
  }

  function buildBoard(): void {
    const board = el('div', 'pick-board jiaozhan');
    board.appendChild(confirmCol());
    board.appendChild(candCol());
    board.appendChild(namesCol());
    board.appendChild(legendCol());
    surface.appendChild(board);
  }

  function openChallengeModal(card: ChallengeCard, x: number | null, y: number | null): void {
    modalBox.innerHTML = '';
    const title = el('div', 'pick-chal-title');
    title.textContent = `传说中的“${card.legacy}”`;
    modalBox.appendChild(title);
    const meta = el('div', 'pick-chal-meta');
    const life = card.life != null ? `生命 ${card.life}` : '生命 待转写';
    const cap = card.defenseCap != null ? `防御骰上限 ${card.defenseCap}` : card.skills ? '防御骰上限 无' : '防御骰上限 待转写';
    const rule = card.defenseRule ?? '防御规则 待转写';
    meta.textContent = `${life}　｜　${cap}　｜　${rule}`;
    modalBox.appendChild(meta);
    if (card.skills) {
      card.skills.forEach((sk, i) => {
        const row = el('div', 'pick-sk');
        const t = el('div', 'pick-sk-t');
        t.textContent = `${sk.unordered ? 'x' : i}) ${sk.name}`; // `unordered`（不占顺序步，如死即新生/围攻/威压）序号位显示 `x`
        let phraseText = slotPhrase(sk.slots, sk.perGroup);
        if (sk.marker === '怜悯*') phraseText = phraseText.replace(/）$/, '；怜悯*：第一回合跳过检查）');
        const phrase = el('span', 'pick-chal-phrase');
        phrase.textContent = phraseText;
        t.appendChild(phrase);
        const d = el('div', 'pick-sk-d'); d.textContent = sk.effect;
        row.appendChild(t); row.appendChild(d);
        modalBox.appendChild(row);
      });
    } else {
      const d = el('div', 'pick-sk-d'); d.textContent = '（技能转写待补）';
      modalBox.appendChild(d);
    }
    modal.classList.add('on');
    const vw = window.innerWidth, vh = window.innerHeight;
    modalBox.style.left = '0px';
    modalBox.style.top = '0px';
    const w = modalBox.offsetWidth, h = modalBox.offsetHeight;
    const tiny = vw < 560 || vh < 460 || w > vw - 16 || h > vh - 16 || x == null || y == null;
    if (tiny) {
      modalBox.style.left = Math.max(8, (vw - w) / 2) + 'px';
      modalBox.style.top = Math.max(8, (vh - h) / 2) + 'px';
      modalBox.style.transformOrigin = 'center center';
    } else {
      let l = Math.max(8, Math.min(x + 12, vw - w - 8));
      let t = Math.max(8, Math.min(y + 12, vh - h - 8));
      modalBox.style.left = l + 'px';
      modalBox.style.top = t + 'px';
      modalBox.style.transformOrigin = (x - l) + 'px ' + (y - t) + 'px';
    }
    modalBox.style.animation = 'none';
    void modalBox.offsetWidth;
    modalBox.style.animation = '';
  }
  function closeChallengeModal(): void { modal.classList.remove('on'); }
  modal.addEventListener('click', (e) => { if (e.target === modal) closeChallengeModal(); }, { signal });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeChallengeModal(); }, { signal });

  function render(): void {
    surface.innerHTML = '';
    buildTop();
    buildBoard();
    surface.appendChild(version);
  }

  render();
}
