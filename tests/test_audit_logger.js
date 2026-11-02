/**
 * Lite-JEV: Decision & API Audit Logger Unit Test
 */

const fs = require("fs");
const path = require("path");
const { DecisionLogger } = require("../extension/sidepanel/decision_logger.js");
const { ZeroCoTEngine } = require("../extension/sidepanel/zero_cot_engine.js");

async function testAuditLogger() {
  console.log("=================================================");
  console.log("   🧪 Testing Transparent Audit Logger System    ");
  console.log("=================================================");

  const logDir = path.resolve(__dirname, "../logs");
  const logFile = path.join(logDir, "decision_audit.log");
  const jsonlFile = path.join(logDir, "decision_audit.jsonl");

  if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
  if (fs.existsSync(jsonlFile)) fs.unlinkSync(jsonlFile);

  const logger = new DecisionLogger();
  const engine = new ZeroCoTEngine({ provider: "mock", model: "gemini-2.0-flash" }, logger);

  // 1. Run Initial Plan
  const taskGoal = "在百度搜索哔哩哔哩，并进入官网点赞视频";
  console.log("1. 执行 System-2 意图规划...");
  await engine.planInitialIntent({
    taskGoal,
    pageTitle: "百度一下，你就知道",
    pageUrl: "https://www.baidu.com",
  });

  // 2. Run Jev Step 1
  console.log("2. 执行 System-1 Jev 肌肉记忆步 1...");
  const mockElements = [
    { id: "E13", category: "输入框", tag: "input", placeholder: "输入搜索词" },
    { id: "E14", category: "提交按钮", tag: "input", text: "百度一下" },
  ];

  await engine.decideSystemOneReflex({
    taskGoal,
    activeSubgoal: "在搜索框输入哔哩哔哩并提交搜索",
    pageTitle: "百度一下，你就知道",
    pageUrl: "https://www.baidu.com",
    elements: mockElements,
    stepHistory: [],
    excludedSlots: [],
  });

  // 3. Verify Log File on Disk
  if (!fs.existsSync(logFile)) {
    throw new Error(`Log 文件未生成: ${logFile}`);
  }
  const logContent = fs.readFileSync(logFile, "utf8");

  console.log("✅ 成功生成审计日志文件:", logFile);
  console.log("   文件大小:", logContent.length, "bytes");

  if (!logContent.includes("【发送给大模型的完整 PROMPT】")) {
    throw new Error("Log 文件中缺失完整 PROMPT 标识");
  }
  if (!logContent.includes("【大模型 API 原始未经加工的 RAW 返回")) {
    throw new Error("Log 文件中缺失 RAW 响应标识");
  }

  console.log("\n--- [Audit Log 文件前 40 行预览] ---");
  console.log(logContent.split("\n").slice(0, 40).join("\n"));
  console.log("------------------------------------\n");

  console.log("🎉 Transparent Audit Logger Test PASSED!");
}

testAuditLogger().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
