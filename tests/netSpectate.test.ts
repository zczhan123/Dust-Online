import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NetSession } from '../src/net/session';
import { createGame, applyAction } from '../src/core/engine/game';
import { APP_BUILD } from '../src/version';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import { DEFAULT_PREFS, clonePrefs } from '../src/ui/prefs';
import type { NetMessage, RoomConfig } from '../src/net/protocol';
import type { Net } from '../src/net/transport';

function mkStub(peerId = 'p-host'): { net: Net; sent: NetMessage[]; emit: (m: NetMessage) => void } {
  const sent: NetMessage[] = [];
  const cbs: Array<(m: NetMessage) => void> = [];
  const net: Net = {
    peerId,
    send: (m) => void sent.push(m),
    onMessage: (cb) => {
      cbs.push(cb);
      return () => {};
    },
    close: () => {},
  };
  return { net, sent, emit: (m) => cbs.forEach((cb) => cb(m)) };
}

const cfg = (allowSpectators = true): RoomConfig => ({
  mode: 'draft',
  first: 'host',
  alt: false,
  legend: false,
  tactics: false,
  turnSeconds: 30,
  allowSpectators,
  note: '',
});

const game = (phase?: string) => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
  if (phase) (g as { phase: string }).phase = phase;
  return g;
};

/** 房主 + 访客已入房；可选是否已开战（phase）。 */
function hostRoom(opts: { allowSpectators?: boolean; phase?: string; withGuest?: boolean } = {}) {
  const { net, sent } = mkStub();
  const h = new NetSession(net, '房主');
  const roomId = h.createRoom(cfg(opts.allowSpectators ?? true));
  if (opts.withGuest !== false) {
    h['recv']({ t: 'room:join', from: 'p-g1', roomId, name: '乙', role: 'guest', version: APP_BUILD, key: 'k-g1' });
  }
  if (opts.phase) h.state.game = game(opts.phase);
  return { h, sent, roomId };
}

const spectatorJoin = (roomId: string, from = 'p-s1'): NetMessage => ({
  t: 'room:join',
  from,
  roomId,
  name: '看客',
  role: 'spectator',
  version: APP_BUILD,
  key: 'k-s1',
});

