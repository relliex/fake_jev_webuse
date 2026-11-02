/**
 * Lite-JEV: Hierarchical Cognitive Agent Controller
 * 
 * Implements the dual-system cognitive architecture:
 * 1. Startup: System-2 Deep Intent Planning (Slow thinking: understands intent, creates macro plan, issues Phase 1 sub-goal).
 * 2. Execution: Autonomous System-1 Jev Muscle Memory (Thinking OFF: 15-25ms decode, 1-4 tokens, Anti-Loop circuit breaker).
 * 3. Finalization: System-2 Deep Verification (Slow thinking: audits true completion when Jev declares FINISH. If incomplete, re-dispatches; if complete, stops).
 */

let DefaultZeroCoTEngine = null;
if (typeof window !== "undefined" && window.ZeroCoTEngine) {
  DefaultZeroCoTEngine = window.ZeroCoTEngine;
} else if (typeof require !== "undefined") {
  try {
    DefaultZeroCoTEngine = require("./zero_cot_engine.js").ZeroCoTEngine;
  } catch (_) {}
}

class AgentController {
  constructor(options = {}) {
    this.engine = options.engine || (DefaultZeroCoTEngine ? new DefaultZeroCoTEngine() : null);
    this.bridge = options.bridge || this._defaultChromeBridge.bind(this);
    this.isRunning = false;
    this.isPaused = false;
    this.currentStep = 0;
    this.maxSteps = 16;

    // Structured Agent Memory & State
    this.memory = {
      userGoal: "",
      plan: [],
      activeSubgoal: "",
      interactionHistory: [],
      pageStateHistory: [],
      excludedSlots: [],
    };

    this.callbacks = {
      onStatus: () => {},
      onPlanGenerated: () => {},
      onStepComplete: () => {},
      onVerification: () => {},
      onFinish: () => {},
      onError: () => {},
    };
  }

  setCallbacks(cbs) {
    this.callbacks = { ...this.callbacks, ...cbs };
  }

