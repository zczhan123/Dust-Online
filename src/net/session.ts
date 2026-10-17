import { createGame, applyAction } from '../core/engine/game';
import { logLine } from '../core/engine/log';
import type { Action, GameState, PlayerId } from '../core/model/types';
import type { Net } from './transport';
import type { Member, NetMessage, Role, RoomConfig, RoomInfo, StartSetup } from './protocol';
import { APP_BUILD } from '../version';

/** 聊天一行（`sys`＝**系统行**：无发言人，如「XX」进来旁观） */
export interface ChatLine {
  peerId: string;
  name: string;
  text: string;
  at: number;
  sys?: boolean;
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
  /** 我是哪一方（房主=A / 访客=B / 旁观=null） */
  myPlayer: PlayerId | null;
  /** 对端是否在线（心跳判定；**仅房内有效**，无对端时恒 true）。战斗界面据此暂停 + 弹"掉线"框 */
  peerOnline: boolean;
  /** 对端**主动退出/关房**（对局进行中）→ 明确提示"对方已退出对局"（而非静默卡住） */
  peerLeft: boolean;
  /** 一次性提示（如"版本不一致，请刷新页面"）；界面显示后自行清除 */
  notice: string | null;
  /** 传输连接状态（仅 WebSocketNet 会更新）：重连中界面应提示"正在重连…"，不要误报"对方掉线" */
  netStatus?: 'open' | 'closed' | 'reconnecting';
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
    return o && typeof o.roomId === 'string' && (o.role === 'host' || o.role === 'guest' || o.role === 'spectator')
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

/* ────────── 身份 key（准账号）· 最近房间 · 黑名单（2026-10-15，参照星杯 `onlineKey`） ────────── */

const ID_KEY = 'dust.key.v1';
const REJOIN_KEY = 'dust.rejoin.v1';
const BAN_KEY = 'dust.ban.v1';

function randId(): string {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto;
  if (c?.getRandomValues) {
    const a = new Uint32Array(2);
    c.getRandomValues(a);
    return a[0].toString(36) + a[1].toString(36);
  }
  return Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
}

let memKey: string | null = null;
/**
 * 本机身份 key（**准账号**）：`localStorage["dust.key.v1"]`，持久随机串。
 * 用途：① 房主的**黑名单**判定 ② **只认本人**的重连校验。
 * ⚠️ 与星杯 `onlineKey` 同款语义：**清缓存/换浏览器/隐身就换人**（软黑名单，挡不住刻意绕过）。
 */
export function onlineKey(): string {
  if (memKey) return memKey;
  try {
    if (typeof localStorage !== 'undefined') {
      const k = localStorage.getItem(ID_KEY);
      if (k) {
        memKey = k;
        return k;
      }
      memKey = `k-${randId()}`;
      localStorage.setItem(ID_KEY, memKey);
      return memKey;
    }
  } catch {
    /* ignore */
  }
  memKey = `k-${randId()}`;
  return memKey;
}

/** 「我上次在哪个房间」（**localStorage，跨标签/关标签都在**）→ 大厅据此给"继续对局"。 */
export interface RejoinRecord {
  roomId: string;
  role: Role;
}
export function loadRejoinRecord(): RejoinRecord | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(REJOIN_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<RejoinRecord>;
    return o && typeof o.roomId === 'string' && (o.role === 'host' || o.role === 'guest' || o.role === 'spectator')
      ? { roomId: o.roomId, role: o.role }
      : null;
  } catch {
    return null;
  }
}
/** 大厅用：这个房间**是不是我上次那局**（决定显示「继续对局」还是「已满/可加入」）。 */
export function hasRejoinRecordFor(roomId: string): boolean {
  return loadRejoinRecord()?.roomId === roomId;
}
function saveRejoinRecord(r: RejoinRecord): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(REJOIN_KEY, JSON.stringify(r));
  } catch {
    /* ignore */
  }
}
function clearRejoinRecord(roomId?: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const cur = loadRejoinRecord();
    if (!cur || (roomId && cur.roomId !== roomId)) return;
    localStorage.removeItem(REJOIN_KEY);
  } catch {
    /* ignore */
  }
}

