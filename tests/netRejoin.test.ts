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

describe('REGRESS_HOST_MEMBER: 留下的访客（无 myRoom）也要更新重连方 id', () => {
  it('房主以新 peerId 回来 → 访客名单里的 host id 更新，且回快照', () => {
    const { net, sent, emit } = mkStub();
    const sess = new NetSession(net, '访客');
    const s = sess.state;
    s.roomId = 'room-regress-1';
    s.role = 'guest';
    s.myPlayer = 'B';
    s.config = cfg; // 访客进房时就有配置；没有它不会回快照
    s.members = [
      { id: 'p-host-old', name: '房主', role: 'host' },
      { id: 'p-guest', name: '访客', role: 'guest' },
    ];
    s.game = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
    s.peerOnline = false;
    sent.length = 0;
    emit({ t: 'rejoin', from: 'p-host-new', roomId: 'room-regress-1', name: '房主', role: 'host', key: '' });
    const host = s.members.find((m) => m.role === 'host')!;
    expect(host.id).toBe('p-host-new');
    expect(sent.some((m) => m.t === 'snapshot')).toBe(true);
    expect(s.peerOnline).toBe(true);
    sess.close();
  });
});

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

describe('SPECTATOR_GUARD / SEAT_GUARD', () => {
  it('误点旁观：本机记录是同一房间的玩家 → 拦截且不覆盖记录', () => {
    localStorage.clear();
    localStorage.setItem('dust.rejoin.v1', JSON.stringify({ roomId: 'room-b', role: 'guest' }));
    const { net, sent } = mkStub();
    const sess = new NetSession(net, '我');
    sess.state.rooms = [
      {
        id: 'room-b',
        hostId: 'h',
        hostName: '房主',
        guestName: null,
        config: cfg,
        seats: 2,
        filled: 1,
        version: APP_BUILD,
      } as never,
    ];
    sent.length = 0;
    sess.joinRoom('room-b', 'spectator');
    expect(sent.some((m) => m.t === 'room:join')).toBe(false);
    expect(sess.state.notice).toContain('不能旁观');
    expect((JSON.parse(localStorage.getItem('dust.rejoin.v1')!) as { role: string }).role).toBe('guest');
    sess.close();
  });

  it('对局中：第三方（不同 key）不能顶掉已占座位', () => {
    localStorage.clear();
    const { net, sent, emit } = mkStub();
    const sess = new NetSession(net, '房主');
    const roomId = sess.createRoom(cfg);
    sess.state.game = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
    emit({ t: 'room:join', from: 'p-guest-old', roomId, name: '乙', role: 'guest', key: 'k-guard-1', version: APP_BUILD });
    sent.length = 0;
    emit({ t: 'room:join', from: 'p-guest-new', roomId, name: '丙', role: 'guest', key: 'k-other', version: APP_BUILD });
    expect(sess.state.members.find((m) => m.role === 'guest')!.id).toBe('p-guest-old');
    expect(sent.some((m) => m.t === 'snapshot')).toBe(false);
    sess.close();
  });
});

describe('BATTLE_FLAG: 旁观门槛按阶段校正（初始重掷阶段即可旁观）', () => {
  const announceFlag = (sent: NetMessage[]): boolean | undefined => {
    const ann = sent.filter((m) => m.t === 'room:announce').pop() as
      | { room?: { inBattle?: boolean } }
      | undefined;
    return ann?.room?.inBattle;
  };

  it('phase=initialReroll 且从未 dispatch → 公告 inBattle=true', () => {
    localStorage.clear();
    const { net, sent } = mkStub();
    const sess = new NetSession(net, '房主');
    sess.createRoom(cfg);
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
    (g as unknown as { phase: string }).phase = 'initialReroll';
    sess.state.game = g;
    sent.length = 0;
    sess['emit']();
    expect(announceFlag(sent)).toBe(true);
    sess.close();
  });

  it('phase=tactics → 仍视为未开战', () => {
    localStorage.clear();
    const { net, sent } = mkStub();
    const sess = new NetSession(net, '房主');
    sess.createRoom(cfg);
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
    (g as unknown as { phase: string }).phase = 'tactics';
    sess.state.game = g;
    sent.length = 0;
    sess['emit']();
    expect(announceFlag(sent)).not.toBe(true);
    sess.close();
  });
});

