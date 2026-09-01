/**
 * Getting media into the library.
 *
 * Uploading is always two steps: send the bytes, get an upload token, then
 * call batchCreate with that token to make the actual media item. Doing only
 * the first step uploads bytes that silently expire, which looks like a
 * successful upload that produced nothing.
 *
 * All of these are `destructive` in the safety model, for one reason: there is
 * no delete. Google exposes no API to remove a media item, so a mistaken
 * upload has to be cleaned up by hand in the Google Photos app, in among the
 * user's real photos.
 */

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { z } from "zod";
import { defineTool, confirmArg, type AnyToolSpec } from "./kit.js";
import { shapeAlbum, shapeItem, type RawAlbum, type RawMediaItem } from "../format/items.js";
import type { ToolContext } from "./kit.js";

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
  ".webp": "image/webp", ".heic": "image/heic", ".heif": "image/heif", ".tif": "image/tiff",
  ".tiff": "image/tiff", ".bmp": "image/bmp", ".mp4": "video/mp4", ".mov": "video/quicktime",
  ".m4v": "video/x-m4v", ".avi": "video/x-msvideo", ".webm": "video/webm", ".mkv": "video/x-matroska",
};

function guessMime(filename: string, fallback: string): string {
  return MIME_BY_EXT[extname(filename).toLowerCase()] ?? fallback;
}

type BatchCreateResponse = {
  newMediaItemResults?: { status?: { message?: string; code?: number }; mediaItem?: RawMediaItem }[];
};

/** Create media items from upload tokens, optionally straight into an album. */
async function batchCreate(
  ctx: ToolContext,
  entries: { uploadToken: string; filename: string; description?: string }[],
  albumId?: string,
): Promise<{ created: unknown[]; failed: unknown[] }> {
  const data = await ctx.client.request<BatchCreateResponse>("library", "/mediaItems:batchCreate", {
    method: "POST",
    body: {
      ...(albumId ? { albumId } : {}),
      newMediaItems: entries.map((e) => ({
        ...(e.description ? { description: e.description } : {}),
        simpleMediaItem: { uploadToken: e.uploadToken, fileName: e.filename },
      })),
    },
  });

  const results = data.newMediaItemResults ?? [];
  return {
    created: results.filter((r) => r.mediaItem).map((r) => shapeItem(r.mediaItem as RawMediaItem)),
    // A batchCreate can partially succeed. Reporting only the successes would
    // let a caller believe all ten uploads landed when three did not.
    failed: results
      .map((r, i) => (r.mediaItem ? null : { filename: entries[i]?.filename, reason: r.status?.message ?? "unknown" }))
      .filter(Boolean),
  };
}

