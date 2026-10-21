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
const REPORT = {"schemaVersion":3.2,"generatedAt":"2026-10-20T04:15:12.485Z","source":"desktop-rich","usageSource":"transcript-ratio","availability":{"credits":"measured","roundTrips":"measured","contextRatio":"measured","tokens":"derived","outputTokens":"unavailable","cachedTokens":"unavailable","categoryShare":"derived","toolShare":"derived","fileShare":"derived","systemPrompt":"derived","contextWindow":"measured","compactions":"measured","compactionCost":"measured","model":"measured","title":"measured","toolCalls":"measured","fileReads":"measured","userTurns":"measured","userContextLimit":"fallback"},"session":{"id":"bc989a42-c7ae-4387-a4ae-8a99698fc17d","title":"1. docs/AGENTS.md是项目代码架构","titleSource":"first-user","model":"qfmodel","modelSource":"runtime-config","cwd":"E:\\HongWork\\MySelf\\MyKnowledge\\Embedded_Knowledge_System_V2026","turns":32,"roundTrips":182,"compactions":8,"startedAt":"2026-09-02T08:46:32.032Z","endedAt":"2026-09-30T01:54:14.848Z"},"context":{"contextWindow":200000,"contextWindowSource":"runtime-config","systemPromptTokens":22523,"netContextTokens":139195,"peakContextTokens":139195,"peakContextRatio":0.695975,"peakSessionTokens":153104,"peakSessionRatio":0.76552,"peakSessionNotable":true,"peakAdvice":{"level":"sweet","tone":"success","text":"正处性价比区间（65–85%）。此时压一次每轮省得最多，且第一轮就回本"},"userContextLimit":200000,"userContextLimitSource":"default","peakUserRatio":0.695975,"peakUserAdvice":{"level":"sweet","tone":"success","text":"正处性价比区间（65–85%）。此时压一次每轮省得最多，且第一轮就回本"},"currentContextTokens":139195,"netUserRatio":0.695975,"netUserAdvice":{"level":"sweet","tone":"success","text":"正处性价比区间（65–85%）。此时压一次每轮省得最多，且第一轮就回本"},"netWindowRatio":0.695975,"observedAutoCompactions":8,"observedAutoTriggerTokens":173819,"autoTriggerRatio":0.869095,"thresholdNotEnforced":false},"totals":{"billedInputTokens":15765644,"netContextTokens":139195,"peakContextTokens":139195,"amplification":113.26,"attributedTokens":15765644,"coverage":1,"credits":1137.576,"originalCredits":1137.576,"outputTokens":0,"cachedTokens":0,"cachedTrips":0,"cachedShare":0,"toolCalls":253,"fileReads":202},"creditsCoverage":{"trips":182,"roundTrips":182,"tokens":15765644,"tokenShare":0.9999999920713674,"full":true},"compactionCost":{"count":8,"items":[{"index":1,"at":"2026-09-29T02:07:19.234Z","trigger":"auto","preTokens":178473,"postTokens":8373,"messagesSummarized":266,"nextRequestIndex":48,"nextInputTokens":43693,"savedTokens":134780,"proxy":null,"effectiveInputTokens":178473,"effectiveOutputTokens":8373},{"index":2,"at":"2026-09-29T02:28:24.570Z","trigger":"auto","preTokens":173819,"postTokens":9318,"messagesSummarized":185,"nextRequestIndex":89,"nextInputTokens":44933,"savedTokens":128886,"proxy":null,"effectiveInputTokens":173819,"effectiveOutputTokens":9318},{"index":3,"at":"2026-09-29T03:12:54.646Z","trigger":"auto","preTokens":171431,"postTokens":8897,"messagesSummarized":167,"nextRequestIndex":121,"nextInputTokens":44727,"savedTokens":126704,"proxy":null,"effectiveInputTokens":171431,"effectiveOutputTokens":8897},{"index":4,"at":"2026-09-29T03:26:22.421Z","trigger":"auto","preTokens":168022,"postTokens":10235,"messagesSummarized":42,"nextRequestIndex":127,"nextInputTokens":45391,"savedTokens":122631,"proxy":null,"effectiveInputTokens":168022,"effectiveOutputTokens":10235},{"index":5,"at":"2026-09-29T03:33:29.936Z","trigger":"auto","preTokens":175659,"postTokens":10011,"messagesSummarized":36,"nextRequestIndex":134,"nextInputTokens":45102,"savedTokens":130557,"proxy":null,"effectiveInputTokens":175659,"effectiveOutputTokens":10011},{"index":6,"at":"2026-09-29T03:40:44.392Z","trigger":"auto","preTokens":174649,"postTokens":11075,"messagesSummarized":43,"nextRequestIndex":141,"nextInputTokens":46107,"savedTokens":128542,"proxy":null,"effectiveInputTokens":174649,"effectiveOutputTokens":11075},{"index":7,"at":"2026-09-29T03:51:20.810Z","trigger":"auto","preTokens":171052,"postTokens":10794,"messagesSummarized":46,"nextRequestIndex":147,"nextInputTokens":45854,"savedTokens":125198,"proxy":null,"effectiveInputTokens":171052,"effectiveOutputTokens":10794},{"index":8,"at":"2026-09-29T04:10:34.868Z","trigger":"auto","preTokens":169504,"postTokens":9175,"messagesSummarized":50,"nextRequestIndex":153,"nextInputTokens":42892,"savedTokens":126612,"proxy":null,"effectiveInputTokens":169504,"effectiveOutputTokens":9175}],"totals":{"preTokens":1382609,"postTokens":77878,"savedTokens":1023910,"measured":0}},"proxy":{"matched":0,"requests":182,"breakdown":{"proxy":0,"transcriptTokens":0,"transcriptRatio":182},"logPath":"C:\\Users\\75672\\.qoder-credits-proxy\\usage.jsonl","logExists":false,"logRecords":0,"configured":false,"enabled":true,"port":49787,"lastRecordAt":null,"dormant":false,"status":null,"statusSuperseded":false},"byCategory":[{"key":"tool_result","label":"工具返回","tokens":1732399,"share":0.10988442006716413},{"key":"system","label":"系统提示词","tokens":4099186,"share":0.2600075201495099},{"key":"compact_summary","label":"压缩摘要","tokens":939807,"share":0.05961110576760344},{"key":"assistant_thinking","label":"模型思考","tokens":1132887,"share":0.07185794660714025},{"key":"assistant_tool_use","label":"工具调用","tokens":310422,"share":0.01968977027543227},{"key":"assistant_text","label":"模型回复","tokens":240658,"share":0.015264722518982837},{"key":"user_input","label":"用户输入","tokens":1018886,"share":0.06462695624385986},{"key":"attachment","label":"附件/技能","tokens":6291399,"share":0.39905755044167457}],"byCategoryDetail":[{"key":"tool_result","label":"工具返回","tokens":1732399,"share":0.10988442006716413,"children":[{"tool":"Agent","label":"（无路径）","kind":"other","tokens":450085,"share":0.02854846612355632,"catShare":0.25980449372264763,"trips":129},{"tool":"Grep","label":"App/ftest","kind":"search","tokens":188764,"share":0.011973148998700278,"catShare":0.10896129761964424,"trips":344},{"tool":"Bash","label":"（无路径）","kind":"shell","tokens":186454,"share":0.011826631004547311,"catShare":0.1076279148337733,"trips":726},{"tool":"Grep","label":"Utils/icp_log.h","kind":"search","tokens":104829,"share":0.006649221814003002,"catShare":0.0605110516116737,"trips":40},{"tool":"Grep","label":"Udd/device/arm/ddl_arm.c","kind":"search","tokens":101473,"share":0.006436306333829251,"catShare":0.05857342041660882,"trips":121},{"tool":"Grep","label":"Utils/ndd_ftest.h","kind":"search","tokens":98307,"share":0.006235515246675254,"catShare":0.05674612691102114,"trips":74},{"tool":"Grep","label":"Udd/device/cpld/ddl_mbcpld_ef3l190.c","kind":"search","tokens":74021,"share":0.0046950951420050594,"catShare":0.04272757811467084,"trips":96},{"tool":"Grep","label":"platform_cmd_echo","kind":"search","tokens":70577,"share":0.004476637608690358,"catShare":0.04073951162461543,"trips":40},{"tool":"Grep","label":"Udd/control/udd_ctrl_eeprom_fru.c","kind":"search","tokens":63656,"share":0.00403762079818597,"catShare":0.03674425178490339,"trips":64},{"tool":"Grep","label":"Udd/bus/ddi_bus_udd_npcp.c","kind":"search","tokens":46864,"share":0.0029725295965238895,"catShare":0.02705141998025748,"trips":139},{"tool":"Grep","label":"Udd/device/cpld/ddl_ibcpld_ef3l190.c","kind":"search","tokens":37808,"share":0.002398101819096812,"catShare":0.021823856536086112,"trips":59},{"tool":"Grep","label":"/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/printf_report.txt","kind":"search","tokens":32533,"share":0.0020635325550228964,"catShare":0.018779118584432746,"trips":9},{"tool":"Grep","label":"Udd/api/nsa_upgrade.c","kind":"search","tokens":26078,"share":0.0016541135380098919,"catShare":0.01505321261193221,"trips":73},{"tool":"Grep","label":"Script/check_printf.sh","kind":"search","tokens":24814,"share":0.0015739258469865064,"catShare":0.014323466839288802,"trips":39},{"tool":"Glob","label":"docs/*IB*","kind":"search","tokens":20168,"share":0.0012792561812419911,"catShare":0.01164183403306927,"trips":24},{"tool":null,"label":"其他 68 项","kind":null,"tokens":205967,"share":0.013064317460089469,"catShare":0.11889144477537605,"trips":2404}]},{"key":"system","label":"系统提示词","tokens":4099186,"share":0.2600075201495099,"children":[]},{"key":"compact_summary","label":"压缩摘要","tokens":939807,"share":0.05961110576760344,"children":[]},{"key":"assistant_thinking","label":"模型思考","tokens":1132887,"share":0.07185794660714025,"children":[]},{"key":"assistant_tool_use","label":"工具调用","tokens":310422,"share":0.01968977027543227,"children":[{"tool":"Bash","label":"（无路径）","kind":"shell","tokens":86573,"share":0.005491275366307515,"catShare":0.27888976303391433,"trips":726},{"tool":"Agent","label":"（无路径）","kind":"other","tokens":42164,"share":0.0026744141535643374,"catShare":0.1358275955561205,"trips":129},{"tool":"Edit","label":"Udd/device/cpld/ddl_mbcpld_ef3l190.c","kind":"write","tokens":24268,"share":0.0015393239349749523,"catShare":0.07817886717020918,"trips":83},{"tool":"Edit","label":"Udd/control/udd_ctrl_eeprom_fru.c","kind":"write","tokens":23560,"share":0.0014943570554697815,"catShare":0.07589509854944078,"trips":120},{"tool":"Edit","label":"Udd/device/cpld/ddl_ibcpld_ef3l190.c","kind":"write","tokens":17399,"share":0.0011036059404936898,"catShare":0.05604971135040128,"trips":118},{"tool":"Grep","label":"/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/App/ftest/ftest_prbs.c","kind":"search","tokens":8306,"share":0.000526810656576325,"catShare":0.026755551192674313,"trips":125},{"tool":"Read","label":"/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/App/ftest/ftest_prbs.c","kind":"read","tokens":8167,"share":0.0005180052229591753,"catShare":0.02630834264255036,"trips":193},{"tool":"Edit","label":"App/ftest/ftest_qdma.c","kind":"write","tokens":7351,"share":0.00046625243570605024,"catShare":0.023679932735823358,"trips":17},{"tool":"Edit","label":"Udd/device/memory/ddl_eeprom.c","kind":"write","tokens":6881,"share":0.00043644458815488506,"catShare":0.022166057909748942,"trips":27},{"tool":"AskUserQuestion","label":"（无路径）","kind":"other","tokens":6503,"share":0.0004124567028455552,"catShare":0.020947766128089077,"trips":11},{"tool":"Grep","label":"App/ftest","kind":"search","tokens":6010,"share":0.0003812043349314498,"catShare":0.019360527299147518,"trips":344},{"tool":"Edit","label":"Udd/bus/ddi_bus_udd_npcp.c","kind":"write","tokens":5785,"share":0.0003669157198713064,"catShare":0.018634840058500943,"trips":52},{"tool":"Grep","label":"Udd/device/memory/ddl_eeprom.c","kind":"search","tokens":4204,"share":0.00026668628501722925,"catShare":0.013544408151373135,"trips":178},{"tool":"Grep","label":"/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/docs","kind":"search","tokens":4087,"share":0.0002592516413572067,"catShare":0.013166818999441837,"trips":88},{"tool":"Read","label":"/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/docs/YLS16002_ftest_mt_port_prbs_测试指南.md","kind":"read","tokens":3898,"share":0.0002472610019845317,"catShare":0.012557840875017694,"trips":75},{"tool":null,"label":"其他 68 项","kind":null,"tokens":55267,"share":0.0035055052352182627,"catShare":0.17803687834754603,"trips":2095}]},{"key":"assistant_text","label":"模型回复","tokens":240658,"share":0.015264722518982837,"children":[]},{"key":"user_input","label":"用户输入","tokens":1018886,"share":0.06462695624385986,"children":[]},{"key":"attachment","label":"附件/技能","tokens":6291399,"share":0.39905755044167457,"children":[]}],"byTool":[{"tool":"Grep","tokens":1083641,"calls":137,"perCall":7910,"share":0.06873432282430873},{"tool":"Agent","tokens":492249,"calls":5,"perCall":98450,"share":0.03122288027712066},{"tool":"Bash","tokens":273028,"calls":45,"perCall":6067,"share":0.01731790637085483},{"tool":"Edit","tokens":100747,"calls":36,"perCall":2799,"share":0.006390299020733985},{"tool":"Read","tokens":48255,"calls":23,"perCall":2098,"share":0.0030607997676996906},{"tool":"Glob","tokens":37214,"calls":6,"perCall":6202,"share":0.0023604643246547445},{"tool":"AskUserQuestion","tokens":7686,"calls":1,"perCall":7686,"share":0.00048751775722369843}],"byFile":[{"attr":"file:App/ftest","label":"App/ftest","kind":"search","tool":"Grep","selfTokens":13148,"reads":19,"trips":688,"billed":194774,"perRead":10251,"share":0.012354353333631756},{"attr":"file:Udd/device/arm/ddl_arm.c","label":"Udd/device/arm/ddl_arm.c","kind":"search","tool":"Grep","selfTokens":5731,"reads":12,"trips":280,"billed":105686,"perRead":8807,"share":0.00670356740097121},{"attr":"file:Utils/icp_log.h","label":"Utils/icp_log.h","kind":"search","tool":"Grep","selfTokens":3007,"reads":1,"trips":80,"billed":105637,"perRead":105637,"share":0.006700472518333456},{"attr":"file:Udd/device/cpld/ddl_mbcpld_ef3l190.c","label":"Udd/device/cpld/ddl_mbcpld_ef3l190.c","kind":"search","tool":"Grep","selfTokens":4639,"reads":9,"trips":402,"billed":104037,"perRead":11560,"share":0.0065989499423060325},{"attr":"file:Utils/ndd_ftest.h","label":"Utils/ndd_ftest.h","kind":"search","tool":"Grep","selfTokens":2987,"reads":2,"trips":148,"billed":99924,"perRead":49962,"share":0.006338075354837913},{"attr":"file:Udd/control/udd_ctrl_eeprom_fru.c","label":"Udd/control/udd_ctrl_eeprom_fru.c","kind":"read","tool":"Read","selfTokens":8052,"reads":20,"trips":402,"billed":92713,"perRead":4636,"share":0.005880670505168923},{"attr":"file:platform_cmd_echo","label":"platform_cmd_echo","kind":"search","tool":"Grep","selfTokens":2029,"reads":1,"trips":80,"billed":71280,"perRead":71280,"share":0.0045212034385429265},{"attr":"file:Udd/device/cpld/ddl_ibcpld_ef3l190.c","label":"Udd/device/cpld/ddl_ibcpld_ef3l190.c","kind":"read","tool":"Read","selfTokens":2177,"reads":7,"trips":420,"billed":61480,"perRead":8783,"share":0.0038995935903089213},{"attr":"file:Udd/bus/ddi_bus_udd_npcp.c","label":"Udd/bus/ddi_bus_udd_npcp.c","kind":"search","tool":"Grep","selfTokens":2486,"reads":8,"trips":442,"billed":58068,"perRead":7259,"share":0.0036832108364198693},{"attr":"file:/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/printf_report.txt","label":"/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/printf_report.txt","kind":"read","tool":"Read","selfTokens":7110,"reads":3,"trips":30,"billed":33265,"perRead":11088,"share":0.0021099570782717575},{"attr":"file:Udd/device/memory/ddl_eeprom.c","label":"Udd/device/memory/ddl_eeprom.c","kind":"search","tool":"Grep","selfTokens":1367,"reads":8,"trips":470,"billed":32893,"perRead":4112,"share":0.002086384907098916},{"attr":"file:/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/App/ftest/ftest_prbs.c","label":"/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/App/ftest/ftest_prbs.c","kind":"read","tool":"Read","selfTokens":571,"reads":9,"trips":636,"billed":30002,"perRead":3334,"share":0.001902998059056707},{"attr":"file:Udd/api/nsa_upgrade.c","label":"Udd/api/nsa_upgrade.c","kind":"search","tool":"Grep","selfTokens":832,"reads":2,"trips":146,"billed":27487,"perRead":13744,"share":0.0017434877475855151},{"attr":"file:Script/check_printf.sh","label":"Script/check_printf.sh","kind":"search","tool":"Grep","selfTokens":744,"reads":1,"trips":78,"billed":25677,"perRead":25677,"share":0.0016286520586341598},{"attr":"file:App/ftest/ftest_qdma.c","label":"App/ftest/ftest_qdma.c","kind":"search","tool":"Grep","selfTokens":1787,"reads":6,"trips":188,"billed":22102,"perRead":3684,"share":0.001401890158615202},{"attr":"file:App/ftest/ftest_atc.c","label":"App/ftest/ftest_atc.c","kind":"search","tool":"Grep","selfTokens":2178,"reads":9,"trips":180,"billed":21477,"perRead":2386,"share":0.0013622783053836485},{"attr":"file:docs/*IB*","label":"docs/*IB*","kind":"search","tool":"Glob","selfTokens":694,"reads":1,"trips":48,"billed":20344,"perRead":20344,"share":0.0012904124851481715},{"attr":"file:Udd/device/cpld/ddl_cpld_ef3l90.c","label":"Udd/device/cpld/ddl_cpld_ef3l90.c","kind":"search","tool":"Grep","selfTokens":749,"reads":2,"trips":102,"billed":18111,"perRead":9055,"share":0.0011487632275972248},{"attr":"file:Udd","label":"Udd","kind":"search","tool":"Grep","selfTokens":5811,"reads":12,"trips":90,"billed":11750,"perRead":979,"share":0.000745293052552652},{"attr":"file:Udd/device/pll/ddl_sky63104.c","label":"Udd/device/pll/ddl_sky63104.c","kind":"search","tool":"Grep","selfTokens":398,"reads":3,"trips":158,"billed":11700,"perRead":3900,"share":0.0007421202611942777},{"attr":"file:Script","label":"Script","kind":"search","tool":"Grep","selfTokens":1325,"reads":5,"trips":66,"billed":10302,"perRead":2060,"share":0.0006534607975607892},{"attr":"file:App/ftest/ftest_prbs.c","label":"App/ftest/ftest_prbs.c","kind":"search","tool":"Glob","selfTokens":1138,"reads":2,"trips":96,"billed":8989,"perRead":4494,"share":0.0005701480047194257},{"attr":"file:**/ftest_prbs*","label":"**/ftest_prbs*","kind":"search","tool":"Glob","selfTokens":135,"reads":1,"trips":82,"billed":8614,"perRead":8614,"share":0.0005463628101318752},{"attr":"file:/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/Udd/platform/udd_model.h","label":"/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/Udd/platform/udd_model.h","kind":"read","tool":"Read","selfTokens":189,"reads":3,"trips":192,"billed":8567,"perRead":2856,"share":0.00054341121752937},{"attr":"file:App/ftest/ftest_clk.c","label":"App/ftest/ftest_clk.c","kind":"search","tool":"Grep","selfTokens":1183,"reads":1,"trips":14,"billed":7307,"perRead":7307,"share":0.0004634975989304321},{"attr":"file:/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/docs/YLS16002_ftest_mt_port_prbs_测试指南.md","label":"/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/docs/YLS16002_ftest_mt_port_prbs_测试指南.md","kind":"read","tool":"Read","selfTokens":122,"reads":2,"trips":150,"billed":6931,"perRead":3466,"share":0.0004396485698741331},{"attr":"file:/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/docs","label":"/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/docs","kind":"search","tool":"Grep","selfTokens":152,"reads":3,"trips":176,"billed":6010,"perRead":2003,"share":0.0003811881622581893},{"attr":"file:/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/docs/YLS16002_IB1_IB8_ftest_port_prbs_cmd_ref.md","label":"/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/docs/YLS16002_IB1_IB8_ftest_port_prbs_cmd_ref.md","kind":"read","tool":"Read","selfTokens":140,"reads":2,"trips":122,"billed":5941,"perRead":2971,"share":0.000376854250274366},{"attr":"file:App/ftest/ftest_upgrade.c","label":"App/ftest/ftest_upgrade.c","kind":"search","tool":"Grep","selfTokens":1120,"reads":1,"trips":12,"billed":5932,"perRead":5932,"share":0.00037624619300760713},{"attr":"file:docs/*port_prbs*","label":"docs/*port_prbs*","kind":"search","tool":"Glob","selfTokens":94,"reads":1,"trips":78,"billed":5607,"perRead":5607,"share":0.00035564302245869636},{"attr":"file:/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP","label":"/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP","kind":"search","tool":"Grep","selfTokens":253,"reads":4,"trips":138,"billed":5493,"perRead":1373,"share":0.00034843658321329025},{"attr":"file:App/ftest/ftest_device.c","label":"App/ftest/ftest_device.c","kind":"search","tool":"Grep","selfTokens":901,"reads":1,"trips":12,"billed":4772,"perRead":4772,"share":0.00030267662491058393},{"attr":"file:App/ftest/ftest_extern_lpbk.c","label":"App/ftest/ftest_extern_lpbk.c","kind":"search","tool":"Grep","selfTokens":959,"reads":1,"trips":10,"billed":4216,"perRead":4216,"share":0.0002674063719778101},{"attr":"file:docs/ICP2P0-1-17_打印与日志接口统一化设计方案.md","label":"docs/ICP2P0-1-17_打印与日志接口统一化设计方案.md","kind":"search","tool":"Grep","selfTokens":119,"reads":2,"trips":146,"billed":3899,"perRead":1949,"share":0.0002472841095822812},{"attr":"file:App","label":"App","kind":"search","tool":"Grep","selfTokens":249,"reads":4,"trips":122,"billed":3210,"perRead":803,"share":0.00020363112462892872},{"attr":"file:App/ftest/ftest_ilkn_prbs.c","label":"App/ftest/ftest_ilkn_prbs.c","kind":"search","tool":"Grep","selfTokens":453,"reads":1,"trips":14,"billed":2798,"perRead":2798,"share":0.00017748471032585437},{"attr":"file:/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/Udd/platform","label":"/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/Udd/platform","kind":"search","tool":"Grep","selfTokens":51,"reads":1,"trips":70,"billed":2623,"perRead":2623,"share":0.000166360374994276},{"attr":"file:App/ftest/ftest_versal_ddr.c","label":"App/ftest/ftest_versal_ddr.c","kind":"search","tool":"Grep","selfTokens":687,"reads":1,"trips":8,"billed":2392,"perRead":2392,"share":0.0001517000742024071},{"attr":"file:/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/Udd/device/cpld/ddl_eth_cpld_machxo3.c","label":"/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/Udd/device/cpld/ddl_eth_cpld_machxo3.c","kind":"search","tool":"Grep","selfTokens":955,"reads":2,"trips":10,"billed":2150,"perRead":1075,"share":0.00013634749351742223},{"attr":"file:/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/Udd/control/udd_ctrl_qsfp.c","label":"/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/Udd/control/udd_ctrl_qsfp.c","kind":"search","tool":"Grep","selfTokens":816,"reads":2,"trips":10,"billed":1841,"perRead":921,"share":0.00011678675995956697},{"attr":"file:App/ftest/ftest_power.c","label":"App/ftest/ftest_power.c","kind":"search","tool":"Grep","selfTokens":308,"reads":1,"trips":12,"billed":1631,"perRead":1631,"share":0.00010346770307709197},{"attr":"file:define MBCPLD_EF3L90_FLASH_PAGE_SIZE","label":"define MBCPLD_EF3L90_FLASH_PAGE_SIZE","kind":"search","tool":"Grep","selfTokens":61,"reads":1,"trips":48,"billed":1374,"perRead":1374,"share":0.00008713333211523938},{"attr":"file:/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/App/ftest","label":"/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/App/ftest","kind":"search","tool":"Grep","selfTokens":52,"reads":1,"trips":44,"billed":1315,"perRead":1315,"share":0.00008337921040962548},{"attr":"file:define EF3L90_FLASH_PAGE_SIZE","label":"define EF3L90_FLASH_PAGE_SIZE","kind":"search","tool":"Grep","selfTokens":57,"reads":1,"trips":48,"billed":1284,"perRead":1284,"share":0.00008141967099292863},{"attr":"file:/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/App/ftest/ftest_prbs.h","label":"/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/App/ftest/ftest_prbs.h","kind":"read","tool":"Read","selfTokens":57,"reads":1,"trips":36,"billed":1109,"perRead":1109,"share":0.00007032705689188735},{"attr":"file:App/ftest/ftest_sma.c","label":"App/ftest/ftest_sma.c","kind":"search","tool":"Grep","selfTokens":214,"reads":1,"trips":10,"billed":941,"perRead":941,"share":0.00005967149489390131},{"attr":"file:/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/Script/config/HF8/YLS16002_VersionNote.txt","label":"/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/Script/config/HF8/YLS16002_VersionNote.txt","kind":"read","tool":"Read","selfTokens":66,"reads":1,"trips":26,"billed":940,"perRead":940,"share":0.00005959388063271585},{"attr":"file:App/ftest/ftest_emmc.c","label":"App/ftest/ftest_emmc.c","kind":"search","tool":"Grep","selfTokens":171,"reads":1,"trips":12,"billed":906,"perRead":906,"share":0.000057444731253840006},{"attr":"file:/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/Script/common/build_release.sh","label":"/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/Script/common/build_release.sh","kind":"read","tool":"Read","selfTokens":61,"reads":1,"trips":26,"billed":868,"perRead":868,"share":0.00005507919270599496},{"attr":"file:Udd/device","label":"Udd/device","kind":"search","tool":"Grep","selfTokens":518,"reads":1,"trips":4,"billed":735,"perRead":735,"share":0.000046604733588361826},{"attr":"file:define EEPROM_FRU_CMP_STEP","label":"define EEPROM_FRU_CMP_STEP","kind":"search","tool":"Grep","selfTokens":35,"reads":1,"trips":32,"billed":536,"perRead":536,"share":0.000033982343921839894},{"attr":"file:docs/*IB9*","label":"docs/*IB9*","kind":"search","tool":"Glob","selfTokens":14,"reads":1,"trips":52,"billed":467,"perRead":467,"share":0.000029596546109633835},{"attr":"file:App/ftest/ftest_xc_ilkn.c","label":"App/ftest/ftest_xc_ilkn.c","kind":"search","tool":"Grep","selfTokens":67,"reads":1,"trips":14,"billed":414,"perRead":414,"share":0.00002625049799521466},{"attr":"file:Udd/api","label":"Udd/api","kind":"search","tool":"Grep","selfTokens":269,"reads":4,"trips":10,"billed":361,"perRead":90,"share":0.000022911307477012382},{"attr":"file:Udd/device/pll","label":"Udd/device/pll","kind":"search","tool":"Grep","selfTokens":94,"reads":2,"trips":18,"billed":291,"perRead":145,"share":0.000018436873190575385},{"attr":"file:Udd/device/arm","label":"Udd/device/arm","kind":"search","tool":"Grep","selfTokens":58,"reads":1,"trips":10,"billed":192,"perRead":192,"share":0.000012177693358427797},{"attr":"file:App/ftest/ftest_prbs_sweep.c","label":"App/ftest/ftest_prbs_sweep.c","kind":"search","tool":"Grep","selfTokens":42,"reads":1,"trips":10,"billed":185,"perRead":185,"share":0.000011711227969831098},{"attr":"file:.","label":".","kind":"search","tool":"Grep","selfTokens":39,"reads":1,"trips":8,"billed":105,"perRead":105,"share":0.000006633410539415724},{"attr":"file:Utils","label":"Utils","kind":"search","tool":"Grep","selfTokens":70,"reads":1,"trips":4,"billed":99,"perRead":99,"share":0.000006297936971400246},{"attr":"file:Udd/device/fpga","label":"Udd/device/fpga","kind":"search","tool":"Grep","selfTokens":35,"reads":1,"trips":8,"billed":95,"perRead":95,"share":0.000006011002294203685},{"attr":"file:App/ftest/*.c","label":"App/ftest/*.c","kind":"search","tool":"Glob","selfTokens":16,"reads":1,"trips":2,"billed":13,"perRead":13,"share":8.469752916735662e-7},{"attr":"file:/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/App/ftest/ftest_platform.c","label":"/home1/hyt/codeSpace/hyt_debug/YL16002/sempICP/App/ftest/ftest_platform.c","kind":"search","tool":"Grep","selfTokens":56,"reads":1,"trips":0,"billed":0,"perRead":0,"share":0},{"attr":"file:Udd/platform","label":"Udd/platform","kind":"search","tool":"Grep","selfTokens":51,"reads":1,"trips":0,"billed":0,"perRead":0,"share":0}],"byAttr":[{"attr":"attachment","tokens":6291399,"share":0.39905755044167457},{"attr":"system","tokens":4099186,"share":0.2600075201495099},{"attr":"assistant_thinking","tokens":1132887,"share":0.07185794660714025},{"attr":"tool_result|Grep","tokens":1020536,"share":0.06473166604931738},{"attr":"user_input","tokens":1018886,"share":0.06462695624385986},{"attr":"compact_summary","tokens":939807,"share":0.05961110576760344},{"attr":"tool_result|Agent","tokens":450085,"share":0.02854846612355632},{"attr":"assistant_text","tokens":240658,"share":0.015264722518982837},{"attr":"tool_result|Bash","tokens":186454,"share":0.011826631004547311},{"attr":"tool_use|Edit","tokens":89671,"share":0.00568777270297766},{"attr":"tool_use|Bash","tokens":86573,"share":0.005491275366307515},{"attr":"tool_use|Grep","tokens":63104,"share":0.004002656774991592},{"attr":"tool_use|Agent","tokens":42164,"share":0.0026744141535643374},{"attr":"tool_result|Glob","tokens":35334,"share":0.0022412316329079468},{"attr":"tool_result|Read","tokens":27729,"share":0.0017588378847008968},{"attr":"tool_use|Read","tokens":20526,"share":0.0013019618829988003},{"attr":"tool_result|Edit","tokens":11076,"share":0.0007025263177563291},{"attr":"tool_use|AskUserQuestion","tokens":6503,"share":0.0004124567028455552},{"attr":"tool_use|Glob","tokens":1880,"share":0.00011923269174679827},{"attr":"tool_result|AskUserQuestion","tokens":1183,"share":0.00007506105437814331}],"byRequest":[{"index":1,"time":"16:46","ratio":0.119742,"inputTokens":23948,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.94,"originalCredits":0.94,"afterCompact":false},{"index":2,"time":"16:57","ratio":0.177016,"inputTokens":35403,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.355,"originalCredits":1.355,"afterCompact":false},{"index":3,"time":"16:57","ratio":0.184742,"inputTokens":36948,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.21,"originalCredits":0.21,"afterCompact":false},{"index":4,"time":"16:57","ratio":0.190797,"inputTokens":38159,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.172,"originalCredits":0.172,"afterCompact":false},{"index":5,"time":"16:57","ratio":0.194195,"inputTokens":38839,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.179,"originalCredits":0.179,"afterCompact":false},{"index":6,"time":"16:57","ratio":0.198609,"inputTokens":39722,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.158,"originalCredits":0.158,"afterCompact":false},{"index":7,"time":"16:58","ratio":0.203453,"inputTokens":40691,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.165,"originalCredits":0.165,"afterCompact":false},{"index":8,"time":"16:58","ratio":0.206805,"inputTokens":41361,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.484,"originalCredits":1.484,"afterCompact":false},{"index":9,"time":"16:58","ratio":0.21032,"inputTokens":42064,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.181,"originalCredits":0.181,"afterCompact":false},{"index":10,"time":"16:58","ratio":0.21532,"inputTokens":43064,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.21,"originalCredits":0.21,"afterCompact":false},{"index":11,"time":"16:59","ratio":0.219203,"inputTokens":43841,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.446,"originalCredits":0.446,"afterCompact":false},{"index":12,"time":"17:00","ratio":0.228656,"inputTokens":45731,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.924,"originalCredits":0.924,"afterCompact":false},{"index":13,"time":"17:00","ratio":0.233852,"inputTokens":46770,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.225,"originalCredits":0.225,"afterCompact":false},{"index":14,"time":"17:00","ratio":0.238687,"inputTokens":47738,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.217,"originalCredits":0.217,"afterCompact":false},{"index":15,"time":"17:00","ratio":0.242797,"inputTokens":48559,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.19,"originalCredits":0.19,"afterCompact":false},{"index":16,"time":"17:00","ratio":0.245891,"inputTokens":49178,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.185,"originalCredits":0.185,"afterCompact":false},{"index":17,"time":"17:00","ratio":0.249,"inputTokens":49800,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.182,"originalCredits":0.182,"afterCompact":false},{"index":18,"time":"17:00","ratio":0.251953,"inputTokens":50391,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.198,"originalCredits":0.198,"afterCompact":false},{"index":19,"time":"17:00","ratio":0.255359,"inputTokens":51072,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.196,"originalCredits":0.196,"afterCompact":false},{"index":20,"time":"17:00","ratio":0.258547,"inputTokens":51709,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.194,"originalCredits":0.194,"afterCompact":false},{"index":21,"time":"17:00","ratio":0.261828,"inputTokens":52366,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.213,"originalCredits":0.213,"afterCompact":false},{"index":22,"time":"17:01","ratio":0.266156,"inputTokens":53231,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.205,"originalCredits":0.205,"afterCompact":false},{"index":23,"time":"17:01","ratio":0.269125,"inputTokens":53825,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.185,"originalCredits":0.185,"afterCompact":false},{"index":24,"time":"17:01","ratio":0.280141,"inputTokens":56028,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.259,"originalCredits":0.259,"afterCompact":false},{"index":25,"time":"17:01","ratio":0.283562,"inputTokens":56713,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.242,"originalCredits":0.242,"afterCompact":false},{"index":26,"time":"17:02","ratio":0.287664,"inputTokens":57533,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.465,"originalCredits":0.465,"afterCompact":false},{"index":27,"time":"17:34","ratio":0.311812,"inputTokens":62363,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.471,"originalCredits":2.471,"afterCompact":false},{"index":28,"time":"17:35","ratio":0.211275,"inputTokens":42255,"outputTokens":null,"usageSource":"transcript-ratio","credits":14.547,"originalCredits":14.547,"afterCompact":false},{"index":29,"time":"17:35","ratio":0.2156,"inputTokens":43120,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.544,"originalCredits":1.544,"afterCompact":false},{"index":30,"time":"17:35","ratio":0.21833,"inputTokens":43666,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.604,"originalCredits":1.604,"afterCompact":false},{"index":31,"time":"17:44","ratio":0.2461,"inputTokens":49220,"outputTokens":null,"usageSource":"transcript-ratio","credits":20.007,"originalCredits":20.007,"afterCompact":false},{"index":32,"time":"17:56","ratio":0.271855,"inputTokens":54371,"outputTokens":null,"usageSource":"transcript-ratio","credits":21.138,"originalCredits":21.138,"afterCompact":false},{"index":33,"time":"18:06","ratio":0.293775,"inputTokens":58755,"outputTokens":null,"usageSource":"transcript-ratio","credits":19.625,"originalCredits":19.625,"afterCompact":false},{"index":34,"time":"18:27","ratio":0.303995,"inputTokens":60799,"outputTokens":null,"usageSource":"transcript-ratio","credits":20.402,"originalCredits":20.402,"afterCompact":false},{"index":35,"time":"18:27","ratio":0.307275,"inputTokens":61455,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.236,"originalCredits":2.236,"afterCompact":false},{"index":36,"time":"18:35","ratio":0.356465,"inputTokens":71293,"outputTokens":null,"usageSource":"transcript-ratio","credits":26.285,"originalCredits":26.285,"afterCompact":false},{"index":37,"time":"18:50","ratio":0.37704,"inputTokens":75408,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.492,"originalCredits":2.492,"afterCompact":false},{"index":38,"time":"09:57","ratio":0.381305,"inputTokens":76261,"outputTokens":null,"usageSource":"transcript-ratio","credits":25.65,"originalCredits":25.65,"afterCompact":false},{"index":39,"time":"09:46","ratio":0.485,"inputTokens":97000,"outputTokens":null,"usageSource":"transcript-ratio","credits":35.149,"originalCredits":35.149,"afterCompact":false},{"index":40,"time":"09:54","ratio":0.507065,"inputTokens":101413,"outputTokens":null,"usageSource":"transcript-ratio","credits":37.815,"originalCredits":37.815,"afterCompact":false},{"index":41,"time":"09:55","ratio":0.53394,"inputTokens":106788,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.889,"originalCredits":5.889,"afterCompact":false},{"index":42,"time":"09:55","ratio":0.543655,"inputTokens":108731,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.193,"originalCredits":4.193,"afterCompact":false},{"index":43,"time":"09:55","ratio":0.56244,"inputTokens":112488,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.095,"originalCredits":5.095,"afterCompact":false},{"index":44,"time":"09:57","ratio":0.61236,"inputTokens":122472,"outputTokens":null,"usageSource":"transcript-ratio","credits":12.287,"originalCredits":12.287,"afterCompact":false},{"index":45,"time":"09:57","ratio":0.64978,"inputTokens":129956,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.961,"originalCredits":5.961,"afterCompact":false},{"index":46,"time":"09:58","ratio":0.663475,"inputTokens":132695,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.219,"originalCredits":7.219,"afterCompact":false},{"index":47,"time":"10:02","ratio":0.76552,"inputTokens":153104,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.047,"originalCredits":11.047,"afterCompact":false},{"index":48,"time":"10:07","ratio":0.218465,"inputTokens":43693,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.541,"originalCredits":10.541,"afterCompact":true},{"index":49,"time":"10:07","ratio":0.25329,"inputTokens":50658,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.981,"originalCredits":3.981,"afterCompact":false},{"index":50,"time":"10:08","ratio":0.35674,"inputTokens":71348,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.14,"originalCredits":9.14,"afterCompact":false},{"index":51,"time":"10:08","ratio":0.36881,"inputTokens":73762,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.534,"originalCredits":3.534,"afterCompact":false},{"index":52,"time":"10:08","ratio":0.38283,"inputTokens":76566,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.886,"originalCredits":3.886,"afterCompact":false},{"index":53,"time":"10:09","ratio":0.401615,"inputTokens":80323,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.273,"originalCredits":5.273,"afterCompact":false},{"index":54,"time":"10:10","ratio":0.42501,"inputTokens":85002,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.935,"originalCredits":5.935,"afterCompact":false},{"index":55,"time":"10:11","ratio":0.44385,"inputTokens":88770,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.352,"originalCredits":5.352,"afterCompact":false},{"index":56,"time":"10:11","ratio":0.4557,"inputTokens":91140,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.502,"originalCredits":3.502,"afterCompact":false},{"index":57,"time":"10:12","ratio":0.4692,"inputTokens":93840,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.292,"originalCredits":4.292,"afterCompact":false},{"index":58,"time":"10:12","ratio":0.475525,"inputTokens":95105,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.662,"originalCredits":3.662,"afterCompact":false},{"index":59,"time":"10:12","ratio":0.48045,"inputTokens":96090,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.313,"originalCredits":3.313,"afterCompact":false},{"index":60,"time":"10:12","ratio":0.483565,"inputTokens":96713,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.187,"originalCredits":3.187,"afterCompact":false},{"index":61,"time":"10:13","ratio":0.486485,"inputTokens":97297,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.168,"originalCredits":3.168,"afterCompact":false},{"index":62,"time":"10:13","ratio":0.50478,"inputTokens":100956,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.931,"originalCredits":4.931,"afterCompact":false},{"index":63,"time":"10:14","ratio":0.52866,"inputTokens":105732,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.876,"originalCredits":4.876,"afterCompact":false},{"index":64,"time":"10:14","ratio":0.533435,"inputTokens":106687,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.265,"originalCredits":3.265,"afterCompact":false},{"index":65,"time":"10:14","ratio":0.534915,"inputTokens":106983,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.129,"originalCredits":4.129,"afterCompact":false},{"index":66,"time":"10:14","ratio":0.542465,"inputTokens":108493,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.569,"originalCredits":3.569,"afterCompact":false},{"index":67,"time":"10:14","ratio":0.54421,"inputTokens":108842,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.18,"originalCredits":3.18,"afterCompact":false},{"index":68,"time":"10:15","ratio":0.546075,"inputTokens":109215,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.367,"originalCredits":4.367,"afterCompact":false},{"index":69,"time":"10:15","ratio":0.554765,"inputTokens":110953,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.122,"originalCredits":4.122,"afterCompact":false},{"index":70,"time":"10:15","ratio":0.559015,"inputTokens":111803,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.418,"originalCredits":3.418,"afterCompact":false},{"index":71,"time":"10:15","ratio":0.56298,"inputTokens":112596,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.612,"originalCredits":3.612,"afterCompact":false},{"index":72,"time":"10:16","ratio":0.58439,"inputTokens":116878,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.444,"originalCredits":5.444,"afterCompact":false},{"index":73,"time":"10:17","ratio":0.598905,"inputTokens":119781,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.308,"originalCredits":7.308,"afterCompact":false},{"index":74,"time":"10:17","ratio":0.619815,"inputTokens":123963,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.844,"originalCredits":4.844,"afterCompact":false},{"index":75,"time":"10:18","ratio":0.621685,"inputTokens":124337,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.202,"originalCredits":4.202,"afterCompact":false},{"index":76,"time":"10:18","ratio":0.62678,"inputTokens":125356,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.142,"originalCredits":4.142,"afterCompact":false},{"index":77,"time":"10:18","ratio":0.630095,"inputTokens":126019,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.082,"originalCredits":4.082,"afterCompact":false},{"index":78,"time":"10:18","ratio":0.633605,"inputTokens":126721,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.059,"originalCredits":4.059,"afterCompact":false},{"index":79,"time":"10:19","ratio":0.63678,"inputTokens":127356,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.973,"originalCredits":3.973,"afterCompact":false},{"index":80,"time":"10:19","ratio":0.63944,"inputTokens":127888,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.747,"originalCredits":3.747,"afterCompact":false},{"index":81,"time":"10:19","ratio":0.6408,"inputTokens":128160,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.008,"originalCredits":4.008,"afterCompact":false},{"index":82,"time":"10:19","ratio":0.64424,"inputTokens":128848,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.825,"originalCredits":3.825,"afterCompact":false},{"index":83,"time":"10:19","ratio":0.645625,"inputTokens":129125,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.871,"originalCredits":3.871,"afterCompact":false},{"index":84,"time":"10:20","ratio":0.648525,"inputTokens":129705,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.908,"originalCredits":3.908,"afterCompact":false},{"index":85,"time":"10:20","ratio":0.650495,"inputTokens":130099,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.986,"originalCredits":3.986,"afterCompact":false},{"index":86,"time":"10:20","ratio":0.65324,"inputTokens":130648,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.934,"originalCredits":3.934,"afterCompact":false},{"index":87,"time":"10:20","ratio":0.655275,"inputTokens":131055,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.825,"originalCredits":3.825,"afterCompact":false},{"index":88,"time":"10:21","ratio":0.7386,"inputTokens":147720,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.396,"originalCredits":10.396,"afterCompact":false},{"index":89,"time":"10:28","ratio":0.224665,"inputTokens":44933,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.888,"originalCredits":10.888,"afterCompact":true},{"index":90,"time":"10:28","ratio":0.237455,"inputTokens":47491,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.257,"originalCredits":2.257,"afterCompact":false},{"index":91,"time":"10:28","ratio":0.239435,"inputTokens":47887,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.591,"originalCredits":1.591,"afterCompact":false},{"index":92,"time":"10:28","ratio":0.240815,"inputTokens":48163,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.457,"originalCredits":1.457,"afterCompact":false},{"index":93,"time":"10:29","ratio":0.243235,"inputTokens":48647,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.423,"originalCredits":2.423,"afterCompact":false},{"index":94,"time":"10:29","ratio":0.24983,"inputTokens":49966,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.429,"originalCredits":2.429,"afterCompact":false},{"index":95,"time":"10:29","ratio":0.258095,"inputTokens":51619,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.145,"originalCredits":2.145,"afterCompact":false},{"index":96,"time":"10:29","ratio":0.26,"inputTokens":52000,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.725,"originalCredits":1.725,"afterCompact":false},{"index":97,"time":"10:30","ratio":0.26346,"inputTokens":52692,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.778,"originalCredits":1.778,"afterCompact":false},{"index":98,"time":"10:30","ratio":0.265805,"inputTokens":53161,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.836,"originalCredits":1.836,"afterCompact":false},{"index":99,"time":"10:30","ratio":0.26769,"inputTokens":53538,"outputTokens":null,"usageSource":"transcript-ratio","credits":1.615,"originalCredits":1.615,"afterCompact":false},{"index":100,"time":"10:30","ratio":0.32942,"inputTokens":65884,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.96,"originalCredits":5.96,"afterCompact":false},{"index":101,"time":"10:30","ratio":0.334315,"inputTokens":66863,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.388,"originalCredits":2.388,"afterCompact":false},{"index":102,"time":"10:30","ratio":0.33828,"inputTokens":67656,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.217,"originalCredits":2.217,"afterCompact":false},{"index":103,"time":"10:31","ratio":0.33971,"inputTokens":67942,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.422,"originalCredits":2.422,"afterCompact":false},{"index":104,"time":"10:31","ratio":0.343245,"inputTokens":68649,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.335,"originalCredits":2.335,"afterCompact":false},{"index":105,"time":"10:31","ratio":0.34535,"inputTokens":69070,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.297,"originalCredits":2.297,"afterCompact":false},{"index":106,"time":"10:31","ratio":0.349145,"inputTokens":69829,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.401,"originalCredits":2.401,"afterCompact":false},{"index":107,"time":"10:32","ratio":0.355795,"inputTokens":71159,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.635,"originalCredits":3.635,"afterCompact":false},{"index":108,"time":"10:32","ratio":0.368855,"inputTokens":73771,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.598,"originalCredits":3.598,"afterCompact":false},{"index":109,"time":"10:32","ratio":0.374415,"inputTokens":74883,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.478,"originalCredits":2.478,"afterCompact":false},{"index":110,"time":"10:32","ratio":0.37556,"inputTokens":75112,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.278,"originalCredits":2.278,"afterCompact":false},{"index":111,"time":"10:33","ratio":0.37711,"inputTokens":75422,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.258,"originalCredits":2.258,"afterCompact":false},{"index":112,"time":"10:33","ratio":0.378325,"inputTokens":75665,"outputTokens":null,"usageSource":"transcript-ratio","credits":2.811,"originalCredits":2.811,"afterCompact":false},{"index":113,"time":"10:33","ratio":0.385285,"inputTokens":77057,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.218,"originalCredits":3.218,"afterCompact":false},{"index":114,"time":"10:34","ratio":0.41078,"inputTokens":82156,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.199,"originalCredits":4.199,"afterCompact":false},{"index":115,"time":"10:34","ratio":0.429655,"inputTokens":85931,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.075,"originalCredits":4.075,"afterCompact":false},{"index":116,"time":"10:34","ratio":0.442795,"inputTokens":88559,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.415,"originalCredits":3.415,"afterCompact":false},{"index":117,"time":"10:35","ratio":0.4527,"inputTokens":90540,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.434,"originalCredits":4.434,"afterCompact":false},{"index":118,"time":"11:07","ratio":0.54683,"inputTokens":109366,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.451,"originalCredits":9.451,"afterCompact":false},{"index":119,"time":"11:08","ratio":0.64431,"inputTokens":128862,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.268,"originalCredits":10.268,"afterCompact":false},{"index":120,"time":"11:08","ratio":0.731515,"inputTokens":146303,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.442,"originalCredits":9.442,"afterCompact":false},{"index":121,"time":"11:13","ratio":0.223635,"inputTokens":44727,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.928,"originalCredits":10.928,"afterCompact":true},{"index":122,"time":"11:13","ratio":0.307245,"inputTokens":61449,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.941,"originalCredits":6.941,"afterCompact":false},{"index":123,"time":"11:14","ratio":0.397375,"inputTokens":79475,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.245,"originalCredits":10.245,"afterCompact":false},{"index":124,"time":"11:17","ratio":0.49749,"inputTokens":99498,"outputTokens":null,"usageSource":"transcript-ratio","credits":29.695,"originalCredits":29.695,"afterCompact":false},{"index":125,"time":"11:20","ratio":0.597645,"inputTokens":119529,"outputTokens":null,"usageSource":"transcript-ratio","credits":15.237,"originalCredits":15.237,"afterCompact":false},{"index":126,"time":"11:20","ratio":0.71696,"inputTokens":143392,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.305,"originalCredits":11.305,"afterCompact":false},{"index":127,"time":"11:26","ratio":0.226955,"inputTokens":45391,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.115,"originalCredits":11.115,"afterCompact":true},{"index":128,"time":"11:26","ratio":0.31044,"inputTokens":62088,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.02,"originalCredits":7.02,"afterCompact":false},{"index":129,"time":"11:26","ratio":0.39399,"inputTokens":78798,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.396,"originalCredits":7.396,"afterCompact":false},{"index":130,"time":"11:27","ratio":0.47708,"inputTokens":95416,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.222,"originalCredits":8.222,"afterCompact":false},{"index":131,"time":"11:28","ratio":0.56274,"inputTokens":112548,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.712,"originalCredits":10.712,"afterCompact":false},{"index":132,"time":"11:28","ratio":0.660115,"inputTokens":132023,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.733,"originalCredits":10.733,"afterCompact":false},{"index":133,"time":"11:29","ratio":0.749885,"inputTokens":149977,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.075,"originalCredits":10.075,"afterCompact":false},{"index":134,"time":"11:33","ratio":0.22551,"inputTokens":45102,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.97,"originalCredits":10.97,"afterCompact":true},{"index":135,"time":"11:33","ratio":0.308715,"inputTokens":61743,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.11,"originalCredits":7.11,"afterCompact":false},{"index":136,"time":"11:34","ratio":0.393275,"inputTokens":78655,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.246,"originalCredits":8.246,"afterCompact":false},{"index":137,"time":"11:34","ratio":0.48122,"inputTokens":96244,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.71,"originalCredits":8.71,"afterCompact":false},{"index":138,"time":"11:34","ratio":0.568405,"inputTokens":113681,"outputTokens":null,"usageSource":"transcript-ratio","credits":8.559,"originalCredits":8.559,"afterCompact":false},{"index":139,"time":"11:36","ratio":0.6523,"inputTokens":130460,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.746,"originalCredits":10.746,"afterCompact":false},{"index":140,"time":"11:36","ratio":0.747575,"inputTokens":149515,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.962,"originalCredits":9.962,"afterCompact":false},{"index":141,"time":"11:41","ratio":0.230535,"inputTokens":46107,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.776,"originalCredits":11.776,"afterCompact":true},{"index":142,"time":"11:41","ratio":0.31685,"inputTokens":63370,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.185,"originalCredits":7.185,"afterCompact":false},{"index":143,"time":"11:41","ratio":0.400045,"inputTokens":80009,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.82,"originalCredits":7.82,"afterCompact":false},{"index":144,"time":"11:44","ratio":0.49845,"inputTokens":99690,"outputTokens":null,"usageSource":"transcript-ratio","credits":14.684,"originalCredits":14.684,"afterCompact":false},{"index":145,"time":"11:45","ratio":0.62291,"inputTokens":124582,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.76,"originalCredits":13.76,"afterCompact":false},{"index":146,"time":"11:45","ratio":0.722455,"inputTokens":144491,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.036,"originalCredits":11.036,"afterCompact":false},{"index":147,"time":"11:51","ratio":0.22927,"inputTokens":45854,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.977,"originalCredits":11.977,"afterCompact":true},{"index":148,"time":"12:04","ratio":0.31897,"inputTokens":63794,"outputTokens":null,"usageSource":"transcript-ratio","credits":22.372,"originalCredits":22.372,"afterCompact":false},{"index":149,"time":"12:04","ratio":0.418,"inputTokens":83600,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.67,"originalCredits":9.67,"afterCompact":false},{"index":150,"time":"12:06","ratio":0.512755,"inputTokens":102551,"outputTokens":null,"usageSource":"transcript-ratio","credits":14.599,"originalCredits":14.599,"afterCompact":false},{"index":151,"time":"12:06","ratio":0.63309,"inputTokens":126618,"outputTokens":null,"usageSource":"transcript-ratio","credits":11.022,"originalCredits":11.022,"afterCompact":false},{"index":152,"time":"12:07","ratio":0.72042,"inputTokens":144084,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.923,"originalCredits":9.923,"afterCompact":false},{"index":153,"time":"12:10","ratio":0.21446,"inputTokens":42892,"outputTokens":null,"usageSource":"transcript-ratio","credits":10.361,"originalCredits":10.361,"afterCompact":true},{"index":154,"time":"12:11","ratio":0.300575,"inputTokens":60115,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.583,"originalCredits":7.583,"afterCompact":false},{"index":155,"time":"09:35","ratio":0.34033,"inputTokens":68066,"outputTokens":null,"usageSource":"transcript-ratio","credits":24.003,"originalCredits":24.003,"afterCompact":false},{"index":156,"time":"09:35","ratio":0.357315,"inputTokens":71463,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.538,"originalCredits":4.538,"afterCompact":false},{"index":157,"time":"09:36","ratio":0.371725,"inputTokens":74345,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.627,"originalCredits":4.627,"afterCompact":false},{"index":158,"time":"09:36","ratio":0.383035,"inputTokens":76607,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.086,"originalCredits":3.086,"afterCompact":false},{"index":159,"time":"09:36","ratio":0.390245,"inputTokens":78049,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.47,"originalCredits":3.47,"afterCompact":false},{"index":160,"time":"09:37","ratio":0.39773,"inputTokens":79546,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.264,"originalCredits":3.264,"afterCompact":false},{"index":161,"time":"09:37","ratio":0.403665,"inputTokens":80733,"outputTokens":null,"usageSource":"transcript-ratio","credits":3.77,"originalCredits":3.77,"afterCompact":false},{"index":162,"time":"09:38","ratio":0.41923,"inputTokens":83846,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.335,"originalCredits":4.335,"afterCompact":false},{"index":163,"time":"09:38","ratio":0.428155,"inputTokens":85631,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.877,"originalCredits":4.877,"afterCompact":false},{"index":164,"time":"09:43","ratio":0.444045,"inputTokens":88809,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.641,"originalCredits":4.641,"afterCompact":false},{"index":165,"time":"09:44","ratio":0.458955,"inputTokens":91791,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.018,"originalCredits":5.018,"afterCompact":false},{"index":166,"time":"09:44","ratio":0.472105,"inputTokens":94421,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.085,"originalCredits":4.085,"afterCompact":false},{"index":167,"time":"09:44","ratio":0.499605,"inputTokens":99921,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.552,"originalCredits":5.552,"afterCompact":false},{"index":168,"time":"09:45","ratio":0.51975,"inputTokens":103950,"outputTokens":null,"usageSource":"transcript-ratio","credits":6.408,"originalCredits":6.408,"afterCompact":false},{"index":169,"time":"09:48","ratio":0.54598,"inputTokens":109196,"outputTokens":null,"usageSource":"transcript-ratio","credits":13.609,"originalCredits":13.609,"afterCompact":false},{"index":170,"time":"09:49","ratio":0.60478,"inputTokens":120956,"outputTokens":null,"usageSource":"transcript-ratio","credits":9.831,"originalCredits":9.831,"afterCompact":false},{"index":171,"time":"09:50","ratio":0.624275,"inputTokens":124855,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.538,"originalCredits":5.538,"afterCompact":false},{"index":172,"time":"09:50","ratio":0.635255,"inputTokens":127051,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.124,"originalCredits":5.124,"afterCompact":false},{"index":173,"time":"09:50","ratio":0.645645,"inputTokens":129129,"outputTokens":null,"usageSource":"transcript-ratio","credits":5.098,"originalCredits":5.098,"afterCompact":false},{"index":174,"time":"09:51","ratio":0.652965,"inputTokens":130593,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.728,"originalCredits":4.728,"afterCompact":false},{"index":175,"time":"09:51","ratio":0.66144,"inputTokens":132288,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.478,"originalCredits":4.478,"afterCompact":false},{"index":176,"time":"09:51","ratio":0.665115,"inputTokens":133023,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.638,"originalCredits":4.638,"afterCompact":false},{"index":177,"time":"09:51","ratio":0.671655,"inputTokens":134331,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.204,"originalCredits":4.204,"afterCompact":false},{"index":178,"time":"09:52","ratio":0.67396,"inputTokens":134792,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.176,"originalCredits":4.176,"afterCompact":false},{"index":179,"time":"09:52","ratio":0.67845,"inputTokens":135690,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.544,"originalCredits":4.544,"afterCompact":false},{"index":180,"time":"09:52","ratio":0.68345,"inputTokens":136690,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.643,"originalCredits":4.643,"afterCompact":false},{"index":181,"time":"09:53","ratio":0.68955,"inputTokens":137910,"outputTokens":null,"usageSource":"transcript-ratio","credits":4.745,"originalCredits":4.745,"afterCompact":false},{"index":182,"time":"09:54","ratio":0.695975,"inputTokens":139195,"outputTokens":null,"usageSource":"transcript-ratio","credits":7.1,"originalCredits":7.1,"afterCompact":false}],"identity":{"sumAttributed":15765644,"billedInputTokens":15765644,"absDiff":0,"ok":true},"pluginVersion":"2.7.4","selfCmd":"\"C:\\Users\\75672\\.qoder-cn\\plugins\\cache\\qoder-marketplace\\qoder-credits-inspector\\2.7.4\\bin\\credits-inspector.cmd\" cli","linkHealth":{"matched":0,"requests":182,"coverage":0,"usageSource":"transcript-ratio","breakdown":{"proxy":0,"transcriptTokens":0,"transcriptRatio":182},"logRecords":0,"lastRecordAt":null,"recentRequests":0,"proxyErrors":null,"clientAbort":null,"clientAbortMaxMs":null,"upstreamRejected":null,"aborted":null,"truncated":null,"noUsage":null,"slowestMs":null,"supersededFailure":null},"subagents":{"scanned":true,"dir":"C:\\Users\\75672\\.qoder-cn\\projects\\C--Users-75672--qoder-cn-app-runtime-sessions-thin-ssh-c701629b47245171a1aad53548001b06322dae89458da747030c2885a6021e32\\afea1fcc-ff46-4b7a-adbc-1f9b3c2e1913\\subagents","probedPaths":["C:\\Users\\75672\\.qoder-cn\\projects\\C--Users-75672--qoder-cn-app-runtime-sessions-thin-ssh-c701629b47245171a1aad53548001b06322dae89458da747030c2885a6021e32\\afea1fcc-ff46-4b7a-adbc-1f9b3c2e1913\\subagents","C:\\Users\\75672\\.qoder-cn\\projects\\afea1fcc-ff46-4b7a-adbc-1f9b3c2e1913\\subagents"],"reason":"ok","count":5,"items":[{"agentId":"aExplore-744e662e854d9111","agentType":"Explore","description":"Search port_prbs test code","toolUseId":"call_d900c380d66743f392929320","roundTrips":34,"billedInputTokens":1912431,"peakContextRatio":0.4217,"credits":86.598,"originalCredits":86.598,"error":null},{"agentId":"aExplore-26c3364a74728bd8","agentType":"Explore","description":"Find DAC scan params in ftest_prbs.c","toolUseId":"call_48efc45a9ba44ad59c59eadb","roundTrips":29,"billedInputTokens":980146,"peakContextRatio":0.3401,"credits":57.408,"originalCredits":57.408,"error":null},{"agentId":"aExplore-b3dddb9419bb9726","agentType":"Explore","description":"Search ftest framework structure","toolUseId":"call_bb1b88aec06747148d491cc0","roundTrips":39,"billedInputTokens":985669,"peakContextRatio":0.2586,"credits":54.087,"originalCredits":54.087,"error":null},{"agentId":"aExplore-966145bce6d2d55a","agentType":"Explore","description":"Read build_release.sh and firmware structure","toolUseId":"call_c55d7b79daa745d39756b491","roundTrips":17,"billedInputTokens":353593,"peakContextRatio":0.2004,"credits":35.129,"originalCredits":35.129,"error":null},{"agentId":"aExplore-0c878132ebc42fc8","agentType":"Explore","description":"Verify printf migration remaining batches","toolUseId":"call_e1a8ffa4ab7f4f1da75b14fd","roundTrips":8,"billedInputTokens":281953,"peakContextRatio":0.2662,"credits":33.378,"originalCredits":33.378,"error":null}],"totals":{"roundTrips":127,"billedInputTokens":4513792,"credits":266.6,"originalCredits":266.6},"combined":{"roundTrips":309,"billedInputTokens":20279436,"credits":1404.176,"originalCredits":1404.176}},"manual":null,"artifacts":{"report":"report.json","canvas":"1. docs_AGENTS.md是项目代码架构__bc989a42.canvas.tsx"}} as unknown as Report;

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
