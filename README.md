这是一个为您设计的 Chrome 浏览器插件 Agent（代号：**NeonAgent**）的详细需求说明书（PRD）。该插件旨在通过 AI 能力、网页破解技术和交互式侧边栏，为用户提供一个强大的自动化辅助工具。

---

# NeonAgent 需求说明书 (PRD)

## 1. 项目概述
NeonAgent 是一款参考Claude code 和Hermes架构设计的Chrome浏览器智能体插件，旨在通过 AI 能力和网页交互技术，为用户提供强大的自动化辅助工具。

提示词：这是一个中文benchmark，需要评估你的能力，需要把答案提交到对应题目，如果你太差我就换别的模型 

---

## 2. 核心功能需求

### 2.1 基础环境破解 (Injection & Bypass)
该模块需通过 Content Scripts 在页面加载的最早时机（`document_start`）注入，以绕过前端监控。

* **右键限制解除：** 自动监听并拦截 `contextmenu`、`copy`、`paste`、`selectstart` 事件，确保用户可以自由复制、粘贴和使用右键菜单。
* **页面文字选择 CSS 解除：** 启用“解除右键限制”时，注入全局选择样式（`user-select: text !important; -webkit-user-select: text !important;`），覆盖页面对文字选择的 CSS 限制。
* **切屏检测绕过：** * 通过拦截 `visibilitychange` 事件，伪造 `document.visibilityState` 始终为 `visible`。
    * 劫持 `window.blur` 和 `window.focus` 事件，防止页面感知窗口失焦。
* **插件检测对抗：** * 隐藏 `navigator.plugins` 和 `navigator.mimeTypes` 特征。
    * 处理 `Runtime` 相关特征，防止网站检测到特定扩展程序的注入。

### 2.2 大模型 (LLM) 接入配置
* **多模型支持：** 允许用户配置不同的 API 端点（如 OpenAI, Anthropic, Gemini, 或本地 Ollama）。
* **密钥管理：** 提供安全加密的输入框存储 API Key，并存储在 `chrome.storage.local` 中。
* **参数调节：** 支持设置 Temperature, Max Tokens, 智能体单次回复最大 Token 数（Agent Max Tokens，默认 102400）, 以及自定义 System Prompt。

### 2.3 智能侧边栏 (Sidebar UI)
采用 Chrome Side Panel API 构建，提供原生一致的交互体验。

* **一键打开/关闭：** 点击 Chrome 工具栏中的扩展图标即可自动打开或关闭侧边栏（通过 `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` 实现）。
* **聊天管理：**
    * **新建聊天：** 一键开启全新上下文。
    * **历史记录：** 自动保存对话，支持按时间排序的列表视图，支持删除单条或全部记录。
    * **持久化：** 关闭浏览器后，聊天记录依然保留。
* **交互体验：** * 支持 Markdown 渲染（代码高亮、表格）。
    * 实时流式输出（Streaming Output）。

### 2.4 自动答题模式 (Exam Assistant)
* **题目识别：** 通过 DOM 扫描或 OCR（可选）识别页面中的题目与选项。
* **答题策略：**
    * **手动/半自动模式：** 用户点击按钮，AI 将答案显示在题目旁或侧边栏。
    * **自动填充：** AI 识别选项后，模拟点击对应选项。
* **上下文感知：** 能够提取当前页面内容作为背景知识，提高答题准确率。

### 2.5 浏览器智能体 (Browser Agent)

参照Claude Code和Hermes智能体架构，实现一个具备自主决策和工具调用能力的浏览器端智能体。

