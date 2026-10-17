import { describe, it, expect, afterEach, vi } from 'vitest';
import { resolveNetUrl, resolveRelayUrl, type RelayLoc } from '../src/net/connect';

const pub = (over: Partial<RelayLoc> = {}): RelayLoc => ({
  hostname: 'dust.example.com',
  protocol: 'https:',
  host: 'dust.example.com',
  ...over,
});
const local = (over: Partial<RelayLoc> = {}): RelayLoc => ({
  hostname: 'localhost',
  protocol: 'http:',
  host: 'localhost:5173',
  ...over,
});

describe('联机 · 传输选择（resolveNetUrl）', () => {
  it('网址带 ?server=ws://… / wss://… → 返回该地址（走 WebSocket 中继）', () => {
    expect(resolveNetUrl('?server=ws://localhost:8787')).toBe('ws://localhost:8787');
    expect(resolveNetUrl('?server=wss://dust.example.com/rt')).toBe('wss://dust.example.com/rt');
    expect(resolveNetUrl('?a=1&server=ws://192.168.1.9:8787&b=2')).toBe('ws://192.168.1.9:8787');
  });

  it('其它情形 → null（走同机双标签 BroadcastChannel）', () => {
    expect(resolveNetUrl('')).toBeNull();
    expect(resolveNetUrl('?x=1')).toBeNull();
    expect(resolveNetUrl('?server=')).toBeNull();
    expect(resolveNetUrl('?server=http://localhost:8787')).toBeNull();
    expect(resolveNetUrl('?server=localhost:8787')).toBeNull();
  });
});

describe('联机 · 中继地址三级兜底（resolveRelayUrl）', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('① 显式 ?server= 优先（哪怕配了 VITE_RELAY_URL、哪怕在 localhost）', () => {
    vi.stubEnv('VITE_RELAY_URL', 'wss://env.example.com/ws');
    expect(resolveRelayUrl('?server=ws://192.168.1.9:8787', pub())).toBe('ws://192.168.1.9:8787');
    expect(resolveRelayUrl('?server=ws://192.168.1.9:8787', local())).toBe('ws://192.168.1.9:8787');
  });

  it('② 构建期 VITE_RELAY_URL（非 ws/wss 的坏值忽略）', () => {
    vi.stubEnv('VITE_RELAY_URL', 'wss://env.example.com/ws');
    expect(resolveRelayUrl('', pub())).toBe('wss://env.example.com/ws');
    vi.stubEnv('VITE_RELAY_URL', 'https://oops.example.com');
    expect(resolveRelayUrl('', pub())).toBe('wss://dust.example.com/ws');
  });

  it('③ 非 localhost → 同源 /ws（https→wss、http→ws，端口原样保留）', () => {
    expect(resolveRelayUrl('', pub())).toBe('wss://dust.example.com/ws');
    expect(resolveRelayUrl('', pub({ protocol: 'http:', host: 'dust.example.com:8080' }))).toBe(
      'ws://dust.example.com:8080/ws',
    );
    expect(resolveRelayUrl('', pub({ hostname: '10.0.0.5', protocol: 'http:', host: '10.0.0.5' }))).toBe(
      'ws://10.0.0.5/ws',
    );
  });

  it('④ localhost / 127.0.0.1 / file: → null（开发保持 BroadcastChannel）', () => {
    expect(resolveRelayUrl('', local())).toBeNull();
    expect(resolveRelayUrl('', local({ hostname: '127.0.0.1', host: '127.0.0.1:5173' }))).toBeNull();
    expect(resolveRelayUrl('', local({ hostname: '', protocol: 'file:', host: '' }))).toBeNull();
  });
});