  async _defaultChromeBridge(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "BRIDGE_TO_PAGE", payload: msg },
        (res) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (res && res.error && !res.ok) return reject(new Error(res.error));
          resolve(res);
        }
      );
    });
  }

  stop() {
    this.isRunning = false;
    this.isPaused = false;
    this.callbacks.onStatus({ status: "idle", text: "已停止任务" });
  }

  pause() {
    this.isPaused = true;
    this.callbacks.onStatus({ status: "paused", text: "任务已暂停" });
  }

  resume() {
    this.isPaused = false;
    this.callbacks.onStatus({ status: "running", text: "继续执行中..." });
  }

  async runTask(taskGoal) {
    if (!taskGoal || !taskGoal.trim()) throw new Error("请输入目标任务描述");
    if (this.isRunning) return;

    this.isRunning = true;
    this.isPaused = false;
    this.currentStep = 0;

    // Initialize clean Agent Memory
    this.memory = {
      userGoal: taskGoal.trim(),
      plan: [],
      activeSubgoal: "",
      interactionHistory: [],
      pageStateHistory: [],
      excludedSlots: [],
    };

    try {
      // =======================================================================
      // PHASE 1: System-2 Initial Deep Intent Planning (慢思考理解意图并拆解计划)
      // =======================================================================
      this.callbacks.onStatus({
        status: "thinking",
        text: "🧠 [System-2 大脑]: 正在深度思考理解输入意图，拆解全局执行计划...",
      });

      const initialScan = (await this.bridge({ action: "SCAN_PAGE" })) || {};
      if (initialScan.error) {
        throw new Error(initialScan.error);
      }
      if (!initialScan.page_url && (!initialScan.elements || !Array.isArray(initialScan.elements))) {
        throw new Error("页面无法感知，请确保网页已完全加载或刷新重试");
      }

      this.memory.pageStateHistory.push({
        step: 0,
        url: initialScan.page_url,
        title: initialScan.page_title,
      });

      const planResult = await this.engine.planInitialIntent({
        taskGoal: this.memory.userGoal,
        pageTitle: initialScan.page_title,
        pageUrl: initialScan.page_url,
        elements: initialScan.elements,
      });

      this.memory.plan = planResult.plan || [];
      this.memory.activeSubgoal = planResult.activeSubgoal || this.memory.userGoal;

      this.callbacks.onPlanGenerated({
        thought: planResult.thought,
        plan: this.memory.plan,
        activeSubgoal: this.memory.activeSubgoal,
        elapsedMs: planResult.elapsedMs,
      });

      this.callbacks.onStatus({
        status: "running",
        text: `🎯 意图已规划，向肌肉记忆下发阶段指令: "${this.memory.activeSubgoal}"`,
      });

      // =======================================================================
      // PHASE 2: Autonomous Jev Muscle Memory Run (Thinking OFF, High Frequency)
      // =======================================================================
      let auditRound = 0;
      const MAX_AUDIT_ROUNDS = 2; // Allow at most 2 verification-correction loops

      while (this.isRunning && auditRound < MAX_AUDIT_ROUNDS) {
        let jevFinishedNaturally = false;

        // Loop of high-speed reflex actions
        while (this.isRunning && this.currentStep < this.maxSteps) {
          while (this.isPaused && this.isRunning) {
            await this._sleep(150);
          }
          if (!this.isRunning) break;

          this.currentStep++;
          const stepNum = this.currentStep;

          // 1. Scan live elements
          const liveScan = (await this.bridge({ action: "SCAN_PAGE" })) || initialScan;
          const elements = liveScan.elements || [];
          const pageTitle = liveScan.page_title || "";
          const pageUrl = liveScan.page_url || "";

          // 1.5. Dynamic Sub-goal & Plan Advancement (Archetype-driven progress)
          const pageArchetype = liveScan.page_archetype || this._detectPageArchetype(pageUrl, pageTitle);
          this.memory.activeSubgoal = this._resolveDynamicSubgoal(
            this.memory.userGoal,
            pageUrl,
            pageTitle,
            this.memory.interactionHistory,
            this.memory.activeSubgoal,
            liveScan
          );
          this._updatePlanMilestones(pageArchetype, pageUrl, liveScan);

          // Universal Anti-Backtracking Fuse: If on DETAIL_PAGE or LIST_PAGE, prune domain-root & home links
          const isDetailPage = pageArchetype === "DETAIL_PAGE";
          const isListPage = pageArchetype === "LIST_PAGE";
          if (isDetailPage || isListPage) {
            let hostOrigin = "";
            try { hostOrigin = new URL(pageUrl).origin; } catch (_) {}
            for (const el of elements) {
              const txt = (el.text || "").trim();
              const href = (el.href || "").trim().replace(/\/+$/, "");
              const isHomeOrBackLink =
                txt === "首页" ||
                txt === "主页" ||
                txt === "Home" ||
                txt === "新闻" ||
                (href && (href === hostOrigin || href === `${hostOrigin}/` || href.includes("baidu.com") || href.includes("google.com")));
              if (isHomeOrBackLink) {
                if (!this.memory.excludedSlots.includes(el.id)) {
                  this.memory.excludedSlots.push(el.id);
                }
              }
            }
          }

          // 2. Anti-Loop Circuit Breaker check
          const recentActions = this.memory.interactionHistory.slice(-2);
          if (recentActions.length === 2) {
            const [a1, a2] = recentActions;
            // Case A: clicked identical slot twice in same page without navigation
            if (
              a1.pageUrl === pageUrl &&
              a2.pageUrl === pageUrl &&
              a1.action.id &&
              a1.action.id === a2.action.id
            ) {
              if (!this.memory.excludedSlots.includes(a1.action.id)) {
                this.memory.excludedSlots.push(a1.action.id);
              }
            }
          }

          // 3. High-Frequency System-1 Muscle Memory (Jev Reflex)
          this.callbacks.onStatus({
            status: "acting",
            step: stepNum,
            text: `⚡ 第 ${stepNum} 步 [Jev条件反射]: 极速执行阶段指令: "${this.memory.activeSubgoal}"`,
          });

          const lastRecord = this.memory.interactionHistory[this.memory.interactionHistory.length - 1];
          const previousObservation = lastRecord?.execRes?.observation || "";

          const stepResult = await this.engine.decideSystemOneReflex({
            taskGoal: this.memory.userGoal,
            activeSubgoal: this.memory.activeSubgoal,
            pageTitle,
            pageUrl,
            elements,
            stepHistory: this.memory.interactionHistory,
            excludedSlots: this.memory.excludedSlots,
            scrollStatus: liveScan.scroll_status,
            modalStatus: liveScan.modal_status,
            previousObservation,
          });

          const { action, rawOutput, profiler } = stepResult;

          // Universal Detail Completion Safeguard: If on DETAIL_PAGE and target element is active/liked, or already clicked in history
          if (isDetailPage && action.action === "CLICK") {
            const targetEl = elements.find((e) => e.id === action.id);
            const isTargetActive = targetEl?.is_active || targetEl?.is_liked || (targetEl?.text || "").includes("已点赞") || (targetEl?.text || "").includes("已关注");
            const hasPriorDetailAction = this.memory.interactionHistory.some((h) => {
              const obs = h.execRes?.observation || "";
              return (obs.includes("点赞") || obs.includes("成功点击") || obs.includes("已激活")) && isDetailPage;
            });
            if (isTargetActive || hasPriorDetailAction) {
              action.action = "FINISH";
              action.msg = "目标详情页核心交互已呈现激活完成状态，全流程圆满达成";
            }
          }

          // If Jev declares FINISH, break to System-2 verification immediately
          if (action.action === "FINISH") {
            jevFinishedNaturally = true;
            this.callbacks.onStatus({
              status: "running",
              step: stepNum,
              text: `⚡ Jev肌肉记忆认为目标已达成，准备唤醒 System-2 大脑深度复核...`,
            });
            break;
          }

          // 4. Highlight Spotlight on target
          if (action.id && !action.id.startsWith("KEY_")) {
            await this.bridge({
              action: "HOVER_ELEMENT",
              element_id: action.id,
              label: `⚡ 肌肉记忆 [${action.id}]`,
            });
            await this._sleep(120);
          }

          // 5. Execute Action on live page
          const execRes = await this.bridge({
            action: "EXECUTE_ACTION",
            payload: action,
          });

          await this.bridge({ action: "CLEAR_HOVER" });

          // Record into Context Memory Stream
          let urlShort = "当前页";
          try { urlShort = new URL(pageUrl).hostname; } catch (_) {}

          const stepRecord = {
            step: stepNum,
            action,
            execRes,
            profiler,
            rawOutput,
            pageTitle,
            pageUrl,
            urlShort,
            subgoalAtStep: this.memory.activeSubgoal,
          };

          this.memory.interactionHistory.push(stepRecord);
          this.callbacks.onStepComplete(stepRecord);

          // Wait for page reaction / navigation
          if (action.action === "GOTO" || action.action === "NAVIGATE") {
            await this._sleep(1500);
            this.memory.excludedSlots = []; // reset excluded slots after navigating
          } else if (action.action === "TYPE_AND_ENTER" || action.enter || action.action === "CLICK" || action.action === "CLEAR_TYPE") {
            await this._sleep(1200);
          } else {
            await this._sleep(500);
          }
        }

        if (!this.isRunning) break;

        // =======================================================================
        // PHASE 3: System-2 Final Deep Verification (终局慢思考确认真的完成才可以停)
        // =======================================================================
        auditRound++;
        this.callbacks.onStatus({
          status: "verifying",
          step: this.currentStep,
          text: `🧠 [System-2 大脑第 ${auditRound} 轮复核]: 正在深度审查全流程真实完成度...`,
        });

        const finalScan = (await this.bridge({ action: "SCAN_PAGE" })) || {};
        const verRes = await this.engine.verifyCompletionAndGuide({
          taskGoal: this.memory.userGoal,
          plan: this.memory.plan,
          interactionHistory: this.memory.interactionHistory,
          currentUrl: finalScan.page_url || "",
          pageTitle: finalScan.page_title || "",
          elements: finalScan.elements || [],
          isVideoLiked: finalScan.is_video_liked || (finalScan.elements || []).some((e) => e.is_liked),
        });

        this.callbacks.onVerification({
          step: this.currentStep,
          verification: verRes,
        });

        if (verRes.isCompleted) {
          this.callbacks.onStatus({
            status: "finished",
            step: this.currentStep,
            text: `🎉 System-2 大脑深度审查确认：任务真实圆满完成！(${verRes.reasoning || ""})`,
          });
          break;
        } else {
          // If not completed, re-dispatch active sub-goal and continue muscle memory
          if (verRes.nextSubgoal) {
            this.memory.activeSubgoal = verRes.nextSubgoal;
          }
          this.callbacks.onStatus({
            status: "running",
            step: this.currentStep,
            text: `⚠️ System-2 审查发现未完成 (${verRes.reasoning}) -> 纠偏重新发布指令: "${this.memory.activeSubgoal}"`,
          });
          await this._sleep(1000);
        }
      }

      this.isRunning = false;
      this.callbacks.onFinish({
        totalSteps: this.memory.interactionHistory.length,
        memory: this.memory,
      });
    } catch (err) {
      this.isRunning = false;
      this.callbacks.onError(err);
      this.callbacks.onStatus({
        status: "error",
        text: `执行异常: ${err.message || String(err)}`,
      });
    }
  }

  /**
   * Universal Page Archetype Detector (Harness Perception)
   */
  _detectPageArchetype(pageUrl = "", pageTitle = "") {
    let urlObj;
    try {
      urlObj = new URL(pageUrl);
    } catch (_) {
      return "GENERIC_PAGE";
    }
    const host = urlObj.hostname.toLowerCase();
    const path = urlObj.pathname.toLowerCase();
    const search = urlObj.search.toLowerCase();

    // 0. New Tab / Empty / Internal Browser Page
    if (
      host.includes("newtab") ||
      path.includes("newtab") ||
      pageUrl.startsWith("chrome:") ||
      pageUrl.startsWith("edge:") ||
      pageUrl === "about:blank" ||
      !pageUrl.startsWith("http")
    ) {
      return "NEW_TAB_PAGE";
    }

    // 1. Search Engine Home vs Results
    const isSearchEngine = host.includes("baidu.com") || host.includes("google.com") || host.includes("bing.com") || host.includes("sogou.com");
    if (isSearchEngine) {
      if (path.includes("/s") || search.includes("wd=") || search.includes("q=")) {
        return "SEARCH_RESULTS";
      }
      return "SEARCH_ENGINE_HOME";
    }

    // 2. Generic Search Results
    if (path.includes("/search") || path.includes("/find") || search.includes("keyword=") || search.includes("query=")) {
      return "SEARCH_RESULTS";
    }

    // 3. Detail Page (Video, Item, Product, Article, Watch, etc.)
    if (
      path.includes("/video/") ||
      path.includes("/item/") ||
      path.includes("/detail") ||
      path.includes("/watch") ||
      path.includes("/article/") ||
      path.includes("/p/") ||
      path.includes("/product/") ||
      path.includes("/goods/") ||
      path.includes("/read/")
    ) {
      return "DETAIL_PAGE";
    }

    // 4. List / Category / Ranking / Hot Page
    if (
      path.includes("/ranking") ||
      path.includes("/popular") ||
      path.includes("/hot") ||
      path.includes("/top") ||
      path.includes("/list") ||
      path.includes("/category") ||
      path.includes("/board") ||
      path.includes("/explore")
    ) {
      return "LIST_PAGE";
    }

    // 5. Portal / Domain Home
    if (path === "/" || path === "" || path.endsWith("/index.html") || path.endsWith("/index.htm")) {
      return "PORTAL_HOME";
    }

    return "GENERIC_PAGE";
  }

  /**
   * Identifies target platform from task goal or engine
   */
  _inferTargetPlatform(taskGoal) {
    if (this.engine && typeof this.engine._inferTargetPlatform === "function") {
      return this.engine._inferTargetPlatform(taskGoal);
    }
    if (!taskGoal) return null;
    const lower = taskGoal.toLowerCase();

    // Prioritize initial starting platform if explicitly requested
    if (lower.includes("首先打开百度") || lower.includes("先打开百度") || lower.includes("打开百度") || lower.includes("从百度")) {
      return { names: ["百度", "baidu"], url: "https://www.baidu.com", name: "百度" };
    }
    if (lower.includes("首先打开谷歌") || lower.includes("先打开谷歌") || lower.includes("从谷歌")) {
      return { names: ["谷歌", "google"], url: "https://www.google.com", name: "Google" };
    }

    const knownSites = [
      { names: ["哔哩哔哩", "b站", "bilibili"], url: "https://www.bilibili.com", name: "哔哩哔哩" },
      { names: ["百度", "baidu"], url: "https://www.baidu.com", name: "百度" },
      { names: ["去哪儿", "qunar"], url: "https://flight.qunar.com", name: "去哪儿" },
      { names: ["携程", "ctrip"], url: "https://www.ctrip.com", name: "携程" },
      { names: ["知乎", "zhihu"], url: "https://www.zhihu.com", name: "知乎" },
      { names: ["京东", "jd"], url: "https://www.jd.com", name: "京东" },
      { names: ["淘宝", "taobao"], url: "https://www.taobao.com", name: "淘宝" },
      { names: ["微博", "weibo"], url: "https://weibo.com", name: "微博" },
      { names: ["github"], url: "https://github.com", name: "GitHub" },
      { names: ["谷歌", "google"], url: "https://www.google.com", name: "Google" },
    ];
    for (const site of knownSites) {
      if (site.names.some((n) => lower.includes(n))) {
        return site;
      }
    }
    return null;
  }

  /**
   * Plan Progression Engine: Updates structured plan milestone statuses dynamically
   */
  _updatePlanMilestones(pageArchetype, pageUrl, liveScan = {}) {
    if (!Array.isArray(this.memory.plan) || this.memory.plan.length === 0) return;
    const isDetail = pageArchetype === "DETAIL_PAGE";
    const isList = pageArchetype === "LIST_PAGE";
    const isPortal = pageArchetype === "PORTAL_HOME";
    const hasActive = liveScan?.is_video_liked || liveScan?.has_active_action || (liveScan?.elements || []).some((e) => e.is_active || e.is_liked);

    this.memory.plan.forEach((item, idx) => {
      if (isDetail) {
        if (idx < this.memory.plan.length - 1) {
          item.status = "completed";
        } else {
          item.status = hasActive ? "completed" : "in_progress";
        }
      } else if (isList) {
        if (idx < 2) {
          item.status = "completed";
        } else if (idx === 2) {
          item.status = "in_progress";
        }
      } else if (isPortal) {
        if (idx === 0) {
          item.status = "completed";
        } else if (idx === 1) {
          item.status = "in_progress";
        }
      }
    });
  }

  /**
   * Universal Dynamic Sub-goal Advancement (Archetype-driven Progression Engine)
   */
  _resolveDynamicSubgoal(userGoal, pageUrl, pageTitle, history = [], currentSubgoal = "", liveScan = {}) {
    const goal = userGoal || "";
    const archetype = liveScan?.page_archetype || this._detectPageArchetype(pageUrl, pageTitle);
    const targetPlatform = this._inferTargetPlatform(goal);
    const isLikeGoal = goal.includes("点赞") || goal.includes("喜欢");
    const isVideoGoal = goal.includes("视频") || goal.includes("播放") || isLikeGoal;
    const isFlightGoal = goal.includes("航班") || goal.includes("机票") || goal.includes("去哪儿");

    // 0. NEW_TAB_PAGE Archetype
    if (archetype === "NEW_TAB_PAGE" || !pageUrl || pageUrl.includes("newtab") || pageUrl === "about:blank" || !pageUrl.startsWith("http")) {
      const destSite = targetPlatform || { name: "百度", url: "https://www.baidu.com" };
      return `【新标签页启航】直接使用 GOTO ${destSite.url} 导航进入 ${destSite.name}，开始执行任务！`;
    }

    // 1. DETAIL_PAGE Archetype
    if (archetype === "DETAIL_PAGE") {
      const isLikedNow = liveScan?.is_video_liked || (liveScan?.elements || []).some((e) => e.is_liked || (e.text || "").includes("已点赞"));
      const hasLikedInHistory = history.some((h) => {
        const obs = h.execRes?.observation || "";
        return obs.includes("点赞") && (h.pageUrl || "").includes("/video/");
      });
      if (isLikedNow || hasLikedInHistory) {
        return "【已确认点赞成功】当前视频播放页已呈现高亮已点赞状态，任务已圆满达成，立即输出 FINISH！绝不要重复点击点赞！";
      }
      const hasActive = liveScan?.has_active_action || (liveScan?.elements || []).some((e) => e.is_active || (e.text || "").includes("已激活"));
      if (hasActive) {
        return "【已确认操作成功】当前页面关键交互已处于激活完成状态，任务已圆满达成，立即输出 FINISH！绝不要重复点击！";
      }
      if (isVideoGoal || isLikeGoal) {
        return "【已进入视频播放页】点击操作栏中的【点赞】按钮完成点赞，完成后输出 FINISH！绝不要点击首页！";
      }
      return "【已进入详情页】点击页面核心操作按钮完成业务交互，完成后输出 FINISH！绝不要点击首页！";
    }

    // 2. LIST_PAGE Archetype (Ranking, Popular, Hot, Category List)
    if (archetype === "LIST_PAGE") {
      if (isVideoGoal || goal.includes("热度第一") || goal.includes("排行榜") || goal.includes("热门")) {
        return "【已进入热门排行榜】点击排行榜中热度第一的视频封面或标题进入播放页！";
      }
      return "【已进入列表页】在当前列表中定位并点击目标首选条目进入详情页！";
    }

    // 3. PORTAL_HOME Archetype
    if (archetype === "PORTAL_HOME") {
      let isTargetDomain = false;
      if (targetPlatform) {
        try {
          isTargetDomain = pageUrl.includes(new URL(targetPlatform.url).hostname);
        } catch (_) {}
      }
      if (isTargetDomain || !targetPlatform) {
        if (targetPlatform && targetPlatform.name === "哔哩哔哩") {
          return "【已进入哔哩哔哩首页】点击顶部导航的‘热门’或‘排行榜’链接进入热门列表！";
        }
        if (isFlightGoal) {
          return "【已进入机票查询服务】定位出发城市输入框输入‘北京’，目的城市输入‘东京’，点击立即搜索航班！";
        }
        if (goal.includes("热门") || goal.includes("排行榜")) {
          const siteName = targetPlatform?.name || "官网";
          return `【已进入${siteName}首页】点击顶部导航的‘热门’或‘排行榜’链接进入热门列表！`;
        }
        return `【已进入${targetPlatform?.name || "官网"}首页】定位顶部导航、推荐分类或站内搜索入口！`;
      }
      // If on an unrelated portal home
      if (targetPlatform) {
        return `【目标直达】直接使用 GOTO ${targetPlatform.url} 导航进入 ${targetPlatform.name} 官网，避免在当前页面闲逛！`;
      }
    }

    // 4. SEARCH_RESULTS Archetype
    if (archetype === "SEARCH_RESULTS") {
      if (targetPlatform) {
        return `【搜索结果已就绪】在搜索结果列表中点击‘${targetPlatform.name}官网’链接进入！或使用 GOTO ${targetPlatform.url} 直达！`;
      }
      if (isFlightGoal) {
        return "【搜索结果已就绪】在搜索结果列表中点击机票/航班查询官方入口进入！";
      }
      return "【搜索结果已就绪】在搜索结果列表中点击最相关的官方网站链接进入！";
    }

    // 5. SEARCH_ENGINE_HOME Archetype
    if (archetype === "SEARCH_ENGINE_HOME") {
      if (targetPlatform) {
        return `【目标直达】直接使用 GOTO ${targetPlatform.url} 导航进入 ${targetPlatform.name} 官网，避免在当前页面闲逛！`;
      }
      if (isFlightGoal) {
        return "【搜索机票】在输入框填入‘北京到东京机票’并提交，或使用 GOTO https://flight.qunar.com 直达！";
      }
      return "【搜索就绪】在搜索框中填入关键词并提交搜索！";
    }

    // 6. Generic or external page
    if (targetPlatform && !pageUrl.includes(new URL(targetPlatform.url).hostname)) {
      return `【目标直达】直接使用 GOTO ${targetPlatform.url} 导航进入 ${targetPlatform.name} 官网，避免在当前页面闲逛！`;
    }

    return currentSubgoal || userGoal;
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

if (typeof window !== "undefined") {
  window.AgentController = AgentController;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { AgentController };
}
