export type PlayerId = 'A' | 'B';
export type DiceKind = 'attack' | 'defense' | 'meditation';
export type Column = 1 | 2 | 3;
export type Phase =
  | 'setup'
  | 'tactics'
  | 'initialReroll'
  | 'refill'
  | 'reroll'
  | 'dustRise'
  | 'main'
  | 'end'
  | 'gameOver';

export interface Die {
  id: string;
  value: number; // 1..6
  kind: DiceKind;
}

export interface SlotSpec {
  kind: DiceKind;
}

export interface SlotFill {
  dieIds: string[];
  /** 该格用「视为」填补（单骰跨类型，需技能许可，如 025「奇袭」）：仅当类型不匹配时使用 */
  treated?: boolean;
}

export interface EffectiveDie {
  kind: DiceKind;
  value: number;
  /** real=区域真骰；converted=真实之剑置换；treated=奇袭视为；artifact=034 破障（神器上的骰当能力骰） */
  source: 'real' | 'converted' | 'treated' | 'artifact';
  realIds: string[];
}

export type Action =
  | { t: 'advance' }
  | { t: 'reroll'; dieIds: string[] }
  | { t: 'dustRise'; artifactId: string; side?: 'left' | 'right'; useSeal?: boolean; free?: boolean; costSlots?: SlotFill[]; /** L05 复仇之灵：强制额外尘起（不耗冥想骰/不占次数/不消耗 019 免费计数） */ fuchou?: boolean }
  | { t: 'attack'; costSlots: SlotFill[] }
  | { t: 'block'; costSlots?: SlotFill[] }
  | { t: 'caiyuliu'; to: 'defense' | 'meditation' | null }
  /** C01 特典·极之境·裁雨流：使用攻击骰造成伤害后，可将该攻击骰重掷并按新点数落区（可选） */
  | { t: 'c01Caiyuliu'; accept: boolean }
  | { t: 'fengmang'; accept: boolean; attackDieId?: string; meditationDieId?: string }
  | { t: 'guwangCharge'; dieId?: string }
  | { t: 'guwangCancel'; cancel: boolean; defenseDieId?: string; costSlots?: SlotFill[] }
  | { t: 'shenhongKill'; accept: boolean }
  /** A02 深红（异相）·哀悼：补充数量 ≤3 时，可造成 2 点真实伤害并弃置对方 1 个防御骰（由持有者选择） */
  | { t: 'aidao'; accept: boolean; defenseDieId?: string }
  | { t: 'dunwuHalve'; accept: boolean; meditationDieId?: string; costSlots?: SlotFill[] }
  | { t: 'dunwuPulse'; accept: boolean }
  | { t: 'leibaoReroll'; accept: boolean }
  | { t: 'dianxing'; accept?: false; dieIds?: string[] }
  | { t: 'leibao'; accept?: false; dieIds?: string[] }
  | { t: 'weimu'; accept: boolean; dieId?: string }
  | { t: 'zhihaiReroll'; dieIds: string[] }
  /** 019 尘哀·尘起：是否接受赠送的 1 次「无需冥想骰的额外尘起行动」 */
  | { t: 'chenaiFreeRise'; accept: boolean }
  /** L01 传奇面板·雨落狂流：计数达 3 → 选①弃置对方 1 骰（dieId）/②获随机骰并移入 kind 区域/不发动 */
  | { t: 'kongYuluo'; choice: 'discard' | 'gain' | 'decline'; dieId?: string; kind?: DiceKind }
  /** L02 传奇面板·暗夜凶神：通过「锋芒」取消对方防御骰后，可选使「不祥」计数 +1 */
  | { t: 'anyexiongshen'; accept: boolean }
  /** L03 传奇面板·拔城：启动「主宰」技能后，可选视为以 5 点攻击 1 次并切换「主宰」技能 */
  | { t: 'bacheng'; accept: boolean }
  /** L05 传奇面板·无法饶恕：可选弃置对方 1 个"点数＝该攻击点数"的防御骰（dieId）/不发动 */
  | { t: 'wufaraoshu'; choice: 'discard' | 'decline'; dieId?: string }
  /** L06 传奇面板·圆舞：强制把 1 个能力骰移动到另 1 个区域 */
  | { t: 'yuanwu'; dieId?: string; to?: DiceKind }
  /** L07 传奇面板·始祖兽魂：是否额外消耗 1 个冥想骰（改为把「兽魂」计数重设为 3） */
  | { t: 'shizushouhun'; accept: boolean; costSlots?: SlotFill[] }
  /** L08 传奇面板·只为赏金而来：不发动 / 选择启动哪个（`artifactId`+`side`；参数由该技能自己的选择器补全） */
  | { t: 'shangjin'; decline?: boolean; artifactId?: string; side?: 'left' | 'right' | 'only'; skillKey?: string }
  /** L10 传奇面板·涤罪大剑术：不发动 / 弃置对方 2 颗**种类不相同**的能力骰 */
  | { t: 'dizuidaijianshu'; accept?: false; dieIds?: string[] }
  /** L10 传奇面板·汝等罪人：不发动（正常回复）/ 发动（改为对对方造成等量真实伤害） */
  | { t: 'nudengzuiren'; accept: boolean }
  /** L12 传奇面板·闻我名者断恶行：不发动 / 弃置对方 1 个**攻击骰**（接受时必带 dieId） */
  | { t: 'duanexing'; accept: boolean; dieId?: string }
  /** 战术牌（战斗牌）抽 2 留 1：选择本张作为本场战术（id 必须属于当前选者抽到的 2 张） */
  | { t: 'tacticPick'; id: string }
  /** T01「谨慎」：逐颗指定初始能力骰点数（values.length＝意志） */
  | { t: 'tacticDice'; values: number[] }
  /** T02「先机」：指定一位玩家成为先手玩家（尘印归另一位） */
  | { t: 'tacticFirst'; who: PlayerId }
  /** T13「远见」：战斗开始时猜测"生命最先降为 20 点或以下"的玩家 */
  | { t: 'tacticGuess'; who: PlayerId }
  /** T10「迂回」：把 2 个 1 点能力骰放置到任意区域（areas 长度＝2，每颗一个区域） */
  | { t: 'yuhuiPlace'; areas: DiceKind[] }
  /** T15「影子」：第一个回合开始时，为自己战术上的存放骰选定 1 个点数（1–6） */
  | { t: 'yingziPick'; value: number }
  /** T13「远见」·奖励：猜测正确时获得 1 个任意点数能力骰并放入任意区域 */
  | { t: 'yuanjianGain'; value: number; area: DiceKind }
  /** T17「诱敌」：把来源区域的最多 3 颗能力骰移到目标区域（保留点数）；`cancel`＝不发动 */
  | { t: 'youdiMove'; cancel?: boolean; from?: DiceKind; to?: DiceKind; dieIds?: string[] }
  /** T18「适应」：把本次掷出/获得的其中 1 颗骰改为任意点数；`cancel`＝不发动 */
  | { t: 'shipeiPick'; cancel?: boolean; dieId?: string; value?: number }
  /** T09「慈悲」：将造成的伤害 → 取消并回复等量生命（accept=true）／照常造成（accept=false） */
  | { t: 'ciBei'; accept: boolean }
  /** 022 死契·处刑通牒：使用攻击骰前的强制决定（不发动 / ①伤害+1且不可抵挡 / ②伤害+5） */
  | { t: 'chuxingPick'; pick: 'none' | 'unblockable' | 'bonus5' }
  /** 023 蛇蝎·畏惧：对方被迫消耗他选择的那颗能力骰（可用 010 置换：costSlots 2 颗顶 1） */
  | { t: 'weijuPay'; dieId?: string; costSlots?: SlotFill[] }
  /** 023 蛇蝎·共振：选择 ①双方各得 2 颗 / ②双方各弃置 2 颗（弃置由发起者指定） */
  | { t: 'gongzhenResolve'; pick: 'gain' | 'discard'; myIds?: string[]; oppIds?: string[] }
  /** 挑战模式·代决：挑战者替「昔日传奇」做的选择（模式 1）。`id` ∈ 该待决策 options 的 id */
  | { t: 'challengePick'; id: string }
  /** 挑战模式·推进：让「昔日传奇」往下结算**一条**技能（界面按节奏自动派发，实现"逐条可见"） */
  | { t: 'challengeStep' }
  /** 020 兽魂：攻击方选择是否取消本次伤害（取消则令持有者计数 −1） */
  | { t: 'shouhunCancel'; cancel: boolean }
  /** 026 哀歌·威压：使用能力骰后，令自己或对方的 1 颗能力骰点数变为固定值（保留区域）；dieId 省略 = 不发动 */
  | { t: 'weiyaPick'; owner: 'self' | 'opp'; dieId?: string }
  /** 026 哀歌·陷阵：生命最少的一方选择弃置持有者的 1 颗能力骰 */
  | { t: 'xianzhenResolve'; dieId: string }
  /** 025 屠虎·横贯（触发）：被抵挡后可弃置对方 1 颗点数小于该攻击的能力骰；dieId 省略 = 不发动 */
  | { t: 'hengguan'; dieId?: string }
  /** 027 寒光·必杀：使用攻击骰前的二选一（① 把神器上的骰移入对应区域 / ② 移除它并弃置对方同点数骰） */
  | { t: 'hanguangPick'; pick: 'move' | 'discard'; dieId: string; targetDieId?: string }
  /** 029 真言·全知：把全部能力骰分配到三区（dieId → 目标类型） */
  | { t: 'quanzhiAssign'; assign: Record<string, DiceKind> }
  /** 032 梦魇·低语：宣称 1 个能力骰类型 */
  | { t: 'kuyuResolve'; area: DiceKind }
  /** 033 凋零·死亡亦逝：择①全相同/②全不同，并弃置所选骰 */
  | { t: 'tiaolingResolve'; pick: 'same' | 'diff'; dieIds: string[] }
  /** 结束阶段：弃置指定的 N 颗能力骰（超出意志上限），N = 当前超出数 */
  | { t: 'endDiscardResolve'; dieIds: string[] }
  /** 035 千劫·万丈明光：主要阶段开始时，弃置 2 个能力骰 */
  | { t: 'wanzhangDiscard'; dieIds: string[] }
  /** 034 金刚·不动菩提：是否移除神器上同点数骰以取消其效果 */
  | { t: 'putiResolve'; accept: boolean }
  | { t: 'skill'; artifactId: string; side: 'left' | 'right' | 'only'; params?: Record<string, unknown> };

