import type { NetSession } from '../net/session';
import { banReset } from '../net/session';
import type { RoomConfig } from '../net/protocol';

/**
 * 选择页的「联机房间外壳」（第 3 批 · 3a）。
 *
 * 在**预设/构筑/轮选**的选择页顶栏挂一行联机控件：
 * `[退出房间] [「XX模式 · 联机」] …… [A：名 ●　B：名 ●] [聊天] [房间设置]`。
 *
 * 要点：
 * - 顶栏按钮行是**无状态**的，允许被选择页的 `render()` 反复重建；
 * - **聊天 / 房间设置两个浮层挂在 `document.body`**（不在被重绘的区域内）→ **聊天输入不丢**；
 * - 附加模组不在此显示（在「房间设置」只读里看）。
 */

export interface OnlineCtx {
  session: NetSession;
  /** 退出房间 → 回大厅 */
  onExit: () => void;
  /** 「对方掉线」弹框里"退回大厅"（缺省＝onExit；战斗界面由宿主持有退出逻辑） */
  onGiveUp?: () => void;
}

export interface OnlineShell {
  /** 往顶栏画一行联机控件（每次 render 可重复调用）；`opts.onStart`（房主）显示「开始游戏」 */
  bar: (top: HTMLElement, modeLabel: string, opts?: { onStart?: () => void; canStart?: boolean }) => void;
  /** 开/关聊天浮层（战斗界面用一个独立按钮调它） */
  toggleChat: () => void;
  /** 未读聊天条数（战斗界面的红色药丸读它） */
  unreadCount: () => number;
  /** 移除浮层（离开选择页时调用） */
  dispose: () => void;
}

const MODE_LABEL: Record<RoomConfig['mode'], string> = {
  draft: '轮选模式',
  preset: '预设模式',
  build: '构筑模式',
};
const FIRST_LABEL: Record<RoomConfig['first'], string> = {
  host: '房主先手',
  guest: '访客先手',
  random: '随机',
};

function el(tag: string, cls = ''): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
function btn(cls: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  return b;
}
function nameEl(
  side: 'A' | 'B',
  name: string | undefined,
  online: boolean,
  onClick?: () => void,
): HTMLElement {
  const w = el('span', `online-name player-${side}`);
  const s = el('span', 'online-name-side');
  s.textContent = `玩家${side}：`;
  const n = el('span', 'online-name-txt');
  n.textContent = name ?? (side === 'A' ? '房主' : '等待访客…');
  if (name) n.title = name;
  const dot = el('span', `online-dot${online ? ' online-dot--on' : ''}`);
  w.append(s, n, dot);
  if (onClick) {
    // 房主专用：点对方药丸 → 踢人（样式只加"可点"的视觉与键盘可达）
    w.classList.add('online-name--action');
    w.setAttribute('role', 'button');
    w.tabIndex = 0;
    w.title = `${name ?? '对方'} —— 点击可移出房间`;
    w.addEventListener('click', onClick);
    w.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    });
  }
  return w;
}

