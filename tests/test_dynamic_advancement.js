/**
 * Lite-JEV: Dynamic Sub-goal Advancement & Bilibili Like Button Test
 */

const { AgentController } = require("../extension/sidepanel/agent_controller.js");
const { ZeroCoTEngine } = require("../extension/sidepanel/zero_cot_engine.js");

function assert(cond, msg) {
  if (!cond) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function testDynamicSubgoals() {
  console.log("=================================================");
  console.log(" 🧪 Testing Dynamic Subgoal Advancement & Loops  ");
  console.log("=================================================");

  const controller = new AgentController();
  const goal = "帮我进入哔哩哔哩，然后选择当前视频热度第一的视频，进入，然后点赞";

  // Case 1: In Baidu Search Results
  const sg1 = controller._resolveDynamicSubgoal(goal, "https://www.baidu.com/s?wd=哔哩哔哩", "哔哩哔哩_百度搜索", [{ action: "TYPE" }]);
  assert(sg1.includes("搜索结果已就绪"), `Search results subgoal: ${sg1}`);

  // Case 2: On Bilibili Homepage
  const sg2 = controller._resolveDynamicSubgoal(goal, "https://www.bilibili.com/", "哔哩哔哩弹幕视频网", []);
  assert(sg2.includes("哔哩哔哩首页") && sg2.includes("热门"), `Homepage subgoal: ${sg2}`);

  // Case 3: On Bilibili Popular Page
  const sg3 = controller._resolveDynamicSubgoal(goal, "https://www.bilibili.com/v/popular/all", "热门视频-哔哩哔哩", []);
  assert(sg3.includes("热门排行榜") && sg3.includes("热度第一"), `Popular page subgoal: ${sg3}`);

  // Case 4: On Video Detail Page (Crucial!)
  const sg4 = controller._resolveDynamicSubgoal(goal, "https://www.bilibili.com/video/BV1D5sd6qE3M", "美国古巴互呛_哔哩哔哩", []);
  assert(sg4.includes("视频播放页") && sg4.includes("点赞") && sg4.includes("绝不要点击首页"), `Video detail subgoal: ${sg4}`);

  // Case 5: On Video Detail Page when already liked! (Fixes "任务完成了没有停下")
  const sg5 = controller._resolveDynamicSubgoal(goal, "https://www.bilibili.com/video/BV1D5sd6qE3M", "美国古巴互呛_哔哩哔哩", [], "", { is_video_liked: true });
  assert(sg5.includes("已确认点赞成功") && sg5.includes("FINISH"), `Video already liked subgoal: ${sg5}`);

  // Test history string formatting
  const engine = new ZeroCoTEngine({ provider: "mock" });
  const prompt = engine.buildJevPrompt({
    taskGoal: goal,
    activeSubgoal: sg4,
    pageTitle: "测试播放页",
    pageUrl: "https://www.bilibili.com/video/BV123",
    elements: [{ id: "E1", category: "按钮", text: "点赞" }],
    stepHistory: [
      { action: { action: "TYPE_AND_ENTER", id: "E13", value: "哔哩哔哩" } },
      { action: { action: "CLICK", id: "E16" } },
      { action: { action: "CLICK", id: "E20" } },
      { action: { action: "CLICK", id: "E19" } },
    ],
    excludedSlots: [],
  });

  assert(!prompt.includes("[object Object]"), "Prompt MUST NOT contain [object Object]");
  assert(prompt.includes("TYPE_AND_ENTER E13 \"哔哩哔哩\" -> CLICK E16 -> CLICK E20 -> CLICK E19"), "History string must be cleanly formatted");

  // Test 6: System-2 Final Verification on Video Page with Like
  const verResult = await engine.verifyCompletionAndGuide({
    taskGoal: goal,
    plan: [],
    interactionHistory: [
      { step: 1, action: { action: "GOTO", url: "https://www.bilibili.com" }, execRes: { observation: "进入B站" } },
      { step: 2, action: { action: "CLICK", id: "E5" }, execRes: { observation: "点击热门" } },
      { step: 3, action: { action: "CLICK", id: "E12" }, execRes: { observation: "点击热度第一视频" } },
      { step: 4, action: { action: "CLICK", id: "E8" }, execRes: { observation: "成功点击点赞按钮 [E8] ('点赞')" } },
    ],
    currentUrl: "https://www.bilibili.com/video/BV1D5sd6qE3M",
    pageTitle: "美国古巴当场互呛_哔哩哔哩",
    elements: [{ id: "E8", category: "按钮", text: "点赞 (5.3万)", is_liked: true }],
    isVideoLiked: true,
  });

  assert(verResult.isCompleted === true, `System-2 MUST verify as completed when like is present, got ${verResult.isCompleted}`);
  assert(verResult.reasoning.includes("点赞"), `Reasoning confirms like, got ${verResult.reasoning}`);

  console.log("\n🎉 Dynamic Subgoal Advancement & Formatting Tests PASSED!");
}

testDynamicSubgoals();
