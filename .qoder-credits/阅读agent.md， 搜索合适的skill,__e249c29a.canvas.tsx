import {
  BarChart,
  Callout,
  ChartComparisonGrid,
  ChartContainer,
  H1,
  LineChart,
  MetricsGrid,
  PieChart,
  ReportSection,
  ReportShell,
  Stack,
  Table,
  Text,
  type MetricItem,
} from "qoder/canvas";

// —— 报告数据契约（由 scripts/lib/breakdown.mjs 产出，plugin 注入）——
interface CatRow {
  key: string;
  label: string;
  tokens: number;
  share: number;
}
interface ToolRow {
  tool: string;
  tokens: number;
  calls: number;
  /** 平均每次调用带来的重发 token；无调用记录时 null（不给 0） */
  perCall?: number | null;
  share: number;
}
interface FileRow {
  attr: string;
  label: string;
  kind: string;
  tool: string | null;
  selfTokens: number;
  reads: number;
  trips: number;
  billed: number;
  /** 单次读取的总代价（含此后每一程重发）；reads=0 时 null */
  perRead?: number | null;
  share: number;
}
interface ReqRow {
  index: number;
  time: string | null;
  ratio: number;
  inputTokens: number;
  /** 代理或转录任一有真值即非 null；两者都没则 null（不写 0） */
  outputTokens?: number | null;
  /** proxy=代理实测 / transcript-tokens=转录 input_tokens / transcript-ratio=转录 ratio×window */
  usageSource?: "proxy" | "transcript-tokens" | "transcript-ratio" | "transcript";
  credits: number;
  originalCredits: number;
  afterCompact: boolean;
}
interface CatChild {
  tool: string | null;
  label: string;
  kind: string | null;
  tokens: number;
  share: number;
  catShare: number;
  trips: number;
}
interface CatDetail {
  key: string;
  label: string;
  tokens: number;
  share: number;
  children: CatChild[];
}
interface SubagentRow {
  agentId: string;
  agentType: string | null;
  description: string | null;
  toolUseId: string | null;
  roundTrips: number;
  billedInputTokens: number;
  peakContextRatio: number;
  credits: number;
  originalCredits: number;
  error: string | null;
}
interface SubagentTotals {
  roundTrips: number;
  billedInputTokens: number;
  credits: number;
  originalCredits: number;
}
interface Subagents {
  scanned: boolean;
  dir: string | null;
  /** 试过的候选目录；用于区分「真没子代理」与「路径没找对」。 */
  probedPaths?: string[];
  /** ok=已汇总 / no-dir=无子代理目录 / dir-empty=目录在但无 agent 文件 / no-usage=有文件但转录无 usage / error=读取抛错 */
  reason?: string;
  count: number;
  items: SubagentRow[];
  totals: SubagentTotals;
  combined: SubagentTotals;
}
/** 逐项可用性：报告里每个数字到底是模型上报的真值、按真值推导、回退默认、手工录入，还是本地根本没有。
 *  v2 旧报告没这个对象，故全部字段可选，读取时一律走默认值（旧报告只可能来自桌面端富转录）。 */
type Avail = "measured" | "derived" | "fallback" | "manual" | "unavailable";
interface Availability {
  credits?: Avail;
  roundTrips?: Avail;
  contextRatio?: Avail;
  tokens?: Avail;
  /** 输出 token：代理或转录 output_tokens 任一有真值即 measured */
  outputTokens?: Avail;
  /** 缓存命中 token：代理或转录 cache_read_input_tokens 任一有真值即 measured */
  cachedTokens?: Avail;
  categoryShare?: Avail;
  toolShare?: Avail;
  fileShare?: Avail;
  systemPrompt?: Avail;
  contextWindow?: Avail;
  compactions?: Avail;
  compactionCost?: Avail;
  model?: Avail;
  title?: Avail;
  toolCalls?: Avail;
  fileReads?: Avail;
  userTurns?: Avail;
  /** 用户压缩阈值：manual 覆盖 → manual；默认 200K → fallback */
  userContextLimit?: Avail;
}
/** 官方 UI 真值（手工录入，来自 .qoder-credits/overrides/<sessionId>.json）。
 *  IDE 端转录不含 usage，本地算不出 Credits，这是唯一的真值通道；绝不覆盖 totals，只并列展示。 */
interface ManualTruth {
  file?: string;
  credits: number | null;
  originalCredits: number | null;
  model: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMin: number | null;
  note: string | null;
  /** 手工锁定模型窗口（如 qwen3-max=1000000），优先于 runtime-config / 反推 / fallback */
  contextWindow?: number | null;
  /** 手工指定 Qoder 压缩触发阈值（默认 200000），驱动 peakUserAdvice */
  userContextLimit?: number | null;
  /** 本地 credits ÷ 官方真值。有子代理时拿 combined 比（官方 UI 扣费 = 主链 + 子代理），
   *  否则覆盖率会被系统性低估（实测 ca2f7834：主链比 0.46、combined 比 0.89）。 */
  localCoverage?: number | null;
  /** main=只比主链 / combined=比主链+子代理 */
  localScope?: "main" | "combined";
  /** 参与对账的本地 credits（按 localScope 取 totals.credits 或 subagents.combined.credits） */
  localCredits?: number | null;
}
/** 峰值占比的「该不该压」结论。阈值算在数据层（breakdown.mjs peakAdvice），
 *  这里只管展示——否则 Canvas 与终端各持一套阈值迟早走偏。tone 直接喂 Callout。 */
interface PeakAdvice {
  level: "low" | "mid" | "sweet" | "high" | "over";
  tone: "info" | "success" | "warning" | "danger";
  text: string;
}
/** 一次压缩 = 一笔普通模型调用（整份上下文当 prompt、摘要当 completion），是会话里单笔最贵的开销。
 *  pre/post 是客户端自估口径；proxy 是能在代理日志里唯一对上时回填的供应商实测值，对不上就 null。 */
interface CompactionEvent {
  index: number;
  at: string | null;
  trigger: string | null;
  preTokens: number | null;
  postTokens: number | null;
  messagesSummarized: number | null;
  /** 压缩后首轮的往返序号与实测输入 = 压缩把上下文压到的地板 */
  nextRequestIndex: number | null;
  nextInputTokens: number | null;
  savedTokens: number | null;
  /** 数据层归一后的生效值：有代理实测就用实测，否则是客户端自估。
   *  渲染端直接取这两个，别自己按 proxy 分支——否则会与合计的口径分叉。 */
  effectiveInputTokens?: number | null;
  effectiveOutputTokens?: number | null;
  proxy?: {
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number | null;
    ms: number | null;
    matchedBy: string;
  } | null;
}
interface CompactionCost {
  count: number;
  items: CompactionEvent[];
  /** measured = items 里有几笔拿到了供应商实测（其余为客户端自估） */
  totals: { preTokens: number; postTokens: number; savedTokens: number; measured?: number };
}
/** 链路健康度：代理覆盖率 + 最近记录时间 + 最近若干笔的三方归因计数。
 *  逐笔明细属于排障（CLI --request-log），报告只给一行结论。 */
interface LinkHealth {
  matched: number;
  requests: number;
  coverage: number;
  /** proxy / transcript-tokens / transcript-ratio / mixed / transcript（v3 旧报告）/ null */
  usageSource?: "proxy" | "transcript-tokens" | "transcript-ratio" | "mixed" | "transcript" | null;
  /** 三档拆分：代理实测 / 转录 input_tokens / 转录 ratio×window */
  breakdown?: { proxy: number; transcriptTokens: number; transcriptRatio: number };
  logRecords?: number;
  lastRecordAt?: string | null;
  /** 参与归因的最近笔数；0 = 运行中的代理是旧版或还没记到诊断 */
  recentRequests?: number;
  proxyErrors?: number | null;
  upstreamRejected?: number | null;
  aborted?: number | null;
  truncated?: number | null;
  noUsage?: number | null;
  slowestMs?: number | null;
  /** 被更新流量推翻的那条陈旧拉起失败记录；null = 没有 */
  supersededFailure?: { error: string; port?: number; at?: string | null } | null;
}
interface Report {
  schemaVersion: number;
  generatedAt: string;
  pluginVersion?: string;
  /** 转录来自哪一代客户端：桌面端富转录有 usage 真值，IDE 端精简转录没有。v2 旧报告无此字段。 */
  source?: "desktop-rich" | "ide-lite" | "unknown";
  /** usage 数字的来源：proxy=代理实测 / transcript-tokens=转录 input_tokens 真值 /
   *  transcript-ratio=转录 ratio×window 推导 / mixed=多档混合 / transcript=v3 旧报告兼容。无 usage 时 null。 */
  usageSource?: "proxy" | "transcript-tokens" | "transcript-ratio" | "mixed" | "transcript" | null;
  /** 可直接粘贴执行的插件入口命令（generate.mjs 用 proxy.mjs 的 selfCmd() 注入）。
   *  Windows 上是插件自带启动器的绝对路径，不要求用户装 Node；模板是静态文本，拿不到就只能硬编码。 */
  selfCmd?: string | null;
  /** 链路健康度一行结论（逐笔明细留给 CLI --request-log） */
  linkHealth?: LinkHealth | null;
  /** 代理 join 诊断（lib/proxylog.mjs）+ 配置/状态（generate.mjs 注入） */
  proxy?: {
    matched: number;
    requests: number;
    /** 三档拆分：代理实测 / 转录 input_tokens / 转录 ratio×window */
    breakdown?: { proxy: number; transcriptTokens: number; transcriptRatio: number };
    logPath?: string;
    logExists?: boolean;
    logRecords?: number;
    /** config.json 里 upstream 合法 = 用户已配置代理 */
    configured?: boolean;
    enabled?: boolean;
    port?: number;
    /** 最近一条代理记录的时间；null = 从无流量 */
    lastRecordAt?: string | null;
    /** 已配置但长期零流量（多半已改回官方模型）——软提示可 --stop-proxy */
    dormant?: boolean;
    /** 最近一次自动拉起失败（如端口被占）；ok 时为 null */
    status?: { error: string; port?: number; at?: string | null } | null;
    /** status 那条失败记录是否已被更新的流量推翻（代理在它之后还记到了流量）。
     *  status.json 只写不清，陈旧失败会把用户推去改本来正确的 Base URL，故必须判掉。 */
    statusSuperseded?: boolean;
  };
  availability?: Availability;
  manual?: ManualTruth | null;
  session: {
    id: string | null;
    title: string | null;
    /** custom-title / first-user / session-id —— 令产物文件名可解释 */
    titleSource?: string;
    model: string | null;
    /** runtime-config / manual / unavailable */
    modelSource?: string;
    cwd: string | null;
    turns: number;
    roundTrips: number;
    compactions: number;
    startedAt: string | null;
    endedAt: string | null;
  };
  context: {
    contextWindow: number;
    /** runtime-config=实测 / derived-from-usage=从 usage 反推 / manual=ManualTruth 手工锁定 /
     *  fallback=读不到静默回退 200000 / caller=调用方传入（旧枚举，兼容）。
     *  报告里每个 token 数字都要乘它，回退时必须标出来。 */
    contextWindowSource?: string;
    systemPromptTokens: number;
    netContextTokens: number;
    /** 峰值 = 当前窗口口径：自最近一次压缩起算，压缩边界处归零重新累积 */
    peakContextTokens: number;
    peakContextRatio: number;
    /** 本场历史峰值（跨压缩）；整场没压缩过时与上面相等 */
    peakSessionTokens?: number;
    peakSessionRatio?: number;
    /** 历史峰值是否值得单独交代（与当前窗口峰值相差 ≥1 个百分点），渲染端直接取用不再自判 */
    peakSessionNotable?: boolean;
    /** 峰值占比的「该不该压」结论（对模型窗口）；无有效占比时 null */
    peakAdvice?: PeakAdvice | null;
    /** 用户压缩阈值（Qoder 自动触发点），与模型窗口独立。默认 200000，ManualTruth 可覆盖 */
    userContextLimit?: number;
    /** default=内置 200K / manual=overrides 手写 / config=插件配置 / derived=实测反推 */
    userContextLimitSource?: "default" | "manual" | "config" | "derived";
    /** peakContextTokens ÷ userContextLimit */
    peakUserRatio?: number;
    /** 对用户阈值的「快自动压缩了吗」结论；与 peakAdvice 可矛盾（模型窗口未满但用户阈值已超） */
    peakUserAdvice?: PeakAdvice | null;
    /** v3.2 当前占用头条口径：段内单调递增 ⇒ 峰值≡当前，故以 netContextTokens 作头条，peak 退灰字 */
    currentContextTokens?: number;
    netUserRatio?: number;
    netUserAdvice?: PeakAdvice | null;
    netWindowRatio?: number;
    /** v3.2 自动压缩自校准：本场 trigger=auto 的实际触发点（无需外部配置）与「阈值是否被强制」判定 */
    observedAutoCompactions?: number;
    observedAutoTriggerTokens?: number | null;
    autoTriggerRatio?: number | null;
    thresholdNotEnforced?: boolean;
  };
  totals: {
    billedInputTokens: number;
    netContextTokens: number;
    peakContextTokens: number;
    amplification: number;
    attributedTokens: number;
    coverage: number;
    credits: number;
    originalCredits: number;
    /** 输出 token 总量：仅代理路径有真值，否则 0 且 availability.outputTokens=unavailable */
    outputTokens?: number;
    /** 供应商上下文缓存命中的那部分 prompt：仅代理路径有真值 */
    cachedTokens?: number;
    cachedTrips?: number;
    /** 缓存命中 ÷ 计费输入总量（全局实测约 91.5%：重复叠加的前缀正是缓存的命中对象） */
    cachedShare?: number;
    /** 两个不依赖 usage 的计数，IDE 端占比全缺时仍有可展示的真值 */
    toolCalls?: number;
    fileReads?: number;
  };
  /** credits 的分子到底覆盖了多少：与计费输入总量并排展示时，部分覆盖不说就等于把局部真值当全量。 */
  creditsCoverage?: {
    /** 真正累加进 totals.credits 的往返数 */
    trips: number;
    roundTrips: number;
    /** 这些往返的计费输入之和 */
    tokens: number;
    tokenShare: number;
    /** trips === roundTrips：全覆盖时不必再啰嗦覆盖范围 */
    full: boolean;
  };
  /** 压缩单笔成本（此前只显示「压缩 N 次」，而它是会话里单笔最贵的调用） */
  compactionCost?: CompactionCost;
  byCategory: CatRow[];
  byCategoryDetail: CatDetail[];
  byTool: ToolRow[];
  byFile: FileRow[];
  byRequest: ReqRow[];
  subagents?: Subagents;
  identity: { sumAttributed: number; billedInputTokens: number; absDiff: number; ok: boolean | null };
}