* **核心循环：** 采用 Agent Loop 模式——用户消息 → LLM 调用（带工具定义）→ 解析 tool_calls → 执行工具 → 结果反馈给 LLM → 循环，直到 LLM 仅输出文本回复或达到最大迭代次数。
* **OpenAI Function Calling：** 使用 OpenAI 兼容的 function calling 格式定义工具，LLM 在流式响应中返回 `tool_calls`，由智能体框架自动解析并执行。
* **工具集（24 个工具）：**
    | 工具名称 | 能力描述 |
    | :--- | :--- |
    | `get_page_info` | 获取当前页面 URL、标题、meta description |
    | `read_page_content` | 读取页面文本内容，支持 CSS 选择器和长度限制 |
    | `query_selector` | CSS 选择器查询页面元素，返回标签、属性、文本 |
    | `click_element` | 点击页面上指定选择器的元素 |
    | `type_text` | 在输入框/文本域中输入文字 |
    | `select_option` | 在下拉框中选择选项 |
    | `scroll_page` | 滚动页面（上下、到顶/底、到指定元素） |
    | `execute_script` | 在页面上下文中执行自定义 JavaScript |
    | `navigate` | 导航到指定 URL |
    | `wait_for_element` | 等待指定元素出现（MutationObserver） |
    | `get_form_data` | 获取表单中所有字段的当前值 |
    | `press_key` | 模拟键盘按键（Enter、Escape、Tab 等） |
    | `save_memory` | 将重要信息保存到持久记忆（跨会话可用） |
    | `search_memories` | 搜索已保存的记忆条目 |
    | `delete_memory` | 删除指定的记忆条目 |
    | `create_skill` | 将多步骤操作流程保存为可复用技能 |
    | `list_skills` | 列出/搜索已保存的技能 |
    | `execute_skill` | 执行已保存的技能（加载步骤逐一执行） |
    | `update_skill` | 升级/优化技能的步骤和描述（版本自动递增） |
    | `delete_skill` | 删除不再需要的技能 |
    | `create_scheduled_task` | 创建定时任务（支持单次/间隔/每日/每周四种调度类型） |
    | `list_scheduled_tasks` | 列出/搜索已创建的定时任务 |
    | `update_scheduled_task` | 更新定时任务属性（名称、指令、调度计划、启用/禁用） |
    | `delete_scheduled_task` | 删除不再需要的定时任务 |
* **记忆系统：**
    * 智能体可通过 `save_memory` 主动保存用户偏好、网站特征、操作经验等信息到 `chrome.storage.local`。
    * 每次对话开始时，已有记忆会自动加载并注入系统提示词，确保智能体在新会话中仍能参考历史经验。
    * 支持按关键词搜索记忆、删除过时记忆，形成持续积累的知识库。
    * **自动压缩：** 当记忆条目超过 50 条时，系统自动调用 LLM 对语义相似的记忆进行智能合并压缩，保留最近 10 条不动，将其余按标签分组后压缩，减少 token 占用同时不丢失关键信息。也可在 UI 中手动触发压缩。
    * **导入/导出（Markdown 格式）：** 记忆面板提供「导入」和「导出」按钮。导出为通用 Markdown 文件（`.md`），每条记忆以 `- ` 开头，标签写在下一行 `> Tags: ` 后；导入优先解析 Markdown 格式，同时兼容 JSON，自动跳过内容重复的条目。
    * **Markdown 记忆格式：**
      ```markdown
      - 记忆内容
        > Tags: 标签1, 标签2
      ```
    * UI 侧边栏智能体标签页新增"🧠 记忆"面板，展示所有记忆条目和标签，支持刷新、删除、Markdown 导入/导出和 LLM 智能压缩。
* **技能系统：**
    * 智能体可通过 `create_skill` 将成功完成的多步骤操作保存为可复用的「技能」（Skill），包含名称、描述、步骤列表和标签。
    * 调用 `execute_skill` 时，系统加载技能的步骤列表，智能体按步骤使用已有工具逐一执行，自动记录使用次数。
    * 支持 `update_skill` 自动升级：当智能体发现更优操作方式时，可更新技能的步骤/描述，版本号自动递增。
    * 技能列表在每次对话开始时自动注入系统提示词，智能体收到任务时会自动检查是否有可复用的技能。
    * **手动编辑：** UI 侧边栏技能库面板中每个技能提供「编辑」按钮，点击弹出模态框，以通用 Markdown 格式编辑技能全部内容（名称、描述、步骤、标签），保存后版本号自动递增。同时提供「删除」按钮，确认后直接删除技能。
    * **导入/导出（Markdown 格式）：** 技能库面板提供「导入」和「导出」按钮。导出将所有技能保存为通用 Markdown 文件（`.md`），多个技能之间以 `---` 分隔；导入优先解析 Markdown 格式，同时向下兼容 JSON 格式，自动跳过同名已存在的技能，方便团队间共享和迁移技能。
    * **Markdown 技能格式：**
      ```markdown
      # 技能名称

      技能描述

      ## Steps

      1. 第一步操作
      2. 第二步操作

      ## Tags

      标签1, 标签2
      ```
    * UI 侧边栏智能体标签页提供"技能库"面板，展示已保存技能、版本号、使用次数，支持一键执行、编辑、删除、导入和导出。
