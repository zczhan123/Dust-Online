import { describe, it, expect, beforeEach } from 'vitest';
import { NetSession } from '../src/net/session';
import { createGame } from '../src/core/engine/game';
import type { NetMessage, RoomConfig } from '../src/net/protocol';
import type { Net } from '../src/net/transport';

function mkStub(peerId: string): { net: Net; sent: NetMessage[]; emit: (m: NetMessage) => void } {
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

const game = () => createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });

/** 一个"已在房内、有对局"的会话（默认来客）。 */
function inRoom(peerId = 'p-g', role: 'guest' | 'host' = 'guest') {
  const { net, sent } = mkStub(peerId);
  const s = new NetSession(net, '乙');
  s.state.roomId = 'room-a';
  s.state.role = role;
  s.state.myPlayer = role === 'guest' ? 'B' : 'A';
  s.state.game = game();
  return { s, sent };
}

describe('联机 · room:denied 必须按 target 认领（房间级广播）', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('发给**别人**的拒绝（如旁观被拒）→ 来客完全不受影响、不发 room:leave', () => {
    const { s, sent } = inRoom();
    const g = s.state.game;
    sent.length = 0;
    s['recv']({ t: 'room:denied', from: 'p-host', roomId: 'room-a', reason: 'spectate', target: 'p-spec' });
    expect(s.state.roomId).toBe('room-a');
    expect(s.state.game).toBe(g);
    expect(s.state.peerLeft).toBe(false);
    expect(sent.filter((m) => m.t === 'room:leave')).toEqual([]);
    s.close();
  });

  it('发给**别人**的版本拒绝 → 同样不受影响', () => {
    const { s, sent } = inRoom();
    sent.length = 0;
    s['recv']({ t: 'room:denied', from: 'p-host', roomId: 'room-a', reason: 'version', target: 'p-stale' });
    expect(s.state.roomId).toBe('room-a');
    expect(s.state.game).not.toBeNull();
    expect(sent.filter((m) => m.t === 'room:leave')).toEqual([]);
    s.close();
  });

  it('发给**我**的拒绝 → 照旧：离开 + 重置 + 提示', () => {
    const { s, sent } = inRoom();
    sent.length = 0;
    s['recv']({ t: 'room:denied', from: 'p-host', roomId: 'room-a', reason: 'banned', target: 'p-g' });
    expect(s.state.roomId).toBeNull();
    expect(s.state.notice).toContain('拉黑');
    expect(sent.some((m) => m.t === 'room:leave')).toBe(true);
    s.close();
  });
});

describe('房主刷新后：用快照重建 myRoom（否则不再应答 join / 不再公告）', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('收到 snapshot（role=host、无 myRoom）→ 重建房间并重新公告', () => {
    const { net, sent } = mkStub('p-host');
    const h = new NetSession(net, '房主');
    h.state.roomId = 'room-a';
    h.state.role = 'host';
    h.state.myPlayer = 'A';
    // 刷新后的新会话：没有 myRoom（也没对局）
    sent.length = 0;
    h['recv']({
      t: 'snapshot',
      from: 'p-guest',
      roomId: 'room-a',
      game: game(),
      members: [
        { id: 'p-host', name: '房主', role: 'host' },
        { id: 'p-guest', name: '乙', role: 'guest' },
      ],
      config: cfg,
      hostKey: 'k-host',
    });
    const room = h.state.rooms.find((r) => r.id === 'room-a');
    expect(room).toMatchObject({ id: 'room-a', guestName: '乙', filled: 2, inBattle: true });
    expect(sent.some((m) => m.t === 'room:announce')).toBe(true);
    h.close();
  });
});