export function createOnlineShell(ctx: OnlineCtx, host: HTMLElement): OnlineShell {
  const { session } = ctx;

  // ── 聊天浮层（body，持久）──
  const chatPop = el('div', 'online-pop online-chat');
  chatPop.hidden = true;
  const chatTitle = el('div', 'online-pop-title');
  chatTitle.textContent = '聊天';
  const chatList = el('div', 'online-chat-list');
  const chatRow = el('div', 'online-chat-row');
  const chatInput = document.createElement('input');
  chatInput.className = 'online-chat-input';
  chatInput.placeholder = '说点什么…';
  chatInput.maxLength = 60;
  const chatSend = btn('online-btn online-btn--send', '发送');
  const doSend = (): void => {
    const t = chatInput.value.trim();
    if (t) {
      session.chat(t);
      chatInput.value = '';
    }
  };
  chatSend.addEventListener('click', doSend);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSend();
  });
  chatRow.append(chatInput, chatSend);
  // 旁观：只能看、不能发言（隐藏输入行，给一行说明）
  const chatViewNote = el('div', 'online-chat-hint');
  chatViewNote.textContent = '旁观中：只能看，不能发言';
  chatViewNote.hidden = true;
  chatPop.append(chatTitle, chatList, chatViewNote, chatRow);
  host.appendChild(chatPop);

  // ── 房间设置浮层（只读）──
  const setPop = el('div', 'online-pop online-settings');
  setPop.hidden = true;
  host.appendChild(setPop);

  /** 发言人属于哪一方（按当前名单反查：房主=A / 访客=B / 观众或未知=null）→ 聊天名字用**玩家色**。 */
  const sideOf = (peerId: string): 'A' | 'B' | null => {
    const m = session.state.members.find((x) => x.id === peerId);
    return m?.role === 'host' ? 'A' : m?.role === 'guest' ? 'B' : null;
  };

  const renderChat = (): void => {
    chatList.innerHTML = '';
    for (const c of session.state.chat) {
      // 与普通聊天**同格式**（名字 + 内容）；系统行只是名字用中性灰、**不染玩家色**
      const line = el('div', 'online-chat-line' + (c.sys ? ' online-chat-line--sys' : ''));
      const who = el('span', 'online-chat-who');
      if (c.sys) who.classList.add('online-chat-who--sys');
      else {
        const side = sideOf(c.peerId);
        if (side) who.classList.add(`player-${side}`);
      }
      who.textContent = c.name;
      const txt = el('span', 'online-chat-text');
      txt.textContent = c.text;
      line.append(who, txt);
      chatList.appendChild(line);
    }
    // 旁观：隐藏输入行、显示"只能看"说明
    const spectator = session.state.role === 'spectator';
    chatRow.hidden = spectator;
    chatViewNote.hidden = !spectator;
    // **微信式**：永远优先显示**最底下一条**（最新），看历史往上滚
    chatList.scrollTop = chatList.scrollHeight;
    // **浮层开着＝正在看** → 一律视为已读（自己发的、对方刚发的都不该冒红气球）。
    //   两个入口（选择页顶栏 / 战斗界面右槽）打开的是同一个浮层、走同一个 `renderChat` → 一处即覆盖两处。
    if (!chatPop.hidden) session.markChatRead();
  };

  // ── 未读药丸（红底白字）：选择界面顶栏「聊天」按钮上 ──
  //    只改**已存在**的徽标元素、**不触发整页重绘**（否则"来消息"会把已打开的技能弹窗关掉）。
  let chatBadge: HTMLElement | null = null;
  let prevUnread = 0;
  const refreshChatBadge = (): void => {
    const n = session.unreadChat;
    if (chatBadge) {
      chatBadge.hidden = n === 0;
      chatBadge.textContent = n > 9 ? '9+' : String(n);
      // 新消息到达 → 一次性 pop（不循环闪）
      if (n > 0 && n !== prevUnread) {
        chatBadge.classList.remove('chat-badge--pop');
        void chatBadge.offsetWidth; // 强制重排以重播动画
        chatBadge.classList.add('chat-badge--pop');
      }
    }
    prevUnread = n;
  };
  const renderSettings = (): void => {
    setPop.innerHTML = '';
    // ⚠️ 行草字体是"首页专用子集"，本句里的「设」不在子集 → 会逐字回退、整句混排 → 这一句改用 UI 字体
    //    （`.online-pop-title--ui`；「聊天」保持原样）
    const t = el('div', 'online-pop-title online-pop-title--ui');
    t.textContent = '房间设置';
    setPop.appendChild(t);
    const cfg = session.state.config;
    if (!cfg) return;
    const rows: Array<[string, string]> = [
      ['模式', MODE_LABEL[cfg.mode]],
      ['先手', FIRST_LABEL[cfg.first]],
      [
        '附加',
        `${cfg.mode === 'preset' ? (cfg.legend ? '传奇英雄' : '关闭') : cfg.alt ? '异相神器' : '关闭'}　${
          cfg.tactics ? '战术牌' : '战术牌关闭'
        }`,
      ],
      ['行动时间', `${cfg.turnSeconds} 秒`],
      ['旁观', cfg.allowSpectators ? '允许' : '禁止'],
      ['备注', cfg.note || '—'],
    ];
    for (const [k, v] of rows) {
      const r = el('div', 'online-set-row');
      const kk = el('span', 'online-set-k');
      kk.textContent = k;
      const vv = el('span', 'online-set-v');
      vv.textContent = v;
      r.append(kk, vv);
      setPop.appendChild(r);
    }
    // ── 本机 ──（黑名单只在房主本机；**不展示条目**，只提供"全部重置"）
    const local = el('div', 'online-set-local');
    local.textContent = '本机';
    setPop.appendChild(local);
    const banRow = el('div', 'online-set-row');
    const banK = el('span', 'online-set-k');
    banK.textContent = '黑名单';
    const banV = el('span', 'online-set-v online-set-v--end');
    const reset = btn('online-set-reset', '重置');
    banV.appendChild(reset);
    banRow.append(banK, banV);
    setPop.appendChild(banRow);
    const hint = el('div', 'online-set-hint');
    hint.textContent = '清除后，被拉黑的人可以重新加入；清缓存 / 换浏览器也会让黑名单失效。';
    setPop.appendChild(hint);
    reset.addEventListener('click', () => {
      if (reset.dataset.armed !== '1') {
        // 二次确认：第一次点只"上膛"，3 秒内再点一次才真的清空
        reset.dataset.armed = '1';
        reset.textContent = '再点一次';
        window.setTimeout(() => {
          if (reset.dataset.armed === '1') {
            reset.dataset.armed = '';
            reset.textContent = '重置';
          }
        }, 3000);
        return;
      }
      banReset();
      reset.dataset.armed = '';
      reset.textContent = '已清空';
      window.setTimeout(() => {
        reset.textContent = '重置';
      }, 1200);
    });
  };

  // ── 「对方掉线 / 对方退出」弹框（**共用样式**：选择页 / 战斗界面；由 session 状态驱动）──
  const dropOverlay = el('div', 'online-modal-overlay');
  dropOverlay.hidden = true;
  const dropModal = el('div', 'online-modal');
  const dropTitle = el('div', 'online-modal-title');
  const dropText = el('div', 'online-modal-text');
  const dropBtn = btn('online-modal-btn', '退回大厅');
  dropBtn.addEventListener('click', () => (ctx.onGiveUp ?? ctx.onExit)());
  dropModal.append(dropTitle, dropText, dropBtn);
  dropOverlay.appendChild(dropModal);
  host.appendChild(dropOverlay);
  // 对手"主动退出"（对局中）或"掉线"（有对端却超时）→ 弹框；房内只有我时不弹
  const renderDrop = (): void => {
    const s = session.state;
    // 自己这边**正在重连服务器**：别误报"对方掉线"（此时两边都互相听不到心跳）
    if (s.netStatus === 'reconnecting') {
      dropTitle.textContent = '正在重连服务器…';
      dropText.textContent = '网络中断，正在自动重连。请保持页面打开；连上后会自动回到原来的对局。';
      dropText.classList.remove('online-modal-text--warn');
      dropOverlay.hidden = false;
      return;
    }
    // 已不在任何房间（例如**被房主移出**）→ 明确提示并给"回大厅"
    if (!s.roomId) {
      dropTitle.textContent = '已离开房间';
      dropText.textContent = s.notice ?? '你已不在任何房间里。';
      dropText.classList.add('online-modal-text--warn');
      dropOverlay.hidden = false;
      return;
    }
    // `peerOnline` 已收窄为"**对手**可联系"（观众不算）→ 观众进出/断线不会弹这个框
    const dropped = !s.peerOnline;
    const off = s.peerLeft || dropped;
    if (off) {
      dropTitle.textContent = s.peerLeft ? '对方已退出对局' : '对方已掉线';
      dropText.textContent = s.peerLeft
        ? '对方已离开本局（本局作废）。可退回大厅。'
        : '可尝试等待对方重连…（等不及可退回大厅）';
      dropText.classList.add('online-modal-text--warn');
    }
    dropOverlay.hidden = !off;
  };

  const unsub = session.subscribe(() => {
    renderChat();
    renderSettings();
    renderDrop();
    refreshChatBadge();
  });
  renderChat();
  renderSettings();
  renderDrop();

  const toggle = (pop: HTMLElement): void => {
    const open = pop.hidden;
    chatPop.hidden = true;
    setPop.hidden = true;
    if (open) {
      pop.hidden = false;
      // 打开聊天＝已读；并**在显示之后**重绘一次（浮层 hidden 时 scrollHeight=0 → 贴底会失效）
      if (pop === chatPop) {
        session.markChatRead();
        renderChat();
        refreshChatBadge();
        chatInput.focus();
      }
    }
  };

  /** 房主踢人确认（选择页顶栏点「玩家B：xxx」药丸触发）。 */
  const openKickConfirm = (guest: { id: string; name: string }): void => {
    const overlay = el('div', 'online-modal-overlay');
    const modal = el('div', 'online-modal');
    const title = el('div', 'online-modal-title');
    title.textContent = `把 玩家B（${guest.name}）移出房间？`;
    const text = el('div', 'online-modal-text');
    text.textContent = '移出后座位会空出来，别人可以加入；"移出并拉黑"会让 ta 之后被本房主自动拒绝。';
    const foot = el('div', 'online-modal-foot');
    const close = (): void => overlay.remove();
    // 点遮罩空白＝取消（明确"怎么退出"）
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    const only = btn('online-modal-btn', '只移出');
    only.addEventListener('click', () => {
      close();
      session.kickGuest(false);
    });
    const ban = btn('online-modal-btn online-modal-btn--danger', '移出并拉黑');
    ban.addEventListener('click', () => {
      close();
      session.kickGuest(true);
    });
    const cancel = btn('online-modal-btn online-modal-btn--ghost', '取消');
    cancel.addEventListener('click', close);
    foot.append(only, ban, cancel);
    modal.append(title, text, foot);
    overlay.appendChild(modal);
    host.appendChild(overlay);
  };

  const bar = (top: HTMLElement, modeLabel: string, opts?: { onStart?: () => void; canStart?: boolean }): void => {
    top.classList.add('online-top');
    const back = btn('pick-back', '退出房间');
    back.addEventListener('click', () => {
      session.leaveRoom();
      ctx.onExit();
    });
    const ttl = el('span', 'pick-ttl');
    ttl.textContent = modeLabel;
    const st = el('span', 'pick-ttl-state');
    st.textContent = ' · 联机';
    ttl.appendChild(st);
    const names = el('span', 'online-names');
    const mem = session.state.members;
    const host = mem.find((m) => m.role === 'host');
    const guest = mem.find((m) => m.role === 'guest');
    // **房主**点对方药丸 → 踢人确认（只移出 / 移出并拉黑 / 取消）
    const canKick = session.state.role === 'host' && !!guest;
    names.append(
      nameEl('A', host?.name, !!host),
      nameEl('B', guest?.name, !!guest, canKick ? () => openKickConfirm(guest!) : undefined),
    );
    // 状态提示**常显两态**：访客未到＝琥珀「等待访客加入…」；已到＝亮绿「双方已到位…」（不消失）
    const wait = el('span', 'online-wait' + (guest ? ' online-wait--ready' : ''));
    wait.textContent = guest
      ? '双方已到位 · 可以开始选择'
      : '等待访客加入 · 双方到齐后即可开始选择';
    const chat = btn('pick-back online-btn online-chat-btn', '聊天');
    // 未读药丸：**始终创建**（0 时隐藏）→ 新消息来时只需改它，无需整页重绘
    chatBadge = el('span', 'chat-badge');
    chatBadge.hidden = true;
    chat.appendChild(chatBadge);
    refreshChatBadge();
    chat.addEventListener('click', () => toggle(chatPop));
    const set = btn('pick-back online-btn', '房间设置');
    set.addEventListener('click', () => toggle(setPop));
    top.append(back, ttl, wait, names, chat, set);
    // 房主：选择就绪后显示「开始游戏」（广播 start → 两端各自建局）
    if (opts?.onStart && session.state.role === 'host') {
      const start = btn('online-start', '开始游戏');
      start.disabled = !opts.canStart;
      start.addEventListener('click', () => {
        if (opts.canStart) opts.onStart!();
      });
      top.appendChild(start);
    }
  };

  return {
    bar,
    toggleChat: () => toggle(chatPop),
    unreadCount: () => session.unreadChat,
    dispose: () => {
      unsub();
      chatPop.remove();
      setPop.remove();
      dropOverlay.remove();
    },
  };
}
