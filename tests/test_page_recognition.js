/**
 * Lite-JEV: Page Recognition & Universal Archetype Verification Tests
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

async function testPageRecognition() {
  console.log("=================================================");
  console.log(" 🧪 Testing Universal Page Recognition & New Tab ");
  console.log("=================================================");

  const controller = new AgentController();
  const engine = new ZeroCoTEngine({ provider: "mock" });

  // 1. Test New Tab / Blank Page Archetype Detection
  const arch1 = controller._detectPageArchetype("chrome://newtab/", "新标签页");
  assert(arch1 === "NEW_TAB_PAGE", `chrome://newtab must be NEW_TAB_PAGE, got ${arch1}`);

  const arch2 = controller._detectPageArchetype("about:blank", "");
  assert(arch2 === "NEW_TAB_PAGE", `about:blank must be NEW_TAB_PAGE, got ${arch2}`);

  const arch3 = controller._detectPageArchetype("chrome-extension://abcdefg/newtab.html", "My New Tab");
  assert(arch3 === "NEW_TAB_PAGE", `Extension newtab must be NEW_TAB_PAGE, got ${arch3}`);

  // 2. Test User's Exact Prompt: Prioritize "首先打开百度" over downstream "哔哩哔哩"
  const userGoal = "首先打开百度的搜索页，然后通过正常的点击操作去搜索哔哩哔哩，打开哔哩哔哩，并且选择目前热度第一的视频进去点赞";
  const platform = engine._inferTargetPlatform(userGoal);
  assert(platform !== null && platform.name === "百度", `Initial target platform must be 百度, got ${platform ? platform.name : "null"}`);
  assert(platform.url === "https://www.baidu.com", `Initial target URL must be https://www.baidu.com, got ${platform ? platform.url : ""}`);

  // 3. Test Dynamic Subgoal on NEW_TAB_PAGE
  const sgNewTab = controller._resolveDynamicSubgoal(userGoal, "chrome://newtab/", "新标签页", [], "", {
    page_archetype: "NEW_TAB_PAGE",
    is_new_tab: true,
  });
  assert(sgNewTab.includes("新标签页启航") && sgNewTab.includes("https://www.baidu.com"), `New tab subgoal must instruct GOTO to Baidu, got: ${sgNewTab}`);

  // 4. Test Mock Jev Reflex on NEW_TAB_PAGE
  const jevRes = await engine.decideSystemOneReflex({
    taskGoal: userGoal,
    activeSubgoal: sgNewTab,
    pageTitle: "新标签页",
    pageUrl: "chrome://newtab/",
    elements: [],
    stepHistory: [],
    excludedSlots: [],
  });
  assert(jevRes.action.action === "GOTO", `Jev reflex on NEW_TAB_PAGE must be GOTO, got: ${jevRes.action.action}`);
  assert(jevRes.action.url === "https://www.baidu.com", `GOTO target must be https://www.baidu.com, got: ${jevRes.action.url}`);

  // 5. Test System-2 Initial Intent Plan from NEW_TAB_PAGE
  const planRes = await engine.planInitialIntent({
    taskGoal: userGoal,
    pageTitle: "新标签页",
    pageUrl: "chrome://newtab/",
  });
  assert(planRes.plan && planRes.plan.length > 0, "Plan must be generated on new tab");
  assert(planRes.plan[0].description.includes("GOTO https://www.baidu.com"), `Phase 1 plan must be GOTO Baidu, got: ${planRes.plan[0].description}`);

  console.log("\n🎉 All Universal Page Recognition & New Tab Tests PASSED!");
}

testPageRecognition();
