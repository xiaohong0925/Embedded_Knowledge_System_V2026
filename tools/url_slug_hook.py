# -*- coding: utf-8 -*-
"""MkDocs hook：构建期把中文/非 ASCII 输出路径转写为短英文 slug。

分段规则（按优先级）：
1. 目录名命中 DIR_MAP 人工英文对照表（全部部/章/扩展区目录，一次维护）
2. 小节文件/图片的编号前缀保留：11.1.1_模式①_现代标准platform写法 → 11.1.1-platform
   （编号后的 ASCII 单词一并保留，汉字丢弃；编号在书内唯一且有语义）
3. 已是安全 ASCII 的段原样保留
4. 其余回退拼音转写

同一目录内 slug 冲突时追加 -2、-3 后缀并输出 WARNING。
只改 URL，不改 nav 标题与页面内容。

新增目录时：若目录名含中文，请在 DIR_MAP 中补一行英文 slug。
"""
import logging
import posixpath
import re
from urllib.parse import quote as urlquote

try:
    from pypinyin import lazy_pinyin
except ImportError:  # 未安装 pypinyin 时拼音兜底降级为哈希 slug
    lazy_pinyin = None

log = logging.getLogger("mkdocs.hooks.url_slug")

# 目录名 → 英文 slug 对照表
DIR_MAP = {
    "00-模板": "00-template",
    "00-阅读指南": "00-guide",
    "01-系统启动与运行": "01-boot-and-run",
    "02-核心机制深度解析": "02-core-mechanism",
    "03-系统设计与决策": "03-design-decisions",
    "04-系统思维与全链路实战": "04-system-thinking",
    "05-前沿技术与行业视野": "05-frontier",
    "A. 应用层编程": "a-app-programming",
    "B. 总线协议": "b-bus-protocols",
    "C. 专用技术与前沿趋势": "c-special-topics",
    "第1章 认识你的开发板": "ch01-board",
    "第2章 交叉编译与工具链": "ch02-toolchain",
    "第3章 Bootloader：系统的第一段代码": "ch03-bootloader",
    "第4章 内核配置与编译": "ch04-kernel-build",
    "第5章 根文件系统与初始化": "ch05-rootfs-init",
    "第6章 第一个外设：点亮LED": "ch06-first-led",
    "第7章 启动链深度解析": "ch07-boot-chain",
    "第8章 进程与调度": "ch08-process-sched",
    "第9章 内存管理": "ch09-memory",
    "第10章 中断与时间": "ch10-interrupt-time",
    "第11章 设备模型": "ch11-device-model",
    "第12章 文件系统": "ch12-filesystem",
    "第13章 并发与同步": "ch13-concurrency",
    "第14章 网络子系统": "ch14-networking",
    "第15章 电源管理": "ch15-power",
    "第16章 内核版本与启动架构设计": "ch16-kernel-version",
    "第17章 存储架构设计": "ch17-storage",
    "第18章 构建系统设计": "ch18-build-system",
    "第19章 安全架构设计": "ch19-security",
    "第20章 实时性设计": "ch20-realtime",
    "第21章 OTA与更新架构设计": "ch21-ota",
    "第22章 驱动架构设计": "ch22-driver-arch",
    "第23章 系统调试方法论": "ch23-debugging",
    "第24章 启动全链路优化": "ch24-boot-optimization",
    "第25章 Camera全链路：从Sensor到屏幕": "ch25-camera",
    "第26章 网络全链路：从PHY到Socket": "ch26-network-pipeline",
    "第27章 工业通信全链路": "ch27-industrial-comm",
    "第28章 功耗全链路": "ch28-power-pipeline",
    "第29章 安全全链路": "ch29-security-pipeline",
    "第30章 可靠性工程：让系统7×24运行": "ch30-reliability",
    "第31章 嵌入式Linux行业全景": "ch31-industry",
    "第32章 RISC-V：变局者": "ch32-riscv",
    "第33章 Rust for Linux：新语言": "ch33-rust",
    "第34章 边缘AI：智能无处不在": "ch34-edge-ai",
    "第35章 虚拟化与混合关键性": "ch35-virtualization",
    "第36章 安全与合规：从可选到强制": "ch36-compliance",
    "第37章 长期维护：10年的承诺": "ch37-maintenance",
    "第38章 技术路线规划：你的下一步": "ch38-career",
    "第39章 具身智能与机器人革命": "ch39-embodied-ai",
    "第40章 赛博义体与碳硅融合": "ch40-cyborg",
    "A. 低速外设接口": "a-low-speed",
    "B. 中高速外设与存储": "b-high-speed-storage",
    "C. 专用网络总线": "c-network-buses",
    "D. 片内总线认知": "d-on-chip-buses",
    "E. 综合实战": "e-practice",
    "知识图谱": "knowledge-map",
    "01-边缘AI推理": "01-edge-ai",
    "02-异构多核通信": "02-amp-comm",
    "05-Linux长期演进与技术路线图": "05-linux-evolution",
    "06-嵌入式Linux实时化技术": "06-realtime",
}

