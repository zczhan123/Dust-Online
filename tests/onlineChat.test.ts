import { describe, it, expect, vi } from 'vitest';
import { createGame } from '../src/core/engine/game';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import { createOnlineShell, type OnlineCtx } from '../src/ui/online';
import { DEFAULT_PREFS, clonePrefs } from '../src/ui/prefs';
import { NetSession } from '../src/net/session';
import { InMemoryBus } from '../src/net/memory';
import type { RoomConfig } from '../src/net/protocol';
import type { GameState } from '../src/core/model/types';

/** 假 session：只提供 online 外壳用得到的字段（state / subscribe / chat / unread 读标）。 */
function makeStub(): {
  ctx: OnlineCtx;
  stub: {
    state: { chat: { name: string; text: string }[] };
    unreadChat: number;
    markChatRead: () => void;
  };
  push: (text: string, who?: string) => void;
} {
  const state = {
    role: 'host',
    roomId: 'r1',
    name: '甲',
    config: null,
    members: [
      { role: 'host', name: '甲' },
      { role: 'guest', name: '乙' },
    ],
    chat: [] as { name: string; text: string }[],
    sel: null,
    timer: null,
    game: null,
    myPlayer: 'A',
    peerOnline: true,
    peerLeft: false,
    rooms: [],
  };
  let read = 0;
  const listeners: Array<() => void> = [];
  const stub = {
    state,
    get unreadChat(): number {
      return Math.max(0, state.chat.length - read);
    },
    markChatRead(): void {
      read = state.chat.length;
    },
    subscribe(fn: () => void): () => void {
      listeners.push(fn);
      return () => {};
    },
    chat(): void {},
    leaveRoom(): void {},
  };
  const push = (text: string, who = '乙'): void => {
    state.chat.push({ name: who, text });
    for (const f of listeners) f();
  };
  return { ctx: { session: stub as never, onExit: () => {} }, stub, push };
}

describe('联机聊天 · 未读药丸 + 微信式顺序', () => {
  it('外壳：新消息 → 药丸出现并计数；打开聊天 → 归零、药丸隐藏', () => {
    const { ctx, stub, push } = makeStub();
    const host = document.createElement('div');
    const top = document.createElement('div');
    const shell = createOnlineShell(ctx, host);
    shell.bar(top, '构筑模式 · 联机');
    const badge = top.querySelector('.chat-badge') as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.hidden).toBe(true);

    push('你好');
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe('1');
    push('再来一句');
    expect(badge.textContent).toBe('2');
    expect(stub.unreadChat).toBe(2);

    shell.toggleChat(); // 打开＝已读
    expect(stub.unreadChat).toBe(0);
    expect(badge.hidden).toBe(true);
    shell.dispose();
  });

  it('外壳：聊天浮层**开着**时，对方发消息也不长未读（两个入口共用同一浮层逻辑）', () => {
    const { ctx, push } = makeStub();
    const host = document.createElement('div');
    const top = document.createElement('div');
    const shell = createOnlineShell(ctx, host);
    shell.bar(top, '构筑模式 · 联机');
    shell.toggleChat(); // 打开＝已读
    push('对方说一句');
    const badge = top.querySelector('.chat-badge') as HTMLElement;
    expect(shell.unreadCount()).toBe(0);
    expect(badge.hidden).toBe(true);
    shell.dispose();
  });

  it('外壳：未读封顶显示 9+；聊天记录为**正序（最旧在最上、最新在最下）**', () => {
    const { ctx, push } = makeStub();
    const host = document.createElement('div');
    const top = document.createElement('div');
    const shell = createOnlineShell(ctx, host);
    shell.bar(top, '构筑模式 · 联机');
    for (let i = 1; i <= 12; i++) push(`第${i}条`);
    const badge = top.querySelector('.chat-badge') as HTMLElement;
    expect(badge.textContent).toBe('9+');

    shell.toggleChat();
    const lines = Array.from(host.querySelectorAll('.online-chat-list .online-chat-line')).map((n) => n.textContent);
    expect(lines[0]).toContain('第1条');
    expect(lines[lines.length - 1]).toContain('第12条');
    shell.dispose();
  });
});

