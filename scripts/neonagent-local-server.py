#!/usr/bin/env python3

from __future__ import annotations

import base64
import hashlib
import json
import os
import random
import socket
import struct
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import BinaryIO
from urllib.parse import unquote, urlparse


PORT = int(os.environ.get("NEON_LOCAL_PORT", "8787"))
HOST = os.environ.get("NEON_LOCAL_HOST", "127.0.0.1")
PATHNAME = os.environ.get("NEON_LOCAL_PATH", "/neonagent")
TOKEN = os.environ.get("NEON_TOKEN", "")
MAX_BODY_SIZE = 1024 * 1024
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class NeonState:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.neon_socket: socket.socket | None = None
        self.neon_reader: BinaryIO | None = None
        self.neon_buffer = bytearray()
        self.responses: dict[str, object] = {}

    def is_connected(self) -> bool:
        with self.lock:
            return self.neon_socket is not None

    def replace_connection(self, sock: socket.socket, reader: BinaryIO) -> None:
        previous: socket.socket | None = None
        with self.lock:
            previous = self.neon_socket
            self.neon_socket = sock
            self.neon_reader = reader
            self.neon_buffer = bytearray()
        if previous is not None:
            try:
                previous.close()
            except OSError:
                pass

    def clear_connection(self, sock: socket.socket) -> None:
        with self.lock:
            if self.neon_socket is sock:
                self.neon_socket = None
                self.neon_reader = None
                self.neon_buffer = bytearray()

    def store_response(self, request_id: str, payload: object) -> None:
        with self.lock:
            self.responses[request_id] = payload

    def get_response(self, request_id: str) -> object | None:
        with self.lock:
            return self.responses.get(request_id)

    def response_count(self) -> int:
        with self.lock:
            return len(self.responses)

    def send_to_neon(self, payload: dict[str, object]) -> str:
        with self.lock:
            if self.neon_socket is None:
                raise RuntimeError("NeonAgent is not connected. Enable local WebSocket in NeonAgent settings first.")
            request_id = str(payload.get("requestId") or make_request_id("codex"))
            message = dict(payload)
            message["requestId"] = request_id
            message["token"] = payload.get("token") or TOKEN
            frame = encode_frame(json.dumps(message, ensure_ascii=False))
            self.neon_socket.sendall(frame)
            return request_id


STATE = NeonState()


def make_request_id(prefix: str) -> str:
    return f"{prefix}-{int(time.time() * 1000)}-{random.randrange(16**10):010x}"


def encode_frame(text: str) -> bytes:
    payload = text.encode("utf-8")
    length = len(payload)
    if length < 126:
        return bytes([0x81, length]) + payload
    if length < 65536:
        return bytes([0x81, 126]) + struct.pack(">H", length) + payload
    return bytes([0x81, 127]) + struct.pack(">Q", length) + payload


def decode_frames(buffer: bytearray) -> list[str]:
    messages: list[str] = []

    while len(buffer) >= 2:
        first = buffer[0]
        second = buffer[1]
        opcode = first & 0x0F
        masked = (second & 0x80) != 0
        length = second & 0x7F
        offset = 2

        if length == 126:
            if len(buffer) < offset + 2:
                break
            length = struct.unpack(">H", buffer[offset:offset + 2])[0]
            offset += 2
        elif length == 127:
            if len(buffer) < offset + 8:
                break
            length = struct.unpack(">Q", buffer[offset:offset + 8])[0]
            offset += 8

        mask: bytes | None = None
        if masked:
            if len(buffer) < offset + 4:
                break
            mask = bytes(buffer[offset:offset + 4])
            offset += 4

        if len(buffer) < offset + length:
            break

        payload = bytearray(buffer[offset:offset + length])
        del buffer[:offset + length]

        if opcode == 0x8:
            raise ConnectionAbortedError("WebSocket close frame received")
        if opcode != 0x1:
            continue

        if mask is not None:
            for index in range(len(payload)):
                payload[index] ^= mask[index % 4]

        messages.append(payload.decode("utf-8"))

    return messages


