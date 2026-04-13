/**
 * Chat Session Manager
 *
 * Manages the lifecycle of a single chat+browser session.
 * Follows the Coordinator pattern from Antigravity:
 *   - Receives user messages
 *   - Orchestrates browser tasks
 *   - Streams progress back to the client
 *   - Handles approval gates and manual takeover
 *
 * Designed with clean interfaces for future Go/Rust extraction:
 *   - All browser interaction goes through BrowserSession interface
 *   - All client communication goes through MessageSink interface
 */

import { randomUUID } from "node:crypto";
import type {
  ChatMessage,
  BrowserSessionState,
  BrowserTask,
  PendingApproval,
  ChatSessionConfig,
} from "./types.js";
import { DEFAULT_SESSION_CONFIG } from "./types.js";
import type { ServerMessage } from "../ws/protocol.js";

// ── Message Sink Interface ──────────────────────────────────────────
// Abstraction for sending messages to the client.
// In Phase 1: WebSocket. Future: could be Go gRPC stream.
export interface MessageSink {
  send(msg: ServerMessage): void;
  isOpen(): boolean;
}

// ── Chat Session ────────────────────────────────────────────────────
export class ChatSession {
  readonly id: string;
  private messages: ChatMessage[] = [];
  private activeTasks: Map<string, BrowserTask> = new Map();
  private pendingApprovals: Map<string, PendingApproval> = new Map();
  private sink: MessageSink | null = null;
  private config: ChatSessionConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- lazy-loaded to avoid circular deps
  _runner: any = null;

  // Browser state
  private browserState: BrowserSessionState = {
    isActive: false,
    currentUrl: "about:blank",
    currentTitle: "",
    isLoading: false,
    isManualTakeover: false,
  };

  constructor(config?: Partial<ChatSessionConfig>) {
    this.id = randomUUID();
    this.config = { ...DEFAULT_SESSION_CONFIG, ...config };
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  attach(sink: MessageSink): void {
    this.sink = sink;
    this.emit({
      type: "connection_ready",
      sessionId: this.id,
      timestamp: Date.now(),
    });
  }

  detach(): void {
    this.sink = null;
  }

  isConnected(): boolean {
    return this.sink !== null && this.sink.isOpen();
  }

  // ── Message Handling ────────────────────────────────────────────

  async handleUserMessage(content: string, messageId: string, browserProfile?: string): Promise<void> {
    // Store the user message
    const userMsg: ChatMessage = {
      id: messageId,
      role: "user",
      content,
      timestamp: Date.now(),
    };
    this.messages.push(userMsg);

    // Send thinking indicator
    this.emitThinking("Launching browser agent...");

    // Lazy-import to avoid circular deps and keep startup fast
    const { ChatAgentRunner } = await import("./ChatAgentRunner.ts");

    // Create runner for this session if not already active
    if (!this._runner) {
      this._runner = new ChatAgentRunner(this);
    }

    // Run the agent with the specified browser profile
    const result = await this._runner.run(content, browserProfile);

    if (result) {
      // Send the agent's final response
      const agentMsg: ChatMessage = {
        id: randomUUID(),
        role: "agent",
        content: result.finalMessage,
        timestamp: Date.now(),
      };
      this.messages.push(agentMsg);

      this.emit({
        type: "agent_message",
        content: agentMsg.content,
        id: agentMsg.id,
        timestamp: agentMsg.timestamp,
      });
    }
  }

  // ── Approval Gates ──────────────────────────────────────────────

  async requestApproval(message: string, options: string[]): Promise<{ action: "approve" | "reject"; message?: string }> {
    const requestId = randomUUID();

    return new Promise((resolve) => {
      const approval: PendingApproval = {
        id: requestId,
        message,
        options,
        timestamp: Date.now(),
        resolve: (action, msg) => {
          if (msg !== undefined) {
            resolve({ action, message: msg });
          } else {
            resolve({ action });
          }
        },
      };

      this.pendingApprovals.set(requestId, approval);

      this.emit({
        type: "approval_request",
        requestId,
        message,
        options,
        timestamp: approval.timestamp,
      });
    });
  }

  handleApprovalResponse(requestId: string, action: "approve" | "reject", message?: string): void {
    const approval = this.pendingApprovals.get(requestId);
    if (!approval) return;

    this.pendingApprovals.delete(requestId);
    approval.resolve(action, message);
  }

  // ── Manual Takeover ─────────────────────────────────────────────

  startManualTakeover(): void {
    this.browserState.isManualTakeover = true;
    this.emit({
      type: "takeover_status",
      active: true,
      timestamp: Date.now(),
    });

    // Add system message to chat
    this.addSystemMessage("🎮 You took control of the browser. The agent is paused.");
  }

  endManualTakeover(): void {
    this.browserState.isManualTakeover = false;
    this.emit({
      type: "takeover_status",
      active: false,
      timestamp: Date.now(),
    });

    this.addSystemMessage("🤖 Agent resumed control of the browser.");
  }

  // ── Task Management ─────────────────────────────────────────────

  stopTask(taskId?: string): void {
    if (taskId) {
      const task = this.activeTasks.get(taskId);
      if (task) {
        task.status = "killed";
        task.endTime = Date.now();
        this.emit({
          type: "task_status",
          taskId: task.id,
          status: "killed",
          description: task.description,
          timestamp: Date.now(),
        });
      }
    } else {
      // Stop all active tasks
      for (const [id, task] of this.activeTasks) {
        if (task.status === "running" || task.status === "pending") {
          task.status = "killed";
          task.endTime = Date.now();
          this.emit({
            type: "task_status",
            taskId: id,
            status: "killed",
            description: task.description,
            timestamp: Date.now(),
          });
        }
      }
    }
  }

  // ── Browser State ───────────────────────────────────────────────

  updateBrowserState(update: Partial<BrowserSessionState>): void {
    Object.assign(this.browserState, update);
    this.emit({
      type: "browser_state",
      url: this.browserState.currentUrl,
      title: this.browserState.currentTitle,
      isLoading: this.browserState.isLoading,
      timestamp: Date.now(),
    });
  }

  sendScreenshot(data: string, url: string, title: string): void {
    this.emit({
      type: "screenshot",
      data,
      url,
      title,
      timestamp: Date.now(),
    });
  }

  // ── Getters ─────────────────────────────────────────────────────

  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  getBrowserState(): BrowserSessionState {
    return { ...this.browserState };
  }

  getConfig(): ChatSessionConfig {
    return { ...this.config };
  }

  // ── Public Helpers (used by ChatAgentRunner) ─────────────────────

  private emit(msg: ServerMessage): void {
    if (this.sink?.isOpen()) {
      this.sink.send(msg);
    }
  }

  addSystemMessage(content: string): void {
    const msg: ChatMessage = {
      id: randomUUID(),
      role: "system",
      content,
      timestamp: Date.now(),
    };
    this.messages.push(msg);
    this.emit({
      type: "agent_message",
      content,
      id: msg.id,
      timestamp: msg.timestamp,
    });
  }

  emitThinking(status: string): void {
    this.emit({
      type: "agent_thinking",
      status,
      timestamp: Date.now(),
    });
  }
}

// ── Session Registry ────────────────────────────────────────────────
// Simple in-memory registry. Future: backed by Redis/Go service.

const sessions = new Map<string, ChatSession>();

export function createSession(config?: Partial<ChatSessionConfig>): ChatSession {
  const session = new ChatSession(config);
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): ChatSession | undefined {
  return sessions.get(id);
}

export function deleteSession(id: string): boolean {
  return sessions.delete(id);
}

export function getActiveSessionCount(): number {
  return sessions.size;
}
