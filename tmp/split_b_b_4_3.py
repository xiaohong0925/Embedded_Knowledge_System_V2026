from pathlib import Path

ROOT = Path(r"E:\HongWork\MySelf\MyKnowledge\Embedded_Knowledge_System_V2026")
BASE = ROOT / 'docs' / 'B. 总线协议' / 'B. 低速外设接口'
SOURCE = BASE / 'B-B.4.3_SPI Linux驱动框架.md'
text = SOURCE.read_text(encoding='utf-8')
(ROOT / 'tmp' / 'review' / 'B-B.4.3-original.md').write_text(text, encoding='utf-8')

H = {
    'map': '## <span class="blue"> 先沿一笔读取看清责任线',
    'startup': '## <span class="blue"> 从控制器节点到外设 probe',
    'message': '## <span class="blue"> 用手工双段 message 建立完整基线',
    'execution': '## <span class="blue"> spi_sync 之后，Core 和 Rockchip 各做什么',
    'api': '## <span class="blue"> 便捷封装减少了什么，又没有改变什么',
    'practice': '## <span class="blue"> 构建、加载与观察同一笔事务',
    'summary': '## <span class="blue"> 本节总结',
    'qa': '## <span class="blue"> 本节自查',
}


def section(start, end=None):
    i = text.index(H[start])
    j = text.index(H[end]) if end else len(text)
    return text[i:j].strip() + '\n'


prefix = text[:text.index(H['map'])].strip().replace(' | 预计阅读时间：55 分钟', '') + '\n'
map_section = section('map', 'startup')
iframe_start = map_section.index('<div class="interactive-demo">')
iframe_end = map_section.index('</div>', iframe_start) + len('</div>')
map_without_iframe = map_section[:iframe_start] + map_section[iframe_end:]
qa_region = section('qa')


def q(number):
    marker = f'??? details "Q{number}.'
    start = qa_region.index(marker)
    next_q = qa_region.find('\n??? details "', start + len(marker))
    end = next_q if next_q != -1 else len(qa_region)
    return qa_region[start:end].strip() + '\n'


Q = {i: q(i) for i in range(1, 9)}
NAV = {
    'overview': '[下一页：DTS 建链与对象生命周期](B-B.4.3_SPI Linux驱动框架_startup.md)',
    'startup': '[上一页：导读与责任地图](B-B.4.3_SPI Linux驱动框架.md) · [下一页：手工双段 message](B-B.4.3_SPI Linux驱动框架_message.md)',
    'message': '[上一页：DTS 建链](B-B.4.3_SPI Linux驱动框架_startup.md) · [下一页：Core 与 Rockchip 执行](B-B.4.3_SPI Linux驱动框架_execution.md)',
    'execution': '[上一页：手工双段 message](B-B.4.3_SPI Linux驱动框架_message.md) · [下一页：便捷封装的边界](B-B.4.3_SPI Linux驱动框架_api.md)',
    'api': '[上一页：Core 与 Rockchip 执行](B-B.4.3_SPI Linux驱动框架_execution.md) · [下一页：构建观察与产品移交](B-B.4.3_SPI Linux驱动框架_practice.md)',
    'practice': '[上一页：便捷封装的边界](B-B.4.3_SPI Linux驱动框架_api.md) · [回到导读与责任地图](B-B.4.3_SPI Linux驱动框架.md)',
}


def wrap(content):
    while '\n---\n\n---\n' in content:
        content = content.replace('\n---\n\n---\n', '\n---\n')
    return '<div class="reader-b2" markdown="1">\n\n' + content.strip() + '\n\n</div>\n'


def header(title, index, question):
    return (
        f'# {title}\n\n'
        '> 所属章节：第五部 B. 总线协议 > B-B.4 SPI 总线 > B-B.4.3 SPI Linux 驱动框架\n>\n'
        f'> 本组阅读：第 {index} 页，共 6 页\n\n'
        f'本页只回答一个问题：**{question}**\n\n---\n\n'
    )


def footer(key):
    return '\n---\n\n' + NAV[key] + '\n'


def qa(title, *numbers):
    return f'## <span class="blue"> {title}\n\n' + '\n'.join(Q[n] for n in numbers)


