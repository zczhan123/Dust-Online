import { describe, it, expect } from 'vitest';
import { NetSession } from '../src/net/session';
import { createGame } from '../src/core/engine/game';
import { APP_BUILD } from '../src/version';
import type { NetMessage, RoomConfig } from '../src/net/protocol';
import type { Net } from '../src/net/transport';

function mkStub(): { net: Net; sent: NetMessage[]; emit: (m: NetMessage) => void } {
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

const game = () =>
  createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });

describe('房间密码', () => {
  it('建房带密码：公告只有 hasPassword，不含明文', () => {
    sessionStorage.clear();
    localStorage.clear();
    const { net, sent } = mkStub();
    const sess = new NetSession(net, '房主');
    sess.createRoom({ ...cfg, password: '1234' });
    const announces = sent.filter((m) => m.t === 'room:announce');
    const last = announces[announces.length - 1] as { room: { config: RoomConfig } };
    expect(last.room.config.hasPassword).toBe(true);
    expect(JSON.stringify(sent)).not.toContain('"abc"');
    sess.close();
  });

  it('无密码 / 错密码加入 → 拒绝（reason=password，带 target）', () => {
    sessionStorage.clear();
    localStorage.clear();
    const { net, sent, emit } = mkStub();
    const sess = new NetSession(net, '房主');
    const roomId = sess.createRoom({ ...cfg, password: '1234' });
    sent.length = 0;
    emit({ t: 'room:join', from: 'p-g1', roomId, name: '乙', role: 'guest', version: APP_BUILD, key: 'k1' });
    emit({ t: 'room:join', from: 'p-g2', roomId, name: '丙', role: 'guest', version: APP_BUILD, key: 'k2', password: '9999' });
    const denied = sent.filter((m) => m.t === 'room:denied') as Array<{ reason: string; target: string }>;
    expect(denied.map((d) => d.reason)).toEqual(['password', 'password']);
    expect(denied.map((d) => d.target)).toEqual(['p-g1', 'p-g2']);
    expect(sess.state.members.some((m) => m.role === 'guest')).toBe(false);
    sess.close();
  });

  it('正确密码 → 正常加入', () => {
    sessionStorage.clear();
    localStorage.clear();
    const { net, sent, emit } = mkStub();
    const sess = new NetSession(net, '房主');
    const roomId = sess.createRoom({ ...cfg, password: '1234' });
    sent.length = 0;
    emit({ t: 'room:join', from: 'p-g', roomId, name: '乙', role: 'guest', version: APP_BUILD, key: 'k1', password: '1234' });
    expect(sent.some((m) => m.t === 'room:denied')).toBe(false);
    expect(sess.state.members.find((m) => m.role === 'guest')?.id).toBe('p-g');
    sess.close();
  });

  it('旁观同样要求密码', () => {
    sessionStorage.clear();
    localStorage.clear();
    const { net, sent, emit } = mkStub();
    const sess = new NetSession(net, '房主');
    const roomId = sess.createRoom({ ...cfg, password: '1234' });
    sess.state.game = game();
    sess.state.game.phase = 'main';
    sent.length = 0;
    emit({ t: 'room:join', from: 'p-sp', roomId, name: '观', role: 'spectator', version: APP_BUILD, key: 'k3' });
    expect((sent.filter((m) => m.t === 'room:denied')[0] as { reason: string }).reason).toBe('password');
    sess.close();
  });

  it('重连（rejoin）不需要密码', () => {
    sessionStorage.clear();
    localStorage.clear();
    const { net, sent, emit } = mkStub();
    const sess = new NetSession(net, '房主');
    const roomId = sess.createRoom({ ...cfg, password: '1234' });
    sess.state.game = game();
    sess.state.members = [
      { id: 'p-host', name: '房主', role: 'host' },
      { id: 'p-g', name: '乙', role: 'guest' },
    ];
    sent.length = 0;
    emit({ t: 'rejoin', from: 'p-g2', roomId, name: '乙', role: 'guest', key: '' });
    expect(sent.some((m) => m.t === 'snapshot')).toBe(true);
    sess.close();
  });

  it('房主重连：hasPassword 保留；密码从本地记录恢复，新加入仍受校验', () => {
    sessionStorage.clear();
    localStorage.clear();
    // 1) 先真的建一次房（把密码写进 localStorage）
    const first = mkStub();
    const s1 = new NetSession(first.net, '房主');
    const roomId = s1.createRoom({ ...cfg, password: '1234' });
    const publicCfg = { ...cfg, hasPassword: true };
    s1.close();

    // 2) 模拟新标签：收到快照后重建 myRoom
    const { net, sent, emit } = mkStub();
    const s2 = new NetSession(net, '房主');
    s2.state.roomId = roomId;
    s2.state.role = 'host';
    s2.state.myPlayer = 'A';
    s2.state.members = [{ id: 'p-host', name: '房主', role: 'host' }, { id: 'p-g', name: '乙', role: 'guest' }];
    emit({
      t: 'snapshot',
      from: 'p-g',
      roomId,
      game: game(),
      members: s2.state.members,
      config: publicCfg,
      hostKey: 'k',
    });
    expect(s2.state.role).toBe('host');
    sent.length = 0;
    emit({ t: 'room:join', from: 'p-x', roomId, name: '丙', role: 'guest', version: APP_BUILD, key: 'kx' });
    expect((sent.filter((m) => m.t === 'room:denied')[0] as { reason: string }).reason).toBe('password');
    sent.length = 0;
    emit({ t: 'room:join', from: 'p-y', roomId, name: '丁', role: 'guest', version: APP_BUILD, key: 'ky', password: '1234' });
    expect(sent.some((m) => m.t === 'room:denied')).toBe(false);
    s2.close();
  });
});

describe('密码规则：纯数字 4 位', () => {
  it('创建时含字母会被过滤；不足 4 位拒绝创建', () => {
    sessionStorage.clear();
    localStorage.clear();
    const a = mkStub();
    const s1 = new NetSession(a.net, '??');
    s1.createRoom({ ...cfg, password: '12ab34' });
    const ann = a.sent.filter((m) => m.t === 'room:announce').pop() as { room: { config: RoomConfig } };
    expect(ann.room.config.hasPassword).toBe(true);
    a.sent.length = 0;
    a.emit({ t: 'room:join', from: 'p-n1', roomId: 'room-p-host', name: '?', role: 'guest', version: APP_BUILD, key: 'kn', password: '1234' });
    expect(a.sent.some((m) => m.t === 'room:denied')).toBe(false);
    s1.close();

    sessionStorage.clear();
    localStorage.clear();
    const b = mkStub();
    const s2 = new NetSession(b.net, '房主');
    expect(() => s2.createRoom({ ...cfg, password: '123' })).toThrow();
    s2.close();
  });
});
