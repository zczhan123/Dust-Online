import { NetSession, hasSavedRoom, abandonSavedRoom, loadRejoinRecord } from '../net/session';
import { createNet, resolveNetUrl } from '../net/connect';
import type { RoomConfig, RoomInfo } from '../net/protocol';
import { ensureInkFilter, renderHeroSetup, renderBuildSetup, renderRotationSetup, type SetupOptions } from './setupScreen';
import { enterOnlineBattle } from './onlineMode';
import { loadPrefs, savePrefs } from './prefs';
import { APP_BUILD } from '../version';

/**
 * 联机大厅（第 1 批）+ 创建房间窗口（第 2 批）。
 *
 * 视觉与布局**对齐其它模式的选择界面**（`renderPicker` 的顶栏 `.pick-top`：返回 + 笔迹标题），
 * 标题为「联机游戏」。传输由 `createNet()` 决定（见 `net/connect.ts`）：
 * 缺省＝**同机双标签**（`BroadcastChannel`，两个标签/窗口即可互见）；网址带 `?server=ws://…` 时＝**WebSocket 中继**（跨浏览器/跨机）。
 */

const MODE_LABEL: Record<RoomConfig['mode'], string> = {
  draft: '轮选模式',
  preset: '预设模式',
  build: '构筑模式',
};
const FIRST_LABEL: Record<RoomConfig['first'], string> = {
  host: '房主先手',
  guest: '访客先手',
  random: '随机',
};

/** 第 2 批：创建房间窗口的初始配置。 */
const DEFAULT_CONFIG: RoomConfig = {
  mode: 'draft',
  first: 'random',
  alt: false,
  legend: false,
  tactics: false,
  turnSeconds: 30,
  allowSpectators: false,
  note: '',
};

const TIME_OPTIONS = [10, 15, 30, 60, 90, 180, 360];

function el(tag: string, cls = ''): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

/** 房间配置 → 展示用小标签（房间行显示"全部选项"） */
function configChips(c: RoomConfig): string[] {
  const chips = [MODE_LABEL[c.mode], FIRST_LABEL[c.first]];
  if (c.mode === 'preset') {
    if (c.legend) chips.push('传奇英雄');
  } else if (c.alt) {
    chips.push('异相神器');
  }
  if (c.tactics) chips.push('战术牌');
  chips.push(`${c.turnSeconds} 秒`);
  chips.push(c.allowSpectators ? '允许旁观' : '禁止旁观');
  return chips;
}

