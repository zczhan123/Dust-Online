import { describe, it, expect, vi } from 'vitest';
import { InMemoryBus } from '../src/net/memory';
import { NetSession } from '../src/net/session';
import type { RoomConfig } from '../src/net/protocol';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const config: RoomConfig = {
  mode: 'preset',
  first: 'host',
  alt: false,
  legend: false,
  tactics: false,
  turnSeconds: 30,
  allowSpectators: true,
  note: '测试',
};

describe('联机 · NetSession（内存插头 = 两端锁步同步）', () => {
  it('建房 / 加入 / 在场 / 聊天 / 开局 / 动作 → 两端引擎状态完全一致', async () => {
    const bus = new InMemoryBus();
    const host = new NetSession(bus.connect(), '房主');
    const guest = new NetSession(bus.connect(), '访客');
    await flush();

    // 建房 → 访客能看到房间
    const roomId = host.createRoom(config);
    await flush();
    expect(guest.listRooms().map((r) => r.id)).toContain(roomId);
    expect(guest.listRooms()[0].hostName).toBe('房主');

    // 加入 → 两端在场名单都变成 2 人
    guest.joinRoom(roomId);
    await flush();
    expect(host.state.members.map((m) => m.name)).toEqual(['房主', '访客']);
    expect(guest.state.members.map((m) => m.name)).toEqual(['房主', '访客']);
    expect(guest.state.role).toBe('guest');
    expect(guest.state.myPlayer).toBe('B');
    expect(host.state.myPlayer).toBe('A');

    // 聊天（访客 → 房主）
    guest.chat('你好');
    await flush();
    expect(host.state.chat.map((c) => c.text)).toContain('你好');

    // 房主开局（同一 seed → 两端各自建局）
    host.startGame({ firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
    await flush();
    expect(host.state.game).not.toBeNull();
    expect(guest.state.game).not.toBeNull();
    expect(JSON.stringify(guest.state.game)).toBe(JSON.stringify(host.state.game));

    // 开局写一条普通战报「谁是谁」（昵称），两端都写
    expect(host.state.game!.log.some((l) => l.text === '房主 = 玩家A；访客 = 玩家B')).toBe(true);

    // 发一个动作（房主）→ 对方回放 → 状态仍一致
    host.dispatch({ t: 'advance' });
    await flush();
    expect(JSON.stringify(guest.state.game)).toBe(JSON.stringify(host.state.game));

    host.close();
    guest.close();
  });

  it('退出房间：房主关房 → 访客列表移除、并退出该房', async () => {
    const bus = new InMemoryBus();
    const host = new NetSession(bus.connect(), '房主');
    const guest = new NetSession(bus.connect(), '访客');
    await flush();

    const roomId = host.createRoom(config);
    await flush();
    guest.joinRoom(roomId);
    await flush();

    host.leaveRoom();
    await flush();
    expect(guest.state.roomId).toBeNull();
    expect(guest.listRooms().some((r) => r.id === roomId)).toBe(false);

    host.close();
    guest.close();
  });

  it('版本不一致 → 房主拒绝加入（发 room:denied，且不加入名单）', async () => {
    const bus = new InMemoryBus();
    const host = new NetSession(bus.connect(), '房主');
    const fake = bus.connect(); // 一个"旧版本"的裸客户端
    await flush();
    const roomId = host.createRoom(config);
    await flush();
    let denied = 0;
    fake.onMessage((m) => {
      if (m.t === 'room:denied' && m.reason === 'version') denied += 1;
    });
    fake.send({ t: 'room:join', from: fake.peerId, roomId, name: '旧版', role: 'guest', version: 'old' });
    await flush();
    expect(host.state.members.length).toBe(1); // 未加入
    expect(denied).toBe(1);
    host.close();
    fake.close();
  });

  it('断线重连：重进的新会话凭身份取回完整状态快照', async () => {
    const bus = new InMemoryBus();
    const host = new NetSession(bus.connect(), '房主');
    const guest = new NetSession(bus.connect(), '访客');
    await flush();
    const roomId = host.createRoom(config);
    await flush();
    guest.joinRoom(roomId);
    await flush();
    host.startGame({ firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
    await flush();
    host.dispatch({ t: 'advance' });
    await flush();
    const before = JSON.stringify(host.state.game);
    expect(before).not.toBe('null');

    // "访客掉线并刷新"：旧会话关闭；写入"本标签页上次在房"的身份（真实由 sessionStorage 维持）
    guest.close();
    sessionStorage.setItem('dust.room.v1', JSON.stringify({ roomId, role: 'guest' }));
    const guest2 = new NetSession(bus.connect(), '访客');
    guest2.tryReconnect();
    await flush();

    expect(guest2.state.roomId).toBe(roomId);
    expect(guest2.state.role).toBe('guest');
    expect(JSON.stringify(guest2.state.game)).toBe(before);

    host.close();
    guest2.close();
  });

  it('断线重连：房主刷新也能接回（由访客回快照）', async () => {
    const bus = new InMemoryBus();
    const host = new NetSession(bus.connect(), '房主');
    const guest = new NetSession(bus.connect(), '访客');
    await flush();
    const roomId = host.createRoom(config);
    await flush();
    guest.joinRoom(roomId);
    await flush();
    host.startGame({ firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
    await flush();
    host.dispatch({ t: 'advance' });
    await flush();
    const before = JSON.stringify(guest.state.game);
    expect(before).not.toBe('null');

    host.close(); // "房主刷新"（旧会话关闭；访客仍在房里、持有对局）
    sessionStorage.setItem('dust.room.v1', JSON.stringify({ roomId, role: 'host' }));
    const host2 = new NetSession(bus.connect(), '房主');
    host2.tryReconnect();
    await flush();

    expect(host2.state.roomId).toBe(roomId);
    expect(host2.state.myPlayer).toBe('A');
    expect(JSON.stringify(host2.state.game)).toBe(before);

    guest.close();
    host2.close();
  });

  it('对局中访客主动退出 → 房主 peerLeft=true（供战斗界面弹「对方已退出对局」）', async () => {
    const bus = new InMemoryBus();
    const host = new NetSession(bus.connect(), '房主');
    const guest = new NetSession(bus.connect(), '访客');
    await flush();
    const roomId = host.createRoom(config);
    await flush();
    guest.joinRoom(roomId);
    await flush();
    host.startGame({ firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
    await flush();
    expect(host.state.peerLeft).toBe(false);
    guest.leaveRoom(); // 访客主动退出
    await flush();
    expect(host.state.peerLeft).toBe(true);
    host.close();
  });

  it('对局中房主关房 → 访客 peerLeft=true', async () => {
    const bus = new InMemoryBus();
    const host = new NetSession(bus.connect(), '房主');
    const guest = new NetSession(bus.connect(), '访客');
    await flush();
    const roomId = host.createRoom(config);
    await flush();
    guest.joinRoom(roomId);
    await flush();
    host.startGame({ firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
    await flush();
    host.leaveRoom(); // 房主关房 → room:gone
    await flush();
    expect(guest.state.peerLeft).toBe(true);
    guest.close();
  });

  it('心跳：对端超时无消息 → peerOnline=false；再来消息 → true', async () => {
    vi.useFakeTimers();
    const settle = async (): Promise<void> => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    };
    try {
      const bus = new InMemoryBus();
      const host = new NetSession(bus.connect(), '房主');
      const guest = new NetSession(bus.connect(), '访客');
      await settle();
      const roomId = host.createRoom(config);
      await settle();
      guest.joinRoom(roomId);
      await settle();
      expect(host.state.members.length).toBe(2);
      expect(host.state.peerOnline).toBe(true);

      // 心跳正常：推进 6s（双方互相 ping/pong）→ 仍在线
      await vi.advanceTimersByTimeAsync(6000);
      expect(host.state.peerOnline).toBe(true);

      // 访客"掉线"（非正常：直接关网络，不发 room:leave）→ 房主 12s+ 收不到任何消息
      guest.close();
      await vi.advanceTimersByTimeAsync(13000);
      expect(host.state.peerOnline).toBe(false);

      host.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
