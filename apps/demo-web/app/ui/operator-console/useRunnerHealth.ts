"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type HealthStatus = "healthy" | "degraded" | "dead";

export type HealthNotification = {
  id: string;
  type: "crash" | "stall" | "recovery" | "failure" | "reconnecting";
  level: "error" | "warn" | "info";
  title: string;
  message: string;
  createdAt: string;
  dismissed: boolean;
  autoDismissMs?: number;
};

type HeartbeatResponse = {
  status: string;
  uptimeMs: number;
  activeRunId: string | null;
  lastEventAt: string | null;
  runStatus: string | null;
  memory: { heapUsedMb: number; rssMb: number };
};

type UseRunnerHealthOptions = {
  runnerBaseUrl: string;
  isRunActive: boolean;
};

const POLL_INTERVAL_IDLE = 10_000;   // 10s when no run active
const POLL_INTERVAL_ACTIVE = 3_000;  // 3s when run is active
const CONSECUTIVE_FAILS_FOR_DEAD = 3; // 3 missed heartbeats = dead

let notificationCounter = 0;

function createNotification(
  type: HealthNotification["type"],
  level: HealthNotification["level"],
  title: string,
  message: string,
  autoDismissMs?: number,
): HealthNotification {
  return {
    id: `health-${++notificationCounter}-${Date.now()}`,
    type,
    level,
    title,
    message,
    createdAt: new Date().toISOString(),
    dismissed: false,
    ...(autoDismissMs !== undefined ? { autoDismissMs } : {}),
  };
}

export function useRunnerHealth({ runnerBaseUrl, isRunActive }: UseRunnerHealthOptions) {
  const [healthStatus, setHealthStatus] = useState<HealthStatus>("healthy");
  const [notifications, setNotifications] = useState<HealthNotification[]>([]);
  const [lastHeartbeat, setLastHeartbeat] = useState<Date | null>(null);

  const consecutiveFailsRef = useRef(0);
  const previousHealthRef = useRef<HealthStatus>("healthy");
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addNotification = useCallback(
    (
      type: HealthNotification["type"],
      level: HealthNotification["level"],
      title: string,
      message: string,
      autoDismissMs?: number,
    ) => {
      setNotifications((prev) => {
        // Don't duplicate active notifications of the same type
        if (prev.some((n) => n.type === type && !n.dismissed)) return prev;
        return [...prev.slice(-4), createNotification(type, level, title, message, autoDismissMs)];
      });
    },
    [],
  );

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, dismissed: true } : n)),
    );
  }, []);

  const dismissAll = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, dismissed: true })));
  }, []);

  // Heartbeat poll
  const checkHealth = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);

      const response = await fetch(`${runnerBaseUrl}/api/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Runner returned ${response.status}`);
      }

      const data = (await response.json()) as HeartbeatResponse;
      setLastHeartbeat(new Date());
      consecutiveFailsRef.current = 0;

      // Recovery detection: was dead/degraded, now healthy
      if (previousHealthRef.current !== "healthy") {
        setHealthStatus("healthy");
        addNotification(
          "recovery",
          "info",
          "Runner Recovered",
          "Runner reconnected. Ready for new missions.",
          8_000,
        );
        previousHealthRef.current = "healthy";
        return;
      }

      // Stall detection: run is active but lastEventAt is old
      if (data.activeRunId && data.lastEventAt && data.runStatus === "running") {
        const silentMs = Date.now() - new Date(data.lastEventAt).getTime();
        if (silentMs > 60_000) {
          setHealthStatus("degraded");
          addNotification(
            "stall",
            "warn",
            "Agent May Be Stuck",
            `No activity for ${Math.round(silentMs / 1000)}s. The system will auto-abort at 120s.`,
          );
          previousHealthRef.current = "degraded";
          return;
        }
      }

      setHealthStatus("healthy");
      previousHealthRef.current = "healthy";
    } catch {
      consecutiveFailsRef.current += 1;

      if (consecutiveFailsRef.current >= CONSECUTIVE_FAILS_FOR_DEAD) {
        setHealthStatus("dead");

        if (previousHealthRef.current !== "dead") {
          if (isRunActive) {
            addNotification(
              "crash",
              "error",
              "Runner Connection Lost",
              "Runner connection lost during active mission. The run has been terminated.",
            );
          } else {
            addNotification(
              "crash",
              "error",
              "Runner Offline",
              "Cannot reach the runner. Start 'pnpm dev' to resume.",
            );
          }
          previousHealthRef.current = "dead";
        }
      } else {
        setHealthStatus("degraded");
        previousHealthRef.current = "degraded";
      }
    }
  }, [runnerBaseUrl, isRunActive, addNotification]);

  // Start/stop polling based on run state
  useEffect(() => {
    const interval = isRunActive ? POLL_INTERVAL_ACTIVE : POLL_INTERVAL_IDLE;

    // Immediate first check
    void checkHealth();

    pollIntervalRef.current = setInterval(() => {
      void checkHealth();
    }, interval);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [checkHealth, isRunActive]);

  // Auto-dismiss notifications
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const notification of notifications) {
      if (!notification.dismissed && notification.autoDismissMs) {
        const elapsed = Date.now() - new Date(notification.createdAt).getTime();
        const remaining = notification.autoDismissMs - elapsed;

        if (remaining > 0) {
          timers.push(
            setTimeout(() => {
              dismissNotification(notification.id);
            }, remaining),
          );
        } else {
          dismissNotification(notification.id);
        }
      }
    }

    return () => timers.forEach(clearTimeout);
  }, [notifications, dismissNotification]);

  const activeNotifications = notifications.filter((n) => !n.dismissed);

  return {
    healthStatus,
    lastHeartbeat,
    activeNotifications,
    addNotification,
    dismissNotification,
    dismissAll,
  };
}
