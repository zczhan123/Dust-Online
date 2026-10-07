import { describe, it, expect } from 'vitest';
import { resolveNetUrl } from '../src/net/connect';

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
