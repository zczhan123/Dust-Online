import type { NetSession } from '../net/session';
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
  guest: '来客先手',
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
function nameEl(side: 'A' | 'B', name: string | undefined, online: boolean): HTMLElement {
  const w = el('span', `online-name player-${side}`);
  const s = el('span', 'online-name-side');
  s.textContent = `玩家${side}：`;
  const n = el('span', 'online-name-txt');
  n.textContent = name ?? (side === 'A' ? '房主' : '等待来客…');
  if (name) n.title = name;
  const dot = el('span', `online-dot${online ? ' online-dot--on' : ''}`);
  w.append(s, n, dot);
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
  chatPop.append(chatTitle, chatList, chatRow);
  host.appendChild(chatPop);

  // ── 房间设置浮层（只读）──
  const setPop = el('div', 'online-pop online-settings');
  setPop.hidden = true;
  host.appendChild(setPop);

  const renderChat = (): void => {
    chatList.innerHTML = '';
    for (const c of session.state.chat) {
      const line = el('div', 'online-chat-line');
      const who = el('span', 'online-chat-who');
      who.textContent = c.name;
      const txt = el('span', 'online-chat-text');
      txt.textContent = c.text;
      line.append(who, txt);
      chatList.appendChild(line);
    }
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
    t.textContent = '房间设置（只读）';
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
    const dropped = s.members.length >= 2 && !s.peerOnline;
    const off = s.peerLeft || dropped;
    if (off) {
      dropTitle.textContent = s.peerLeft ? '对方已退出对局' : '对方已掉线';
      dropText.textContent = s.peerLeft
        ? '对方已离开本局（本局作废）。可退回大厅。'
        : '可尝试等待对方重连…（等不及可退回大厅）';
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
    names.append(nameEl('A', host?.name, !!host), nameEl('B', guest?.name, !!guest));
    // 状态提示**常显两态**：来客未到＝琥珀「等待来客加入…」；已到＝亮绿「双方已到位…」（不消失）
    const wait = el('span', 'online-wait' + (guest ? ' online-wait--ready' : ''));
    wait.textContent = guest
      ? '双方已到位 · 可以开始选择'
      : '等待来客加入 · 双方到齐后即可开始选择';
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
