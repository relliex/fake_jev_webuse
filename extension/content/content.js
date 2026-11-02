/**
 * Lite-JEV: Professional Browser Agent Runtime Content Script & Execution Harness
 * 
 * Capabilities:
 * 1. Comprehensive Tool Execution Engine:
 *    - GOTO, CLICK, TYPE, CLEAR_TYPE, HOVER, PRESS, SCROLL, WAIT, GO_BACK, CLOSE_MODAL, EXTRACT, FINISH
 * 2. Perception Harness:
 *    - Full DOM Interactive Elements Scanner with semantic categorization & priority boosting
 *    - Viewport Scroll Tracking (percentage & reach)
 *    - Active Modal/Popup/Overlay Detection
 *    - Focused element detection
 * 3. Execution & Settling Harness:
 *    - Realistic Pointer & Keyboard event lifecycles
 *    - Smart modal dismisser
 *    - Detailed post-action observation feedback
 * 4. Single-Tab Enforcement (no popups spawning background tabs)
 */

(function () {
  if (window.__LITE_JEV_INJECTED__) {
    return;
  }
  window.__LITE_JEV_INJECTED__ = true;

  const OVERLAY_CONTAINER_ID = "lite-jev-overlay-container";
  const INTERACTIVE_SELECTORS = [
    "a[href]",
    "button",
    "input",
    "textarea",
    "select",
    "[role='button']",
    "[role='link']",
    "[role='checkbox']",
    "[role='searchbox']",
    "[role='combobox']",
    "[tabindex]:not([tabindex='-1'])",
    "[contenteditable='true']",
    ".btn",
    ".button",
    "[class*='like']",
    "[class*='zan']",
    "[class*='coin']",
    "[class*='fav']",
    "[class*='toolbar-item']",
    "[aria-label*='赞']",
    "[title*='赞']",
    "[onclick]"
  ].join(",");

  const MAX_SCAN_ELEMENTS = 48;
  const elementNodeMap = new Map();
  let showBadges = true;
  let activeHoverState = null;
  let lastInteractedNode = null;

  // =========================================================================
  // 1. Single-Tab Enforcement
  // =========================================================================
  function enforceSingleTab() {
    try {
      const links = document.querySelectorAll("a[target='_blank'], a[target='_new']");
      for (const link of links) {
        link.setAttribute("target", "_self");
        link.removeAttribute("rel");
      }
    } catch (_) {}
  }

  window.addEventListener("click", (e) => {
    const targetLink = e.target.closest ? e.target.closest("a") : null;
    if (targetLink && targetLink.getAttribute("target") === "_blank") {
      targetLink.setAttribute("target", "_self");
    }
  }, true);

  const observer = new MutationObserver(() => {
    enforceSingleTab();
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
    enforceSingleTab();
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      observer.observe(document.body, { childList: true, subtree: true });
      enforceSingleTab();
    });
  }

  // =========================================================================
  // 2. Perception Harness: Modal, Scroll & Environment Sensing
  // =========================================================================
  function detectModalState() {
    const modalSelectors = [
      "[role='dialog']",
      "[aria-modal='true']",
      ".modal.show",
      ".modal-open",
      ".bili-mini-mask",
      ".login-modal",
      ".passport-login-container",
      ".dialog-mask",
      ".popup-mask",
      "[class*='modal-overlay']",
      "[class*='dialog-overlay']"
    ];

    for (const sel of modalSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el && isElementVisible(el)) {
          const closeBtn = el.querySelector(".close, [aria-label*='close'], [aria-label*='关闭'], .icon-close, svg");
          return {
            hasModal: true,
            modalName: sel,
            hasCloseButton: !!closeBtn,
          };
        }
      } catch (_) {}
    }
    return { hasModal: false, modalName: null, hasCloseButton: false };
  }

  function getScrollStatus() {
    const docElem = document.documentElement;
    const body = document.body || {};
    const scrollTop = window.scrollY || docElem.scrollTop || body.scrollTop || 0;
    const scrollHeight = Math.max(docElem.scrollHeight, body.scrollHeight || 0, window.innerHeight);
    const clientHeight = window.innerHeight || docElem.clientHeight || 1;

    const maxScroll = Math.max(1, scrollHeight - clientHeight);
    const percent = Math.min(100, Math.round((scrollTop / maxScroll) * 100));

    let desc = "顶部 (0%)";
    if (percent >= 90) desc = `已到底部 (${percent}%)`;
    else if (percent > 10) desc = `页面中段 (${percent}%)`;

    return {
      scrollTop: Math.round(scrollTop),
      scrollHeight: Math.round(scrollHeight),
      percent,
      description: desc,
    };
  }

  function detectPageArchetype() {
    const loc = window.location;
    const path = loc.pathname.toLowerCase();
    const host = loc.hostname.toLowerCase();
    const search = loc.search.toLowerCase();

    // 0. New Tab / Empty / Local Browser Page
    if (
      host.includes("newtab") ||
      path.includes("newtab") ||
      loc.protocol === "chrome:" ||
      loc.protocol === "edge:" ||
      loc.href === "about:blank"
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

    // 3. Detail Page (Video, Product, Article, User Profile)
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

  function isNodeActiveOrSelected(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    const className = (node.className || "").toString().toLowerCase();
    const ariaPressed = node.getAttribute("aria-pressed");
    const ariaSelected = node.getAttribute("aria-selected");
    const ariaChecked = node.getAttribute("aria-checked");
    const dataActive = node.getAttribute("data-active");

    if (ariaPressed === "true" || ariaSelected === "true" || ariaChecked === "true" || dataActive === "true") {
      return true;
    }

    const activeKeywords = ["on", "active", "selected", "checked", "liked", "is-active", "is-selected", "is-liked", "current"];
    for (const kw of activeKeywords) {
      if (node.classList && node.classList.contains(kw)) return true;
    }

    if (node.querySelector && node.querySelector(".on, .active, [class*='liked'], [aria-pressed='true']")) {
      return true;
    }

    try {
      const compColor = window.getComputedStyle(node).color;
      if (compColor && (compColor.includes("0, 174, 236") || compColor.includes("0, 161, 214") || compColor.includes("59, 130, 246"))) {
        return true;
      }
    } catch (_) {}

    return false;
  }

  function isElementVisible(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const style = window.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0" ||
      style.pointerEvents === "none"
    ) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 3 || rect.height <= 3) return false;
    return true;
  }

  function isElementInViewport(rect) {
    const vWidth = window.innerWidth || document.documentElement.clientWidth;
    const vHeight = window.innerHeight || document.documentElement.clientHeight;
    return (
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < vHeight &&
      rect.left < vWidth
    );
  }

  function getNodePriorityScore(node) {
    let score = 0;
    const tag = (node.tagName || "").toLowerCase();
    const type = (node.getAttribute("type") || "").toLowerCase();
    const role = (node.getAttribute("role") || "").toLowerCase();
    const className = (node.className || "").toString().toLowerCase();
    const title = (node.getAttribute("title") || "").toLowerCase();
    const aria = (node.getAttribute("aria-label") || "").toLowerCase();

    // Critical high-priority action elements (Like, Coin, Favorite, Submit)
    if (className.includes("like") || className.includes("zan") || title.includes("赞") || aria.includes("赞")) {
      score += 70; // Extremely high priority for like button
    }
    if (className.includes("coin") || className.includes("fav")) score += 45;
    if (tag === "input" && !["hidden", "checkbox", "radio"].includes(type)) score += 40;
    if (tag === "textarea" || node.getAttribute("contenteditable") === "true") score += 40;
    if (tag === "button" || type === "submit" || role === "button") score += 30;
    if (node.id === "su" || node.id === "search_button") score += 35; // Baidu/Search Engine submit
    if (tag === "a" || role === "link") score += 15;
    return score;
  }

  function extractElementInfo(node, id, inViewport) {
    const rect = node.getBoundingClientRect();
    const tag = (node.tagName || "").toLowerCase();
    const type = (node.getAttribute("type") || "").toLowerCase();
    const className = (node.className || "").toString().toLowerCase();

    let text = (node.innerText || node.textContent || "").trim().replace(/\s+/g, " ");
    if (text.length > 60) text = text.slice(0, 58) + "...";

    const placeholder = (node.getAttribute("placeholder") || "").trim();
    const ariaLabel = (node.getAttribute("aria-label") || "").trim();
    const title = (node.getAttribute("title") || "").trim();
    const value = node.value !== undefined ? String(node.value).trim() : "";
    const href = node.getAttribute("href") || "";

    // Determine semantic category
    let category = "控件";
    const isLikeElement =
      className.includes("like") ||
      className.includes("zan") ||
      title.includes("赞") ||
      ariaLabel.includes("赞");

    let isLikedState = false;
    const isGenericActive = isNodeActiveOrSelected(node);

    if (isLikeElement) {
      category = "按钮";
      isLikedState = isGenericActive;

      if (!text || /^\d+$/.test(text)) {
        text = text ? `点赞 (${text})` : "点赞";
      }
      if (isLikedState) {
        text = `${text} [已点赞完成]`;
      }
    } else if (tag === "input" || tag === "textarea" || node.getAttribute("contenteditable") === "true") {
      if (["submit", "button"].includes(type)) {
        category = "提交按钮";
      } else {
        category = "输入框";
      }
    } else if (tag === "button" || type === "submit" || node.getAttribute("role") === "button") {
      category = "按钮";
      if (isGenericActive && !text.includes("已")) {
        text = `${text} [已激活/已选择]`;
      }
    } else if (tag === "a" || node.getAttribute("role") === "link") {
      category = "链接";
      if (isGenericActive) {
        text = `${text} [当前选中]`;
      }
    }

    return {
      id,
      tag,
      type,
      category,
      text,
      is_liked: isLikedState,
      is_active: isGenericActive || isLikedState,
      placeholder,
      aria_label: ariaLabel,
      title,
      value: value.length > 40 ? value.slice(0, 38) + "..." : value,
      href: href.startsWith("http") || href.startsWith("/") ? href : "",
      inViewport,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  }

  function areRectsOverlapping(r1, r2) {
    const overlapX = Math.max(0, Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left));
    const overlapY = Math.max(0, Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top));
    const overlapArea = overlapX * overlapY;
    const minArea = Math.min(r1.width * r1.height, r2.width * r2.height);
    return minArea > 0 && overlapArea / minArea > 0.85;
  }

  /**
   * Recursively discovers interactive elements in document, Shadow DOM, and same-origin iframes
   */
  function collectAllInteractiveNodes(root = document, results = [], depth = 0) {
    if (depth > 5) return results;
    try {
      const nodes = root.querySelectorAll(INTERACTIVE_SELECTORS);
      for (const n of nodes) results.push(n);

      const all = root.querySelectorAll("*");
      for (const el of all) {
        if (el.shadowRoot) {
          collectAllInteractiveNodes(el.shadowRoot, results, depth + 1);
        }
        if (el.tagName === "IFRAME") {
          try {
            if (el.contentDocument) {
              collectAllInteractiveNodes(el.contentDocument, results, depth + 1);
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
    return results;
  }

  function scanInteractiveElements() {
    elementNodeMap.clear();
    enforceSingleTab();

    const rawNodes = collectAllInteractiveNodes(document);
    const candidates = [];

    for (const node of rawNodes) {
      if (!isElementVisible(node)) continue;
      const rect = node.getBoundingClientRect();
      candidates.push({
        node,
        rect,
        inViewport: isElementInViewport(rect),
        priority: getNodePriorityScore(node),
      });
    }

    // Deduplicate nested / overlapping redundant nodes
    const deduplicated = [];
    for (const item of candidates) {
      let duplicateIdx = -1;
      for (let i = 0; i < deduplicated.length; i++) {
        const existing = deduplicated[i];
        if (
          areRectsOverlapping(item.rect, existing.rect) ||
          ((existing.node.contains(item.node) || item.node.contains(existing.node)) &&
            Math.abs(item.rect.top - existing.rect.top) <= 8 &&
            Math.abs(item.rect.left - existing.rect.left) <= 10)
        ) {
          duplicateIdx = i;
          break;
        }
      }

      if (duplicateIdx === -1) {
        deduplicated.push(item);
      } else if (item.priority > deduplicated[duplicateIdx].priority) {
        deduplicated[duplicateIdx] = item;
      }
    }

    // Sort: 1) inViewport first; 2) Crucial actions (Like, Inputs, Buttons) float up; 3) top-to-bottom
    deduplicated.sort((a, b) => {
      if (a.inViewport !== b.inViewport) return a.inViewport ? -1 : 1;
      const aIsCrucial = a.priority >= 35;
      const bIsCrucial = b.priority >= 35;
      if (aIsCrucial !== bIsCrucial) return aIsCrucial ? -1 : 1;

      const bandDiff = Math.round(a.rect.top / 16) - Math.round(b.rect.top / 16);
      if (bandDiff !== 0) return bandDiff;
      return a.rect.left - b.rect.left;
    });

    const results = [];
    let counter = 1;
    for (const item of deduplicated) {
      const info = extractElementInfo(item.node, `E${counter}`, item.inViewport);
      if (
        !info.text &&
        !info.aria_label &&
        !info.placeholder &&
        !info.title &&
        !info.href &&
        !["input", "textarea", "select", "button"].includes(info.tag)
      ) {
        continue;
      }
      const id = `E${counter++}`;
      info.id = id;
      item.node.setAttribute("data-lite-jev-id", id);
      elementNodeMap.set(id, item.node);
      results.push(info);

      if (results.length >= MAX_SCAN_ELEMENTS) break;
    }

    renderBadges();

    const scrollStatus = getScrollStatus();
    const modalStatus = detectModalState();
    const pageArchetype = detectPageArchetype();
    const hasLikedButton = results.some((el) => el.is_liked);
    const hasActiveAction = results.some((el) => el.is_active);
    const isVideoPage = pageArchetype === "DETAIL_PAGE" || window.location.pathname.includes("/video/");

    return {
      page_url: window.location.href,
      page_title: document.title || window.location.hostname,
      page_archetype: pageArchetype,
      scroll_status: scrollStatus,
      modal_status: modalStatus,
      is_video_page: isVideoPage,
      is_video_liked: hasLikedButton,
      has_active_action: hasActiveAction,
      elements: results,
    };
  }

  function getNodeById(elementId) {
    if (!elementId) return null;
    if (elementNodeMap.has(elementId)) {
      const el = elementNodeMap.get(elementId);
      if (el && el.isConnected) return el;
    }
    const queried = document.querySelector(`[data-lite-jev-id="${CSS.escape(elementId)}"]`);
    if (queried) {
      elementNodeMap.set(elementId, queried);
      return queried;
    }
    return null;
  }

  // =========================================================================
  // 3. High-Contrast Overlay Badges & Neon Spotlight
  // =========================================================================
  function ensureOverlayRoot() {
    let container = document.getElementById(OVERLAY_CONTAINER_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = OVERLAY_CONTAINER_ID;
      (document.documentElement || document.body).appendChild(container);
    }
    return container;
  }

  function renderBadges() {
    const root = ensureOverlayRoot();
    root.innerHTML = "";

    if (showBadges) {
      for (const [id, node] of elementNodeMap.entries()) {
        if (!node || !node.isConnected || !isElementVisible(node)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) continue;

        const box = document.createElement("div");
        box.className = "lite-jev-candidate-box";
        box.style.top = `${rect.top + window.scrollY}px`;
        box.style.left = `${rect.left + window.scrollX}px`;
        box.style.width = `${rect.width}px`;
        box.style.height = `${rect.height}px`;

        const badge = document.createElement("div");
        badge.className = "lite-jev-badge";
        badge.textContent = id;
        badge.style.top = `${Math.max(0, rect.top + window.scrollY - 10)}px`;
        badge.style.left = `${Math.max(0, rect.left + window.scrollX - 4)}px`;

        root.appendChild(box);
        root.appendChild(badge);
      }
    }

    if (activeHoverState && activeHoverState.element_id) {
      const node = getNodeById(activeHoverState.element_id);
      if (node && node.isConnected && isElementVisible(node)) {
        const rect = node.getBoundingClientRect();
        const spot = document.createElement("div");
        spot.className = "lite-jev-spotlight";
        spot.style.top = `${rect.top + window.scrollY - 4}px`;
        spot.style.left = `${rect.left + window.scrollX - 4}px`;
        spot.style.width = `${rect.width + 8}px`;
        spot.style.height = `${rect.height + 8}px`;

        const tag = document.createElement("div");
        tag.className = "lite-jev-spotlight-tag";
        tag.textContent = activeHoverState.label || `⚡ [${activeHoverState.element_id}]`;
        tag.style.top = `${Math.max(0, rect.top + window.scrollY - 24)}px`;
        tag.style.left = `${Math.max(0, rect.left + window.scrollX)}px`;

        root.appendChild(spot);
        root.appendChild(tag);
      }
    }
  }

  function setHoverHighlight(elementId, labelText) {
    const node = getNodeById(elementId);
    if (!node) return { ok: false, error: `Element [${elementId}] not found` };

    const rect = node.getBoundingClientRect();
    if (rect.top < 40 || rect.bottom > window.innerHeight - 40) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    activeHoverState = {
      element_id: elementId,
      label: labelText || `🎯 目标 [${elementId}]`,
    };
    renderBadges();
    return { ok: true };
  }

  function clearHoverHighlight() {
    activeHoverState = null;
    renderBadges();
    return { ok: true };
  }

  function showActionFlash(node) {
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const root = ensureOverlayRoot();
    const flash = document.createElement("div");
    flash.className = "lite-jev-action-flash";
    flash.style.top = `${rect.top + window.scrollY - 3}px`;
    flash.style.left = `${rect.left + window.scrollX - 3}px`;
    flash.style.width = `${rect.width + 6}px`;
    flash.style.height = `${rect.height + 6}px`;
    root.appendChild(flash);
    setTimeout(() => flash.remove(), 550);
  }

  // =========================================================================
  // 4. Complete Action Execution Engine (Agent Toolset Implementation)
  // =========================================================================
  function setInputValue(node, text) {
    if (!node) return;
    const tag = (node.tagName || "").toLowerCase();
    node.focus();

    if (node.getAttribute("contenteditable") === "true") {
      node.innerText = text;
      node.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    const proto =
      tag === "textarea" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (nativeSetter) {
      nativeSetter.call(node, text);
    } else {
      node.value = text;
    }

    node.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: text.slice(-1) }));
    node.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    node.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    node.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: text.slice(-1) }));
  }

  function triggerSearchOrEnter(targetNode) {
    const el = targetNode || lastInteractedNode || document.activeElement || document.body;
    if (el && el.focus) el.focus();

    const ev = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", ev));
    el.dispatchEvent(new KeyboardEvent("keypress", ev));
    el.dispatchEvent(new KeyboardEvent("keyup", ev));

    const knownSearchBtns = [
      document.getElementById("su"),
      document.getElementById("sb_form_go"),
      document.querySelector('input[type="submit"]'),
      document.querySelector('button[type="submit"]'),
      document.querySelector('#search_button'),
      document.querySelector('[aria-label*="百度一下"]'),
      document.querySelector('[aria-label*="搜索"]'),
      document.querySelector('.search-button'),
    ].filter(Boolean);

    if (knownSearchBtns.length > 0 && typeof knownSearchBtns[0].click === "function") {
      setTimeout(() => {
        try { knownSearchBtns[0].click(); } catch (_) {}
      }, 100);
      return;
    }

    const form = el.closest ? el.closest("form") : null;
    if (form) {
      if (typeof form.requestSubmit === "function") {
        try { form.requestSubmit(); } catch { form.submit(); }
      } else {
        form.submit();
      }
    }
  }

  function simulateRealisticClick(node) {
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const mouseOpts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: cx,
      clientY: cy,
    };

    try { node.dispatchEvent(new PointerEvent("pointerdown", mouseOpts)); } catch (_) {}
    node.dispatchEvent(new MouseEvent("mousedown", mouseOpts));
    if (node.focus) node.focus();
    try { node.dispatchEvent(new PointerEvent("pointerup", mouseOpts)); } catch (_) {}
    node.dispatchEvent(new MouseEvent("mouseup", mouseOpts));
    node.click();
  }

  function simulateHover(node) {
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
    try { node.dispatchEvent(new PointerEvent("pointerenter", opts)); } catch (_) {}
    try { node.dispatchEvent(new PointerEvent("pointerover", opts)); } catch (_) {}
    node.dispatchEvent(new MouseEvent("mouseenter", opts));
    node.dispatchEvent(new MouseEvent("mouseover", opts));
    node.dispatchEvent(new MouseEvent("mousemove", opts));
  }

  function triggerModalDismiss() {
    // 1. Try finding close buttons
    const closeSelectors = [
      "[aria-label*='close']",
      "[aria-label*='关闭']",
      ".close",
      ".btn-close",
      ".modal-close",
      ".dialog-close",
      ".bili-mini-close-icon",
      ".icon-close",
      "[class*='close-icon']"
    ];

    for (const sel of closeSelectors) {
      const btn = document.querySelector(sel);
      if (btn && isElementVisible(btn)) {
        simulateRealisticClick(btn);
        return { ok: true, action: "CLOSE_MODAL", observation: `已点击弹窗关闭按钮 (${sel})` };
      }
    }

    // 2. Dispatch ESC key to dismiss modal
    const ev = { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true };
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", ev));
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keyup", ev));
    return { ok: true, action: "CLOSE_MODAL", observation: "已按下 Escape 键尝试清退弹窗或遮罩" };
  }

  async function executeAction(payload) {
    const { action, id, value, enter, key, url, amount } = payload;

    // Tool 1: GOTO (Direct URL Navigation)
    if (action === "GOTO" || action === "NAVIGATE") {
      let targetUrl = url || value || id;
      if (targetUrl) {
        if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
          targetUrl = "https://" + targetUrl;
        }
        window.location.href = targetUrl;
        return { ok: true, action: "GOTO", url: targetUrl, observation: `正在直接跳转至网址: ${targetUrl}` };
      }
      return { ok: false, error: "GOTO 工具缺失目标 URL" };
    }

    // Tool 2: GO_BACK
    if (action === "GO_BACK" || action === "BACK") {
      window.history.back();
      return { ok: true, action: "GO_BACK", observation: "已执行浏览器后退" };
    }

    // Tool 3: REFRESH
    if (action === "REFRESH" || action === "RELOAD") {
      window.location.reload();
      return { ok: true, action: "REFRESH", observation: "已刷新当前网页" };
    }

    // Tool 4: CLOSE_MODAL
    if (action === "CLOSE_MODAL") {
      const res = triggerModalDismiss();
      setTimeout(scanInteractiveElements, 400);
      return res;
    }

    // Tool 5: WAIT
    if (action === "WAIT") {
      const secs = parseFloat(value || amount || 1.5);
      await new Promise((r) => setTimeout(r, secs * 1000));
      setTimeout(scanInteractiveElements, 200);
      return { ok: true, action: "WAIT", seconds: secs, observation: `已等待 ${secs} 秒让页面渲染稳定` };
    }

    // Tool 6: SCROLL
    if (action === "SCROLL" || action === "SCROLL_PAGE") {
      const dir = (String(value || key || id || "DOWN")).toUpperCase();
      let scrollY = window.innerHeight * 0.75;
      if (dir.includes("UP")) scrollY = -scrollY;
      if (dir === "TOP") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (dir === "BOTTOM") {
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      } else {
        window.scrollBy({ top: scrollY, behavior: "smooth" });
      }
      setTimeout(scanInteractiveElements, 450);
      return { ok: true, action: "SCROLL", direction: dir, observation: `已向${dir.includes("UP") ? "上" : "下"}平滑滚动页面` };
    }

    // Tool 7: PRESS (Keyboard Key)
    if (action === "KEY" || action === "PRESS" || (id && id.startsWith("KEY_"))) {
      const keyName = (key || id || value || "").toUpperCase();
      const target = lastInteractedNode || document.activeElement || document.body;

      if (keyName.includes("ENTER")) {
        triggerSearchOrEnter(target);
      } else if (keyName.includes("ESCAPE") || keyName.includes("ESC")) {
        const ev = { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true };
        target.dispatchEvent(new KeyboardEvent("keydown", ev));
      } else if (keyName.includes("TAB")) {
        const ev = { key: "Tab", code: "Tab", keyCode: 9, which: 9, bubbles: true };
        target.dispatchEvent(new KeyboardEvent("keydown", ev));
      } else if (keyName.includes("BACKSPACE")) {
        setInputValue(target, "");
      } else if (keyName.includes("PAGEDOWN")) {
        window.scrollBy({ top: window.innerHeight * 0.75, behavior: "smooth" });
      } else if (keyName.includes("PAGEUP")) {
        window.scrollBy({ top: -window.innerHeight * 0.75, behavior: "smooth" });
      }
      setTimeout(scanInteractiveElements, 350);
      return { ok: true, action: "PRESS", key: keyName, observation: `已触发键盘按键: [${keyName}]` };
    }

    // Target Element lookup for element-bound tools
    const node = getNodeById(id);
    if (!node) {
      return { ok: false, error: `页面未找到目标控件 [${id}]，请先调用 SCROLL 查找或确认元素是否存在` };
    }

    lastInteractedNode = node;
    showActionFlash(node);
    node.scrollIntoView({ behavior: "smooth", block: "center" });

    const tag = (node.tagName || "").toLowerCase();
    const type = (node.getAttribute("type") || "").toLowerCase();
    const elName = (node.innerText || node.getAttribute("placeholder") || node.getAttribute("aria-label") || id).slice(0, 24);

    // Tool 8: HOVER
    if (action === "HOVER") {
      simulateHover(node);
      setHoverHighlight(id, `HOVER: ${elName}`);
      setTimeout(scanInteractiveElements, 400);
      return { ok: true, action: "HOVER", id, observation: `已悬浮鼠标至控件 [${id}] ('${elName}')，可能已激活二级面板` };
    }

    // Tool 9: EXTRACT
    if (action === "EXTRACT") {
      const extractedText = (node.innerText || node.textContent || node.value || "").trim();
      return { ok: true, action: "EXTRACT", id, text: extractedText, observation: `从 [${id}] 提取到文本: "${extractedText.slice(0, 80)}"` };
    }

    // Tool 10: CLEAR_AND_TYPE
    if (action === "CLEAR_TYPE" || action === "CLEAR_AND_TYPE") {
      setInputValue(node, "");
      const textToType = value !== undefined ? String(value) : "";
      if (textToType) {
        setInputValue(node, textToType);
      }
      if (enter) {
        setTimeout(() => triggerSearchOrEnter(node), 120);
      }
      setTimeout(scanInteractiveElements, 500);
      return { ok: true, action: "CLEAR_TYPE", id, value: textToType, observation: `已先清空输入框 [${id}]，并重新填入: "${textToType}"` };
    }

    // Tool 11: TYPE
    const isTextInput =
      (tag === "input" && !["button", "submit", "checkbox", "radio"].includes(type)) ||
      tag === "textarea" ||
      node.getAttribute("contenteditable") === "true";

    if (action === "TYPE" || (isTextInput && value !== undefined && value !== "")) {
      const textToType = value !== undefined ? String(value) : "";
      node.focus();
      if (textToType) {
        setInputValue(node, textToType);
      }
      if (enter || action === "TYPE_AND_ENTER") {
        setTimeout(() => triggerSearchOrEnter(node), 120);
      }
      setTimeout(scanInteractiveElements, 500);
      return { ok: true, action: enter ? "TYPE_AND_ENTER" : "TYPE", id, value: textToType, observation: `在输入框 [${id}] 成功填入 "${textToType}" ${enter ? "并按下回车提交" : ""}` };
    }

    // Tool 12: CLICK
    if (tag === "a" || node.hasAttribute("target")) {
      try {
        node.setAttribute("target", "_self");
        node.removeAttribute("rel");
      } catch (_) {}
    }

    simulateRealisticClick(node);
    setTimeout(scanInteractiveElements, 600);
    const isLikeBtn = elName.includes("赞") || (node.className || "").toString().toLowerCase().includes("like");
    const obsText = isLikeBtn
      ? `成功点击点赞按钮 [${id}] ('${elName}')，已完成点赞交互`
      : `成功点击控件 [${id}] ('${elName}')`;
    return { ok: true, action: "CLICK", id, observation: obsText };
  }

  window.addEventListener("scroll", () => renderBadges(), { passive: true });
  window.addEventListener("resize", () => renderBadges(), { passive: true });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (msg.action === "SCAN_PAGE") {
        const res = scanInteractiveElements();
        sendResponse(res);
      } else if (msg.action === "HOVER_ELEMENT") {
        const res = setHoverHighlight(msg.element_id, msg.label);
        sendResponse(res);
      } else if (msg.action === "CLEAR_HOVER") {
        const res = clearHoverHighlight();
        sendResponse(res);
      } else if (msg.action === "EXECUTE_ACTION") {
        executeAction(msg.payload || {}).then(sendResponse);
        return true; // asynchronous response
      } else if (msg.action === "TOGGLE_BADGES") {
        showBadges = msg.show !== undefined ? msg.show : !showBadges;
        renderBadges();
        sendResponse({ ok: true, showBadges });
      } else {
        sendResponse({ ok: false, error: `Unknown action: ${msg.action}` });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message || String(err) });
    }
    return true;
  });

  console.log("[Lite-JEV] Full Agent Toolset & Perception Harness ready.");
})();
