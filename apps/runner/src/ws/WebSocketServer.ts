/**
 * WebSocket Server
 *
 * Fastify WebSocket handler that bridges the client and ChatSession.
 * Clean boundary: this module ONLY handles WebSocket plumbing.
 * All business logic lives in ChatSessionManager.
 *
 * Future: this entire module can be replaced by a Go/Rust WebSocket gateway
 * that communicates with the ChatSession via gRPC or NATS.
 */

import type { FastifyInstance } from "fastify";
import websocketPlugin from "@fastify/websocket";
import type { WebSocket } from "ws";
import {
  parseClientMessage,
  serializeServerMessage,
  type ServerMessage,
} from "./protocol.js";
import {
  createSession,
  type ChatSession,
  type MessageSink,
} from "../chat/ChatSessionManager.js";

// ── WebSocket → MessageSink adapter ─────────────────────────────────
class WebSocketSink implements MessageSink {
  constructor(private ws: WebSocket) {}

  send(msg: ServerMessage): void {
    if (this.isOpen()) {
      this.ws.send(serializeServerMessage(msg));
    }
  }

  isOpen(): boolean {
    return this.ws.readyState === this.ws.OPEN;
  }
}

// ── Register WebSocket routes ───────────────────────────────────────
export async function registerWebSocket(app: FastifyInstance): Promise<void> {
  await app.register(websocketPlugin);

  app.get("/ws/chat", { websocket: true }, (socket, _req) => {
    const ws = socket as unknown as WebSocket;
    console.log("[ws] Client connected");

    // Create a new session for this connection
    const session = createSession();
    const sink = new WebSocketSink(ws);
    session.attach(sink);

    // Handle incoming messages
    ws.on("message", (raw: Buffer | string) => {
      const data = typeof raw === "string" ? raw : raw.toString("utf-8");
      const msg = parseClientMessage(data);

      if (!msg) {
        session.detach();
        sink.send({
          type: "error",
          code: "invalid_message",
          message: "Could not parse message",
          timestamp: Date.now(),
        });
        return;
      }

      handleClientMessage(session, msg).catch((err) => {
        console.error("[ws] Error handling message:", err);
        sink.send({
          type: "error",
          code: "internal_error",
          message: err instanceof Error ? err.message : "Unknown error",
          timestamp: Date.now(),
        });
      });
    });

    // Handle disconnect
    ws.on("close", () => {
      console.log(`[ws] Client disconnected (session: ${session.id})`);
      session.detach();
    });

    ws.on("error", (err) => {
      console.error(`[ws] WebSocket error (session: ${session.id}):`, err);
      session.detach();
    });
  });
}

// ── Message Router ──────────────────────────────────────────────────
import type { ClientMessage } from "./protocol.js";

async function handleClientMessage(
  session: ChatSession,
  msg: ClientMessage,
): Promise<void> {
  switch (msg.type) {
    case "user_message":
      await session.handleUserMessage(msg.content, msg.id, msg.browserProfile);
      break;

    case "approval_response":
      session.handleApprovalResponse(msg.requestId, msg.action, msg.message);
      break;

    case "manual_takeover":
      if (msg.action === "start") {
        session.startManualTakeover();
      } else {
        session.endManualTakeover();
      }
      break;

    case "stop_task":
      session.stopTask(msg.taskId);
      // Also stop the running agent
      if (session._runner && session._runner.isActive()) {
        session._runner.stop();
      }
      break;

    case "browser_action": {
      // Forward browser action to the agent's browser during manual takeover
      const runner = session._runner;
      if (!runner || !runner.getBrowser()) {
        console.log("[ws] No active browser for action:", msg.action);
        break;
      }
      const browser = runner.getBrowser();
      const page = browser.page;
      try {
        switch (msg.action.action) {
          case "click":
            await page.mouse.click(msg.action.x, msg.action.y);
            break;
          case "type":
            await page.keyboard.type(msg.action.text);
            break;
          case "keypress":
            await page.keyboard.press(msg.action.key);
            break;
          case "navigate":
            await page.goto(msg.action.url, { waitUntil: "load", timeout: 15_000 });
            break;
          case "scroll":
            await page.mouse.wheel(0, msg.action.deltaY);
            break;
        }
      } catch (err) {
        console.error("[ws] Browser action error:", err);
      }
      break;
    }

    case "switch_profile": {
      // User switched browser profile from the dropdown
      const profileName = msg.profileName;
      console.log(`[ws] Profile switch requested: "${profileName}"`);

      // Store the new profile on the session (persists across runner recreation)
      session.setProfile(profileName);

      // Close existing browser so next task launches with new profile
      // IMPORTANT: We do NOT null _runner — that would destroy conversation history
      const activeRunner = session._runner;
      if (activeRunner) {
        if (activeRunner.isActive()) {
          session.addSystemMessage(`⚠️ Cannot switch profile while a task is running. Stop the task first.`);
          break;
        }
        // Close only the browser (releases profile lock), keep runner alive
        try {
          await activeRunner.closeBrowser();
        } catch {
          // best-effort
        }
      }

      session.addSystemMessage(`🔄 Switched to profile **${profileName}**. The next task will use this profile's cookies.`);
      break;
    }

    default:
      console.warn("[ws] Unknown message type:", (msg as { type: string }).type);
  }
}
