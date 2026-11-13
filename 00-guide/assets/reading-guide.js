/* 《如何阅读本书》本地交互；无网络请求、无持久化、无第三方依赖。 */
(function () {
  "use strict";

  const recommendations = {
    bringup: {
      label: "新板移植",
      action: "先建立板卡与工具链认知，再沿启动链定位适配边界。",
      links: [
        ["第 1—4 章", "../../01-boot-and-run/"],
        ["第 7 章 启动链", "../../02-core-mechanism/ch07-boot-chain/"]
      ]
    },
    boot: {
      label: "启动链",
      action: "按 BootROM、SPL、U-Boot、Kernel、init 分段跟踪交接。",
      links: [["第 7 章 启动链深度解析", "../../02-core-mechanism/ch07-boot-chain/"]]
    },
    driver: {
      label: "驱动骨架",
      action: "先用最小外设复核完整闭环，再查对应子系统写法。",
      links: [
        ["第 6 章 点亮 LED", "../../01-boot-and-run/ch06-first-led/"],
        ["扩展 D 驱动开发实战", "../../d-qu-dong-kai-fa-shi-zhan/"]
      ]
    },
    dts: {
      label: "设备树与设备模型",
      action: "从节点出发，跟到设备创建、驱动匹配与 probe。",
      links: [
        ["第 6 章 点亮 LED", "../../01-boot-and-run/ch06-first-led/"],
        ["第 11 章 设备模型", "../../02-core-mechanism/ch11-device-model/"]
      ]
    },
    debug: {
      label: "内核调试",
      action: "先学习症状分类、信息收集和假设验证，再回具体子系统。",
      links: [["第 23 章 系统调试方法论", "../../04-system-thinking/ch23-debugging/"]]
    },
    interrupt: {
      label: "中断与并发",
      action: "把中断上下文、底半部与锁的选择放到同一执行路径中理解。",
      links: [
        ["第 10 章 中断与时间", "../../02-core-mechanism/ch10-interrupt-time/"],
        ["第 13 章 并发与同步", "../../02-core-mechanism/ch13-concurrency/"]
      ]
    },
    optimization: {
      label: "启动与系统优化",
      action: "先建立测量口径，再决定裁剪、启动或功耗优化顺序。",
      links: [
        ["第 24 章 启动全链路优化", "../../04-system-thinking/ch24-boot-optimization/"],
        ["第 15 章 电源管理", "../../02-core-mechanism/ch15-power/"]
      ]
    },
    core: {
      label: "核心机制",
      action: "按当前问题选择进程、内存或文件系统，不必同时展开。",
      links: [
        ["第 8 章 进程与调度", "../../02-core-mechanism/ch08-process-sched/"],
        ["第 9 章 内存管理", "../../02-core-mechanism/ch09-memory/"],
        ["第 12 章 文件系统", "../../02-core-mechanism/ch12-filesystem/"]
      ]
    },
    delivery: {
      label: "产品交付",
      action: "把构建、存储、更新与可靠性放到同一交付链中检查。",
      links: [
        ["第 17—18 章", "../../03-design-decisions/"],
        ["第 21 章 OTA 与更新架构设计", "../../03-design-decisions/ch21-ota/"]
      ]
    },
    architecture: {
      label: "架构设计",
      action: "先练驱动边界与故障域分析，再回看完整系统设计约束。",
      links: [
        ["第 22 章 驱动架构设计", "../../03-design-decisions/ch22-driver-arch/"],
        ["第 16 章 内核版本与启动架构设计", "../../03-design-decisions/ch16-kernel-version/"]
      ]
    }
  };

  function initializeReadingPlanner() {
    const root = document.querySelector("[data-reading-planner]");
    if (!root || root.dataset.initialized === "true") return;
    root.dataset.initialized = "true";

    const tabs = Array.from(root.querySelectorAll("[data-route-tab]"));
    const panels = Array.from(root.querySelectorAll("[data-route-panel]"));
    const assessmentInputs = Array.from(root.querySelectorAll("[data-assessment]"));
    const feedback = root.querySelector("#planner-feedback");
    const defaultFeedback = feedback.textContent;

    function activateTab(key, moveFocus) {
      tabs.forEach((tab) => {
        const selected = tab.dataset.routeTab === key;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
        if (selected && moveFocus) tab.focus();
      });
      panels.forEach((panel) => {
        panel.hidden = panel.dataset.routePanel !== key;
      });
    }

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => {
        activateTab(tab.dataset.routeTab, false);
        feedback.textContent = defaultFeedback;
      });
      tab.addEventListener("keydown", (event) => {
        let nextIndex = null;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % tabs.length;
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + tabs.length) % tabs.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = tabs.length - 1;
        if (nextIndex === null) return;
        event.preventDefault();
        activateTab(tabs[nextIndex].dataset.routeTab, true);
        feedback.textContent = defaultFeedback;
      });
    });

    function updateAssessment() {
      const rated = [];
      assessmentInputs.forEach((input, order) => {
        const value = Number(input.value);
        const key = input.dataset.assessment;
        const output = root.querySelector(`#score-${key}`);
        const scored = value > 0;
        output.textContent = scored ? `${value} 分` : "未评";
        output.dataset.scored = String(scored);
        input.setAttribute("aria-valuetext", scored ? `${value} 分` : "未评");
        if (scored) rated.push({ key, value, order });
      });

      const count = rated.length;
      root.querySelector("#assessment-progress").value = count;
      root.querySelector("#assessment-progress").textContent = `${count} / 10`;
      root.querySelector("#assessment-count").textContent = `${count} / 10`;

      const summary = root.querySelector("#assessment-summary");
      const container = root.querySelector("#assessment-recommendations");
      const list = root.querySelector("#recommendation-list");
      list.replaceChildren();

      if (count === 0) {
        summary.textContent = "尚未评分。可以只评估熟悉或不熟悉的项目，不必一次填满。";
        container.hidden = true;
        return;
      }

      rated.sort((a, b) => a.value - b.value || a.order - b.order);
      const minimum = rated[0].value;
      const weakest = rated.filter((item) => item.value === minimum).map((item) => recommendations[item.key].label);
      summary.textContent = `已评估 ${count} / 10 项。当前最低为 ${minimum} 分：${weakest.join("、")}。0 分未评项目不参与排序。`;

      const selected = rated.slice(0, 3);
      const hasWeakItem = rated.some((item) => item.value <= 3);
      root.querySelector("#recommendation-title").textContent = hasWeakItem
        ? "优先补充：最低分的最多 3 项"
        : "没有 3 分及以下项目：最低分项可作为复核顺序";
      selected.forEach((item) => {
        const data = recommendations[item.key];
        const li = document.createElement("li");
        const heading = document.createElement("strong");
        heading.textContent = data.label;
        const score = document.createElement("span");
        score.className = "recommendation-score";
        score.textContent = `当前 ${item.value} 分`;
        heading.appendChild(score);
        const paragraph = document.createElement("p");
        paragraph.appendChild(document.createTextNode(`${data.action} `));
        data.links.forEach(([label, href], index) => {
          if (index > 0) paragraph.appendChild(document.createTextNode("、"));
          const link = document.createElement("a");
          link.href = href;
          link.textContent = label;
          paragraph.appendChild(link);
        });
        paragraph.appendChild(document.createTextNode("。"));
        li.append(heading, paragraph);
        list.appendChild(li);
      });
      container.hidden = false;
    }

    assessmentInputs.forEach((input) => {
      input.addEventListener("input", () => {
        updateAssessment();
        feedback.textContent = defaultFeedback;
      });
    });

    const hoursInput = root.querySelector("#weekly-hours");
    const weeksInput = root.querySelector("#plan-weeks");
    const numberFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

    function updateBudget() {
      const hours = Number(hoursInput.value);
      const weeks = Number(weeksInput.value);
      const validHours = Number.isFinite(hours) && hours >= 1 && hours <= 80;
      const validWeeks = Number.isInteger(weeks) && weeks >= 1 && weeks <= 52;
      const totalOutput = root.querySelector("#total-hours");
      const unitsOutput = root.querySelector("#complete-units");
      const schedule = root.querySelector("#budget-schedule");

      if (!validHours || !validWeeks) {
        totalOutput.textContent = "—";
        unitsOutput.textContent = "—";
        schedule.textContent = "请输入每周 1—80 小时、持续 1—52 周的整数周数，才能计算时间预算。";
        return;
      }

      const total = hours * weeks;
      const units = Math.floor(weeks / 2);
      const remainder = weeks % 2;
      totalOutput.textContent = numberFormat.format(total);
      unitsOutput.textContent = String(units);

      if (units === 0) {
        schedule.textContent = "当前只有 1 周，可先做一次精读与验证，不必强行凑成完整单元；下一周再扩展与关联。";
      } else {
        schedule.textContent = `${weeks} 周可安排 ${units} 个完整学习单元。每个单元用第 1 周精读与验证，第 2 周扩展与关联。`;
        if (remainder === 1) schedule.textContent += " 剩余 1 周用于复盘、补验证或处理遗留问题。";
      }
    }

    [hoursInput, weeksInput].forEach((input) => {
      input.addEventListener("input", () => {
        updateBudget();
        feedback.textContent = defaultFeedback;
      });
    });

    root.querySelector("#planner-reset").addEventListener("click", () => {
      activateTab("beginner", false);
      assessmentInputs.forEach((input) => { input.value = "0"; });
      hoursInput.value = "6";
      weeksInput.value = "12";
      updateAssessment();
      updateBudget();
      feedback.textContent = "已恢复默认路线、未评分状态，以及每周 6 小时、持续 12 周的时间预算。";
    });

    updateAssessment();
    updateBudget();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeReadingPlanner, { once: true });
  } else {
    initializeReadingPlanner();
  }

  /* Material navigation.instant 局部换页后，新脚本通过 document$ 再初始化。 */
  if (typeof document$ !== "undefined") {
    document$.subscribe(initializeReadingPlanner);
  }
})();
