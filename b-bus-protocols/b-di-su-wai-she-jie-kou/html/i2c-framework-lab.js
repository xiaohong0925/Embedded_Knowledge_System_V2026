(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const pad = (value) => String(value).padStart(2, "0");

  function listen(id, event, handler) {
    const element = $(id);
    if (element) element.addEventListener(event, handler);
  }

  function setPressed(buttons, activeButton) {
    buttons.forEach((button) => {
      const active = button === activeButton;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function renderCode(element, source, currentLine = -1, startLine = 1) {
    element.replaceChildren();
    source.replace(/\n$/, "").split("\n").forEach((line, index) => {
      const sourceLine = startLine + index;
      const row = document.createElement("span");
      row.className = "code-line";
      if (sourceLine === currentLine) row.classList.add("is-current");

      const number = document.createElement("span");
      number.className = "line-no";
      number.textContent = String(sourceLine);
      number.setAttribute("aria-hidden", "true");

      const text = document.createElement("span");
      text.className = "line-text";
      text.textContent = line || " ";
      row.append(number, text);
      element.appendChild(row);
    });

    const current = element.querySelector(".is-current");
    if (current) {
      const windowElement = element.parentElement;
      const top = current.offsetTop - windowElement.clientHeight / 2;
      windowElement.scrollTop = Math.max(0, top);
    } else {
      element.parentElement.scrollTop = 0;
    }
  }

  const codeViewModes = { boot: "snippet", transfer: "snippet" };

  function renderCodeView(prefix, step) {
    const showFull = codeViewModes[prefix] === "full" && step.full;
    const view = showFull ? step.full : step;
    $(`${prefix}-code-path`).textContent = showFull
      ? `${view.path} · 起始行 ${view.startLine}`
      : `${step.path} · 步骤片段`;
    renderCode($(`${prefix}-code`), view.code, view.line, showFull ? view.startLine : 1);

    const toggle = $(`${prefix}-full-toggle`);
    if (toggle) {
      toggle.textContent = showFull ? "步骤片段" : "完整函数";
      toggle.setAttribute("aria-pressed", String(Boolean(showFull)));
      toggle.disabled = !step.full;
      toggle.title = step.full
        ? "在步骤片段与完整函数（或完整教学文件）之间切换"
        : "本步骤没有可展开的完整函数";
    }
  }

  function wireCodeView(prefix, rerender) {
    const path = $(`${prefix}-code-path`);
    const heading = path.parentElement;
    heading.querySelector(".pane-badge")?.remove();
    const button = document.createElement("button");
    button.id = `${prefix}-full-toggle`;
    button.className = "code-full-toggle";
    button.type = "button";
    button.textContent = "完整函数";
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      codeViewModes[prefix] = codeViewModes[prefix] === "full" ? "snippet" : "full";
      rerender();
    });
    heading.appendChild(button);
  }

  function makeStepStrip(container, steps, getIndex, setIndex) {
    container.replaceChildren();
    steps.forEach((step, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "step-chip";
      const number = document.createElement("span");
      number.textContent = pad(index + 1);
      button.append(number, document.createTextNode(step.label));
      button.addEventListener("click", () => setIndex(index));
      container.appendChild(button);
    });

    return () => {
      const current = getIndex();
      $$(".step-chip", container).forEach((button, index) => {
        button.classList.toggle("is-active", index === current);
        button.classList.toggle("is-done", index < current);
        if (index === current) button.setAttribute("aria-current", "step");
        else button.removeAttribute("aria-current");
      });
    };
  }

  function wireStepper(prefix, count, getIndex, setIndex) {
    listen(`${prefix}-prev`, "click", () => setIndex(Math.max(0, getIndex() - 1)));
    listen(`${prefix}-next`, "click", () => setIndex(Math.min(count() - 1, getIndex() + 1)));
    listen(`${prefix}-reset`, "click", () => setIndex(0));
  }

  /* -----------------------------------------------------------------------
   * 01 / BOOT — DTS, persistent objects and callbacks appear in order.
   * -------------------------------------------------------------------- */
  const bootSteps = [
    {
      label: "DTS 描述",
      path: "rk3568-at24-demo.dts",
      code: `&i2c1 {\n    status = "okay";\n    clock-frequency = <400000>;\n\n    eeprom@50 {\n        compatible = "demo,at24c02-reader";\n        reg = <0x50>;\n    };\n};`,
      line: 6,
      active: ["dts"],
      observations: ["DTS 只有硬件事实，还没有 client 指针", "目标：I2C1 · 400 kHz · 7-bit 0x50"],
      note: "设备树先回答“控制器是否启用、外设地址是多少”。compatible 是匹配依据，reg 将由 Core 读入 client->addr。"
    },
    {
      label: "分配私有对象",
      path: "drivers/i2c/busses/i2c-rk3x.c · rk3x_i2c_probe()",
      code: `struct rk3x_i2c *i2c;\n\ni2c = devm_kzalloc(&pdev->dev, sizeof(*i2c), GFP_KERNEL);\nif (!i2c)\n    return -ENOMEM;\n\nplatform_set_drvdata(pdev, i2c);`,
      line: 3,
      active: ["rk3x"],
      observations: ["struct rk3x_i2c 已分配并清零", "devm 在失败或解绑路径负责释放"],
      note: "rk3x_i2c 是控制器私有对象。此时还没有注册 adapter，也还不能根据子节点创建外设 client。"
    },
    {
      label: "安装 algorithm",
      path: "drivers/i2c/busses/i2c-rk3x.c · 填内嵌 adapter",
      code: `i2c->adap.owner = THIS_MODULE;\ni2c->adap.algo = &rk3x_i2c_algorithm;\ni2c->adap.retries = 3;\ni2c->adap.dev.of_node = np;\ni2c->adap.algo_data = i2c;\n\nstatic const struct i2c_algorithm rk3x_i2c_algorithm = {\n    .master_xfer = rk3x_i2c_xfer,\n    .functionality = rk3x_i2c_func,\n};`,
      line: 2,
      active: ["adap", "algorithm"],
      observations: ["i2c->adap.algo：adap 内嵌，algo 是指针", "algo_data=i2c：回调可取回私有对象"],
      note: "adapter 保存总线身份与锁；algorithm 保存 master_xfer 等操作。二者分开，Core 才能替换总线实现。"
    },
    {
      label: "注册 adapter",
      path: "drivers/i2c/i2c-core-base.c · i2c_register_adapter()",
      code: `ret = i2c_register_adapter(adap);\n\n/* 注册成功后扫描固件子节点 */\nof_i2c_register_devices(adap);`,
      line: 4,
      active: ["adap", "dts"],
      observations: ["adapter nr=1 已进入 I2C Core", "开始扫描 i2c1 的子节点 eeprom@50"],
      note: "只有总线对象先注册，Core 才知道这颗外设应该归属于哪条 adapter。编号 1 后来也进入设备名 1-0050 和 /dev/i2c-1。"
    },
    {
      label: "创建 client",
      path: "drivers/i2c/i2c-core-of.c · of_i2c_register_device()",
      code: `/* of_i2c_get_board_info() */\nret = of_property_read_u32(node, "reg", &addr);\ninfo.addr = addr;\ninfo.of_node = node;\n\n/* of_i2c_register_device() */\nret = of_i2c_get_board_info(&adap->dev, node, &info);\nclient = i2c_new_client_device(adap, &info);`,
      line: 2,
      active: ["client"],
      observations: ["client->addr = 0x50", "client->adapter = adapter nr=1", "通用设备名：1-0050"],
      note: "of_i2c_get_board_info() 先读取 reg 并填写 info；of_i2c_register_device() 再用它创建持久 client。教学驱动稍后收到的是这个已存在对象的地址。"
    },
    {
      label: "登记外设驱动",
      path: "demo_i2c.c · 静态对象与注册宏",
      code: `static struct i2c_driver demo_driver = {\n    .driver = {\n        .name = "demo_i2c",\n        .of_match_table = demo_of_match,\n    },\n    .probe = demo_probe,\n    .remove = demo_remove,\n};\n\nmodule_i2c_driver(demo_driver);`,
      line: 10,
      active: ["driver"],
      observations: ["加载：i2c_add_driver()", "卸载：i2c_del_driver()", "MODULE_DEVICE_TABLE 只导出自动加载别名"],
      note: "driver 是另一类对象：它不表示一颗物理外设，而是登记匹配表和生命周期回调。模块卸载注销的是驱动，不是直接销毁 Core 的 client。"
    },
    {
      label: "匹配并 probe",
      path: "demo_i2c.c · demo_probe()",
      code: `static int demo_probe(struct i2c_client *client)\n{\n    u8 value;\n    int ret;\n\n    if (!i2c_check_functionality(client->adapter, I2C_FUNC_I2C))\n        return -EOPNOTSUPP;\n\n    ret = demo_read_reg(client, 0x10, &value);\n    if (ret)\n        return ret;\n    return 0;\n}`,
      line: 9,
      active: ["client", "driver", "algorithm"],
      observations: ["compatible 命中 demo_of_match[]", "demo_probe(client) 收到已创建的 client", "能力检查通过后才提交读取"],
      note: "到这里，DTS、client、adapter、algorithm 和 driver 已连成可执行路径。probe 返回 0 才允许本次绑定成功。"
    },
    {
      label: "建立用户入口",
      path: "drivers/i2c/i2c-dev.c · i2cdev_attach_adapter()",
      code: `i2c_dev->dev.devt = MKDEV(I2C_MAJOR, adap->nr);\ni2c_dev->dev.class = i2c_dev_class;\ni2c_dev->dev.parent = &adap->dev;\n\ndev_set_name(&i2c_dev->dev, "i2c-%d", adap->nr);\ncdev_device_add(&i2c_dev->cdev, &i2c_dev->dev);`,
      line: 6,
      active: ["i2cdev", "adap"],
      observations: ["/sys/class/i2c-dev/i2c-1", "/dev/i2c-1（由 devtmpfs 提供节点）", "这是 adapter 入口，不是 AT24 专属 eeprom 文件"],
      note: "i2c-dev 监听 adapter 注册并创建字符设备入口。它与 client 的 at24/NVMEM 外设入口来源不同，不要混成同一个文件。"
    }
  ];

  let bootIndex = 0;
  const updateBootStrip = makeStepStrip($("boot-step-strip"), bootSteps, () => bootIndex, (index) => {
    bootIndex = index;
    renderBoot();
  });

  function renderBoot() {
    const step = bootSteps[bootIndex];
    $("boot-counter").textContent = `${pad(bootIndex + 1)} / ${pad(bootSteps.length)}`;
    $("boot-note").textContent = step.note;
    renderCodeView("boot", step);

    const appeared = new Set();
    for (let index = 0; index <= bootIndex; index += 1) {
      bootSteps[index].active.forEach((node) => appeared.add(node));
    }
    $$("[data-node]", $("boot-object-map")).forEach((node) => {
      const name = node.dataset.node;
      node.classList.toggle("is-active", step.active.includes(name));
      node.classList.toggle("is-complete", appeared.has(name) && !step.active.includes(name));
    });

    const observations = $("boot-observations");
    observations.replaceChildren();
    step.observations.forEach((observation) => {
      const item = document.createElement("li");
      item.textContent = observation;
      observations.appendChild(item);
    });

    $("boot-prev").disabled = bootIndex === 0;
    $("boot-next").disabled = bootIndex === bootSteps.length - 1;
    updateBootStrip();
  }

  wireStepper("boot", () => bootSteps.length, () => bootIndex, (index) => {
    bootIndex = index;
    renderBoot();
  });

  /* -----------------------------------------------------------------------
   * 02 / TRANSFER — all states are source-derived teaching models.
   * -------------------------------------------------------------------- */
  const messageCode = `struct i2c_msg msgs[2] = {\n    { .addr = client->addr, .flags = 0,\n      .len = 1, .buf = &reg },\n    { .addr = client->addr, .flags = I2C_M_RD,\n      .len = 1, .buf = value },\n};\n\nret = i2c_transfer(client->adapter, msgs, 2);`;
  const lockCode = `int i2c_transfer(struct i2c_adapter *adap,\n                 struct i2c_msg *msgs, int num)\n{\n    if (!adap->algo->master_xfer)\n        return -EOPNOTSUPP;\n\n    ret = __i2c_lock_bus_helper(adap);\n    if (ret)\n        return ret;\n\n    ret = __i2c_transfer(adap, msgs, num);\n    i2c_unlock_bus(adap, I2C_LOCK_SEGMENT);\n    return ret;\n}`;
  const startCode = `struct rk3x_i2c *i2c = adap->algo_data;\n\nret = rk3x_i2c_setup(i2c, msgs + i, num - i);\nrk3x_i2c_start(i2c);\n\n/* rk3x_i2c_start() */\ni2c->msg = msgs;\ni2c->busy = true;\ni2c->state = STATE_START;\ni2c->processed = 0;\ni2c->error = 0;`;
  const readCode = `static void rk3x_i2c_handle_read(...)\n{\n    /* 从 RXFIFO 读出后写入当前消息缓冲区 */\n    i2c->msg->buf[i2c->processed++] = i2c_readl(i2c, REG_MRXF);\n\n    if (i2c->processed == i2c->msg->len)\n        rk3x_i2c_stop(i2c, i2c->error);\n}`;
  const finishCode = `ret = __i2c_transfer(adap, msgs, num);\ni2c_unlock_bus(adap, I2C_LOCK_SEGMENT);\nreturn ret;\n\n/* demo_read_reg() */\nif (ret < 0)\n    return ret;\nif (ret != 2)\n    return -EIO;\nreturn 0;`;

  const transferSteps = {
    normal: [
      { label: "构造消息", path: "demo_i2c.c", code: messageCode, line: 8, lock: "unlocked", busy: "false", machine: "IDLE", processed: 0, error: "0", value: "—", messages: ["pending", "pending"], bus: ["START", "0x50 W", "ACK", "0x10", "ACK", "Sr", "0x50 R", "ACK", "0x5a", "NACK", "STOP"], busIndex: -1, returnValue: ["尚未调用", "等待 msgs[2]"], note: "第一条写 AT24 内部偏移，第二条读数据。它们属于同一笔事务，不是两次独立传输。" },
      { label: "检查能力", path: "demo_i2c.c · demo_probe()", code: `if (!i2c_check_functionality(client->adapter, I2C_FUNC_I2C))\n    return -EOPNOTSUPP;`, line: 1, lock: "unlocked", busy: "false", machine: "IDLE", processed: 0, error: "0", value: "—", messages: ["pending", "pending"], busIndex: -1, returnValue: ["能力检查通过", "adapter 支持普通 I2C 消息"], note: "I2C_FUNC_I2C 是适配器能力位；I2C_M_RD 才是第二条消息的方向位。" },
      { label: "Core 持锁", path: "drivers/i2c/i2c-core-base.c", code: lockCode, line: 7, lock: "locked by demo", busy: "false", machine: "IDLE", processed: 0, error: "0", value: "—", messages: ["pending", "pending"], busIndex: -1, returnValue: ["i2c_transfer()", "同一 adapter 的其他事务等待"], note: "Core 在调用控制器实现前持有总线锁，保证本组两条消息不会与同总线另一笔事务穿插。" },
      { label: "选择回调", path: "drivers/i2c/i2c-core-base.c · __i2c_transfer()", code: `if (i2c_in_atomic_xfer_mode() && adap->algo->master_xfer_atomic)\n    ret = adap->algo->master_xfer_atomic(adap, msgs, num);\nelse\n    ret = adap->algo->master_xfer(adap, msgs, num);\n\n/* 本例普通上下文 */\nadap->algo->master_xfer = rk3x_i2c_xfer;`, line: 4, lock: "locked by demo", busy: "false", machine: "IDLE", processed: 0, error: "0", value: "—", messages: ["current", "pending"], busIndex: -1, returnValue: ["rk3x_i2c_xfer()", "经 algorithm 进入 RK3568 实现"], note: "外设驱动没有直接调用 rk3x 函数。Core 通过 adapter 内已安装的函数指针找到控制器实现。" },
      { label: "启动写消息", path: "drivers/i2c/busses/i2c-rk3x.c", code: startCode, line: 8, lock: "locked by demo", busy: "true", machine: "START → WRITE", processed: 0, error: "0", value: "—", messages: ["current", "pending"], busIndex: 1, returnValue: ["同步等待", "wait_event_timeout(!i2c->busy)"], note: "start 保存当前消息并把 busy 置真。状态机先处理地址和写方向，内部偏移 0x10 随后经 TXFIFO 发出。" },
      { label: "写完偏移", path: "drivers/i2c/busses/i2c-rk3x.c · WRITE", code: `if (i2c->processed == i2c->msg->len)\n    rk3x_i2c_stop(i2c, i2c->error);\n\n/* 后面还有消息：不发送 STOP */\ni2c->busy = false;\ni2c->state = STATE_IDLE;\n/* 返回循环，准备下一条消息 */`, line: 1, lock: "locked by demo", busy: "false", machine: "IDLE（段间）", processed: 1, error: "0", value: "—", messages: ["done", "current"], busIndex: 5, returnValue: ["msgs[0] 完成", "重复 START，继续 msgs[1]"], note: "RK3568 驱动在段间恢复内部状态，再以重复 START 开始读消息；这里没有先结束整笔事务。" },
      { label: "启动读消息", path: "drivers/i2c/busses/i2c-rk3x.c", code: startCode, line: 8, lock: "locked by demo", busy: "true", machine: "START → READ", processed: 0, error: "0", value: "—", messages: ["done", "current"], busIndex: 7, returnValue: ["同步等待", "第二条 msg.buf 指向 value"], note: "第二条消息带 I2C_M_RD，控制器切换为接收。processed 对当前消息重新计数，不再保留上一条的 1。" },
      { label: "接收 0x5a", path: "drivers/i2c/busses/i2c-rk3x.c · READ", code: readCode, line: 4, lock: "locked by demo", busy: "true", machine: "READ → STOP", processed: 1, error: "0", value: "0x5a", messages: ["done", "current"], busIndex: 9, returnValue: ["数据已写回", "value = 0x5a；尚未解锁返回"], note: "样本字节从 RXFIFO 写入 msgs[1].buf 指向的 value。0x5a 是教学样本，不是函数返回值或板卡实测。" },
      { label: "STOP 并唤醒", path: "drivers/i2c/busses/i2c-rk3x.c · STOP", code: `i2c->busy = false;\ni2c->state = STATE_IDLE;\nwake_up(&i2c->wait);\n\n/* xfer_common：本例 num = 2 */\nreturn ret < 0 ? ret : num;`, line: 3, lock: "locked by demo", busy: "false", machine: "IDLE", processed: 1, error: "0", value: "0x5a", messages: ["done", "done"], busIndex: 10, returnValue: ["rk3x 返回 2", "2 是完成的消息数，不是读取值"], note: "STOP 中断把 busy 清假并唤醒等待者。xfer_common 在成功路径返回 num，因此本例为 2。" },
      { label: "解锁并返回", path: "i2c-core-base.c → demo_i2c.c", code: finishCode, line: 9, lock: "unlocked", busy: "false", machine: "IDLE", processed: 1, error: "0", value: "0x5a", messages: ["done", "done"], busIndex: 10, returnValue: ["demo_read_reg() 返回 0", "i2c_transfer()=2 · value=0x5a", "good"], note: "Core 解锁后返回 2；教学函数确认完成两条消息，再把自己的结果转换为 0。数据仍在 value 中。" }
    ],
    nack: [
      { label: "构造消息", path: "demo_i2c.c", code: messageCode, line: 8, lock: "unlocked", busy: "false", machine: "IDLE", processed: 0, error: "0", value: "—", messages: ["pending", "pending"], bus: ["START", "0x50 W", "NACK", "STOP"], busIndex: -1, returnValue: ["尚未调用", "故障条件：地址阶段 NACK"], note: "消息构造与正常路径完全相同。故障不是由教学代码预先知道，而是在总线地址阶段被控制器报告。" },
      { label: "检查能力", path: "demo_i2c.c · demo_probe()", code: `if (!i2c_check_functionality(client->adapter, I2C_FUNC_I2C))\n    return -EOPNOTSUPP;`, line: 1, lock: "unlocked", busy: "false", machine: "IDLE", processed: 0, error: "0", value: "—", messages: ["pending", "pending"], busIndex: -1, returnValue: ["能力检查通过", "能力正常不等于外设一定应答"], note: "adapter 支持 I2C，只说明可以提交消息；它不保证地址 0x50 上存在且能响应的器件。" },
      { label: "Core 持锁", path: "drivers/i2c/i2c-core-base.c", code: lockCode, line: 7, lock: "locked by demo", busy: "false", machine: "IDLE", processed: 0, error: "0", value: "—", messages: ["pending", "pending"], busIndex: -1, returnValue: ["i2c_transfer()", "准备进入控制器"], note: "失败路径同样先持有总线锁，因此错误清理和 STOP 仍属于这笔串行化事务。" },
      { label: "选择回调", path: "drivers/i2c/i2c-core-base.c · __i2c_transfer()", code: `ret = adap->algo->master_xfer(adap, msgs, num);\n/* = rk3x_i2c_xfer(adap, msgs, 2) */`, line: 1, lock: "locked by demo", busy: "false", machine: "IDLE", processed: 0, error: "0", value: "—", messages: ["current", "pending"], busIndex: -1, returnValue: ["rk3x_i2c_xfer()", "等待地址应答"], note: "公共入口没有改写消息或错误码，真正的 NACK 由 RK3568 中断路径识别。" },
      { label: "启动地址阶段", path: "drivers/i2c/busses/i2c-rk3x.c", code: startCode, line: 8, lock: "locked by demo", busy: "true", machine: "START → WRITE", processed: 0, error: "0", value: "—", messages: ["current", "pending"], busIndex: 1, returnValue: ["同步等待", "busy=true"], note: "控制器发出 START 和写地址。此时尚未发送内部偏移，更不会执行第二条读消息。" },
      { label: "收到 NACK", path: "drivers/i2c/busses/i2c-rk3x.c · rk3x_i2c_irq()", code: `if (ipd & REG_INT_NAKRCV) {\n    ipd &= ~REG_INT_NAKRCV;\n    if (!(i2c->msg->flags & I2C_M_IGNORE_NAK))\n        rk3x_i2c_stop(i2c, -ENXIO);\n}`, line: 4, lock: "locked by demo", busy: "true", machine: "WRITE → STOP", processed: 0, error: "-ENXIO", value: "—", messages: ["error", "pending"], busIndex: 2, returnValue: ["记录 -ENXIO", "生成 STOP，终止剩余消息", "error"], note: "v6.6 在 NACK 且未设置 I2C_M_IGNORE_NAK 时调用 rk3x_i2c_stop(i2c, -ENXIO)。错误不是由实验室随意编造的。" },
      { label: "STOP 并唤醒", path: "drivers/i2c/busses/i2c-rk3x.c", code: `i2c->busy = false;\ni2c->state = STATE_IDLE;\nwake_up(&i2c->wait);\n\nif (i2c->error) {\n    ret = i2c->error;\n    break;\n}`, line: 6, lock: "locked by demo", busy: "false", machine: "IDLE", processed: 0, error: "-ENXIO", value: "—", messages: ["error", "pending"], busIndex: 3, returnValue: ["rk3x 返回 -ENXIO", "msgs[1] 未执行", "error"], note: "等待者醒来后先看到 i2c->error，循环停止。返回值是负错误码，不是已处理消息数。" },
      { label: "解锁并返回", path: "i2c-core-base.c → demo_i2c.c", code: finishCode, line: 5, lock: "unlocked", busy: "false", machine: "IDLE", processed: 0, error: "-ENXIO", value: "—", messages: ["error", "pending"], busIndex: 3, returnValue: ["demo_read_reg() 返回 -ENXIO", "value 无效 · probe 失败", "error"], note: "教学函数保留负错误码并向上传递；不会把第二条消息未执行的情况误报为读取成功。" }
    ],
    timeout: [
      { label: "构造消息", path: "demo_i2c.c", code: messageCode, line: 8, lock: "unlocked", busy: "false", machine: "IDLE", processed: 0, error: "0", value: "—", messages: ["pending", "pending"], bus: ["START", "0x50 W", "等待完成", "强制 STOP"], busIndex: -1, returnValue: ["尚未调用", "故障条件：控制器等待超时"], note: "这里模拟启动后一直没有正常完成唤醒，不是 NACK 立即报错。两条消息仍与正常路径相同。" },
      { label: "检查能力", path: "demo_i2c.c · demo_probe()", code: `if (!i2c_check_functionality(client->adapter, I2C_FUNC_I2C))\n    return -EOPNOTSUPP;`, line: 1, lock: "unlocked", busy: "false", machine: "IDLE", processed: 0, error: "0", value: "—", messages: ["pending", "pending"], busIndex: -1, returnValue: ["能力检查通过", "进入同步传输"], note: "能力检查无法预测控制器中断丢失或状态机不完成，因此仍进入传输。" },
      { label: "Core 持锁", path: "drivers/i2c/i2c-core-base.c", code: lockCode, line: 7, lock: "locked by demo", busy: "false", machine: "IDLE", processed: 0, error: "0", value: "—", messages: ["pending", "pending"], busIndex: -1, returnValue: ["i2c_transfer()", "持锁等待控制器结果"], note: "等待期间同 adapter 的其他事务仍被锁挡住，避免故障事务尚未清理时混入新的波形。" },
      { label: "选择回调", path: "drivers/i2c/i2c-core-base.c · __i2c_transfer()", code: `ret = adap->algo->master_xfer(adap, msgs, num);\n/* = rk3x_i2c_xfer(adap, msgs, 2) */`, line: 1, lock: "locked by demo", busy: "false", machine: "IDLE", processed: 0, error: "0", value: "—", messages: ["current", "pending"], busIndex: -1, returnValue: ["rk3x_i2c_xfer()", "准备启动状态机"], note: "调用仍经 algorithm 进入 RK3568 驱动。超时发生在控制器等待阶段，不在用户程序里计时。" },
      { label: "启动并等待", path: "drivers/i2c/busses/i2c-rk3x.c · xfer_common", code: `rk3x_i2c_start(i2c);\n\ntimeout = wait_event_timeout(i2c->wait, !i2c->busy,\n                             msecs_to_jiffies(WAIT_TIMEOUT));`, line: 3, lock: "locked by demo", busy: "true", machine: "WRITE（未结束）", processed: 0, error: "0", value: "—", messages: ["current", "pending"], busIndex: 2, returnValue: ["等待 !i2c->busy", "尚无完成中断"], note: "wait_event_timeout 等待 busy 被中断路径清假。此处模型让等待期限耗尽，而不是正常唤醒。" },
      { label: "等待返回 0", path: "drivers/i2c/busses/i2c-rk3x.c · 超时路径", code: `if (timeout == 0) {\n    dev_err(i2c->dev, "timeout, ipd: 0x%02x\\n", ipd);\n\n    /* 强制 STOP，保留 tuning 位 */\n    val = i2c_readl(i2c, REG_CON) & REG_CON_TUNING_MASK;\n    val |= REG_CON_EN | REG_CON_STOP;\n    i2c_writel(i2c, val, REG_CON);\n    i2c->state = STATE_IDLE;\n    ret = -ETIMEDOUT;\n    break;\n}`, line: 10, lock: "locked by demo", busy: "true", machine: "IDLE（强制恢复）", processed: 0, error: "-ETIMEDOUT", value: "—", messages: ["error", "pending"], busIndex: 3, returnValue: ["rk3x 返回 -ETIMEDOUT", "wait_event_timeout()=0", "error"], note: "返回值 0 来自等待函数，含义是超时。驱动强制 STOP、恢复 STATE_IDLE，再把本次传输结果设为 -ETIMEDOUT。" },
      { label: "退出消息循环", path: "drivers/i2c/busses/i2c-rk3x.c", code: `if (timeout == 0) {\n    ret = -ETIMEDOUT;\n    break;\n}\n\nreturn ret < 0 ? ret : num;`, line: 2, lock: "locked by demo", busy: "true", machine: "IDLE", processed: 0, error: "-ETIMEDOUT", value: "—", messages: ["error", "pending"], busIndex: 3, returnValue: ["负错误，不返回 num", "第二条消息未执行", "error"], note: "由于 ret 是负值，最后不会返回消息总数 2。模型保留 busy=true 以表示没有正常完成唤醒，同时 state 已被超时路径强制恢复。" },
      { label: "解锁并返回", path: "i2c-core-base.c → demo_i2c.c", code: finishCode, line: 5, lock: "unlocked", busy: "true", machine: "IDLE", processed: 0, error: "-ETIMEDOUT", value: "—", messages: ["error", "pending"], busIndex: 3, returnValue: ["demo_read_reg() 返回 -ETIMEDOUT", "value 无效 · probe 失败", "error"], note: "Core 解锁并传播负错误。教学驱动不能将超时当成 0 字节读取，也不能使用未更新的 value。" }
    ]
  };

  /* Each step can expand to a verbatim complete function or teaching file. */
  const bootFullRefs = [
    ["demoDts", "eeprom@50"],
    ["rk3xProbe", "devm_kzalloc"],
    ["rk3xProbe", "i2c->adap.algo ="],
    ["i2cRegisterAdapter", "of_i2c_register_devices(adap)"],
    ["ofI2cClientChain", "of_property_read_u32"],
    ["demoFile", "module_i2c_driver(demo_driver)"],
    ["demoProbe", "i2c_check_functionality"],
    ["i2cdevAttachAdapter", "cdev_device_add"]
  ];
  const transferFullRefs = {
    normal: [
      ["demoReadReg", "ret = i2c_transfer"],
      ["demoProbe", "i2c_check_functionality"],
      ["i2cTransfer", "__i2c_lock_bus_helper"],
      ["i2cTransferInternal", "ret = adap->algo->master_xfer(adap"],
      ["rk3xXferCommon", "rk3x_i2c_start(i2c)"],
      ["rk3xHandleWrite", "i2c->processed == i2c->msg->len"],
      ["rk3xXferCommon", "rk3x_i2c_start(i2c)"],
      ["rk3xHandleRead", "i2c->msg->buf[i2c->processed++]"],
      ["rk3xStop", "wake_up"],
      ["demoReadReg", "if (ret != 2)"]
    ],
    nack: [
      ["demoReadReg", "ret = i2c_transfer"],
      ["demoProbe", "i2c_check_functionality"],
      ["i2cTransfer", "__i2c_lock_bus_helper"],
      ["i2cTransferInternal", "ret = adap->algo->master_xfer(adap"],
      ["rk3xXferCommon", "rk3x_i2c_start(i2c)"],
      ["rk3xIrq", "rk3x_i2c_stop(i2c, -ENXIO)"],
      ["rk3xXferCommon", "if (i2c->error)"],
      ["demoReadReg", "if (ret < 0)"]
    ],
    timeout: [
      ["demoReadReg", "ret = i2c_transfer"],
      ["demoProbe", "i2c_check_functionality"],
      ["i2cTransfer", "__i2c_lock_bus_helper"],
      ["i2cTransferInternal", "ret = adap->algo->master_xfer(adap"],
      ["rk3xXferCommon", "wait_event_timeout"],
      ["rk3xXferCommon", "ret = -ETIMEDOUT"],
      ["rk3xXferCommon", "return ret < 0 ? ret : num"],
      ["demoReadReg", "if (ret < 0)"]
    ]
  };

  function makeFullView(ref) {
    const [key, needle] = ref;
    const item = window.I2C_FULL_CODE[key];
    if (!item) throw new Error(`完整代码缺失：${key}`);
    const index = item.code.split("\n").findIndex(line => line.includes(needle));
    if (index < 0) throw new Error(`完整代码定位失败：${key} · ${needle}`);
    return { ...item, line: item.startLine + index };
  }

  bootSteps.forEach((step, index) => {
    step.full = makeFullView(bootFullRefs[index]);
  });
  Object.entries(transferFullRefs).forEach(([mode, refs]) => {
    if (refs.length !== transferSteps[mode].length) {
      throw new Error(`完整代码步骤数不一致：${mode}`);
    }
    transferSteps[mode].forEach((step, index) => {
      step.full = makeFullView(refs[index]);
    });
  });
  wireCodeView("boot", renderBoot);
  wireCodeView("transfer", renderTransfer);

  let faultMode = "normal";
  let transferIndex = 0;
  let updateTransferStrip = () => {};

  function currentTransferSteps() {
    return transferSteps[faultMode];
  }

  function rebuildTransferStrip() {
    updateTransferStrip = makeStepStrip($("transfer-step-strip"), currentTransferSteps(), () => transferIndex, (index) => {
      transferIndex = index;
      renderTransfer();
    });
  }

  function renderMessage(id, status, pendingText) {
    const element = $(id);
    element.classList.remove("is-current", "is-done", "is-error");
    const label = element.querySelector("b");
    if (status === "done") {
      element.classList.add("is-done");
      label.textContent = "完成";
    } else if (status === "current") {
      element.classList.add("is-current");
      label.textContent = "处理中";
    } else if (status === "error") {
      element.classList.add("is-error");
      label.textContent = "失败";
    } else {
      label.textContent = pendingText;
    }
  }

  function renderTransfer() {
    const steps = currentTransferSteps();
    const step = steps[transferIndex];
    $("transfer-counter").textContent = `${pad(transferIndex + 1)} / ${pad(steps.length)}`;
    $("transfer-note").textContent = step.note;
    renderCodeView("transfer", step);

    $("state-lock").textContent = step.lock;
    $("state-busy").textContent = step.busy;
    $("state-machine").textContent = step.machine;
    $("state-processed").textContent = String(step.processed);
    $("state-error").textContent = step.error;
    $("state-error").classList.toggle("is-error", step.error !== "0");
    $("state-value").textContent = step.value;
    $("state-value").classList.toggle("is-good", step.value === "0x5a");

    renderMessage("message-zero", step.messages[0], "未提交");
    renderMessage("message-one", step.messages[1], step.messages[0] === "error" ? "未执行" : "未提交");

    const returnReadout = $("transfer-return");
    returnReadout.classList.remove("is-good", "is-error");
    if (step.returnValue[2]) returnReadout.classList.add(`is-${step.returnValue[2]}`);
    returnReadout.replaceChildren();
    const caption = document.createElement("small");
    caption.textContent = "RETURN PATH";
    const title = document.createElement("strong");
    title.textContent = step.returnValue[0];
    const detail = document.createElement("span");
    detail.textContent = step.returnValue[1];
    returnReadout.append(caption, title, detail);

    const lane = $("bus-lane");
    lane.replaceChildren();
    const events = steps[0].bus;
    events.forEach((event, index) => {
      const item = document.createElement("div");
      item.className = "bus-event";
      item.textContent = event;
      if (index <= step.busIndex) item.classList.add("is-visible");
      if (index === step.busIndex) item.classList.add("is-current");
      if ((faultMode === "nack" && event === "NACK") ||
          (faultMode === "timeout" && event === "强制 STOP" && index === step.busIndex)) {
        if (index <= step.busIndex) item.classList.add("is-error");
      }
      lane.appendChild(item);
    });

    const condition = $("bus-condition");
    condition.classList.toggle("status-good", faultMode === "normal");
    condition.classList.toggle("status-error", faultMode !== "normal");
    condition.textContent = faultMode === "normal" ? "ACK PATH" : faultMode === "nack" ? "NACK PATH" : "TIMEOUT PATH";

    $("transfer-prev").disabled = transferIndex === 0;
    $("transfer-next").disabled = transferIndex === steps.length - 1;
    updateTransferStrip();
  }

  wireStepper("transfer", () => currentTransferSteps().length, () => transferIndex, (index) => {
    transferIndex = index;
    renderTransfer();
  });
  listen("fault-mode", "change", (event) => {
    faultMode = event.target.value;
    transferIndex = 0;
    rebuildTransferStrip();
    renderTransfer();
  });
  rebuildTransferStrip();

  /* -----------------------------------------------------------------------
   * 03 / USERSPACE — interface provenance and per-open anonymous clients.
   * -------------------------------------------------------------------- */
  const interfaceStates = {
    adapter: {
      chain: "adapter nr=1 → i2cdev_attach_adapter() → cdev_device_add()",
      files: ["/dev/i2c-1：存在", "1-0050：未创建，因为还没有 DTS 子节点", "eeprom：不存在"]
    },
    bound: {
      chain: "client 1-0050 + at24 绑定 → NVMEM 注册外设专用属性",
      files: ["/dev/i2c-1：仍由 adapter 创建", "1-0050/eeprom：由 at24/NVMEM 创建", "两个文件不是同一创建链"]
    },
    unbound: {
      chain: "Core 创建 client 1-0050 → 没有外设驱动完成绑定",
      files: ["/dev/i2c-1：存在", "sysfs 中可有 1-0050 设备目录", "1-0050/eeprom：不存在"]
    }
  };

  $$("[data-interface]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.classList.contains("is-active")));
    button.addEventListener("click", () => {
      setPressed($$("[data-interface]"), button);
      const state = interfaceStates[button.dataset.interface];
      $("interface-chain").textContent = state.chain;
      const list = $("interface-files");
      list.replaceChildren();
      state.files.forEach((file) => {
        const item = document.createElement("li");
        item.textContent = file;
        list.appendChild(item);
      });
    });
  });
  document.querySelector("[data-interface='adapter']").click();

  const processSteps = [
    {
      a: { fd: "—", client: "—", buffer: "—", state: "尚未 open", className: "" },
      b: { fd: "—", client: "—", buffer: "—", state: "尚未 open", className: "" },
      lock: "unlocked",
      note: "两个进程尚未打开节点。adapter 和物理总线已经存在，但还没有属于任何打开实例的匿名 client。"
    },
    {
      a: { fd: "fd=3", client: "client A → adapter 1", buffer: "buffer A", state: "open 完成", className: "is-running" },
      b: { fd: "—", client: "—", buffer: "—", state: "尚未 open", className: "" },
      lock: "unlocked",
      note: "A 的 open 分配匿名 client A，保存到 file A 的 private_data。它没有注册成第二颗 1-0050 设备。"
    },
    {
      a: { fd: "fd=3", client: "client A → adapter 1", buffer: "buffer A", state: "等待事务", className: "" },
      b: { fd: "fd=4", client: "client B → adapter 1", buffer: "buffer B", state: "open 完成", className: "is-running" },
      lock: "unlocked",
      note: "B 再次 open，得到另一份 file、匿名 client 和用户缓冲区。二者指向同一 adapter，但打开实例互不共享。"
    },
    {
      a: { fd: "fd=3", client: "client A → adapter 1", buffer: "msgs A · value A", state: "I2C_RDWR 执行中", className: "is-running" },
      b: { fd: "fd=4", client: "client B → adapter 1", buffer: "buffer B", state: "尚未 ioctl", className: "" },
      lock: "locked by A",
      note: "A 的 ioctl 进入同一个 i2c_transfer()，Core 持有 adapter 总线锁。A 的两条消息在锁保护下组成一笔事务。"
    },
    {
      a: { fd: "fd=3", client: "client A → adapter 1", buffer: "msgs A · value A", state: "I2C_RDWR 执行中", className: "is-running" },
      b: { fd: "fd=4", client: "client B → adapter 1", buffer: "msgs B · value B", state: "等待 bus_lock", className: "is-waiting" },
      lock: "locked by A · B waiting",
      note: "B 现在发起事务，只能等待 A 解锁。B 的消息不会插入 A 的写偏移与读数据之间。"
    },
    {
      a: { fd: "fd=3", client: "client A → adapter 1", buffer: "value A = 0x5a", state: "ioctl 返回 2", className: "is-done" },
      b: { fd: "fd=4", client: "client B → adapter 1", buffer: "msgs B · value B", state: "可以争用锁", className: "is-waiting" },
      lock: "unlocked",
      note: "A 完成两条消息，解锁并返回 2；数据在 value A。返回值 2 与读取值 0x5a 仍是两个不同结果。"
    },
    {
      a: { fd: "fd=3", client: "client A → adapter 1", buffer: "value A = 0x5a", state: "已完成", className: "is-done" },
      b: { fd: "fd=4", client: "client B → adapter 1", buffer: "value B = 0x5a", state: "ioctl 返回 2", className: "is-done" },
      lock: "locked by B → unlocked",
      note: "B 获得锁并作为另一笔完整事务执行。Core 只串行化总线访问，不会让 B 复用 A 的消息、缓冲区或匿名 client。"
    },
    {
      a: { fd: "closed", client: "client A 已 kfree", buffer: "由进程 A 回收", state: "close 完成", className: "is-done" },
      b: { fd: "closed", client: "client B 已 kfree", buffer: "由进程 B 回收", state: "close 完成", className: "is-done" },
      lock: "unlocked",
      note: "close 释放各自匿名 client 和 adapter 引用，file->private_data 清空。持久 DTS client 与 adapter 并不随这两个 fd 一起销毁。"
    }
  ];
  let processIndex = 0;

  function renderProcessColumn(id, name, data) {
    const column = $(id);
    column.classList.remove("is-running", "is-waiting", "is-done");
    if (data.className) column.classList.add(data.className);
    column.replaceChildren();
    const title = document.createElement("div");
    title.className = "process-name";
    title.textContent = name;
    column.appendChild(title);
    [data.fd, data.client, data.buffer].forEach((value, index) => {
      const code = document.createElement("code");
      const labels = ["fd：", "client：", "buffer："];
      code.textContent = `${labels[index]}${value}`;
      column.appendChild(code);
    });
    const state = document.createElement("b");
    state.textContent = data.state;
    column.appendChild(state);
  }

  function renderProcess() {
    const step = processSteps[processIndex];
    renderProcessColumn("process-a", "PROCESS A", step.a);
    renderProcessColumn("process-b", "PROCESS B", step.b);
    $("adapter-lock").classList.toggle("is-locked", step.lock !== "unlocked");
    $("adapter-lock").querySelector("code").textContent = `bus_lock = ${step.lock}`;
    $("process-note").textContent = step.note;
    $("process-counter").textContent = `${pad(processIndex)} / ${pad(processSteps.length - 1)}`;
    $("process-prev").disabled = processIndex === 0;
    $("process-next").disabled = processIndex === processSteps.length - 1;
  }

  wireStepper("process", () => processSteps.length, () => processIndex, (index) => {
    processIndex = index;
    renderProcess();
  });

  /* -----------------------------------------------------------------------
   * 04 / GPIO — replace algorithm, then inspect clock stretching.
   * -------------------------------------------------------------------- */
  let gpioMode = "rk3x";
  let gpioIndex = 0;
  let gpioTimedOut = false;

  const implementationStates = {
    rk3x: [
      { caption: "UNCHANGED", title: "外设与 Core", lines: ["demo_read_reg(client)", "msgs[2] · i2c_transfer()", "adapter bus_lock"] },
      { caption: "SELECTED ALGORITHM", title: "RK3568 寄存器控制器", lines: ["adap->algo = rk3x_i2c_algorithm", "master_xfer = rk3x_i2c_xfer", "TXFIFO / RXFIFO / IRQ"] }
    ],
    gpio: [
      { caption: "UNCHANGED", title: "外设与 Core", lines: ["demo_read_reg(client)", "msgs[2] · i2c_transfer()", "adapter bus_lock"] },
      { caption: "SELECTED ALGORITHM", title: "i2c-algo-bit + GPIO", lines: ["adap->algo = &i2c_bit_algo", "adap->algo_data = bit_data", "setsda / setscl / getsda / getscl"] }
    ]
  };

  function renderImplementation() {
    const panel = $("implementation-panel");
    panel.replaceChildren();
    implementationStates[gpioMode].forEach((half, index) => {
      const section = document.createElement("section");
      section.className = "implementation-half";
      if (index === 1) section.classList.add("is-current");
      const caption = document.createElement("small");
      caption.textContent = half.caption;
      const title = document.createElement("h3");
      title.textContent = half.title;
      section.append(caption, title);
      half.lines.forEach((line) => {
        const code = document.createElement("code");
        code.textContent = line;
        section.appendChild(code);
      });
      panel.appendChild(section);
    });
  }

  $$("[data-gpio-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.classList.contains("is-active")));
    button.addEventListener("click", () => {
      gpioMode = button.dataset.gpioMode;
      setPressed($$("[data-gpio-mode]"), button);
      gpioIndex = 0;
      gpioTimedOut = false;
      renderImplementation();
      renderGpio();
    });
  });

  listen("gpio-start", "click", () => {
    const gpioButton = $$("[data-gpio-mode]").find(button => button.dataset.gpioMode === "gpio");
    if (gpioButton) gpioButton.click();
  });

  function gpioSteps() {
    if (!$("stretch-enabled").checked) {
      return [
        { action: "等待 setscl(1)", readback: "getscl() = 0", wait: "尚未开始等待", level: "LOW", high: false, result: "等待执行", detail: "sclhi() 尚未返回", note: "开漏输出 1 表示释放 SCL。关闭“外设拉住”后，释放线路即可读回高电平。" },
        { action: "setscl(1)：主机释放", readback: "getscl() = 1", wait: "第一次读回已为高", level: "HIGH", high: true, result: "while 循环不执行", detail: "不需要等待时钟延展", note: "主机放手与外设不再拉低同时成立，线路上才出现真实高电平。getscl 读到 1，不进入等待循环。" },
        { action: "udelay(adap->udelay)", readback: "getscl() = 1", wait: "半周期延时", level: "HIGH", high: true, result: "sclhi() 返回 0", detail: "继续下一位，没有超时", note: "成功返回 0 只表示本次释放并确认高电平完成，不代表整笔 I2C 事务已经结束。" }
      ];
    }
    return [
      { action: "等待 setscl(1)", readback: "getscl() = 0", wait: "尚未开始等待", level: "LOW", high: false, result: "等待执行", detail: "sclhi() 尚未返回", note: "外设暂时拉住 SCL。主机接下来只能释放自己的开漏输出，不能把外设强行抬成高电平。" },
      { action: "setscl(1)：主机释放", readback: "getscl() = 0", wait: "外设仍拉低，进入等待", level: "LOW（外设保持）", high: false, result: "while (!getscl())", detail: "尚未超过 adap->timeout", note: "主机已经写 1，但读回仍为 0。这正说明 setscl(1) 是释放，不是测得高电平。" },
      { action: "cpu_relax()，再次读回", readback: "getscl() = 0", wait: "start + timeout 尚未到期", level: "LOW（继续等待）", high: false, result: "仍在 while 循环", detail: "不继续发送下一位", note: "时钟延展期间算法暂停推进。若超过期限仍为低，sclhi() 会返回 -ETIMEDOUT；也可以点击“推进到超时”查看。" },
      { action: "外设释放，主机仍释放", readback: "getscl() = 1", wait: "退出 while，执行 udelay", level: "HIGH", high: true, result: "sclhi() 返回 0", detail: "时钟延展完成", note: "双方都放手后读回高电平，算法才继续。返回 0 表示本段 SCL 操作成功，并非读取数据为 0。" },
      { action: "继续位模拟", readback: "getscl() = 1", wait: "下一位按同一规则处理", level: "HIGH", high: true, result: "sclhi() 返回 0", detail: "整笔消息仍由 i2c-algo-bit 推进", note: "每一位都可能重复同样的释放与读回过程。i2c-gpio 改变了电气实现，不改变外设层的 msgs[2]。" }
    ];
  }

  function renderGpio() {
    const steps = gpioSteps();
    const isGpio = gpioMode === "gpio";
    $("gpio-mode-banner").hidden = isGpio;
    ["gpio-prev", "gpio-next", "gpio-reset", "gpio-timeout", "stretch-enabled"].forEach((id) => {
      $(id).disabled = !isGpio;
    });

    let step;
    if (!isGpio) {
      step = { action: "切换到 GPIO 模拟后运行", readback: "getscl() = —", wait: "当前为 RK3568 寄存器控制器", level: "—", high: false, result: "位模拟实验未启用", detail: "上方切换不会改变外设读取函数", note: "RK3568 路径由硬件状态机处理 SCL。下方单步专门解释 i2c-algo-bit 的 sclhi()，切换到 GPIO 模拟后可操作。" };
    } else if (gpioTimedOut) {
      step = { action: "time_after(start + timeout)", readback: "再次 getscl() = 0", wait: "期限已到，外设仍拉低", level: "LOW（超时）", high: false, result: "sclhi() 返回 -ETIMEDOUT", detail: "负错误沿位模拟传输路径上报", note: "v6.6 超时分支会先再读一次 getscl；仍为 0 才返回 -ETIMEDOUT。它不是把线路直接当作高电平继续。" };
    } else {
      step = steps[gpioIndex];
    }

    $("gpio-counter").textContent = !isGpio ? "GPIO ONLY" : gpioTimedOut ? "TIMEOUT" : `${pad(gpioIndex)} / ${pad(steps.length - 1)}`;
    $("gpio-action").textContent = step.action;
    $("gpio-readback").textContent = step.readback;
    $("gpio-wait-state").textContent = step.wait;
    $("wire-level").textContent = step.level;
    $("wire-visual").classList.toggle("is-high", step.high);
    $("gpio-note").textContent = step.note;

    const result = $("gpio-return");
    result.classList.toggle("is-error", gpioTimedOut && isGpio);
    result.classList.toggle("is-good", isGpio && !gpioTimedOut && step.result.includes("返回 0"));
    result.querySelector("strong").textContent = step.result;
    result.querySelector("span").textContent = step.detail;

    $("gpio-prev").disabled = !isGpio || (!gpioTimedOut && gpioIndex === 0);
    $("gpio-next").disabled = !isGpio || gpioTimedOut || gpioIndex === steps.length - 1;
    $("gpio-timeout").disabled = !isGpio || gpioTimedOut || !$("stretch-enabled").checked || gpioIndex === 0;
  }

  listen("stretch-enabled", "change", () => {
    gpioIndex = 0;
    gpioTimedOut = false;
    renderGpio();
  });
  listen("gpio-prev", "click", () => {
    if (gpioTimedOut) {
      gpioTimedOut = false;
      gpioIndex = Math.min(2, gpioSteps().length - 1);
    } else {
      gpioIndex = Math.max(0, gpioIndex - 1);
    }
    renderGpio();
  });
  listen("gpio-next", "click", () => {
    gpioIndex = Math.min(gpioSteps().length - 1, gpioIndex + 1);
    gpioTimedOut = false;
    renderGpio();
  });
  listen("gpio-reset", "click", () => {
    gpioIndex = 0;
    gpioTimedOut = false;
    renderGpio();
  });
  listen("gpio-timeout", "click", () => {
    gpioTimedOut = true;
    renderGpio();
  });
  renderImplementation();

  /* -----------------------------------------------------------------------
   * 05 / SOURCE — the same files included by the MkDocs article.
   * -------------------------------------------------------------------- */
  const sourceFiles = [
    { name: "demo_i2c.c", context: "原创教学内核模块。加载后由匹配表进入 demo_probe(client)，再执行两消息复合读取。尚未交叉编译或上板。" },
    { name: "Makefile", context: "Kbuild 的 obj-m 规则与普通用户程序目标放在同一文件；模块构建使用 make -C KDIR M=$PWD modules。" },
    { name: "rk3568-at24-demo.dts", context: "完整板级教学 DTS：启用 I2C1、400 kHz，并描述专用 demo 外设节点。不是商品板完整配置，尚未构建 DTB。" },
    { name: "i2c-read.c", context: "用户态同源读取：open /dev/i2c-N 后经 I2C_RDWR 提交两条消息；v6.6 完整成功返回 2。尚未运行。" },
    { name: "i2c-gpio-demo.dts", context: "GPIO 位模拟替换示例。GPIO4_A0/A1 仅演示语法，必须按实际原理图替换，未验证引脚可用性。" }
  ];
  const sourceCache = new Map();
  let selectedSource = sourceFiles[0].name;
  let sourceRequest = 0;

  function sourceUrl(name) {
    return `../code/B-B.3.3/${name}`;
  }

  function renderSourceButtons() {
    const nav = $("source-files");
    nav.replaceChildren();
    sourceFiles.forEach((file) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "source-file-button";
      button.classList.toggle("is-active", file.name === selectedSource);
      button.setAttribute("aria-pressed", String(file.name === selectedSource));
      const name = document.createElement("code");
      name.textContent = file.name;
      const detail = document.createElement("small");
      detail.textContent = file.name.endsWith(".dts") ? "板级描述" : file.name === "Makefile" ? "构建入口" : file.name === "i2c-read.c" ? "用户态入口" : "内核外设驱动";
      button.append(name, detail);
      button.addEventListener("click", () => loadSource(file.name));
      nav.appendChild(button);
    });
  }

  async function loadSource(name) {
    selectedSource = name;
    const file = sourceFiles.find((candidate) => candidate.name === name);
    const request = ++sourceRequest;
    renderSourceButtons();
    $("source-path").textContent = `code/B-B.3.3/${name}`;
    $("source-context").textContent = file.context;
    $("source-download").href = sourceUrl(name);
    $("source-download").setAttribute("download", name);
    $("copy-source").disabled = true;

    if (sourceCache.has(name)) {
      renderCode($("source-code"), sourceCache.get(name));
      $("source-status").textContent = "已加载与正文 snippets 相同的源文件 · 教学示例，未编译或运行";
      $("copy-source").disabled = false;
      return;
    }

    $("source-code").textContent = "正在加载…";
    $("source-status").textContent = `请求 ${sourceUrl(name)}`;
    try {
      const response = await fetch(sourceUrl(name));
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const content = await response.text();
      sourceCache.set(name, content);
      if (request !== sourceRequest) return;
      renderCode($("source-code"), content);
      $("source-status").textContent = "加载成功 · 与正文 snippets 使用同一文件 · 教学示例，未编译或运行";
      $("copy-source").disabled = false;
    } catch (error) {
      if (request !== sourceRequest) return;
      $("source-code").textContent = `无法加载 ${name}\n${error.message}\n\n请通过 HTTP 打开本页面，或点击上方“下载文件”直接访问源文件。`;
      $("source-status").textContent = "源码加载失败：file:// 环境通常会阻止 fetch；MkDocs/GitHub Pages 的 HTTP 环境不受此限制。";
    }
  }

  listen("copy-source", "click", async () => {
    const content = sourceCache.get(selectedSource);
    if (!content) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(content);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = content;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        if (!copied) throw new Error("浏览器拒绝复制");
      }
      $("source-status").textContent = `已复制 ${selectedSource} · 内容未编译或运行`;
    } catch (error) {
      $("source-status").textContent = `复制失败：${error.message}。可在代码区全选，或使用下载文件。`;
    }
  });

  /* -----------------------------------------------------------------------
   * Navigation and keyboard controls.
   * -------------------------------------------------------------------- */
  const views = ["boot", "transfer", "userspace", "gpio", "source"];
  let activeView = "boot";

  function switchView(view, updateHash = true) {
    if (!views.includes(view)) view = "boot";
    activeView = view;
    views.forEach((name) => {
      $(`view-${name}`).classList.toggle("is-active", name === view);
    });
    $$(".rail-item").forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (updateHash && window.location.hash !== `#${view}`) {
      history.replaceState(null, "", `#${view}`);
    }
    if (view === "source" && !sourceCache.has(selectedSource)) loadSource(selectedSource);
    document.title = `I2C Framework Lab · ${view}`;
  }

  $$(".rail-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  window.addEventListener("hashchange", () => switchView(window.location.hash.slice(1), false));

  document.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLElement &&
        (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable)) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const direction = event.key === "ArrowRight" ? 1 : -1;
    let handled = true;

    if (activeView === "boot") {
      bootIndex = Math.max(0, Math.min(bootSteps.length - 1, bootIndex + direction));
      renderBoot();
    } else if (activeView === "transfer") {
      transferIndex = Math.max(0, Math.min(currentTransferSteps().length - 1, transferIndex + direction));
      renderTransfer();
    } else if (activeView === "userspace") {
      processIndex = Math.max(0, Math.min(processSteps.length - 1, processIndex + direction));
      renderProcess();
    } else if (activeView === "gpio" && gpioMode === "gpio") {
      if (gpioTimedOut && direction < 0) {
        gpioTimedOut = false;
        gpioIndex = Math.min(2, gpioSteps().length - 1);
      } else if (!gpioTimedOut) {
        gpioIndex = Math.max(0, Math.min(gpioSteps().length - 1, gpioIndex + direction));
      }
      renderGpio();
    } else {
      handled = false;
    }
    if (handled) event.preventDefault();
  });

  renderBoot();
  renderTransfer();
  renderProcess();
  renderGpio();
  renderSourceButtons();
  switchView(views.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "boot", false);
})();
