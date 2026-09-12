import type { Artifact, DiceKind, GameState, PlayerState } from '../core/model/types';

const AREA_LABEL: Record<DiceKind, string> = {
  attack: '攻击骰区',
  defense: '防御骰区',
  meditation: '冥想骰区',
};

function artifactCard(a: Artifact): HTMLElement {
  const el = document.createElement('div');
  el.className = 'card';
  const stats: string[] = [`第${a.column}列`];
  if (a.speed !== undefined) stats.push(`速度 ${a.speed}`);
  if (a.will !== undefined) stats.push(`意志 ${a.will}`);
  if (a.life !== undefined) stats.push(`生命 ${a.life}`);
  if (a.chargeReq !== undefined) stats.push(`充能 ${a.chargeReq}`);
  if (a.distribution) {
    stats.push(`分布 防${a.distribution.defense.join('/')} 攻${a.distribution.attack.join('/')} 冥${a.distribution.meditation.join('/')}`);
  }
  if (a.activeMarkerSide) stats.push(`已激活(${a.activeMarkerSide})`);
  el.innerHTML = `<div class="card-name">${a.name}</div><div class="card-stats">${stats.join('　')}</div>`;
  return el;
}

function areaBox(kind: DiceKind, player: PlayerState): HTMLElement {
  const el = document.createElement('div');
  el.className = 'area';
  const dice = player.areas[kind]
    .map((d) => `<span class="die" data-value="${d.value}">${d.value}</span>`)
    .join('');
  el.innerHTML = `<div class="area-label">${AREA_LABEL[kind]}</div><div class="dice">${dice}</div>`;
  return el;
}

function playerPanel(player: PlayerState): HTMLElement {
  const el = document.createElement('div');
  el.className = 'player';
  el.dataset.player = player.id;
  const header = document.createElement('div');
  header.className = 'player-header';
  header.textContent = `${player.id}　生命 ${player.life}/${player.lifeMax}`;
  el.appendChild(header);

  const cards = document.createElement('div');
  cards.className = 'cards';
  for (const a of player.artifacts) cards.appendChild(artifactCard(a));
  el.appendChild(cards);

  const areas = document.createElement('div');
  areas.className = 'areas';
  (['attack', 'defense', 'meditation'] as DiceKind[]).forEach((k) => areas.appendChild(areaBox(k, player)));
  el.appendChild(areas);
  return el;
}

export function renderGame(state: GameState, root: HTMLElement): void {
  root.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'board';
  wrap.appendChild(playerPanel(state.players.A));
  wrap.appendChild(playerPanel(state.players.B));
  root.appendChild(wrap);
}
