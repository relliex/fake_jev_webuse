/**
 * Lite-JEV: Full Transparency Decision & API Audit Logger
 * 
 * Captures 100% of LLM interaction details without any redaction or implicit fallback:
 * - Exact model configuration (provider, model name, endpoint, temperature, thinking budget)
 * - Complete System & User Prompt sent over the wire (including all DOM candidate elements)
 * - Raw, untouched HTTP API response body from the model
 * - Exact token usage, TTFT, decode time, and tokens/sec
 * - Parsing result and whether any fallback occurred
 */

class DecisionLogger {
  constructor() {
    this.logs = [];
    this.subscribers = [];
  }

  logEntry(entry) {
    const enriched = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.logs.push(enriched);

    // Keep memory bounded to last 200 operations
    if (this.logs.length > 200) {
      this.logs.shift();
    }

    // Persist to chrome.storage if available
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({ lite_jev_audit_logs: this.logs });
      }
    } catch (_) {}

    // If running in Node.js (E2E tests or local server), append directly to disk
    if (typeof process !== "undefined" && process.versions?.node && typeof require === "function") {
      try {
        const fs = require("fs");
        const path = require("path");
        const logDir = path.resolve(__dirname, "../../logs");
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

        const humanText = this.formatSingleEntryToText(enriched);
        fs.appendFileSync(path.join(logDir, "decision_audit.log"), humanText + "\n", "utf8");
        fs.appendFileSync(path.join(logDir, "decision_audit.jsonl"), JSON.stringify(enriched) + "\n", "utf8");
      } catch (_) {}
    }

    this.subscribers.forEach((fn) => {
      try { fn(enriched); } catch (_) {}
    });

    return enriched;
  }

  subscribe(callback) {
    this.subscribers.push(callback);
  }

  clear() {
    this.logs = [];
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.remove("lite_jev_audit_logs");
      }
    } catch (_) {}
  }

  getLogs() {
    return [...this.logs];
  }

  formatSingleEntryToText(e) {
    const border = "=".repeat(90);
    const subBorder = "-".repeat(90);
    return `
${border}
[AUDIT LOG] Step ${e.step || 0} | Phase: ${e.phase || "System-1 Jev"} | Time: ${e.timestamp}
Model Provider: ${e.modelConfig?.provider || "unknown"} | Model: ${e.modelConfig?.model || "unknown"} | Zero-CoT: ${e.modelConfig?.zeroCoT}
API Latency: ${e.profiler?.totalApiMs || 0} ms (TTFT: ${e.profiler?.ttftMs || 0} ms, Decode: ${e.profiler?.decodeMs || 0} ms)
Tokens: Usage ${e.profiler?.outputTokens || 0} tokens | Speed: ${e.profiler?.tokensPerSec || "--"} tok/s
Is Mock: ${e.isMock ? "YES (本地模拟模式)" : "NO (真实大模型 API)"} | Is Fallback: ${e.isFallback ? "YES ⚠️ (触发了后备保底)" : "NO (模型原生决策)"}
${subBorder}
>>> 【发送给大模型的完整 PROMPT】:
${e.fullPrompt || "(无)"}
${subBorder}
<<< 【大模型 API 原始未经加工的 RAW 返回 (Raw HTTP Response)】:
${typeof e.rawApiResponse === "object" ? JSON.stringify(e.rawApiResponse, null, 2) : (e.rawApiResponse || "(空)")}
${subBorder}
🎯 【最终解析动作 (Parsed Action)】:
Action: ${e.parsedAction?.action} | Slot: ${e.parsedAction?.id || "--"} | Value: ${e.parsedAction?.value || "--"} | Key: ${e.parsedAction?.key || "--"}
Raw Action Code: "${e.rawOutput || ""}"
${e.fallbackReason ? `⚠️ Fallback Reason: ${e.fallbackReason}\n` : ""}${border}
`;
  }

  exportAsText() {
    if (this.logs.length === 0) {
      return "暂无决策日志记录。请先运行一次任务。";
    }
    return this.logs.map((e) => this.formatSingleEntryToText(e)).join("\n\n");
  }

  exportAsJson() {
    return JSON.stringify(this.logs, null, 2);
  }

  downloadLogFile(format = "log") {
    const content = format === "json" ? this.exportAsJson() : this.exportAsText();
    const mime = format === "json" ? "application/json" : "text/plain;charset=utf-8";
    const filename = `lite_jev_decision_audit_${Date.now()}.${format}`;

    if (typeof window !== "undefined" && typeof document !== "undefined") {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 500);
    }
  }
}

if (typeof window !== "undefined") {
  window.DecisionLogger = DecisionLogger;
  window.globalDecisionLogger = new DecisionLogger();
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { DecisionLogger };
}
