"use client";

import { useRef, useState, useEffect, useMemo } from "react";

import type {
  BrowserScreenshotArtifact,
  RunEvent,
} from "@cua-sample/replay-schema";

import {
  mapRunEventToActivity,
  mapManualLogToActivity,
  mapManualTranscriptToActivity,
} from "./activity-mappers";
import type { ActivityItem, LogEntry, TranscriptEntry } from "./types";

export function useActivityFeed(
  runEvents: RunEvent[],
  screenshots: BrowserScreenshotArtifact[],
  manualLogs: LogEntry[],
  manualTranscript: TranscriptEntry[],
  streamLogs: boolean,
  runStatus: string | undefined,
) {
  const activityFeedRef = useRef<HTMLDivElement | null>(null);
  const [followActivityFeed, setFollowActivityFeed] = useState(true);

  const activityItems = useMemo<ActivityItem[]>(() => {
    return [
      ...runEvents.flatMap((event, index) => {
        const nextEvent = runEvents[index + 1];
        if (
          event.type === "screenshot_captured" &&
          nextEvent?.type === "computer_call_output_recorded" &&
          nextEvent.detail &&
          nextEvent.detail === event.detail
        ) {
          return [];
        }
        return [mapRunEventToActivity(event, screenshots)];
      }),
      ...manualLogs.map(mapManualLogToActivity),
      ...manualTranscript.map(mapManualTranscriptToActivity),
    ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }, [runEvents, screenshots, manualLogs, manualTranscript]);

  const activityFeedLabel = streamLogs ? "live" : "paused";

  // Auto-scroll when following
  useEffect(() => {
    if (!followActivityFeed) return;
    const feed = activityFeedRef.current;
    if (!feed) return;

    if (typeof feed.scrollTo === "function") {
      feed.scrollTo({
        behavior: runStatus === "running" ? "smooth" : "auto",
        top: feed.scrollHeight,
      });
      return;
    }
    feed.scrollTop = feed.scrollHeight;
  }, [activityItems.length, followActivityFeed, runStatus]);

  const handleActivityFeedScroll = () => {
    const feed = activityFeedRef.current;
    if (!feed) return;

    const maxScrollTop = Math.max(0, feed.scrollHeight - feed.clientHeight);
    if (maxScrollTop < 8) {
      setFollowActivityFeed(true);
      return;
    }
    setFollowActivityFeed(maxScrollTop - feed.scrollTop < 40);
  };

  const handleJumpToLatestActivity = () => {
    const feed = activityFeedRef.current;
    if (!feed) return;
    setFollowActivityFeed(true);

    if (typeof feed.scrollTo === "function") {
      feed.scrollTo({ behavior: "smooth", top: feed.scrollHeight });
      return;
    }
    feed.scrollTop = feed.scrollHeight;
  };

  return {
    activityFeedLabel,
    activityFeedRef,
    activityItems,
    followActivityFeed,
    handleActivityFeedScroll,
    handleJumpToLatestActivity,
  };
}
