export function estimateComparisonDuration(durations: number[]): number {
  const recent = durations.filter((duration) => Number.isFinite(duration) && duration > 0).slice(-5).sort((left, right) => left - right);
  if (recent.length === 0) return 70000;
  const middle = Math.floor(recent.length / 2);
  return recent.length % 2 ? recent[middle] : (recent[middle - 1] + recent[middle]) / 2;
}

export function comparisonProgress(elapsedMs: number, expectedMs: number) {
  const elapsed = Math.max(0, elapsedMs);
  const expected = Math.max(1000, expectedMs);
  return {
    percent: Math.min(95, Math.floor(elapsed / expected * 100)),
    remainingMs: Math.max(0, expected - elapsed),
    overdue: elapsed >= expected,
  };
}

export function formatComparisonTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;
}