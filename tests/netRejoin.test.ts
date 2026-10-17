import { describe, it, expect } from 'vitest';
import { NetSession } from '../src/net/session';
import { createGame } from '../src/core/engine/game';
import { APP_BUILD } from '../src/version';
import type { NetMessage, RoomConfig } from '../src/net/protocol';
import type { Net } from '../src/net/transport';

/** 极简 Net 桩：记录发出的消息；测试可手动"收到"消息。 */
function mkStub(): {
  net: Net;
  sent: NetMessage[];
  emit: (m: NetMessage) => void;
} {
  const sent: NetMessage[] = [];
  const cbs: Array<(m: NetMessage) => void> = [];
  const net: Net = {
    peerId: 'p-host',
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

describe('刷新 ≠ 退出（2026-10-15 修）', () => {
  it('beforeunload 不再发 room:leave（掉线交给心跳判定）', () => {
    const { net, sent } = mkStub();
    const sess = new NetSession(net, '甲');
    sess.state.roomId = 'room-x'; // 若还是老逻辑，卸载时会发 room:leave
    window.dispatchEvent(new Event('beforeunload'));
    expect(sent.filter((m) => m.t === 'room:leave')).toEqual([]);
    sess.close();
  });

  it('房主收到 rejoin（此前被判"已退出"）→ 清掉 peerLeft 并发快照', () => {
    const { net, sent } = mkStub();
    const sess = new NetSession(net, '房主');
    const roomId = sess.createRoom(cfg);
    sess.state.game = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
    sess.state.peerLeft = true; // 之前被判"对方已退出"
    sess.state.peerOnline = false;

    sent.length = 0;
    sess['recv']({ t: 'rejoin', from: 'p-guest2', roomId, name: '乙', role: 'guest' });
    expect(sess.state.peerLeft).toBe(false);
    expect(sess.state.peerOnline).toBe(true);
    expect(sent.some((m) => m.t === 'snapshot')).toBe(true);
    sess.close();
  });

  it('对局中"加入房间"也发快照（按 role 替换成员，不会重复加人）', () => {
    const { net, sent } = mkStub();
    const sess = new NetSession(net, '房主');
    const roomId = sess.createRoom(cfg);
    sess.state.game = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
    // 旧访客还挂在名单里（刷新后 peerId 会变）
    sess.state.members = [
      { id: 'p-host', name: '房主', role: 'host' },
      { id: 'p-guest-old', name: '乙', role: 'guest' },
    ];

    sent.length = 0;
    sess['recv']({ t: 'room:join', from: 'p-guest-new', roomId, name: '乙', role: 'guest', version: APP_BUILD });
    const guests = sess.state.members.filter((m) => m.role === 'guest');
    expect(guests).toHaveLength(1);
    expect(guests[0].id).toBe('p-guest-new');
    expect(sent.some((m) => m.t === 'snapshot')).toBe(true);
    sess.close();
  });

  it('主动 leaveRoom() 仍然通知对端（房主发 room:gone / 访客发 room:leave）', () => {
    // 房主
    const host = mkStub();
    const h = new NetSession(host.net, '房主');
    h.createRoom(cfg);
    host.sent.length = 0;
    h.leaveRoom();
    expect(host.sent.some((m) => m.t === 'room:gone')).toBe(true);
    h.close();

    // 访客
    const guest = mkStub();
    const g = new NetSession(guest.net, '访客');
    g.state.rooms = [
      { id: 'room-a', hostId: 'h', hostName: '房主', guestName: null, config: cfg, seats: 2, filled: 1, version: APP_BUILD },
    ];
    g.joinRoom('room-a', 'guest');
    guest.sent.length = 0;
    g.leaveRoom();
    expect(guest.sent.some((m) => m.t === 'room:leave')).toBe(true);
    g.close();
  });
});
