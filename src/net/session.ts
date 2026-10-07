import { createGame, applyAction } from '../core/engine/game';
import { logLine } from '../core/engine/log';
import type { Action, GameState, PlayerId } from '../core/model/types';
import type { Net } from './transport';
import type { Member, NetMessage, Role, RoomConfig, RoomInfo, StartSetup } from './protocol';
import { APP_BUILD } from '../version';

/** 聊天一行 */
export interface ChatLine {
  peerId: string;
  name: string;
  text: string;
  at: number;
}

/** 会话对外快照（界面读它） */
export interface SessionState {
  peerId: string;
  name: string;
  /** 已知房间列表（大厅用） */
  rooms: RoomInfo[];
  /** "在线"名单（同机/同频道能听到的端；**跨机名单需服务器，搁置**） */
  online: { id: string; name: string }[];
  /** 对端最近一次"选择同步"（本端据此合并到自己的选择状态） */
  sel: { mode: 'preset' | 'build' | 'draft'; side: 'A' | 'B'; kind: 'merge' | 'whole'; data: unknown } | null;
  /** 对端最近一次"行动倒计时"广播（两端据此画同一条进度条） */
  timer: { side: 'A' | 'B'; startAt: number; ms: number } | null;
  /** 我当前所在房间（未入房 = null） */
  roomId: string | null;
  role: Role | null;
  config: RoomConfig | null;
  /** 在场成员（房主广播的权威名单） */
  members: Member[];
  chat: ChatLine[];
  /** 对局状态（开局后非 null）；**两端各自持有、应始终一致** */
  game: GameState | null;
  /** 我是哪一方（房主=A / 来客=B / 旁观=null） */
  myPlayer: PlayerId | null;
  /** 对端是否在线（心跳判定；**仅房内有效**，无对端时恒 true）。战斗界面据此暂停 + 弹"掉线"框 */
  peerOnline: boolean;
  /** 对端**主动退出/关房**（对局进行中）→ 明确提示"对方已退出对局"（而非静默卡住） */
  peerLeft: boolean;
  /** 一次性提示（如"版本不一致，请刷新页面"）；界面显示后自行清除 */
  notice: string | null;
}

/** 心跳：每 2s 发一次 ping；每 1s 检查；超过 12s 没收到对端任何消息 → 判掉线
 *  （"收到 ping 回 pong + 任何消息算存活"→ 容忍后台标签被浏览器限流） */
const HEARTBEAT_MS = 2000;
const WATCH_MS = 1000;
const PEER_TIMEOUT_MS = 12000;

/** 房间身份持久化（**sessionStorage**：按标签页隔离、刷新仍在、两个标签互不覆盖）——供刷新后重连 */
const ROOM_KEY = 'dust.room.v1';
type SavedRoom = { roomId: string; role: Role };
function loadSavedRoom(): SavedRoom | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(ROOM_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<SavedRoom>;
    return o && typeof o.roomId === 'string' && (o.role === 'host' || o.role === 'guest')
      ? { roomId: o.roomId, role: o.role }
      : null;
  } catch {
    return null;
  }
}
function saveSavedRoom(r: SavedRoom): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(ROOM_KEY, JSON.stringify(r));
  } catch {
    /* ignore */
  }
}
function clearSavedRoom(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(ROOM_KEY);
  } catch {
    /* ignore */
  }
}

/** 本标签页是否有"上次未退出的房间"（供启动时决定是否直接进大厅以尝试重连）。 */
export function hasSavedRoom(): boolean {
  return loadSavedRoom() !== null;
}

/** 放弃"上次未退出的房间"（清掉持久化身份 → 不再自动重连）。 */
export function abandonSavedRoom(): void {
  clearSavedRoom();
}