/** 挑战模式"因多组触发的攻击"的表现层提示：`index/total`＝组序号/组数；`sub/subTotal`＝组内第几段（可选）。 */
export interface LegendGroup {
  index: number;
  total: number;
  sub?: number;
  subTotal?: number;
}

export interface PendingAttack {
  attacker: PlayerId;
  value: number;
  unblockable: boolean;
  physical: boolean;
  sourceDieId?: string;
  sourceValue?: number;
  /** 攻击的有效点数（物理=骰点；技能发起的攻击=该技能指定的点数）。供 017 持续判定，不受伤害加成影响 */
  baseValue?: number;
  /** **改判前**的点数（原始骰点 / 技能指定点数；含置换的合成 5）——与 `baseValue` 不等时说明被 028「视为6」/ L06 ±1 改过，供提示/战报写明"X 点骰子被「技能」改为 Y 点"。 */
  rawPoint?: number;
  /** 本次伤害是否已被「减半」（同种削减不叠加：屏障 / 021 满计数 / 023 畏惧 只减半一次） */
  halved?: boolean;
  /** 本次攻击实际应用的伤害加成值（含 022 处刑通牒这类单次修正），供提示栏显示 */
  bonusValue?: number;
  /** 上述加成的来源名（如「处刑通牒」） */
  bonusLabel?: string;
  /** 减半来源名（如「畏惧」），供提示栏显示 */
  halveReason?: string;
  /** 028 天罚：本次攻击对方**只能用该类型**的骰抵挡（'meditation'=白昼之火 / 'attack'=陨落）；未设 = 正常防御骰 */
  blockKind?: DiceKind;
  /** 技能发起的攻击：来源技能名（如「不败之王」），供提示栏显示"该技能引起的攻击" */
  sourceSkill?: string;
  /** 上述技能的效果**拥有者**：与其等于 `attacker` → 持有者自己发起；不等 → 他人因该效果发起（提示栏区分措辞） */
  sourceSkillOwner?: PlayerId;
  /**
   * **表现层**提示（不影响任何规则）：本次攻击的骰子该画成什么样。
   * `'solid'`＝实体色骰（例：挑战模式「枭首」用攻击骰区里的真骰逐颗发起攻击）；未设＝按 `physical` 判定（虚拟攻击＝灰骰）。
   */
  dieStyle?: 'solid';
  /**
   * **表现层**提示（不影响任何规则）：挑战模式**因"多组"触发的攻击**的**组序号/组数**（1 基）。
   * 供提示栏显示「（第 K / N 组）」。若一组含多段攻击（数罪并罚=2 段 / 电刑=3 段），
   * 再用 `sub`/`subTotal` 标"本组第 j / m 次"→「（第 K / N 组 · 本组第 j / m 次）」。
   * 例：遁入暗影（每组 1 段，不带 `sub`）。
   */
  legendGroup?: LegendGroup;
}