def read_websocket_messages(sock: socket.socket, reader: BinaryIO) -> None:
    print("[ws] NeonAgent connected")
    try:
        while True:
            chunk = reader.read(4096)
            if not chunk:
                break
            with STATE.lock:
                STATE.neon_buffer.extend(chunk)
                messages = decode_frames(STATE.neon_buffer)
            for text in messages:
                print(f"[neon] {text}")
                try:
                    parsed = json.loads(text)
                except json.JSONDecodeError:
                    continue
                request_id = parsed.get("requestId")
                if isinstance(request_id, str) and request_id:
                    STATE.store_response(request_id, parsed)
    except ConnectionAbortedError:
        pass
    except Exception as error:  # pragma: no cover - defensive runtime logging
        print(f"[ws] decode error: {error}")
    finally:
        STATE.clear_connection(sock)
        try:
            sock.close()
        except OSError:
            pass
        print("[ws] NeonAgent disconnected")


class NeonRequestHandler(BaseHTTPRequestHandler):
    server_version = "NeonAgentPythonLocalServer/0.1"

    def log_message(self, format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-methods", "GET,POST,OPTIONS")
        self.send_header("access-control-allow-headers", "content-type")
        super().end_headers()

    def write_json(self, status: int, payload: object) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self) -> dict[str, object]:
        length_header = self.headers.get("content-length", "0").strip()
        try:
            length = int(length_header)
        except ValueError as error:
            raise ValueError("Invalid Content-Length") from error
        if length > MAX_BODY_SIZE:
            raise ValueError("Request body too large")
        raw = self.rfile.read(length) if length > 0 else b""
        if not raw.strip():
            return {}
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as error:
            raise ValueError(str(error)) from error
        if not isinstance(parsed, dict):
            raise ValueError("Request body must be a JSON object")
        return parsed

    def do_OPTIONS(self) -> None:
        self.write_json(204, {})

    def do_GET(self) -> None:
        if self.headers.get("Upgrade", "").lower() == "websocket":
            self.handle_websocket_upgrade()
            return

        parsed = urlparse(self.path)

        if parsed.path == "/status":
            self.write_json(200, {
                "ok": True,
                "connected": STATE.is_connected(),
                "wsUrl": f"ws://{HOST}:{PORT}{PATHNAME}",
                "storedResponses": STATE.response_count()
            })
            return

        if parsed.path.startswith("/result/"):
            request_id = unquote(parsed.path[len("/result/"):])
            response = STATE.get_response(request_id)
            self.write_json(200, response or {
                "ok": False,
                "requestId": request_id,
                "error": "No response stored for requestId"
            })
            return

        self.write_json(404, {"ok": False, "error": "Not found"})

    def do_POST(self) -> None:
        try:
            body = self.read_json_body()
            payload = build_payload(urlparse(self.path).path, body)
            request_id = STATE.send_to_neon(payload)
            self.write_json(200, {
                "ok": True,
                "requestId": request_id,
                "sent": payload.get("type")
            })
        except ValueError as error:
            self.write_json(400, {"ok": False, "error": str(error)})
        except KeyError:
            self.write_json(404, {"ok": False, "error": "Not found"})
        except Exception as error:
            self.write_json(500, {"ok": False, "error": str(error)})

    def handle_one_request(self) -> None:
        try:
            super().handle_one_request()
        except ConnectionResetError:
            pass

    def handle_websocket_upgrade(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != PATHNAME:
            self.send_error(404)
            return

        key = self.headers.get("Sec-WebSocket-Key")
        if not key:
            self.send_error(400, "Missing Sec-WebSocket-Key")
            return

        accept = base64.b64encode(hashlib.sha1(f"{key}{WS_GUID}".encode("utf-8")).digest()).decode("ascii")
        self.send_response_only(101, "Switching Protocols")
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        self.wfile.flush()

        sock = self.connection
        reader = self.rfile
        STATE.replace_connection(sock, reader)
        read_websocket_messages(sock, reader)


def build_payload(path: str, body: dict[str, object]) -> dict[str, object]:
    if path in ("/agent", "/command"):
        payload = {
            "type": body.get("type") or "agent_run",
            "waitForResult": body.get("waitForResult", True)
        }
        payload.update(body)
        return payload
    if path == "/tool":
        payload = {"type": "tool_call"}
        payload.update(body)
        return payload
    if path == "/skill":
        payload = {"type": "run_skill"}
        payload.update(body)
        return payload
    if path == "/send":
        return dict(body)
    raise KeyError(path)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), NeonRequestHandler)
    print(f"HTTP: http://{HOST}:{PORT}")
    print(f"WS:   ws://{HOST}:{PORT}{PATHNAME}")
    print("Endpoints: GET /status, POST /agent, POST /tool, POST /skill, POST /send, GET /result/:requestId")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
