/**
 * Chat Agent — Shared Types
 *
 * Frontend type definitions mirroring the server protocol.
 * These are the types used by React components and hooks.
 */

// ── Chat Messages ───────────────────────────────────────────────────
export type ChatMessageRole = "user" | "agent" | "system" | "thinking";

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

// ── Approval ────────────────────────────────────────────────────────
export interface ApprovalRequest {
  requestId: string;
  message: string;
  options: string[];
  timestamp: number;
}

// ── Browser State ───────────────────────────────────────────────────
export interface BrowserState {
  url: string;
  title: string;
  isLoading: boolean;
  screenshot: string | null;
  isTakeoverActive: boolean;
}

// ── Connection State ────────────────────────────────────────────────
export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

// ── WebSocket Message Types (matching server protocol) ──────────────
export interface ServerMessage {
  type: string;
  [key: string]: unknown;
}

export interface ClientUserMessage {
  type: "user_message";
  content: string;
  id: string;
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

export interface ClientStopTask {
  type: "stop_task";
  taskId?: string;
}
