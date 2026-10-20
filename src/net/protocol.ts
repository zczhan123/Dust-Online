import type { Action, GameState, PlayerId } from '../core/model/types';

/**
 * 联机 · 消息协议（传输层之上、与会话无关的"信封"）。
 *
 * 设计：**锁步（lockstep）**——两端各跑同一份确定性引擎；开局交换同一 `seed`，
 * 之后**只交换玩家动作**（`action`）。同种子 + 同动作序列 ⇒ 两端状态必然一致。
 *
 * 注意：**不依赖任何服务器**——消息只在场内各端之间转发（当前插头：内存 / 同机双标签）。
 */

/** 创建房间时定下的配置（大厅"创建房间"窗口用；与引擎的 `SetupOptions` 分开，后者在选择页之后才成型） */
export interface RoomConfig {
  /** 轮选 / 预设 / 构筑 */
  mode: 'draft' | 'preset' | 'build';
  /** 先手归属 */
  first: 'host' | 'guest' | 'random';
  /** 附加开关 */
  alt: boolean; // 允许异相神器
  legend: boolean; // 允许传奇英雄
  tactics: boolean; // 允许战术牌
  /** 行动时间（秒） */
  turnSeconds: number;
  allowSpectators: boolean;
  note: string;
}

/** 大厅房间列表的一项 */
export interface RoomInfo {
  id: string;
  hostId: string;
  hostName: string;
  guestName: string | null;
  config: RoomConfig;
  seats: number;
  filled: number;
  /** **已真正开战**（房主在离开"选战术/初始设置"阶段后置位）→ 大厅据此才提供「旁观」。
   *  未开始 / 还在选战术牌时**不提供旁观**（与星杯"`gameStarted && observe`"同构）。 */
  inBattle?: boolean;
  /** 房主的构建版本（锁步下两端必须同版本，否则会分叉）→ 版本不同的房间客户端应拒绝加入 */
  version: string;
}

export type Role = 'host' | 'guest' | 'spectator';

export interface Member {
  id: string;
  name: string;
  role: Role;
}

/** 开局参数（**不含 seed**；seed 由房主在 `start` 时产生并随消息下发） */
export interface StartSetup {
  firstPlayer: PlayerId;
  heroA?: [string, string, string];
  heroB?: [string, string, string];
  legendA?: string | null;
  legendB?: string | null;
  tactics?: boolean;
  tacticA?: string;
  tacticB?: string;
}

export type NetMessage =
  | { t: 'rooms:req'; from: string } // 上线问"有哪些房间"
  | { t: 'hello'; from: string; name: string } // 上线"报到"（在线名单用）
  | { t: 'hi'; from: string; name: string } // 应答"报到"
  | { t: 'room:announce'; from: string; room: RoomInfo } // 房主（新增/变更）公告房间
  | { t: 'room:gone'; from: string; roomId: string } // 房主关房
  | {
      /** 加入房间。`key`＝本机身份 key（localStorage 持久随机串；与星杯 `onlineKey` 同款）——
       *  房主用它做**黑名单**判定与"只认本人"的重连校验。 */
      t: 'room:join';
      from: string;
      roomId: string;
      name: string;
      role: Role;
      version: string;
      key?: string;
    }
  | { t: 'room:leave'; from: string; roomId: string }
  | {
      /** 拒绝加入：`version`＝构建版本不一致（必分叉）；`banned`＝命中房主本机黑名单；
       *  `spectate`＝现在不能旁观（未开局 / 还在选战术牌 / 房主关闭了旁观）。
       *  ⚠️ 这是**房间级广播**（房里所有人都会收到）→ **必须带 `target`（收件人 peerId）**，
       *  收件方才执行"离开+重置"；其他人忽略。（否则"别人被拒"会把来客也踢出房间。） */
      t: 'room:denied';
      from: string;
      roomId: string;
      reason: 'version' | 'banned' | 'spectate';
      target?: string;
    }
  | {
      /** 断线重连：重进方按持久化身份请求重回房间；房内有对局的一方回 `snapshot`。
       *  `key`＝本机身份 key（房主据此核对"是不是原来那位"）。 */
      t: 'rejoin';
      from: string;
      roomId: string;
      name: string;
      role: Role;
      key?: string;
    }
  | {
      /** 状态快照（断线重连用）：把完整对局（可 JSON 序列化）+ 名单 + 房间配置回发给重连方。
       *  `hostKey`：房主的身份 key（房客据此核对房主的 `rejoin` 是否为本人）。 */
      t: 'snapshot';
      from: string;
      roomId: string;
      game: GameState;
      members: Member[];
      config: RoomConfig;
      /** 聊天记录（重连/加入时补历史；接收端自己去重合并） */
      chat?: { peerId: string; name: string; text: string; at: number; sys?: boolean }[];
      /** 行动倒计时（重连时补；接收端**从当前时刻重新计时**，沿用总时长） */
      timer?: { side: 'A' | 'B'; startAt: number; ms: number } | null;
      hostKey?: string;
    }
  | { t: 'presence'; from: string; roomId: string; members: Member[] } // 房主广播在场名单
  | {
      /** 聊天。`sys: true`＝**系统行**（无发言人，如"「XX」进来旁观"）。 */
      t: 'chat';
      from: string;
      roomId: string;
      name: string;
      text: string;
      at: number;
      sys?: boolean;
    }
  | {
      /** 开局。`hostKey`：房主身份 key（房客保存，用于将来核对房主的 `rejoin`）。 */
      t: 'start';
      from: string;
      roomId: string;
      seed: number;
      setup: StartSetup;
      hostKey?: string;
    }
  | {
      /** 房主踢人（房间类消息）：`target`＝被踢成员的 peerId。被踢方回大厅；座位随之空出。 */
      t: 'room:kick';
      from: string;
      roomId: string;
      target: string;
    }
  | { t: 'action'; from: string; roomId: string; action: Action }
  | {
      /** 选择阶段同步：`merge`＝只同步"发送方那一侧"（预设/构筑各自选自己）；`whole`＝整份状态（轮选轮到谁谁选） */
      t: 'sel';
      from: string;
      roomId: string;
      mode: 'preset' | 'build' | 'draft';
      side: 'A' | 'B';
      kind: 'merge' | 'whole';
      data: unknown;
    }
  | {
      /** 行动倒计时：**操作方**广播"本段开始时刻 + 时长"（两端据此画同一条进度条；时钟不进引擎） */
      t: 'timer';
      from: string;
      roomId: string;
      side: 'A' | 'B';
      startAt: number;
      ms: number;
    }
  | {
      /** 心跳：在房内定期广播"我还活着"；对端据此判断在线/掉线（传输无关；服务器路线定后可扩展为真重连） */
      t: 'ping';
      from: string;
      roomId: string;
    }
  | {
      /** 心跳应答：收到 `ping` 即回 `pong`（"收到 ping 回 pong + 任何消息算存活"→ 容忍后台标签限流） */
      t: 'pong';
      from: string;
      roomId: string;
    };
