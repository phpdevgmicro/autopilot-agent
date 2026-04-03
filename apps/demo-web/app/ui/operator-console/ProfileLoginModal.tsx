"use client";

import { useState, useEffect, useRef, useCallback } from "react";

type Props = {
  runnerBaseUrl: string;
  isOpen: boolean;
  onClose: () => void;
  onProfileSaved: () => void;
};

const VP_W = 1280;
const VP_H = 900;

// Polling intervals
const FAST_POLL_MS = 800;   // After user interaction
const SLOW_POLL_MS = 3000;  // When idle
const FAST_DURATION_MS = 5000; // How long to stay in fast mode

export function ProfileLoginModal({ runnerBaseUrl, isOpen, onClose, onProfileSaved }: Props) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [clickPos, setClickPos] = useState<{ x: number; y: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevUrl = useRef<string | null>(null);
  const isFetching = useRef(false);
  const lastInteraction = useRef(0);
  const mountedRef = useRef(true);

  // Smart polling: fast after interaction, slows down when idle
  const scheduleNextPoll = useCallback(() => {
    if (!mountedRef.current || !isOpen) return;

    const timeSinceInteraction = Date.now() - lastInteraction.current;
    const interval = timeSinceInteraction < FAST_DURATION_MS ? FAST_POLL_MS : SLOW_POLL_MS;

    timerRef.current = setTimeout(async () => {
      if (!mountedRef.current || !isOpen) return;
      if (isFetching.current) { scheduleNextPoll(); return; } // Skip if previous still running

      isFetching.current = true;
      try {
        const r = await fetch(`${runnerBaseUrl}/api/browser/login-screenshot`, { cache: "no-store" });
        if (!r.ok) { isFetching.current = false; scheduleNextPoll(); return; }
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        if (prevUrl.current) URL.revokeObjectURL(prevUrl.current);
        prevUrl.current = url;
        if (mountedRef.current) setImgSrc(url);
      } catch { /* retry next tick */ }
      isFetching.current = false;
      scheduleNextPoll();
    }, interval);
  }, [isOpen, runnerBaseUrl]);

  // Mark recent interaction → triggers fast polling
  const markInteraction = useCallback(() => {
    lastInteraction.current = Date.now();
  }, []);

  // Init/cleanup polling
  useEffect(() => {
    mountedRef.current = true;

    if (!isOpen) {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (prevUrl.current) URL.revokeObjectURL(prevUrl.current);
      setImgSrc(null);
      return;
    }

    // Initial fetch
    lastInteraction.current = Date.now(); // Start in fast mode
    (async () => {
      try {
        const r = await fetch(`${runnerBaseUrl}/api/browser/login-screenshot`, { cache: "no-store" });
        if (r.ok) {
          const blob = await r.blob();
          const url = URL.createObjectURL(blob);
          if (prevUrl.current) URL.revokeObjectURL(prevUrl.current);
          prevUrl.current = url;
          if (mountedRef.current) setImgSrc(url);
        }
      } catch { /* ok */ }
      scheduleNextPoll();
    })();

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (prevUrl.current) { URL.revokeObjectURL(prevUrl.current); prevUrl.current = null; }
    };
  }, [isOpen, runnerBaseUrl, scheduleNextPoll]);

  const sendClick = useCallback(async (e: React.MouseEvent<HTMLImageElement>) => {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) * (VP_W / rect.width));
    const y = Math.round((e.clientY - rect.top) * (VP_H / rect.height));

    setClickPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setTimeout(() => setClickPos(null), 500);

    markInteraction();
    await fetch(`${runnerBaseUrl}/api/browser/login-click`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y }),
    }).catch(() => {});
  }, [runnerBaseUrl, markInteraction]);

  const sendText = async () => {
    if (!text) return;
    markInteraction();
    await fetch(`${runnerBaseUrl}/api/browser/login-type`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).catch(() => {});
    setText("");
  };

  const sendKey = async (key: string) => {
    markInteraction();
    await fetch(`${runnerBaseUrl}/api/browser/login-keypress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    }).catch(() => {});
  };

  // Any close action auto-saves the profile
  const closeAndSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    await fetch(`${runnerBaseUrl}/api/browser/finish-profile-login`, { method: "POST" }).catch(() => {});
    setSaving(false);
    onProfileSaved();
    onClose();
  }, [runnerBaseUrl, saving, onProfileSaved, onClose]);

  if (!isOpen) return null;

  return (
    <div className="loginModalOverlay" onClick={(e) => { if (e.target === e.currentTarget) void closeAndSave(); }}>
      <div className="loginModal">
        <div className="loginModalHeader">
          <span className="loginModalTitle">🔐 Google Account Login</span>
          <span className="loginModalHint">Click on the browser to interact • Type below to enter text</span>
          <button className="loginModalCloseBtn" onClick={() => void closeAndSave()} type="button">✕</button>
        </div>

        <div className="loginModalBrowser">
          {imgSrc ? (
            <div className="loginModalImgWrap">
              <img
                ref={imgRef}
                src={imgSrc}
                alt="Remote browser"
                className="loginModalScreenshot"
                onClick={(e) => void sendClick(e)}
                draggable={false}
              />
              {clickPos && (
                <div className="loginClickRipple" style={{ left: clickPos.x, top: clickPos.y }} />
              )}
            </div>
          ) : (
            <div className="loginModalLoading">
              <div className="loginModalSpinner" />
              <span>Launching browser…</span>
            </div>
          )}
        </div>

        <div className="loginModalControls">
          <div className="loginModalInputRow">
            <input
              className="loginModalInput"
              placeholder="Type text here, then press ↵ to send…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void sendText(); } }}
              autoFocus
            />
            <button className="loginModalSendBtn" onClick={() => void sendText()} type="button" title="Send text">↵</button>
          </div>
          <div className="loginModalKeyRow">
            <button className="loginModalKeyBtn" onClick={() => void sendKey("Tab")} type="button">Tab</button>
            <button className="loginModalKeyBtn" onClick={() => void sendKey("Enter")} type="button">Enter</button>
            <button className="loginModalKeyBtn" onClick={() => void sendKey("Backspace")} type="button">⌫</button>
            <button className="loginModalKeyBtn" onClick={() => void sendKey("Escape")} type="button">Esc</button>
            <div style={{ flex: 1 }} />
            <button
              className="loginModalDoneBtn"
              onClick={() => void closeAndSave()}
              disabled={saving}
              type="button"
            >
              {saving ? "Saving…" : "✓ Done"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
