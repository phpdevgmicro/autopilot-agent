"use client";

import type { RefObject } from "react";
import type { BrowserScreenshotArtifact } from "@cua-sample/replay-schema";
import { ActivityFeed } from "./ActivityFeed";
import type { ActivityItem } from "./types";

type ActivityDrawerProps = {
  activityFeedLabel: string;
  activityFeedRef: RefObject<HTMLDivElement | null>;
  activityItems: ActivityItem[];
  followActivityFeed: boolean;
  isOpen: boolean;
  onActivityFeedScroll: () => void;
  onClose: () => void;
  onJumpToLatestActivity: () => void;
  onSelectScreenshot: (screenshotId: string) => void;
  onStreamLogsChange: (value: boolean) => void;
  screenshots: BrowserScreenshotArtifact[];
  streamLogs: boolean;
};

export function ActivityDrawer({
  activityFeedLabel,
  activityFeedRef,
  activityItems,
  followActivityFeed,
  isOpen,
  onActivityFeedScroll,
  onClose,
  onJumpToLatestActivity,
  onSelectScreenshot,
  onStreamLogsChange,
  screenshots,
  streamLogs,
}: ActivityDrawerProps) {
  return (
    <>
      <div
        className={`activityDrawerBackdrop ${isOpen ? "open" : ""}`}
        onClick={onClose}
      />
      <aside className={`activityDrawer ${isOpen ? "open" : ""}`}>
        <div className="activityDrawerHeader">
          <h2>Agent Activity</h2>
          <button
            className="activityDrawerClose"
            onClick={onClose}
            type="button"
            aria-label="Close activity panel"
          >
            ✕
          </button>
        </div>
        <ActivityFeed
          activityFeedLabel={activityFeedLabel}
          activityFeedRef={activityFeedRef}
          activityItems={activityItems}
          followActivityFeed={followActivityFeed}
          onActivityFeedScroll={onActivityFeedScroll}
          onJumpToLatestActivity={onJumpToLatestActivity}
          onSelectScreenshot={onSelectScreenshot}
          onStreamLogsChange={onStreamLogsChange}
          screenshots={screenshots}
          streamLogs={streamLogs}
        />
      </aside>
    </>
  );
}
