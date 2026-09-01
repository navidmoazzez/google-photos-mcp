/**
 * The upstream client.
 *
 * Two hosts, because Google Photos is genuinely two APIs with separate quotas
 * and separate scopes:
 *   photospicker.googleapis.com   the picker session flow
 *   photoslibrary.googleapis.com  albums, uploads, app-created media
 *
 * Everything above this layer talks in paths, never full URLs, so a tool cannot
 * accidentally send a library-scoped token to the picker host.
 */

import { PhotosError, toPhotosError } from "./errors.js";
import { TokenStore } from "./auth.js";
import { QuotaTracker } from "./quota.js";
import type { Config } from "../config.js";

export const PICKER_BASE = "https://photospicker.googleapis.com/v1";
export const LIBRARY_BASE = "https://photoslibrary.googleapis.com/v1";
const UPLOAD_URL = "https://photoslibrary.googleapis.com/v1/uploads";

export type Api = "picker" | "library";

export class PhotosClient {
  private readonly config: Config;
  private readonly tokens: TokenStore;
  readonly quota = new QuotaTracker();

  constructor(config: Config) {
    this.config = config;
    this.tokens = new TokenStore(config);
  }

  async accessToken(): Promise<string> {
    return this.tokens.accessToken();
  }

  private base(api: Api): string {
    return api === "picker" ? PICKER_BASE : LIBRARY_BASE;
  }

  /**
   * One request, with a deadline and a bounded retry.
   *
   * Retries only 429 and 5xx, and only for idempotent verbs. Retrying a POST
   * that creates an album would create two of them, which is a worse failure
   * than the one being retried.
   */
  async request<T>(
    api: Api,
    path: string,
    init: { method?: string; body?: unknown; query?: Record<string, string | number | undefined> } = {},
  ): Promise<T> {
    const method = init.method ?? "GET";
    const url = new URL(`${this.base(api)}${path}`);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }

    const retryable = method === "GET" || method === "HEAD";
    const attempts = retryable ? this.config.maxRetries + 1 : 1;
    let lastError: unknown;

    // Checked once, before the first attempt. A retry of an already-counted
    // call should not be billed twice, and should not be blocked by a ceiling
    // the original call was under.
    this.quota.check("request");
    this.quota.record("request");

    for (let attempt = 0; attempt < attempts; attempt++) {
      const token = await this.tokens.accessToken();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

      try {
        const response = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": this.config.userAgent,
            ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
          signal: controller.signal,
        });

        if (response.ok) {
          if (response.status === 204) return {} as T;
          const text = await response.text();
          return (text ? JSON.parse(text) : {}) as T;
        }

        const error = await toPhotosError(response, `${method} ${path}`);
        // 429 and 5xx are the only ones worth a second try. A 403 for a missing
        // scope will fail identically forever.
        if (attempt < attempts - 1 && (response.status === 429 || response.status >= 500)) {
          lastError = error;
          await sleep(400 * 2 ** attempt);
          continue;
        }
        throw error;
      } catch (error) {
        if ((error as Error)?.name === "AbortError") {
          throw new PhotosError(
            `${method} ${path} timed out after ${this.config.requestTimeoutMs}ms. Raise GOOGLE_PHOTOS_REQUEST_TIMEOUT_MS if the network is slow, or lower the page size.`,
            408,
            "DEADLINE_EXCEEDED",
          );
        }
        if (error instanceof PhotosError && attempt >= attempts - 1) throw error;
        if (!(error instanceof PhotosError)) throw error;
        lastError = error;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new PhotosError(`${method} ${path} failed`, 500, "UNKNOWN");
  }

  /**
   * Step one of a two-step upload: send the bytes, get an upload token back.
   *
   * The Library API does not accept bytes and metadata in one call. The token
   * this returns is then passed to batchCreate, which is what actually makes
   * the media item. A token that is never used simply expires.
   */
  async uploadBytes(bytes: Uint8Array, filename: string, mimeType: string): Promise<string> {
    const token = await this.tokens.accessToken();
    const controller = new AbortController();
    // Uploads are bytes over the wire, so they get a longer deadline than a
    // metadata call. A 40MB video on a domestic connection outlasts 30s easily.
    const timer = setTimeout(() => controller.abort(), Math.max(this.config.requestTimeoutMs, 120_000));

    try {
      const response = await fetch(UPLOAD_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "X-Goog-Upload-Content-Type": mimeType,
          "X-Goog-Upload-Protocol": "raw",
          "X-Goog-File-Name": filename,
          "User-Agent": this.config.userAgent,
        },
        body: bytes as unknown as RequestInit["body"],
        signal: controller.signal,
      });

      if (!response.ok) throw await toPhotosError(response, "upload bytes");
      const uploadToken = (await response.text()).trim();
      if (!uploadToken) {
        throw new PhotosError("Upload returned an empty token.", 502, "EMPTY_UPLOAD_TOKEN");
      }
      return uploadToken;
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        throw new PhotosError(
          "The upload timed out. Large videos need a longer deadline: raise GOOGLE_PHOTOS_REQUEST_TIMEOUT_MS.",
          408,
          "DEADLINE_EXCEEDED",
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Fetch bytes from a baseUrl or any public URL, with a size ceiling. */
  async fetchBytes(url: string, maxBytes: number): Promise<{ bytes: Uint8Array; mimeType: string }> {
    // Media bytes come out of their own 75,000/day budget, not the 10,000 one.
    this.quota.check("media");
    this.quota.record("media");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(this.config.requestTimeoutMs, 120_000));
    try {
      // A Google baseUrl needs the bearer token; an arbitrary public URL must
      // not receive it. Sending a Google access token to a third-party host
      // would leak the credential to whoever runs that host.
      const isGoogle = /^https:\/\/[^/]*\.googleusercontent\.com\//.test(url);
      const headers: Record<string, string> = { "User-Agent": this.config.userAgent };
      if (isGoogle) headers.Authorization = `Bearer ${await this.tokens.accessToken()}`;

      const response = await fetch(url, { headers, signal: controller.signal });
      if (!response.ok) throw await toPhotosError(response, `fetch ${url.slice(0, 80)}`);

      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared && declared > maxBytes) {
        throw new PhotosError(
          `That file is ${(declared / 1e6).toFixed(1)}MB, over the ${(maxBytes / 1e6).toFixed(0)}MB limit for this tool.`,
          413,
          "TOO_LARGE",
        );
      }

      const buffer = new Uint8Array(await response.arrayBuffer());
      // Servers lie about or omit content-length, so the real size is checked
      // again once the body has actually arrived.
      if (buffer.byteLength > maxBytes) {
        throw new PhotosError(
          `That file is ${(buffer.byteLength / 1e6).toFixed(1)}MB, over the ${(maxBytes / 1e6).toFixed(0)}MB limit for this tool.`,
          413,
          "TOO_LARGE",
        );
      }

      return {
        bytes: buffer,
        mimeType: response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
