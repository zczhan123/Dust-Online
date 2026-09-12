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

  const art = el('div', 'card-art');
  art.textContent = '（卡图占位）';
  card.appendChild(art);

  const name = el('div', 'card-name');
  name.textContent = a.name;
  card.appendChild(name);

  const stats = el('div', 'card-stats');
  const parts: string[] = [`第${a.column}列`];
  if (a.speed !== undefined) parts.push(`速度 ${a.speed}`);
  if (a.will !== undefined) parts.push(`意志 ${a.will}`);
  if (a.life !== undefined) parts.push(`生命 ${a.life}`);
  if (a.chargeReq !== undefined) parts.push(`充能需求 ${a.chargeReq}`);
  if (a.distribution) {
    parts.push(
      `分布 防${a.distribution.defense.join('/')} 攻${a.distribution.attack.join('/')} 冥${a.distribution.meditation.join('/')}`,
    );
  }
  stats.textContent = parts.join('　');
  card.appendChild(stats);

  const badges = el('div', 'card-badges');
  if (a.activeMarkerSide) {
    const act = el('span', 'badge badge-active');
    act.textContent = `已激活 · ${a.activeMarkerSide === 'left' ? '左' : '右'}侧`;
    badges.appendChild(act);
  }
  if (a.chargeReq !== undefined) {
    const charge = el('span', 'badge badge-charge');
    charge.textContent = `充能 ${a.chargeLayer}/${a.chargeReq}`;
    badges.appendChild(charge);
  }
  if (a.count > 0) {
    const count = el('span', 'badge badge-count');
    count.textContent = `计数 ${a.count}`;
    badges.appendChild(count);
  }
  if (badges.childElementCount > 0) card.appendChild(badges);

  const text = ARTIFACT_TEXT[a.id];
  if (text) {
    const skills = el('div', 'skills');
    for (const s of text.skills) {
      const box = el('div', `skill skill--${s.side}`);
      const head = el('div', 'skill-head');
      const badge = el('span', 'skill-type');
      badge.textContent = s.type;
      const sname = el('span', 'skill-name');
      sname.textContent = s.name;
      head.appendChild(badge);
      head.appendChild(sname);
      box.appendChild(head);
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
  header.textContent = `${role === 'enemy' ? '敌人' : '自己'}（${player.id}）　生命 ${player.life}/${player.lifeMax}`;
  panel.appendChild(header);

  const cards = el('div', 'cards');
  for (const a of player.artifacts) cards.appendChild(artifactCard(a));
  panel.appendChild(cards);

  const areas = el('div', 'areas');
  const order = mirrored ? AREA_ORDER_MIRRORED : AREA_ORDER;
  for (const k of order) areas.appendChild(areaBox(k, player));
  panel.appendChild(areas);

  return panel;
}

function centerBar(state: GameState): HTMLElement {
  const center = el('div', 'center');

  const dustfall = el('div', 'dustfall');
  dustfall.textContent = `尘落　${state.dustfall} / 10`;
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
