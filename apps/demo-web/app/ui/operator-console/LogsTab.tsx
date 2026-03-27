"use client";

import { useEffect, useRef } from "react";
import type { RunEvent } from "@cua-sample/replay-schema";

type LogsTabProps = {
  runEvents: RunEvent[];
  streamLogs: boolean;
  onStreamLogsChange: (value: boolean) => void;
};

export function LogsTab({ runEvents, streamLogs, onStreamLogsChange }: LogsTabProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (streamLogs && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [runEvents, streamLogs]);

  return (
    <div className="logsContainer">
      <div className="logsHeader">
        <label className="logsToggle">
          <input
            type="checkbox"
            checked={streamLogs}
            onChange={(e) => onStreamLogsChange(e.target.checked)}
          />
          <span className={`logsToggleDot ${streamLogs ? "logsToggleDotLive" : ""}`} />
          Tail Logs
        </label>
      </div>

      <div ref={scrollRef} className="logsScroll">
        {runEvents.length === 0 ? (
          <div className="logsEmpty">No logs recorded yet.</div>
        ) : (
          runEvents.map((ev, i) => (
            <div key={i} className="logsRow">
              <span className="logsTime">
                {new Date(ev.createdAt).toLocaleTimeString(undefined, { hour12: false, fractionalSecondDigits: 3 })}
              </span>
              <span className={`logsLevel logsLevel--${ev.level || "info"}`}>
                {ev.level || "INFO"}
              </span>
              <span className="logsMessage">
                {ev.message || ev.type}
              </span>
              {ev.detail ? <span className="logsDetail"> — {ev.detail}</span> : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