_HAN = re.compile(r"[一-鿿]")
_CHAPTER = re.compile(r"第(\d+)章")
_SAFE_SEG = re.compile(r"^[a-zA-Z0-9._-]+$")
_NUM_PREFIX = re.compile(r"^(\d+(?:\.\d+)*)")
_ASCII_WORD = re.compile(r"[a-zA-Z0-9]+")


_pinyin_warned = False


def _slug_pinyin(text: str) -> str:
    """拼音兜底转写：汉字逐字转拼音，连续 ASCII 字母数字合并成词。

    未安装 pypinyin 时降级为 u-<hash8> 短 slug，保证构建不中断。
    """
    global _pinyin_warned
    if lazy_pinyin is None:
        if not _pinyin_warned:
            log.warning("未安装 pypinyin，纯中文文件名降级为哈希 slug；"
                        "安装后恢复拼音转写：py -m pip install pypinyin")
            _pinyin_warned = True
        import hashlib
        return "u-" + hashlib.md5(text.encode("utf-8")).hexdigest()[:8]
    text = _CHAPTER.sub(r"ch\1", text)
    tokens = []
    buf = ""
    for ch in text:
        if _HAN.match(ch):
            if buf:
                tokens.append(buf)
                buf = ""
            tokens.append(lazy_pinyin(ch)[0])
        elif ch.isascii() and ch.isalnum():
            buf += ch.lower()
        else:
            if buf:
                tokens.append(buf)
                buf = ""
    if buf:
        tokens.append(buf)
    return re.sub(r"-{2,}", "-", "-".join(tokens)).strip("-")


def _slug_stem(stem: str) -> str:
    if stem in DIR_MAP:
        return DIR_MAP[stem]
    m = _NUM_PREFIX.match(stem)
    if m:
        num = m.group(1)
        words = [w.lower() for w in _ASCII_WORD.findall(stem[m.end():])]
        return "-".join([num, *words]) if words else num
    words = [w.lower() for w in _ASCII_WORD.findall(stem)]
    core = "-".join(words)
    return core if len(core) >= 3 else _slug_pinyin(stem)


def _slug_segment(seg: str) -> str:
    if _SAFE_SEG.match(seg):
        return seg
    stem, dot, ext = seg.rpartition(".")
    if dot and stem and 1 <= len(ext) <= 5 and ext.isalnum():
        return _slug_stem(stem) + "." + ext.lower()
    return _slug_stem(seg)


def _rewrite(dest_uri: str, taken: set) -> str:
    parts = [_slug_segment(p) for p in dest_uri.split("/")]
    new_uri = "/".join(parts)
    if new_uri in taken:
        stem, dot, ext = new_uri.rpartition(".")
        base, suffix = (stem, "." + ext) if dot else (new_uri, "")
        i = 2
        while f"{base}-{i}{suffix}" in taken:
            i += 1
        log.info("slug 冲突自动改名：%s → %s-%d%s", dest_uri, base, i, suffix)
        new_uri = f"{base}-{i}{suffix}"
    taken.add(new_uri)
    return new_uri


def on_files(files, config, **kwargs):
    use_directory_urls = config.get("use_directory_urls", True)
    taken = set()
    n = 0
    for f in files:
        old = f.dest_uri
        new = _rewrite(old, taken)
        if new == old:
            continue
        f.dest_uri = new
        dirname, filename = posixpath.split(new)
        if use_directory_urls and filename == "index.html":
            f.url = (dirname or ".") + "/"
        else:
            f.url = urlquote(new)
        n += 1
    log.info("url_slug：改写 %d 个输出路径", n)
    return files
