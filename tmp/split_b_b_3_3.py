from pathlib import Path

ROOT = Path(r"E:\HongWork\MySelf\MyKnowledge\Embedded_Knowledge_System_V2026")
BASE = ROOT / "docs" / "B. 总线协议" / "B. 低速外设接口"
SOURCE = BASE / "B-B.3.3_I2C Linux驱动框架.md"
text = SOURCE.read_text(encoding="utf-8")
(ROOT / "tmp" / "review" / "B-B.3.3-original.md").write_text(text, encoding="utf-8")

H = {
    "fullmap": '## <span class="blue"> 先建立全路：寄存器操作没有消失，而是换了负责人',
    "objects": '## <span class="blue"> 先认识对象：代码里的五个名字分别是什么',
    "startup": '## <span class="blue"> 启动建链：DTS 怎样变成 adapter、client 和 probe 参数',
    "module": '## <span class="blue"> 完整教学模块：代码、构建与验证放在同一处',
    "runtime": '## <span class="blue"> 运行传输：两条消息怎样穿过 Core 到达 RK3568',
    "clock": '## <span class="blue"> DTS 属性怎样生效：完整追踪 clock-frequency',
    "user": '## <span class="blue"> `/dev/i2c-N`：另一个入口怎样接到同一 Core',
    "gpio": '## <span class="blue"> 替换控制器：GPIO 模拟 I2C 为什么不用改外设读取函数',
    "summary": '## <span class="blue"> 收回主线：写、移植和修改时分别落在哪一层',
    "qa": '## <span class="blue"> 本节自检 Q&A',
    "verification": '## <span class="blue"> 核验边界',
}


def section(start, end=None):
    start_index = text.index(H[start])
    end_index = text.index(H[end]) if end else len(text)
    return text[start_index:end_index].strip() + "\n"


prefix = text[:text.index(H["fullmap"])].strip() + "\n"
fullmap = section("fullmap", "objects")
iframe_start = fullmap.index('<div class="interactive-demo">')
iframe_end = fullmap.index('</div>', iframe_start) + len('</div>')
iframe = fullmap[iframe_start:iframe_end]
lab_link = '[在新窗口打开 I2C Framework Lab](./html/i2c-framework-lab.html#mechanism){: target="_blank" rel="noopener noreferrer" }。实验室中的步骤是依据 v6.6 源码构造的模型推演，不连接真实硬件。'
fullmap_without_iframe = fullmap[:iframe_start] + lab_link + fullmap[iframe_end:]
# 去掉原入口页中的大 iframe，只保留对应机制后的入口。
fullmap_without_iframe = fullmap_without_iframe.replace(
    '下面的实验室可以逐步执行启动建链和传输过程。启动与传输代码窗可切换“完整函数”和“步骤片段”：前者保留真实文件上下文与起始行号，后者只突出当前一步；SCL 时钟延展单步则需在 GPIO 模拟模式下操作。实验室是正文的辅助视图，即使删除这个 iframe，后文仍能独立讲完同一机制。',
    '下面的实验室可以逐步执行启动建链和传输过程。启动与传输代码窗可切换“完整函数”和“步骤片段”：前者保留真实文件上下文与起始行号，后者只突出当前一步；SCL 时钟延展单步则需在 GPIO 模拟模式下操作。先沿正文建立对象和调用链，再用实验室观察对应步骤。'
)

qa_region = section("qa", "verification")


def question(label):
    marker = f'??? question "{label}"'
    start = qa_region.index(marker)
    next_question = qa_region.find('\n??? question "', start + len(marker))
    next_rule = qa_region.find('\n---', start + len(marker))
    candidates = [i for i in (next_question, next_rule) if i != -1]
    end = min(candidates) if candidates else len(qa_region)
    return qa_region[start:end].strip() + "\n"


Q = {
    "client": question('为什么 `client` 不是教学驱动自己分配的？'),
    "algo": question('为什么是 `i2c->adap.algo`，而不是 `i2c->adap->algo`？'),
    "flags": question('`I2C_M_RD` 和 `I2C_FUNC_I2C` 都是位标志，为什么不能互换？'),
    "return": question('`i2c_transfer()` 返回 2，为什么读到的数据不是 2？'),
    "ioctl": question('用户态 `ioctl(I2C_RDWR)` 在本例为什么也返回 2？'),
    "process": question('两个进程同时打开 `/dev/i2c-1`，会共用同一个匿名 client 吗？'),
    "entries": question('`/dev/i2c-1` 与 `1-0050/eeprom` 是同一个框架自动创建的两种名字吗？'),
    "gpio": question('换成 GPIO 模拟后，为什么 `demo_read_reg()` 不需要修改？'),
}

NAV = {
    "overview": '[下一页：启动建链](B-B.3.3_I2C Linux驱动框架_启动建链.md)',
    "startup": '[上一页：导读与源码地图](B-B.3.3_I2C Linux驱动框架.md) · [下一页：运行传输](B-B.3.3_I2C Linux驱动框架_运行传输.md)',
    "transfer": '[上一页：启动建链](B-B.3.3_I2C Linux驱动框架_启动建链.md) · [第二轮：用户态入口](B-B.3.3_I2C Linux驱动框架_用户态入口.md)',
    "user": '[上一页：运行传输](B-B.3.3_I2C Linux驱动框架_运行传输.md) · [下一页：替换控制器](B-B.3.3_I2C Linux驱动框架_替换控制器.md)',
    "gpio": '[上一页：用户态入口](B-B.3.3_I2C Linux驱动框架_用户态入口.md) · [回到导读与源码地图](B-B.3.3_I2C Linux驱动框架.md)',
}


