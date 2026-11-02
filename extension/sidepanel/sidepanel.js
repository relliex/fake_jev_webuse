/**
 * Lite-JEV: Side Panel Controller
 * Handles user interactions, metrics updates, spotlight bridging & transparent audit logging
 */

(function () {
  let engine = null;
  let controller = null;
  let currentElements = [];
  let badgesVisible = true;
  const logger = window.globalDecisionLogger || new window.DecisionLogger();

  // DOM Elements
  const metricLatency = document.getElementById("metric-latency");
  const metricTtft = document.getElementById("metric-ttft");
  const metricTokens = document.getElementById("metric-tokens");
  const metricMode = document.getElementById("metric-mode");

  const taskInput = document.getElementById("task-input");
  const btnRun = document.getElementById("btn-run");
  const btnPause = document.getElementById("btn-pause");
  const btnStop = document.getElementById("btn-stop");
  const statusBanner = document.getElementById("status-banner");
  const statusText = document.getElementById("status-text");

  const elementCountBadge = document.getElementById("element-count-badge");
  const elementsList = document.getElementById("elements-list");
  const btnToggleBadges = document.getElementById("btn-toggle-badges");
  const btnRefreshScan = document.getElementById("btn-refresh-scan");

  const btnClearLog = document.getElementById("btn-clear-log");
  function getTrajectoryList() {
    return document.getElementById("trajectory-list");
  }

  const planSection = document.getElementById("plan-section");
  const planTimer = document.getElementById("plan-timer");
  const planList = document.getElementById("plan-list");
  const activeSubgoalText = document.getElementById("active-subgoal-text");

  // Audit Log Inspector Elements
  const btnOpenAudit = document.getElementById("btn-open-audit");
  const btnCloseAudit = document.getElementById("btn-close-audit");
  const auditModal = document.getElementById("audit-modal");
  const auditLogViewer = document.getElementById("audit-log-viewer");
  const btnExportLog = document.getElementById("btn-export-log");
  const btnDownloadAudit = document.getElementById("btn-download-audit");
  const btnExportLogModal = document.getElementById("btn-export-log-modal");

  function renderPlanBoard(plan, activeSubgoal, elapsedMs) {
    if (!plan || plan.length === 0) {
      planSection.classList.add("hidden");
      return;
    }
    planSection.classList.remove("hidden");
    if (elapsedMs) planTimer.textContent = `⏱️ ${elapsedMs} ms`;
    activeSubgoalText.textContent = activeSubgoal || "执行中...";

    planList.innerHTML = "";
    plan.forEach((item) => {
      const row = document.createElement("div");
      row.className = `plan-item ${item.status || "pending"}`;
      let icon = "⏳";
      if (item.status === "completed") icon = "✅";
      else if (item.status === "in_progress") icon = "⚡";
      row.innerHTML = `<span>${icon}</span> <span>[阶段${item.phase}] ${item.description}</span>`;
      planList.appendChild(row);
    });
  }

  // Settings Modal Elements
  const btnOpenSettings = document.getElementById("btn-open-settings");
  const btnCloseSettings = document.getElementById("btn-close-settings");
  const settingsModal = document.getElementById("settings-modal");
  const btnSaveSettings = document.getElementById("btn-save-settings");

  const settingProvider = document.getElementById("setting-provider");
  const settingApiKey = document.getElementById("setting-api-key");
  const settingModel = document.getElementById("setting-model");
  const settingBaseUrl = document.getElementById("setting-base-url");
  const settingZeroCot = document.getElementById("setting-zero-cot");

  const wrapperApiKey = document.getElementById("wrapper-api-key");
  const wrapperModel = document.getElementById("wrapper-model");
  const wrapperBaseUrl = document.getElementById("wrapper-base-url");

  // Load Saved Settings or Defaults
  async function loadConfig() {
    return new Promise((resolve) => {
      chrome.storage?.local?.get(
        ["lite_jev_config"],
        (res) => {
          const cfg = res?.lite_jev_config || {
            provider: "mock",
            apiKey: "",
            baseUrl: "https://api.openai.com/v1",
            model: "gemini-2.0-flash",
            zeroCoT: true,
          };
          resolve(cfg);
        }
      );
    });
  }

  async function saveConfig(cfg) {
    return new Promise((resolve) => {
      chrome.storage?.local?.set({ lite_jev_config: cfg }, () => resolve());
    });
  }

  function updateProviderVisibility(provider) {
    if (provider === "mock") {
      wrapperApiKey.style.display = "none";
      wrapperModel.style.display = "none";
      wrapperBaseUrl.style.display = "none";
    } else if (provider === "gemini") {
      wrapperApiKey.style.display = "flex";
      wrapperModel.style.display = "flex";
      wrapperBaseUrl.style.display = "none";
      if (!settingModel.value.includes("gemini")) {
        settingModel.value = "gemini-2.0-flash";
      }
    } else {
      wrapperApiKey.style.display = "flex";
      wrapperModel.style.display = "flex";
      wrapperBaseUrl.style.display = "flex";
      if (settingModel.value.includes("gemini")) {
        settingModel.value = "deepseek-chat";
      }
    }
  }

  async function bridgeToPage(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "BRIDGE_TO_PAGE", payload: msg },
        (res) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (res && res.error && !res.ok) {
            return reject(new Error(res.error));
          }
          resolve(res);
        }
      );
    });
  }

  async function refreshPageScan() {
    try {
      statusText.textContent = "正在感知当前网页中可交互组件...";
      const res = await bridgeToPage({ action: "SCAN_PAGE" });
      if (res && (res.is_new_tab || res.page_archetype === "NEW_TAB_PAGE")) {
        currentElements = [];
        elementCountBadge.textContent = "0";
        elementsList.innerHTML = `<div class="empty-state" style="padding:16px 12px; line-height:1.6; text-align:center;">
          <div style="font-size:22px; margin-bottom:6px;">🌐</div>
          <strong style="color:#e2e8f0; font-size:12px;">当前处于新标签页 / 空白页</strong><br>
          <span style="font-size:11px; color:#94a3b8;">在上方输入任务目标并点击【极速运行】，Agent 将使用 GOTO 原语自动打开目标网站并开始操作！</span>
        </div>`;
        statusText.textContent = "🌐 当前处于新标签页，输入目标点击【极速运行】即可自动启航！";
        return;
      }
      if (res && res.elements) {
        currentElements = res.elements;
        renderElementsList(currentElements);
        statusText.textContent = `已定位 ${currentElements.length} 个视口候选组件，就绪`;
      }
    } catch (err) {
      elementsList.innerHTML = `<div class="empty-state">页面连接中... 请确保网页已加载完毕 (${err.message})</div>`;
    }
  }

  function renderElementsList(elements) {
    elementCountBadge.textContent = elements.length;
    if (!elements || elements.length === 0) {
      elementsList.innerHTML = '<div class="empty-state">当前可视区域无候选组件</div>';
      return;
    }

    elementsList.innerHTML = "";
    elements.forEach((el) => {
      const item = document.createElement("div");
      item.className = "element-item";

      const catLabel = el.category ? `[${el.category}] ` : "";
      const label = el.text || el.placeholder || el.aria_label || el.title || el.tag;

      item.innerHTML = `
        <div style="display:flex; align-items:center; overflow:hidden;">
          <span class="element-id-pill">${el.id}</span>
          <span class="element-desc" title="${label}">${catLabel}${label}</span>
        </div>
        <span class="element-tag-badge">&lt;${el.tag}&gt;</span>
      `;

      item.addEventListener("mouseenter", () => {
        bridgeToPage({
          action: "HOVER_ELEMENT",
          element_id: el.id,
          label: `🎯 焦点 [${el.id}]`,
        });
      });

      item.addEventListener("mouseleave", () => {
        bridgeToPage({ action: "CLEAR_HOVER" });
      });

      elementsList.appendChild(item);
    });
  }

  function appendTrajectoryRecord(record) {
    const list = getTrajectoryList();
    if (!list) return;
    if (list.querySelector(".empty-state")) {
      list.innerHTML = "";
    }

    const { step, action, profiler, execRes } = record;
    const card = document.createElement("div");
    card.className = "trajectory-item";

    const latencyText = profiler ? `${profiler.totalApiMs} ms` : "--";
    const tokCount = profiler?.outputTokens || 0;

    let actionStr = "";
    const actType = action.action || "";
    if (actType === "FINISH") {
      actionStr = `🏁 尝试结束: ${action.msg || ""}`;
    } else if (actType === "GOTO" || actType === "NAVIGATE") {
      actionStr = `🌐 直达网址: <a href="${action.url}" target="_blank" style="color:#38bdf8;text-decoration:underline;">${action.url}</a>`;
    } else if (actType === "CLOSE_MODAL") {
      actionStr = `🚪 清退弹窗与遮罩层`;
    } else if (actType === "SCROLL") {
      actionStr = `📜 页面滚动 [${action.value || action.id || "DOWN"}]`;
    } else if (actType === "HOVER") {
      actionStr = `🎯 鼠标悬浮 [${action.id}]`;
    } else if (actType === "WAIT") {
      actionStr = `⏱️ 等待稳定 [${action.value || 1.5}s]`;
    } else if (actType === "GO_BACK") {
      actionStr = `⬅️ 浏览器后退`;
    } else if (actType === "REFRESH") {
      actionStr = `🔄 网页刷新`;
    } else if (actType === "CLEAR_TYPE") {
      actionStr = `🧹 清空重填 [${action.id}]: "${action.value}"`;
    } else if (actType === "KEY" || actType === "PRESS") {
      actionStr = `⌨️ 按键 [${action.key || action.id}]`;
    } else if (actType === "TYPE" || actType === "TYPE_AND_ENTER") {
      actionStr = `✏️ 填入 [${action.id}]: "${action.value}" ${action.enter ? "↵(回车)" : ""}`;
    } else {
      actionStr = `🖱️ 点击 [${action.id}]`;
    }

    const obsHtml = execRes && execRes.observation
      ? `<div class="traj-obs" style="margin-top:4px; font-size:10px; color:#94a3b8; background:rgba(15,23,42,0.4); padding:3px 6px; border-radius:4px; border-left:2px solid #38bdf8;">👁️ 反馈: ${execRes.observation}</div>`
      : "";

    card.innerHTML = `
      <div class="traj-header">
        <span class="traj-step">⚡ 第 ${step} 步 (Jev条件反射)</span>
        <span class="traj-latency">⏱️ ${latencyText} (${tokCount} tok)</span>
      </div>
      <div class="traj-body">${actionStr}</div>
      ${obsHtml}
      <div style="margin-top:4px; display:flex; justify-content:flex-end;">
        <button class="text-btn btn-inspect-step" style="font-size:10px;">🔍 审查此步 Prompt & Raw 响应</button>
      </div>
    `;

    card.querySelector(".btn-inspect-step")?.addEventListener("click", () => {
      openAuditModalForStep(step);
    });

    list.prepend(card);

    // Update Top Dashboard Metrics
    if (profiler) {
      metricLatency.textContent = `${profiler.totalApiMs} ms`;
      metricTtft.textContent = `${profiler.ttftMs} ms`;
      metricTokens.textContent = `${tokCount} tok`;
    }
  }

  function appendVerificationRecord({ step, verification }) {
    const list = getTrajectoryList();
    if (!list) return;
    if (list.querySelector(".empty-state")) {
      list.innerHTML = "";
    }

    const card = document.createElement("div");
    card.className = "trajectory-item traj-verify-item";

    const statusLabel = verification.isCompleted
      ? `<span style="color:#10b981;font-weight:700;">✅ 深思考把关：真实达成目标</span>`
      : `<span style="color:#f59e0b;font-weight:700;">⏳ 深思考把关：未完成（指令纠偏中）</span>`;

    card.innerHTML = `
      <div class="traj-header">
        <span style="color:#c084fc;font-weight:700;">🧠 System-2 人类深思考复核</span>
        <span class="traj-latency">⏱️ ${verification.elapsedMs || 0} ms</span>
      </div>
      <div style="font-size:11px; margin-top:4px;">
        <div>${statusLabel}</div>
        <div style="color:#94a3b8; margin-top:2px; font-size:10px;">${verification.reasoning || ""}</div>
        ${!verification.isCompleted && verification.nextSubgoal ? `<div style="color:#38bdf8; margin-top:3px; font-weight:600;">👉 传导下一步子目标: ${verification.nextSubgoal}</div>` : ""}
      </div>
    `;

    list.prepend(card);
  }

  function setRunningState(running) {
    btnRun.disabled = running;
    btnPause.disabled = !running;
    btnStop.disabled = !running;
    taskInput.disabled = running;
  }

  // =========================================================================
  // Audit Modal & Inspector Logic
  // =========================================================================
  function renderAuditViewer() {
    const logs = logger.getLogs();
    if (!logs || logs.length === 0) {
      auditLogViewer.innerHTML = `<div class="empty-state">暂无决策日志记录。请先运行一次任务。</div>`;
      return;
    }

    auditLogViewer.innerHTML = "";
    logs.forEach((log) => {
      const card = document.createElement("div");
      card.className = "audit-entry-card";
      card.id = `audit-card-step-${log.step}`;

      const rawJsonStr =
        typeof log.rawApiResponse === "object"
          ? JSON.stringify(log.rawApiResponse, null, 2)
          : String(log.rawApiResponse || "(无)");

      const isMockBadge = log.isMock
        ? `<span style="background:#f59e0b33; color:#f59e0b; padding:1px 5px; border-radius:3px; font-size:10px;">⚡ Mock 模拟器</span>`
        : `<span style="background:#10b98133; color:#10b981; padding:1px 5px; border-radius:3px; font-size:10px;">🌐 真实大模型 API</span>`;

      const fallbackNotice = log.isFallback
        ? `<div style="color:#ef4444; margin:4px 0; font-size:10px;">⚠️ 注意：该步触发了保底逻辑: ${log.fallbackReason || ""}</div>`
        : "";

      card.innerHTML = `
        <div class="audit-entry-header">
          <div>
            <span class="audit-step-tag">Step ${log.step} [${log.phase}]</span>
            ${isMockBadge}
          </div>
          <span class="audit-meta-tag">${log.modelConfig?.provider || ""} / ${log.modelConfig?.model || ""} | ⏱️ ${log.profiler?.totalApiMs || 0} ms (${log.profiler?.outputTokens || 0} tok)</span>
        </div>
        ${fallbackNotice}
        <div class="audit-block-title">【1. 发送给大模型的完整 PROMPT (包含全部候选控件)】</div>
        <pre class="audit-code-block audit-code-prompt">${escapeHtml(log.fullPrompt || "")}</pre>

        <div class="audit-block-title">【2. 大模型 HTTP 接口返回的 RAW 原始响应 (未经任何加工)】</div>
        <pre class="audit-code-block audit-code-raw">${escapeHtml(rawJsonStr)}</pre>

        <div class="audit-block-title">【3. 解析与执行决策】</div>
        <div style="font-size:11px; margin-top:2px;">
          原始输出: <span class="audit-action-highlight">"${log.rawOutput || ""}"</span>
          -> 解析动作: <strong>${log.parsedAction?.action || "--"}</strong> (${log.parsedAction?.id || log.parsedAction?.key || ""})
        </div>
      `;

      auditLogViewer.appendChild(card);
    });
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function openAuditModalForStep(step) {
    renderAuditViewer();
    auditModal.classList.remove("hidden");
    setTimeout(() => {
      const targetCard = document.getElementById(`audit-card-step-${step}`);
      if (targetCard) {
        targetCard.scrollIntoView({ behavior: "smooth", block: "start" });
        targetCard.style.borderColor = "#38bdf8";
        setTimeout(() => (targetCard.style.borderColor = "#1e293b"), 1500);
      }
    }, 100);
  }

  // =========================================================================
  // Initialize
  // =========================================================================
  async function init() {
    const config = await loadConfig();
    engine = new window.ZeroCoTEngine(config, logger);
    controller = new window.AgentController({
      engine,
      bridge: bridgeToPage,
    });

    metricMode.textContent = config.zeroCoT ? "⚡ Zero-CoT (闭思考)" : "🧠 CoT (开思考)";
    if (!config.zeroCoT) {
      metricMode.style.color = "#f59e0b";
      metricMode.style.borderColor = "#f59e0b44";
      metricMode.style.background = "rgba(245, 158, 11, 0.12)";
    }

    controller.setCallbacks({
      onStatus: ({ text }) => {
        statusText.textContent = text;
      },
      onPlanGenerated: (data) => {
        renderPlanBoard(data.plan, data.activeSubgoal, data.elapsedMs);
        const list = getTrajectoryList();
        if (list) {
          if (list.querySelector(".empty-state")) {
            list.innerHTML = "";
          }
          const card = document.createElement("div");
          card.className = "trajectory-item traj-verify-item";
          card.innerHTML = `
            <div class="traj-header">
              <span style="color:#c084fc;font-weight:700;">🧠 System-2 意图理解与任务发布</span>
              <span class="traj-latency">⏱️ ${data.elapsedMs} ms</span>
            </div>
            <div style="font-size:11px; margin-top:3px; color:#cbd5e1;">
              <div>推演: ${data.thought}</div>
              <div style="color:#38bdf8; margin-top:2px; font-weight:600;">👉 下发首期肌肉记忆指令: ${data.activeSubgoal}</div>
            </div>
          `;
          list.prepend(card);
        }
      },
      onStepComplete: (record) => {
        appendTrajectoryRecord(record);
      },
      onVerification: (data) => {
        appendVerificationRecord(data);
        if (data.verification.updatedPlan) {
          renderPlanBoard(data.verification.updatedPlan, data.verification.nextSubgoal, data.verification.elapsedMs);
        }
      },
      onFinish: ({ totalSteps }) => {
        setRunningState(false);
        statusText.textContent = `🎉 任务完成！共执行 ${totalSteps} 步`;
      },
      onError: (err) => {
        setRunningState(false);
        statusText.textContent = `❌ 执行中断: ${err.message}`;
      },
    });

    // Populate Settings modal fields
    settingProvider.value = config.provider || "mock";
    settingApiKey.value = config.apiKey || "";
    settingModel.value = config.model || "gemini-2.0-flash";
    settingBaseUrl.value = config.baseUrl || "https://api.openai.com/v1";
    settingZeroCot.checked = config.zeroCoT !== false;
    updateProviderVisibility(settingProvider.value);

    // Bind Controls
    btnRun.addEventListener("click", () => {
      const task = taskInput.value.trim();
      if (!task) {
        statusText.textContent = "⚠️ 请先在输入框输入任务目标";
        return;
      }
      setRunningState(true);
      controller.runTask(task);
    });

    btnPause.addEventListener("click", () => {
      if (controller.isPaused) {
        controller.resume();
        btnPause.innerHTML = '<span class="btn-icon">⏸️</span> 暂停';
      } else {
        controller.pause();
        btnPause.innerHTML = '<span class="btn-icon">▶️</span> 继续';
      }
    });

    btnStop.addEventListener("click", () => {
      controller.stop();
      setRunningState(false);
    });

    btnRefreshScan.addEventListener("click", refreshPageScan);

    btnToggleBadges.addEventListener("click", async () => {
      badgesVisible = !badgesVisible;
      btnToggleBadges.textContent = badgesVisible ? "隐藏角标" : "显示角标";
      await bridgeToPage({ action: "TOGGLE_BADGES", show: badgesVisible });
    });

    btnClearLog.addEventListener("click", () => {
      const list = getTrajectoryList();
      if (list) list.innerHTML = `<div class="empty-state">尚未开始执行</div>`;
      planSection.classList.add("hidden");
      metricLatency.textContent = "-- ms";
      metricTtft.textContent = "-- ms";
      metricTokens.textContent = "-- tok";
      logger.clear();
    });

    // Preset chips
    document.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        taskInput.value = chip.getAttribute("data-task") || "";
      });
    });

    // Model preset chips in settings
    document.querySelectorAll(".chip-model-preset").forEach((chip) => {
      chip.addEventListener("click", () => {
        const targetModel = chip.getAttribute("data-model");
        const targetBaseUrl = chip.getAttribute("data-base-url");
        const targetApiKey = chip.getAttribute("data-api-key");
        if (targetModel) {
          settingModel.value = targetModel;
          if (targetBaseUrl) settingBaseUrl.value = targetBaseUrl;
          if (targetApiKey && !settingApiKey.value) settingApiKey.value = targetApiKey;
          if (targetModel.includes("gemini")) {
            settingProvider.value = "gemini";
          } else {
            settingProvider.value = "openai";
          }
          updateProviderVisibility(settingProvider.value);
        }
      });
    });

    // Settings Modal
    btnOpenSettings.addEventListener("click", () => {
      settingsModal.classList.remove("hidden");
    });

    btnCloseSettings.addEventListener("click", () => {
      settingsModal.classList.add("hidden");
    });

    settingProvider.addEventListener("change", () => {
      updateProviderVisibility(settingProvider.value);
    });

    btnSaveSettings.addEventListener("click", async () => {
      const newCfg = {
        provider: settingProvider.value,
        apiKey: settingApiKey.value.trim(),
        model: settingModel.value.trim(),
        baseUrl: settingBaseUrl.value.trim(),
        zeroCoT: settingZeroCot.checked,
      };
      await saveConfig(newCfg);
      engine.updateConfig(newCfg);

      metricMode.textContent = newCfg.zeroCoT ? "⚡ Zero-CoT (闭思考)" : "🧠 CoT (开思考)";
      if (newCfg.zeroCoT) {
        metricMode.style.color = "#38bdf8";
        metricMode.style.borderColor = "rgba(56, 189, 248, 0.25)";
        metricMode.style.background = "rgba(56, 189, 248, 0.12)";
      } else {
        metricMode.style.color = "#f59e0b";
        metricMode.style.borderColor = "#f59e0b44";
        metricMode.style.background = "rgba(245, 158, 11, 0.12)";
      }

      settingsModal.classList.add("hidden");
      statusText.textContent = "✅ 配置已保存并实时生效";
    });

    // Audit Inspector Modal bindings
    btnOpenAudit.addEventListener("click", () => {
      renderAuditViewer();
      auditModal.classList.remove("hidden");
    });

    btnCloseAudit.addEventListener("click", () => {
      auditModal.classList.add("hidden");
    });

    // Log file export handlers
    const triggerExport = (fmt = "log") => {
      logger.downloadLogFile(fmt);
    };

    btnExportLog.addEventListener("click", () => triggerExport("log"));
    btnDownloadAudit.addEventListener("click", () => triggerExport("log"));
    btnExportLogModal.addEventListener("click", () => triggerExport("log"));

    // Auto-refresh Side Panel when switching tabs or when a tab finishes loading
    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.onActivated?.addListener(async () => {
        if (!controller || !controller.isRunning) {
          await refreshPageScan();
        }
      });
      chrome.tabs.onUpdated?.addListener(async (tabId, changeInfo) => {
        if (changeInfo.status === "complete" && (!controller || !controller.isRunning)) {
          await refreshPageScan();
        }
      });
    }

    // Initial page scan
    setTimeout(refreshPageScan, 400);
  }

  window.addEventListener("DOMContentLoaded", init);
})();
