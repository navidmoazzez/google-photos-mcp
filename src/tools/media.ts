/**
 * Reading and editing media items.
 *
 * Every read here is scoped to app-created data. That is not a configuration
 * choice: it is the widest read Google grants any third-party app now. The
 * route to everything else is the picker.
 */

import { z } from "zod";
import { defineTool, clamp, pageArgs, type AnyToolSpec } from "./kit.js";
import { page, shapeItem, URL_NOTE, type RawMediaItem } from "../format/items.js";

/** Google's content categories, as of the current Library API reference. */
export const CONTENT_CATEGORIES = [
  "ANIMALS", "ARTS", "BIRTHDAYS", "CITYSCAPES", "CRAFTS", "DOCUMENTS", "FASHION",
  "FLOWERS", "FOOD", "GARDENS", "HOLIDAYS", "HOUSES", "LANDMARKS", "LANDSCAPES",
  "NIGHT", "PEOPLE", "PERFORMANCES", "PETS", "RECEIPTS", "SCREENSHOTS", "SELFIES",
  "SPORT", "TRAVEL", "UTILITY", "WEDDINGS", "WHITEBOARDS",
] as const;

const APP_CREATED_NOTE =
  "Only media uploaded by this app is returned. To reach anything else in the user's library, use start_pick_session.";