/**
 * 「房间会话」——**与传输插头无关**的一层：
 * - 房间生命周期（建房 / 加入 / 退出）+ 房间列表 + 在场名单 + 聊天；
 * - 开局（房主产生 seed，广播 `start`，两端各自 `createGame`）；
 * - 动作同步（任一方发动作 → 两端各自 `applyAction`；**行为锁步**）。
 *
 * 传输只经 `Net` 接口——换插头（内存 / 同机双标签 / 将来 WebSocket）不改本层。
 *
 * 备注（有意为之）：
 * - **输入门禁不在此层**：界面按 `game` + `myPlayer` 判断"该不该我操作"（第 4 批接）。
 * - **暗牌（战术抽 2 留 1）**：动作回放会暴露给对方 → 留特例后定（第 3 批）。
 */
export class NetSession {
  private net: Net;
  private st: SessionState;
  private subs = new Set<(s: SessionState) => void>();
  /** 我作为**房主**时的房间信息（用于公告 / 应答房间列表） */
  private myRoom: RoomInfo | null = null;
  /** 心跳：对端最近一次"有消息"的时刻 / 定时器 / 关闭标签时的尽力通知 */
  private peerSeenAt = 0;
  private hbTimer: ReturnType<typeof setInterval> | null = null;
  private wdTimer: ReturnType<typeof setInterval> | null = null;
  private onUnload: (() => void) | null = null;

  constructor(net: Net, name = '无名玩家') {
    this.net = net;
    this.st = {
      peerId: net.peerId,
      name,
      rooms: [],
      online: [{ id: net.peerId, name }], // 自己也在线
      sel: null,
      timer: null,
      roomId: null,
      role: null,
      config: null,
      members: [],
      chat: [],
      game: null,
      myPlayer: null,
      peerOnline: true,
      peerLeft: false,
      notice: null,
    };
    net.onMessage((m) => this.recv(m));
    // 关闭标签时**尽力**通知对端（辅助；关标签消息未必送达 → 主要还是靠心跳超时）
    if (typeof window !== 'undefined') {
      this.onUnload = () => {
        if (this.st.roomId) this.net.send({ t: 'room:leave', from: this.net.peerId, roomId: this.st.roomId });
      };
      window.addEventListener('beforeunload', this.onUnload);
    }
    // 上线：问一下有哪些房间 + 报个到（在线名单）
    net.send({ t: 'rooms:req', from: net.peerId });
    net.send({ t: 'hello', from: net.peerId, name });
  }

  get state(): SessionState {
    return this.st;
  }

