/**
 * Lite-JEV: Circuit Breaker & Decision Parsing Unit Test
 */

const { ZeroCoTEngine } = require("../extension/sidepanel/zero_cot_engine.js");

function assert(cond, msg) {
  if (!cond) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function testJevParsingAndBreaker() {
  console.log("=================================================");
  console.log("   🧪 Testing JEV Primitives & Circuit Breaker   ");
  console.log("=================================================");

  const engine = new ZeroCoTEngine({ provider: "mock" });

  // Mock Baidu Elements
  const mockBaiduElements = [
    { id: "E1", category: "链接", text: "新闻", href: "https://news.baidu.com" },
    { id: "E2", category: "链接", text: "hao123", href: "https://www.hao123.com" },
    { id: "E13", category: "输入框", tag: "input", placeholder: "输入搜索词", value: "" },
    { id: "E14", category: "提交按钮", tag: "input", text: "百度一下" },
    { id: "E16", category: "链接", text: "二十届五中全会公报" },
    { id: "E20", category: "链接", text: "党的二十大明年下半年召开" },
  ];

  // 1. Initial Step on Baidu
  const taskGoal = "从百度搜索页面开始，搜索哔哩哔哩，然后打开哔哩哔哩，选择热度排行榜第一，并且进去点赞";
  const step0 = await engine.decideSystemOneReflex({
    taskGoal,
    activeSubgoal: "在搜索框输入哔哩哔哩并提交搜索",
    pageTitle: "百度一下，你就知道",
    pageUrl: "https://www.baidu.com",
    elements: mockBaiduElements,
    stepHistory: [],
    excludedSlots: [],
  });

  assert(step0.action.action === "TYPE_AND_ENTER", `Step 0 should be TYPE_AND_ENTER, got ${step0.action.action}`);
  assert(step0.action.id === "E13", `Step 0 target slot should be E13, got ${step0.action.id}`);
  assert(step0.action.value === "哔哩哔哩", `Step 0 value should be '哔哩哔哩', got ${step0.action.value}`);

  // 2. Step 1 after typing: should hit Baidu Submit Button E14
  const step1 = await engine.decideSystemOneReflex({
    taskGoal,
    activeSubgoal: "点击搜索按钮提交",
    pageTitle: "百度一下，你就知道",
    pageUrl: "https://www.baidu.com",
    elements: mockBaiduElements,
    stepHistory: [{ action: "TYPE_AND_ENTER", id: "E13", value: "哔哩哔哩" }],
    excludedSlots: [],
  });

  assert(step1.action.id === "E14" || step1.action.key === "KEY_ENTER", `Step 1 should click submit or hit Enter, got ${step1.action.id || step1.action.key}`);

  // 3. Step 2 Search Results: Finding Bilibili Official Link
  const mockResultElements = [
    { id: "E1", category: "链接", text: "百度首页" },
    { id: "E8", category: "链接", text: "哔哩哔哩_bilibili 官方弹幕视频网", href: "https://www.bilibili.com" },
    { id: "E15", category: "链接", text: "百度贴吧" },
  ];

  const step2 = await engine.decideSystemOneReflex({
    taskGoal,
    activeSubgoal: "在搜索结果中识别并进入哔哩哔哩官方网站",
    pageTitle: "哔哩哔哩_百度搜索",
    pageUrl: "https://www.baidu.com/s?wd=哔哩哔哩",
    elements: mockResultElements,
    stepHistory: [
      { action: "TYPE_AND_ENTER", id: "E13", value: "哔哩哔哩" },
      { action: "CLICK", id: "E14" },
    ],
    excludedSlots: [],
  });

  assert(step2.action.id === "E8", `Step 2 should click Bilibili official link E8, got ${step2.action.id}`);

  // 4. Circuit Breaker test: If E1 is clicked and loop is detected, E1 MUST be excluded
  const stepLoop = await engine.decideSystemOneReflex({
    taskGoal,
    activeSubgoal: "继续进入哔哩哔哩",
    pageTitle: "百度新闻",
    pageUrl: "https://news.baidu.com",
    elements: [
      { id: "E1", category: "链接", text: "新闻" },
      { id: "E2", category: "链接", text: "百度首页" },
    ],
    stepHistory: [
      { action: "CLICK", id: "E1" },
      { action: "CLICK", id: "E1" },
    ],
    excludedSlots: ["E1"], // Circuit breaker tripped!
  });

  assert(stepLoop.action.id !== "E1", `Circuit breaker should prevent clicking E1! Got ${stepLoop.action.id}`);
  assert(stepLoop.action.id === "E2", `Should switch to next viable candidate E2, got ${stepLoop.action.id}`);

  console.log("\n🎉 All Jev Primitives and Circuit Breaker Unit Tests Passed!");
}

testJevParsingAndBreaker().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