// 注入点：下一行的 REPORT 初值会被 render-canvas.mjs 按整行替换为真实报告 JSON。
const REPORT = {"schemaVersion":3.2,"generatedAt":"2026-09-22T02:30:45.006Z","source":"desktop-rich","usageSource":"transcript-ratio","availability":{"credits":"measured","roundTrips":"measured","contextRatio":"measured","tokens":"derived","outputTokens":"unavailable","cachedTokens":"unavailable","categoryShare":"derived","toolShare":"derived","fileShare":"derived","systemPrompt":"derived","contextWindow":"measured","compactions":"measured","compactionCost":"measured","model":"measured","title":"measured","toolCalls":"measured","fileReads":"measured","userTurns":"measured","userContextLimit":"fallback"},"session":{"id":"e249c29a-3b79-4800-beee-5fdbf3b7babf","title":"阅读agent.md， 搜索合适的skill, ","titleSource":"first-user","model":"dmodel","modelSource":"runtime-config","cwd":"E:\\HongWork\\MySelf\\MyKnowledge\\Embedded_Knowledge_System_V2026","turns":30,"roundTrips":76,"compactions":15,"startedAt":"2026-09-20T06:59:50.128Z","endedAt":"2026-09-22T02:30:44.537Z"},"context":{"contextWindow":200000,"contextWindowSource":"runtime-config","systemPromptTokens":43154,"netContextTokens":112232,"peakContextTokens":112232,"peakContextRatio":0.56116,"peakSessionTokens":158773,"peakSessionRatio":0.793865,"peakSessionNotable":true,"peakAdvice":{"level":"mid","tone":"info","text":"已过盈亏线（39%）但还没进性价比区间，压缩有净收益但不大；不急着压"},"userContextLimit":200000,"userContextLimitSource":"default","peakUserRatio":0.56116,"peakUserAdvice":{"level":"mid","tone":"info","text":"已过盈亏线（39%）但还没进性价比区间，压缩有净收益但不大；不急着压"},"currentContextTokens":112232,"netUserRatio":0.56116,"netUserAdvice":{"level":"mid","tone":"info","text":"已过盈亏线（39%）但还没进性价比区间，压缩有净收益但不大；不急着压"},"netWindowRatio":0.56116,"observedAutoCompactions":15,"observedAutoTriggerTokens":108498,"autoTriggerRatio":0.54249,"thresholdNotEnforced":false},"totals":{"billedInputTokens":8017217,"netContextTokens":112232,"peakContextTokens":112232,"amplification":71.43,"attributedTokens":8017217,"coverage":1,"credits":305.918,"originalCredits":305.918,"outputTokens":0,"cachedTokens":0,"cachedTrips":0,"cachedShare":0,"toolCalls":150,"fileReads":110},"creditsCoverage":{"trips":76,"roundTrips":76,"tokens":8017217,"tokenShare":0.9999999766128321,"full":true},"compactionCost":{"count":15,"items":[{"index":1,"at":"2026-09-20T07:00:32.506Z","trigger":"auto","preTokens":99776,"postTokens":1924,"messagesSummarized":19,"nextRequestIndex":3,"nextInputTokens":89008,"savedTokens":10768,"proxy":null,"effectiveInputTokens":99776,"effectiveOutputTokens":1924},{"index":2,"at":"2026-09-20T07:13:32.011Z","trigger":"auto","preTokens":101302,"postTokens":1628,"messagesSummarized":36,"nextRequestIndex":10,"nextInputTokens":70653,"savedTokens":30649,"proxy":null,"effectiveInputTokens":101302,"effectiveOutputTokens":1628},{"index":3,"at":"2026-09-20T07:27:38.580Z","trigger":"auto","preTokens":116065,"postTokens":4190,"messagesSummarized":35,"nextRequestIndex":16,"nextInputTokens":112269,"savedTokens":3796,"proxy":null,"effectiveInputTokens":116065,"effectiveOutputTokens":4190},{"index":4,"at":"2026-09-20T07:30:31.918Z","trigger":"auto","preTokens":102388,"postTokens":2540,"messagesSummarized":27,"nextRequestIndex":20,"nextInputTokens":72348,"savedTokens":30040,"proxy":null,"effectiveInputTokens":102388,"effectiveOutputTokens":2540},{"index":5,"at":"2026-09-20T07:37:37.445Z","trigger":"auto","preTokens":105105,"postTokens":2177,"messagesSummarized":25,"nextRequestIndex":25,"nextInputTokens":72366,"savedTokens":32739,"proxy":null,"effectiveInputTokens":105105,"effectiveOutputTokens":2177},{"index":6,"at":"2026-09-20T07:39:33.436Z","trigger":"auto","preTokens":113145,"postTokens":2765,"messagesSummarized":22,"nextRequestIndex":28,"nextInputTokens":110550,"savedTokens":2595,"proxy":null,"effectiveInputTokens":113145,"effectiveOutputTokens":2765},{"index":7,"at":"2026-09-20T07:40:20.050Z","trigger":"auto","preTokens":96173,"postTokens":3124,"messagesSummarized":13,"nextRequestIndex":29,"nextInputTokens":74302,"savedTokens":21871,"proxy":null,"effectiveInputTokens":96173,"effectiveOutputTokens":3124},{"index":8,"at":"2026-09-20T07:41:55.897Z","trigger":"auto","preTokens":96130,"postTokens":2878,"messagesSummarized":43,"nextRequestIndex":33,"nextInputTokens":75814,"savedTokens":20316,"proxy":null,"effectiveInputTokens":96130,"effectiveOutputTokens":2878},{"index":9,"at":"2026-09-20T07:59:37.521Z","trigger":"auto","preTokens":108498,"postTokens":1976,"messagesSummarized":33,"nextRequestIndex":38,"nextInputTokens":72642,"savedTokens":35856,"proxy":null,"effectiveInputTokens":108498,"effectiveOutputTokens":1976},{"index":10,"at":"2026-09-20T08:00:16.182Z","trigger":"auto","preTokens":104071,"postTokens":2150,"messagesSummarized":19,"nextRequestIndex":41,"nextInputTokens":71956,"savedTokens":32115,"proxy":null,"effectiveInputTokens":104071,"effectiveOutputTokens":2150},{"index":11,"at":"2026-09-21T08:14:53.401Z","trigger":"auto","preTokens":175465,"postTokens":3488,"messagesSummarized":41,"nextRequestIndex":47,"nextInputTokens":63381,"savedTokens":112084,"proxy":null,"effectiveInputTokens":175465,"effectiveOutputTokens":3488},{"index":12,"at":"2026-09-21T08:38:20.013Z","trigger":"auto","preTokens":196472,"postTokens":3711,"messagesSummarized":35,"nextRequestIndex":52,"nextInputTokens":66643,"savedTokens":129829,"proxy":null,"effectiveInputTokens":196472,"effectiveOutputTokens":3711},{"index":13,"at":"2026-09-21T08:51:02.337Z","trigger":"auto","preTokens":181270,"postTokens":6430,"messagesSummarized":101,"nextRequestIndex":56,"nextInputTokens":50862,"savedTokens":130408,"proxy":null,"effectiveInputTokens":181270,"effectiveOutputTokens":6430},{"index":14,"at":"2026-09-21T09:02:45.394Z","trigger":"auto","preTokens":182813,"postTokens":4167,"messagesSummarized":75,"nextRequestIndex":65,"nextInputTokens":54574,"savedTokens":128239,"proxy":null,"effectiveInputTokens":182813,"effectiveOutputTokens":4167},{"index":15,"at":"2026-09-22T02:27:57.626Z","trigger":"auto","preTokens":201662,"postTokens":4724,"messagesSummarized":56,"nextRequestIndex":73,"nextInputTokens":70458,"savedTokens":131204,"proxy":null,"effectiveInputTokens":201662,"effectiveOutputTokens":4724}],"totals":{"preTokens":1980335,"postTokens":47872,"savedTokens":852509,"measured":0}},"proxy":{"matched":0,"requests":76,"breakdown":{"proxy":0,"transcriptTokens":0,"transcriptRatio":76},"logPath":"C:\\Users\\75672\\.qoder-credits-proxy\\usage.jsonl","logExists":false,"logRecords":0,"configured":false,"enabled":true,"port":49787,"lastRecordAt":null,"dormant":false,"status":null,"statusSuperseded":false},"byCategory":[{"key":"tool_result","label":"工具返回","tokens":303131,"share":0.03781001952552532},{"key":"system","label":"系统提示词","tokens":3279704,"share":0.40908260310279737},{"key":"compact_summary","label":"压缩摘要","tokens":193178,"share":0.024095331676478135},{"key":"assistant_thinking","label":"模型思考","tokens":172178,"share":0.021476041425632},{"key":"assistant_tool_use","label":"工具调用","tokens":32614,"share":0.0040679591327274665},{"key":"assistant_text","label":"模型回复","tokens":19978,"share":0.0024918724868871864},{"key":"user_input","label":"用户输入","tokens":195374,"share":0.024369293100482862},{"key":"attachment","label":"附件/技能","tokens":3821061,"share":0.4766068561623022}],"byCategoryDetail":[{"key":"tool_result","label":"工具返回","tokens":303131,"share":0.03781001952552532,"children":[{"tool":"Read","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.1_SPL的存在理由与内存约束.md","kind":"read","tokens":35951,"share":0.004484220472414904,"catShare":0.11859873463930994,"trips":8},{"tool":"Read","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.3_Falcon_Mode_SPL直达内核的快速启动路径.md","kind":"read","tokens":35760,"share":0.0044604596012644574,"catShare":0.11797030673981082,"trips":22},{"tool":"Read","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.1.3_BootROM加载SPL的协议.md","kind":"read","tokens":34325,"share":0.004281463834217875,"catShare":0.11323622383552286,"trips":9},{"tool":"Read","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.1.1_复位向量表与BootROM存储.md","kind":"read","tokens":34142,"share":0.004258551667417534,"catShare":0.11263024248222382,"trips":10},{"tool":"Read","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.1.2_启动介质检测顺序.md","kind":"read","tokens":33914,"share":0.004230183789853516,"catShare":0.11187996840355358,"trips":6},{"tool":"Read","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.2_SPL的内存布局与board_init_f_r.md","kind":"read","tokens":23753,"share":0.002962772110856539,"catShare":0.07835944408482491,"trips":5},{"tool":"Edit","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.3_Falcon_Mode_SPL直达内核的快速启动路径.md","kind":"write","tokens":18969,"share":0.002366007889501836,"catShare":0.0625762144318534,"trips":85},{"tool":"Read","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.3_Falcon_Mode_SPL直达内核的快速启动路径.md","kind":"read","tokens":17206,"share":0.0021460751344030814,"catShare":0.056759429414054624,"trips":5},{"tool":"Read","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.2_SPL的内存布局与board_init_f_r.md","kind":"read","tokens":14367,"share":0.0017920206755047395,"catShare":0.047395391433081836,"trips":3},{"tool":"Read","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.1_SPL的存在理由与内存约束.md","kind":"read","tokens":13767,"share":0.0017171601029941999,"catShare":0.04541547781626919,"trips":3},{"tool":"Edit","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.1_SPL的存在理由与内存约束.md","kind":"write","tokens":8057,"share":0.001004956144214142,"catShare":0.026579096145023202,"trips":26},{"tool":"Read","label":"agent.md","kind":"read","tokens":7556,"share":0.0009424553053831461,"catShare":0.02492607296187457,"trips":1},{"tool":"Glob","label":"E:/HongWork/MySelf/MyKnowledge/Embedded_Knowledge_System_V2026","kind":"search","tokens":3943,"share":0.0004917580302595309,"catShare":0.013006024234596018,"trips":1},{"tool":"Bash","label":"（无路径）","kind":"shell","tokens":3384,"share":0.00042207153779855557,"catShare":0.01116295476953186,"trips":20},{"tool":"Grep","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.1_SPL的存在理由与内存约束.md","kind":"search","tokens":2775,"share":0.00034611611842434324,"catShare":0.00915408462539096,"trips":8},{"tool":null,"label":"其他 31 项","kind":null,"tokens":15263,"share":0.0019037471110169024,"catShare":0.05035033398307807,"trips":142}]},{"key":"system","label":"系统提示词","tokens":3279704,"share":0.40908260310279737,"children":[]},{"key":"compact_summary","label":"压缩摘要","tokens":193178,"share":0.024095331676478135,"children":[]},{"key":"assistant_thinking","label":"模型思考","tokens":172178,"share":0.021476041425632,"children":[]},{"key":"assistant_tool_use","label":"工具调用","tokens":32614,"share":0.0040679591327274665,"children":[{"tool":"Edit","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.3_Falcon_Mode_SPL直达内核的快速启动路径.md","kind":"write","tokens":10954,"share":0.0013663206929393225,"catShare":0.3358737510283783,"trips":85},{"tool":"Edit","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.1_SPL的存在理由与内存约束.md","kind":"write","tokens":4387,"share":0.0005471483979548618,"catShare":0.1345019406790383,"trips":26},{"tool":"Edit","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.1.3_BootROM加载SPL的协议.md","kind":"write","tokens":1738,"share":0.00021681282843870737,"catShare":0.05329769089723862,"trips":3},{"tool":"AskUserQuestion","label":"（无路径）","kind":"other","tokens":1493,"share":0.00018622063084320015,"catShare":0.045777409449623406,"trips":8},{"tool":"TaskCreate","label":"（无路径）","kind":"other","tokens":1394,"share":0.00017387349113935543,"catShare":0.04274219220653221,"trips":22},{"tool":"Write","label":"C:/Users/75672/.qoder-cn/projects/E--HongWork-MySelf-MyKnowledge-Embedded-Knowledge-System-V2026/memory/review-collaboration-workflow.md","kind":"write","tokens":1057,"share":0.00013188385568391582,"catShare":0.03242015255829057,"trips":3},{"tool":"Bash","label":"（无路径）","kind":"shell","tokens":921,"share":0.00011485189681066994,"catShare":0.028233296614674837,"trips":20},{"tool":"Read","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.3_Falcon_Mode_SPL直达内核的快速启动路径.md","kind":"read","tokens":903,"share":0.00011264542394971151,"catShare":0.02769089370722993,"trips":22},{"tool":"Edit","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.2_SPL的内存布局与board_init_f_r.md","kind":"write","tokens":825,"share":0.00010291133506557394,"catShare":0.02529802579323712,"trips":5},{"tool":"Grep","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.3_Falcon_Mode_SPL直达内核的快速启动路径.md","kind":"search","tokens":773,"share":0.00009637448836125672,"catShare":0.023691115180068195,"trips":8},{"tool":"Read","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.1.1_复位向量表与BootROM存储.md","kind":"read","tokens":731,"share":0.00009117887553137427,"catShare":0.022413911388102146,"trips":10},{"tool":"Write","label":"C:/Users/75672/.qoder-cn/memory/user-edits-files-between-turns.md","kind":"write","tokens":659,"share":0.00008219190291729754,"catShare":0.020204702219363227,"trips":3},{"tool":"Read","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.1.3_BootROM加载SPL的协议.md","kind":"read","tokens":633,"share":0.00007897252604382896,"catShare":0.019413303690413386,"trips":9},{"tool":"Grep","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.1_SPL的存在理由与内存约束.md","kind":"search","tokens":596,"share":0.00007436057778721034,"catShare":0.018279578373579533,"trips":8},{"tool":"Grep","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.2_SPL的内存布局与board_init_f_r.md","kind":"search","tokens":544,"share":0.00006779525527473945,"catShare":0.01666566773724799,"trips":8},{"tool":null,"label":"其他 31 项","kind":null,"tokens":5006,"share":0.0006244169539864384,"catShare":0.15349636847698178,"trips":114}]},{"key":"assistant_text","label":"模型回复","tokens":19978,"share":0.0024918724868871864,"children":[]},{"key":"user_input","label":"用户输入","tokens":195374,"share":0.024369293100482862,"children":[]},{"key":"attachment","label":"附件/技能","tokens":3821061,"share":0.4766068561623022,"children":[]}],"byTool":[{"tool":"Read","tokens":254506,"calls":30,"perCall":8484,"share":0.0317449035024907},{"tool":"Edit","tokens":49991,"calls":48,"perCall":1041,"share":0.006235424741243053},{"tool":"Grep","tokens":15727,"calls":17,"perCall":925,"share":0.001961628938815983},{"tool":"Glob","tokens":4541,"calls":10,"perCall":454,"share":0.0005664548563343222},{"tool":"Bash","tokens":4305,"calls":10,"perCall":430,"share":0.0005369234346092255},{"tool":"Write","tokens":2103,"calls":5,"perCall":421,"share":0.00026236399869513456},{"tool":"TaskCreate","tokens":1795,"calls":10,"perCall":180,"share":0.00022391341538691617},{"tool":"AskUserQuestion","tokens":1740,"calls":2,"perCall":870,"share":0.00021702770272337743},{"tool":"TaskList","tokens":593,"calls":2,"perCall":297,"share":0.00007402770616886355},{"tool":"TaskUpdate","tokens":224,"calls":15,"perCall":15,"share":0.000027882293190004926},{"tool":"Skill","tokens":220,"calls":1,"perCall":220,"share":0.000027428068595181966}],"byFile":[{"attr":"file:E:\\HongWork\\MySelf\\MyKnowledge\\Embedded_Knowledge_System_V2026\\docs\\02-核心机制深度解析\\第7章 启动链深度解析\\7.2.3_Falcon_Mode_SPL直达内核的快速启动路径.md","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.3_Falcon_Mode_SPL直达内核的快速启动路径.md","kind":"read","tool":"Read","selfTokens":22520,"reads":29,"trips":230,"billed":69599,"perRead":2400,"share":0.008681186877693254},{"attr":"file:E:\\HongWork\\MySelf\\MyKnowledge\\Embedded_Knowledge_System_V2026\\docs\\02-核心机制深度解析\\第7章 启动链深度解析\\7.1.3_BootROM加载SPL的协议.md","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.1.3_BootROM加载SPL的协议.md","kind":"read","tool":"Read","selfTokens":20290,"reads":7,"trips":28,"billed":39078,"perRead":5583,"share":0.004874276247556976},{"attr":"file:E:/HongWork/MySelf/MyKnowledge/Embedded_Knowledge_System_V2026/docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.1_SPL的存在理由与内存约束.md","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.1_SPL的存在理由与内存约束.md","kind":"read","tool":"Read","selfTokens":14667,"reads":3,"trips":18,"billed":37289,"perRead":12430,"share":0.004651176341485723},{"attr":"file:E:\\HongWork\\MySelf\\MyKnowledge\\Embedded_Knowledge_System_V2026\\docs\\02-核心机制深度解析\\第7章 启动链深度解析\\7.1.2_启动介质检测顺序.md","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.1.2_启动介质检测顺序.md","kind":"read","tool":"Read","selfTokens":20129,"reads":7,"trips":26,"billed":37024,"perRead":5289,"share":0.004618091101075785},{"attr":"file:E:\\HongWork\\MySelf\\MyKnowledge\\Embedded_Knowledge_System_V2026\\docs\\02-核心机制深度解析\\第7章 启动链深度解析\\7.1.1_复位向量表与BootROM存储.md","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.1.1_复位向量表与BootROM存储.md","kind":"read","tool":"Read","selfTokens":22077,"reads":11,"trips":30,"billed":36343,"perRead":3304,"share":0.004533074701962517},{"attr":"file:E:\\HongWork\\MySelf\\MyKnowledge\\Embedded_Knowledge_System_V2026\\docs\\02-核心机制深度解析\\第7章 启动链深度解析\\7.2.1_SPL的存在理由与内存约束.md","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.1_SPL的存在理由与内存约束.md","kind":"read","tool":"Read","selfTokens":17499,"reads":16,"trips":74,"billed":29705,"perRead":1857,"share":0.0037051036086977675},{"attr":"file:E:/HongWork/MySelf/MyKnowledge/Embedded_Knowledge_System_V2026/docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.2_SPL的内存布局与board_init_f_r.md","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.2_SPL的内存布局与board_init_f_r.md","kind":"read","tool":"Read","selfTokens":6491,"reads":1,"trips":10,"billed":23971,"perRead":23971,"share":0.0029899492804057516},{"attr":"file:E:\\HongWork\\MySelf\\MyKnowledge\\Embedded_Knowledge_System_V2026\\docs\\02-核心机制深度解析\\第7章 启动链深度解析\\7.2.2_SPL的内存布局与board_init_f_r.md","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.2_SPL的内存布局与board_init_f_r.md","kind":"read","tool":"Read","selfTokens":11740,"reads":8,"trips":32,"billed":19491,"perRead":2436,"share":0.0024311763262784905},{"attr":"file:E:/HongWork/MySelf/MyKnowledge/Embedded_Knowledge_System_V2026/docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.3_Falcon_Mode_SPL直达内核的快速启动路径.md","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.3_Falcon_Mode_SPL直达内核的快速启动路径.md","kind":"read","tool":"Read","selfTokens":4724,"reads":1,"trips":10,"billed":17446,"perRead":17446,"share":0.002176016083906451},{"attr":"file:E:\\HongWork\\MySelf\\MyKnowledge\\Embedded_Knowledge_System_V2026\\agent.md","label":"agent.md","kind":"read","tool":"Read","selfTokens":6817,"reads":1,"trips":2,"billed":7581,"perRead":7581,"share":0.0009456458370322207},{"attr":"file:E:\\HongWork\\MySelf\\MyKnowledge\\Embedded_Knowledge_System_V2026","label":"E:/HongWork/MySelf/MyKnowledge/Embedded_Knowledge_System_V2026","kind":"search","tool":"Glob","selfTokens":3569,"reads":1,"trips":2,"billed":3969,"perRead":3969,"share":0.0004950872806759565},{"attr":"file:C:\\Users\\75672\\.qoder-cn\\projects\\E--HongWork-MySelf-MyKnowledge-Embedded-Knowledge-System-V2026\\memory\\review-collaboration-workflow.md","label":"C:/Users/75672/.qoder-cn/projects/E--HongWork-MySelf-MyKnowledge-Embedded-Knowledge-System-V2026/memory/review-collaboration-workflow.md","kind":"write","tool":"Write","selfTokens":602,"reads":1,"trips":6,"billed":1137,"perRead":1137,"share":0.0001417751448602095},{"attr":"file:docs/02-核心机制深度解析/第7章 启动链深度解析","label":"docs/02-核心机制深度解析/第7章 启动链深度解析","kind":"search","tool":"Grep","selfTokens":1168,"reads":1,"trips":2,"billed":733,"perRead":733,"share":0.00009138543456415795},{"attr":"file:C:\\Users\\75672\\.qoder-cn\\memory\\user-edits-files-between-turns.md","label":"C:/Users/75672/.qoder-cn/memory/user-edits-files-between-turns.md","kind":"write","tool":"Write","selfTokens":373,"reads":1,"trips":6,"billed":704,"perRead":704,"share":0.00008784406816089393},{"attr":"file:docs/02-核心机制深度解析/第7章 启动链深度解析/7.3.1_start汇编入口与重定位.md","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.3.1_start汇编入口与重定位.md","kind":"search","tool":"Grep","selfTokens":396,"reads":1,"trips":6,"billed":692,"perRead":692,"share":0.00008631875282188377},{"attr":"file:docs","label":"docs","kind":"search","tool":"Grep","selfTokens":123,"reads":1,"trips":10,"billed":686,"perRead":686,"share":0.00008552102589439639},{"attr":"file:docs/02-核心机制深度解析/第7章 启动链深度解析/7.3.2_DM框架_U-Boot的设备模型.md","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.3.2_DM框架_U-Boot的设备模型.md","kind":"search","tool":"Grep","selfTokens":357,"reads":1,"trips":4,"billed":425,"perRead":425,"share":0.00005299531718139864},{"attr":"file:docs/02-核心机制深度解析/第7章 启动链深度解析/7.3.3_bootcmd执行流程与autoboot.md","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.3.3_bootcmd执行流程与autoboot.md","kind":"search","tool":"Grep","selfTokens":135,"reads":1,"trips":4,"billed":161,"perRead":161,"share":0.00002004024599296587},{"attr":"file:C:\\Users\\75672\\.qoder-cn\\projects\\E--HongWork-MySelf-MyKnowledge-Embedded-Knowledge-System-V2026\\memory\\MEMORY.md","label":"C:/Users/75672/.qoder-cn/projects/E--HongWork-MySelf-MyKnowledge-Embedded-Knowledge-System-V2026/memory/MEMORY.md","kind":"write","tool":"Write","selfTokens":126,"reads":1,"trips":4,"billed":160,"perRead":160,"share":0.000019931608671149398},{"attr":"file:02-核心机制深度解析/第7章 启动链深度解析/7.1*","label":"02-核心机制深度解析/第7章 启动链深度解析/7.1*","kind":"search","tool":"Glob","selfTokens":32,"reads":1,"trips":8,"billed":145,"perRead":145,"share":0.000018126818286299962},{"attr":"file:docs/02-核心机制深度解析/第7章 启动链深度解析/7.1*","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.1*","kind":"search","tool":"Glob","selfTokens":34,"reads":1,"trips":6,"billed":118,"perRead":118,"share":0.000014722405136681592},{"attr":"file:docs/02-核心机制深度解析/**","label":"docs/02-核心机制深度解析/**","kind":"search","tool":"Glob","selfTokens":21,"reads":1,"trips":10,"billed":117,"perRead":117,"share":0.000014601150762457924},{"attr":"file:C:\\Users\\75672\\.qoder-cn\\memory\\MEMORY.md","label":"C:/Users/75672/.qoder-cn/memory/MEMORY.md","kind":"write","tool":"Write","selfTokens":81,"reads":1,"trips":4,"billed":103,"perRead":103,"share":0.000012813177002881755},{"attr":"file:docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.*","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.2.*","kind":"search","tool":"Glob","selfTokens":34,"reads":1,"trips":4,"billed":74,"perRead":74,"share":0.000009265694211513624},{"attr":"file:docs/02-核心机制深度解析/第7章 启动链深度解析/7.3*.md","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.3*.md","kind":"search","tool":"Glob","selfTokens":34,"reads":1,"trips":4,"billed":43,"perRead":43,"share":0.00000536323740788723},{"attr":"file:docs/02-核心机制深度解析/第7章 启动链深度解析/*","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/*","kind":"search","tool":"Glob","selfTokens":33,"reads":1,"trips":2,"billed":36,"perRead":36,"share":0.00000452135353214183},{"attr":"file:docs/**/7.1*","label":"docs/**/7.1*","kind":"search","tool":"Glob","selfTokens":11,"reads":1,"trips":4,"billed":25,"perRead":25,"share":0.0000031772799312004167},{"attr":"file:docs/**/*7.1*","label":"docs/**/*7.1*","kind":"search","tool":"Glob","selfTokens":11,"reads":1,"trips":2,"billed":13,"perRead":13,"share":0.000001589636390183102},{"attr":"file:E:\\HongWork\\MySelf\\MyKnowledge\\Embedded_Knowledge_System_V2026\\plan.md","label":"plan.md","kind":"read","tool":"Read","selfTokens":1259,"reads":1,"trips":0,"billed":0,"perRead":0,"share":0},{"attr":"file:E:\\HongWork\\MySelf\\MyKnowledge\\Embedded_Knowledge_System_V2026\\docs\\index.md","label":"docs/index.md","kind":"read","tool":"Read","selfTokens":4239,"reads":1,"trips":0,"billed":0,"perRead":0,"share":0},{"attr":"file:docs/**/第7章*/**","label":"docs/**/第7章*/**","kind":"search","tool":"Glob","selfTokens":13,"reads":1,"trips":0,"billed":0,"perRead":0,"share":0},{"attr":"file:E:\\HongWork\\MySelf\\MyKnowledge\\Embedded_Knowledge_System_V2026\\Qoder\\7.1.x_小白反馈复检报告.md","label":"Qoder/7.1.x_小白反馈复检报告.md","kind":"write","tool":"Write","selfTokens":5657,"reads":1,"trips":0,"billed":0,"perRead":0,"share":0},{"attr":"file:E:\\HongWork\\MySelf\\MyKnowledge\\Embedded_Knowledge_System_V2026\\docs\\02-核心机制深度解析\\第7章 启动链深度解析","label":"docs/02-核心机制深度解析/第7章 启动链深度解析","kind":"search","tool":"Grep","selfTokens":80,"reads":1,"trips":0,"billed":0,"perRead":0,"share":0},{"attr":"file:E:\\HongWork\\MySelf\\MyKnowledge\\Embedded_Knowledge_System_V2026\\docs\\02-核心机制深度解析\\第7章 启动链深度解析\\7.3.1_start汇编入口与重定位.md","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.3.1_start汇编入口与重定位.md","kind":"read","tool":"Read","selfTokens":8641,"reads":1,"trips":0,"billed":0,"perRead":0,"share":0},{"attr":"file:E:\\HongWork\\MySelf\\MyKnowledge\\Embedded_Knowledge_System_V2026\\docs\\02-核心机制深度解析\\第7章 启动链深度解析\\7.3.2_DM框架_U-Boot的设备模型.md","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.3.2_DM框架_U-Boot的设备模型.md","kind":"read","tool":"Read","selfTokens":6948,"reads":1,"trips":0,"billed":0,"perRead":0,"share":0},{"attr":"file:E:\\HongWork\\MySelf\\MyKnowledge\\Embedded_Knowledge_System_V2026\\docs\\02-核心机制深度解析\\第7章 启动链深度解析\\7.3.3_bootcmd执行流程与autoboot.md","label":"docs/02-核心机制深度解析/第7章 启动链深度解析/7.3.3_bootcmd执行流程与autoboot.md","kind":"read","tool":"Read","selfTokens":6736,"reads":1,"trips":0,"billed":0,"perRead":0,"share":0}],"byAttr":[{"attr":"attachment","tokens":3821061,"share":0.4766068561623022},{"attr":"system","tokens":3279704,"share":0.40908260310279737},{"attr":"tool_result|Read","tokens":250741,"share":0.03127536269430998},{"attr":"user_input","tokens":195374,"share":0.024369293100482862},{"attr":"compact_summary","tokens":193178,"share":0.024095331676478135},{"attr":"assistant_thinking","tokens":172178,"share":0.021476041425632},{"attr":"tool_result|Edit","tokens":31221,"share":0.0038942473357604767},{"attr":"assistant_text","tokens":19978,"share":0.0024918724868871864},{"attr":"tool_use|Edit","tokens":18770,"share":0.0023411774054825736},{"attr":"tool_result|Grep","tokens":12203,"share":0.0015220497717550216},{"attr":"tool_result|Glob","tokens":4029,"share":0.0005025396195302594},{"attr":"tool_use|Read","tokens":3764,"share":0.00046954080818071566},{"attr":"tool_use|Grep","tokens":3524,"share":0.0004395791670609613},{"attr":"tool_result|Bash","tokens":3384,"share":0.00042207153779855557},{"attr":"tool_use|Write","tokens":1910,"share":0.00023827842627332333},{"attr":"tool_use|AskUserQuestion","tokens":1493,"share":0.00018622063084320015},{"attr":"tool_use|TaskCreate","tokens":1394,"share":0.00017387349113935543},{"attr":"tool_use|Bash","tokens":921,"share":0.00011485189681066994},{"attr":"tool_result|TaskList","tokens":588,"share":0.00007334855290125931},{"attr":"tool_use|Glob","tokens":512,"share":0.00006391523680406266},{"attr":"tool_result|TaskCreate","tokens":401,"share":0.00005003992424756076},{"attr":"tool_result|AskUserQuestion","tokens":247,"share":0.00003080707188017726},{"attr":"tool_result|Write","tokens":193,"share":0.000024085572421811246},{"attr":"tool_use|Skill","tokens":185,"share":0.00002311354095099604},{"attr":"tool_use|TaskUpdate","tokens":134,"share":0.000016729375914002958},{"attr":"tool_result|TaskUpdate","tokens":89,"share":0.000011152917276001975},{"attr":"tool_result|Skill","tokens":35,"share":0.000004314527644185928},{"attr":"tool_use|TaskList","tokens":5,"share":6.79153267604253e-7}],"byRequest":[{"index":1,"time":"14:59","ratio":0.341664,"inputTokens":68333,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.464,"originalCredits":2.464,"afterCompact":false},{"index":2,"time":"15:00","ratio":0.540492,"inputTokens":108098,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.689,"originalCredits":1.689,"afterCompact":false},{"index":3,"time":"15:00","ratio":0.445039,"inputTokens":89008,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.964,"originalCredits":1.964,"afterCompact":true},{"index":4,"time":"15:11","ratio":0.585102,"inputTokens":117020,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.248,"originalCredits":1.248,"afterCompact":false},{"index":5,"time":"15:11","ratio":0.586273,"inputTokens":117255,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.357,"originalCredits":0.357,"afterCompact":false},{"index":6,"time":"15:12","ratio":0.596523,"inputTokens":119305,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.435,"originalCredits":0.435,"afterCompact":false},{"index":7,"time":"15:12","ratio":0.597898,"inputTokens":119580,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.374,"originalCredits":0.374,"afterCompact":false},{"index":8,"time":"15:12","ratio":0.599117,"inputTokens":119823,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.37,"originalCredits":0.37,"afterCompact":false},{"index":9,"time":"15:12","ratio":0.600172,"inputTokens":120034,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.369,"originalCredits":0.369,"afterCompact":false},{"index":10,"time":"15:13","ratio":0.353266,"inputTokens":70653,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.248,"originalCredits":1.248,"afterCompact":true},{"index":11,"time":"15:13","ratio":0.354891,"inputTokens":70978,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.244,"originalCredits":0.244,"afterCompact":false},{"index":12,"time":"15:13","ratio":0.356422,"inputTokens":71284,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.231,"originalCredits":0.231,"afterCompact":false},{"index":13,"time":"15:26","ratio":0.487664,"inputTokens":97533,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.518,"originalCredits":3.518,"afterCompact":false},{"index":14,"time":"15:26","ratio":0.677203,"inputTokens":135441,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.679,"originalCredits":1.679,"afterCompact":false},{"index":15,"time":"15:26","ratio":0.680453,"inputTokens":136091,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.435,"originalCredits":0.435,"afterCompact":false},{"index":16,"time":"15:27","ratio":0.561344,"inputTokens":112269,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.79,"originalCredits":2.79,"afterCompact":true},{"index":17,"time":"15:28","ratio":0.567555,"inputTokens":113511,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.424,"originalCredits":0.424,"afterCompact":false},{"index":18,"time":"15:29","ratio":0.57382,"inputTokens":114764,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.42,"originalCredits":0.42,"afterCompact":false},{"index":19,"time":"15:29","ratio":0.576305,"inputTokens":115261,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.095,"originalCredits":1.095,"afterCompact":false},{"index":20,"time":"15:30","ratio":0.361742,"inputTokens":72348,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.342,"originalCredits":1.342,"afterCompact":true},{"index":21,"time":"15:36","ratio":0.49843,"inputTokens":99686,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.574,"originalCredits":3.574,"afterCompact":false},{"index":22,"time":"15:36","ratio":0.627492,"inputTokens":125498,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.223,"originalCredits":1.223,"afterCompact":false},{"index":23,"time":"15:36","ratio":0.628711,"inputTokens":125742,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.385,"originalCredits":0.385,"afterCompact":false},{"index":24,"time":"15:37","ratio":0.629828,"inputTokens":125966,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.384,"originalCredits":0.384,"afterCompact":false},{"index":25,"time":"15:37","ratio":0.361828,"inputTokens":72366,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.297,"originalCredits":1.297,"afterCompact":true},{"index":26,"time":"15:37","ratio":0.490633,"inputTokens":98127,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.169,"originalCredits":1.169,"afterCompact":false},{"index":27,"time":"15:38","ratio":0.680133,"inputTokens":136027,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.933,"originalCredits":1.933,"afterCompact":false},{"index":28,"time":"15:39","ratio":0.55275,"inputTokens":110550,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.679,"originalCredits":2.679,"afterCompact":true},{"index":29,"time":"15:40","ratio":0.371508,"inputTokens":74302,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.391,"originalCredits":1.391,"afterCompact":true},{"index":30,"time":"15:40","ratio":0.38232,"inputTokens":76464,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.39,"originalCredits":0.39,"afterCompact":false},{"index":31,"time":"15:40","ratio":0.52518,"inputTokens":105036,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.328,"originalCredits":1.328,"afterCompact":false},{"index":32,"time":"15:41","ratio":0.534156,"inputTokens":106831,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.672,"originalCredits":0.672,"afterCompact":false},{"index":33,"time":"15:41","ratio":0.37907,"inputTokens":75814,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.42,"originalCredits":1.42,"afterCompact":true},{"index":34,"time":"15:42","ratio":0.511391,"inputTokens":102278,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.276,"originalCredits":1.276,"afterCompact":false},{"index":35,"time":"15:42","ratio":0.648102,"inputTokens":129620,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.273,"originalCredits":1.273,"afterCompact":false},{"index":36,"time":"15:42","ratio":0.649484,"inputTokens":129897,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.411,"originalCredits":0.411,"afterCompact":false},{"index":37,"time":"15:42","ratio":0.651188,"inputTokens":130238,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.425,"originalCredits":0.425,"afterCompact":false},{"index":38,"time":"15:59","ratio":0.363211,"inputTokens":72642,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.3,"originalCredits":1.3,"afterCompact":true},{"index":39,"time":"15:59","ratio":0.491539,"inputTokens":98308,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.131,"originalCredits":1.131,"afterCompact":false},{"index":40,"time":"15:59","ratio":0.619641,"inputTokens":123928,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.21,"originalCredits":1.21,"afterCompact":false},{"index":41,"time":"16:00","ratio":0.359781,"inputTokens":71956,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.303,"originalCredits":1.303,"afterCompact":true},{"index":42,"time":"16:01","ratio":0.484969,"inputTokens":96994,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.631,"originalCredits":1.631,"afterCompact":false},{"index":43,"time":"16:07","ratio":0.42574,"inputTokens":85148,"outputTokens":null,"usageSource":"transcript-ratio","credits":18.605,"originalCredits":18.605,"afterCompact":false},{"index":44,"time":"16:09","ratio":0.54923,"inputTokens":109846,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.802,"originalCredits":7.802,"afterCompact":false},{"index":45,"time":"16:11","ratio":0.65459,"inputTokens":130918,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.261,"originalCredits":6.261,"afterCompact":false},{"index":46,"time":"16:11","ratio":0.75139,"inputTokens":150278,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.493,"originalCredits":4.493,"afterCompact":false},{"index":47,"time":"16:15","ratio":0.316905,"inputTokens":63381,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.547,"originalCredits":9.547,"afterCompact":true},{"index":48,"time":"16:15","ratio":0.40795,"inputTokens":81590,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.417,"originalCredits":4.417,"afterCompact":false},{"index":49,"time":"16:24","ratio":0.494455,"inputTokens":98891,"outputTokens":null,"usageSource":"transcript-ratio","credits":16.705,"originalCredits":16.705,"afterCompact":false},{"index":50,"time":"16:26","ratio":0.688095,"inputTokens":137619,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.799,"originalCredits":6.799,"afterCompact":false},{"index":51,"time":"16:36","ratio":0.793865,"inputTokens":158773,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.012,"originalCredits":13.012,"afterCompact":false},{"index":52,"time":"16:46","ratio":0.333215,"inputTokens":66643,"outputTokens":null,"usageSource":"transcript-ratio","credits":23.906,"originalCredits":23.906,"afterCompact":true},{"index":53,"time":"16:47","ratio":0.54787,"inputTokens":109574,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.133,"originalCredits":11.133,"afterCompact":false},{"index":54,"time":"16:48","ratio":0.67352,"inputTokens":134704,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.918,"originalCredits":5.918,"afterCompact":false},{"index":55,"time":"16:48","ratio":0.77105,"inputTokens":154210,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.784,"originalCredits":5.784,"afterCompact":false},{"index":56,"time":"16:51","ratio":0.25431,"inputTokens":50862,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.969,"originalCredits":4.969,"afterCompact":true},{"index":57,"time":"16:53","ratio":0.278935,"inputTokens":55787,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.889,"originalCredits":4.889,"afterCompact":false},{"index":58,"time":"16:53","ratio":0.40847,"inputTokens":81694,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.737,"originalCredits":4.737,"afterCompact":false},{"index":59,"time":"16:53","ratio":0.41134,"inputTokens":82268,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.921,"originalCredits":0.921,"afterCompact":false},{"index":60,"time":"16:54","ratio":0.50399,"inputTokens":100798,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.242,"originalCredits":5.242,"afterCompact":false},{"index":61,"time":"16:54","ratio":0.59509,"inputTokens":119018,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.888,"originalCredits":4.888,"afterCompact":false},{"index":62,"time":"16:55","ratio":0.685065,"inputTokens":137013,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.27,"originalCredits":4.27,"afterCompact":false},{"index":63,"time":"16:55","ratio":0.77119,"inputTokens":154238,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.377,"originalCredits":4.377,"afterCompact":false},{"index":64,"time":"16:55","ratio":0.77176,"inputTokens":154352,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.409,"originalCredits":1.409,"afterCompact":false},{"index":65,"time":"17:04","ratio":0.27287,"inputTokens":54574,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.555,"originalCredits":7.555,"afterCompact":true},{"index":66,"time":"17:05","ratio":0.37352,"inputTokens":74704,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.695,"originalCredits":4.695,"afterCompact":false},{"index":67,"time":"17:07","ratio":0.463315,"inputTokens":92663,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.641,"originalCredits":7.641,"afterCompact":false},{"index":68,"time":"17:07","ratio":0.582225,"inputTokens":116445,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.297,"originalCredits":4.297,"afterCompact":false},{"index":69,"time":"17:08","ratio":0.58689,"inputTokens":117378,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.092,"originalCredits":1.092,"afterCompact":false},{"index":70,"time":"10:24","ratio":0.591095,"inputTokens":118219,"outputTokens":null,"usageSource":"transcript-ratio","credits":24.167,"originalCredits":24.167,"afterCompact":false},{"index":71,"time":"10:24","ratio":0.682385,"inputTokens":136477,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.19,"originalCredits":4.19,"afterCompact":false},{"index":72,"time":"10:24","ratio":0.76663,"inputTokens":153326,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.463,"originalCredits":4.463,"afterCompact":false},{"index":73,"time":"10:28","ratio":0.35229,"inputTokens":70458,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.965,"originalCredits":10.965,"afterCompact":true},{"index":74,"time":"10:28","ratio":0.43876,"inputTokens":87752,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.073,"originalCredits":4.073,"afterCompact":false},{"index":75,"time":"10:29","ratio":0.44263,"inputTokens":88526,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.482,"originalCredits":4.482,"afterCompact":false},{"index":76,"time":"10:30","ratio":0.56116,"inputTokens":112232,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.714,"originalCredits":7.714,"afterCompact":false}],"identity":{"sumAttributed":8017217,"billedInputTokens":8017217,"absDiff":0,"ok":true},"pluginVersion":"2.7.4","selfCmd":"\"C:\\Users\\75672\\.qoder-cn\\plugins\\cache\\qoder-marketplace\\qoder-credits-inspector\\2.7.4\\bin\\credits-inspector.cmd\" cli","linkHealth":{"matched":0,"requests":76,"coverage":0,"usageSource":"transcript-ratio","breakdown":{"proxy":0,"transcriptTokens":0,"transcriptRatio":76},"logRecords":0,"lastRecordAt":null,"recentRequests":0,"proxyErrors":null,"clientAbort":null,"clientAbortMaxMs":null,"upstreamRejected":null,"aborted":null,"truncated":null,"noUsage":null,"slowestMs":null,"supersededFailure":null},"subagents":{"scanned":false,"dir":null,"probedPaths":["C:\\Users\\75672\\.qoder-cn\\projects\\E--HongWork-MySelf-MyKnowledge-Embedded-Knowledge-System-V2026\\e249c29a-3b79-4800-beee-5fdbf3b7babf\\subagents","C:\\Users\\75672\\.qoder-cn\\projects\\e249c29a-3b79-4800-beee-5fdbf3b7babf\\subagents"],"reason":"no-dir","count":0,"items":[],"totals":{"roundTrips":0,"billedInputTokens":0,"credits":0,"originalCredits":0},"combined":{"roundTrips":76,"billedInputTokens":8017217,"credits":305.918,"originalCredits":305.918}},"manual":null,"artifacts":{"report":"report.json","canvas":"阅读agent.md， 搜索合适的skill,__e249c29a.canvas.tsx"}} as unknown as Report;

