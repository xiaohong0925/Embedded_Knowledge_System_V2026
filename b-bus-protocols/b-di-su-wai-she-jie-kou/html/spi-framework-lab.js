(() => {
  "use strict";

  /* 所有状态都是依据 v6.6 源码构造的逻辑模型，不连接真实硬件。 */
  window.LAB_FULL_CODE = window.SPI_FULL_CODE;

  const DTS = `&spi1 {
	status = "okay";

	spi_frame_observer: spi-frame-observer@0 {
		compatible = "kimi,spi-frame-observer";
		reg = <0>;
		spi-max-frequency = <1000000>;
	};
};`;
  const ROCKCHIP_CALLBACKS = `	ctlr->setup = rockchip_spi_setup;
	ctlr->set_cs = rockchip_spi_set_cs;
	ctlr->transfer_one = rockchip_spi_transfer_one;
	ctlr->max_transfer_size = rockchip_spi_max_transfer_size;
	ctlr->handle_err = rockchip_spi_handle_err;`;
  const ROCKCHIP_REGISTER = `	ret = devm_spi_register_controller(&pdev->dev, ctlr);
	if (ret < 0) {
		dev_err(&pdev->dev, "Failed to register controller\\n");
		goto err_free_dma_rx;
	}`;
  const CORE_CHILDREN = `	for_each_available_child_of_node(ctlr->dev.of_node, nc) {
		if (of_node_test_and_set_flag(nc, OF_POPULATED))
			continue;
		spi = of_register_spi_device(ctlr, nc);`;
  const CORE_PARSE = `	/* Device address */
	rc = of_property_read_u32(nc, "reg", &value);
	if (rc) {
		dev_err(&ctlr->dev, "%pOF has no valid 'reg' property (%d)\\n",
			nc, rc);
		return rc;
	}
	spi_set_chipselect(spi, 0, value);

	/* Device speed */
	if (!of_property_read_u32(nc, "spi-max-frequency", &value))
		spi->max_speed_hz = value;`;
  const CORE_ALLOC = `	/* Alloc an spi_device */
	spi = spi_alloc_device(ctlr);
	if (!spi) {
		dev_err(&ctlr->dev, "spi_device alloc error for %pOF\\n", nc);
		rc = -ENOMEM;
		goto err_out;
	}`;
  const CORE_ADD = `	/* Register the new device */
	rc = spi_add_device(spi);
	if (rc) {
		dev_err(&ctlr->dev, "spi_device register error %pOF\\n", nc);
		goto err_of_node_put;
	}

	return spi;`;
  const CORE_MATCH = `	/* Attempt an OF style match */
	if (of_driver_match_device(dev, drv))
		return 1;`;
  const CORE_PROBE = `	if (sdrv->probe) {
		ret = sdrv->probe(spi);
		if (ret)
			dev_pm_domain_detach(dev, true);
	}

	return ret;`;
  const OBSERVER_PROBE = `	ret = spi_frame_observer_read(spi, 0x001234, data);
	if (ret < 0) {
		dev_err(&spi->dev, "fast_read failed: ret=%d\\n", ret);
		return ret;
	}`;
  const OBSERVER_BUFFERS = `	tx_buf = kzalloc(OBSERVER_CMD_LEN, GFP_KERNEL);
	rx_buf = kzalloc(OBSERVER_DATA_LEN, GFP_KERNEL);
	if (!tx_buf || !rx_buf) {
		ret = -ENOMEM;
		goto out_free;
	}`;
  const OBSERVER_FRAME = `	tx_buf[0] = 0x0b;
	tx_buf[1] = (address >> 16) & 0xff;
	tx_buf[2] = (address >> 8) & 0xff;
	tx_buf[3] = address & 0xff;
	tx_buf[4] = 0x00;

	/* Segment 0 sends the command and ignores simultaneous MISO data. */
	transfers[0].tx_buf = tx_buf;
	transfers[0].len = OBSERVER_CMD_LEN;

	/* Segment 1 shifts out zeroes and captures four simultaneous MISO bytes. */
	transfers[1].rx_buf = rx_buf;
	transfers[1].len = OBSERVER_DATA_LEN;`;
  const OBSERVER_MESSAGE = `	spi_message_init(&message);
	spi_message_add_tail(&transfers[0], &message);
	spi_message_add_tail(&transfers[1], &message);

	/* Stack-held message/transfer descriptors live until spi_sync returns. */
	ret = spi_sync(spi, &message);`;
  const SYNC_LOCK = `	mutex_lock(&spi->controller->bus_lock_mutex);
	ret = __spi_sync(spi, message);
	mutex_unlock(&spi->controller->bus_lock_mutex);

	return ret;`;
  const SYNC_VALIDATE = `	status = __spi_validate(spi, message);
	if (status != 0)
		return status;

	message->spi = spi;`;
  const SYNC_NOQUEUE = `	if (READ_ONCE(ctlr->queue_empty) && !ctlr->must_async) {
		message->actual_length = 0;
		message->status = -EINPROGRESS;

		trace_spi_message_submit(message);

		SPI_STATISTICS_INCREMENT_FIELD(ctlr->pcpu_statistics, spi_sync_immediate);
		SPI_STATISTICS_INCREMENT_FIELD(spi->pcpu_statistics, spi_sync_immediate);

		__spi_transfer_message_noqueue(ctlr, message);

		return message->status;
	}`;
  const CORE_SELECT = `	xfer = list_first_entry(&msg->transfers, struct spi_transfer, transfer_list);
	spi_set_cs(msg->spi, !xfer->cs_off, false);`;
  const CORE_CALL = `			spi_dma_sync_for_device(ctlr, xfer);
			ret = ctlr->transfer_one(ctlr, msg->spi, xfer);
			if (ret < 0) {`;
  const ROCKCHIP_TRANSFER = `	rs->n_bytes = xfer->bits_per_word <= 8 ? 1 : 2;
	rs->xfer = xfer;
	use_dma = ctlr->can_dma ? ctlr->can_dma(ctlr, spi, xfer) : false;

	ret = rockchip_spi_config(rs, spi, xfer, use_dma, ctlr->target);
	if (ret)
		return ret;

	if (use_dma)
		return rockchip_spi_prepare_dma(rs, ctlr, xfer);

	return rockchip_spi_prepare_irq(rs, ctlr, xfer);`;
  const ROCKCHIP_DMA = `	unsigned int bytes_per_word = xfer->bits_per_word <= 8 ? 1 : 2;

	/* if the numbor of spi words to transfer is less than the fifo
	 * length we can just fill the fifo and wait for a single irq,
	 * so don't bother setting up dma
	 */
	return xfer->len / bytes_per_word >= rs->fifo_len;
}`;
  const CORE_ERROR = `			if (ret < 0) {
				spi_dma_sync_for_cpu(ctlr, xfer);

				if (ctlr->cur_msg_mapped &&
				   (xfer->error & SPI_TRANS_FAIL_NO_START)) {
					__spi_unmap_msg(ctlr, msg);
					ctlr->fallback = true;
					xfer->error &= ~SPI_TRANS_FAIL_NO_START;
					goto fallback_pio;
				}

				SPI_STATISTICS_INCREMENT_FIELD(statm,
							       errors);
				SPI_STATISTICS_INCREMENT_FIELD(stats,
							       errors);
				dev_err(&msg->spi->dev,
					"SPI transfer failed: %d\\n", ret);
				goto out;
			}`;
  const CORE_LENGTH = `		msg->actual_length += xfer->len;
	}

out:`;
  const CORE_OUT = `out:
	if (ret != 0 || !keep_cs)
		spi_set_cs(msg->spi, false, false);

	if (msg->status == -EINPROGRESS)
		msg->status = ret;

	if (msg->status && ctlr->handle_err)
		ctlr->handle_err(ctlr, msg);

	spi_finalize_current_message(ctlr);`;
  const CORE_FINALIZE = `	spi_unmap_msg(ctlr, mesg);`;
  const CORE_COMPLETE = `	mesg->state = NULL;
	if (mesg->complete)
		mesg->complete(mesg->context);`;
  const OBSERVER_CHECK = `	ret = spi_sync(spi, &message);
	if (ret < 0)
		goto out_free;

	if (message.actual_length != OBSERVER_CMD_LEN + OBSERVER_DATA_LEN) {
		ret = -EIO;
		goto out_free;
	}

	memcpy(data, rx_buf, OBSERVER_DATA_LEN);`;
  const OBSERVER_FREE = `out_free:
	kfree(rx_buf);
	kfree(tx_buf);
	return ret;`;
  const OBSERVER_SUCCESS = `	dev_info(&spi->dev,
		 "fast_read: ret=0, addr=0x001234, data=%02x %02x %02x %02x\\n",
		 data[0], data[1], data[2], data[3]);

	return 0;`;

  const S = (label, path, code, startLine, line, key, needle, states, observations, note) => ({
    label, path, code, startLine, line,
    full: key ? { key, needle } : null,
    states, observations, note
  });
  const initialStates = {
    "spi_controller": "尚未注册", "spi_device": "尚未创建", "CS": "未选中（逻辑高）", "return": "尚未调用"
  };
  const readyStates = {
    "spi_device": "spi1.0 · CS0 · 1 MHz", "mode/bits": "0 / 8", "driver": "已匹配教学 spi_driver", "return": "进入 probe"
  };
  const messageStates = {
    "transfer[0]": "TX 0B 00 12 34 00 · len=5", "transfer[1]": "RX · len=4", "message.actual_length": "0", "return": "等待 spi_sync"
  };

  const buildSteps = [
    S("板级 DTS", "code/B-B.4.3/spi-frame-observer.dts · 原创板级片段", DTS, 7, 11, null, null, initialStates,
      ["compatible 是 kimi,spi-frame-observer", "reg=0 选择 CS0，频率上限 1 MHz"],
      "先固定接线描述。此片段不是独立 DTS 或 overlay，也未编译为 DTB；正式 jedec,spi-nor 节点不得同时占用 CS0。"),
    S("设置控制器回调", "drivers/spi/spi-rockchip.c · rockchip_spi_probe()", ROCKCHIP_CALLBACKS, 877, 879, "rockchipSpiProbe", "ctlr->transfer_one = rockchip_spi_transfer_one;",
      { "spi_controller": "保存 setup/set_cs/transfer_one", "transfer_one": "rockchip_spi_transfer_one", "spi_device": "尚未创建", "return": "probe 继续" },
      ["Core 以后按 transfer 调用硬件适配函数", "Rockchip 没有替换默认 transfer_one_message"],
      "控制器对象先保存硬件能力。外设协议驱动只提交 message，不直接接触这些寄存器回调。"),
    S("注册 SPI1 控制器", "drivers/spi/spi-rockchip.c · rockchip_spi_probe()", ROCKCHIP_REGISTER, 924, 924, "rockchipSpiProbe", "ret = devm_spi_register_controller(&pdev->dev, ctlr);",
      { "spi_controller": "RK3568 SPI1 · 注册路径", "CS": "尚未选中", "spi_device": "等待 Core 遍历子节点", "return": "注册成功才继续" },
      ["控制器注册触发可用子节点注册", "此时尚未执行 Fast Read"],
      "devm 资源由设备模型管理。这里只建立控制器，不表示 Flash 已由教学驱动接管。"),
    S("遍历可用子节点", "drivers/spi/spi.c · of_register_spi_devices()", CORE_CHILDREN, 2382, 2385, "ofRegisterSpiDevices", "spi = of_register_spi_device(ctlr, nc);",
      { "spi_controller": "RK3568 SPI1", "device_node": "spi-frame-observer@0", "spi_device": "准备创建", "return": "尚未进入协议 probe" },
      ["当前节点可用且尚未 populated", "每个子节点独立走创建路径"],
      "Core 从控制器节点找到教学子节点。probe 尚未发生，spi_device 也不是协议驱动自己创建的。"),
    S("分配 spi_device", "drivers/spi/spi.c · of_register_spi_device()", CORE_ALLOC, 2329, 2330, "ofRegisterSpiDevice", "spi = spi_alloc_device(ctlr);",
      { "spi_device": "已分配 · 关联 SPI1", "device_node": "spi-frame-observer@0", "CS": "尚未选中", "return": "继续解析" },
      ["对象由 Core 分配", "分配失败会走 err_out 并释放引用"],
      "先建立设备对象，再把板级属性写进去。完整来源使用连续原文区间，因此也保留了返回类型跨行的函数签名。"),
    S("解析 CS 与速度", "drivers/spi/spi.c · of_spi_parse_dt()", CORE_PARSE, 2302, 2309, "ofSpiParseDt", "spi_set_chipselect(spi, 0, value);",
      { "spi_device": "spi1.0", "chip_select": "0", "max_speed_hz": "1000000", "mode": "0 · 默认 Mode 0" },
      ["reg=0 写入片选字段", "spi-max-frequency 写入 1 MHz 上限"],
      "未写 spi-cpol、spi-cpha、spi-lsb-first、spi-cs-high，所以本例保持 Mode 0、MSB-first、低有效 CS。"),
    S("注册设备对象", "drivers/spi/spi.c · of_register_spi_device()", CORE_ADD, 2354, 2355, "ofRegisterSpiDevice", "rc = spi_add_device(spi);",
      readyStates,
      ["spi1.0 进入 SPI 总线设备模型", "设备创建与驱动匹配仍是两个阶段"],
      "spi_add_device 注册设备并应用初始设置。默认 8 位字长与控制器能力检查由设备使用路径处理。"),
    S("compatible 匹配", "drivers/spi/spi.c · spi_match_device()", CORE_MATCH, 385, 386, "spiMatchDevice", "if (of_driver_match_device(dev, drv))",
      readyStates,
      ["设备 compatible 与 of_match_table 一致", "返回值 1 表示设备树匹配成功"],
      "匹配连接的是已经存在的 spi_device 与教学 spi_driver；它没有创建第二颗设备。"),
    S("Core 调用 probe", "drivers/spi/spi.c · spi_probe()", CORE_PROBE, 433, 434, "spiProbe", "ret = sdrv->probe(spi);",
      readyStates,
      ["probe 参数是 spi1.0", "probe 的负返回值会使绑定失败"],
      "从这里进入原创教学模块。后续所有代码都围绕地址 0x001234 的同一笔 Fast Read。"),
    S("probe 发起读取", "code/B-B.4.3/spi_frame_observer.c · spi_frame_observer_probe()", OBSERVER_PROBE, 85, 85, "observerProbe", "ret = spi_frame_observer_read(spi, 0x001234, data);",
      { "spi": "spi1.0", "address": "0x001234", "data": "00 00 00 00 · 尚未接收", "return": "进入 read" },
      ["调用者提供 4 字节输出数组", "读取函数同步返回前不会打印成功数据"],
      "教学 probe 在可睡眠上下文调用一次只读操作。A7 5C 3F 19 只是后续用于解释的教学假设。"),
    S("分配并清零缓冲区", "code/B-B.4.3/spi_frame_observer.c · spi_frame_observer_read()", OBSERVER_BUFFERS, 31, 32, "observerRead", "rx_buf = kzalloc(OBSERVER_DATA_LEN, GFP_KERNEL);",
      { "tx_buf": "5 字节 · 已清零", "rx_buf": "4 字节 · 已清零", "message/transfers": "栈上描述符", "return": "继续组帧" },
      ["任一分配失败都会进入共用释放出口", "kfree(NULL) 允许，因此不会漏释放另一个缓冲区"],
      "堆缓冲区供 Core 按控制器需要映射；栈上的 message 和 transfer 是描述符，依靠同步调用保证生命期。"),
    S("组出 5＋4 双段", "code/B-B.4.3/spi_frame_observer.c · spi_frame_observer_read()", OBSERVER_FRAME, 39, 46, "observerRead", "transfers[0].tx_buf = tx_buf;",
      { "TX": "0B 00 12 34 00", "transfer[0].len": "5", "transfer[1].len": "4", "RX": "等待硬件移入" },
      ["第一段丢弃同时移入的数据", "第二段移出零并保存 4 个 MISO 字节"],
      "第二段没有 tx_buf 并不等于停止 SCLK。SPI 仍全双工交换，教学模型用零填充第二段 MOSI。"),
    S("初始化并提交 message", "code/B-B.4.3/spi_frame_observer.c · spi_frame_observer_read()", OBSERVER_MESSAGE, 53, 58, "observerRead", "ret = spi_sync(spi, &message);",
      messageStates,
      ["两个 transfer 按追加顺序排列", "actual_length 从 0 开始，最终目标是 9"],
      "spi_sync 返回前，栈上描述符和两个堆缓冲区都保持有效。现在离开协议驱动，进入 SPI Core。"),
    S("锁定并进入同步路径", "drivers/spi/spi.c · spi_sync()", SYNC_LOCK, 4268, 4269, "spiSync", "ret = __spi_sync(spi, message);",
      messageStates,
      ["bus_lock_mutex 覆盖本次同步调用", "返回值由 __spi_sync 决定，不是字节数"],
      "同步接口可睡眠且没有等待超时。它保证的是调用返回时事务已有最终状态，不保证只走某一种队列。"),
    S("校验并选择执行路径", "drivers/spi/spi.c · __spi_sync()", SYNC_VALIDATE, 4196, 4196, "spiSyncInternal", "status = __spi_validate(spi, message);",
      messageStates,
      ["先校验设备和 transfer，再提交硬件", "校验失败会直接返回负错误码"],
      "本模型假设校验通过。下一片段展示 noqueue 快路径；实际是否进入它还取决于 queue_empty 和 must_async。"),
    S("初始化完成状态", "drivers/spi/spi.c · __spi_sync()", SYNC_NOQUEUE, 4211, 4212, "spiSyncInternal", "message->actual_length = 0;",
      { "message.actual_length": "0", "message.status": "-EINPROGRESS", "执行路径": "noqueue（本模型条件）", "return": "尚未返回" },
      ["初始状态不是成功，也不是 9 字节", "queue_empty=true 且 must_async=false 时才走此分支"],
      "queue_empty 表示控制器队列为空，must_async 表示控制器要求强制异步；本模型为跟随 noqueue 快路径假设两者满足分支条件，不是实测状态。-EINPROGRESS 是事务尚未完成的中间状态。排队路径最终同样等待并返回 message.status。")
  ];

  const transferSteps = [
    S("默认路径选中 CS", "drivers/spi/spi.c · spi_transfer_one_message()", CORE_SELECT, 1490, 1491, "spiTransferOneMessage", "spi_set_cs(msg->spi, !xfer->cs_off, false);",
      { "CS": "有效（逻辑低）", "当前 transfer": "第 0 段 · len=5", "actual_length": "0", "message.status": "-EINPROGRESS" },
      ["先取得第一段，再选中设备", "两段 cs_change 都是默认 0"],
      "从这里开始，观察栏中的 CS 和字节事件都是源码语义的逻辑模型，不是逻辑分析仪波形。"),
    S("首段交给 Rockchip", "drivers/spi/spi.c · spi_transfer_one_message()", CORE_CALL, 1511, 1512, "spiTransferOneMessage", "ret = ctlr->transfer_one(ctlr, msg->spi, xfer);",
      { "CS": "有效", "当前 transfer": "TX 0B 00 12 34 00", "actual_length": "0", "transfer_one": "rockchip_spi_transfer_one" },
      ["Core 仍负责 message 遍历", "控制器驱动只收到当前 transfer"],
      "这一交接解释两层职责：Core 决定段序和错误出口，Rockchip 决定怎样让硬件完成当前段。"),
    S("配置当前 transfer", "drivers/spi/spi-rockchip.c · rockchip_spi_transfer_one()", ROCKCHIP_TRANSFER, 696, 700, "rockchipSpiTransferOne", "ret = rockchip_spi_config(rs, spi, xfer, use_dma, ctlr->target);",
      { "rs->xfer": "当前 5 字节 transfer", "bytes_per_word": "1", "use_dma": "由 can_dma 与通道决定", "CS": "有效" },
      ["保存当前 transfer 并配置硬件", "不能预设 5 字节一定采用 PIO 或 DMA"],
      "can_dma 只有在控制器具有可用 DMA 通道时才被设置；函数返回后还要按 use_dma 选择准备路径。"),
    S("核对 DMA 条件", "drivers/spi/spi-rockchip.c · rockchip_spi_can_dma()", ROCKCHIP_DMA, 715, 721, "rockchipSpiCanDma", "return xfer->len / bytes_per_word >= rs->fifo_len;",
      { "判断式": "len / bytes_per_word >= fifo_len", "本段字数": "5", "fifo_len": "由实际控制器读取", "DMA 通道": "必须可用" },
      ["不存在通用的固定字节阈值", "本模型不伪造 fifo_len 或最终 DMA 选择"],
      "这里展示真实条件，而不是给出未经上板的结论。正文对 4 字节第二段使用同一判断原则。"),
    S("首段完成计数", "drivers/spi/spi.c · spi_transfer_one_message()", CORE_LENGTH, 1575, 1575, "spiTransferOneMessage", "msg->actual_length += xfer->len;",
      { "CS": "保持有效", "已完成": "第 0 段 · 5 字节", "actual_length": "0 → 5", "下一段": "RX · len=4" },
      ["首段完成后才累加 5", "默认 cs_change=0，所以段间不撤销 CS"],
      "逻辑总线事件：已移出 0B 00 12 34 00，同时移入值被丢弃；随后进入第二段。此处不是实测数据。"),
    S("第二段交给硬件", "drivers/spi/spi.c · spi_transfer_one_message()", CORE_CALL, 1511, 1512, "spiTransferOneMessage", "ret = ctlr->transfer_one(ctlr, msg->spi, xfer);",
      { "CS": "保持有效", "当前 transfer": "RX · len=4", "MOSI": "00 00 00 00（逻辑模型）", "actual_length": "5" },
      ["同一 message 内继续选中 Flash", "硬件提供 32 个额外时钟并填充 rx_buf"],
      "第二段没有独立器件命令；它延续同一 Fast Read。假设 Flash 内容为 A7 5C 3F 19，仅用于解释后续复制与日志。"),
    S("第二段完成计数", "drivers/spi/spi.c · spi_transfer_one_message()", CORE_LENGTH, 1575, 1575, "spiTransferOneMessage", "msg->actual_length += xfer->len;",
      { "CS": "即将按默认路径撤销", "已完成": "两段共 9 字节", "actual_length": "5 → 9", "rx_buf": "A7 5C 3F 19（教学假设）" },
      ["完成长度是 5＋4=9", "返回值仍尚未交给教学模块"],
      "actual_length 是长度字段，不是 spi_sync 的返回值。接下来默认路径撤销 CS 并执行 message 收尾。"),
    S("退出并撤销 CS", "drivers/spi/spi.c · spi_transfer_one_message()", CORE_OUT, 1578, 1580, "spiTransferOneMessage", "spi_set_cs(msg->spi, false, false);\n\n\tif (msg->status == -EINPROGRESS)",
      { "CS": "撤销（逻辑高）", "message.status": "0", "actual_length": "9", "return": "准备 finalize" },
      ["ret=0 且 keep_cs=false，所以撤销选中", "若末段 cs_change=1，keep_cs 语义会不同"],
      "正常两段读取不设置 cs_change。错误路径也进入同一 out，但会因 ret!=0 撤销 CS。"),
    S("解除映射与资源", "drivers/spi/spi.c · spi_finalize_current_message()", CORE_FINALIZE, 2015, 2015, "spiFinalizeCurrentMessage", "spi_unmap_msg(ctlr, mesg);",
      { "message.status": "0", "actual_length": "9", "缓冲区": "解除 Core 映射", "调用者": "即将恢复" },
      ["Core 解除映射并释放拆分传输资源", "这不等于教学函数已经 kfree 两个堆缓冲区"],
      "Core 的资源收尾和协议驱动的 kzalloc/kfree 是两层责任。同步调用者收到完成通知后才能使用接收数据。"),
    S("完成通知返回", "drivers/spi/spi.c · spi_finalize_current_message()", CORE_COMPLETE, 2043, 2044, "spiFinalizeCurrentMessage", "if (mesg->complete)",
      { "message.status": "0", "actual_length": "9", "spi_sync": "返回 0", "return": "0", "returnTone": "good" },
      ["同步路径取得最终 message.status", "返回 0 表示事务成功，不表示返回 9"],
      "现在回到教学读取函数。只有返回值和完成长度都符合预期，才把 rx_buf 复制给 probe。"),
    S("核对返回值与长度", "code/B-B.4.3/spi_frame_observer.c · spi_frame_observer_read()", OBSERVER_CHECK, 58, 62, "observerRead", "if (message.actual_length != OBSERVER_CMD_LEN + OBSERVER_DATA_LEN)",
      { "ret": "0", "actual_length": "9", "data": "准备复制", "return": "继续成功路径", "returnTone": "good" },
      ["ret<0 为假，继续检查长度", "actual_length 等于 5＋4，因此不改成 -EIO"],
      "软件分别判断事务状态和完成长度。任一项不符合，都不会把接收缓冲区当成完整有效数据。"),
    S("复制数据并释放", "code/B-B.4.3/spi_frame_observer.c · spi_frame_observer_read()", OBSERVER_CHECK, 58, 67, "observerRead", "memcpy(data, rx_buf, OBSERVER_DATA_LEN);",
      { "data": "A7 5C 3F 19（教学假设）", "actual_length": "9", "ret": "0", "下一步": "共用 out_free", "returnTone": "good" },
      ["只有成功路径执行 memcpy", "下一步释放 tx_buf 与 rx_buf"],
      "接收数据复制到 probe 的栈数组后，堆缓冲区仍需释放；描述符则随读取函数返回自然失效。"),
    S("释放并返回 0", "code/B-B.4.3/spi_frame_observer.c · spi_frame_observer_read()", OBSERVER_FREE, 69, 72, "observerRead", "return ret;",
      { "tx_buf/rx_buf": "均已 kfree", "data": "A7 5C 3F 19（教学假设）", "ret": "0", "return": "0", "returnTone": "good" },
      ["成功和失败共用同一释放出口", "probe 此时才获得完整 4 字节结果"],
      "实验室不展示伪造 dmesg。正文给出的日志只是相同样式的预期输出，本页数据也不是从 Flash 读取的。"),
    S("probe 接受设备", "code/B-B.4.3/spi_frame_observer.c · spi_frame_observer_probe()", OBSERVER_SUCCESS, 91, 95, "observerProbe", "return 0;",
      { "probe": "返回 0", "绑定": "成功（逻辑模型）", "数据": "A7 5C 3F 19（教学假设）", "硬件验证": "not_verified", "returnTone": "good" },
      ["返回 0 让设备模型接受绑定", "仍不能据此推断已编译、已上板或电气稳定"],
      "正常路径闭环完成：DTS、设备、驱动、双段 message、Core、控制器、返回与释放都沿同一笔读取对齐。")
  ];

  const failureSteps = [
    S("模型注入首段 -EIO", "drivers/spi/spi.c · spi_transfer_one_message()", CORE_CALL, 1511, 1512, "spiTransferOneMessage", "ret = ctlr->transfer_one(ctlr, msg->spi, xfer);",
      { "CS": "有效", "当前 transfer": "第 0 段 · len=5", "ret": "-EIO（模型注入）", "actual_length": "0", "returnTone": "error" },
      ["本步骤人为规定 transfer_one 返回 -EIO", "这不是 Rockchip 实测错误，也不是故障复现"],
      "失败场景与正常路径共享此前所有建链和组帧步骤，只改变首段返回值，用来观察 Core 的既有错误出口。"),
    S("进入错误出口", "drivers/spi/spi.c · spi_transfer_one_message()", CORE_ERROR, 1513, 1530, "spiTransferOneMessage", "goto out;\n\t\t\t}",
      { "ret": "-EIO", "actual_length": "0", "第二段": "不执行", "CS": "尚未退出，仍为有效", "returnTone": "error" },
      ["首段未完成，不能累加 5", "第二段 RX 不会被伪装成成功"],
      "SPI_TRANS_FAIL_NO_START 表示传输尚未开始，允许 Core 解除映射并回退到 PIO（由 CPU 配合中断驱动 FIFO 收发）。本模型不设置该标志，因此不走 fallback_pio，而是记录错误并 goto out。"),
    S("错误路径撤销 CS", "drivers/spi/spi.c · spi_transfer_one_message()", CORE_OUT, 1578, 1580, "spiTransferOneMessage", "spi_set_cs(msg->spi, false, false);\n\n\tif (msg->status == -EINPROGRESS)",
      { "CS": "撤销（逻辑高）", "message.status": "-EIO", "actual_length": "0", "return": "准备 finalize", "returnTone": "error" },
      ["ret!=0 直接满足撤销条件", "message.status 从 -EINPROGRESS 变为 -EIO"],
      "CS 撤销和完成通知仍要执行。失败并不意味着跳过所有清理，也不意味着接收缓冲区包含新数据。"),
    S("解除映射与资源", "drivers/spi/spi.c · spi_finalize_current_message()", CORE_FINALIZE, 2015, 2015, "spiFinalizeCurrentMessage", "spi_unmap_msg(ctlr, mesg);",
      { "message.status": "-EIO", "actual_length": "0", "缓冲区": "解除 Core 映射", "第二段": "未执行", "returnTone": "error" },
      ["Core 仍执行资源收尾", "教学函数的两个堆缓冲区尚未由 kfree 释放"],
      "框架收尾之后，负状态沿同步调用返回。调用者必须保留这个错误值，不能只看缓冲区原来的零值。"),
    S("完成通知返回错误", "drivers/spi/spi.c · spi_finalize_current_message()", CORE_COMPLETE, 2043, 2044, "spiFinalizeCurrentMessage", "if (mesg->complete)",
      { "message.status": "-EIO", "actual_length": "0", "spi_sync": "返回 -EIO", "return": "-EIO", "returnTone": "error" },
      ["同步调用者收到负错误码", "返回值不是实际完成长度 0"],
      "现在回到教学模块。失败时既没有 9 字节完成长度，也不允许复制或打印假设数据。"),
    S("跳过数据复制", "code/B-B.4.3/spi_frame_observer.c · spi_frame_observer_read()", OBSERVER_CHECK, 58, 59, "observerRead", "if (ret < 0)",
      { "ret": "-EIO", "actual_length": "0", "memcpy": "不执行", "data": "保持 00 00 00 00", "returnTone": "error" },
      ["ret<0 为真，直接 goto out_free", "长度检查和成功复制都不会执行"],
      "rx_buf 的分配初值或部分底层内容都不能替代事务成功证据；本例直接把负错误送往共用释放出口。"),
    S("释放并返回错误", "code/B-B.4.3/spi_frame_observer.c · spi_frame_observer_read()", OBSERVER_FREE, 69, 72, "observerRead", "return ret;",
      { "tx_buf/rx_buf": "均已 kfree", "data": "未复制", "ret": "-EIO", "return": "-EIO", "returnTone": "error" },
      ["失败路径没有泄漏已分配缓冲区", "读取函数把原始负错误返回 probe"],
      "清理完成不等于恢复成功。调用者仍需根据 ret 决定绑定是否失败以及怎样记录错误。"),
    S("probe 绑定失败", "code/B-B.4.3/spi_frame_observer.c · spi_frame_observer_probe()", OBSERVER_PROBE, 85, 88, "observerProbe", "return ret;",
      { "probe": "返回 -EIO", "绑定": "失败（逻辑模型）", "成功日志": "不执行", "硬件验证": "not_verified", "returnTone": "error" },
      ["probe 将负错误继续返回 SPI Core", "不会打印 fast_read 成功数据"],
      "失败路径闭环完成：首段错误使第二段不执行、actual_length 保持 0、CS 撤销、资源释放、负错误逐层返回。")
  ];

  const LAB_CONFIG = {
    title: "SPI Framework Lab",
    kicker: "B-B.4.3 · LINUX V6.6 · RK3568 SPI1",
    subtitle: "沿同一笔 5＋4 字节 Fast Read，跟随代码位置、对象状态、CS 和返回路径。",
    transaction: ["0B 00 12 34 00", "5＋4 字节", "actual_length=9", "spi_sync=0"],
    modelBasis: "模型依据：Linux v6.6 SPI Core 与 Rockchip 驱动快照；A7 5C 3F 19 和 -EIO 注入均为教学条件",
    scenarios: {
      normal: buildSteps.concat(transferSteps),
      failure: buildSteps.concat(failureSteps)
    },
    sourceFiles: [
      {
        name: "spi_frame_observer.c",
        kind: "原创教学模块",
        url: "../code/B-B.4.3/spi_frame_observer.c",
        context: "Linux v6.6 外设协议驱动模型；加载后由 compatible 匹配进入 probe，同步执行一次只读 Fast Read。尚未编译或上板。"
      },
      {
        name: "spi-frame-observer.dts",
        kind: "板级 DTS 片段",
        url: "../code/B-B.4.3/spi-frame-observer.dts",
        context: "合入实际板级 DTS 后使用；不是独立 DTS 或 overlay。必须替换或禁用同占 SPI1 CS0 的其他节点，尚未构建 DTB。"
      },
      {
        name: "Makefile",
        kind: "外部模块构建入口",
        url: "../code/B-B.4.3/Makefile",
        context: "通过 KDIR 指向匹配目标内核的完整构建树；本机与交叉构建命令见正文。当前环境未执行模块编译。"
      }
    ]
  };

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const pad = (value) => String(value).padStart(2, "0");
  const listen = (id, event, handler) => $(id).addEventListener(event, handler);

  function renderCode(element, source, currentLine = -1, startLine = 1) {
    element.replaceChildren();
    source.replace(/\n$/, "").split("\n").forEach((line, index) => {
      const absoluteLine = startLine + index;
      const row = document.createElement("span");
      row.className = "code-line";
      if (absoluteLine === currentLine) row.classList.add("is-current");

      const number = document.createElement("span");
      number.className = "line-no";
      number.textContent = String(absoluteLine);
      number.setAttribute("aria-hidden", "true");

      const text = document.createElement("span");
      text.className = "line-text";
      text.textContent = line || " ";
      row.append(number, text);
      element.appendChild(row);
    });

    const current = element.querySelector(".is-current");
    const windowElement = element.parentElement;
    if (current) {
      const top = current.offsetTop - windowElement.clientHeight / 2;
      windowElement.scrollTop = Math.max(0, top);
    } else {
      windowElement.scrollTop = 0;
    }
  }

  function makeFullView(step) {
    if (!step.full) return null;
    const { key, needle } = step.full;
    if (!key || !needle) throw new Error("步骤 full 必须同时提供 key 和 needle");
    const assets = window.LAB_FULL_CODE || {};
    const asset = assets[key];
    if (!asset) throw new Error(`完整代码 key 不存在：${key}`);
    if (typeof asset.code !== "string" || !Number.isInteger(asset.startLine) || asset.startLine < 1) {
      throw new Error(`完整代码 ${key} 必须包含 code 和从 1 开始的整数 startLine`);
    }
    const offset = asset.code.indexOf(needle);
    if (offset < 0) throw new Error(`完整代码 ${key} 中找不到 needle：${needle}`);
    if (offset !== asset.code.lastIndexOf(needle)) {
      throw new Error(`完整代码 ${key} 中 needle 不唯一：${needle}`);
    }
    const highlightLine = asset.startLine + asset.code.slice(0, offset).split("\n").length - 1;
    return {
      path: asset.path || key,
      code: asset.code,
      startLine: asset.startLine,
      highlightLine
    };
  }

  Object.values(LAB_CONFIG.scenarios).forEach((steps) => {
    steps.forEach((step) => {
      step.fullView = makeFullView(step);
    });
  });

  let scenario = "normal";
  let stepIndex = 0;
  let codeViewMode = "snippet";
  let updateStepStrip = () => {};

  function currentSteps() {
    return LAB_CONFIG.scenarios[scenario];
  }

  function makeStepStrip() {
    const container = $("step-strip");
    container.replaceChildren();
    currentSteps().forEach((step, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "step-chip";
      const number = document.createElement("span");
      number.textContent = pad(index + 1);
      button.append(number, document.createTextNode(step.label));
      button.addEventListener("click", () => {
        stepIndex = index;
        renderStep();
      });
      container.appendChild(button);
    });

    updateStepStrip = () => {
      $$(".step-chip", container).forEach((button, index) => {
        button.classList.toggle("is-active", index === stepIndex);
        button.classList.toggle("is-done", index < stepIndex);
        if (index === stepIndex) button.setAttribute("aria-current", "step");
        else button.removeAttribute("aria-current");
      });
    };
  }

  function renderStates(states) {
    const grid = $("state-grid");
    grid.replaceChildren();
    Object.entries(states).forEach(([name, value]) => {
      if (name === "returnTone") return;
      const wrapper = document.createElement("div");
      const term = document.createElement("dt");
      const detail = document.createElement("dd");
      term.textContent = name;
      detail.textContent = value;
      if (name === "return" && states.returnTone) detail.classList.add(`is-${states.returnTone}`);
      wrapper.append(term, detail);
      grid.appendChild(wrapper);
    });
  }

  function renderCodeView() {
    const step = currentSteps()[stepIndex];
    const toggle = $("step-full-toggle");
    if (codeViewMode === "full" && !step.fullView) codeViewMode = "snippet";
    const showFull = codeViewMode === "full" && step.fullView;

    toggle.disabled = !step.fullView;
    toggle.textContent = showFull ? "步骤片段" : "完整函数";
    toggle.setAttribute("aria-pressed", String(Boolean(showFull)));
    toggle.title = step.fullView ? "在当前步骤片段与其完整来源之间切换" : "本步骤没有登记完整代码，已禁用切换";

    if (showFull) {
      $("step-code-path").textContent = `${step.fullView.path} · 起始行 ${step.fullView.startLine}`;
      renderCode($("step-code"), step.fullView.code, step.fullView.highlightLine, step.fullView.startLine);
    } else {
      $("step-code-path").textContent = `${step.path} · 步骤片段`;
      renderCode($("step-code"), step.code, step.line, step.startLine || 1);
    }
  }

  function renderStep() {
    const steps = currentSteps();
    const step = steps[stepIndex];
    $("step-counter").textContent = `${pad(stepIndex + 1)} / ${pad(steps.length)}`;
    $("step-note").textContent = step.note;
    renderCodeView();
    renderStates(step.states);

    const observations = $("step-observations");
    observations.replaceChildren();
    step.observations.forEach((observation) => {
      const item = document.createElement("li");
      item.textContent = observation;
      observations.appendChild(item);
    });

    $("step-prev").disabled = stepIndex === 0;
    $("step-next").disabled = stepIndex === steps.length - 1;
    updateStepStrip();
  }

  listen("step-full-toggle", "click", () => {
    codeViewMode = codeViewMode === "full" ? "snippet" : "full";
    renderCodeView();
  });
  listen("step-prev", "click", () => {
    stepIndex = Math.max(0, stepIndex - 1);
    renderStep();
  });
  listen("step-next", "click", () => {
    stepIndex = Math.min(currentSteps().length - 1, stepIndex + 1);
    renderStep();
  });
  listen("step-reset", "click", () => {
    stepIndex = 0;
    renderStep();
  });
  listen("scenario-mode", "change", (event) => {
    scenario = event.target.value;
    stepIndex = 0;
    makeStepStrip();
    renderStep();
  });

  const sourceCache = new Map();
  let selectedSource = LAB_CONFIG.sourceFiles[0].name;
  let sourceRequest = 0;

  function renderSourceButtons() {
    const nav = $("source-files");
    nav.replaceChildren();
    LAB_CONFIG.sourceFiles.forEach((file) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "source-file-button";
      button.classList.toggle("is-active", file.name === selectedSource);
      button.setAttribute("aria-pressed", String(file.name === selectedSource));
      const name = document.createElement("code");
      name.textContent = file.name;
      const detail = document.createElement("small");
      detail.textContent = file.kind;
      button.append(name, detail);
      button.addEventListener("click", () => loadSource(file.name));
      nav.appendChild(button);
    });
  }

  async function loadSource(name) {
    const file = LAB_CONFIG.sourceFiles.find((candidate) => candidate.name === name);
    if (!file) return;
    selectedSource = name;
    const request = ++sourceRequest;
    renderSourceButtons();
    $("source-path").textContent = file.url.replace(/^\.\//, "");
    $("source-context").textContent = file.context;
    $("source-download").href = file.url;
    $("source-download").setAttribute("download", file.name);
    $("copy-source").disabled = true;

    if (sourceCache.has(name)) {
      renderCode($("source-code"), sourceCache.get(name));
      $("source-status").textContent = `已从缓存读取 ${name} · 与首次加载内容相同`;
      $("copy-source").disabled = false;
      return;
    }

    $("source-code").textContent = "正在加载…";
    $("source-status").textContent = `请求 ${file.url}`;
    try {
      const response = await fetch(file.url);
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const content = await response.text();
      sourceCache.set(name, content);
      if (request !== sourceRequest) return;
      renderCode($("source-code"), content);
      $("source-status").textContent = `加载成功：${name} · 请按文件说明判断其验证状态`;
      $("copy-source").disabled = false;
    } catch (error) {
      if (request !== sourceRequest) return;
      $("source-code").textContent = `无法加载 ${name}\n${error.message}\n\n请通过 HTTP 打开本页面，或使用“下载文件”直接访问源文件。`;
      $("source-status").textContent = "源码加载失败：file:// 通常会阻止 fetch；请经 MkDocs、GitHub Pages 或其他 HTTP 服务访问。";
    }
  }

  listen("copy-source", "click", async () => {
    const content = sourceCache.get(selectedSource);
    if (!content) return;
    try {
      let copied = false;
      if (navigator.clipboard && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(content);
          copied = true;
        } catch {
          /* 页面未聚焦时剪贴板 API 可能被拒绝，继续尝试兼容路径。 */
        }
      }
      if (!copied) {
        const textarea = document.createElement("textarea");
        textarea.value = content;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand("copy");
        textarea.remove();
        if (!copied) throw new Error("浏览器拒绝复制");
      }
      $("source-status").textContent = `已复制 ${selectedSource}`;
    } catch (error) {
      $("source-status").textContent = `复制失败：${error.message}。可在代码区全选，或使用下载文件。`;
    }
  });

  const views = ["mechanism", "source"];
  let activeView = "mechanism";

  function switchView(view, updateHash = true) {
    if (!views.includes(view)) view = "mechanism";
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
    document.title = `${LAB_CONFIG.title} · ${view}`;
  }

  $$(".rail-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  window.addEventListener("hashchange", () => switchView(window.location.hash.slice(1), false));

  document.addEventListener("keydown", (event) => {
    if (activeView !== "mechanism" || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLElement &&
        (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable)) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const direction = event.key === "ArrowRight" ? 1 : -1;
    stepIndex = Math.max(0, Math.min(currentSteps().length - 1, stepIndex + direction));
    renderStep();
    event.preventDefault();
  });

  $("lab-title").textContent = LAB_CONFIG.title;
  $("lab-kicker").textContent = LAB_CONFIG.kicker;
  $("lab-subtitle").textContent = LAB_CONFIG.subtitle;
  $("model-basis").textContent = LAB_CONFIG.modelBasis;
  const tag = $("transaction-tag");
  LAB_CONFIG.transaction.forEach((item, index) => {
    if (index > 0) {
      const arrow = document.createElement("b");
      arrow.textContent = "→";
      tag.appendChild(arrow);
    }
    const value = document.createElement("span");
    value.textContent = item;
    tag.appendChild(value);
  });

  makeStepStrip();
  renderStep();
  renderSourceButtons();
  $("copy-source").disabled = true;
  switchView(views.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "mechanism", false);
})();