def wrap(content):
    return '<div class="reader-b2" markdown="1">\n\n' + content.strip() + '\n\n</div>\n'


def header(title, route, question_text):
    return (
        f'# {title}\n\n'
        '> 所属章节：第五部 B. 总线协议 > B-B.3 I2C 总线 > B-B.3.3 I2C Linux 驱动框架\n>\n'
        f'> 阅读路线：{route}\n\n'
        f'本页只回答一个问题：**{question_text}**\n\n---\n\n'
    )


def footer(key):
    return '\n---\n\n' + NAV[key] + '\n'


overview = (
    prefix
    + '\n## <span class="blue"> 怎样阅读这组短页面\n\n'
    + '这组页面保留同一贯穿实例和完整源码，但把阅读任务分开。首次阅读只沿“导读与源码地图 → 启动建链 → 运行传输”走通一笔读取；用户态入口和 GPIO 替换作为第二轮分支，不妨碍先理解主线。\n\n'
    + '每页只展示当前需要的代码片段，完整函数、完整教学文件和固定版本源码用于回查。不要因为页面变短，就跳过代码来源、错误路径或验证边界。\n\n'
    + '1. **首读第 1 页：导读与源码地图**，先知道对象、文件和主调用链在哪里；\n'
    + '2. **首读第 2 页：启动建链**，理解 DTS 怎样变成 adapter、client 和 probe 参数；\n'
    + '3. **首读第 3 页：运行传输**，沿两条消息走到控制器并返回；\n'
    + '4. **第二轮分支：用户态入口、替换控制器**，按工作需要选读。\n\n'
    + '[开始首读：启动建链](B-B.3.3_I2C Linux驱动框架_启动建链.md)。\n\n---\n\n'
    + fullmap_without_iframe
    + '\n---\n\n'
    + section("verification")
    + footer("overview")
)

startup_body = (
    header('启动建链：DTS 怎样变成 adapter、client 和 probe 参数', '首读主线 2／3', 'DTS 怎样变成 adapter、client 和 probe 参数？')
    + section("objects", "startup")
    + '\n---\n\n'
    + section("startup", "module")
    + '\n---\n\n'
    + section("clock", "user")
    + '\n[在实验室中逐步观察对象建链与状态变化](./html/i2c-framework-lab.html#mechanism){: target="_blank" rel="noopener noreferrer" }。\n\n'
    + '## <span class="blue"> 本页自检 Q&A\n\n'
    + Q["client"] + '\n' + Q["algo"] + '\n' + Q["flags"]
    + footer("startup")
)

transfer_body = (
    header('运行传输：两条消息怎样穿过 Core 到达 RK3568', '首读主线 3／3', '两条 i2c_msg 怎样穿过 Core 到达 RK3568，并把数据或错误返回调用者？')
    + '> ⚠️ 本页涉及的原创教学代码和交互实验室均未在本篇环境中交叉编译、运行或上板验证；页面中的 `0x5a`、日志和波形都是用于推演的样本，不是实测记录。\n\n'
    + section("module", "runtime")
    + '\n---\n\n'
    + section("runtime", "clock")
    + '\n---\n\n'
    + section("summary", "qa")
    + '\n' + iframe + '\n\n'
    + lab_link + '\n\n'
    + '## <span class="blue"> 本页自检 Q&A\n\n'
    + Q["return"]
    + footer("transfer")
)

user_body = (
    header('用户态入口：`/dev/i2c-N` 怎样接到同一 Core', '第二轮分支', '`/dev/i2c-N` 怎样接到同一个 Core，两个进程又共享和独立哪些状态？')
    + '> ⚠️ 本页涉及的用户态教学程序尚未在本篇环境中交叉编译、部署、运行或上板验证；示例输出用于推演，不是实测记录。\n\n'
    + section("user", "gpio")
    + '\n[在实验室中对照用户态入口、匿名 client 与总线锁](./html/i2c-framework-lab.html#mechanism){: target="_blank" rel="noopener noreferrer" }。\n\n'
    + '## <span class="blue"> 本页自检 Q&A\n\n'
    + Q["ioctl"] + '\n' + Q["process"] + '\n' + Q["entries"]
    + footer("user")
)

gpio_body = (
    header('替换控制器：GPIO 模拟 I2C 为什么不用改外设读取函数', '第二轮分支', '换成 GPIO 模拟后，为什么 demo_read_reg() 和两条消息都不需要修改？')
    + '> ⚠️ 本页 GPIO 引脚只是语法示例，不是对任何板卡的引脚推荐；教学代码和交互实验室尚未在本篇环境中交叉编译、运行或上板验证。\n\n'
    + section("gpio", "summary")
    + '\n[在实验室中切换 GPIO 模拟并观察时钟延展](./html/i2c-framework-lab.html#mechanism){: target="_blank" rel="noopener noreferrer" }。\n\n'
    + '## <span class="blue"> 本页自检 Q&A\n\n'
    + Q["gpio"]
    + footer("gpio")
)

outputs = {
    SOURCE: overview,
    BASE / 'B-B.3.3_I2C Linux驱动框架_启动建链.md': startup_body,
    BASE / 'B-B.3.3_I2C Linux驱动框架_运行传输.md': transfer_body,
    BASE / 'B-B.3.3_I2C Linux驱动框架_用户态入口.md': user_body,
    BASE / 'B-B.3.3_I2C Linux驱动框架_替换控制器.md': gpio_body,
}
for path, content in outputs.items():
    path.write_text(wrap(content), encoding="utf-8")
    print(path.relative_to(ROOT))