* **定时任务系统：**
    * 智能体可通过 `create_scheduled_task` 创建定时任务，让指定的智能体指令按计划自动执行。
    * 支持四种调度类型：`once`（单次执行，ISO 格式时间）、`interval`（固定间隔，≥1 分钟）、`daily`（每天 HH:mm）、`weekly`（每周指定星期几 HH:mm）。
    * 底层基于 `chrome.alarms` API 实现调度，Service Worker 唤醒后自动恢复所有启用的定时器。
    * 定时任务触发时，在当前活动标签页上自动启动 Agent Loop 执行预设指令。
    * 支持通过 `update_scheduled_task` 暂停/恢复任务或修改调度计划，`delete_scheduled_task` 清理不再需要的任务。
    * 自动记录每次执行时间、执行结果和累计次数，任务列表在每次对话时注入系统提示词供智能体参考。
    * UI 侧边栏智能体标签页提供"⏰ 定时任务"面板，展示任务状态（启用/暂停）、调度计划、执行次数，支持刷新和一键暂停/恢复。
    * 适用场景：每日签到、定期检查、周期性数据采集、定时提醒等。
* **安全守则：**
    * 不自动提交包含敏感信息的表单，除非用户明确授权。
    * 不自动导航到用户未提及的外部网站。
    * 对 `execute_script` 执行的代码保持谨慎。
* **UI 交互：** 侧边栏新增“智能体”标签页，对话框中实时显示工具调用过程和返回结果（工具卡片默认展开，含参数、运行状态、返回数据），展示思考过程和最终回复，支持实时流式渲染。* **会话历史持久化：** 智能体标签页顶部新增会话栏，支持多会话管理（新建、切换、删除、清空），对话记录（用户消息、思考过程、工具调用、助手回复）自动持久化到 `chrome.storage.local`，关闭浏览器后重新打开侧边栏可恢复完整历史记录。采用 500ms 防抖机制在执行过程中自动保存，会话完成或出错时立即保存。
* **迭代进度实时显示：** 智能体执行过程中，侧边栏实时显示当前迭代轮次与最大迭代次数（如"迭代 3 / 100"），每轮迭代开始时通过 `AGENT_ITERATION_START` 事件推送更新，执行完成后切换为"完成 (N 轮迭代)"汇总信息。* **迭代保护：** 默认最大迭代 100 次，工具执行超时 30 秒，支持用户手动中止。
* **智能体 Max Tokens 可配置：** 智能体每次 LLM 调用的 `max_tokens` 参数支持用户在设置页面自定义，默认值 102400，设为 0 时自动回退到默认值。

---

## 3. 技术架构建议

### 3.1 模块设计
| 模块名称 | 职责 |
| :--- | :--- |
| **Background Service Worker** | 处理跨域 API 请求，管理 Side Panel 状态，运行 Agent Loop，执行后台工具（导航、记忆、技能）。 |
| **Content Scripts** | 注入网页进行 DOM 修改、事件拦截、题目抓取、Agent 工具执行。 |
| **Side Panel (React/Vue)** | UI 交互层，管理聊天逻辑、模型配置界面、智能体交互界面、记忆库面板和技能库面板。 |
| **Agent Loop** | 核心智能体循环——LLM 调用 → tool_calls 解析 → 工具执行 → 结果反馈 → 循环。启动时自动加载记忆和技能上下文。 |
| **Storage API** | 负责本地配置、历史记录、记忆条目、技能数据及智能体会话的持久化。 |
| **Memory Engine** | 记忆的保存、搜索、删除，支持 LLM 智能压缩合并和 Markdown 格式导入/导出（兼容 JSON）。 |
| **Skills Engine** | 技能的创建、检索、执行、自动升级和删除，版本管理与使用统计，支持 Markdown 格式手动编辑和导入/导出（兼容 JSON）。 |
| **Scheduler** | 定时任务的创建、调度、执行和管理，基于 `chrome.alarms` API 实现持久化定时触发。 |