/** 房主**本机黑名单**（只存 key 数组；**不展示条目**，只提供"全部重置"）。 */
function loadBan(): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const a = JSON.parse(localStorage.getItem(BAN_KEY) ?? '[]');
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
export function banHas(key: string): boolean {
  return key !== '' && loadBan().includes(key);
}
export function banAdd(key: string): void {
  if (!key) return;
  try {
    const a = loadBan();
    if (a.includes(key) || typeof localStorage === 'undefined') return;
    localStorage.setItem(BAN_KEY, JSON.stringify([...a, key]));
  } catch {
    /* ignore */
  }
}
export function banReset(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(BAN_KEY);
  } catch {
    /* ignore */
  }
}

/** 房间级身份 key（**sessionStorage**：刷新仍在；房主/房客各自存）——用于核对 "rejoin 是不是本人"。 */
const roomKeyName = (kind: 'host' | 'guest', roomId: string): string => `dust.${kind}Key.${roomId}`;
function readRoomKey(kind: 'host' | 'guest', roomId: string): string | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(roomKeyName(kind, roomId));
  } catch {
    return null;
  }
}
function writeRoomKey(kind: 'host' | 'guest', roomId: string, key: string): void {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(roomKeyName(kind, roomId), key);
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
  /** 传输是否**曾经**连上过（用于区分"首次连上"与"断线后重连成功"） */
  private everOpen = false;
  /** 重连后等快照的超时（5s 没响应 → 提示） */
  private rejoinTimer: ReturnType<typeof setTimeout> | null = null;

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
    // 传输状态（仅 WebSocketNet 有）：重连中提示；**重连成功且已在房内 → 自动 rejoin**（对端回快照）。
    net.onStatus?.((s) => {
      this.st.netStatus = s;
      if (s === 'open') {
        if (this.everOpen && this.st.roomId) this.sendRejoin();
        this.everOpen = true;
      }
      this.emit();
    });
    // ⚠️ **刷新/关页一律不发 `room:leave`**：刷新 = "掉线"，不是"退出"。
    //    掉线由**心跳超时**（≤12s）判定 → 对端显示「对方掉线，可等待重连…」；回来时走 `rejoin`+`snapshot`。
    //    只有**主动点「退出房间/对局」**才发 `room:leave`/`room:gone`（见 `leaveRoom`）。
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
    this.clearRejoinTimer();
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

  /** 座位数（**观众不占座**）——`filled` / 房间"已满"判定统一用它。 */
  private seatCount(): number {
    return this.st.members.filter((m) => m.role !== 'spectator').length;
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
    // 本房"房主身份 key"：写进 sessionStorage（房主刷新后仍能核对房客的 rejoin）
    writeRoomKey('host', id, onlineKey());
    saveRejoinRecord({ roomId: id, role: 'host' });
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
    this.net.send({
      t: 'room:join',
      from: this.net.peerId,
      roomId,
      name: this.st.name,
      role,
      version: APP_BUILD,
      key: onlineKey(),
    });
    this.startHeartbeat();
    saveSavedRoom({ roomId, role });
    saveRejoinRecord({ roomId, role });
    this.emit();
  }

  /** 从大厅「继续对局」进来：用**共享记录**（localStorage）回到上次那个房间（只认本机身份 key）。 */
  rejoinRoom(roomId: string): void {
    if (this.st.roomId) return;
    const rec = loadRejoinRecord();
    if (!rec || rec.roomId !== roomId) return;
    this.st.roomId = roomId;
    this.st.role = rec.role;
    this.st.myPlayer = rec.role === 'guest' ? 'B' : 'A';
    this.st.notice = null;
    this.st.peerLeft = false;
    this.startHeartbeat();
    saveSavedRoom({ roomId, role: rec.role });
    this.sendRejoin();
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
    this.sendRejoin();
    this.emit();
  }

  /** 发 `rejoin`（**自动重连**与"刷新后/新标签页重连"共用）：请房内对端回 `snapshot`。
   *  带上本机身份 key → 对端核对"是不是原来那位"（不在房里的陌生人拿不到局面）。
   *  5s 内没收到任何房内消息 → 一次提示（不重置对局，玩家仍可回大厅）。 */
  private sendRejoin(): void {
    if (!this.st.roomId || !this.st.role) return;
    this.clearRejoinTimer();
    this.net.send({
      t: 'rejoin',
      from: this.net.peerId,
      roomId: this.st.roomId,
      name: this.st.name,
      role: this.st.role,
      key: onlineKey(),
    });
    this.rejoinTimer = setTimeout(() => {
      this.rejoinTimer = null;
      this.st.notice = '重连成功，但对端没有响应（请确认对方还在页面里；必要时回大厅）';
      this.emit();
    }, 5000);
  }

  private clearRejoinTimer(): void {
    if (this.rejoinTimer != null) {
      clearTimeout(this.rejoinTimer);
      this.rejoinTimer = null;
    }
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
    clearRejoinRecord(id); // 主动离开 → 不再给「继续对局」
    this.resetRoom();
    this.emit();
  }

  chat(text: string): void {
    if (!this.st.roomId || !text.trim()) return;
    if (this.st.role === 'spectator') return; // 旁观**不能发言**（也免去"踢旁观者"的必要）
    const at = Date.now();
    this.net.send({ t: 'chat', from: this.net.peerId, roomId: this.st.roomId, name: this.st.name, text, at });
    // **自己发的这条永远不算未读**（未读＝"别人说的、我还没看"）。
    // ⚠️ 必须在 `pushChat`（内部会 emit）**之前**改读标，否则那一帧会先冒出一个红气球再等下次重绘才消失。
    this.chatReadCount = this.st.chat.length + 1;
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
    this.net.send({
      t: 'start',
      from: this.net.peerId,
      roomId: this.st.roomId,
      seed,
      setup,
      hostKey: onlineKey(), // 房客保存它 → 房主 rejoin 时核对"是不是本人"
    });
    this.emit();
  }

  /** 房主踢人（**座位随之空出**，别人可加入）。`ban`＝同时把对方加入**本机黑名单**。
   *  只有房主能调；没有访客时无效。 */
  kickGuest(ban = false): void {
    if (this.st.role !== 'host' || !this.myRoom || !this.st.roomId) return;
    const guest = this.st.members.find((m) => m.role !== 'host');
    if (!guest) return;
    const roomId = this.st.roomId;
    const gkey = readRoomKey('guest', roomId);
    if (ban && gkey) banAdd(gkey);
    this.net.send({ t: 'room:kick', from: this.net.peerId, roomId, target: guest.id });
    this.st.members = this.st.members.filter((m) => m.id !== guest.id);
    this.myRoom = { ...this.myRoom, guestName: null, filled: this.seatCount() };
    this.upsert(this.myRoom);
    // 清掉该房客的身份 key → ta 再回来只能当"新客"（若已被拉黑则直接被拒）
    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(roomKeyName('guest', roomId));
    } catch {
      /* ignore */
    }
    if (this.st.game) this.st.peerLeft = true; // 对局中踢人 → 按"对方已退出"处理（房主可回大厅重开）
    this.net.send({ t: 'presence', from: this.net.peerId, roomId, members: this.st.members });
    this.announce();
    this.emit();
  }

  /** 发一个动作：本地应用 + 广播（对方收到后同样应用 → 锁步） */
  dispatch(action: Action): void {
    if (!this.st.game || !this.st.roomId) return;
    if (this.st.role === 'spectator') return; // 旁观不能操作（双保险；UI 也已只读）
    applyAction(this.st.game, action);
    this.net.send({ t: 'action', from: this.net.peerId, roomId: this.st.roomId, action });
    // **真正开战**（离开"选战术/初始设置"）→ 房间公告 `inBattle`：大厅据此才提供「旁观」。
    if (this.myRoom && !this.myRoom.inBattle) {
      const ph = this.st.game.phase;
      if (ph !== 'setup' && ph !== 'tactics') {
        this.myRoom = { ...this.myRoom, inBattle: true };
        this.upsert(this.myRoom);
        this.announce();
      }
    }
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

  /** 「聊天已读」标记（**本机 UI 态**：不进 `st`、不广播、不参与快照）——聊天未读药丸用。
   *  放在 session 上（而不是某个界面外壳）→ **选择页 → 战斗界面换外壳时不会丢**。 */
  private chatReadCount = 0;

  /** 未读聊天条数（本机视角）。 */
  get unreadChat(): number {
    return Math.max(0, this.st.chat.length - this.chatReadCount);
  }

  /** 把当前全部聊天标记为已读（打开聊天浮层 / 战斗界面点聊天时调用）。 */
  markChatRead(): void {
    this.chatReadCount = this.st.chat.length;
  }

  private resetRoom(): void {
    this.clearRejoinTimer();
    this.st.roomId = null;
    this.st.role = null;
    this.st.config = null;
    this.st.members = [];
    this.st.chat = [];
    this.chatReadCount = 0;
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
  /** 我的**对手**（房主↔访客）的 peerId；观众 / 无对手 → null。
   *  心跳与"掉线"判定**只认它**——观众的消息/沉默都不得影响 A/B 的在线状态。 */
  private opponentId(): string | null {
    const want: Role | null =
      this.st.role === 'host' ? 'guest' : this.st.role === 'guest' ? 'host' : null;
    if (!want) return null;
    return this.st.members.find((m) => m.role === want)?.id ?? null;
  }

  private checkPeer(): void {
    if (!this.st.roomId) return;
    const hasPeer = this.opponentId() !== null;
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
    // 心跳：**只把"对手"的消息**算作"对手还活着"（观众的消息不算 → 观众断线不会误报对手掉线，
    //   反之也不会因观众一直 ping 而掩盖对手掉线）
    if (this.st.roomId && m.from === this.opponentId() && 'roomId' in m && m.roomId === this.st.roomId) {
      this.peerSeenAt = Date.now();
      this.clearRejoinTimer(); // 对方有响应了 → 不必再等快照超时
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
          clearRejoinRecord(m.roomId); // 房间没了 → 不再给「继续对局」
        }
        this.emit();
        break;
      case 'room:join':
        if (this.myRoom && m.roomId === this.myRoom.id) {
          // 锁步下版本不一致 = 必分叉 → 拒绝加入并告知（客户端另在大厅对"版本不同"的房间预先禁用加入）
          if (m.version !== APP_BUILD) {
            this.net.send({ t: 'room:denied', from: this.net.peerId, roomId: m.roomId, reason: 'version', target: m.from });
            break;
          }
          // **黑名单**（房主本机）：命中直接拒（软黑名单：清缓存/换浏览器可绕过，与星杯同款）
          if (banHas(m.key ?? '')) {
            this.net.send({ t: 'room:denied', from: this.net.peerId, roomId: m.roomId, reason: 'banned', target: m.from });
            break;
          }
          // ── 旁观：只有**已真正开战 + 允许旁观**才放行（**不占座、不需要身份 key、不看座位数**）
          if (m.role === 'spectator') {
            const ph = this.st.game?.phase;
            if (!this.myRoom.config.allowSpectators || !this.st.game || ph === 'setup' || ph === 'tactics') {
              this.net.send({ t: 'room:denied', from: this.net.peerId, roomId: m.roomId, reason: 'spectate', target: m.from });
              break;
            }
            this.st.members = [
              ...this.st.members.filter((x) => x.id !== m.from),
              { id: m.from, name: m.name, role: 'spectator' },
            ];
            // 系统聊天：告诉房里「XX 进来旁观」（灰色无发言人；新来的那位自己会跳过）
            const at = Date.now();
            this.net.send({
              t: 'chat',
              from: m.from,
              roomId: m.roomId,
              name: m.name,
              text: '进来旁观',
              at,
              sys: true,
            });
            this.pushChat({ peerId: m.from, name: m.name, text: '进来旁观', at, sys: true });
            this.net.send({ t: 'presence', from: this.net.peerId, roomId: m.roomId, members: this.st.members });
            this.announce();
            this.net.send({
              t: 'snapshot',
              from: this.net.peerId,
              roomId: m.roomId,
              game: this.st.game,
              members: this.st.members,
              config: this.myRoom.config,
              hostKey: onlineKey(),
            });
            this.emit();
            break;
          }
          const joinKey = m.key ?? '';
          const knownGuestKey = readRoomKey('guest', m.roomId);
          const seated = this.st.members.some((x) => x.role === m.role);
          // **对局中**（或该角色已在座＝刷新后 peerId 变了）→ 视为"回来"：按 role 替换/补入 + 发快照
          if (this.st.game || seated) {
            // **只认本人**：已有房客 key 且对不上 → 静默丢弃（不给局面、不占座）
            if (knownGuestKey && joinKey !== knownGuestKey) break;
            if (joinKey) writeRoomKey('guest', m.roomId, joinKey);
            this.st.members = seated
              ? this.st.members.map((x) => (x.role === m.role ? { id: m.from, name: m.name, role: m.role } : x))
              : [...this.st.members, { id: m.from, name: m.name, role: m.role }];
            const guest = this.st.members.find((x) => x.role === 'guest');
            this.myRoom = { ...this.myRoom, guestName: guest?.name ?? null, filled: this.seatCount() };
            this.upsert(this.myRoom);
            this.st.peerLeft = false;
            this.st.peerOnline = true;
            this.peerSeenAt = Date.now();
            this.net.send({ t: 'presence', from: this.net.peerId, roomId: m.roomId, members: this.st.members });
            this.announce();
            if (this.st.game) {
              this.net.send({
                t: 'snapshot',
                from: this.net.peerId,
                roomId: m.roomId,
                game: this.st.game,
                members: this.st.members,
                config: this.myRoom.config,
                hostKey: onlineKey(),
              });
            }
            this.emit();
            break;
          }
          if (this.seatCount() < this.myRoom.seats) {
            this.st.members = [...this.st.members, { id: m.from, name: m.name, role: m.role }];
            if (joinKey) writeRoomKey('guest', m.roomId, joinKey);
            this.myRoom = { ...this.myRoom, guestName: m.name, filled: this.seatCount() };
            this.upsert(this.myRoom);
            this.net.send({ t: 'presence', from: this.net.peerId, roomId: m.roomId, members: this.st.members });
            this.announce();
            this.emit();
          }
        }
        break;
      case 'room:denied':
        // ⚠️ 这是**房间级广播**（房里所有人都会收到）→ **必须先核对 `target`**：
        //    不是发给我的（如"旁观者被拒"、"版本不同的第三方被拒"）→ **完全忽略**，不动自己的房间/对局。
        if (mine(m.roomId) && m.from !== this.net.peerId && m.target === this.net.peerId) {
          // 被拒 → 先**告知中继**"我离开这个房间"（服务端据此解除房间映射，别一直记着我在房里）
          this.net.send({ t: 'room:leave', from: this.net.peerId, roomId: m.roomId });
          clearRejoinRecord(m.roomId);
          this.resetRoom();
          this.st.notice =
            m.reason === 'version'
              ? '房间版本不一致，无法加入——请刷新页面后重试'
              : m.reason === 'spectate'
                ? '现在不能旁观（未开局 / 还在选战术牌 / 房主关闭了旁观）'
                : '房主拒绝了你的加入（可能被拉黑）';
          this.emit();
        }
        break;
      case 'rejoin':
        // 房里**任何持有对局的端**都能回快照（不再只限房主）→ **房主刷新也能接回**
        if (this.st.roomId === m.roomId && this.st.game) {
          // **只认本人**：按 role 核对身份 key（任一未知＝首次，记下）；**旁观不需要 key**
          const key = m.key ?? '';
          if (m.role === 'host') {
            const hk = readRoomKey('host', m.roomId);
            if (hk && key !== hk) break;
          } else if (m.role !== 'spectator') {
            const gk = readRoomKey('guest', m.roomId);
            if (gk && key !== gk) break;
            if (key) writeRoomKey('guest', m.roomId, key);
          }
          // 重连成功 → **清掉"对方掉线/已退出"标记**（否则界面会一直停在"本局作废"）
          this.st.peerLeft = false;
          this.st.peerOnline = true;
          this.peerSeenAt = Date.now();
          if (this.myRoom) {
            // 房主：把重连方并回名单（以 role 为准，替换为新 peerId）
            const has = this.st.members.some((x) => x.role === m.role);
            this.st.members = has
              ? this.st.members.map((x) => (x.role === m.role ? { id: m.from, name: m.name, role: m.role } : x))
              : [...this.st.members, { id: m.from, name: m.name, role: m.role }];
            const guest = this.st.members.find((x) => x.role === 'guest');
            this.myRoom = { ...this.myRoom, guestName: guest?.name ?? null, filled: this.seatCount() };
            this.upsert(this.myRoom);
            this.announce();
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
              hostKey: onlineKey(),
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
          // 记下房主身份 key（房主 rejoin 时核对"是不是本人"）
          if (m.hostKey) writeRoomKey('host', m.roomId, m.hostKey);
          // **房主刷新后 `myRoom` 丢了** → 用快照里的 config/members 重建：
          //   否则之后不再应答 `room:join`、也不再 `room:announce`（房间会从大厅消失）。
          if (this.st.role === 'host' && !this.myRoom) {
            const guest = this.st.members.find((x) => x.role === 'guest');
            this.myRoom = {
              id: m.roomId,
              hostId: this.net.peerId,
              hostName: this.st.name,
              guestName: guest?.name ?? null,
              config: m.config,
              seats: 2,
              filled: this.seatCount(),
              version: APP_BUILD,
              inBattle: true, // 有快照＝已在战斗
            };
            this.upsert(this.myRoom);
            this.announce();
          }
          // 收到快照＝已经接回对局 → 清掉自己的"对方掉线/已退出"标记
          this.st.peerLeft = false;
          this.st.peerOnline = true;
          this.peerSeenAt = Date.now();
          this.emit();
        }
        break;
      case 'room:kick':
        if (mine(m.roomId) && m.target === this.net.peerId) {
          // 被房主移出 → 告知中继离开、清掉"继续对局/本标签页"记录、回大厅
          this.net.send({ t: 'room:leave', from: this.net.peerId, roomId: m.roomId });
          clearSavedRoom();
          clearRejoinRecord(m.roomId);
          this.resetRoom();
          this.st.notice = '你已被房主移出房间';
          this.emit();
        }
        break;
      case 'room:leave':
        if (this.myRoom && m.roomId === this.myRoom.id) {
          // **按角色**处理：只有"访客（对手）"离开才算"对方退出"；
          //   观众离开/断线**绝不影响** A/B 的对局（不清 guestName、不置 peerLeft）。
          const left = this.st.members.find((x) => x.id === m.from);
          const wasGuest = left?.role === 'guest';
          this.st.members = this.st.members.filter((x) => x.id !== m.from);
          this.myRoom = {
            ...this.myRoom,
            guestName: wasGuest ? null : this.myRoom.guestName,
            filled: this.seatCount(),
          };
          this.upsert(this.myRoom);
          if (wasGuest && this.st.game) this.st.peerLeft = true;
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
          if (m.hostKey) writeRoomKey('host', m.roomId, m.hostKey); // 房主 rejoin 时核对
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
