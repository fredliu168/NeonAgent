const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

function isObject(value) {
  return typeof value === "object" && value !== null;
}

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function makeRequestId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readPositiveInt(value, fallback) {
  if (Number.isInteger(value) && value > 0) {
    return value;
  }
  return fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveTabId(tabIdInput) {
  if (Number.isInteger(tabIdInput) && tabIdInput > 0) {
    return tabIdInput;
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab || typeof activeTab.id !== "number") {
    throw new Error("No active tab found. Please pass payload.tabId explicitly.");
  }
  return activeTab.id;
}

async function sendToNeon(neonExtensionId, message, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  return Promise.race([
    chrome.runtime.sendMessage(neonExtensionId, message),
    timeout
  ]);
}

async function sendCommand(payload) {
  if (!isObject(payload)) throw new Error("payload must be an object");

  const neonExtensionId = trimString(payload.neonExtensionId);
  const userMessage = trimString(payload.userMessage);
  const requestId = trimString(payload.requestId) || makeRequestId("codex-bridge-cmd");
  const waitForResult = payload.waitForResult === true;
  const waitTimeoutMs = readPositiveInt(payload.waitTimeoutMs, DEFAULT_WAIT_TIMEOUT_MS);
  const pollIntervalMs = readPositiveInt(payload.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS);

  if (!neonExtensionId) throw new Error("payload.neonExtensionId is required");
  if (!userMessage) throw new Error("payload.userMessage is required");

  const tabId = await resolveTabId(payload.tabId);

  const neonPayload = {
    requestId,
    tabId,
    userMessage
  };

  if (isObject(payload.config)) neonPayload.config = payload.config;
  if (Array.isArray(payload.history)) neonPayload.history = payload.history;
  if (typeof payload.maxIterations === "number") neonPayload.maxIterations = payload.maxIterations;
  if (typeof payload.toolTimeout === "number") neonPayload.toolTimeout = payload.toolTimeout;

  const commandResponse = await sendToNeon(neonExtensionId, {
    type: "AGENT_EXTERNAL_COMMAND",
    payload: neonPayload
  });

  if (!waitForResult) {
    return commandResponse;
  }

  const ackData = isObject(commandResponse) && isObject(commandResponse.data)
    ? commandResponse.data
    : null;
  const trackedRequestId = trimString(ackData?.requestId);
  if (!trackedRequestId) {
    return commandResponse;
  }

  const deadline = Date.now() + waitTimeoutMs;
  let latestResultResponse = null;

  while (Date.now() < deadline) {
    const resultResponse = await sendToNeon(neonExtensionId, {
      type: "AGENT_EXTERNAL_GET_RESULT",
      payload: { requestId: trackedRequestId }
    });
    latestResultResponse = resultResponse;

    if (isObject(resultResponse) && resultResponse.ok === true && isObject(resultResponse.data)) {
      const status = trimString(resultResponse.data.status);
      if (status && status !== "running") {
        return {
          ok: true,
          data: {
            ack: ackData,
            result: resultResponse.data
          }
        };
      }
    }

    await sleep(pollIntervalMs);
  }

  return {
    ok: false,
    errors: [`Timed out waiting for command result after ${waitTimeoutMs}ms`],
    data: {
      ack: ackData,
      latest: latestResultResponse
    }
  };
}

async function sendToolCall(payload) {
  if (!isObject(payload)) throw new Error("payload must be an object");

  const neonExtensionId = trimString(payload.neonExtensionId);
  const toolName = trimString(payload.toolName);
  const requestId = trimString(payload.requestId) || makeRequestId("codex-bridge-tool");

  if (!neonExtensionId) throw new Error("payload.neonExtensionId is required");
  if (!toolName) throw new Error("payload.toolName is required");

  const tabId = await resolveTabId(payload.tabId);
  const args = isObject(payload.arguments) ? payload.arguments : {};

  const neonPayload = {
    requestId,
    tabId,
    toolName,
    arguments: args
  };

  if (isObject(payload.config)) neonPayload.config = payload.config;

  return sendToNeon(neonExtensionId, {
    type: "AGENT_EXTERNAL_TOOL_CALL",
    payload: neonPayload
  });
}

async function getCommandResult(payload) {
  if (!isObject(payload)) throw new Error("payload must be an object");

  const neonExtensionId = trimString(payload.neonExtensionId);
  const requestId = trimString(payload.requestId);

  if (!neonExtensionId) throw new Error("payload.neonExtensionId is required");
  if (!requestId) throw new Error("payload.requestId is required");

  return sendToNeon(neonExtensionId, {
    type: "AGENT_EXTERNAL_GET_RESULT",
    payload: { requestId }
  });
}

async function handleBridgeMessage(message) {
  if (!isObject(message)) {
    return { ok: false, errors: ["Invalid message"] };
  }

  if (message.type === "CODEX_BRIDGE_SEND_COMMAND") {
    return sendCommand(message.payload);
  }

  if (message.type === "CODEX_BRIDGE_SEND_TOOL_CALL") {
    return sendToolCall(message.payload);
  }

  if (message.type === "CODEX_BRIDGE_GET_COMMAND_RESULT") {
    return getCommandResult(message.payload);
  }

  if (message.type === "CODEX_BRIDGE_PING") {
    return { ok: true, data: { bridge: "alive" } };
  }

  return { ok: false, errors: [`Unknown message type: ${String(message.type)}`] };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    try {
      const response = await handleBridgeMessage(message);
      sendResponse(response);
    } catch (error) {
      sendResponse({
        ok: false,
        errors: [error instanceof Error ? error.message : String(error)]
      });
    }
  })();

  return true;
});
