# Lite-JEV: Zero-CoT 极速浏览器操作插件 (Cognitive Dual-System)

基于开源 JEV 决策模型（Non-autoregressive 0.8B Qwen 动作分类器）思想，使用原版大模型 API（Gemini Flash / DeepSeek），通过 **Prompt 格式限制 + 关闭思考 (Thinking Budget = 0) + 认知双系统协同架构 (System-1 Jev 肌肉记忆 + System-2 人类级深思考)** 实现极速、高准确率的浏览器自动化 Agent。

---

## 核心架构原理

### 1. 为什么能够达到开源 JEV 模型的速度？
- **传统 Agent 的痛点**: 每次行动都强制输出大量 Chain-of-Thought 思维链或 150+ tokens 的冗长 JSON Schema，导致每步耗时高达 1.5s ~ 7s，且容易在中途幻觉出死循环。
- **JEV 的本质**: 动作选择与条件反射。极限制定输出为单一 Primitive 代码（1~3 个 Token）：
  - `E13:哔哩哔哩` (在输入框键入并提交)
  - `E14` (点击按钮或链接)
  - `KEY_ENTER` / `KEY_PAGEDOWN` (按键与翻页)
  - `FINISH` (目标达成)
- **Zero-CoT 解码延迟**: 1~4 个 token 解码仅需 **15~25ms**，API 总响应降至 **150~300ms**！

### 2. 双系统认知闭环 (Dual-System Architecture)
严格模拟人类认知行为：
```
[用户输入宏观目标]
       │
       ▼
【阶段 1: System-2 人类级深思考规划】 (任务开始时执行 1 次)
- 理解深层意图
- 拆解阶段性任务目标 (Stage 1 -> Stage 2 -> Stage 3)
- 向肌肉记忆下发首期阶段指令
       │
       ▼
【阶段 2: System-1 Jev 肌肉记忆自主极速狂飙】 (Thinking OFF, 150-250ms/步)
- 纯条件反射连续驱动，中间不被打断
- 结构化元素分类 ([输入框], [提交按钮], [链接]) 杜绝看错组件
- 死循环熔断器 (Anti-Loop Circuit Breaker): 连续重复操作立即熔断排除，自动换路
- 直到 Jev 主动宣告 FINISH
       │
       ▼
【阶段 3: System-2 终局深度复核与纠偏】 (仅在 FINISH 时触发)
- 结合实际 URL、页面 Title、终态内容进行深度真实性审查
- 真实完成 -> 🎉 结束并向用户交付成果
- 审查未完成 (如还停留在搜索页) -> 重新纠偏并下发新指令，交给 Jev 肌肉记忆继续冲刺
```

---

## 关键技术突破

1. **单标签页锁定 (Single-Tab Enforcement)**:
   - 全局捕获并抹平 `target="_blank"` 与 `window.open`，强制所有跳转留在当前 Tab，避免多 Tab 爆炸。
2. **搜索引擎表单可靠提交**:
   - 自动识别百度 `#su`、必应 `#sb_form_go` 与通用提交按钮，输入后不仅派发 Enter，且确保触发表单跳转。
3. **死循环智能熔断器 (Anti-Loop Circuit Breaker)**:
   - 追踪 `(pageUrl, actionId)` 历史，一旦检测到重复无效点击立即熔断排除该 ID，防止陷入新闻死循环。

---

## 使用与验证

1. 打开 Chrome，进入 `chrome://extensions/`；
2. 开启右上角“开发者模式”，点击【加载已解压的扩展程序】，选择本仓库中的 `extension` 目录；
3. 在任意网页点击右上角拼图图标打开 Lite-JEV 侧边栏；
4. 在设置中配置 API Key（支持 Gemini 2.0 Flash / OpenAI / DeepSeek），开始极速流畅的自动化体验！