function human(n: number): string {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}

function pct(x: number): string {
  return (x * 100).toFixed(1) + "%";
}

// —— 可用性口径：把 report.availability 翻成人话，并决定某个数字该显示值、「≈」还是「—」——
const AVAIL_LABEL: Record<string, string> = {
  measured: "实测",
  derived: "推导",
  fallback: "回退",
  manual: "手工",
  unavailable: "不可用",
};

const SOURCE_LABEL: Record<string, string> = {
  "desktop-rich": "桌面端富转录",
  "ide-lite": "IDE 端精简转录",
  unknown: "来源未知",
};

function availOf(av: Availability | undefined, key: keyof Availability, dflt: Avail = "measured"): Avail {
  return (av?.[key] as Avail | undefined) ?? dflt;
}

/** 段标题旁的性质标注：实测不标（默认就是实测），其余标出来。 */
function availTag(av: Availability | undefined, key: keyof Availability, dflt: Avail = "measured"): string {
  const v = availOf(av, key, dflt);
  return v === "measured" ? "" : `（${AVAIL_LABEL[v]}）`;
}

/** 不可用的量显示「—」而不是 0：IDE 端的 0 是「读不到」，不是「没发生」。 */
function orDash(
  v: number,
  av: Availability | undefined,
  key: keyof Availability,
  fmt: (n: number) => string = String
): string {
  return availOf(av, key) === "unavailable" ? "—" : fmt(v);
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "read":
      return "读取";
    case "write":
      return "写入";
    case "search":
      return "搜索";
    case "shell":
      return "命令";
    default:
      return "其他";
  }
}

function shortTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function SessionTokensReport() {
  if (!REPORT) {
    return (
      <ReportShell width="wide" ariaLabel="会话 token 消耗截析">
        <Stack gap="component">
          <H1>会话 token 消耗截析</H1>
          <Text tone="secondary">报告数据尚未注入。请在会话中触发一次 Stop 钩子，或运行 CLI 生成 report.json。</Text>
        </Stack>
      </ReportShell>
    );
  }

  const r = REPORT;
  const s = r.session;
  const c = r.context;
  const t = r.totals;
  const av = r.availability;
  const manual = r.manual ?? null;
  const sourceLabel = SOURCE_LABEL[r.source ?? "unknown"] ?? "来源未知";
  // 有没有 usage 决定整份报告是「真值/推导」还是「一律 —」。手工回填的 credits 不算有 usage，
  // 否则下面按 ratio 推导的图表会照画一堆 0。
  const hasUsage = availOf(av, "roundTrips") === "measured";
  const manualCredits = manual?.credits ?? null;

  // 报告里出现的命令一律用数据层注入的插件入口（Windows 上是自带启动器的绝对路径，免装 Node）。
  // 旧报告没有这个字段时回退原写法，不比改动前更差。
  const CLI = r.selfCmd || "node scripts/cli.mjs";

  // credits 覆盖范围：credits 与「计费输入总量」并排放在头部，读者一除就得到单价。
  // 混合会话里 credits 只来自转录路径的那几笔（实测某会话 413 笔里只有 1 笔带 credits），
  // 部分覆盖不说出来 = 把局部真值当全量展示。
  const cov = r.creditsCoverage ?? null;
  const covPartial = !!(cov && !cov.full && cov.roundTrips > 0);
  const covNote = covPartial ? ` · 仅覆盖 ${cov!.trips}/${cov!.roundTrips} 笔往返（占计费输入 ${pct(cov!.tokenShare)}）` : "";

  // 缓存命中：代理记录里一直带着 cachedTokens，此前采集了却从不呈现。
  const cachedMeasured = availOf(av, "cachedTokens") === "measured";
  const cachedText = cachedMeasured
    ? `输入 ${human(t.billedInputTokens)}，其中缓存命中 ${human(t.cachedTokens ?? 0)}（${pct(t.cachedShare ?? 0)}，${t.cachedTrips ?? 0} 笔往返带缓存）——供应商对重复叠加的前缀打折，故按 token 数的节省大于按计费的节省。`
    : "";

  // 代理告警只在「失败记录仍然成立」时才报：status.json 只写不清，陈旧失败会把用户推去改
  // 本来正确的 Base URL，越修越坏；而同一份报告里的 lastRecordAt / matched 是它在跑的硬证据。
  const proxyAlarm = r.proxy?.status && !r.proxy.statusSuperseded ? r.proxy.status : null;
  const proxyAlive = !proxyAlarm && (r.proxy?.logRecords ?? 0) > 0;

  // 官方 UI 一场会话扣费 = 主链 + 子代理，故有子代理时 headline 必须给 combined，否则比 UI 少一截
  const creditScope =
    r.subagents && r.subagents.count > 0
      ? {
          credits: r.subagents.combined.credits,
          note: `主链 ${t.credits} + 子代理 ${r.subagents.totals.credits} · 原始 ${r.subagents.combined.originalCredits}`,
        }
      : { credits: t.credits, note: `原始 ${t.originalCredits}（实测）` };

  const headline: MetricItem[] = [
    {
      label: "计费输入总量",
      value: hasUsage ? human(t.billedInputTokens) : "—",
      description: hasUsage
        ? availOf(av, "tokens") === "measured"
          ? `Σ prompt_tokens（实测真值）${covPartial ? ` · 覆盖全部 ${cov!.roundTrips} 笔往返` : ""}`
          : `Σ 上下文 × 往返${availTag(av, "tokens", "derived")}${covPartial ? ` · 覆盖全部 ${cov!.roundTrips} 笔往返` : ""}`
        : "转录无 usage",
    },
    {
      label: "当前上下文",
      value: hasUsage ? human(t.netContextTokens) : "—",
      description: hasUsage
        ? `峰值 ${pct(c.peakContextRatio)}${s.compactions ? "（压缩后起算）" : ""}`
        : "转录无 usage",
    },
    {
      label: "重发放大",
      value: hasUsage ? `${t.amplification}×` : "—",
      description: `往返 ${hasUsage ? `${s.roundTrips} 次` : "—"}`,
    },
    {
      label: "Credits",
      // 代理路径（自定义模型）token 是实测真值但 credits 无来源：hasUsage 为真也要显示「—」，
      // 否则 t.credits=0 会被读成「这次没花钱」。
      value:
        manualCredits != null
          ? `${manualCredits}`
          : hasUsage && availOf(av, "credits") !== "unavailable"
            ? `${creditScope.credits}`
            : "—",
      description:
        manualCredits != null
          ? `官方 UI 手工录入 · 本地 ${creditScope.credits}`
          : hasUsage && availOf(av, "credits") !== "unavailable"
            ? `${creditScope.note}${covNote}`
            : r.usageSource === "proxy" || r.usageSource === "transcript-tokens" || r.usageSource === "mixed"
              ? "自定义模型（BYOK）不经 Qoder 计费网关，无 credits 真值"
              : hasUsage
                ? "转录带 usage 但没有 credits 字段，本地无计费真值"
                : "本地不可用，见下方告警",
    },
  ];

  const pieData = r.byCategory.map((x) => ({ label: x.label, value: x.tokens }));

  // 系统提示词是报告里少数「用户能直接动」的一项：它每轮被完整重发，总量 = 每请求规模 × 往返数，
  // 而它的大小由装了多少插件与技能决定。占比小时不必啰嗦。
  const sysCat = r.byCategory.find((x) => x.key === "system");
  const sysNote =
    hasUsage && sysCat && sysCat.share >= 0.1
      ? ` 系统提示词占 ${pct(sysCat.share)}（${human(c.systemPromptTokens)}/请求 × ${s.roundTrips} 次往返 = ${human(sysCat.tokens)}）：它每轮都被完整重发，大小由你装了多少插件与技能决定，精简技能能直接压低这一项——本插件自己的技能描述也常驻在里面（约 170 token）。`
      : "";

  const tools = r.byTool.slice(0, 8);
  const toolCategories = tools.map((x) => x.tool);
  const toolSeries = [{ name: "重发 tokens", data: tools.map((x) => x.tokens) }];
  // 「单次」= 平均每次调用带来的重发 token。总量榜会埋掉次数少但每次极贵的工具：
  // 实测 Read 只 29 次却吃 335 万，单次是 Edit 的 2.6 倍。
  const toolRows = tools.map((x) => [
    x.tool,
    human(x.tokens),
    pct(x.share),
    String(x.calls),
    x.perCall == null ? "—" : human(x.perCall),
  ]);

  const files = r.byFile.slice(0, 20);
  const fileRows = files.map((f) => [
    f.label,
    kindLabel(f.kind),
    human(f.billed),
    pct(f.share),
    f.perRead == null ? "—" : human(f.perRead),
    String(f.trips),
    String(f.reads),
  ]);

  const byReq = r.byRequest ?? [];
  const reqLabels = byReq.map((x, i) => x.time || `#${x.index ?? i + 1}`);
  const reqInputs = byReq.map((x) => x.inputTokens);
  const reqCredits = byReq.map((x) => x.credits);
  // credits 只在覆盖全部往返时才画曲线：部分覆盖（BYOK 混合会话实测 413 笔里 1 笔有 credits）
  // 画出来是一地零，既读不出形状，还会暗示「其余往返没花钱」。
  const showCreditsChart = hasUsage && !covPartial && availOf(av, "credits") !== "unavailable";

  // 按类别下钻：类别小计行（accent/neutral）+ 其工具/文件明细行（default），用 rowTone 分组着色。
  const catDetail = r.byCategoryDetail ?? [];
  const detailRows: string[][] = [];
  const detailTones: ("accent" | "neutral" | "default")[] = [];
  for (const cc of catDetail) {
    const hasKids = cc.children.length > 0;
    detailRows.push([cc.label, "—", hasKids ? "小计" : "（整体，无工具/文件归属）", human(cc.tokens), pct(cc.share), "100%", "—"]);
    detailTones.push(hasKids ? "accent" : "neutral");
    for (const k of cc.children) {
      detailRows.push(["", k.tool || "—", k.label, human(k.tokens), pct(k.share), pct(k.catShare), String(k.trips)]);
      detailTones.push("default");
    }
  }

  // 子代理账：Agent 派发的子代理消耗不在主链里，单独一段呈现（无子代理则整段不渲染）。
  const sub = r.subagents;
  const subItems = sub?.items ?? [];
  const subRows: string[][] = [];
  const subTones: ("accent" | "default")[] = [];
  for (const a of subItems) {
    subRows.push([
      a.description || a.agentId,
      a.agentType || "—",
      String(a.roundTrips),
      human(a.billedInputTokens),
      pct(a.peakContextRatio),
      String(a.credits),
      String(a.originalCredits),
      a.error || "—",
    ]);
    subTones.push("default");
  }
  if (sub && subItems.length > 0) {
    subRows.push([
      "合计（主链 + 子代理）",
      "—",
      String(sub.combined.roundTrips),
      human(sub.combined.billedInputTokens),
      "—",
      String(sub.combined.credits),
      String(sub.combined.originalCredits),
      `主链 ${t.credits} / 子代理 ${sub.totals.credits}`,
    ]);
    subTones.push("accent");
  }

  // 压缩单笔成本：输入/摘要一律取数据层归一后的生效值（有代理实测就是实测，否则是客户端自估），
  // 并用「口径」列把两者分开——混着显示会让自估值被当成实测。
  const ccost = r.compactionCost;
  const ccItems = ccost?.items ?? [];
  const compactRows: string[][] = ccItems.map((e) => [
    `#${e.index}`,
    shortTime(e.at),
    e.trigger || "—",
    e.effectiveInputTokens == null ? "—" : human(e.effectiveInputTokens),
    e.effectiveOutputTokens == null ? "—" : human(e.effectiveOutputTokens),
    e.nextInputTokens == null ? "—" : human(e.nextInputTokens),
    e.savedTokens == null ? "—" : human(e.savedTokens),
    e.proxy && e.proxy.ms != null ? `${Math.round(e.proxy.ms / 1000)}s` : "—",
    e.proxy ? "实测" : "自估",
  ]);

  // IDE 端仅剩的真值：工具调用次数与文件读取次数（不依赖 usage，两种转录都写 tool_use 块）。
  const residueRows: string[][] = [];
  if (!hasUsage) {
    for (const x of r.byTool.filter((v) => v.calls > 0).sort((a, b) => b.calls - a.calls).slice(0, 15)) {
      residueRows.push([x.tool, "工具", String(x.calls), "—", "—"]);
    }
    for (const f of r.byFile.filter((v) => v.reads > 0).sort((a, b) => b.reads - a.reads).slice(0, 15)) {
      residueRows.push([f.label, kindLabel(f.kind), "—", String(f.reads), String(f.trips)]);
    }
  }

  // A1 三值：一次带 usage 的往返都没有时 0 <= max(2,0) 恒成立，会把「没数据」判成「校验通过」，
  // 故 breakdown.mjs 在 reqCount===0 时给 null；这里必须显示「不适用」而不是绿色通过。
  const identityText =
    r.identity.ok == null
      ? "恒等式 A1 不适用（本转录没有一次带 usage 的往返）。"
      : r.identity.ok
        ? `归因覆盖 ${pct(t.coverage)}${availTag(av, "categoryShare", "derived")}，恒等式 A1 通过（|Δ|=${r.identity.absDiff}）。`
        : `归因覆盖 ${pct(t.coverage)}，恒等式 A1 未通过（|Δ|=${r.identity.absDiff}）。`;
  // 窗口读不到时是静默回退的 200000，而所有 token 数字都乘它 —— 必须显式标 ≈ 与来源。
  const cwIsFallback = availOf(av, "contextWindow") === "fallback";
  const cwText = cwIsFallback ? `≈${human(c.contextWindow)}（回退值）` : human(c.contextWindow);
  // 当前占用头条：以最新上下文（currentContextTokens）为准；段内单调递增 ⇒ 旧版峰值与当前恒等，故合并为一条。
  const curCtx = c.currentContextTokens ?? c.peakContextTokens;
  const netAdv = c.netUserAdvice || c.peakUserAdvice || c.peakAdvice || null;
  const limitSrcLabel =
    c.userContextLimitSource === "manual" ? "手工"
    : c.userContextLimitSource === "config" ? "配置"
    : c.userContextLimitSource === "derived" ? "实测反推"
    : "默认";
  // 阈值来源非 manual/config/derived ⇒ 用的是内置兜底 200K，不是用户在 Qoder 设的真值，需显式提示如何改。
  const limitIsDefault = c.userContextLimitSource !== "manual" && c.userContextLimitSource !== "config" && c.userContextLimitSource !== "derived";
  // 上下文对比表：把旧版挤成一段小字的「界面显示 / 自动压缩实况 / 历史高点」拆成可扫读的行，无数据不占位。
  const ctxRows: string[][] = [];
  if (c.userContextLimit != null && Number.isFinite(c.contextWindow)) {
    ctxRows.push(
      c.contextWindow > c.userContextLimit
        ? ["Qoder 界面进度条", pct(c.netWindowRatio ?? c.peakContextRatio), `按模型物理窗口 ${cwText} 算，比你真实占比低约 ${(c.contextWindow / c.userContextLimit).toFixed(1)} 倍——界面显得偏空、有迷惑性，别信它`]
        : ["Qoder 界面进度条", pct(c.netWindowRatio ?? c.peakContextRatio), `按模型窗口 ${cwText} 算，与你实设上限一致，显示无偏差`],
    );
  }
  if (c.observedAutoCompactions != null && c.observedAutoCompactions > 0 && c.observedAutoTriggerTokens != null) {
    ctxRows.push(["自动压缩实况", `自动 ${c.observedAutoCompactions} 次`, `触发点在 ~${human(c.observedAutoTriggerTokens)}（窗口的 ${pct(c.autoTriggerRatio ?? 0)}）`]);
  } else if (s.compactions > 0) {
    ctxRows.push(["压缩实况", `手动 ${s.compactions} 次`, "本场未见自动压缩，均为你手动触发"]);
  }
  if (c.peakSessionNotable) {
    ctxRows.push(["压缩前历史高点", `${pct(c.peakSessionRatio ?? 0)}（${human(c.peakSessionTokens ?? 0)}）`, "本场曾达到的最高占用"]);
  }

  // 链路健康度：把 --request-log 的逐笔归因压成一行结论（明细属于排障，留在 CLI）。
  // 分两档：本会话确实走在代理链路上（proxy/mixed）才印「最近 N 笔」的失败统计与排障命令；
  // token 全来自转录的会话里，那些统计说的是别的会话，印成 warning + 命令是噪音，只留覆盖率与最近记录时间。
  // 纯官方模型用户从没配过代理，整行不渲染。
  const lhRaw = r.linkHealth ?? null;
  const lh = lhRaw && (r.proxy?.configured || lhRaw.matched > 0) ? lhRaw : null;
  const lhOnPath = !!lh && (lh.matched > 0 || lh.usageSource === "proxy" || lh.usageSource === "mixed");
  const lhErrors = lh ? lh.proxyErrors ?? 0 : 0;
  const lhBad = lhOnPath && lhErrors > 0;
  const lhTone: "info" | "warning" = lhBad ? "warning" : "info";
  // 三档拆分一行说清：代理实测 / 转录 input_tokens / 转录 ratio×window 各多少笔。
  // 旧报告（v3）无 breakdown 字段时退回到只报 matched。
  const lhBd = lh?.breakdown ?? null;
  const lhBdText = lhBd
    ? `拆分：代理 ${lhBd.proxy} 笔 · 转录 input_tokens ${lhBd.transcriptTokens} 笔 · 转录 ratio×窗口 ${lhBd.transcriptRatio} 笔`
    : "";
  const lhSrcNote = !lh
    ? ""
    : lh.usageSource === "proxy"
      ? "：全部为供应商实测"
      : lh.usageSource === "transcript-tokens"
        ? "：本会话 token 全来自转录 input_tokens（BYOK，代理未在链路上）"
        : lh.usageSource === "transcript-ratio"
          ? "：本会话 token 由 ratio×窗口推导（官方模型）"
          : lh.usageSource === "mixed"
            ? "：多源混合，以下拆分列为准"
            : lh.usageSource === "transcript"
              ? "：本会话 token 全部来自转录，代理不在链路上"
              : "";
  const lhText = !lh
    ? ""
    : [
        lh.requests > 0
          ? `代理覆盖 ${lh.matched}/${lh.requests} 笔往返（${pct(lh.coverage)}）${lhSrcNote}`
          : "本会话没有带 usage 的往返，代理无从覆盖",
        lhBdText,
        lh.lastRecordAt ? `代理最近记录 ${shortTime(lh.lastRecordAt)}` : proxyAlive ? "代理有记录但无时间戳" : "代理从未记到流量",
        lhOnPath && lh.recentRequests
          ? `最近 ${lh.recentRequests} 笔：代理失败 ${lh.proxyErrors} · 上游报错 ${lh.upstreamRejected} · 客户端提前断开 ${lh.aborted} · 成功但无 usage ${lh.noUsage}${
              lh.slowestMs != null ? ` · 最慢 ${Math.round(lh.slowestMs / 1000)}s` : ""
            }`
          : lhOnPath
            ? "请求诊断日志为空（运行中的代理是旧版，或还没记到）"
            : "",
        lhBad ? `有「代理失败」= 请求没出得去或代理自己抛了，跑 ${CLI} --request-log 看归因` : "",
        !lhOnPath && lhErrors > 0 ? `代理另有 ${lhErrors} 笔失败，属于走代理的那些会话` : "",
        lh.supersededFailure
          ? `${shortTime(lh.supersededFailure.at ?? null)} 那条「拉起失败（${lh.supersededFailure.error}）」已被之后的流量推翻，无需处理`
          : "",
      ]
        .filter(Boolean)
        .join("。") + "。";

  return (
    <ReportShell width="wide" ariaLabel="会话 token 消耗截析">
      <Stack gap="sectionCompact">
        <header>
          <Stack gap="component">
            <H1>会话 token 消耗截析</H1>
            <Text tone="secondary">
              {s.model || "未知模型"}
              {s.modelSource === "manual" ? "（手工录入）" : ""} · {sourceLabel} · 会话{" "}
              {String(s.id || "").slice(0, 8)}
              {s.title ? `「${s.title}」` : ""} · {shortTime(s.startedAt)} →{" "}
              {shortTime(s.endedAt)} · 压缩{" "}
              {availOf(av, "compactions") === "unavailable" ? "—" : `${s.compactions} 次`}
              {r.usageSource ? ` · usage 来源 ${
                r.usageSource === "proxy"
                  ? "代理实测"
                  : r.usageSource === "transcript-tokens"
                    ? "转录 input_tokens"
                    : r.usageSource === "transcript-ratio"
                      ? "转录 ratio×窗口"
                      : r.usageSource === "mixed"
                        ? "多源混合"
                        : "转录"
              }` : ""}
              {r.pluginVersion ? ` · v${r.pluginVersion}` : ""} · schema v{r.schemaVersion}
            </Text>
            <MetricsGrid variant="header" columns={4} items={headline} />
          </Stack>
        </header>

        {!hasUsage && r.source === "desktop-rich" && (
          <Callout tone="danger" title="本报告数值不可用：自定义模型（BYOK）不经 Qoder 计费网关">
            转录是桌面端富布局，但 assistant entry 里没有 message.usage——自定义模型（如千问
            tokenplan）的响应不经 Qoder 计费网关，credits / context_usage_ratio 无来源，提供商返回的
            usage 客户端也不落盘（已实测扫过 ~/.qoder-cn、~/.qoder、~/.qoder-cli 与 %APPDATA%\QoderCN）。
            本地补救（改一个配置文件即可，免装 Node、之后全自动）：编辑 {"`~/.qoder-credits-proxy/config.json`"}，
            把 {"`upstream`"} 填成你的供应商根地址（= Base URL 去掉结尾 /v1），再把自定义模型 Base URL 的 host:port
            换成 {`127.0.0.1:${r.proxy?.port ?? 49787}`}（路径保留），新开一个会话即自动拉起代理、按 message.id
            精确 join 出实测 token（credits 仍无真值）。装了 Node 也可用 {"`--setup-proxy`"} / {"`--check-proxy`"} 一步到位。
            手工回填通道同样可用：
            {"`.qoder-credits/overrides/<sessionId>.json`"}。
          </Callout>
        )}

        {!hasUsage && r.source !== "desktop-rich" && (
          <Callout tone="danger" title="本报告数值不可用：转录不含 message.usage">
            这是 {sourceLabel}（IDE 端客户端）。它的转录只写 session_meta / user / assistant / progress 四种 entry，
            message.usage 整个字段不存在，也不落到本地任何其它文件（已实测扫过 ~/.qoder-cn、~/.qoder、
            ~/.qoder-cli 与 %APPDATA%\QoderCN）。因此 Credits、token 与各类占比一律显示「—」而不是 0 ——
            0 会被误读成「这次没花钱」。真值只有官方 UI 有：把它填进{" "}
            {"`.qoder-credits/overrides/<sessionId>.json`"} 后重跑，上方会出现「官方 UI 真值」一段并与本地并列对账。
          </Callout>
        )}

        {manual && (
          <Callout tone="success" title="官方 UI 真值（手工录入，未覆盖任何本地数字）">
            Credits {manual.credits ?? "—"} · 原价 {manual.originalCredits ?? "—"}
            {manual.model ? ` · 模型 ${manual.model}` : ""}
            {manual.durationMin != null ? ` · 时长 ${manual.durationMin} min` : ""}
            {manual.startedAt ? ` · ${shortTime(manual.startedAt)}` : ""}
            {manual.localCoverage != null
              ? ` · 本地${manual.localScope === "combined" ? "合计（主链+子代理）" : "主链"} ${manual.localCredits ?? t.credits}，覆盖 ${pct(manual.localCoverage)}`
              : " · 本地无 usage，无法对账"}
            {manual.note ? `。备注：${manual.note}` : ""}
          </Callout>
        )}

        {sub && sub.count === 0 && sub.reason && sub.reason !== "no-dir" && (
          <Callout tone="warning" title={`子代理账未汇总（${sub.reason}）`}>
            探测过的候选目录：{(sub.probedPaths ?? []).join("  |  ") || "（无）"}
          </Callout>
        )}

        {proxyAlarm && (
          <Callout tone="warning" title={`代理自动启动失败（${proxyAlarm.error}）`}>
            {proxyAlarm.error === "EADDRINUSE"
              ? `端口 ${proxyAlarm.port ?? "—"} 被占用，自定义模型将无法对话。请换一个空闲端口重启代理：${CLI} --setup-proxy --port <新端口>，并把模型 Base URL 改成新端口。`
              : `代理未就绪（${proxyAlarm.error}），自定义模型可能无法对话。请运行 ${CLI} --check-proxy 查看链路状态。`}
          </Callout>
        )}

        {r.proxy?.dormant && !proxyAlarm && (
          <Callout tone="info" title="代理长期空闲">
            代理已配置但超过 14 天没有记录到流量（可能你已改回官方模型）。如不再使用自定义模型，可运行{" "}
            {CLI} --stop-proxy 停用代理；保留也不影响官方模型。
          </Callout>
        )}

        {cwIsFallback && (
          <Callout tone="warning" title="上下文窗口为回退值 200K（未从 runtime-config / usage 反推 / ManualTruth 拿到真值）">
            本会话所有以窗口为分母的占比与「峰值建议」都可能偏大，而绝对 token 数（已改以 S 真值为底）不受影响。
            建议在 {"`.qoder-credits/overrides/<sessionId>.json`"} 里手工填 {"`contextWindow`"}（如 qwen3-max=1000000），或等一笔带 input_tokens+ratio 的往返写入转录后自动反推生效。
          </Callout>
        )}

        {hasUsage && netAdv && c.userContextLimit != null && (
          <Stack gap="component">
            <Callout
              tone={netAdv.tone}
              title={`你真实的上下文占用 ${pct(c.netUserRatio ?? c.peakUserRatio ?? 0)}（${human(curCtx)} / 阈值 ${human(c.userContextLimit)}・${limitSrcLabel}）`}
            >
              {netAdv.text}
              {limitIsDefault && (
                <Text tone="secondary">
                  {` ⚙ 这里的 ${human(c.userContextLimit)} 是插件内置默认值，不是你在 Qoder「模型管理」里设的真实上限（插件读不到那个设置）。想按真实阈值算：在 ~/.qoder-credits-proxy/config.json 填 "userContextLimit": <你的上限>（对所有会话生效），或对本会话在 .qoder-credits/overrides/<会话id>.json 填同名字段，重跑报告即生效。`}
                </Text>
              )}
            </Callout>
            {ctxRows.length > 0 && (
              <Table
                headers={["对比口径", "数值", "说明"]}
                rows={ctxRows}
                density="compact"
              />
            )}
          </Stack>
        )}

        {c.thresholdNotEnforced && (
          <Callout tone="warning" title="⚠ 自动压缩不会在你设的阈值触发（本条最重要）">
            你的模型物理窗口是 {cwText}，Qoder 的自动压缩要等上下文涨到窗口 ~85%（≈{human(Math.round(c.contextWindow * 0.85))}）才触发；
            你在模型管理里设的 {human(c.userContextLimit)} 上限远在其下，永远不会触发自动压缩。
            请照上面「你真实的上下文占用」那条，到点自己手动压缩，别等它自动压。
          </Callout>
        )}

        {lh && (
          <Callout tone={lhTone} title="链路健康度">
            {lhText}
          </Callout>
        )}

        <Callout tone="info" title="度量口径">
          计费输入总量逐笔锁定真值（优先级：代理 promptTokens &gt; 转录 usage.input_tokens &gt; ratio{availTag(av, "contextRatio")} × {cwText}
          {cwIsFallback ? "，未拿到真窗口、全部 token 数字随之带 ≈" : ""}）；各类别/文件按块估算规模比例分摊
          {availTag(av, "categoryShare", "derived")}。{identityText}
          {cachedText ? ` ${cachedText}` : ""}
          {covPartial
            ? ` Credits 只来自 ${cov!.trips}/${cov!.roundTrips} 笔往返（占计费输入 ${pct(cov!.tokenShare)}），其余往返走代理实测、不经 Qoder 计费，故不要拿 Credits 去除以计费输入总量算单价。`
            : ""}
        </Callout>

        {byReq.length > 0 && (
          <ReportSection
            title="逐请求明细（每一次往返）"
            description={
              showCreditsChart
                ? "每个 round-trip 的真实输入规模与 credits；曲线骤降处为上下文压缩重置（顶部四项为会话累计，此处为每一次）"
                : `每个 round-trip 的真实输入规模；曲线骤降处为上下文压缩重置。credits 曲线未画：本会话只有 ${cov?.trips ?? 0}/${cov?.roundTrips ?? byReq.length} 笔往返带 credits（其余走代理实测、不经 Qoder 计费），画出来是一地零。`
            }
            meta={`${byReq.length} 次往返 · 压缩 ${orDash(s.compactions, av, "compactions")} 次`}
            divided
          >
            {showCreditsChart ? (
              <ChartComparisonGrid>
                <ChartContainer title="每次输入 tokens" ariaLabel="每次输入 tokens">
                  <LineChart
                    categories={reqLabels}
                    series={[{ name: "输入 tokens", data: reqInputs, tone: "info" }]}
                    height={220}
                    valueFormatter={human}
                    ariaLabel="每次请求输入 tokens"
                  />
                </ChartContainer>
                <ChartContainer title="每次 credits" ariaLabel="每次 credits">
                  <LineChart
                    categories={reqLabels}
                    series={[{ name: "credits", data: reqCredits, tone: "warning" }]}
                    height={220}
                    ariaLabel="每次请求 credits"
                  />
                </ChartContainer>
              </ChartComparisonGrid>
            ) : (
              <ChartContainer title="每次输入 tokens" ariaLabel="每次输入 tokens">
                <LineChart
                  categories={reqLabels}
                  series={[{ name: "输入 tokens", data: reqInputs, tone: "info" }]}
                  height={220}
                  valueFormatter={human}
                  ariaLabel="每次请求输入 tokens"
                />
              </ChartContainer>
            )}
          </ReportSection>
        )}

        {hasUsage && ccItems.length > 0 && (
          <ReportSection
            title="压缩单笔成本（会话里最贵的那几笔调用）"
            description="每次压缩本身就是一笔普通模型调用：整份上下文当 prompt 进去、摘要当 completion 出来。此前报告只显示「压缩 N 次」，把单笔最贵的开销藏成了一个计数。「省下」= 压缩前规模 − 压缩后首轮实测输入（地板）。口径列：实测=能在代理日志里唯一对上的供应商真值；自估=客户端在压缩边界里写的前后规模。"
            meta={`${ccItems.length} 次 · 输入累计 ${human(ccost?.totals.preTokens ?? 0)} · 摘要累计 ${human(ccost?.totals.postTokens ?? 0)} · 累计省下 ${human(ccost?.totals.savedTokens ?? 0)} · 其中 ${ccost?.totals.measured ?? 0} 笔为供应商实测`}
            divided
          >
            <Table
              headers={["第几次", "时刻", "触发", "输入", "摘要输出", "压缩后首轮", "省下", "耗时", "口径"]}
              rows={compactRows}
              density="compact"
              stickyHeader
            />
          </ReportSection>
        )}

        {sub && subItems.length > 0 && (
          <ReportSection
            title="子代理账（Agent 派发）"
            description="子代理的每次往返只写进它自己的独立转录，不计入上方主链任何数字；官方 UI 的一场会话扣费 = 主链 + 各子代理。"
            meta={`${subItems.length} 个子代理 · 主链 ${t.credits} + 子代理 ${sub.totals.credits} = 合计 ${sub.combined.credits} Credits`}
            divided
          >
            <Table
              headers={["子代理", "类型", "往返", "计费输入", "峰值占比", "Credits", "原价", "备注"]}
              rows={subRows}
              rowTone={subTones}
              density="compact"
              stickyHeader
            />
          </ReportSection>
        )}

        {hasUsage && r.byCategory.length > 0 && (
          <ReportSection
            title="按类别占比"
            description={`会话计费输入 token 在各来源间的分布（完整划分，占比之和 = 100%）${sysNote}`}
            meta={human(t.billedInputTokens) + ` tokens${availTag(av, "categoryShare", "derived")}`}
            divided
          >
            <ChartContainer ariaLabel="按类别占比">
              <PieChart donut data={pieData} centerLabel="计费输入" valueFormatter={human} />
            </ChartContainer>
          </ReportSection>
        )}

        {hasUsage && catDetail.length > 0 && (
          <ReportSection
            title="按类别下钻（工具 / 文件路径）"
            description="每个类别的消耗再拆到工具与具体文件/路径：工具返回、工具调用可精确到路径，其余类别为整体（无文件归属）。数值均为重发计费 token。"
            meta={`占总额=占计费输入总量 · 占本类=占该类别 · 程数=存活往返累计${availTag(av, "fileShare", "derived")}`}
            divided
          >
            <Table
              headers={["类别", "工具", "文件 / 路径", "重发 tokens", "占总额", "占本类", "程数"]}
              rows={detailRows}
              rowTone={detailTones}
              density="compact"
              stickyHeader
            />
          </ReportSection>
        )}

        {hasUsage && tools.length > 0 && (
          <ReportSection
            title="按工具占比"
            description="各工具相关内容（调用参数 + 返回）重发累计的计费 token 占比（仅工具相关块，非完整划分，占比之和 < 100%）。「单次」= 平均每次调用带来的重发 token：总量榜会把「次数少但每次极贵」的工具埋掉，这一列专门把它捞出来。"
            meta={`token 占比${availTag(av, "toolShare", "derived")} · 调用次数为实测`}
            divided
          >
            <Stack gap="component">
              <ChartContainer ariaLabel="按工具占比">
                <BarChart horizontal categories={toolCategories} series={toolSeries} valueFormatter={human} ariaLabel="按工具占比" />
              </ChartContainer>
              <Table
                headers={["工具", "重发 tokens", "占比", "调用", "单次"]}
                rows={toolRows}
                density="compact"
                stickyHeader
              />
            </Stack>
          </ReportSection>
        )}

        {hasUsage && fileRows.length > 0 && (
          <ReportSection
            title="按文件占比"
            description="精确到路径/文件名：内容随上下文被重复发送累计的计费 token 占比（Top 20，仅可归因文件的块）。「单次读取」= 这个文件平均每次被读取最终烧掉多少（含此后每一程的重发）——读一次就烧掉十几万的文件，在按总量排序的榜上毫不起眼。"
            meta={`程数=存活往返累计 · 读取=返回次数（实测）${availTag(av, "fileShare", "derived")}`}
            divided
          >
            <Table
              headers={["文件", "种类", "重发 tokens", "占比", "单次读取", "程数", "读取"]}
              rows={fileRows}
              density="compact"
              stickyHeader
            />
          </ReportSection>
        )}

        {!hasUsage && residueRows.length > 0 && (
          <ReportSection
            title="工具调用与文件读取（计数为实测）"
            description="占比与 token 一律不可用，但 tool_use 块两种转录都写，所以「谁被调了几次、谁被读了几次」仍是真值 —— IDE 端不是一无所有。"
            meta={`${t.toolCalls ?? 0} 次工具调用${availTag(av, "toolCalls")} · ${t.fileReads ?? 0} 次文件读取${availTag(av, "fileReads")} · ${s.turns} 轮对话`}
            divided
          >
            <Table
              headers={["工具 / 文件", "种类", "调用", "读取", "程数"]}
              rows={residueRows}
              density="compact"
              stickyHeader
            />
          </ReportSection>
        )}
      </Stack>
    </ReportShell>
  );
}
