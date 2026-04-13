"use client";

import type { BrowserState } from "./types";

interface BrowserViewportProps {
  browserState: BrowserState;
  isTakeoverActive: boolean;
  onToggleTakeover: () => void;
}

export function BrowserViewport({
  browserState,
  isTakeoverActive,
  onToggleTakeover,
}: BrowserViewportProps) {
  const hasScreenshot = browserState.screenshot !== null;

  return (
    <div className="browserViewport" id="browser-viewport">
      {/* Browser chrome */}
      <div className="browserChrome">
        <div className="browserTrafficLights">
          <span className="browserDot browserDotRed" />
          <span className="browserDot browserDotYellow" />
          <span className="browserDot browserDotGreen" />
        </div>

        <div className="browserAddressBar">
          {browserState.isLoading && (
            <span className="browserLoadingIndicator" />
          )}
          <span className="browserUrl">
            {browserState.url === "about:blank" ? "" : browserState.url}
          </span>
        </div>

        <button
          className={`browserTakeoverBtn ${isTakeoverActive ? "browserTakeoverBtnActive" : ""}`}
          id="takeover-toggle-btn"
          onClick={onToggleTakeover}
          title={isTakeoverActive ? "Hand back to agent" : "Take control"}
          type="button"
        >
          {isTakeoverActive ? "🤖 Hand Back" : "🎮 Take Control"}
        </button>
      </div>

      {/* Viewport content */}
      <div className="browserContent">
        {hasScreenshot ? (
          <img
            src={browserState.screenshot!}
            alt={browserState.title || "Browser screenshot"}
            className="browserScreenshot"
            draggable={false}
          />
        ) : (
          <div className="browserEmptyViewport">
            <div className="browserEmptyViewportIcon">
              <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                <rect x="8" y="12" width="48" height="36" rx="4" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
                <line x1="8" y1="22" x2="56" y2="22" stroke="currentColor" strokeWidth="1.5" opacity="0.2" />
                <circle cx="14" cy="17" r="2" fill="currentColor" opacity="0.15" />
                <circle cx="20" cy="17" r="2" fill="currentColor" opacity="0.15" />
                <circle cx="26" cy="17" r="2" fill="currentColor" opacity="0.15" />
                <rect x="16" y="28" width="32" height="4" rx="2" fill="currentColor" opacity="0.08" />
                <rect x="16" y="36" width="24" height="4" rx="2" fill="currentColor" opacity="0.06" />
              </svg>
            </div>
            <p className="browserEmptyViewportTitle">Browser Ready</p>
            <p className="browserEmptyViewportDesc">
              Send a message to start browsing. The agent will navigate and interact with websites for you.
            </p>
          </div>
        )}

        {/* Takeover overlay */}
        {isTakeoverActive && (
          <div className="browserTakeoverOverlay">
            <div className="browserTakeoverBadge">
              🎮 Manual Control Active
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
