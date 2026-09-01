/**
 * The Picker API: the only way to reach media this app did not upload.
 *
 * Since 2025-04-01 there is no scope that lets an app read someone's whole
 * Google Photos library. The picker replaces it, and the trade is deliberate:
 * the user chooses, in Google's own UI, exactly which items the app may see.
 *
 * The flow is asynchronous and needs a human in the middle, which is unusual
 * for an MCP tool and is the thing most likely to be got wrong. The tool
 * descriptions spell out the handoff, because a model that calls
 * list_picked_media immediately after start_pick_session gets an empty list and
 * concludes the library is empty.
 */

import { z } from "zod";
import { defineTool, clamp, pageArgs, type AnyToolSpec , accountArg } from "./kit.js";
import { page, shapeItem, URL_NOTE, type RawMediaItem } from "../format/items.js";
import { PhotosError } from "../api/errors.js";

type Session = {
  id?: string;
  pickerUri?: string;
  mediaItemsSet?: boolean;
  expireTime?: string;
  pollingConfig?: { pollInterval?: string; timeoutIn?: string };
};

/** A picked item nests its file under `mediaFile`, unlike a Library item. */
type PickedItem = {
  id?: string;
  createTime?: string;
  type?: string;
  mediaFile?: {
    baseUrl?: string;
    mimeType?: string;
    filename?: string;
    mediaFileMetadata?: { width?: number; height?: number; cameraMake?: string };
  };
};

function flattenPicked(item: PickedItem): RawMediaItem {
  const file = item.mediaFile ?? {};
  const meta = file.mediaFileMetadata ?? {};
  return {
    id: item.id,
    baseUrl: file.baseUrl,
    mimeType: file.mimeType,
    filename: file.filename,
    mediaMetadata: {
      ...(item.createTime ? { creationTime: item.createTime } : {}),
      ...(meta.width ? { width: String(meta.width) } : {}),
      ...(meta.height ? { height: String(meta.height) } : {}),
      ...(item.type === "VIDEO" ? { video: {} } : item.type === "PHOTO" ? { photo: {} } : {}),
    },
  };
}

export const pickerTools: AnyToolSpec[] = [
  defineTool({
    name: "start_pick_session",
    title: "Start a photo picker session",
    description:
      "Open a Google Photos picker so the user can choose photos and videos from their ENTIRE library. This is the only way to reach media this app did not upload itself; the Library API cannot see anything else.\n\nReturns a `picker_uri`. Give that URL to the user and stop. They open it, select items in Google Photos, and finish. Then call check_pick_session until `ready` is true, and list_picked_media to see what they chose.\n\nDo not call list_picked_media straight after this. Nothing has been picked yet and the empty result does not mean the library is empty.",
    schema: { ...accountArg },
    risk: "read",
    handler: async (_args, ctx) => {
      const session = await ctx.client.request<Session>("picker", "/sessions", { method: "POST", body: {} });
      if (!session.id || !session.pickerUri) {
        throw new PhotosError("The picker session came back without a URL.", 502, "NO_PICKER_URI");
      }
      // The docs describe /autoclose as the web-app convenience: the Google
      // Photos tab closes itself once the user is done, instead of leaving
      // them looking at a page with nothing left to do.
      return {
        session_id: session.id,
        picker_uri: `${session.pickerUri}/autoclose`,
        expires_at: session.expireTime,
        poll_interval_seconds: Number(String(session.pollingConfig?.pollInterval ?? "5s").replace("s", "")) || 5,
        next_step:
          "Show picker_uri to the user and wait. Poll check_pick_session with this session_id; when ready is true, call list_picked_media.",
      };
    },
  }),

  defineTool({
    name: "check_pick_session",
    title: "Check whether the user has finished picking",
    description:
      "Poll a picker session started by start_pick_session. `ready` is true once the user has confirmed a selection.\n\nRespect the poll_interval_seconds from start_pick_session rather than polling in a tight loop. If it is still false after a few minutes, the user has probably not opened the link yet; ask them rather than polling forever.",
    schema: {
      session_id: z.string().describe("The session_id returned by start_pick_session."),
      ...accountArg,
    },
    risk: "read",
    handler: async (args, ctx) => {
      const session = await ctx.client.request<Session>("picker", `/sessions/${encodeURIComponent(args.session_id)}`);
      return {
        session_id: session.id,
        ready: Boolean(session.mediaItemsSet),
        expires_at: session.expireTime,
        next_step: session.mediaItemsSet
          ? "Call list_picked_media with this session_id."
          : "Not finished yet. Wait poll_interval_seconds and check again, or ask the user whether they opened the link.",
      };
    },
  }),

  defineTool({
    name: "list_picked_media",
    title: "List what the user picked",
    description:
      "Return the media items the user selected in a picker session. Call check_pick_session first; this returns an empty list until the selection is confirmed.\n\nThe items include a `base_url` that expires in about an hour. To get actual bytes, pass an item's base_url to download_picked rather than handing the URL to the user.",
    schema: {
      session_id: z.string().describe("The session_id returned by start_pick_session."),
      ...pageArgs,
      ...accountArg,
    },
    risk: "read",
    handler: async (args, ctx) => {
      const data = await ctx.client.request<{ mediaItems?: PickedItem[]; nextPageToken?: string }>(
        "picker",
        "/mediaItems",
        {
          query: {
            sessionId: args.session_id,
            pageSize: clamp(args.limit, 50, 100),
            pageToken: args.page_token,
          },
        },
      );
      const items = (data.mediaItems ?? []).map((item) => shapeItem(flattenPicked(item)));
      return page(items, data.nextPageToken, {
        url_note: URL_NOTE,
        ...(items.length === 0
          ? { note: "Nothing here yet. Confirm with check_pick_session that the user has finished selecting." }
          : {}),
      });
    },
  }),

  defineTool({
    name: "download_picked",
    title: "Download a picked photo or video",
    description:
      "Fetch the bytes of an item the user picked, returned as base64 with its mime type. Pass the item's `base_url` from list_picked_media.\n\nUse this rather than giving a base_url to the user or to another tool: the URL needs an auth header and a size suffix, and it expires within the hour. Large files are refused; raise max_mb only when the caller genuinely needs the original.",
    schema: {
      base_url: z.string().describe("The `base_url` of an item from list_picked_media."),
      size: z
        .string()
        .optional()
        .describe(
          "Size suffix. 'd' for the original file, or 'w2048-h2048' to cap the long edge. Defaults to 'w2048-h2048', which is plenty for viewing and far smaller than an original.",
        ),
      max_mb: z.number().min(1).max(100).optional().describe("Refuse anything larger, in MB. Default 25."),
      ...accountArg,
    },
    risk: "read",
    handler: async (args, ctx) => {
      const suffix = (args.size ?? "w2048-h2048").replace(/^=/, "");
      const url = `${args.base_url}=${suffix}`;
      const { bytes, mimeType } = await ctx.client.fetchBytes(url, (args.max_mb ?? 25) * 1_000_000);
      return {
        mime_type: mimeType,
        size_bytes: bytes.byteLength,
        base64: Buffer.from(bytes).toString("base64"),
      };
    },
  }),
];
