/**
 * Daily quota tracking.
 *
 * Google allows 10,000 API requests and 75,000 media-byte requests per project
 * per day, both resetting at midnight UTC. Those are separate buckets: fetching
 * a photo's bytes spends the media budget, not the request budget.
 *
 * Tracking them locally does not raise the limit. It changes the failure. An
 * untracked server hits the ceiling and returns a 429 that reads like a
 * transient network problem, so a model retries and burns the rest. A tracked
 * one refuses before the call and says when the budget comes back, which is a
 * thing the caller can actually act on.
 *
 * The count is per process and resets when the server restarts, so it is a
 * floor rather than a true reading: a second client against the same project
 * spends the same budget invisibly. That is worth having anyway, because the
 * common case is one server doing something repetitive in a loop.
 */

import { PhotosError } from "./errors.js";

export const DAILY_REQUESTS = 10_000;
export const DAILY_MEDIA_REQUESTS = 75_000;

function nextMidnightUtc(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(0, 0, 0, 0);
  return next.getTime();
}

export class QuotaTracker {
  private requests = 0;
  private mediaRequests = 0;
  private resetsAt = nextMidnightUtc();

  private rollover(): void {
    if (Date.now() >= this.resetsAt) {
      this.requests = 0;
      this.mediaRequests = 0;
      this.resetsAt = nextMidnightUtc();
    }
  }

  /** Throw before spending a request we know will be refused. */
  check(kind: "request" | "media"): void {
    this.rollover();
    const [used, limit, label] =
      kind === "media"
        ? [this.mediaRequests, DAILY_MEDIA_REQUESTS, "media-byte requests"]
        : [this.requests, DAILY_REQUESTS, "API requests"];

    if (used >= limit) {
      const minutes = Math.max(1, Math.round((this.resetsAt - Date.now()) / 60_000));
      throw new PhotosError(
        `Daily quota reached: ${used} of ${limit} ${label} for this Google Cloud project. It resets at midnight UTC, in about ${minutes} minute(s).`,
        429,
        "RESOURCE_EXHAUSTED",
        "This is a project-wide daily cap, so waiting is the only fix. Batch reads with get_media_items rather than looping get_media_item, which spends one request per item.",
      );
    }
  }

  record(kind: "request" | "media"): void {
    this.rollover();
    if (kind === "media") this.mediaRequests++;
    else this.requests++;
  }

  status(): Record<string, unknown> {
    this.rollover();
    return {
      api_requests: { used: this.requests, limit: DAILY_REQUESTS },
      media_requests: { used: this.mediaRequests, limit: DAILY_MEDIA_REQUESTS },
      resets_at: new Date(this.resetsAt).toISOString(),
      note: "Counted by this server process since it started, so it is a floor. Another client against the same Google Cloud project spends the same budget without appearing here.",
    };
  }
}
