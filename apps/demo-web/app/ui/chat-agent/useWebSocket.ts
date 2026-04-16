"use client";

/**
 * useWebSocket — WebSocket connection hook
 *
 * Manages the WebSocket connection lifecycle with:
 * - Auto-reconnect with exponential backoff
 * - Message parsing and routing
 * - Connection state tracking
 *
 * This is the single point of contact between frontend and backend.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChatMessage,
  BrowserState,
  ConnectionStatus,
  ApprovalRequest,
} from "./types";

const RUNNER_WS_URL =
  process.env.NEXT_PUBLIC_RUNNER_WS_URL ?? "ws://127.0.0.1:4001/ws/chat";

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000]; // exponential backoff

interface UseWebSocketReturn {
  status: ConnectionStatus;
  sessionId: string | null;
  messages: ChatMessage[];
  browserState: BrowserState;
  pendingApproval: ApprovalRequest | null;
  isAgentBusy: boolean;
  sendMessage: (content: string) => void;
  sendRaw: (data: object) => void;
  respondToApproval: (requestId: string, action: "approve" | "reject") => void;
  toggleTakeover: () => void;
  stopTask: (taskId?: string) => void;
}

export function useWebSocket(): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [browserState, setBrowserState] = useState<BrowserState>({
    url: "about:blank",
    title: "",
    isLoading: false,
    screenshot: null,
    isTakeoverActive: false,
  });
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const [isAgentBusy, setIsAgentBusy] = useState(false);

  // ── Connect ───────────────────────────────────────────────────────
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(RUNNER_WS_URL);
      wsRef.current = ws;
      setStatus("connecting");

      ws.onopen = () => {
        console.log("[ws] Connected");
        setStatus("connected");
        reconnectAttemptRef.current = 0;

        // Sync selected profile to server on connect/reconnect
        // This prevents stale default profile usage after page refresh
        const savedProfile = typeof window !== "undefined"
          ? localStorage.getItem("cua_selected_profile")
          : null;
        if (savedProfile && savedProfile !== "default") {
          ws.send(JSON.stringify({ type: "switch_profile", profileName: savedProfile }));
          console.log(`[ws] Synced profile on connect: "${savedProfile}"`);
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleServerMessage(msg);
        } catch (err) {
          console.error("[ws] Failed to parse message:", err);
        }
      };

      ws.onclose = () => {
        console.log("[ws] Disconnected");
        setStatus("disconnected");
        wsRef.current = null;
        scheduleReconnect();
      };

      ws.onerror = (err) => {
        console.error("[ws] Error:", err);
        setStatus("error");
      };
    } catch (err) {
      console.error("[ws] Connection failed:", err);
      setStatus("error");
      scheduleReconnect();
    }
  }, []);

  // ── Reconnect logic ───────────────────────────────────────────────
  const scheduleReconnect = useCallback(() => {
    const attempt = reconnectAttemptRef.current;
    const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)] ?? 16000;

    reconnectTimerRef.current = setTimeout(() => {
      reconnectAttemptRef.current++;
      connect();
    }, delay);
  }, [connect]);

  // ── Handle server messages ────────────────────────────────────────
  const handleServerMessage = useCallback((msg: { type: string; [key: string]: unknown }) => {
    switch (msg.type) {
      case "connection_ready":
        setSessionId(msg.sessionId as string);
        break;

      case "agent_message":
        // Clear thinking messages and add the agent's response
        setMessages((prev) => [
          ...prev.filter((m) => m.role !== "thinking"),
          {
            id: msg.id as string,
            role: "agent",
            content: msg.content as string,
            timestamp: msg.timestamp as number,
          },
        ]);
        // Agent has responded — no longer busy
        setIsAgentBusy(false);
        break;

      case "agent_thinking":
        setMessages((prev) => {
          // Replace existing thinking message or add new one
          const withoutThinking = prev.filter((m) => m.role !== "thinking");
          return [
            ...withoutThinking,
            {
              id: "thinking",
              role: "thinking" as const,
              content: msg.status as string,
              timestamp: msg.timestamp as number,
              isStreaming: true,
            },
          ];
        });
        break;

      case "screenshot":
        setBrowserState((prev) => ({
          ...prev,
          screenshot: msg.data as string,
          url: msg.url as string,
          title: msg.title as string,
        }));
        break;

      case "browser_state":
        setBrowserState((prev) => ({
          ...prev,
          url: msg.url as string,
          title: msg.title as string,
          isLoading: msg.isLoading as boolean,
        }));
        break;

      case "approval_request":
        setPendingApproval({
          requestId: msg.requestId as string,
          message: msg.message as string,
          options: msg.options as string[],
          timestamp: msg.timestamp as number,
        });
        break;

      case "takeover_status":
        setBrowserState((prev) => ({
          ...prev,
          isTakeoverActive: msg.active as boolean,
        }));
        break;

      case "error":
        setMessages((prev) => [
          ...prev.filter((m) => m.role !== "thinking"),
          {
            id: `error-${Date.now()}`,
            role: "system",
            content: `⚠️ Error: ${msg.message as string}`,
            timestamp: msg.timestamp as number,
          },
        ]);
        setIsAgentBusy(false);
        break;

      case "task_status": {
        const taskStatus = msg.status as string;
        if (taskStatus === "running") {
          setIsAgentBusy(true);
        } else if (taskStatus === "completed" || taskStatus === "failed" || taskStatus === "killed") {
          setIsAgentBusy(false);
        }
        break;
      }
    }
  }, []);

  // ── Send helpers ──────────────────────────────────────────────────
  const send = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const sendMessage = useCallback(
    (content: string) => {
      const id = crypto.randomUUID();

      // Optimistically add user message
      setMessages((prev) => [
        ...prev,
        {
          id,
          role: "user",
          content,
          timestamp: Date.now(),
        },
      ]);

      // Include active browser profile so runner uses the correct cookies/sessions
      const activeProfile = typeof window !== "undefined"
        ? localStorage.getItem("cua_selected_profile") || undefined
        : undefined;

      send({ type: "user_message", content, id, browserProfile: activeProfile });
    },
    [send],
  );

  const respondToApproval = useCallback(
    (requestId: string, action: "approve" | "reject") => {
      send({ type: "approval_response", requestId, action });
      setPendingApproval(null);
    },
    [send],
  );

  const toggleTakeover = useCallback(() => {
    const isActive = browserState.isTakeoverActive;
    send({ type: "manual_takeover", action: isActive ? "end" : "start" });
  }, [send, browserState.isTakeoverActive]);

  const stopTask = useCallback(
    (taskId?: string) => {
      send({ type: "stop_task", taskId });
    },
    [send],
  );

  // ── Lifecycle ─────────────────────────────────────────────────────
  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

  return {
    status,
    sessionId,
    messages,
    browserState,
    pendingApproval,
    isAgentBusy,
    sendMessage,
    sendRaw: send,
    respondToApproval,
    toggleTakeover,
    stopTask,
  };
}
