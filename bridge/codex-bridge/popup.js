const neonIdEl = document.getElementById("neonId");
const modeEl = document.getElementById("mode");
const tabIdEl = document.getElementById("tabId");
const userMessageEl = document.getElementById("userMessage");
const waitResultEl = document.getElementById("waitResult");
const waitTimeoutMsEl = document.getElementById("waitTimeoutMs");
const commandConfigEl = document.getElementById("commandConfig");
const toolNameEl = document.getElementById("toolName");
const toolArgsEl = document.getElementById("toolArgs");
const toolConfigEl = document.getElementById("toolConfig");
const commandFieldsEl = document.getElementById("commandFields");
const toolFieldsEl = document.getElementById("toolFields");
const sendBtnEl = document.getElementById("sendBtn");
const resultEl = document.getElementById("result");

const STORAGE_KEY = "codexBridge.neonExtensionId";

function parseMaybeJson(text, fieldName) {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`${fieldName} 不是合法 JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readTabId() {
  const raw = tabIdEl.value.trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Tab ID 必须是正整数");
  }
  return parsed;
}

function readPositiveIntInput(el, fieldName, fallback) {
  const raw = el.value.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} 必须是正整数`);
  }
  return parsed;
}

function setResult(obj) {
  resultEl.textContent = JSON.stringify(obj, null, 2);
}

async function loadSavedNeonId() {
  const response = await chrome.storage.local.get(STORAGE_KEY);
  const saved = response?.[STORAGE_KEY];
  if (typeof saved === "string" && saved.trim()) {
    neonIdEl.value = saved.trim();
  }
}

async function saveNeonId(value) {
  await chrome.storage.local.set({ [STORAGE_KEY]: value });
}

function renderMode() {
  const mode = modeEl.value;
  const isCommand = mode === "command";
  commandFieldsEl.classList.toggle("hidden", !isCommand);
  toolFieldsEl.classList.toggle("hidden", isCommand);
}

async function sendCommand() {
  const neonExtensionId = neonIdEl.value.trim();
  if (!neonExtensionId) throw new Error("请先填写 NeonAgent Extension ID");

  const userMessage = userMessageEl.value.trim();
  if (!userMessage) throw new Error("command 模式下 userMessage 不能为空");

  const payload = {
    neonExtensionId,
    tabId: readTabId(),
    userMessage,
    waitForResult: waitResultEl.checked,
    waitTimeoutMs: readPositiveIntInput(waitTimeoutMsEl, "等待超时(ms)", 120000),
    config: parseMaybeJson(commandConfigEl.value, "config JSON")
  };

  const response = await chrome.runtime.sendMessage({
    type: "CODEX_BRIDGE_SEND_COMMAND",
    payload
  });

  return response;
}

async function sendToolCall() {
  const neonExtensionId = neonIdEl.value.trim();
  if (!neonExtensionId) throw new Error("请先填写 NeonAgent Extension ID");

  const toolName = toolNameEl.value.trim();
  if (!toolName) throw new Error("tool 模式下 toolName 不能为空");

  const payload = {
    neonExtensionId,
    tabId: readTabId(),
    toolName,
    arguments: parseMaybeJson(toolArgsEl.value, "arguments JSON") ?? {},
    config: parseMaybeJson(toolConfigEl.value, "config JSON")
  };

  const response = await chrome.runtime.sendMessage({
    type: "CODEX_BRIDGE_SEND_TOOL_CALL",
    payload
  });

  return response;
}

modeEl.addEventListener("change", renderMode);

sendBtnEl.addEventListener("click", async () => {
  try {
    sendBtnEl.disabled = true;
    setResult({ ok: true, data: { status: "sending" } });

    const neonExtensionId = neonIdEl.value.trim();
    if (neonExtensionId) {
      await saveNeonId(neonExtensionId);
    }

    const response = modeEl.value === "tool"
      ? await sendToolCall()
      : await sendCommand();

    setResult(response);
  } catch (error) {
    setResult({
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)]
    });
  } finally {
    sendBtnEl.disabled = false;
  }
});

await loadSavedNeonId();
renderMode();