  subscribe(cb: (s: SessionState) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  /** 关闭会话（离开大厅时调用）：关闭底层传输、清空订阅。 */
  close(): void {
    this.stopHeartbeat();
    if (this.onUnload && typeof window !== 'undefined') window.removeEventListener('beforeunload', this.onUnload);
    this.onUnload = null;
    clearSavedRoom();
    this.subs.clear();
    this.net.close();
  }

  setName(name: string): void {
    this.st.name = name.slice(0, 6); // 全局昵称上限 6 字（大厅 / 选择页 / 战斗界面共用，防超长名）
    if (this.myRoom) {
      this.myRoom = { ...this.myRoom, hostName: name };
      this.announce();
    }
    this.emit();
  }

  listRooms(): RoomInfo[] {
    return this.st.rooms;
  }

  createRoom(config: RoomConfig): string {
    const id = `room-${this.net.peerId}`;
    this.myRoom = {
      id,
      hostId: this.net.peerId,
      hostName: this.st.name,
      guestName: null,
      config,
      seats: 2,
      filled: 1,
      version: APP_BUILD,
    };
    this.st.roomId = id;
    this.st.role = 'host';
    this.st.config = config;
    this.st.myPlayer = 'A';
    this.st.peerLeft = false;
    this.st.members = [{ id: this.net.peerId, name: this.st.name, role: 'host' }];
    this.upsert(this.myRoom);
    this.announce();
    this.startHeartbeat();
    saveSavedRoom({ roomId: id, role: 'host' });
    this.emit();
    return id;
  }

  joinRoom(roomId: string, role: Role = 'guest'): void {
    const room = this.st.rooms.find((r) => r.id === roomId);
    if (!room) return;
    this.st.roomId = roomId;
    this.st.role = role;
    this.st.config = room.config;
    this.st.myPlayer = role === 'guest' ? 'B' : null;
    this.st.notice = null;
    this.st.peerLeft = false;
    this.net.send({ t: 'room:join', from: this.net.peerId, roomId, name: this.st.name, role, version: APP_BUILD });
    this.startHeartbeat();
    saveSavedRoom({ roomId, role });
    this.emit();
  }

  /** 断线重连（刷新后）：若本标签页上次在房里且当前不在 → 恢复身份、请房内对端回发状态快照。 */
  tryReconnect(): void {
    if (this.st.roomId) return;
    const saved = loadSavedRoom();
    if (!saved) return;
    this.st.roomId = saved.roomId;
    this.st.role = saved.role;
    this.st.myPlayer = saved.role === 'guest' ? 'B' : 'A';
    this.st.peerLeft = false;
    this.startHeartbeat();
    this.net.send({ t: 'rejoin', from: this.net.peerId, roomId: saved.roomId, name: this.st.name, role: saved.role });
    this.emit();
  }

  leaveRoom(): void {
    if (!this.st.roomId) return;
    const id = this.st.roomId;
    if (this.myRoom) this.net.send({ t: 'room:gone', from: this.net.peerId, roomId: id });
    else this.net.send({ t: 'room:leave', from: this.net.peerId, roomId: id });
    this.myRoom = null;
    this.st.rooms = this.st.rooms.filter((r) => r.id !== id);
    this.stopHeartbeat();
    clearSavedRoom();
    this.resetRoom();
    this.emit();
  }

  chat(text: string): void {
    if (!this.st.roomId || !text.trim()) return;
    const at = Date.now();
    this.net.send({ t: 'chat', from: this.net.peerId, roomId: this.st.roomId, name: this.st.name, text, at });
    this.pushChat({ peerId: this.net.peerId, name: this.st.name, text, at });
  }

  /** 开局写一条普通战报（谁是谁）：昵称只在这里出现，引擎其余文案一律「玩家A/B」 */
  private noteWhoIsWho(): void {
    if (!this.st.game) return;
    const host = this.st.members.find((m) => m.role === 'host')?.name ?? '玩家A';
    const guest = this.st.members.find((m) => m.role === 'guest')?.name ?? '玩家B';
    logLine(this.st.game, `${host} = 玩家A；${guest} = 玩家B`);
  }

  /** 房主专属：产生 seed、两端各自建局、广播开局 */
  startGame(setup: StartSetup): void {
    if (this.st.role !== 'host' || !this.st.roomId) return;
    const seed = Math.floor(Math.random() * 1_000_000_000);
    this.st.game = createGame({ seed, ...setup });
    this.noteWhoIsWho();
    this.net.send({ t: 'start', from: this.net.peerId, roomId: this.st.roomId, seed, setup });
    this.emit();
  }

  /** 发一个动作：本地应用 + 广播（对方收到后同样应用 → 锁步） */
  dispatch(action: Action): void {
    if (!this.st.game || !this.st.roomId) return;
    applyAction(this.st.game, action);
    this.net.send({ t: 'action', from: this.net.peerId, roomId: this.st.roomId, action });
    this.emit();
  }

  /** 选择阶段：把"我这一侧 / 整份"选择广播给对端（对端合并） */
  sendSel(mode: 'preset' | 'build' | 'draft', side: 'A' | 'B', kind: 'merge' | 'whole', data: unknown): void {
    if (!this.st.roomId) return;
    this.net.send({ t: 'sel', from: this.net.peerId, roomId: this.st.roomId, mode, side, kind, data });
  }

  /** 行动倒计时：操作方广播"本段开始时刻 + 时长" */
  sendTimer(side: 'A' | 'B', startAt: number, ms: number): void {
    if (!this.st.roomId) return;
    this.net.send({ t: 'timer', from: this.net.peerId, roomId: this.st.roomId, side, startAt, ms });
  }

  // ────────── 内部 ──────────

  private announce(): void {
    if (this.myRoom) this.net.send({ t: 'room:announce', from: this.net.peerId, room: this.myRoom });
  }

  private recordOnline(id: string, name: string): void {
    if (this.st.online.some((x) => x.id === id)) {
      this.st.online = this.st.online.map((x) => (x.id === id ? { id, name } : x));
    } else {
      this.st.online = [...this.st.online, { id, name }];
    }
  }

  private upsert(room: RoomInfo): void {
    const i = this.st.rooms.findIndex((r) => r.id === room.id);
    if (i >= 0) this.st.rooms = this.st.rooms.map((r) => (r.id === room.id ? room : r));
    else this.st.rooms = [...this.st.rooms, room];
  }

  private pushChat(line: ChatLine): void {
    this.st.chat = [...this.st.chat, line];
    this.emit();
  }

  private resetRoom(): void {
    this.st.roomId = null;
    this.st.role = null;
    this.st.config = null;
    this.st.members = [];
    this.st.chat = [];
    this.st.sel = null;
    this.st.timer = null;
    this.st.game = null;
    this.st.myPlayer = null;
    this.st.peerOnline = true;
    this.st.peerLeft = false;
  }

  // ────────── 心跳（在线/掉线判定） ──────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.peerSeenAt = Date.now();
    this.st.peerOnline = true;
    this.hbTimer = setInterval(() => {
      if (this.st.roomId) this.net.send({ t: 'ping', from: this.net.peerId, roomId: this.st.roomId });
    }, HEARTBEAT_MS);
    this.wdTimer = setInterval(() => this.checkPeer(), WATCH_MS);
  }