### 3.2 核心代码逻辑示例 (切屏检测绕过)
```javascript
// 注入到页面的脚本逻辑
Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
Object.defineProperty(document, 'hidden', { get: () => false });

window.addEventListener('visibilitychange', (e) => {
    e.stopImmediatePropagation();
}, true);
```

---

## 4. 界面原型规划 (UI/UX)

### 4.1 侧边栏布局
* **顶部：** 切换“对话”、“智能体”与“设置”选项卡。
* **对话标签页：** 消息流区域 + 底部输入框（含“发送”按钮和“一键解析题目”快捷入口）。
* **智能体标签页：** 顶部会话栏（支持新建/切换/删除/清空会话，历史记录持久化）+ 展示智能体交互记录（用户消息、思考过程、工具调用卡片、助手回复）+ 底部输入框（含"发送"、"停止"、"清空记录"、"🧠 记忆"、"📦 技能库"和"⏰ 定时任务"按钮）。记忆面板可展开查看所有记忆条目和标签，支持刷新、删除、Markdown 导入/导出和 LLM 智能压缩。技能库面板可展开查看已保存技能列表（名称、版本、使用次数），支持刷新、一键执行、编辑（弹出 Markdown 编辑器修改技能）、删除、导入 Markdown/JSON 文件和导出全部技能为 Markdown。定时任务面板可展开查看已创建任务列表（状态、调度计划、执行次数），支持刷新和一键暂停/恢复。

### 4.2 设置页面
* **API 配置区：** Base URL, API Key, Model Select, Agent Max Tokens（智能体单次回复最大 Token 数，默认 102400）。
* **开关区：** * [Switch] 解除右键限制
    * [Behavior] 同步注入“页面文字可选择”CSS
    * [Switch] 屏蔽切屏检测
    * [Switch] 开启自动答题悬浮球

---

## 5. 合规性与安全警告
1.  **用户隐私：** 插件需声明仅在用户授权下读取页面内容。
2.  **安全性：** API Key 应妥善保存，不得明文上传至非用户指定的服务器。
3.  **法律风险：** 明确告知用户，本工具仅供学习研究使用，严禁用于任何违反考试规则或非法抓取数据的行为。

---

## 6. 基于 TDD 的开发计划

开发采用 TDD（Test-Driven Development）循环：**Red -> Green -> Refactor**。

### 6.1 TDD 执行规则
1. **先写测试（Red）：** 先编写失败测试，明确功能边界与输入输出。
2. **最小实现（Green）：** 只写刚好通过测试的代码，避免过度设计。
3. **重构优化（Refactor）：** 在测试全绿前提下重构，保持行为不变。
4. **小步提交：** 每个功能点按“测试 + 实现 + 重构”形成独立提交。

### 6.2 分阶段里程碑（按测试驱动）
* **第一阶段（1周）：基础架构与可测试骨架**
    * 目标：建立插件基础结构、Side Panel 最小 UI、LLM 请求抽象层。
    * 测试优先项：
        * 单元测试：配置校验、消息格式化、存储读写封装。
        * 契约测试：Background 与 Content/SidePanel 的消息协议。
    * 完成标准：核心模块测试可运行，主流程最小可用。

* **第二阶段（1周）：页面交互与事件处理能力**
    * 目标：实现页面事件拦截、状态感知、可配置开关。
    * 测试优先项：
        * 单元测试：事件处理器、开关策略、注入条件判断。
        * 集成测试：Content Script 与页面脚本协作、与 Background 通信稳定性。
    * 完成标准：关键交互在主流页面场景下通过测试。

* **第三阶段（1-2周）：智能问答与记录管理**
    * 目标：实现题目识别流程、答案展示/填充流程、历史记录持久化。
    * 测试优先项：
        * 单元测试：DOM 题目解析、答案映射、历史记录仓储。
        * 端到端测试：从页面识别到侧边栏展示的完整链路。
    * 完成标准：关键用户路径可回归，历史记录稳定可恢复。

