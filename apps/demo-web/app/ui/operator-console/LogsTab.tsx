"use client";

import { useEffect, useRef } from "react";
import type { RunEvent } from "@cua-sample/replay-schema";

type LogsTabProps = {
  runEvents: any[]; // Using any[] to safely handle RunEvent shape locally
  streamLogs: boolean;
  onStreamLogsChange: (value: boolean) => void;
};

export function LogsTab({ runEvents, streamLogs, onStreamLogsChange }: LogsTabProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of logs
  useEffect(() => {
    if (streamLogs && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [runEvents, streamLogs]);

  return (
    <div className="featureSurface" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#09090b', fontFamily: 'monospace', padding: '16px' }}>
      
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
        <label className="liveToggle" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: '#a1a1aa', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={streamLogs}
            onChange={(e) => onStreamLogsChange(e.target.checked)}
            style={{ accentColor: '#3b82f6' }}
          />
          <span className="liveDot" style={{ width: '8px', height: '8px', borderRadius: '50%', background: streamLogs ? '#22c55e' : '#52525b' }} /> Tail Logs
        </label>
      </div>

      <div 
        ref={scrollRef} 
        style={{ flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px' }}
      >
        {runEvents.length === 0 ? (
          <div style={{ color: '#52525b', textAlign: 'center', marginTop: '20px' }}>No logs recorded yet.</div>
        ) : (
          runEvents.map((ev, i) => (
            <div key={i} style={{ display: 'flex', gap: '12px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '4px' }}>
              <span style={{ color: '#71717a', whiteSpace: 'nowrap', minWidth: '95px' }}>
                {new Date(ev.createdAt).toLocaleTimeString(undefined, { hour12: false, fractionalSecondDigits: 3 })}
              </span>
              <span style={{ 
                color: ev.level === 'error' ? '#ef4444' : ev.level === 'warn' ? '#eab308' : '#3b82f6',
                width: '60px',
                textTransform: 'uppercase',
                flexShrink: 0
              }}>
                {ev.level || 'INFO'}
              </span>
              <span style={{ color: '#d4d4d8' }}>
                {ev.message || ev.type}
              </span>
              {ev.detail ? <span style={{ color: '#a1a1aa' }}> — {ev.detail}</span> : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
