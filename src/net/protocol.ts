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
  | { t: 'room:join'; from: string; roomId: string; name: string; role: Role; version: string }
  | { t: 'room:leave'; from: string; roomId: string }
  | { t: 'room:denied'; from: string; roomId: string; reason: 'version' } // 拒绝加入（当前仅：版本不一致）
  | {
      /** 断线重连：重进方按持久化身份请求重回房间；房内有对局的一方回 `snapshot` */
      t: 'rejoin';
      from: string;
      roomId: string;
      name: string;
      role: Role;
    }
  | {
      /** 状态快照（断线重连用）：把完整对局（可 JSON 序列化）+ 名单 + 房间配置回发给重连方 */
      t: 'snapshot';
      from: string;
      roomId: string;
      game: GameState;
      members: Member[];
      config: RoomConfig;
    }
  | { t: 'presence'; from: string; roomId: string; members: Member[] } // 房主广播在场名单
  | { t: 'chat'; from: string; roomId: string; name: string; text: string; at: number }
  | { t: 'start'; from: string; roomId: string; seed: number; setup: StartSetup }
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
