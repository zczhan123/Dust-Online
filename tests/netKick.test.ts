import { describe, it, expect, beforeEach } from 'vitest';
import { NetSession, banHas, hasRejoinRecordFor } from '../src/net/session';
import { APP_BUILD } from '../src/version';
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

/** 房主 + 访客（key=k-g1）已入房。 */
function hostWithGuest(): { h: NetSession; sent: NetMessage[]; roomId: string } {
  const { net, sent } = mkStub();
  const h = new NetSession(net, '房主');
  const roomId = h.createRoom(cfg);
  h['recv']({ t: 'room:join', from: 'p-g1', roomId, name: '乙', role: 'guest', version: APP_BUILD, key: 'k-g1' });
  return { h, sent, roomId };
}

describe('联机 · 房主踢人', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('「只移出」：发 room:kick、名单移除、座位空出（filled=1）', () => {
    const { h, sent, roomId } = hostWithGuest();
    sent.length = 0;
    h.kickGuest(false);
    const kick = sent.find((m) => m.t === 'room:kick');
    expect(kick).toMatchObject({ roomId, target: 'p-g1' });
    expect(h.state.members.some((m) => m.id === 'p-g1')).toBe(false);
    expect(h.state.rooms.find((r) => r.id === roomId)?.filled).toBe(1);
    h.close();
  });

  it('「移出并拉黑」：对方 key 进黑名单 → 再 room:join 直接被拒', () => {
    const { h, sent, roomId } = hostWithGuest();
    h.kickGuest(true);
    expect(banHas('k-g1')).toBe(true);
    sent.length = 0;
    h['recv']({ t: 'room:join', from: 'p-g1b', roomId, name: '乙', role: 'guest', version: APP_BUILD, key: 'k-g1' });
    expect(sent.find((m) => m.t === 'room:denied')).toMatchObject({ reason: 'banned' });
    h.close();
  });

  it('非房主调 kickGuest() → 什么都不发', () => {
    const { net, sent } = mkStub('p-guest');
    const g = new NetSession(net, '访客');
    g.state.rooms = [
      { id: 'room-a', hostId: 'p-host', hostName: '房主', guestName: null, config: cfg, seats: 2, filled: 1, version: APP_BUILD },
    ];
    g.joinRoom('room-a', 'guest');
    sent.length = 0;
    g.kickGuest(true);
    expect(sent.filter((m) => m.t === 'room:kick')).toEqual([]);
    g.close();
  });

  it('被踢方：收到 room:kick → 离开房间、提示、清掉「继续对局」记录', () => {
    const { net, sent } = mkStub('p-guest');
    const g = new NetSession(net, '访客');
    g.state.rooms = [
      { id: 'room-a', hostId: 'p-host', hostName: '房主', guestName: null, config: cfg, seats: 2, filled: 1, version: APP_BUILD },
    ];
    g.joinRoom('room-a', 'guest');
    expect(hasRejoinRecordFor('room-a')).toBe(true);

    g['recv']({ t: 'room:kick', from: 'p-host', roomId: 'room-a', target: 'p-guest' });
    expect(g.state.roomId).toBeNull();
    expect(g.state.notice).toContain('移出');
    expect(hasRejoinRecordFor('room-a')).toBe(false);
    // 告知中继"我离开这个房间"
    expect(sent.some((m) => m.t === 'room:leave')).toBe(true);
    g.close();
  });
});
