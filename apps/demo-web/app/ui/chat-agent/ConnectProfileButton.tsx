"use client";

import { useState, useEffect, useCallback, useRef } from "react";

type ProfileInfo = {
  name: string;
  hasCookies: boolean;
  cookieCount: number;
  source: string;
  syncedAt: string;
  lastModified: string;
};

type ChromeProfile = {
  directory: string;
  displayName: string;
  email: string;
  isSignedIn: boolean;
};

type ConnectProfileProps = {
  runnerBaseUrl: string;
  selectedProfile?: string;
  onProfileChange?: (p: string) => void;
  /** When true, disable switching (agent is working) */
  isAgentBusy?: boolean;
  /** Send a raw WS message so we can notify the runner */
  sendWsMessage?: (data: object) => void;
};

export function ConnectProfileButton({ runnerBaseUrl, selectedProfile, onProfileChange, isAgentBusy, sendWsMessage }: ConnectProfileProps) {
  const [status, setStatus] = useState<"loading" | "connected" | "not-connected" | "disabled">("loading");
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [action, setAction] = useState<"idle" | "switching" | "clearing" | "cloning">("idle");
  const [menuOpen, setMenuOpen] = useState(false);
  const [cloneMenuOpen, setCloneMenuOpen] = useState(false);
  const [chromeProfiles, setChromeProfiles] = useState<ChromeProfile[]>([]);
  const [chromeRunning, setChromeRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(`${runnerBaseUrl}/api/browser/profile-status?profileName=${selectedProfile || "default"}`);
      const data = await res.json();
      if (!data.persist) {
        setStatus("disabled");
        return;
      }

      const profilesRes = await fetch(`${runnerBaseUrl}/api/browser/profiles`);
      const profilesData = await profilesRes.json();
      const profileList: ProfileInfo[] = profilesData.profiles || [];

      setProfiles(profileList);

      // Auto-select the first profile with cookies, or default
      if (!selectedProfile && profileList.length > 0) {
        const withCookies = profileList.find(p => p.hasCookies && p.name !== "default");
        const fallback = profileList.find(p => p.name === "default") ?? profileList[0];
        const best = withCookies ?? fallback;
        if (best) onProfileChange?.(best.name);
      }

      // Determine connected state based on whether selected profile has cookies
      const current = profileList.find(p => p.name === (selectedProfile || "default"));
      if (current?.hasCookies) {
        setStatus("connected");
      } else {
        setStatus("not-connected");
      }
    } catch {
      setStatus("not-connected");
    }
  }, [runnerBaseUrl, selectedProfile, onProfileChange]);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus, menuOpen]);

  // Poll for new profiles every 10s (extension may sync while menu is closed)
  useEffect(() => {
    const interval = setInterval(() => void checkStatus(), 10_000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  // Close menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setCloneMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [menuOpen]);

  const showMessage = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 6000);
  };

  const handleClearProfile = async () => {
    setAction("clearing");
    setMenuOpen(false);
    try {
      await fetch(`${runnerBaseUrl}/api/browser/clear-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileName: selectedProfile }),
      });
      showMessage("Profile cleared from server.");
      onProfileChange?.("default");
    } catch {
      showMessage("Failed to clear profile.");
    }
    setAction("idle");
    void checkStatus();
  };

  // Fetch Chrome profiles for clone menu
  const loadChromeProfiles = async () => {
    try {
      const res = await fetch(`${runnerBaseUrl}/api/browser/chrome-profiles`);
      const data = await res.json();
      setChromeProfiles(data.profiles || []);
      setChromeRunning(data.chromeRunning ?? false);
    } catch {
      setChromeProfiles([]);
      showMessage("Failed to detect Chrome profiles.");
    }
  };

  const handleCloneProfile = async (cp: ChromeProfile) => {
    if (chromeRunning) {
      showMessage("⚠️ Close Chrome completely before cloning. Chrome locks its database files while running.");
      return;
    }

    setAction("cloning");
    setCloneMenuOpen(false);
    setMenuOpen(false);

    try {
      const res = await fetch(`${runnerBaseUrl}/api/browser/clone-chrome-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileDirectory: cp.directory,
          profileName: cp.email || cp.directory,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        showMessage(`❌ Clone failed: ${data.error || data.hint || "Unknown error"}`);
        setAction("idle");
        return;
      }

      const profileName = data.profileName || cp.email || cp.directory;
      showMessage(`✅ Cloned "${cp.displayName}" — ${data.filesCopied} files, ${Math.round((data.sizeBytes || 0) / 1024 / 1024)}MB`);

      // Select the newly cloned profile
      onProfileChange?.(profileName);
      if (sendWsMessage) {
        sendWsMessage({ type: "switch_profile", profileName });
      }
    } catch (err) {
      showMessage(`❌ Clone error: ${err}`);
    }

    setAction("idle");
    void checkStatus();
  };

  if (status === "loading" || status === "disabled") return null;

  const busy = action !== "idle";
  const currentProfile = profiles.find(p => p.name === (selectedProfile || "default"));
  const isConnected = currentProfile?.hasCookies ?? false;
  const dotColor = isConnected ? "#22c55e" : "#ef4444";

  // Display name: show full email for named profiles
  const getDisplayName = (name: string): string => {
    if (name === "default") return "Guest (No cookies)";
    return name;
  };

  // Shorten for pill display (strip @gmail.com etc.)
  const getPillName = (name: string): string => {
    if (name === "default") return "Select Profile";
    return name.replace(/@gmail\.com$/, "").replace(/@.*$/, "");
  };

  const label =
    action === "switching" ? "Switching…" :
    action === "clearing" ? "Clearing…" :
    action === "cloning" ? "Cloning…" :
    isConnected && selectedProfile
      ? getPillName(selectedProfile)
      : "Select Profile";

  // Format relative time
  const formatSyncTime = (iso: string): string => {
    if (!iso) return "";
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  return (
    <div className="profileDropdownWrapper" ref={menuRef}>
      <button
        className={`profilePillBtn ${isConnected ? "profilePillConnected" : "profilePillDisconnected"} ${busy ? "profilePillBusy" : ""}`}
        onClick={() => !busy && setMenuOpen((v) => !v)}
        type="button"
        disabled={busy}
      >
        <span className="profilePillDot" style={{ background: dotColor }} />
        <span className="profilePillLabel">{label}</span>
        <svg className={`profilePillChevron ${menuOpen ? "profilePillChevronOpen" : ""}`} width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2.5 3.75L5 6.25L7.5 3.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {menuOpen && (
        <div className="profileDropdownMenu">
          <div className="profileDropdownHeader">
            <span className="profileDropdownDot" style={{ background: dotColor }} />
            <span>Select Active Profile</span>
          </div>

          <div style={{ padding: "8px" }}>
            {profiles.map((p) => {
              const isSelected = (selectedProfile || "default") === p.name;
              return (
                <button
                  key={p.name}
                  className={`profileDropdownItem ${isSelected ? "active" : ""}`}
                  onClick={() => {
                    if (isAgentBusy) {
                      showMessage("⏳ Cannot switch profiles while agent is working. Stop the task first.");
                      setMenuOpen(false);
                      return;
                    }
                    if (isSelected) {
                      setMenuOpen(false);
                      return;
                    }
                    const prevProfile = selectedProfile;
                    onProfileChange?.(p.name);
                    setMenuOpen(false);
                    showMessage(`✅ Switched to ${getDisplayName(p.name)}`);
                    // Notify the runner to re-launch browser with new profile
                    if (sendWsMessage && prevProfile !== p.name) {
                      sendWsMessage({ type: "switch_profile", profileName: p.name });
                    }
                  }}
                  type="button"
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    gap: "10px",
                    opacity: isSelected ? 1 : 0.75,
                    padding: "8px 10px",
                  }}
                >
                  {/* Selection check */}
                  <span style={{ width: "16px", flexShrink: 0, textAlign: "center", fontSize: "0.8rem" }}>
                    {isSelected ? "✓" : ""}
                  </span>

                  {/* Profile info */}
                  <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}>
                      {getDisplayName(p.name)}
                      {p.hasCookies && (
                        <span style={{
                          width: "6px",
                          height: "6px",
                          borderRadius: "50%",
                          background: "#22c55e",
                          flexShrink: 0,
                        }} />
                      )}
                    </div>
                    {/* Cookie metadata */}
                    {p.hasCookies && (
                      <div style={{
                        fontSize: "0.68rem",
                        color: "rgba(255,255,255,0.35)",
                        marginTop: "2px",
                      }}>
                        {p.cookieCount} cookies • synced {formatSyncTime(p.syncedAt)}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Clone Chrome Profile sub-menu */}
          {cloneMenuOpen && (
            <div style={{
              borderTop: "1px solid rgba(255,255,255,0.06)",
              padding: "8px",
              maxHeight: "200px",
              overflowY: "auto",
            }}>
              <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.4)", padding: "4px 10px 8px", display: "flex", alignItems: "center", gap: "6px" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {chromeRunning
                  ? <span style={{ color: "#f87171" }}>Close Chrome first to clone profiles!</span>
                  : <span>Select a Chrome profile to clone (full session)</span>
                }
              </div>
              {chromeProfiles.length === 0 && (
                <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.3)", padding: "8px 10px", textAlign: "center" }}>
                  No Chrome profiles detected
                </div>
              )}
              {chromeProfiles.map((cp) => (
                <button
                  key={cp.directory}
                  className="profileDropdownItem"
                  onClick={() => void handleCloneProfile(cp)}
                  type="button"
                  disabled={chromeRunning}
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: "10px",
                    padding: "8px 10px",
                    opacity: chromeRunning ? 0.4 : 0.85,
                    cursor: chromeRunning ? "not-allowed" : "pointer",
                  }}
                >
                  <span style={{ width: "16px", flexShrink: 0, textAlign: "center", fontSize: "0.85rem" }}>🔄</span>
                  <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                    <div style={{
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}>
                      {cp.displayName}
                      {cp.isSignedIn && (
                        <span style={{
                          width: "6px",
                          height: "6px",
                          borderRadius: "50%",
                          background: "#3b82f6",
                          flexShrink: 0,
                        }} />
                      )}
                    </div>
                    {cp.email && (
                      <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.35)", marginTop: "2px" }}>
                        {cp.email} • {cp.directory}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Bottom actions row */}
          <div style={{ display: "flex", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <button
              className="profileDropdownItem"
              onClick={() => {
                if (!cloneMenuOpen) {
                  void loadChromeProfiles();
                }
                setCloneMenuOpen((v) => !v);
              }}
              title="Clone Chrome Profile (full session)"
              style={{ flex: 1, justifyContent: "center", color: "#a78bfa", gap: "6px", fontSize: "0.8rem", padding: "10px", background: "transparent" }}
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Clone Profile
            </button>
            <a
              href="/agent-john-wick-extension.zip"
              download
              title="Download Extension"
              className="profileDropdownItem"
              style={{ flex: 1, justifyContent: "center", color: "#60a5fa", gap: "6px", fontSize: "0.8rem", padding: "10px", textDecoration: "none", borderLeft: "1px solid rgba(255,255,255,0.06)" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Extension
            </a>
            {isConnected && (
              <button
                className="profileDropdownItem"
                onClick={() => void handleClearProfile()}
                title="Disconnect selected profile"
                style={{ flex: 1, justifyContent: "center", color: "#f87171", borderLeft: "1px solid rgba(255,255,255,0.06)", gap: "6px", fontSize: "0.8rem", padding: "10px", background: "transparent" }}
                type="button"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" />
                </svg>
                Disconnect
              </button>
            )}
          </div>
        </div>
      )}

      {message && (
        <div className="profileToast">
          <span>{message}</span>
          <button className="profileToastClose" onClick={() => setMessage(null)} type="button">✕</button>
        </div>
      )}
    </div>
  );
}