export const mediaTools: AnyToolSpec[] = [
  defineTool({
    name: "list_app_media",
    title: "List media this app uploaded",
    description: `List media items, newest first, optionally scoped to one album. ${APP_CREATED_NOTE}\n\nPass next_page_token to continue past the first page.`,
    schema: {
      album_id: z.string().optional().describe("Limit to one album. Omit to list everything this app uploaded."),
      ...pageArgs,
    },
    risk: "read",
    handler: async (args, ctx) => {
      const pageSize = clamp(args.limit, 25, 100);
      // Listing all media is a GET; listing inside an album is a search POST.
      // Google splits these and there is no album filter on the GET.
      const data = args.album_id
        ? await ctx.client.request<{ mediaItems?: RawMediaItem[]; nextPageToken?: string }>(
            "library",
            "/mediaItems:search",
            { method: "POST", body: { albumId: args.album_id, pageSize, pageToken: args.page_token } },
          )
        : await ctx.client.request<{ mediaItems?: RawMediaItem[]; nextPageToken?: string }>(
            "library",
            "/mediaItems",
            { query: { pageSize, pageToken: args.page_token } },
          );

      return page((data.mediaItems ?? []).map(shapeItem), data.nextPageToken, {
        url_note: URL_NOTE,
        note: APP_CREATED_NOTE,
      });
    },
  }),

  defineTool({
    name: "search_library",
    title: "Search media by date, category or type",
    description: `Filter media by date range, content category, media type or favourites. ${APP_CREATED_NOTE}\n\nThere is no free-text search in the Google Photos API: you cannot search for "beach" as a word. Categories are the closest equivalent, and they are Google's own classifier, not tags the user set. Call describe_filter_capabilities for the exact values.\n\nAn album_id cannot be combined with any filter; Google rejects that combination.`,
    schema: {
      album_id: z.string().optional().describe("Search inside one album. Cannot be combined with any filter below."),
      start_date: z.string().optional().describe("Inclusive start, as YYYY-MM-DD."),
      end_date: z.string().optional().describe("Inclusive end, as YYYY-MM-DD."),
      categories: z
        .array(z.enum(CONTENT_CATEGORIES))
        .optional()
        .describe("Include only these content categories. See describe_filter_capabilities."),
      exclude_categories: z.array(z.enum(CONTENT_CATEGORIES)).optional().describe("Exclude these categories."),
      media_type: z.enum(["ALL_MEDIA", "PHOTO", "VIDEO"]).optional().describe("Restrict to photos or videos."),
      favorites_only: z.boolean().optional().describe("Only items the user marked as a favourite."),
      include_archived: z.boolean().optional().describe("Include archived items. Default false."),
      ...pageArgs,
    },
    risk: "read",
    handler: async (args, ctx) => {
      const body: Record<string, unknown> = {
        pageSize: clamp(args.limit, 25, 100),
        ...(args.page_token ? { pageToken: args.page_token } : {}),
      };

      if (args.album_id) {
        body.albumId = args.album_id;
      } else {
        const filters: Record<string, unknown> = {};

        if (args.start_date || args.end_date) {
          const toParts = (iso: string): { year: number; month: number; day: number } => {
            const [y, m, d] = iso.split("-").map(Number);
            if (!y || !m || !d) throw new Error(`Dates must look like YYYY-MM-DD. Got "${iso}".`);
            return { year: y, month: m, day: d };
          };
          filters.dateFilter = {
            ranges: [
              {
                // A one-sided range still needs both ends. These bounds are
                // wide enough to be effectively open while staying valid.
                startDate: toParts(args.start_date ?? "1900-01-01"),
                endDate: toParts(args.end_date ?? "2100-12-31"),
              },
            ],
          };
        }
        if (args.categories?.length || args.exclude_categories?.length) {
          filters.contentFilter = {
            ...(args.categories?.length ? { includedContentCategories: args.categories } : {}),
            ...(args.exclude_categories?.length ? { excludedContentCategories: args.exclude_categories } : {}),
          };
        }
        if (args.media_type && args.media_type !== "ALL_MEDIA") {
          filters.mediaTypeFilter = { mediaTypes: [args.media_type] };
        }
        if (args.favorites_only) filters.featureFilter = { includedFeatures: ["FAVORITES"] };
        if (args.include_archived) filters.includeArchivedMedia = true;

        body.filters = Object.keys(filters).length > 0 ? filters : { includeArchivedMedia: Boolean(args.include_archived) };
      }

      const data = await ctx.client.request<{ mediaItems?: RawMediaItem[]; nextPageToken?: string }>(
        "library",
        "/mediaItems:search",
        { method: "POST", body },
      );
      return page((data.mediaItems ?? []).map(shapeItem), data.nextPageToken, {
        url_note: URL_NOTE,
        note: APP_CREATED_NOTE,
      });
    },
  }),

  defineTool({
    name: "describe_filter_capabilities",
    title: "List every filter value search_library accepts",
    description:
      "Return the exact content categories, media types and feature filters search_library accepts, plus what the Google Photos API cannot do. Costs no API call and no quota.\n\nRead this before guessing a category name. A wrong one is rejected rather than ignored.",
    schema: {},
    risk: "read",
    handler: async () => ({
      content_categories: CONTENT_CATEGORIES,
      media_types: ["ALL_MEDIA", "PHOTO", "VIDEO"],
      features: ["FAVORITES"],
      date_format: "YYYY-MM-DD, passed as start_date and end_date.",
      combination_rules: [
        "album_id cannot be combined with any other filter.",
        "A category cannot be both included and excluded.",
        "Archived media is excluded unless include_archived is true.",
      ],
      not_supported: [
        "Free-text search. There is no way to search for a word like 'beach'; categories are Google's classifier and are the nearest equivalent.",
        "Searching by person or face. The API exposes no face grouping.",
        "Searching by place name or coordinates. Location filters were never part of the public API.",
        "Reading anything this app did not upload. Use start_pick_session and let the user choose.",
        "Deleting a media item, or marking one as a favourite. Neither has an API.",
      ],
    }),
  }),

  defineTool({
    name: "get_media_item",
    title: "Get one media item",
    description: `Fetch a single media item by id, with its dimensions, creation time and description. ${APP_CREATED_NOTE}`,
    schema: { media_item_id: z.string().describe("The media item id.") },
    risk: "read",
    handler: async (args, ctx) => {
      const item = await ctx.client.request<RawMediaItem>(
        "library",
        `/mediaItems/${encodeURIComponent(args.media_item_id)}`,
      );
      return { ...shapeItem(item), url_note: URL_NOTE };
    },
  }),

  defineTool({
    name: "get_media_items",
    title: "Get several media items at once",
    description: `Fetch up to 50 media items by id in one call. Prefer this over repeated get_media_item: it is one request against the daily quota rather than fifty. ${APP_CREATED_NOTE}\n\nIds that cannot be read come back in \`failed\` with a reason, rather than failing the whole call.`,
    schema: { media_item_ids: z.array(z.string()).min(1).max(50).describe("Media item ids, up to 50.") },
    risk: "read",
    handler: async (args, ctx) => {
      const query = new URLSearchParams();
      for (const id of args.media_item_ids) query.append("mediaItemIds", id);
      const data = await ctx.client.request<{
        mediaItemResults?: { mediaItem?: RawMediaItem; status?: { message?: string } }[];
      }>("library", `/mediaItems:batchGet?${query.toString()}`);

      const results = data.mediaItemResults ?? [];
      return {
        items: results.filter((r) => r.mediaItem).map((r) => shapeItem(r.mediaItem as RawMediaItem)),
        failed: results
          .map((r, i) => (r.mediaItem ? null : { id: args.media_item_ids[i], reason: r.status?.message ?? "not found" }))
          .filter(Boolean),
        url_note: URL_NOTE,
      };
    },
  }),

  defineTool({
    name: "update_media_description",
    title: "Set a media item's description",
    description:
      "Write the description shown under a photo or video in Google Photos. Only works on media this app uploaded. Passing an empty string clears it.",
    schema: {
      media_item_id: z.string().describe("The media item to update."),
      description: z.string().max(1000).describe("The new description. Empty string clears it."),
    },
    risk: "write",
    idempotent: true,
    summary: (args) => `set description on media item ${args.media_item_id}`,
    handler: async (args, ctx) => {
      const item = await ctx.client.request<RawMediaItem>(
        "library",
        `/mediaItems/${encodeURIComponent(args.media_item_id)}`,
        { method: "PATCH", body: { description: args.description }, query: { updateMask: "description" } },
      );
      return shapeItem(item);
    },
  }),

  defineTool({
    name: "download_media_item",
    title: "Download a media item",
    description:
      "Fetch the bytes of a media item this app uploaded, returned as base64 with its mime type. Resolves the item's current base_url first, so it works with a plain id and never with a stale URL.",
    schema: {
      media_item_id: z.string().describe("The media item to download."),
      size: z
        .string()
        .optional()
        .describe("Size suffix: 'd' for the original, or 'w2048-h2048' to cap the long edge. Default 'w2048-h2048'."),
      max_mb: z.number().min(1).max(100).optional().describe("Refuse anything larger, in MB. Default 25."),
    },
    risk: "read",
    handler: async (args, ctx) => {
      const item = await ctx.client.request<RawMediaItem>(
        "library",
        `/mediaItems/${encodeURIComponent(args.media_item_id)}`,
      );
      if (!item.baseUrl) throw new Error("That media item has no downloadable URL.");
      const isVideo = item.mimeType?.startsWith("video/") || Boolean(item.mediaMetadata?.video);
      // A video needs =dv; a photo size suffix on a video returns a still
      // frame, which looks like a corrupt download rather than a wrong flag.
      const suffix = (args.size ?? (isVideo ? "dv" : "w2048-h2048")).replace(/^=/, "");
      const { bytes, mimeType } = await ctx.client.fetchBytes(
        `${item.baseUrl}=${suffix}`,
        (args.max_mb ?? 25) * 1_000_000,
      );
      return {
        media_item_id: args.media_item_id,
        filename: item.filename,
        mime_type: mimeType,
        size_bytes: bytes.byteLength,
        base64: Buffer.from(bytes).toString("base64"),
      };
    },
  }),
];