export type Pending =
  | { kind: 'caiyuliu'; player: PlayerId; dieId: string; value: number }
  /** C01 特典·极之境·裁雨流（触发）：使用攻击骰造成伤害后，由攻击方决定是否重掷该骰并按新点数落区 */
  | { kind: 'c01Caiyuliu'; player: PlayerId; dieId: string }
  | { kind: 'fengmang'; player: PlayerId; defenderId: PlayerId; value: number }
  | { kind: 'guwangCharge'; player: PlayerId }
  | { kind: 'guwangCancel'; player: PlayerId; amount: number }
  | { kind: 'shenhongKill'; player: PlayerId }
  /** A02 深红（异相）·哀悼（触发）：补充阶段实际补充数量 ≤3 时，由**持有者本人**决定是否发动 */
  | { kind: 'aidao'; player: PlayerId }
  | { kind: 'dunwuHalve'; player: PlayerId }
  | { kind: 'dunwuPulse'; player: PlayerId; amount: number }
  | { kind: 'leibaoReroll'; player: PlayerId }
  | { kind: 'dianxing'; player: PlayerId; values?: number[] }
  | { kind: 'leibao'; player: PlayerId }
  /** 「激活」类技能：尘起装填到该侧后立即强制结算（待玩家选完） */
  | { kind: 'activationResolve'; player: PlayerId; artifactId: string; side: 'left' | 'right' | 'only' }
  /** 017 帷幕：对方重掷阶段结束时，可受 2 真实伤害并弃置对方 1 个能力骰 */
  | { kind: 'weimu'; player: PlayerId }
  /** 018 漆黑绽放·必杀：获得 X 骰后，可选重掷最多 X 颗 */
  | { kind: 'zhihaiReroll'; player: PlayerId; x: number; forced: boolean }
  /** 019 尘哀·尘起：自己回合造成伤害后可立即进行 1 次「无需冥想骰」的额外尘起行动（每回合 1 次） */
  | { kind: 'chenaiFreeRise'; player: PlayerId }
  /** 020 兽魂：攻击方选择「取消本次伤害（持有者计数 −1）」还是「正常造成伤害」 */
  | { kind: 'shouhunCancel'; player: PlayerId; owner: PlayerId; attack: PendingAttack; minCount: number }
  /** 022 死契·处刑通牒：使用攻击骰前必须先决定是否扣计数（FAQ 22.2.1） */
  | { kind: 'sijiChuxing'; player: PlayerId; costSlots: SlotFill[] }
  /** 023 蛇蝎·畏惧：对方必须消耗 1 颗能力骰（由对方选择） */
  | { kind: 'weijuPay'; player: PlayerId; initiator: PlayerId; initiatorValue: number }
  /** 023 蛇蝎·共振：重掷并落区后，按落区类型二选一 */
  | { kind: 'gongzhenPick'; player: PlayerId; areaKind: DiceKind }
  /** 挑战模式·代决（模式 1）：把「昔日传奇」本该自己做的抉择交给挑战者；`options` 为候选。 */
  | {
      kind: 'challengePick';
      player: PlayerId;
      prompt: string;
      options: { id: string; label: string }[];
      /** Z04「D1：开局选骰」＝'assign'（选完存 `challenge.assign`，而非按技能的 `decisions`） */
      tag?: string;
      /** 选择存进 `challenge.decisions` 的键；缺省＝当前结算技能的 id。
       *  同一条技能有多个代决时（Z07 蛮王之牙/不屈咆哮：选组 + 弃骰）用它区分，避免互相覆盖。 */
      key?: string;
      /** **骰片选择**（"从池子里选 n 颗"类代决）：界面用 `pool` 渲染骰片、选满 `n` 颗拼成逗号 id 提交。
       *  缺省＝按 `options` 渲染选项列表。`pool[].kind` 供骰片显示「防N/攻N/冥N」。
       *  ⚠️ `pool[].id` 必须与 `options[].id` 里的**组成片段一致**（这样"点击顺序"任意、按集合即可对上选项）。
       *  `owner` ＝ **这些骰子归谁**（缺省＝`pending.player`，即"谁在代决"）——**骰片按它上色**（A 蓝 / B 红）。
       *  ⚠️ 挑战者代决"移动**传奇自己**的骰"（遁入/龙腾/净化/尘起）时必须传 `'B'`，否则骰片会错画成蓝的。 */
      pick?: { pool: { id: string; value: number; kind: DiceKind }[]; n: number; owner?: PlayerId };
    }
  /** 第三列「充能」技能需要玩家选择（024 狂舞）时，装填后强制结算 */
  | { kind: 'chargeResolve'; player: PlayerId; artifactId: string }
  /** 026 哀歌·威压：某人「使用 1 个任意能力骰后」，威压持有者可令 1 颗能力骰点数变为固定值（FAQ 26.2.1：先于该骰的基础效果结算） */
  | { kind: 'weiyaPick'; player: PlayerId; value: number; reason: 'attack' | 'defense' | 'dustRise' | 'skill' }
  /** 026 哀歌·陷阵：持有者的重掷阶段结束时，由生命最少的一方（并列 = 当前回合玩家）弃置持有者 1 颗能力骰 */
  | { kind: 'xianzhenPick'; player: PlayerId; owner: PlayerId }
  /** 025 屠虎·横贯（触发）：攻击被抵挡后，攻击者可弃置对方 1 颗点数小于该攻击的能力骰 */
  | { kind: 'hengguan'; player: PlayerId; value: number }
  /** 027 寒光·必杀：使用攻击骰前，必须先决定是否使用神器上的骰子（暂存本次攻击的支付） */
  | { kind: 'hanguangPick'; player: PlayerId; costSlots: SlotFill[] }
  /** 029 真言·全知（持续）：补充阶段与重掷阶段落区后，由玩家把**全部能力骰**自行分配到 防御(同点成对)/攻击(顺点三连)/冥想(其余) */
  | { kind: 'quanzhiAssign'; player: PlayerId }
  /** 032 梦魇·低语（持续）：持有者**主要阶段结束时**，宣称 1 个能力骰类型（获得 1 随机骰并移入该区） */
  | { kind: 'kuyu'; player: PlayerId }
  /** 033 凋零·死亡亦逝（持续）：某玩家**回合结束时**，亲自择①全相同/②全不同并弃自己的能力骰 */
  | { kind: 'tiaolingPick'; player: PlayerId }
  /** 结束阶段：能力骰总数超过「意志」上限时，由**当前回合玩家自行选择**弃置哪几颗（说明书 page_09） */
  | { kind: 'endDiscard'; player: PlayerId }
  /** 035 千劫·万丈明光（持续）：持有者**主要阶段开始时**，弃置 2 个能力骰 */
  | { kind: 'wanzhangDiscard'; player: PlayerId }
  /** 034 金刚·不动菩提（触发）：对方使用防御/攻击骰后，持有者可移除神器上同点数骰，取消其效果 */
  | { kind: 'putiPick'; player: PlayerId; owner: PlayerId; value: number; mode: 'block' | 'attack'; attack?: PendingAttack }
  /** L01 传奇面板·雨落狂流：面板计数达到 3 → 重设为 0，由持有者选择①弃置对方 1 个能力骰 /②获得 1 个随机点数能力骰并移入任意区域 /不发动 */
  | { kind: 'kongYuluo'; player: PlayerId }
  /** L02 传奇面板·暗夜凶神（触发）：通过「锋芒」取消对方防御骰后，由持有者决定是否使「不祥」计数 +1 */
  | { kind: 'anyexiongshen'; player: PlayerId }
  /** L03 传奇面板·拔城（触发）：启动「主宰」技能后，由持有者决定是否视为以 5 点攻击 1 次并切换「主宰」技能 */
  | { kind: 'bacheng'; player: PlayerId }
  /** L05 传奇面板·复仇之灵（持续）：生命十位数变化 → **强制立即**进行 1 次无需冥想骰的额外尘起行动 */
  | { kind: 'fuchouRise'; player: PlayerId }
  /** L05 传奇面板·无法饶恕（触发）：攻击造成伤害后，可选弃置对方 1 个点数＝该攻击点数的防御骰 */
  | { kind: 'wufaraoshu'; player: PlayerId; value: number }
  /** L06 传奇面板·圆舞（持续）：**受到自己造成的伤害**后 → 强制将 1 个能力骰移动到另 1 个区域 */
  | { kind: 'yuanwu'; player: PlayerId }
  /** L07 传奇面板·始祖兽魂（触发）：激活「兽魂」（计数重设为 2）后，由持有者决定是否**额外消耗 1 个冥想骰**改为把计数重设为 3 */
  | { kind: 'shizushouhun'; player: PlayerId; artifactId: string }
  /** L08 传奇面板·只为赏金而来（触发）：触发「处刑通牒」后，由持有者选择启动 1 个"已激活的启动式"技能（不计入每回合上限） */
  | { kind: 'shangjin'; player: PlayerId }
  /** L10 传奇面板·涤罪大剑术（触发）：进行 1 次尘起行动后（第一/二列标记同侧），由持有者决定是否弃置对方 2 颗种类不同的能力骰 */
  | { kind: 'dizuidaijianshu'; player: PlayerId }
  /** L10 传奇面板·汝等罪人（触发）：将要回复生命时，由持有者决定是否改为对对方造成等量真实伤害（`amount`＝实际回复量） */
  | { kind: 'nudengzuiren'; player: PlayerId; amount: number }
  /** L12 传奇面板·闻我名者断恶行：受到伤害后，可弃置对方 1 个攻击骰（每回合最多 1 次） */
  | { kind: 'duanexing'; player: PlayerId }
  /** T01「谨慎」：逐颗指定初始能力骰点数（战前） */
  | { kind: 'tacticDice'; player: PlayerId }
  /** T02「先机」：指定一位玩家成为先手（战前；尘印归另一位） */
  | { kind: 'tacticFirst'; player: PlayerId }
  /** T13「远见」：战斗开始时，猜测"生命最先降为 20 点或以下"的玩家（战前） */
  | { kind: 'tacticGuess'; player: PlayerId }
  /** T10「迂回」：获得 2 个 1 点能力骰，由玩家放置到任意区域 */
  | { kind: 'yuhuiPlace'; player: PlayerId }
  /** T15「影子」：第一个回合开始时，为存放骰选定点数（1–6） */
  | { kind: 'yingziPick'; player: PlayerId }
  /** T13「远见」·奖励：猜测正确时获得 1 个任意点数能力骰并放入任意区域（一次） */
  | { kind: 'yuanjianGain'; player: PlayerId }
  /** T17「诱敌」：受到对方伤害后，可把某区域最多 3 颗骰移到另一区域（整局 1 次） */
  | { kind: 'youdiMove'; player: PlayerId }
  /** T18「适应」：把本次掷出/获得的其中 1 颗骰改为任意点数（整局 1 次） */
  | { kind: 'shipeiPick'; player: PlayerId; dieIds: string[]; replaceByDist: boolean }
  /** T09「慈悲」：将造成的那次伤害可由造成者选择"取消并回复等量生命"（整局 1 次） */
  | {
      kind: 'ciBei';
      player: PlayerId;
      target: PlayerId;
      amount: number;
      /** 攻击伤害时携带（解决后走 `settleAttack`）；真实伤害时为 undefined */
      attack?: PendingAttack;
      /** 攻击是否被抵挡（用于解决后的「被抵挡后」判定） */
      blocked?: boolean;
      blockedForTriggers?: boolean;
    };

