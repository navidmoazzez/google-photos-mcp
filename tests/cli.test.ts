/**
 * The CLI adapter.
 *
 * What matters here is that the shell surface is derived from the tool specs
 * rather than described a second time, so the tests that count are the ones
 * asserting parity with ALL_TOOLS and the ones covering the argv shapes a
 * person actually types.
 */

import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { flagsFor, parseArgs, isCliCommand } from "../src/cli.js";
import { ALL_TOOLS } from "../src/tools/index.js";

describe("flagsFor", () => {
  it("derives a flag per schema key, kebab-cased", () => {
    const flags = flagsFor({ page_token: z.string().optional() });
    expect(flags[0]).toMatchObject({ key: "page_token", flag: "--page-token", kind: "string" });
  });

  it("reads required from the absence of .optional()", () => {
    const flags = flagsFor({ title: z.string(), account: z.string().optional() });
    expect(flags.find((f) => f.key === "title")?.required).toBe(true);
    expect(flags.find((f) => f.key === "account")?.required).toBe(false);
  });

  it("carries .describe() through as help", () => {
    const flags = flagsFor({ title: z.string().describe("The album title.") });
    expect(flags[0]?.help).toBe("The album title.");
  });

  it("finds the description whichever side of .optional() it was chained", () => {
    const outer = flagsFor({ a: z.string().optional().describe("outer") });
    const inner = flagsFor({ b: z.string().describe("inner").optional() });
    expect(outer[0]?.help).toBe("outer");
    expect(inner[0]?.help).toBe("inner");
  });

  it("exposes an enum's values as choices", () => {
    const flags = flagsFor({ media_type: z.enum(["photo", "video"]).optional() });
    expect(flags[0]).toMatchObject({ kind: "enum", choices: ["photo", "video"] });
  });

  it("marks a scalar array repeatable and an object array json", () => {
    const flags = flagsFor({
      ids: z.array(z.string()).optional(),
      items: z.array(z.object({ url: z.string() })).optional(),
    });
    expect(flags.find((f) => f.key === "ids")).toMatchObject({ kind: "string", repeatable: true });
    expect(flags.find((f) => f.key === "items")).toMatchObject({ kind: "json", repeatable: true });
  });
});

describe("parseArgs", () => {
  const flags = flagsFor({
    title: z.string(),
    limit: z.number().optional(),
    confirm: z.boolean().optional(),
    ids: z.array(z.string()).optional(),
    filters: z.object({ media_type: z.string() }).optional(),
    media_type: z.enum(["photo", "video"]).optional(),
  });

  it("accepts --flag value and --flag=value alike", () => {
    expect(parseArgs(["--title", "hi"], flags)).toEqual({ title: "hi" });
    expect(parseArgs(["--title=hi"], flags)).toEqual({ title: "hi" });
  });

  it("accepts the underscore spelling of a flag", () => {
    expect(parseArgs(["--media_type", "video"], flags)).toEqual({ media_type: "video" });
  });

  it("treats a boolean as a bare switch", () => {
    expect(parseArgs(["--title", "hi", "--confirm"], flags)).toEqual({ title: "hi", confirm: true });
    expect(parseArgs(["--confirm=false"], flags)).toEqual({ confirm: false });
  });

  it("coerces numbers, and refuses ones that are not", () => {
    expect(parseArgs(["--limit", "25"], flags)).toEqual({ limit: 25 });
    expect(() => parseArgs(["--limit", "many"], flags)).toThrow(/expects a number/);
  });

  it("parses a json flag, and refuses malformed json", () => {
    expect(parseArgs(['--filters={"media_type":"PHOTO"}'], flags)).toEqual({
      filters: { media_type: "PHOTO" },
    });
    expect(() => parseArgs(["--filters", "{oops"], flags)).toThrow(/expects JSON/);
  });

  it("collects a repeatable flag into an array", () => {
    expect(parseArgs(["--ids", "a", "--ids", "b"], flags)).toEqual({ ids: ["a", "b"] });
  });

  it("checks an enum against its choices", () => {
    expect(() => parseArgs(["--media-type", "gif"], flags)).toThrow(/expects one of/);
  });

  it("fills the first required flag from a bare argument", () => {
    expect(parseArgs(["Holiday 2026"], flags)).toEqual({ title: "Holiday 2026" });
  });

  it("wraps a bare argument when the required flag is repeatable", () => {
    const repeatable = flagsFor({ media_item_ids: z.array(z.string()) });
    expect(parseArgs(["abc123"], repeatable)).toEqual({ media_item_ids: ["abc123"] });
  });

  it("refuses an unknown option rather than dropping it", () => {
    expect(() => parseArgs(["--nope", "x"], flags)).toThrow(/Unknown option/);
  });

  it("refuses a second bare argument", () => {
    expect(() => parseArgs(["one", "two"], flags)).toThrow(/Unexpected argument/);
  });
});