def lab(anchor, text):
    return f'[在新窗口打开 SPI Framework Lab](./html/spi-framework-lab.html{anchor}){{: target="_blank" rel="noopener noreferrer" }}。{text}\n\n'


overview = (
    prefix
    + '\n## <span class="blue"> 怎样阅读这组短页面\n\n'
    + '这组页面沿用同一笔 5＋4 字节 Fast Read，但把对象创建、代码组装、底层执行、封装选择和实际观察分开。完整教学文件、真实源码与 Framework Lab 始终用于回查，不让某一段孤立代码承担整个子系统的解释。\n\n'
    + '1. **导读与责任地图**：先知道一笔读取经过哪些角色；\n'
    + '2. **DTS 建链与对象生命周期**：理解 `spi_device` 为什么先于 probe 存在；\n'
    + '3. **手工双段 message 基线**：看清分段、缓冲区、返回值与释放；\n'
    + '4. **Core 与 Rockchip 执行路径**：理解调度、CS、DMA 与完成通知；\n'
    + '5. **便捷封装的边界**：判断何时使用 `spi_write_then_read()`；\n'
    + '6. **构建观察与产品移交**：完成验证，并回到 spi-nor → MTD 产品路径。\n\n'
    + '[开始阅读：DTS 建链与对象生命周期](B-B.4.3_SPI Linux驱动框架_startup.md)。\n\n---\n\n'
    + map_without_iframe
    + '\n---\n\n'
    + qa('本页自查', 1)
    + footer('overview')
)

startup = (
    header('DTS 建链：spi_device 怎样进入 probe', 2, 'spi_device 从哪里来，为什么 probe 不负责创建它？')
    + section('startup', 'message')
    + '\n---\n\n'
    + lab('#mechanism', '在实验室中逐步观察控制器注册、DTS 建链与 probe 参数的来源。')
    + qa('本页自查', 2)
    + footer('startup')
)

message = (
    header('手工双段 message：5＋4 字节怎样完成并释放', 3, '两个 spi_transfer、缓冲区和 message 怎样组织一笔读取，并在成功或失败后正确返回？')
    + section('message', 'execution')
    + '\n---\n\n'
    + lab('#mechanism', '在实验室中对照双段提交、实际完成长度、返回值和缓冲区释放。')
    + qa('本页自查', 3, 4)
    + footer('message')
)

execution = (
    header('spi_sync 之后：Core 和 Rockchip 各做什么', 4, 'spi_sync() 之后谁校验、调度、操作硬件、处理 CS，并把状态带回调用者？')
    + section('execution', 'api')
    + '\n---\n\n'
    + lab('#mechanism', '在实验室中观察正常与首段失败路径，确认第二段、CS 和负错误的处理。')
    + qa('本页自查', 5, 7)
    + footer('execution')
)

api = (
    header('便捷封装：spi_write_then_read() 改变了什么', 5, 'spi_write_then_read() 减少了哪些样板工作，又保留了哪些器件协议与传输责任？')
    + section('api', 'practice')
    + '\n---\n\n'
    + qa('本页自查', 6)
    + footer('api')
)

practice = (
    header('构建与观察：教学模块怎样验证并移交产品路径', 6, '怎样构建、加载并观察同一笔事务，为什么正式 W25Q 产品仍应进入 spi-nor 和 MTD？')
    + section('practice', 'summary')
    + '\n---\n\n'
    + lab('#source', '在源码工作台中回查本组使用的教学文件与完整实现。')
    + section('summary', 'qa')
    + '\n---\n\n'
    + qa('本页自查', 8)
    + footer('practice')
)

outputs = {
    SOURCE: overview,
    BASE / 'B-B.4.3_SPI Linux驱动框架_startup.md': startup,
    BASE / 'B-B.4.3_SPI Linux驱动框架_message.md': message,
    BASE / 'B-B.4.3_SPI Linux驱动框架_execution.md': execution,
    BASE / 'B-B.4.3_SPI Linux驱动框架_api.md': api,
    BASE / 'B-B.4.3_SPI Linux驱动框架_practice.md': practice,
}
for path, content in outputs.items():
    path.write_text(wrap(content), encoding='utf-8')
    print(path.relative_to(ROOT))