describe('CHAT_SNAPSHOT: 快照补聊天历史', () => {
  it('合并去重、按时间排序，原有未读数保持', () => {
    localStorage.clear();
    const { net, emit } = mkStub();
    const sess = new NetSession(net, '访客');
    const s = sess.state;
    s.roomId = 'r-chat';
    s.role = 'guest';
    s.myPlayer = 'B';
    s.members = [{ id: 'g', name: '我', role: 'guest' }];
    s.chat = [{ peerId: 'g', name: '我', text: '新消息', at: 200 }];
    sess['chatReadCount'] = 0; // 这 1 条未读

    emit({
      t: 'snapshot',
      from: 'h',
      roomId: 'r-chat',
      game: createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] }),
      members: [
        { id: 'h', name: '房主', role: 'host' },
        { id: 'g', name: '我', role: 'guest' },
      ],
      config: cfg,
      hostKey: 'k',
      chat: [
        { peerId: 'h', name: '房主', text: '旧消息', at: 100 },
        { peerId: 'g', name: '我', text: '新消息', at: 200 }, // 重复 → 去重
      ],
    });

    expect(s.chat.map((c) => c.text)).toEqual(['旧消息', '新消息']);
    expect(s.chat).toHaveLength(2);
    // 历史算已读、原来那条仍算未读
    expect(sess['chatReadCount']).toBe(1);
    sess.close();
  });
});

describe('TIMER_SNAPSHOT: 快照补行动倒计时', () => {
  it('重连后从当前时刻重新计时（保留 side/ms）', () => {
    localStorage.clear();
    const { net, emit } = mkStub();
    const sess = new NetSession(net, '访客');
    const s = sess.state;
    s.roomId = 'r-timer';
    s.role = 'guest';
    s.myPlayer = 'B';
    s.members = [{ id: 'g', name: '我', role: 'guest' }];
    const before = Date.now();
    emit({
      t: 'snapshot',
      from: 'h',
      roomId: 'r-timer',
      game: createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] }),
      members: [
        { id: 'h', name: '房主', role: 'host' },
        { id: 'g', name: '我', role: 'guest' },
      ],
      config: cfg,
      hostKey: 'k',
      timer: { side: 'A', startAt: 1, ms: 30000 },
    });
    expect(s.timer?.side).toBe('A');
    expect(s.timer?.ms).toBe(30000);
    expect(s.timer!.startAt).toBeGreaterThanOrEqual(before);
    expect(s.timer!.startAt).toBeLessThanOrEqual(Date.now());
    sess.close();
  });
});

describe('SEL_CLEAR: 重连后清空选择态', () => {
  it('收到快照后 sel 置空（不复活旧选择）', () => {
    localStorage.clear();
    const { net, emit } = mkStub();
    const sess = new NetSession(net, '访客');
    const s = sess.state;
    s.roomId = 'r-sel';
    s.role = 'guest';
    s.myPlayer = 'B';
    s.members = [{ id: 'g', name: '我', role: 'guest' }];
    s.sel = { mode: 'build', side: 'B', kind: 'whole', data: { x: 1 } } as never;
    emit({
      t: 'snapshot',
      from: 'h',
      roomId: 'r-sel',
      game: createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] }),
      members: [
        { id: 'h', name: '房主', role: 'host' },
        { id: 'g', name: '我', role: 'guest' },
      ],
      config: cfg,
      hostKey: 'k',
    });
    expect(s.sel).toBeNull();
    sess.close();
  });
});
