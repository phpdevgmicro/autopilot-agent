/**
 * Chat Session Types
 *
 * Core domain types for the chat + browser agent session.
 * Separate from protocol.ts (wire format) — these are internal state.
 */

import type { TaskStatus } from "../ws/protocol.js";

// ── Chat Messages ───────────────────────────────────────────────────
export type ChatMessageRole = "user" | "agent" | "system" | "tool";

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  timestamp: number;
  metadata?: ChatMessageMetadata;
}

export interface ChatMessageMetadata {
  taskId?: string;
  screenshot?: string;
  browserUrl?: string;
  isThinking?: boolean;
  isApproval?: boolean;
  approvalOptions?: string[];
}

// ── Browser Session ─────────────────────────────────────────────────
export interface BrowserSessionState {
  isActive: boolean;
  currentUrl: string;
  currentTitle: string;
  isLoading: boolean;
  lastScreenshot?: string;
  isManualTakeover: boolean;
}

// ── Task Tracking ───────────────────────────────────────────────────
export interface BrowserTask {
  id: string;
  description: string;
  status: TaskStatus;
  startTime: number;
  endTime?: number;
}

// ── Approval Gate ───────────────────────────────────────────────────
export interface PendingApproval {
  id: string;
  message: string;
  options: string[];
  timestamp: number;
  resolve: (action: "approve" | "reject", message?: string) => void;
}

// ── Session Config ──────────────────────────────────────────────────
export interface ChatSessionConfig {
  /** OpenAI model to use for the coordinator agent */
  model: string;
  /** Maximum browser tasks running in parallel */
  maxConcurrentTasks: number;
  /** Screenshot capture interval in ms during active tasks */
  screenshotIntervalMs: number;
  /** Whether to auto-approve safe navigation actions */
  autoApproveNavigation: boolean;
}

export const DEFAULT_SESSION_CONFIG: ChatSessionConfig = {
  model: (() => {
    const m = process.env.CUA_DEFAULT_MODEL;
    if (!m) throw new Error("[FATAL] CUA_DEFAULT_MODEL is not set in .env — cannot start agent without a model.");
    return m;
  })(),
  maxConcurrentTasks: 1,
  screenshotIntervalMs: 2000,
  autoApproveNavigation: true,
};