export const uploadTools: AnyToolSpec[] = [
  defineTool({
    name: "upload_from_url",
    title: "Upload photos or videos from URLs",
    description:
      "Download files from public URLs and add them to the user's Google Photos, optionally straight into an album.\n\nThere is no API to delete a media item once uploaded, so this cannot be undone here: the user would have to remove it by hand in the Google Photos app. Requires confirm: true.\n\nUp to 20 URLs per call.",
    schema: {
      urls: z.array(z.string().url()).min(1).max(20).describe("Public URLs to fetch and upload, up to 20."),
      album_id: z.string().optional().describe("Put them straight into this album, which this app must have created."),
      description: z.string().max(1000).optional().describe("Description applied to every uploaded item."),
      max_mb: z.number().min(1).max(200).optional().describe("Skip any file larger than this, in MB. Default 100."),
      ...confirmArg,
    },
    risk: "destructive",
    summary: (args) => `upload ${args.urls.length} file(s) from URL into the user's Google Photos library`,
    handler: async (args, ctx) => {
      const entries: { uploadToken: string; filename: string; description?: string }[] = [];
      const failed: { url: string; reason: string }[] = [];

      for (const url of args.urls) {
        try {
          const { bytes, mimeType } = await ctx.client.fetchBytes(url, (args.max_mb ?? 100) * 1_000_000);
          const nameFromUrl = basename(new URL(url).pathname) || "upload";
          const filename = extname(nameFromUrl) ? nameFromUrl : `${nameFromUrl}.jpg`;
          const token = await ctx.client.uploadBytes(bytes, filename, guessMime(filename, mimeType));
          entries.push({ uploadToken: token, filename, ...(args.description ? { description: args.description } : {}) });
        } catch (error) {
          // One bad URL should not lose the other nineteen uploads.
          failed.push({ url, reason: (error as Error).message });
        }
      }

      if (entries.length === 0) return { created: [], failed, note: "Nothing uploaded." };
      const result = await batchCreate(ctx, entries, args.album_id);
      return { ...result, failed: [...failed, ...result.failed] };
    },
  }),

  defineTool({
    name: "upload_file",
    title: "Upload a local file",
    description:
      "Upload a photo or video from a path on the machine running this server, optionally straight into an album.\n\nThere is no API to delete a media item once uploaded. Requires confirm: true.",
    schema: {
      path: z.string().describe("Absolute path to the file on this machine."),
      album_id: z.string().optional().describe("Put it straight into this album, which this app must have created."),
      description: z.string().max(1000).optional().describe("Description for the uploaded item."),
      ...confirmArg,
    },
    risk: "destructive",
    summary: (args) => `upload ${args.path} into the user's Google Photos library`,
    handler: async (args, ctx) => {
      const bytes = await readFile(args.path);
      const filename = basename(args.path);
      const token = await ctx.client.uploadBytes(
        new Uint8Array(bytes),
        filename,
        guessMime(filename, "application/octet-stream"),
      );
      return batchCreate(
        ctx,
        [{ uploadToken: token, filename, ...(args.description ? { description: args.description } : {}) }],
        args.album_id,
      );
    },
  }),

  defineTool({
    name: "save_to_library",
    title: "Copy picked media into this app's library",
    description:
      "Take items the user chose in a picker session and upload them as app-created media, so the other tools can then read, describe and organise them.\n\nThis is the bridge between the two halves of the API. A picked item is readable only for the life of its session; once saved it is a normal media item this app owns. It does create a second copy in the user's library. Requires confirm: true.\n\nPass base_urls from list_picked_media, up to 20.",
    schema: {
      base_urls: z.array(z.string()).min(1).max(20).describe("`base_url` values from list_picked_media, up to 20."),
      album_id: z.string().optional().describe("Save them straight into this album."),
      ...confirmArg,
    },
    risk: "destructive",
    summary: (args) => `copy ${args.base_urls.length} picked item(s) into the library as new uploads`,
    handler: async (args, ctx) => {
      const entries: { uploadToken: string; filename: string }[] = [];
      const failed: { base_url: string; reason: string }[] = [];

      for (const [index, baseUrl] of args.base_urls.entries()) {
        try {
          // '=d' asks for the original bytes rather than a resized render, so
          // the saved copy is not a downscale of the user's own photo.
          const { bytes, mimeType } = await ctx.client.fetchBytes(`${baseUrl}=d`, 100_000_000);
          const ext = Object.entries(MIME_BY_EXT).find(([, m]) => m === mimeType)?.[0] ?? ".jpg";
          const token = await ctx.client.uploadBytes(bytes, `picked-${index + 1}${ext}`, mimeType);
          entries.push({ uploadToken: token, filename: `picked-${index + 1}${ext}` });
        } catch (error) {
          failed.push({ base_url: baseUrl.slice(0, 60), reason: (error as Error).message });
        }
      }

      if (entries.length === 0) return { created: [], failed, note: "Nothing saved. Picked base_urls expire in about an hour; start a new picker session." };
      const result = await batchCreate(ctx, entries, args.album_id);
      return { ...result, failed: [...failed, ...result.failed] };
    },
  }),

  defineTool({
    name: "create_album_with_media",
    title: "Create an album and fill it in one call",
    description:
      "Create an album and upload files into it in a single step. Saves three round trips over create_album, upload_from_url and add_to_album, and leaves no empty album behind if the uploads fail.\n\nThere is no API to delete uploaded media. Requires confirm: true. Up to 20 URLs.",
    schema: {
      title: z.string().min(1).max(500).describe("The album title."),
      urls: z.array(z.string().url()).min(1).max(20).describe("Public URLs to upload into it, up to 20."),
      description: z.string().max(1000).optional().describe("Description applied to every uploaded item."),
      max_mb: z.number().min(1).max(200).optional().describe("Skip any file larger than this, in MB. Default 100."),
      ...confirmArg,
    },
    risk: "destructive",
    summary: (args) => `create album "${args.title}" and upload ${args.urls.length} file(s) into it`,
    handler: async (args, ctx) => {
      const album = await ctx.client.request<RawAlbum>("library", "/albums", {
        method: "POST",
        body: { album: { title: args.title } },
      });
      if (!album.id) throw new Error("The album was not created, so nothing was uploaded.");

      const entries: { uploadToken: string; filename: string; description?: string }[] = [];
      const failed: { url: string; reason: string }[] = [];

      for (const url of args.urls) {
        try {
          const { bytes, mimeType } = await ctx.client.fetchBytes(url, (args.max_mb ?? 100) * 1_000_000);
          const nameFromUrl = basename(new URL(url).pathname) || "upload";
          const filename = extname(nameFromUrl) ? nameFromUrl : `${nameFromUrl}.jpg`;
          const token = await ctx.client.uploadBytes(bytes, filename, guessMime(filename, mimeType));
          entries.push({ uploadToken: token, filename, ...(args.description ? { description: args.description } : {}) });
        } catch (error) {
          failed.push({ url, reason: (error as Error).message });
        }
      }

      const result = entries.length > 0 ? await batchCreate(ctx, entries, album.id) : { created: [], failed: [] };
      return {
        album: shapeAlbum(album),
        ...result,
        failed: [...failed, ...result.failed],
      };
    },
  }),
];