export interface Distribution {
  defense: number[];
  attack: number[];
  meditation: number[];
}

export interface Buff {
  attr: 'speed' | 'will' | 'attackDamage';
  add: number;
  duration: 'thisTurn' | 'permanent';
  /** 显示用来源（技能名），仅用于文案；未填则文案只显示数值 */
  source?: string;
}

export interface SkillDef {
  side: 'left' | 'right' | 'only';
  /** continuous=持续 trigger=触发 activate=启动 charge=充能 ultimate=必杀 activation=激活（装填到该侧即立即强制结算） */
  kind: 'activate' | 'activation' | 'continuous' | 'charge' | 'ultimate' | 'trigger';
  key: string;
  /** 启动后刷新自身「每回合一次」计数（019 蛮王之牙） */
  refresh?: boolean;
  /** 该「充能」技能需要玩家选择（024 狂舞）：充能后弹出强制选择器，而不是自动结算 */
  needsChoice?: boolean;
  /** 卡面固定数值（如 026「威压」把点数变为 4、027 等）：供处理器/待决策读取，避免硬编码 */
  value?: number;
}

export interface Artifact {
  id: string;      // '001'
  name: string;    // '雨切'
  weapon?: string; // '武士刀'（武器类型，用于显示）
  column: Column;
  speed?: number;
  will?: number;
  distribution?: Distribution;
  life?: number;
  chargeReq?: number;
  activeMarkerSide: 'left' | 'right' | null;
  /** 本回合被“激活/切入”的侧（供「激活」类技能判定：只在切入当回合可用） */
  armedSide: 'left' | 'right' | null;
  /** 执行上述切入时的回合号（与 GameState.turnIndex 比较） */
  armedTurn: number;
  count: number;
  /** 本神器计数的上限（卡面 `计数 N/上限` 与续充判定用；未填 = 不显示上限） */
  countCap?: number;
  /** 第三列神器：完成充能（已激活）后仍可被尘起选中继续充能（021 决意「续充」） */
  chargeExtend?: boolean;
  chargeLayer: number;
  /** 「在接下来的游戏中，本神器失去持续式效果」（018 必杀等） */
  continuousLost?: boolean;
  /** A07 异相·完杀必杀：「直到本回合结束前，双方所有持续式效果失效」——本回合临时失效（回合开始时清除，区别于永久的 `continuousLost`） */
  continuousLostThisTurn?: boolean;
  /** L09 传奇面板·遍野残杀：本回合该神器的**左右两侧技能全部视为处于激活状态**（回合开始时清除；持有者回合结束时死亡） */
  allSidesActiveThisTurn?: boolean;
  /** 特典神器（如 C01）：不能在正式比赛中使用 */
  special?: boolean;
  /** 置于本神器上的骰子（027 寒光·必杀：1–6 点各 1 颗；回合结束时清空）。这些骰不在任何区域，落区时按点数决定类型 */
  heldDice?: { id: string; value: number }[];
  skills: SkillDef[];
}

