import type { ToolEvent } from "../../../contracts/chat";

export function getTimelineDuration(timeline: ToolEvent[]) {
  const earliest = getTimelineStart(timeline);
  let latest = Number.NEGATIVE_INFINITY;

  for (const event of timeline) {
    const timestamp = event.timestamp ? Date.parse(event.timestamp) : Number.NaN;
    if (!Number.isFinite(timestamp)) continue;
    latest = Math.max(latest, timestamp);
  }

  return earliest !== null && Number.isFinite(latest)
    ? Math.max(0, latest - earliest)
    : 0;
}

export function getTimelineStart(timeline: ToolEvent[]) {
  let earliest = Number.POSITIVE_INFINITY;

  for (const event of timeline) {
    const timestamp = event.timestamp ? Date.parse(event.timestamp) : Number.NaN;
    if (Number.isFinite(timestamp)) earliest = Math.min(earliest, timestamp);
  }

  return Number.isFinite(earliest) ? earliest : null;
}

export function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}
