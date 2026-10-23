import { describe, expect, it } from "vitest";
import { comparisonProgress, estimateComparisonDuration, formatComparisonTime } from "./comparisonProgress";

describe("estimated comparison progress", () => {
  it("starts with the observed baseline and learns from recent completed runs", () => {
    expect(estimateComparisonDuration([])).toBe(70000);
    expect(estimateComparisonDuration([60000, 80000])).toBe(70000);
    expect(estimateComparisonDuration([900000, 60000, 65000, 70000, 75000, 80000])).toBe(70000);
  });

  it("shows estimated remaining time while a query is running", () => {
    expect(comparisonProgress(35000, 70000)).toEqual({ percent: 50, remainingMs: 35000, overdue: false });
  });

  it("does not claim completion when the estimate is exceeded", () => {
    expect(comparisonProgress(90000, 70000)).toEqual({ percent: 95, remainingMs: 0, overdue: true });
  });

  it("formats short and long countdowns", () => {
    expect(formatComparisonTime(70000)).toBe("1m 10s");
    expect(formatComparisonTime(34500)).toBe("35s");
    expect(formatComparisonTime(0)).toBe("0s");
  });
});