describe("parity with the MCP surface", () => {
  it("routes every tool name, in both spellings", () => {
    for (const tool of ALL_TOOLS) {
      expect(isCliCommand([tool.name])).toBe(true);
      expect(isCliCommand([tool.name.replace(/_/g, "-")])).toBe(true);
    }
  });

  it("builds flags for every tool without throwing", () => {
    for (const tool of ALL_TOOLS) {
      expect(() => flagsFor(tool.schema)).not.toThrow();
    }
  });

  it("gives every schema key a flag", () => {
    for (const tool of ALL_TOOLS) {
      expect(flagsFor(tool.schema)).toHaveLength(Object.keys(tool.schema).length);
    }
  });

  it("leaves the server's own flags alone", () => {
    expect(isCliCommand(["--http"])).toBe(false);
    expect(isCliCommand(["--version"])).toBe(false);
    expect(isCliCommand([])).toBe(false);
  });

  /**
   * `auth` and `doctor` are real commands but are not tools, so the dispatch in
   * index.ts must not route them here. It lets them through to their own
   * handlers instead, and the OAuth setup is the first thing anyone runs.
   */
  it("leaves the server's own subcommands alone", () => {
    expect(isCliCommand(["auth"])).toBe(false);
    expect(isCliCommand(["doctor"])).toBe(false);
  });
});

describe("documentation stays in step with the code", () => {
  const read = (p: string): string => readFileSync(new URL(p, import.meta.url), "utf-8");
  const names = (text: string): Set<string> => new Set(text.match(/GOOGLE_PHOTOS_[A-Z_]+/g) ?? []);

  /**
   * Five variables shipped undocumented and three never reached `--help`, which
   * is the kind of drift nobody notices because both sides look complete on
   * their own.
   */
  it("documents every environment variable the code reads", () => {
    const used = names(["config.ts", "transport/http.ts"].map((f) => read(`../src/${f}`)).join("\n"));
    const documented = names(read("../README.md"));
    expect([...used].filter((v) => !documented.has(v))).toEqual([]);
  });

  it("lists every environment variable in --help", () => {
    const used = names(["config.ts", "transport/http.ts"].map((f) => read(`../src/${f}`)).join("\n"));
    const helped = names(read("../src/index.ts"));
    // The help groups the three HTTP ones as `GOOGLE_PHOTOS_HTTP_PORT / _HOST / _TOKEN`.
    const shorthand = new Set(["GOOGLE_PHOTOS_HTTP_HOST", "GOOGLE_PHOTOS_HTTP_TOKEN"]);
    expect([...used].filter((v) => !helped.has(v) && !shorthand.has(v))).toEqual([]);
  });

  /**
   * Two in-page links pointed at headings that had been renamed, including the
   * one row routing a shell user to the CLI. The ship checklist's link pass only
   * greps http, so a dead `#anchor` is the kind that ships quietly.
   */
  it.each(["../README.md", "../INSTALL.md"])("has no dead in-page anchors in %s", (file) => {
    if (!existsSync(new URL(file, import.meta.url))) return; // repo may ship one doc
    const md = read(file);
    const slugs = new Set<string>();
    for (const [, heading] of md.matchAll(/^#{2,4} (.+)$/gm)) {
      const stripped = (heading as string).toLowerCase().replace(/[^\w\s-]/g, "");
      // GitHub keeps the trailing hyphen when a heading ends in an emoji.
      slugs.add(stripped.trim().replace(/\s+/g, "-"));
      slugs.add(stripped.replace(/\s+/g, "-"));
    }
    const dead = [...md.matchAll(/\[[^\]]+\]\(#([^)]+)\)/g)]
      .map((m) => m[1] as string)
      .filter((a) => !slugs.has(a));
    expect(dead).toEqual([]);
  });
});
