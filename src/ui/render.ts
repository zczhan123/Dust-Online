import type { Artifact, DiceKind, GameState, PlayerId, PlayerState } from '../core/model/types';
import { ARTIFACT_TEXT } from '../core/content/artifactText';

const AREA_LABEL: Record<DiceKind, string> = {
  attack: '攻击骰区',
  defense: '防御骰区',
  meditation: '冥想骰区',
};

const AREA_ORDER: DiceKind[] = ['attack', 'defense', 'meditation'];
// 敌方区域镜像：攻击骰区与冥想骰区对调
const AREA_ORDER_MIRRORED: DiceKind[] = ['meditation', 'defense', 'attack'];

export interface RenderOptions {
  /** 视角玩家（显示在下方）。默认取当前回合玩家。 */
  selfId?: PlayerId;
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

function artifactCard(a: Artifact): HTMLElement {
  const card = el('div', 'card');
  card.dataset.artifact = a.id;

  const head = el('div', 'card-head');
  const name = el('span', 'card-name');
  name.textContent = a.name;
  head.appendChild(name);

  const subs: string[] = [`第${a.column}列`];
  if (a.speed !== undefined) subs.push(`速度 ${a.speed}`);
  if (a.will !== undefined) subs.push(`意志 ${a.will}`);
  if (a.life !== undefined) subs.push(`生命 ${a.life}`);
  if (a.chargeReq !== undefined) subs.push(`充能需求 ${a.chargeReq}`);
  if (a.distribution) {
    subs.push(`分布 防${a.distribution.defense.join('/')} 攻${a.distribution.attack.join('/')} 冥${a.distribution.meditation.join('/')}`);
  }
  const sub = el('span', 'card-sub');
  sub.textContent = subs.join('　');
  head.appendChild(sub);

  if (a.activeMarkerSide) {
    const act = el('span', 'badge badge-active');
    act.textContent = `已激活·${a.activeMarkerSide === 'left' ? '左' : '右'}侧`;
    head.appendChild(act);
  }
  if (a.chargeReq !== undefined) {
    const charge = el('span', 'badge badge-charge');
    charge.textContent = `充能 ${a.chargeLayer}/${a.chargeReq}`;
    head.appendChild(charge);
  }
  if (a.count > 0) {
    const count = el('span', 'badge badge-count');
    count.textContent = `计数 ${a.count}`;
    head.appendChild(count);
  }
  card.appendChild(head);

  const art = el('div', 'card-art');
  art.textContent = '（卡图占位）';
  card.appendChild(art);

  const text = ARTIFACT_TEXT[a.id];
  if (text) {
    const skills = el('div', 'skills');
    for (const s of text.skills) {
      const isActive = a.activeMarkerSide != null && (s.side === a.activeMarkerSide || s.side === 'only');
      const box = el('div', `skill ${isActive ? 'skill--on' : 'skill--off'}`);
      const sHead = el('div', 'skill-head');
      const badge = el('span', 'skill-type');
      badge.textContent = s.type;
      const sname = el('span', 'skill-name');
      sname.textContent = s.name;
      sHead.appendChild(badge);
      sHead.appendChild(sname);
      box.appendChild(sHead);
      const body = el('div', 'skill-text');
      body.textContent = s.text;
      box.appendChild(body);
      skills.appendChild(box);
    }
    card.appendChild(skills);
  }

  return card;
}

function areaBox(kind: DiceKind, player: PlayerState): HTMLElement {
  const box = el('div', 'area');
  box.dataset.kind = kind;

  const label = el('div', 'area-label');
  label.textContent = `${AREA_LABEL[kind]}（${player.areas[kind].length}）`;
  box.appendChild(label);

  const dice = el('div', 'dice');
  for (const d of player.areas[kind]) {
    const die = el('span', 'die');
    die.dataset.value = String(d.value);
    die.textContent = String(d.value);
    dice.appendChild(die);
  }
  box.appendChild(dice);

  return box;
}

function playerPanel(player: PlayerState, role: 'enemy' | 'self', mirrored: boolean): HTMLElement {
  const panel = el('div', `player player--${role}`);
  panel.dataset.player = player.id;

  const header = el('div', 'player-header');
  const title = el('span', 'player-title');
  title.textContent = `${role === 'enemy' ? '敌人' : '自己'}（${player.id}）`;
  header.appendChild(title);
  const life = el('span', 'player-life');
  life.textContent = `生命 ${player.life}/${player.lifeMax}`;
  header.appendChild(life);
  if (player.hasDustSeal) {
    const seal = el('span', 'badge badge-seal');
    seal.textContent = '尘印标记';
    header.appendChild(seal);
  }

  const cards = el('div', 'cards');
  for (const a of player.artifacts) cards.appendChild(artifactCard(a));

  const areas = el('div', 'areas');
  const order = mirrored ? AREA_ORDER_MIRRORED : AREA_ORDER;
  for (const k of order) areas.appendChild(areaBox(k, player));

  // 骰子区域贴近中央战场：敌人放在最下、自己放在最上（骰区在生命值之上）
  const seq: HTMLElement[] = role === 'enemy' ? [header, cards, areas] : [areas, cards, header];
  for (const node of seq) panel.appendChild(node);

  return panel;
}

function centerBar(state: GameState): HTMLElement {
  const center = el('div', 'center');

  const dustfall = el('div', 'dustfall');
  dustfall.textContent = `尘落 ${state.dustfall} / 10`;
  center.appendChild(dustfall);

  const rollzone = el('div', 'rollzone');
  rollzone.textContent = '投掷区 / 供应堆';
  center.appendChild(rollzone);

  return center;
}

export function renderGame(state: GameState, root: HTMLElement, options: RenderOptions = {}): void {
  const selfId: PlayerId = options.selfId ?? state.activePlayer;
  const enemyId: PlayerId = selfId === 'A' ? 'B' : 'A';

  root.innerHTML = '';
  const board = el('div', 'board');
  board.appendChild(playerPanel(state.players[enemyId], 'enemy', true));
  board.appendChild(centerBar(state));
  board.appendChild(playerPanel(state.players[selfId], 'self', false));
  root.appendChild(board);
}
