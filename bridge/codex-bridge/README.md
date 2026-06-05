# Codex Bridge (for NeonAgent)

这个目录是一个最小可用的 Chrome 扩展桥接器，用来把消息转发给 NeonAgent 的外部接口：

- `AGENT_EXTERNAL_COMMAND`
- `AGENT_EXTERNAL_TOOL_CALL`

## 1. 目录说明

- `manifest.json`: MV3 配置
- `background.js`: `sendCommand` / `sendToolCall` 转发逻辑
- `popup.html` + `popup.js`: 本地调试面板（方便直接手动发消息）

## 2. 快速使用

1. 在 Chrome 扩展页加载 NeonAgent（本项目 `dist` 或源码目录），记下它的 Extension ID。
2. 在 Chrome 扩展页再加载本目录 `bridge/codex-bridge`。
3. 点击 Codex Bridge 图标，在输入框填 NeonAgent Extension ID。
4. 选择模式：
   - `AGENT_EXTERNAL_COMMAND`: 填 `userMessage`，触发 NeonAgent 的完整 Agent Loop。
   - `AGENT_EXTERNAL_TOOL_CALL`: 填 `toolName` + `arguments` JSON，直接调某个工具。
5. 点击“发送”，结果会显示在底部 JSON 输出框。

## 3. 消息协议（Bridge 内部）

Bridge 自己对内支持三种消息：

```json
{
  "type": "CODEX_BRIDGE_SEND_COMMAND",
  "payload": {
    "neonExtensionId": "target_extension_id",
    "tabId": 123,
    "userMessage": "读取当前页面正文并总结",
    "config": { "...": "optional llm config" }
  }
}
```

```json
{
  "type": "CODEX_BRIDGE_SEND_TOOL_CALL",
  "payload": {
    "neonExtensionId": "target_extension_id",
    "tabId": 123,
    "toolName": "read_page_content",
    "arguments": { "selector": "main", "maxLength": 1200 },
    "config": { "...": "optional llm config" }
  }
}
```

调用已保存 Skill 控制 NeonAgent 插件工具：

```json
{
  "type": "CODEX_BRIDGE_SEND_TOOL_CALL",
  "payload": {
    "neonExtensionId": "target_extension_id",
    "toolName": "run_skill",
    "arguments": {
      "skillId": "skill-...",
      "stopOnError": true
    }
  }
}
```

```json
{
  "type": "CODEX_BRIDGE_GET_COMMAND_RESULT",
  "payload": {
    "neonExtensionId": "target_extension_id",
    "requestId": "codex-bridge-cmd-..."
  }
}
```

`CODEX_BRIDGE_SEND_COMMAND` 额外支持：

- `waitForResult` (boolean): `true` 时桥接器会轮询 `AGENT_EXTERNAL_GET_RESULT`，直到命令结束后再返回。
- `waitTimeoutMs` (number): 等待超时（毫秒），默认 `120000`。

## 4. 与 NeonAgent 的配合注意点

- 如果 `tabId` 不传，Bridge 会自动用当前活动标签页。
- NeonAgent 仅接受扩展来源（`sender.id`）的外部消息，不接受网页脚本来源。
- NeonAgent 结果查询接口：`AGENT_EXTERNAL_GET_RESULT`（按 `requestId` 获取运行状态与最终输出）。
- NeonAgent 的 memory/skill/script_skill/task 属于按需工具，通常要先调用：

```json
{
  "type": "AGENT_EXTERNAL_TOOL_CALL",
  "payload": {
    "toolName": "load_tool_category",
    "arguments": { "category": "memory" }
  }
}
```
