"use client";

import { appName, appSubtitle } from "./helpers";

type ConsoleTopbarProps = {
  runnerBaseUrl: string;
  runnerOnline: boolean;
  stageHeadline: string;
  selectedProfile?: string;
  onProfileChange?: (p: string) => void;
};

import { ConnectProfileButton } from "./RunControls";

export function ConsoleTopbar({
  runnerBaseUrl,
  runnerOnline,
  stageHeadline,
  selectedProfile,
  onProfileChange,
}: ConsoleTopbarProps) {
  return (
    <header className="consoleTopbar">
      <div className="brandBlock" style={{ gap: '16px' }}>
        <div className="brandMark" style={{ display: 'flex', alignItems: 'center' }}>
          <img src="https://www.ibridgedigital.com/assets/img/iblogo.png" alt="IB Logo" style={{ height: '24px', objectFit: 'contain' }} />
        </div>
        <div className="brandCopy" style={{ margin: 0 }}>
          <span style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text)' }}>{appName}</span>
        </div>
      </div>
      <div className="statusCluster" style={{ gap: '16px' }}>
        <ConnectProfileButton
          runnerBaseUrl={runnerBaseUrl}
          {...(selectedProfile !== undefined ? { selectedProfile } : {})}
          {...(onProfileChange !== undefined ? { onProfileChange } : {})}
        />
        <div className="topbarStatusPill" style={{ background: 'rgba(255, 255, 255, 0.04)', padding: '6px 14px', borderRadius: '16px' }}>
          {stageHeadline}
        </div>
      </div>
    </header>
  );
}
