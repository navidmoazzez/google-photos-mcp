/**
 * Tests run against the built server and a faked fetch, never the network.
 *
 * The things worth pinning down are the ones that silently produce a wrong
 * answer rather than an error: a guard that lets an upload through without
 * confirmation, a read-only server that still advertises writes, a filter that
 * builds the wrong request body.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildServer } from "../src/server.js";
import { loadConfig, cleanEnv, isConfigured, missingCredentials, selectAccount } from "../src/config.js";
import { WriteGuard } from "../src/safety.js";
import { shapeItem, shapeAlbum, page } from "../src/format/items.js";
import { ALL_TOOLS } from "../src/tools/index.js";

const account = { name: "default", clientId: "id", clientSecret: "secret", refreshToken: "refresh" };

const baseConfig = {
  accounts: [account],
  preferred: [],
  readOnly: false,
  allowDestructive: true,
  requestTimeoutMs: 1000,
  maxRetries: 0,
  userAgent: "test",
  authPort: 4180,
};

describe("config", () => {
  it("strips the literal backslash-n a copy-paste leaves behind", () => {
    // A secret pasted out of a quoted shell string carries "\n" as two
    // characters. trim() cannot see it and Google rejects the result as
    // invalid_client, which reads like the wrong secret entirely.
    expect(cleanEnv("abc\\n")).toBe("abc");
    expect(cleanEnv("  abc  ")).toBe("abc");
    expect(cleanEnv(undefined)).toBe("");
  });

  it("names exactly what is missing", () => {
    const broken = { ...baseConfig, accounts: [{ ...account, refreshToken: "" }] };
    expect(isConfigured(broken)).toBe(false);
    expect(missingCredentials(broken)).toEqual(["GOOGLE_PHOTOS_REFRESH_TOKEN"]);
  });

  it("prefers an exact account name over a prefix of a longer one", () => {
    // "navid" is a prefix of "navid-brand". A pure prefix match would be
    // ambiguous and could send an upload to the wrong library.
    const multi = {
      ...baseConfig,
      accounts: [
        { ...account, name: "navid-brand" },
        { ...account, name: "navid" },
      ],
    };
    expect(selectAccount(multi, "navid").name).toBe("navid");
    expect(selectAccount(multi, "navid-brand").name).toBe("navid-brand");
  });

  it("refuses an ambiguous prefix rather than guessing", () => {
    const multi = {
      ...baseConfig,
      accounts: [
        { ...account, name: "work-one" },
        { ...account, name: "work-two" },
      ],
    };
    expect(() => selectAccount(multi, "work")).toThrow(/more than one account/);
  });

  it("honours the preferred account when a tool names none", () => {
    const multi = {
      ...baseConfig,
      accounts: [{ ...account, name: "personal" }, { ...account, name: "brand" }],
      preferred: ["brand"],
    };
    expect(selectAccount(multi).name).toBe("brand");
  });

  it("names the configured accounts when asked for one that does not exist", () => {
    expect(() => selectAccount(baseConfig, "nope")).toThrow(/Configured: default/);
  });

  it("defaults to writes enabled", () => {
    const config = loadConfig();
    expect(config.readOnly).toBe(false);
    expect(config.allowDestructive).toBe(true);
  });
});

describe("write guard", () => {
  it("lets reads through untouched", () => {
    const guard = new WriteGuard(baseConfig);
    expect(() => guard.check("list_albums", "read", undefined, "")).not.toThrow();
  });

  it("lets a reversible write through without confirmation", () => {
    // Renaming an album is one call to undo. Requiring confirm here would
    // train a model to pass it reflexively on the calls that matter.
    const guard = new WriteGuard(baseConfig);
    expect(() => guard.check("update_album", "write", undefined, "rename")).not.toThrow();
  });

  it("refuses an irreversible write without confirm", () => {
    const guard = new WriteGuard(baseConfig);
    expect(() => guard.check("upload_from_url", "destructive", undefined, "upload 3 files")).toThrow(
      /confirm: true/,
    );
  });

  it("allows an irreversible write with confirm", () => {
    const guard = new WriteGuard(baseConfig);
    expect(() => guard.check("upload_from_url", "destructive", true, "upload 3 files")).not.toThrow();
  });

  it("blocks every write in read-only mode, confirmed or not", () => {
    const guard = new WriteGuard({ ...baseConfig, readOnly: true });
    expect(() => guard.check("create_album", "write", true, "x")).toThrow(/READ_ONLY/);
    expect(() => guard.check("upload_from_url", "destructive", true, "x")).toThrow(/READ_ONLY/);
  });

  it("blocks irreversible writes when destructive is disabled but keeps ordinary ones", () => {
    const guard = new WriteGuard({ ...baseConfig, allowDestructive: false });
    expect(() => guard.check("upload_from_url", "destructive", true, "x")).toThrow(/ALLOW_DESTRUCTIVE/);
    expect(() => guard.check("create_album", "write", undefined, "x")).not.toThrow();
  });
});

describe("tool surface", () => {
  it("registers every tool", () => {
    expect(buildServer(baseConfig).toolCount).toBe(ALL_TOOLS.length);
  });

  it("hides writes entirely in read-only mode rather than failing them on call", () => {
    // A model cannot misuse a tool it cannot see. Erroring on call instead
    // would put the refusal in the transcript on every attempt.
    const built = buildServer({ ...baseConfig, readOnly: true });
    expect(built.toolCount).toBe(ALL_TOOLS.filter((t) => t.risk === "read").length);
    expect(built.toolCount).toBeLessThan(ALL_TOOLS.length);
  });

  it("puts confirm on every irreversible tool and on no other", () => {
    for (const tool of ALL_TOOLS) {
      const hasConfirm = "confirm" in tool.schema;
      expect(hasConfirm, `${tool.name} confirm arg`).toBe(tool.risk === "destructive");
    }
  });

  it("gives every tool a description long enough to be useful to a model", () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.description.length, `${tool.name} description`).toBeGreaterThan(80);
      expect(tool.title.length, `${tool.name} title`).toBeGreaterThan(0);
    }
  });

  it("marks the uploads as the destructive ones", () => {
    const destructive = ALL_TOOLS.filter((t) => t.risk === "destructive").map((t) => t.name).sort();
    expect(destructive).toEqual([
      "create_album_with_media",
      "save_to_library",
      "upload_file",
      "upload_from_url",
    ]);
  });
});

describe("formatting", () => {
  it("keeps what a model reasons about and drops camera noise", () => {
    const shaped = shapeItem({
      id: "abc",
      filename: "IMG_1.jpg",
      mimeType: "image/jpeg",
      baseUrl: "https://lh3.googleusercontent.com/x",
      mediaMetadata: {
        creationTime: "2026-01-02T03:04:05Z",
        width: "4032",
        height: "3024",
        photo: { cameraMake: "Apple", focalLength: 4.2 },
      },
    });
    expect(shaped).toMatchObject({ id: "abc", kind: "photo", width: 4032, height: 3024 });
    expect(JSON.stringify(shaped)).not.toContain("focalLength");
  });

  it("reads a video as a video", () => {
    expect(shapeItem({ mimeType: "video/mp4", mediaMetadata: { video: { status: "READY" } } }).kind).toBe("video");
  });

  it("reports an album that this app cannot edit", () => {
    expect(shapeAlbum({ id: "a", title: "T", mediaItemsCount: "4", isWriteable: false })).toMatchObject({
      item_count: 4,
      writeable: false,
    });
  });

  it("signals more pages only when there is a token", () => {
    expect(page([1], "tok")).toMatchObject({ more: true, next_page_token: "tok" });
    expect(page([1], undefined)).toMatchObject({ more: false });
  });
});

describe("search filters", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    // The token refresh comes first on any call.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "tok", expires_in: 3600 }),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  async function callSearch(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ mediaItems: [] }),
    });
    const { PhotosClient } = await import("../src/api/client.js");
    const { QuotaTracker } = await import("../src/api/quota.js");
    const { mediaTools } = await import("../src/tools/media.js");
    const tool = mediaTools.find((t) => t.name === "search_library");
    const ctx = {
      client: new PhotosClient(account, baseConfig, new QuotaTracker()),
      account,
      config: baseConfig,
      guard: new WriteGuard(baseConfig),
    };
    await (tool as { handler: (a: unknown, c: unknown) => Promise<unknown> }).handler(args, ctx);
    const body = fetchMock.mock.calls.at(-1)?.[1]?.body;
    return JSON.parse(body as string) as Record<string, unknown>;
  }

  it("turns a one-sided date range into a valid two-sided one", async () => {
    // Google rejects a range with only one end, so an open-ended search has to
    // supply a bound wide enough to mean "everything".
    const body = await callSearch({ start_date: "2026-01-01" });
    expect(body.filters).toMatchObject({
      dateFilter: { ranges: [{ startDate: { year: 2026, month: 1, day: 1 }, endDate: { year: 2100, month: 12, day: 31 } }] },
    });
  });

  it("sends an album search with no filters, which Google requires", async () => {
    const body = await callSearch({ album_id: "album-1" });
    expect(body.albumId).toBe("album-1");
    expect(body.filters).toBeUndefined();
  });

  it("passes categories and media type through", async () => {
    const body = await callSearch({ categories: ["TRAVEL"], media_type: "VIDEO" });
    expect(body.filters).toMatchObject({
      contentFilter: { includedContentCategories: ["TRAVEL"] },
      mediaTypeFilter: { mediaTypes: ["VIDEO"] },
    });
  });

  it("rejects a malformed date rather than sending it", async () => {
    await expect(callSearch({ start_date: "01/02/2026" })).rejects.toThrow(/YYYY-MM-DD/);
  });
});
