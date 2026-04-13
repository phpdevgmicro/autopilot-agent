/**
 * WebSocket Message Protocol
 *
 * Defines the bidirectional message types for the chat + browser agent.
 * Designed with clear service boundaries for future Go/Rust extraction.
 */

// ── Task Status ─────────────────────────────────────────────────────
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "killed";

// ── Client → Server Messages ────────────────────────────────────────
export type ClientMessage =
  | ClientUserMessage
  | ClientApprovalResponse
  | ClientManualTakeover
  | ClientBrowserAction
  | ClientStopTask;

export interface ClientUserMessage {
  type: "user_message";
  content: string;
  id: string; // Client-generated message ID for deduplication
  browserProfile?: string; // Active browser profile name from frontend
}

export interface ClientApprovalResponse {
  type: "approval_response";
  requestId: string;
  action: "approve" | "reject";
  message?: string;
}

export interface ClientManualTakeover {
  type: "manual_takeover";
  action: "start" | "end";
}

export interface ClientBrowserAction {
  type: "browser_action";
  action: BrowserAction;
}

export interface ClientStopTask {
  type: "stop_task";
  taskId?: string;
}

// ── Browser Actions (during manual takeover) ────────────────────────
export type BrowserAction =
  | { action: "click"; x: number; y: number }
  | { action: "type"; text: string }
  | { action: "keypress"; key: string }
  | { action: "navigate"; url: string }
  | { action: "scroll"; deltaY: number };

// ── Server → Client Messages ────────────────────────────────────────
export type ServerMessage =
  | ServerAgentMessage
  | ServerAgentThinking
  | ServerScreenshot
  | ServerApprovalRequest
  | ServerTaskStatus
  | ServerBrowserState
  | ServerError
  | ServerTakeoverStatus
  | ServerConnectionReady;

export interface ServerAgentMessage {
  type: "agent_message";
  content: string;
  id: string;
  timestamp: number;
}

export interface ServerAgentThinking {
  type: "agent_thinking";
  status: string;
  timestamp: number;
}

export interface ServerScreenshot {
  type: "screenshot";
  data: string; // base64-encoded image
  url: string;
  title: string;
  timestamp: number;
}

export interface ServerApprovalRequest {
  type: "approval_request";
  requestId: string;
  message: string;
  options: string[];
  timestamp: number;
}

export interface ServerTaskStatus {
  type: "task_status";
  taskId: string;
  status: TaskStatus;
  description?: string;
  timestamp: number;
}

export interface ServerBrowserState {
  type: "browser_state";
  url: string;
  title: string;
  isLoading: boolean;
  timestamp: number;
}

export interface ServerError {
  type: "error";
  code: string;
  message: string;
  timestamp: number;
}

export interface ServerTakeoverStatus {
  type: "takeover_status";
  active: boolean;
  timestamp: number;
}

export interface ServerConnectionReady {
  type: "connection_ready";
  sessionId: string;
  timestamp: number;
}

// ── Serialization helpers ───────────────────────────────────────────
export function serializeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.type) return null;
    return parsed as ClientMessage;
  } catch {
    return null;
  }
}