/** 传奇英雄面板（仅预设模式·带传奇）：与英雄一一绑定，≈"第 4 件神器"；技能开局即可用（无需激活）。 */
export interface LegendPanel {
  id: string; // 'L01'
  heroKey: string; // 绑定的英雄 key
  name: string; // 英雄显示名（如「雨中剑圣 空」）
  /** 面板计数（部分面板有；默认 0） */
  count: number;
  /** 计数上限（部分面板有） */
  countCap?: number;
  /** 「在接下来的游戏中，本面板失去持续式效果」（同 Artifact 语义） */
  continuousLost?: boolean;
  /** A07 异相·完杀必杀等：本回合临时失效 */
  continuousLostThisTurn?: boolean;
  skills: SkillDef[];
}

export interface PlayerState {
  id: PlayerId;
  areas: Record<DiceKind, Die[]>;
  artifacts: Artifact[];
  /** 传奇英雄面板（仅预设模式·带传奇时存在，否则为 undefined） */
  legend?: LegendPanel | null;
  life: number;
  lifeMax: number;
  markers: number;
  hasDustSeal: boolean;
  buffs: Buff[];
  /** 本回合是否已受过伤害（018 至黑：每回合第一次受伤才计数） */
  damagedThisTurn: boolean;
  /** 023 蛇蝎·畏惧：该玩家「下个回合」中攻击造成的伤害减半（其回合结束时清除） */
  attackHalvedNextTurn: boolean;
  /** L01 断苇一斩：本回合（我方回合）是否造成过任何伤害（回合开始时重置） */
  dealtDamageThisTurn: boolean;
  /** L01 断苇一斩：我方「上一个回合」整个回合都没有造成伤害（回合开始时据上值判定） */
  noDamageLastTurn: boolean;
  /** L05 复仇之灵：生命「十位数」上次的值（生命变化时比对以判定是否触发） */
  lifeTens: number;
  /** L06 无光领域：你的攻击点数视为 ±1（持续到下次启动；未设=null） */
  wuguang?: 'up' | 'down' | null;
  /** L08 蛇蝎之泪：本回合内由「填弹」**实际叠加**的计数累计（回合开始清零；X 取其平方） */
  tiandanGainedThisTurn: number;
  /** 该玩家**自己的**回合计数（回合开始 +1，封顶 4；L04 重开清零）——供 T05「前 3 个回合」判定 */
  turnsTaken: number;
  /** 战术牌「整局最多 1 次」类的标记（T07 保守 / T09 慈悲；L04 重开清零） */
  tacticOnceUsed: boolean;
  /** 战术牌上存放的骰（T15 影子：置于本战术上；使用同点数骰后移入对应区域） */
  tacticHeldDie: { id: string; value: number } | null;
  /** T13「远见」：战斗开始时猜测"生命最先降为 20 点或以下"的玩家（未猜/非本牌=null） */
  tacticGuess: PlayerId | null;
  /** 战术牌（战斗牌）：本场选定的 1 张 id（战前抽 2 留 1 / 构筑·挑战直接选）；未选=null */
  tactic?: string | null;
}

