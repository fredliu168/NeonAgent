import crypto from "node:crypto";
import http from "node:http";

const PORT = Number.parseInt(process.env.NEON_LOCAL_PORT || "8787", 10);
const HOST = process.env.NEON_LOCAL_HOST || "127.0.0.1";
const PATHNAME = process.env.NEON_LOCAL_PATH || "/neonagent";
const TOKEN = process.env.NEON_TOKEN || "";

let neonSocket = null;
let neonBuffer = Buffer.alloc(0);
const responses = new Map();

function json(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function makeRequestId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function encodeFrame(text) {
  const payload = Buffer.from(text);
  const length = payload.length;
  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), payload]);
  }
  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}

function decodeFrames(chunk) {
  neonBuffer = Buffer.concat([neonBuffer, chunk]);
  const messages = [];

  while (neonBuffer.length >= 2) {
    const first = neonBuffer[0];
    const second = neonBuffer[1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (neonBuffer.length < offset + 2) break;
      length = neonBuffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (neonBuffer.length < offset + 8) break;
      const bigLength = neonBuffer.readBigUInt64BE(offset);
      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("WebSocket frame too large");
      }
      length = Number(bigLength);
      offset += 8;
    }

    const maskOffset = offset;
    const mask = masked ? Buffer.from(neonBuffer.subarray(maskOffset, maskOffset + 4)) : null;
    if (masked) offset += 4;
    if (neonBuffer.length < offset + length) break;

    const payload = Buffer.from(neonBuffer.subarray(offset, offset + length));
    neonBuffer = neonBuffer.subarray(offset + length);

    if (opcode === 0x8) {
      neonSocket?.end();
      neonSocket = null;
      continue;
    }

    if (opcode !== 0x1) {
      continue;
    }

    if (mask) {
      for (let i = 0; i < payload.length; i += 1) {
        payload[i] ^= mask[i % 4];
      }
    }

    messages.push(payload.toString("utf8"));
  }

  return messages;
}

function sendToNeon(payload) {
  if (!neonSocket || neonSocket.destroyed) {
    throw new Error("NeonAgent is not connected. Enable local WebSocket in NeonAgent settings first.");
  }

  const requestId = payload.requestId || makeRequestId("codex");
  const message = {
    ...payload,
    requestId,
    token: payload.token ?? TOKEN
  };
  neonSocket.write(encodeFrame(JSON.stringify(message)));
  return requestId;
}

async function handleHttp(req, res) {
  if (req.method === "OPTIONS") {
    json(res, 204, {});
    return;
  }

  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  if (req.method === "GET" && url.pathname === "/status") {
    json(res, 200, {
      ok: true,
      connected: Boolean(neonSocket && !neonSocket.destroyed),
      wsUrl: `ws://${HOST}:${PORT}${PATHNAME}`,
      storedResponses: responses.size
    });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/result/")) {
    const requestId = decodeURIComponent(url.pathname.slice("/result/".length));
    json(res, 200, responses.get(requestId) || {
      ok: false,
      requestId,
      error: "No response stored for requestId"
    });
    return;
  }

  if (req.method !== "POST") {
    json(res, 404, { ok: false, error: "Not found" });
    return;
  }

  const body = await readBody(req);
  let payload;

  if (url.pathname === "/agent" || url.pathname === "/command") {
    payload = {
      type: body.type || "agent_run",
      waitForResult: body.waitForResult ?? true,
      ...body
    };
  } else if (url.pathname === "/tool") {
    payload = {
      type: "tool_call",
      ...body
    };
  } else if (url.pathname === "/skill") {
    payload = {
      type: "run_skill",
      ...body
    };
  } else if (url.pathname === "/send") {
    payload = body;
  } else {
    json(res, 404, { ok: false, error: "Not found" });
    return;
  }

  const requestId = sendToNeon(payload);
  json(res, 200, {
    ok: true,
    requestId,
    sent: payload.type
  });
}

const server = http.createServer((req, res) => {
  void handleHttp(req, res).catch((error) => {
    json(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  });
});

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  if (url.pathname !== PATHNAME) {
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    ""
  ].join("\r\n"));

  if (neonSocket && !neonSocket.destroyed) {
    neonSocket.end();
  }
  neonSocket = socket;
  neonBuffer = Buffer.alloc(0);
  console.log("[ws] NeonAgent connected");

  socket.on("data", (chunk) => {
    try {
      for (const text of decodeFrames(chunk)) {
        console.log("[neon]", text);
        try {
          const parsed = JSON.parse(text);
          if (parsed.requestId) {
            responses.set(parsed.requestId, parsed);
          }
        } catch {
          // Keep logging raw messages, but only store JSON responses.
        }
      }
    } catch (error) {
      console.error("[ws] decode error:", error instanceof Error ? error.message : error);
      socket.destroy();
    }
  });

  socket.on("close", () => {
    if (neonSocket === socket) {
      neonSocket = null;
    }
    console.log("[ws] NeonAgent disconnected");
  });

  socket.on("error", (error) => {
    console.error("[ws] socket error:", error.message);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`HTTP: http://${HOST}:${PORT}`);
  console.log(`WS:   ws://${HOST}:${PORT}${PATHNAME}`);
  console.log("Endpoints: GET /status, POST /agent, POST /tool, POST /skill, POST /send, GET /result/:requestId");
});
