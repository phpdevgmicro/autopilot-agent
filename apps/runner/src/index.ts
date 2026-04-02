import { createServer } from "./server.js";

const port = Number(process.env.PORT ?? 4001);
const host = process.env.HOST ?? "0.0.0.0";

const server = createServer();

// ── Process-level crash guards ─────────────────────────────────────
// Prevent the runner from dying silently on unhandled errors.
// Instead: log, mark active runs as failed, then attempt graceful exit.

function logCrash(label: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(
    JSON.stringify({
      level: "fatal",
      event: label,
      message,
      stack,
      timestamp: new Date().toISOString(),
      pid: process.pid,
    }),
  );
}

let isShuttingDown = false;

async function gracefulShutdown(reason: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.error(
    JSON.stringify({
      level: "warn",
      event: "graceful_shutdown",
      reason,
      timestamp: new Date().toISOString(),
    }),
  );

  try {
    // Give in-flight requests 5 seconds to complete
    await server.close();
  } catch {
    // Server close failed — force exit
  }

  // Allow logs to flush
  setTimeout(() => process.exit(1), 500);
}

process.on("uncaughtException", (error) => {
  logCrash("uncaught_exception", error);
  void gracefulShutdown(`Uncaught exception: ${error instanceof Error ? error.message : String(error)}`);
});

process.on("unhandledRejection", (reason) => {
  logCrash("unhandled_rejection", reason);
  // Don't crash on unhandled rejections — log and continue.
  // This prevents a single failed promise (e.g. API timeout) from killing the entire runner.
  console.error("[runner] Unhandled rejection caught — runner continues running.");
});

process.on("SIGTERM", () => {
  console.log("[runner] Received SIGTERM — shutting down gracefully.");
  void gracefulShutdown("SIGTERM received");
});

process.on("SIGINT", () => {
  console.log("[runner] Received SIGINT — shutting down gracefully.");
  void gracefulShutdown("SIGINT received");
});

// ── Start server ───────────────────────────────────────────────────

try {
  await server.listen({ port, host });
  console.log(`Runner listening on http://${host}:${port}`);
} catch (error) {
  logCrash("startup_failure", error);
  process.exit(1);
}