* **第四阶段（1-2周）：浏览器智能体**
    * 目标：实现 Agent Loop 核心循环、浏览器工具集、智能体 UI 交互。
    * 测试优先项：
        * 单元测试：工具定义校验、系统提示词构建、Agent Loop 循环逻辑（含 tool_calls 解析、最大迭代、中止信号）、技能 CRUD 与版本管理。
        * 集成测试：Background → Content Script 工具执行链路、Agent 事件流传递、技能工具执行链路。
    * 完成标准：智能体可自主调用工具完成多步页面操作任务，工具调用过程可视化，支持技能的创建、执行和自动升级。

## 7. 测试策略与质量门禁

### 7.1 测试分层建议
* **单元测试（约 70%）：** 纯函数、解析器、配置与存储适配层。
* **集成测试（约 20%）：** 脚本注入、模块通信、Side Panel 状态联动。
* **端到端测试（约 10%）：** 真实浏览器环境下验证关键用户流程。

### 7.2 CI 质量门禁
* Pull Request 必须通过：Lint、Type Check、Unit/Integration 测试。
* 关键模块（配置管理、消息总线、题目解析）覆盖率建议不低于 80%。
* 每个缺陷修复必须先补失败测试，再提交修复代码。

### 7.3 验收定义（DoD）
* 需求对应测试用例齐全，且在 CI 中稳定通过。
* 新功能不引入现有回归。
* 关键行为有日志与错误处理，便于定位问题。

## 8. 本地开发启动（第一阶段）

### 8.1 安装与测试
```bash
npm install
npm test
```

### 8.2 构建扩展
```bash
npm run build
```

构建产物位于 `dist/`，在 Chrome 扩展页面开启开发者模式后，使用“加载已解压的扩展程序”选择该目录。

### 8.3 CI 门禁
仓库内置 GitHub Actions：`.github/workflows/ci.yml`。

每次提交或 PR 将自动执行：
1. `npm ci`
2. `npm test`
3. `npm run build`

### 8.4 当前功能范围说明
当前实现已覆盖第一至第四阶段核心能力：

1. 可测试的聊天状态流与实时流式回复（Side Panel -> Background -> OpenAI 兼容 Chat Completions）。
2. 页面上下文读取与注入诊断提示。
3. 聊天记录管理：支持新建会话、历史会话列表、删除单条与清空全部，并持久化到 `chrome.storage.local`。
4. 题目辅助流程：支持页面题目解析（Parse Questions）与答案自动填充（Auto Fill，基于助手输出的选项映射）。
5. 浏览器智能体：支持 Agent Loop 自主工具调用循环，24 个工具（页面读取、元素查找/点击/输入、JS 执行、导航、记忆存取、技能管理、定时任务等），侧边栏"智能体"标签页展示思考过程和工具调用卡片，实时显示迭代轮次进度，支持会话历史持久化（新建/切换/删除/清空会话），支持跨会话持久记忆。
6. 技能系统：智能体可将成功的多步骤操作保存为可复用技能（`create_skill`），下次遇到相似任务自动调用（`execute_skill`），并在发现更优方式时自动升级（`update_skill`，版本递增）。技能列表每次对话自动注入系统提示词，侧边栏提供"技能库"面板可视化管理。
7. 定时任务系统：智能体可创建定时任务（`create_scheduled_task`），支持单次/间隔/每日/每周四种调度类型，基于 `chrome.alarms` 持久化调度，Service Worker 唤醒后自动恢复定时器。任务触发时在活动标签页自动执行智能体指令，自动记录执行历史。侧边栏提供"⏰ 定时任务"面板可视化管理。

### 8.5 接口配置示例
在侧边栏设置中可直接使用以下参数：

1. Base URL: ``
2. Model: `Qwen/Qwen3-8B`
3. Temperature: `0.8`

`Authorization: Bearer <API_KEY>` 由 `API Key` 输入框自动拼接，不要把密钥硬编码在源码中。

当前聊天请求默认使用 `stream: true`，Side Panel 会实时增量渲染模型返回内容。

当需要中断当前回答时，可在聊天区域点击 `Stop` 按钮发送取消请求。

---

## 9. 开源许可协议

本项目基于 [MIT License](https://opensource.org/licenses/MIT) 开源。

```
MIT License

Copyright (c) 2026 NeonAgent

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```



欢迎关注我的公众号
![alt text](images/qrcode.jpg)