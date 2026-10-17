import { describe, it, expect, beforeEach } from 'vitest';
import {
  NetSession,
  banAdd,
  banHas,
  banReset,
  hasRejoinRecordFor,
  hasSavedRoom,
  abandonSavedRoom,
  loadRejoinRecord,
  onlineKey,
} from '../src/net/session';
import { createGame } from '../src/core/engine/game';
import { APP_BUILD } from '../src/version';
import type { NetMessage, RoomConfig } from '../src/net/protocol';
import type { Net } from '../src/net/transport';

function mkStub(peerId = 'p-host'): {
  net: Net;
  sent: NetMessage[];
  emit: (m: NetMessage) => void;
} {
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

describe('联机身份 key（准账号）· 黑名单 · 只认本人的重连', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('onlineKey：同一浏览器内稳定（localStorage 持久）', () => {
    const a = onlineKey();
    const b = onlineKey();
    expect(a).toBe(b);
    expect(a.startsWith('k-')).toBe(true);
  });

  it('黑名单：命中 → 拒绝加入（reason=banned）；重置后可以再进', () => {
    const { net, sent } = mkStub();
    const h = new NetSession(net, '房主');
    const roomId = h.createRoom(cfg);
    banAdd('k-bad');

    sent.length = 0;
    h['recv']({ t: 'room:join', from: 'p-x', roomId, name: '捣乱者', role: 'guest', version: APP_BUILD, key: 'k-bad' });
    expect(sent.find((m) => m.t === 'room:denied')).toMatchObject({ reason: 'banned' });
    expect(h.state.members.some((m) => m.id === 'p-x')).toBe(false);

    banReset();
    expect(banHas('k-bad')).toBe(false);
    sent.length = 0;
    h['recv']({ t: 'room:join', from: 'p-x', roomId, name: '捣乱者', role: 'guest', version: APP_BUILD, key: 'k-bad' });
    expect(h.state.members.some((m) => m.id === 'p-x')).toBe(true);
    h.close();
  });

  it('对局中：**key 不对**的 room:join 被静默丢弃（不发快照、不换人）；key 对才发快照', () => {
    const { net, sent } = mkStub();
    const h = new NetSession(net, '房主');
    const roomId = h.createRoom(cfg);
    // 原来那位（key=k-g1）加入
    h['recv']({ t: 'room:join', from: 'p-g1', roomId, name: '乙', role: 'guest', version: APP_BUILD, key: 'k-g1' });
    h.state.game = game();

    sent.length = 0;
    // 陌生人（不同的 key）想顶座
    h['recv']({ t: 'room:join', from: 'p-g2', roomId, name: '路人', role: 'guest', version: APP_BUILD, key: 'k-other' });
    expect(sent.some((m) => m.t === 'snapshot')).toBe(false);
    expect(h.state.members.find((m) => m.role === 'guest')?.id).toBe('p-g1');

    // 本人（同 key、新 peerId）回来 → 替换 + 快照
    h['recv']({ t: 'room:join', from: 'p-g1b', roomId, name: '乙', role: 'guest', version: APP_BUILD, key: 'k-g1' });
    expect(sent.some((m) => m.t === 'snapshot')).toBe(true);
    expect(h.state.members.find((m) => m.role === 'guest')?.id).toBe('p-g1b');
    h.close();
  });

  it('rejoin：房主核对房客 key（错的不发快照，对的发）', () => {
    const { net, sent } = mkStub();
    const h = new NetSession(net, '房主');
    const roomId = h.createRoom(cfg);
    h['recv']({ t: 'room:join', from: 'p-g1', roomId, name: '乙', role: 'guest', version: APP_BUILD, key: 'k-g1' });
    h.state.game = game();
    h.state.peerLeft = true;

    sent.length = 0;
    h['recv']({ t: 'rejoin', from: 'p-g2', roomId, name: '乙', role: 'guest', key: 'k-wrong' });
    expect(sent.some((m) => m.t === 'snapshot')).toBe(false);

    h['recv']({ t: 'rejoin', from: 'p-g1', roomId, name: '乙', role: 'guest', key: 'k-g1' });
    expect(sent.some((m) => m.t === 'snapshot')).toBe(true);
    expect(h.state.peerLeft).toBe(false);
    h.close();
  });

  it('rejoin：房客核对房主 key（错的不发快照，对的发）', () => {
    const { net, sent } = mkStub('p-guest');
    const g = new NetSession(net, '访客');
    g.state.roomId = 'room-x';
    g.state.role = 'guest';
    // 从快照里学得房主 key（真实流程：房主开局/回快照时带上）
    g['recv']({
      t: 'snapshot',
      from: 'p-host',
      roomId: 'room-x',
      game: game(),
      members: [],
      config: cfg,
      hostKey: 'k-host',
    });

    sent.length = 0;
    g['recv']({ t: 'rejoin', from: 'p-host2', roomId: 'room-x', name: '房主', role: 'host', key: 'k-fake' });
    expect(sent.some((m) => m.t === 'snapshot')).toBe(false);

    g['recv']({ t: 'rejoin', from: 'p-host', roomId: 'room-x', name: '房主', role: 'host', key: 'k-host' });
    expect(sent.some((m) => m.t === 'snapshot')).toBe(true);
    g.close();
  });

  it('观众不占座：访客离开后 filled=1（即使名单里还有观众）', () => {
    const { net } = mkStub();
    const h = new NetSession(net, '房主');
    const roomId = h.createRoom(cfg);
    h['recv']({ t: 'room:join', from: 'p-g1', roomId, name: '乙', role: 'guest', version: APP_BUILD, key: 'k-g1' });
    // 观众也进了名单（房主自己维护的成员表）
    h.state.members = [...h.state.members, { id: 'p-s1', name: '看客', role: 'spectator' }];
    h['recv']({ t: 'room:leave', from: 'p-g1', roomId });
    const room = h.state.rooms.find((r) => r.id === roomId);
    expect(room?.filled).toBe(1); // 只剩房主 + 观众（观众不算座）
    h.close();
  });

  it('「继续对局」的记录：加入后有、主动离开后没有', () => {
    const { net } = mkStub('p-guest');
    const g = new NetSession(net, '访客');
    g.state.rooms = [
      { id: 'room-a', hostId: 'p-host', hostName: '房主', guestName: null, config: cfg, seats: 2, filled: 1, version: APP_BUILD },
    ];
    g.joinRoom('room-a', 'guest');
    expect(hasRejoinRecordFor('room-a')).toBe(true);
    expect(hasSavedRoom()).toBe(true); // 对局者：本标签页也有记录（刷新弹「继续上一局」）
    g.leaveRoom();
    expect(hasRejoinRecordFor('room-a')).toBe(false);
    g.close();
  });

  it('**旁观者**不算对局者：不写本标签页记录（刷新不弹"未完成的对局"），只写共享记录（大厅给「继续旁观」）', () => {
    const { net } = mkStub('p-spec');
    const s = new NetSession(net, '看客');
    s.state.rooms = [
      { id: 'room-a', hostId: 'p-host', hostName: '房主', guestName: null, config: cfg, seats: 2, filled: 2, version: APP_BUILD, inBattle: true },
    ];
    s.joinRoom('room-a', 'spectator');
    expect(hasSavedRoom()).toBe(false); // ← 不弹"未完成的联机对局"
    expect(hasRejoinRecordFor('room-a')).toBe(true);
    expect(loadRejoinRecord()?.role).toBe('spectator');
    s.close();
  });

  it('历史遗留的"旁观"本标签页记录 → 也不再触发「未完成的对局」', () => {
    sessionStorage.setItem('dust.room.v1', JSON.stringify({ roomId: 'room-a', role: 'spectator' }));
    expect(hasSavedRoom()).toBe(false);
  });

  it('「放弃并新开」→ 共享记录也被清（大厅不再挂"继续"）', () => {
    const { net } = mkStub('p-guest');
    const g = new NetSession(net, '访客');
    g.state.rooms = [
      { id: 'room-a', hostId: 'p-host', hostName: '房主', guestName: null, config: cfg, seats: 2, filled: 1, version: APP_BUILD },
    ];
    g.joinRoom('room-a', 'guest');
    expect(hasRejoinRecordFor('room-a')).toBe(true);
    abandonSavedRoom();
    expect(hasRejoinRecordFor('room-a')).toBe(false);
    g.close();
  });
});