describe('联机聊天 · NetSession 未读读标（真会话）', () => {
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
  it('对方消息 → 递增；自己发的不算；markChatRead() 归零；离开房间（resetRoom）也归零', async () => {
    const bus = new InMemoryBus();
    const host = new NetSession(bus.connect(), '房主');
    const guest = new NetSession(bus.connect(), '来客');
    await new Promise((r) => setTimeout(r, 0));
    const roomId = host.createRoom(cfg);
    await new Promise((r) => setTimeout(r, 0));
    guest.joinRoom(roomId);
    await new Promise((r) => setTimeout(r, 0));

    expect(host.unreadChat).toBe(0);
    host.chat('我自己说'); // 自己发的不算未读
    expect(host.unreadChat).toBe(0);
    guest.chat('对方说一句');
    await new Promise((r) => setTimeout(r, 0));
    expect(host.unreadChat).toBe(1);
    guest.chat('再来一句');
    await new Promise((r) => setTimeout(r, 0));
    expect(host.unreadChat).toBe(2);
    host.markChatRead();
    expect(host.unreadChat).toBe(0);
    guest.chat('第三句');
    await new Promise((r) => setTimeout(r, 0));
    expect(host.unreadChat).toBe(1);
    host.leaveRoom(); // → resetRoom()
    expect(host.unreadChat).toBe(0);
    host.close();
    guest.close();
  });

  it('自己发的**不算**未读；对方才看得到（两端各算各的）', async () => {
    const bus = new InMemoryBus();
    const host = new NetSession(bus.connect(), '房主');
    const guest = new NetSession(bus.connect(), '来客');
    await new Promise((r) => setTimeout(r, 0));
    const roomId = host.createRoom(cfg);
    await new Promise((r) => setTimeout(r, 0));
    guest.joinRoom(roomId);
    await new Promise((r) => setTimeout(r, 0));

    host.chat('你好');
    await new Promise((r) => setTimeout(r, 0));
    expect(host.unreadChat).toBe(0); // 自己发的不冒红气球
    expect(guest.unreadChat).toBe(1); // 只有对方那边 +1
    host.close();
    guest.close();
  });

  it('空消息 / 纯空格：不产生聊天行、不增未读', async () => {
    const bus = new InMemoryBus();
    const host = new NetSession(bus.connect(), '房主');
    await new Promise((r) => setTimeout(r, 0));
    host.createRoom(cfg);
    await new Promise((r) => setTimeout(r, 0));
    host.chat('');
    host.chat('   ');
    expect(host.state.chat.length).toBe(0);
    expect(host.unreadChat).toBe(0);
    host.close();
  });
});

describe('联机聊天 · 战斗界面「聊天」按钮的未读药丸', () => {
  const mount = (g: GameState, unread: number): HTMLElement => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
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
      online: {
        myPlayer: 'A',
        names: { A: '甲', B: '乙' },
        onLeaveLobby: () => {},
        onChat: () => {},
        peerOnline: true,
        unread,
      },
    };
    renderGame(g, root, hooks);
    return root;
  };
  const chatBtn = (root: HTMLElement): HTMLElement => root.querySelector('[data-act="onlineChat"]') as HTMLElement;

  it('unread=2 → 药丸显示 2；unread=0 → 无药丸；unread=12 → 9+', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    expect(chatBtn(mount(g, 2)).querySelector('.chat-badge')!.textContent).toBe('2');
    expect(chatBtn(mount(g, 0)).querySelector('.chat-badge')).toBeNull();
    expect(chatBtn(mount(g, 12)).querySelector('.chat-badge')!.textContent).toBe('9+');
  });
});
