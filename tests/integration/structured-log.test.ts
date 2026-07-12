import { afterEach, describe, expect, it, vi } from "vitest";

import { writeStructuredLog } from "../../src/operations/structured-log";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("structured operational logging", () => {
  it("writes one timestamped JSON record at the requested level", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T14:10:00Z"));
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    writeStructuredLog("warn", "source-status-poll-degraded", {
      consecutiveFailures: 3,
      error: {
        name: "TimeoutError",
        message: "Source status read timed out.",
      },
    });

    expect(warning).toHaveBeenCalledOnce();
    expect(JSON.parse(String(warning.mock.calls[0]?.[0]))).toEqual({
      timestamp: "2026-07-12T14:10:00Z",
      level: "warn",
      event: "source-status-poll-degraded",
      consecutiveFailures: 3,
      error: {
        name: "TimeoutError",
        message: "Source status read timed out.",
      },
    });
  });
});