describe('联机 · 旁观', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('房主关闭旁观 → 拒绝（reason=spectate）', () => {
    const { h, sent, roomId } = hostRoom({ allowSpectators: false, phase: 'main' });
    sent.length = 0;
    h['recv'](spectatorJoin(roomId));
    expect(sent.find((m) => m.t === 'room:denied')).toMatchObject({ reason: 'spectate' });
    h.close();
  });

  it('未开局 / 还在选战术牌 → 拒绝', () => {
    const a = hostRoom({ phase: undefined });
    a.sent.length = 0;
    a.h['recv'](spectatorJoin(a.roomId));
    expect(a.sent.find((m) => m.t === 'room:denied')).toMatchObject({ reason: 'spectate' });
    a.h.close();

    const b = hostRoom({ phase: 'tactics' });
    b.sent.length = 0;
    b.h['recv'](spectatorJoin(b.roomId));
    expect(b.sent.find((m) => m.t === 'room:denied')).toMatchObject({ reason: 'spectate' });
    b.h.close();
  });

  it('允许 + 对局中 → 接受：不占座、发快照、发一条系统聊天（本地也有）', () => {
    const { h, sent, roomId } = hostRoom({ phase: 'main' });
    expect(h.state.rooms.find((r) => r.id === roomId)?.filled).toBe(2);
    sent.length = 0;
    h['recv'](spectatorJoin(roomId));
    expect(sent.some((m) => m.t === 'room:denied')).toBe(false);
    expect(h.state.members.some((m) => m.role === 'spectator' && m.id === 'p-s1')).toBe(true);
    expect(h.state.rooms.find((r) => r.id === roomId)?.filled).toBe(2); // 观众不占座
    const snap = sent.find((m) => m.t === 'snapshot');
    expect(snap).toBeTruthy();
    const chat = sent.find((m) => m.t === 'chat');
    expect(chat).toMatchObject({ sys: true, name: '看客', text: '进来旁观' });
    // 房主本地也要有这条系统行
    expect(h.state.chat.some((c) => c.sys === true && c.name === '看客')).toBe(true);
    h.close();
  });

  it('旁观者不能操作、不能发言（session 层双保险）', () => {
    const { net, sent } = mkStub('p-spec');
    const sp = new NetSession(net, '看客');
    sp.state.roomId = 'room-x';
    sp.state.role = 'spectator';
    sp.state.game = game('main');
    sent.length = 0;
    sp.dispatch({ t: 'advance' });
    sp.chat('你好');
    expect(sent).toEqual([]);
    sp.close();
  });

  it('旁观者 rejoin → 放行并回发快照（不需要身份 key）', () => {
    const { h, sent, roomId } = hostRoom({ phase: 'main' });
    h['recv'](spectatorJoin(roomId));
    sent.length = 0;
    h['recv']({ t: 'rejoin', from: 'p-s9', roomId, name: '看客', role: 'spectator', key: 'whatever' });
    expect(sent.some((m) => m.t === 'snapshot')).toBe(true);
    h.close();
  });

  it('房主：离开"选战术/初始设置"阶段后 → 公告 inBattle（大厅才给「旁观」）', () => {
    const { h, sent, roomId } = hostRoom({ withGuest: false });
    expect(h.state.rooms.find((r) => r.id === roomId)?.inBattle).toBeUndefined();
    h.state.game = game('initialReroll');
    sent.length = 0;
    h.dispatch({ t: 'advance' });
    const announce = sent.find((m) => m.t === 'room:announce');
    expect(announce && (announce as { room: { inBattle?: boolean } }).room.inBattle).toBe(true);
    h.close();
  });

  it('**观众离开不得影响 A/B**：不置 peerLeft、不清 guestName、对局仍在', () => {
    const { h, roomId, sent } = hostRoom({ phase: 'main' });
    h['recv'](spectatorJoin(roomId));
    const before = h.state.game;
    sent.length = 0;
    h['recv']({ t: 'room:leave', from: 'p-s1', roomId });
    expect(h.state.peerLeft).toBe(false); // 关键：不是"对方已退出"
    expect(h.state.rooms.find((r) => r.id === roomId)?.guestName).toBe('乙'); // 访客名字保留
    expect(h.state.rooms.find((r) => r.id === roomId)?.filled).toBe(2);
    expect(h.state.members.some((m) => m.role === 'spectator')).toBe(false);
    expect(h.state.game).toBe(before); // 对局对象原样
    h.close();
  });

  it('**访客离开**仍然正确（回归）：peerLeft=true、guestName 清空', () => {
    const { h, roomId } = hostRoom({ phase: 'main' });
    h['recv']({ t: 'room:leave', from: 'p-g1', roomId });
    expect(h.state.peerLeft).toBe(true);
    expect(h.state.rooms.find((r) => r.id === roomId)?.guestName ?? null).toBeNull();
    h.close();
  });

  it('心跳只认**对手**：观众一直 ping 也不能掩盖访客掉线；访客 ping 则在线', () => {
    vi.useFakeTimers();
    try {
      const { h, roomId } = hostRoom({ phase: 'main' });
      h['recv'](spectatorJoin(roomId));
      // 13 秒内只有"观众"发 ping（访客一声不吭）→ 应判定为**访客掉线**
      for (let i = 0; i < 14; i++) {
        h['recv']({ t: 'ping', from: 'p-s1', roomId });
        vi.advanceTimersByTime(1000);
      }
      expect(h.state.peerOnline).toBe(false);
      // 访客发一条 → 恢复在线
      h['recv']({ t: 'ping', from: 'p-g1', roomId });
      vi.advanceTimersByTime(1000);
      expect(h.state.peerOnline).toBe(true);
      h.close();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('旁观 · 战斗界面只读', () => {
  function mountSpectator(): { root: HTMLElement } {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
    applyAction(g, { t: 'advance' }); // 推进到可操作阶段也无妨：旁观仍应只读
    const ui: UiState = {
      rerollSelected: new Set(),
      selection: null,
      pendingConfirm: null,
      convertPick: null,
      fengmangPick: null,
      hanguangPick: null,
      quanzhi: null,
      dustFlow: null,
      prefs: clonePrefs(DEFAULT_PREFS),
      settingsOpen: false,
      logOpen: false,
      logPop: false,
      detail: null,
      error: null,
    };
    const hooks: RenderHooks = {
      ui,
      onAction: vi.fn(),
      propose: () => {},
      requestRender: () => {},
      onRestart: () => {},
      online: { myPlayer: null, spectator: true, names: { A: '甲', B: '乙' }, onLeaveLobby: () => {} },
    };
    renderGame(g, root, hooks);
    return { root };
  }

  it('显示「旁观中」；没有任何可点操作；玩家面板可点（切视角）', () => {
    const { root } = mountSpectator();
    expect(root.textContent).toContain('旁观中');
    expect(root.querySelectorAll('.actionlist .btn').length).toBe(0);
    expect(root.querySelectorAll('[data-act="skill"]').length).toBe(0);
    expect(root.querySelectorAll('.player--spectate').length).toBe(2);
  });
});
