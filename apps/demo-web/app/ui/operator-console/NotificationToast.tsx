"use client";

import type { HealthNotification } from "./useRunnerHealth";

type NotificationToastProps = {
  notifications: HealthNotification[];
  onDismiss: (id: string) => void;
};

function iconForType(type: HealthNotification["type"]) {
  switch (type) {
    case "crash":
      return "🔴";
    case "stall":
      return "⚠️";
    case "recovery":
      return "✅";
    case "failure":
      return "❌";
    case "reconnecting":
      return "🔄";
    default:
      return "ℹ️";
  }
}

function levelClass(level: HealthNotification["level"]) {
  switch (level) {
    case "error":
      return "toastError";
    case "warn":
      return "toastWarn";
    case "info":
      return "toastInfo";
    default:
      return "";
  }
}

export function NotificationToast({ notifications, onDismiss }: NotificationToastProps) {
  if (notifications.length === 0) return null;

  return (
    <div className="toastContainer" role="alert" aria-live="assertive">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`toastItem ${levelClass(notification.level)}`}
        >
          <div className="toastContent">
            <span className="toastIcon">{iconForType(notification.type)}</span>
            <div className="toastBody">
              <strong className="toastTitle">{notification.title}</strong>
              <p className="toastMessage">{notification.message}</p>
            </div>
            <button
              className="toastDismiss"
              onClick={() => onDismiss(notification.id)}
              type="button"
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
          {notification.autoDismissMs ? (
            <div
              className="toastProgress"
              style={{
                animationDuration: `${notification.autoDismissMs}ms`,
              }}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