  private stopHeartbeat(): void {
    if (this.hbTimer != null) clearInterval(this.hbTimer);
    if (this.wdTimer != null) clearInterval(this.wdTimer);
    this.hbTimer = null;
    this.wdTimer = null;
  }

  /** 无对端（房内只有我）→ 恒在线；有对端 → 超时未见消息即掉线。仅在**变化时** emit。 */
  private checkPeer(): void {
    if (!this.st.roomId) return;
    const hasPeer = this.st.members.length >= 2;
    const online = !hasPeer || Date.now() - this.peerSeenAt < PEER_TIMEOUT_MS;
    if (online !== this.st.peerOnline) {
      this.st.peerOnline = online;
      this.emit();
    }
  }

  private emit(): void {
    const s = this.st;
    for (const cb of this.subs) cb(s);
  }

  private recv(m: NetMessage): void {
    const mine = (roomId: string) => this.st.roomId === roomId;
    // 心跳：收到**房内对端**的任何消息都算"还活着"（这样前台一方 ping、后台一方回 pong，双方都能保活）
    if (m.from !== this.net.peerId && this.st.roomId && 'roomId' in m && m.roomId === this.st.roomId) {
      this.peerSeenAt = Date.now();
    }
    switch (m.t) {
      case 'rooms:req':
        if (this.myRoom) this.announce();
        break;
      case 'hello': {
        this.recordOnline(m.from, m.name);
        if (m.from !== this.net.peerId) this.net.send({ t: 'hi', from: this.net.peerId, name: this.st.name });
        this.emit();
        break;
      }
      case 'hi':
        this.recordOnline(m.from, m.name);
        this.emit();
        break;
      case 'room:announce':
        if (m.room.hostId !== this.net.peerId) {
          this.upsert(m.room);
          this.emit();
        }
        break;
      case 'room:gone':
        if (m.from === this.net.peerId) break;
        this.st.rooms = this.st.rooms.filter((r) => r.id !== m.roomId);
        if (mine(m.roomId)) {
          // 对局进行中房主离开 → 明确提示"对方已退出"（不静默清空）；否则正常重置
          if (this.st.game) this.st.peerLeft = true;
          else this.resetRoom();
        }
        this.emit();
        break;
      case 'room:join':
        if (this.myRoom && m.roomId === this.myRoom.id) {
          // 锁步下版本不一致 = 必分叉 → 拒绝加入并告知（客户端另在大厅对"版本不同"的房间预先禁用加入）
          if (m.version !== APP_BUILD) {
            this.net.send({ t: 'room:denied', from: this.net.peerId, roomId: m.roomId, reason: 'version' });
            break;
          }
          if (this.st.members.length < this.myRoom.seats) {
            this.st.members = [...this.st.members, { id: m.from, name: m.name, role: m.role }];
            this.myRoom = { ...this.myRoom, guestName: m.name, filled: this.st.members.length };
            this.upsert(this.myRoom);
            this.net.send({ t: 'presence', from: this.net.peerId, roomId: m.roomId, members: this.st.members });
            this.announce();
            this.emit();
          }
        }
        break;
      case 'room:denied':
        if (mine(m.roomId) && m.from !== this.net.peerId && m.reason === 'version') {
          this.resetRoom();
          this.st.notice = '房间版本不一致，无法加入——请刷新页面后重试';
          this.emit();
        }
        break;
      case 'rejoin':
        // 房里**任何持有对局的端**都能回快照（不再只限房主）→ **房主刷新也能接回**
        if (this.st.roomId === m.roomId && this.st.game) {
          if (this.myRoom) {
            // 房主：把重连方并回名单（以 role 为准，替换为新 peerId）
            const has = this.st.members.some((x) => x.role === m.role);
            this.st.members = has
              ? this.st.members.map((x) => (x.role === m.role ? { id: m.from, name: m.name, role: m.role } : x))
              : [...this.st.members, { id: m.from, name: m.name, role: m.role }];
          }
          const cfg = this.myRoom?.config ?? this.st.config;
          if (cfg) {
            this.net.send({
              t: 'snapshot',
              from: this.net.peerId,
              roomId: m.roomId,
              game: this.st.game,
              members: this.st.members,
              config: cfg,
            });
          }
          this.emit();
        }
        break;
      case 'snapshot':
        if (mine(m.roomId) && m.from !== this.net.peerId && !this.st.game) {
          this.st.game = m.game;
          this.st.members = m.members;
          this.st.config = m.config;
          this.emit();
        }
        break;
      case 'room:leave':
        if (this.myRoom && m.roomId === this.myRoom.id) {
          this.st.members = this.st.members.filter((x) => x.id !== m.from);
          this.myRoom = { ...this.myRoom, guestName: null, filled: this.st.members.length };
          this.upsert(this.myRoom);
          if (this.st.game) this.st.peerLeft = true; // 对局中来客退出 → 明确提示
          this.net.send({ t: 'presence', from: this.net.peerId, roomId: m.roomId, members: this.st.members });
          this.announce();
          this.emit();
        }
        break;
      case 'presence':
        if (mine(m.roomId)) {
          this.st.members = m.members;
          this.emit();
        }
        break;
      case 'chat':
        if (mine(m.roomId) && m.from !== this.net.peerId) {
          this.pushChat({ peerId: m.from, name: m.name, text: m.text, at: m.at });
        }
        break;
      case 'start':
        if (mine(m.roomId) && m.from !== this.net.peerId) {
          this.st.game = createGame({ seed: m.seed, ...m.setup });
          this.noteWhoIsWho();
          this.emit();
        }
        break;
      case 'action':
        if (mine(m.roomId) && m.from !== this.net.peerId && this.st.game) {
          applyAction(this.st.game, m.action);
          this.emit();
        }
        break;
      case 'sel':
        if (mine(m.roomId) && m.from !== this.net.peerId) {
          this.st.sel = { mode: m.mode, side: m.side, kind: m.kind, data: m.data };
          this.emit();
        }
        break;
      case 'timer':
        if (mine(m.roomId) && m.from !== this.net.peerId) {
          this.st.timer = { side: m.side, startAt: m.startAt, ms: m.ms };
          this.emit();
        }
        break;
      case 'ping':
        if (mine(m.roomId) && m.from !== this.net.peerId) {
          this.net.send({ t: 'pong', from: this.net.peerId, roomId: m.roomId });
        }
        break;
      case 'pong':
        break; // 存活已在 recv 开头记录
    }
  }
}
