/**
 * Lite-JEV: DeepSeek / Reasoning Truncation & Jev Cleaning Regression Test
 */

const { ZeroCoTEngine } = require("../extension/sidepanel/zero_cot_engine.js");

function assert(cond, msg) {
  if (!cond) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

function runTests() {
  console.log("=================================================");
  console.log("   🧪 Testing DeepSeek Truncation & JEV Cleaning ");
  console.log("=================================================");

  const engine = new ZeroCoTEngine({ provider: "mock" });

  // Test 1: Clean standard JEV
  const res1 = engine._parseJevAction("E13:机票 北京 东京", [], "", [], [], false);
  assert(res1.action.id === "E13", `Slot should be E13, got ${res1.action.id}`);
  assert(res1.action.value === "机票 北京 东京", `Value should be '机票 北京 东京', got '${res1.action.value}'`);

  // Test 2: The exact dirty string from user's DeepSeek log:
  // "We need answer only decision code. Need fill E13 with "机票 北京"
  const dirtyStr = `We need answer only decision code. Need fill E13 with "机票 北京"`;
  const res2 = engine._parseJevAction(dirtyStr, [], "", [], [], false);
  assert(res2.action.id === "E13", `Slot should be E13, got ${res2.action.id}`);
  assert(res2.action.value === "机票 北京", `Value should be cleaned to '机票 北京', got '${res2.action.value}'`);

  // Test 3: Other variations with English prepositions and Chinese quotes
  const dirtyStr3 = `E13: “机票 北京 东京”`;
  const res3 = engine._parseJevAction(dirtyStr3, [], "", [], [], false);
  assert(res3.action.value === "机票 北京 东京", `Value should strip Chinese quotes, got '${res3.action.value}'`);

  // Test 4: Unterminated string JSON recovery in Plan Phase
  const truncatedJson = `{\n  "thought": "用户当前在百度首页，但目标是进行机票搜索",\n  "plan": [\n    {"phase": 1, "description": "在百度首页搜索机票或航班查询入口"}\n  ],\n  "activeSubgoal": "在百度首页搜索机票或航班查询入口`;
  const planRes = engine._safeParseJsonPlan(truncatedJson, "搜索机票");
  assert(planRes && Array.isArray(planRes.plan), "Plan should parse without crashing on unterminated string");
  assert(planRes.activeSubgoal.includes("搜索机票"), `ActiveSubgoal should be recovered, got ${planRes.activeSubgoal}`);

  // Test 5: Agent Tool Primitives Parsing
  const resGoto = engine._parseJevAction("GOTO https://www.bilibili.com", [], "", [], [], false);
  assert(resGoto.action.action === "GOTO" && resGoto.action.url === "https://www.bilibili.com", "GOTO url parsed");

  const resClose = engine._parseJevAction("CLOSE_MODAL", [], "", [], [], false);
  assert(resClose.action.action === "CLOSE_MODAL", "CLOSE_MODAL parsed");

  const resScroll = engine._parseJevAction("SCROLL DOWN", [], "", [], [], false);
  assert(resScroll.action.action === "SCROLL" && resScroll.action.value === "DOWN", "SCROLL DOWN parsed");

  const resClear = engine._parseJevAction("CLEAR_TYPE E13:哔哩哔哩", [], "", [], [], false);
  assert(resClear.action.action === "CLEAR_TYPE" && resClear.action.value === "哔哩哔哩", "CLEAR_TYPE parsed");

  const resHover = engine._parseJevAction("HOVER E5", [], "", [], [], false);
  assert(resHover.action.action === "HOVER" && resHover.action.id === "E5", "HOVER parsed");

  const resBack = engine._parseJevAction("GO_BACK", [], "", [], [], false);
  assert(resBack.action.action === "GO_BACK", "GO_BACK parsed");

  const resPress = engine._parseJevAction("PRESS KEY_ENTER", [], "", [], [], false);
  assert(resPress.action.action === "KEY" && resPress.action.key === "KEY_ENTER", "PRESS KEY_ENTER parsed");

  const resFinish = engine._parseJevAction("FINISH 成功为视频点赞", [], "", [], [], false);
  assert(resFinish.action.action === "FINISH" && resFinish.action.msg.includes("成功为视频点赞"), "FINISH parsed");

  // Test 6: Perception Harness in buildJevPrompt
  const prompt = engine.buildJevPrompt({
    taskGoal: "打开哔哩哔哩点赞",
    activeSubgoal: "进入哔哩哔哩首页",
    pageTitle: "百度首页",
    pageUrl: "https://www.baidu.com",
    elements: [{ id: "E1", category: "按钮", tag: "button", text: "百度一下" }],
    scrollStatus: { description: "页面顶部 (0%)" },
    modalStatus: { hasModal: true, modalName: ".bili-mask" },
    previousObservation: "成功点击搜索",
  });
  assert(prompt.includes("视口滚动: 页面顶部 (0%)"), "Prompt includes scrollStatus");
  assert(prompt.includes("⚠️ 弹窗告警: 检测到活动弹窗遮罩 (.bili-mask)"), "Prompt includes modalStatus");
  assert(prompt.includes("上步反馈: 成功点击搜索"), "Prompt includes previousObservation");
  assert(prompt.includes("GOTO <网址>"), "Prompt includes GOTO tool description");

  console.log("\n🎉 All DeepSeek Cleaning & Truncation Recovery Tests PASSED!");
}

runTests();
