/**
 * Offscreen document script — bridges background service worker ↔ sandbox iframe.
 *
 * - Receives SANDBOX_EXECUTE messages from background via chrome.runtime.onMessage
 * - Forwards execution requests to the sandbox iframe via postMessage
 * - Proxies fetch requests from sandbox (sandbox pages lack extension host_permissions)
 * - Returns results back to background via sendResponse
 */

const sandboxFrame = document.getElementById("sandbox");
const pendingExecutions = new Map();
let sandboxReady = false;
const pendingMessages = [];

// ── Messages from sandbox iframe ──
window.addEventListener("message", async (event) => {
  const data = event.data;
  if (!data) return;

  // Sandbox is ready
  if (data.type === "sandboxReady") {
    sandboxReady = true;
    for (const msg of pendingMessages) {
      sandboxFrame.contentWindow.postMessage(msg, "*");
    }
    pendingMessages.length = 0;
    return;
  }

  // Fetch proxy: sandbox wants to fetch a URL
  if (data.type === "fetchProxy") {
    const { fetchId, url, init } = data;
    try {
      const response = await fetch(url, init || undefined);
      const body = await response.text();
      const headers = {};
      response.headers.forEach((v, k) => { headers[k] = v; });

      sandboxFrame.contentWindow.postMessage({
        type: "fetchResponse",
        fetchId,
        response: {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          body,
          headers
        }
      }, "*");
    } catch (error) {
      sandboxFrame.contentWindow.postMessage({
        type: "fetchResponse",
        fetchId,
        error: error instanceof Error ? error.message : String(error)
      }, "*");
    }
    return;
  }

  // Execution result from sandbox
  if (data.type === "executeResult") {
    const { execId, result, error } = data;
    const resolver = pendingExecutions.get(execId);
    if (resolver) {
      pendingExecutions.delete(execId);
      if (error) {
        resolver({ ok: false, error });
      } else {
        resolver({ ok: true, result });
      }
    }
    return;
  }
});

// ── Messages from background service worker ──
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SANDBOX_EXECUTE") {
    const { execId, code, toolName, args, envVars } = message;

    // Store the sendResponse callback
    pendingExecutions.set(execId, sendResponse);

    // Forward to sandbox iframe
    const execMessage = { type: "execute", execId, code, toolName, args, envVars };
    if (sandboxReady) {
      sandboxFrame.contentWindow.postMessage(execMessage, "*");
    } else {
      pendingMessages.push(execMessage);
    }

    // Timeout after 60 seconds
    setTimeout(() => {
      if (pendingExecutions.has(execId)) {
        pendingExecutions.delete(execId);
        sendResponse({ ok: false, error: "Script execution timed out (60s)" });
      }
    }, 60000);

    return true; // Keep message channel open for async sendResponse
  }
});