export function renderLobby(root: HTMLElement, onExit: () => void, onStart: (opts: SetupOptions) => void): void {
  root.innerHTML = '';
  root.classList.add('setup-page');
  ensureInkFilter(); // 顶栏笔迹标题需要全局墨迹滤镜

  // 环境不支持（无 BroadcastChannel，且又没配 WebSocket 中继）→ 明确提示 + 可返回
  if (!resolveNetUrl(window.location.search) && typeof BroadcastChannel === 'undefined') {
    const surface = el('div', 'menu-surface lobby-surface');
    const tip = el('div', 'lobby-status');
    tip.textContent = '当前环境不支持联机（缺少 BroadcastChannel）。请用浏览器打开，或改用 ?server=ws://… 中继方式。';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'lobby-btn lobby-back';
    back.textContent = '返回';
    back.addEventListener('click', onExit);
    surface.append(tip, back);
    root.appendChild(surface);
    return;
  }

  const session = new NetSession(createNet(), loadPrefs().nickName ?? '无名玩家');

  // 断线重连（客户端自足版）：本标签页上次在房里 → **弹"继续 / 放弃"二选一**（不再静默吸回那局）。
  if (hasSavedRoom()) {
    const overlay = el('div', 'online-modal-overlay');
    const modal = el('div', 'online-modal');
    const title = el('div', 'online-modal-title');
    title.textContent = '你有一局未完成的联机对局';
    const text = el('div', 'online-modal-text');
    text.textContent = '可以继续上一局，或放弃它、重新开一局。';
    const foot = el('div', 'online-modal-foot');
    const cont = document.createElement('button');
    cont.type = 'button';
    cont.className = 'online-modal-btn';
    cont.textContent = '继续上一局';
    cont.addEventListener('click', () => {
      overlay.remove();
      let off = (): void => {};
      off = session.subscribe((s) => {
        if (s.game) {
          off();
          enterOnlineBattle(session);
        }
      });
      session.tryReconnect();
    });
    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'online-modal-btn online-modal-btn--ghost';
    drop.textContent = '放弃并新开';
    drop.addEventListener('click', () => {
      abandonSavedRoom();
      overlay.remove();
    });
    foot.append(cont, drop);
    modal.append(title, text, foot);
    overlay.appendChild(modal);
    root.appendChild(overlay);
  }

  // 进入对应模式的选择页（联机）：共享同一个 session；退出房间 → 重开大厅
  const reenterLobby = (): void => renderLobby(root, onExit, onStart);
  const enterSelection = (mode: RoomConfig['mode']): void => {
    const online = { session, onExit: reenterLobby };
    if (mode === 'draft') renderRotationSetup(root, onStart, online);
    else if (mode === 'build') renderBuildSetup(root, onStart, online);
    else renderHeroSetup(root, onStart, online);
  };

  const surface = el('div', 'menu-surface lobby-surface');

  // 顶栏：对齐其它选择界面（返回 + 笔迹标题 + 昵称）
  const top = el('div', 'pick-top lobby-top');
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'pick-back';
  back.textContent = '返回';
  back.addEventListener('click', () => {
    session.close();
    onExit();
  });
  const ttl = el('span', 'pick-ttl');
  ttl.textContent = '联机游戏';
  const nick = el('label', 'lobby-nick');
  nick.appendChild(document.createTextNode('昵称'));
  const nickInput = document.createElement('input');
  nickInput.className = 'lobby-nick-input';
  nickInput.value = session.state.name;
  nickInput.maxLength = 6;
  const applyNick = (): void => {
    const v = nickInput.value.trim() || session.state.name; // 清空 → 保持原名
    nickInput.value = v;
    session.setName(v);
    savePrefs({ ...loadPrefs(), nickName: v }); // 缓存昵称，下次不用重输
  };
  nickInput.addEventListener('blur', applyNick); // 离开输入框即生效
  nickInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      applyNick();
      nickInput.blur();
    }
  });
  nick.appendChild(nickInput);
  top.append(back, ttl, nick);
  surface.appendChild(top);

  // 中间：大长方形房间区
  const wrap = el('div', 'lobby-wrap');
  const box = el('div', 'lobby-box');
  const boxTitle = el('div', 'lobby-box-title');
  boxTitle.textContent = '房间列表';
  const list = el('div', 'lobby-list');
  box.append(boxTitle, list);
  const status = el('div', 'lobby-status');
  wrap.append(box, status);
  surface.appendChild(wrap);

  // 右下：创建房间 / 在线
  const actions = el('div', 'lobby-actions');
  const createBtn = document.createElement('button');
  createBtn.type = 'button';
  const onlineBtn = document.createElement('button');
  onlineBtn.type = 'button';
  onlineBtn.className = 'lobby-btn lobby-online';
  actions.append(createBtn, onlineBtn);
  surface.appendChild(actions);

  const onlinePop = el('div', 'lobby-online-pop');
  onlinePop.hidden = true;
  surface.appendChild(onlinePop);

  root.appendChild(surface);

  const roomRow = (r: RoomInfo, myRoomId: string | null): HTMLElement => {
    const mine = r.id === myRoomId;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'lobby-row' + (mine ? ' lobby-row--mine' : '');
    row.dataset.room = r.id;

    const main = el('div', 'lobby-row-main');
    for (const t of configChips(r.config)) {
      const chip = el('span', 'lobby-chip');
      chip.textContent = t;
      main.appendChild(chip);
    }

    const side = el('div', 'lobby-row-side');
    const seats = el('span', 'lobby-seats');
    seats.textContent = `${r.filled} / ${r.seats}`;
    const host = el('span', 'lobby-host');
    host.textContent = `房主：${r.hostName}`;
    side.append(seats, host);
    const versionMismatch = r.version !== APP_BUILD;
    // **只认本人**：这间房是不是"我上次那局"（本机 key + 最近房间记录）→ 是则给「继续对局 / 继续旁观」
    const resumeRec = loadRejoinRecord();
    const canResume = !myRoomId && !mine && !versionMismatch && resumeRec?.roomId === r.id;
    const resumeLabel = resumeRec?.role === 'spectator' ? '继续旁观' : '继续对局';
    // **旁观**：只有"真开战 + 允许旁观"才给按钮（未开始 / 选战术阶段没有入口）
    const canSpectate =
      !myRoomId && !mine && !versionMismatch && r.inBattle === true && r.config.allowSpectators;
    if (versionMismatch) {
      const s = el('span', 'lobby-state lobby-state--full');
      s.textContent = '版本不同';
      side.appendChild(s);
    } else if (mine) {
      const s = el('span', 'lobby-state lobby-state--mine');
      s.textContent = '你的房间';
      side.appendChild(s);
    } else if (canResume) {
      const s = el('span', 'lobby-state lobby-state--join');
      s.textContent = resumeLabel;
      side.appendChild(s);
    } else if (r.filled >= r.seats) {
      const s = el('span', 'lobby-state lobby-state--full');
      s.textContent = '已满';
      side.appendChild(s);
    } else {
      const s = el('span', 'lobby-state lobby-state--join');
      s.textContent = '可加入';
      side.appendChild(s);
    }
    row.append(main, side);
    // 「旁观」按钮（房间行右侧、状态药丸旁）：进入战斗界面只读观看
    if (canSpectate) {
      const sp = document.createElement('button');
      sp.type = 'button';
      sp.className = 'lobby-spectate';
      sp.textContent = '旁观';
      sp.addEventListener('click', (e) => {
        e.stopPropagation();
        let off = (): void => {};
        off = session.subscribe((s) => {
          if (s.game) {
            off();
            enterOnlineBattle(session);
          }
        });
        session.joinRoom(r.id, 'spectator');
      });
      side.appendChild(sp);
    }

    if (r.config.note) {
      const n = el('div', 'lobby-row-note');
      n.textContent = `备注：${r.config.note}`;
      row.appendChild(n);
    }

    const joinable = !myRoomId && !mine && !versionMismatch && (canResume || r.filled < r.seats);
    row.addEventListener('click', () => {
      if (!joinable) return;
      if (canResume) {
        // 续局：带本机身份 key 向对端要快照；拿到对局后直接进战斗（不进选择页）
        let off = (): void => {};
        off = session.subscribe((s) => {
          if (s.game) {
            off();
            enterOnlineBattle(session);
          }
        });
        session.rejoinRoom(r.id);
        return;
      }
      session.joinRoom(r.id);
      enterSelection(r.config.mode);
    });
    return row;
  };

  const sync = (): void => {
    const s = session.state;

    list.innerHTML = '';
    if (s.rooms.length === 0) {
      const empty = el('div', 'lobby-empty');
      empty.textContent = '还没有人开房。点右下「创建房间」；另一个标签页就能看到它。';
      list.appendChild(empty);
    } else {
      for (const r of s.rooms) list.appendChild(roomRow(r, s.roomId));
    }

    createBtn.className = `lobby-btn ${s.roomId ? 'lobby-leave' : 'lobby-create'}`;
    createBtn.textContent = s.roomId ? (s.role === 'host' ? '关闭房间' : '退出房间') : '创建房间';

    onlineBtn.textContent = '在线 ';
    const c = el('span', 'lobby-online-count');
    c.textContent = String(s.online.length);
    onlineBtn.appendChild(c);
    onlinePop.innerHTML = '';
    for (const p of s.online) {
      const li = el('div', 'lobby-online-row');
      li.textContent = p.id === s.peerId ? `${p.name}（你）` : p.name;
      onlinePop.appendChild(li);
    }

    if (s.notice) {
      status.textContent = s.notice;
    } else if (s.roomId && s.role === 'host') {
      status.textContent = '已创建房间，等待访客加入…（进入选择界面＝第 3 批）';
    } else if (s.roomId && s.role === 'guest') {
      status.textContent = '已加入房间，等待房主开始…（进入选择界面＝第 3 批）';
    } else {
      status.textContent = `当前 ${s.online.length} 人在线。同机双标签：开另一个标签页即可互相看到房间。`;
    }
  };

  createBtn.addEventListener('click', () => {
    if (session.state.roomId) session.leaveRoom();
    else openCreateModal(surface, session, (mode) => enterSelection(mode));
  });
  onlineBtn.addEventListener('click', () => {
    onlinePop.hidden = !onlinePop.hidden;
  });

  session.subscribe(sync);
  sync();
}