export interface LogEntry {
  turn: number;
  phase: Phase;
  text: string;
}

export interface GameState {
  players: Record<PlayerId, PlayerState>;
  activePlayer: PlayerId;
  firstPlayer: PlayerId;
  initialRerollQueue: PlayerId[];
  phase: Phase;
  /** 对局形态：标准（含左右互搏/联机）｜单人挑战（对手＝挑战卡自动机） */
  mode: 'standard' | 'challenge';
  /** 单人挑战：传奇运行时（仅 `mode==='challenge'` 时存在） */
  challenge?: {
    cardId: string;
    count: number;
    /** 临时驱动骰区域：回合开始投出的骰子（＝技能列最下方那一条）；某条技能发动时从这里取骰 */
    driven: Die[];
    /** 驱动骰槽：当前结算的那条技能**临时**占用的驱动骰（面板第三区）；结算完清空或移入区域 */
    slot: Die[];
    turn: number;
    resumeAt?: number | null;
    /** 正在结算的技能下标（界面高亮"正在结算"用）；不在回合内为 null */
    activeSkill?: number | null;
    /** 代决（模式 1）：已收集的选择，按技能 id 存（值＝所选 option 的 id） */
    decisions?: Record<string, string[]>;
    /**
     * 代决期间**已扣下**的驱动骰（发起技能时先扣骰、再问代决 → 选完进同一条技能时不再重复扣）。
     * 存在时表示"这条技能正在等代决"。
     */
    pendingConsumed?: { id: string; value: number }[];
    /** 已扣骰、正在等代决的那条技能 id */
    pendingSkillId?: string;
    /**
     * **结算模式**（选择界面定）：
     * - `'manual'`：替昔传的每个抉择**弹面板由挑战者点**（模式 1，默认）；
     * - `'favor'`：自动结算，规则偏向**挑战者**（昔传"放水"，模式 2）；
     * - `'against'`：自动结算，规则偏向**昔传**（昔传"最优"，模式 3）。
     * 只影响"替昔传做的决定"，挑战者自己的回合始终手动。
     */
    settleMode?: 'manual' | 'favor' | 'against';
    /** Z01「裁雨流」：本轮"用攻击骰逐个攻击"中，**已造成伤害**的次数（前 3 次 → 该攻击骰移入防御骰区） */
    caiyuliuHits?: number;
    /** Z03「拔城」：**本传奇回合内**已"发动"过的技能 id（每回合清；用于"既没发动 X 也没发动 Y"判定） */
    firedThisTurn?: string[];
    /** Z05「绝境天神」：「**上个挑战者的回合**」里，传奇（B）是否受到过伤害 → 本回合额外投 2 个驱动骰。
     *  在 `noteLifeDrop` 里置位（A 的回合、受伤者为 B）；`runLegendTurn` 读取后清零。 */
    damagedDuringChallengerTurn?: boolean;
    /** Z06「漆黑死神」黑白指示物当前面（战斗开始＝`'black'`；传奇回合结束翻面）。技能按 `color` 决定是否发动 */
    token?: 'black' | 'white';
    /** Z06「冥界行走」（本回合）：其攻击造成伤害时回复"该攻击点数一半（向上取整）" */
    mingjieHeal?: boolean;
    /** Z06「死即新生」：是否已触发过（整局 1 次）→ 面板置灰 */
    deathUsed?: boolean;
    /** Z06「死即新生」：本帧刚触发（面板绿色闪一下）——引擎在触发时置位、界面消费后清掉 */
    deathJustTriggered?: boolean;
    /**
     * Z04「D1：开局选骰」：**本回合**由挑战者在"投完驱动骰、逐条结算之前"一次性选定的分配
     * （`skillId` → 该条技能要消耗的驱动骰 id 列表）。由 `runLegendTurn` 开局询问、`continueLegendTurn` 消耗。
     */
    assign?: Record<string, string[]>;
    /**
     * **延后一步的效果**（按卡面顺序：例「暗夜凶神」＝先攻击 → 攻击结算后 → 再弃骰 → 再计数 +1）。
     * `step` 从 0 递增；由 `continueLegendTurn` 在攻击结算完回到传奇回合时执行。
     * `groups`（遁入暗影）：逐组攻击的每组点数（每组 count 颗）。
     * `dice`（遁入暗影）：本技能的全部骰（成组后的原始骰），供"防御骰区放不下时"由挑战者**任选 room 颗**移入。
     * `moved`（遁入暗影）：是否已完成"移入"（移入只做一次；之后只剩逐组攻击）。
     */
    deferred?: {
      skillId: string;
      step: number;
      groups?: number[][];
      dice?: { id: string; value: number }[];
      moved?: boolean;
    };
  };
  dustfall: number;
  turnIndex: number;
  firstRound: Record<PlayerId, boolean>;
  rngState: number;
  log: LogEntry[];
  pendingAttack: PendingAttack | null;
  pending: Pending | null;
  unblockableThisTurn: boolean;
  caiyuliuUsed: number;
  /** 本回合已进行的「普通尘起行动」次数（默认上限 1；L02 残影 → 2） */
  dustRiseNormalCount: number;
  dustRiseActed: boolean;
  freeDustRise: number;
  rerollUsed: number;
  skillsUsedThisTurn: string[];
  ultimatesUsed: string[];
  /** 「整局一次」类的**传奇面板**技能（键为 `玩家:key`，如 L11「永恒女王」）——与必杀的 `ultimatesUsed` 分开记 */
  legendOnceUsed: string[];
  winner: PlayerId | null;
  skillConsumedThisAction: number;
  dunwuPulseUsedThisTurn: boolean;
  /** 多段攻击队列（013 电刑：1/2/3 逐段结算，同一攻击者） */
  attackQueue: { player: PlayerId; values: number[] } | null;
  /** 技能发起的多次攻击队列（A01「不败之王」充能：你 5 点 → 对方 3 点 ×2，**攻击者可不同**，逐次结算）
   *  `owner` = 该技能（效果）的拥有者，用于提示栏区分"我方发起 / 因对方效果发起" */
  /**
   * 多段攻击队列（依次结算）。挑战模式「枭首」会给条目带上 `dieId`/`dieStyle`：
   * 该骰**留在攻击骰区**、轮到它时才从区里飞出并消耗（界面因此能演"逐颗飞出攻击"）。
   */
  virtualQueue: {
    attacker: PlayerId;
    value: number;
    label: string;
    owner: PlayerId;
    dieId?: string;
    dieStyle?: 'solid';
    /** 因"多组"触发的攻击：组序号/组数（+组内第几段），供提示栏显示（见 `LegendGroup`）。 */
    legendGroup?: LegendGroup;
    /** 本条攻击**不可抵挡**（Z08「处刑通牒」的 +1 分支：本回合其攻击不可抵挡）。 */
    unblockable?: boolean;
  }[] | null;
  /** 额外重掷阶段（013 雷暴·持续：在对方重掷阶段结束时插入） */
  extraReroll: { player: PlayerId; resume: PlayerId } | null;
  /** 战术牌·战前「抽 2 留 1」：剩余可抽池（抽走的会移出 → 双方天然不同名） */
  tacticPool: string[];
  /** 战术牌·战前「抽 2 留 1」：剩余待选者（按先后手） */
  tacticQueue: PlayerId[];
  /** 战术牌·战前「抽 2 留 1」：当前选者抽到的 2 张（选完即清） */
  tacticHand: string[];
  /** 战术牌·"战斗开始时"效果是否已结算（生命修正等只跑一次；进入初始重掷前收口） */
  tacticStartDone: boolean;
  /** T13「远见」：**第一个**生命降为 ≤20 的玩家（只记一次，全局；无=null）。L04 重开不清除（生命继承）。 */
  tacticLowFirst: PlayerId | null;
  /** 待弹出的待决策队列（多个触发同时排队时按序弹出，避免互相覆盖） */
  pendingQueue: Pending[];
  /** 019 尘哀·尘起：本回合该玩家是否已触发过（每回合最多 1 次） */
  chenaiUsed: Record<PlayerId, boolean>;
  /** 本回合可用的「无需冥想骰的额外尘起行动」次数（019 尘起赠予） */
  freeNoCostRise: number;
  /** 每名玩家「本回合已进行的攻击次数」（025 屠虎·横贯持续：第 2 次攻击伤害 +2；回合开始时清零） */
  attacksThisTurn: Record<PlayerId, number>;
  /** A06 异相·「幽魂不散」：每名玩家「本回合已获得的攻击骰数」（上限 2；回合开始时清零） */
  hunhunGained: Record<PlayerId, number>;
  /** 027 寒光·凛冽之音（充能）：持有者自己的下个尘起阶段开始前，任何玩家重掷能力骰都会受到等量真实伤害 */
  rerollPunish: Record<PlayerId, boolean>;
  /** 028 天罚（激活·本回合）：该玩家的攻击点数「视为固定值」（可选——A05 异相无固定值、改为攻击伤害+3），且对方只能用某类骰抵挡；damageCount 统计本回合通过攻击造成伤害的次数（满 2 次即结束主要阶段） */
  tianfa: Record<PlayerId, { blockKind: 'meditation' | 'attack'; value?: number; damageCount: number; /** 发动它的技能 key（bairi / yunluo / alt.shenkong / alt.yunluo）→ 供界面每次攻击时弹技能名 */ key: string } | null>;
}