// ────────── 创建房间窗口（第 2 批）──────────

function pill(label: string, on: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `pill${on ? ' on' : ''}`;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function rowEl(label: string, opts: HTMLElement[]): HTMLElement {
  const row = el('div', 'room-row');
  const lab = el('span', 'room-lab');
  lab.textContent = label;
  const box = el('div', 'room-opts');
  for (const o of opts) box.appendChild(o);
  row.append(lab, box);
  return row;
}

/** 创建房间窗口：单弹窗、选项都行内药丸（未选＝深底浅字 / 选中＝绿底白字）、底部「创建/取消」。 */
function openCreateModal(surface: HTMLElement, session: NetSession, onCreated: (mode: RoomConfig['mode']) => void): void {
  const cfg: RoomConfig = { ...DEFAULT_CONFIG };
  const mask = el('div', 'lobby-modal-mask');
  const modal = el('div', 'lobby-modal');
  mask.appendChild(modal);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) mask.remove();
  });

  const render = (): void => {
    modal.innerHTML = '';
    const title = el('div', 'lobby-modal-title');
    title.textContent = '创建房间';
    modal.appendChild(title);

    const rows = el('div', 'room-rows');

    rows.appendChild(
      rowEl('模式', [
        pill('轮选', cfg.mode === 'draft', () => (cfg.mode = 'draft', render())),
        pill('预设', cfg.mode === 'preset', () => (cfg.mode = 'preset', render())),
        pill('构筑', cfg.mode === 'build', () => (cfg.mode = 'build', render())),
      ]),
    );

    rows.appendChild(
      rowEl('先手', [
        pill('房主先手', cfg.first === 'host', () => (cfg.first = 'host', render())),
        pill('访客先手', cfg.first === 'guest', () => (cfg.first = 'guest', render())),
        pill('随机', cfg.first === 'random', () => (cfg.first = 'random', render())),
      ]),
    );

    // 附加：随模式变（预设＝传奇英雄；轮选/构筑＝异相神器）＋ 战术牌
    const altKey: 'alt' | 'legend' = cfg.mode === 'preset' ? 'legend' : 'alt';
    const altLabel = cfg.mode === 'preset' ? '传奇英雄' : '异相神器';
    rows.appendChild(
      rowEl('附加', [
        pill(altLabel, cfg[altKey], () => (cfg[altKey] = !cfg[altKey], render())),
        pill('战术牌', cfg.tactics, () => (cfg.tactics = !cfg.tactics, render())),
      ]),
    );

    rows.appendChild(
      rowEl(
        '行动时间',
        TIME_OPTIONS.map((n) => pill(`${n} 秒`, cfg.turnSeconds === n, () => (cfg.turnSeconds = n, render()))),
      ),
    );

    rows.appendChild(
      rowEl('旁观', [pill('允许旁观', cfg.allowSpectators, () => (cfg.allowSpectators = !cfg.allowSpectators, render()))]),
    );

    const noteRow = el('div', 'room-row');
    const noteLab = el('span', 'room-lab');
    noteLab.textContent = '备注';
    const note = document.createElement('input');
    note.className = 'room-note';
    note.value = cfg.note;
    note.maxLength = 24;
    note.placeholder = '（可选）';
    note.addEventListener('input', () => (cfg.note = note.value));
    noteRow.append(noteLab, note);
    rows.appendChild(noteRow);

    modal.appendChild(rows);

    const foot = el('div', 'room-foot');
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'lobby-btn lobby-create';
    ok.textContent = '创建';
    ok.addEventListener('click', () => {
      cfg.note = note.value.trim();
      session.createRoom(cfg);
      mask.remove();
      onCreated(cfg.mode); // 建房后直接进对应模式的选择页
    });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'lobby-btn lobby-back';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => mask.remove());
    foot.append(ok, cancel); // 确认 → 取消（全站一致）
    modal.appendChild(foot);
  };

  render();
  surface.appendChild(mask);
}
