/**
 * Albums, and album membership.
 *
 * Everything here is limited to albums this app created. An album made in the
 * Google Photos app is invisible to `appcreateddata` scopes, and asking for it
 * by id returns 404 rather than a permission error, which reads like a wrong
 * id. The tool descriptions say so, so a model does not conclude the user has
 * no albums when what it means is "none that I made".
 */

import { z } from "zod";
import { defineTool, clamp, confirmArg, pageArgs, type AnyToolSpec , accountArg } from "./kit.js";
import { page, shapeAlbum, type RawAlbum } from "../format/items.js";

const APP_CREATED_NOTE =
  "Only albums created by this app are listed. Albums the user made in the Google Photos app are not visible to any scope available since 2025-04-01.";

export const albumTools: AnyToolSpec[] = [
  defineTool({
    name: "create_album",
    title: "Create an album",
    description:
      "Create a new, empty album in the user's Google Photos. It is private, and it belongs to this app, which is what makes it editable later. Add items with add_to_album or by passing album_id when uploading.",
    schema: { title: z.string().min(1).max(500).describe("The album title as the user will see it."), ...accountArg },
    risk: "write",
    summary: (args) => `create album "${args.title}"`,
    handler: async (args, ctx) => {
      const album = await ctx.client.request<RawAlbum>("library", "/albums", {
        method: "POST",
        body: { album: { title: args.title } },
      });
      return shapeAlbum(album);
    },
  }),

  defineTool({
    name: "list_albums",
    title: "List albums",
    description: `List the albums this app created, newest first. ${APP_CREATED_NOTE}\n\nPass next_page_token from a previous result to continue; a library with many albums will not fit in one page.`,
    schema: { ...pageArgs, ...accountArg },
    risk: "read",
    handler: async (args, ctx) => {
      const data = await ctx.client.request<{ albums?: RawAlbum[]; nextPageToken?: string }>(
        "library",
        "/albums",
        {
          // excludeNonAppCreatedData is the default under an appcreateddata
          // scope, but setting it explicitly means the behavior does not
          // change if a broader scope is ever added to the grant.
          query: { pageSize: clamp(args.limit, 25, 50), pageToken: args.page_token, excludeNonAppCreatedData: "true" },
        },
      );
      return page((data.albums ?? []).map(shapeAlbum), data.nextPageToken, { note: APP_CREATED_NOTE });
    },
  }),

  defineTool({
    name: "get_album",
    title: "Get one album",
    description: `Fetch a single album by id, including its item count, cover photo and sharing state.\n\nA 404 here usually means the album exists but was not created by this app, rather than that the id is wrong. ${APP_CREATED_NOTE}`,
    schema: { album_id: z.string().describe("The album id, from list_albums or create_album."), ...accountArg },
    risk: "read",
    handler: async (args, ctx) => {
      const album = await ctx.client.request<RawAlbum>(
        "library",
        `/albums/${encodeURIComponent(args.album_id)}`,
      );
      return shapeAlbum(album);
    },
  }),

  defineTool({
    name: "update_album",
    title: "Rename an album or set its cover",
    description:
      "Change an album's title, its cover photo, or both. The cover has to be a media item that is already in the album; setting one that is not returns an error.",
    schema: {
      album_id: z.string().describe("The album to update."),
      title: z.string().min(1).max(500).optional().describe("A new title. Omit to leave it unchanged."),
      cover_media_item_id: z
        .string()
        .optional()
        .describe("A media item already in this album, to use as the cover. Omit to leave it unchanged."),
      ...accountArg,
    },
    risk: "write",
    idempotent: true,
    summary: (args) => `update album ${args.album_id}`,
    handler: async (args, ctx) => {
      const body: Record<string, unknown> = {};
      const mask: string[] = [];
      if (args.title !== undefined) {
        body.title = args.title;
        mask.push("title");
      }
      if (args.cover_media_item_id !== undefined) {
        body.coverPhotoMediaItemId = args.cover_media_item_id;
        mask.push("coverPhotoMediaItemId");
      }
      if (mask.length === 0) {
        // Google would accept an empty mask and change nothing, which looks
        // like success. Failing loudly is more useful than a silent no-op.
        throw new Error("Nothing to update. Pass title, cover_media_item_id, or both.");
      }
      const album = await ctx.client.request<RawAlbum>(
        "library",
        `/albums/${encodeURIComponent(args.album_id)}`,
        { method: "PATCH", body, query: { updateMask: mask.join(",") } },
      );
      return shapeAlbum(album);
    },
  }),

  defineTool({
    name: "share_album",
    title: "Share an album by link",
    description:
      "Turn an album into a shared album and return a link anyone can open without signing in.\n\nThis is the one thing here that reaches people outside the account, and a link that has been sent cannot be recalled. unshare_album revokes it, but not from anyone who already saved the contents. Requires confirm: true.",
    schema: {
      album_id: z.string().describe("The album to share."),
      collaborative: z
        .boolean()
        .optional()
        .describe("Let people who open the link add their own photos to the album. Default false."),
      commentable: z.boolean().optional().describe("Let people comment on items. Default true."),
      ...confirmArg,
      ...accountArg,
    },
    risk: "destructive",
    public: true,
    summary: (args) => `share album ${args.album_id} by public link`,
    handler: async (args, ctx) => {
      const data = await ctx.client.request<{ shareInfo?: RawAlbum["shareInfo"] }>(
        "library",
        `/albums/${encodeURIComponent(args.album_id)}:share`,
        {
          method: "POST",
          body: {
            sharedAlbumOptions: {
              isCollaborative: args.collaborative ?? false,
              isCommentable: args.commentable ?? true,
            },
          },
        },
      );
      return {
        album_id: args.album_id,
        share_url: data.shareInfo?.shareableUrl,
        share_token: data.shareInfo?.shareToken,
        collaborative: data.shareInfo?.sharedAlbumOptions?.isCollaborative,
        commentable: data.shareInfo?.sharedAlbumOptions?.isCommentable,
        note: "Anyone with this URL can view the album without signing in.",
      };
    },
  }),

  defineTool({
    name: "unshare_album",
    title: "Stop sharing an album",
    description:
      "Revoke an album's share link and make it private again. Anyone who already opened the link loses access, but anything they saved or downloaded stays with them.",
    schema: { album_id: z.string().describe("The album to stop sharing."), ...accountArg },
    risk: "write",
    idempotent: true,
    summary: (args) => `revoke sharing on album ${args.album_id}`,
    handler: async (args, ctx) => {
      await ctx.client.request("library", `/albums/${encodeURIComponent(args.album_id)}:unshare`, {
        method: "POST",
        body: {},
      });
      return { album_id: args.album_id, shared: false };
    },
  }),

  defineTool({
    name: "list_shared_albums",
    title: "List shared albums",
    description: `List the shared albums this app created, with their share links. ${APP_CREATED_NOTE}`,
    schema: { ...pageArgs, ...accountArg },
    risk: "read",
    handler: async (args, ctx) => {
      const data = await ctx.client.request<{ sharedAlbums?: RawAlbum[]; nextPageToken?: string }>(
        "library",
        "/sharedAlbums",
        { query: { pageSize: clamp(args.limit, 25, 50), pageToken: args.page_token, excludeNonAppCreatedData: "true" } },
      );
      return page((data.sharedAlbums ?? []).map(shapeAlbum), data.nextPageToken, { note: APP_CREATED_NOTE });
    },
  }),

  defineTool({
    name: "add_to_album",
    title: "Add media to an album",
    description:
      "Add media items this app created to an album this app created. Both sides have to be app-created; a picked item cannot be added directly, it has to be uploaded into the library first with save_to_library.\n\nUp to 50 items per call.",
    schema: {
      album_id: z.string().describe("The album to add to."),
      media_item_ids: z.array(z.string()).min(1).max(50).describe("Media item ids, up to 50."),
      ...accountArg,
    },
    risk: "write",
    summary: (args) => `add ${args.media_item_ids.length} item(s) to album ${args.album_id}`,
    handler: async (args, ctx) => {
      await ctx.client.request("library", `/albums/${encodeURIComponent(args.album_id)}:batchAddMediaItems`, {
        method: "POST",
        body: { mediaItemIds: args.media_item_ids },
      });
      return { album_id: args.album_id, added: args.media_item_ids.length };
    },
  }),

  defineTool({
    name: "remove_from_album",
    title: "Remove media from an album",
    description:
      "Take media items out of an album. The items stay in the user's library; only the album membership goes. Up to 50 per call.",
    schema: {
      album_id: z.string().describe("The album to remove from."),
      media_item_ids: z.array(z.string()).min(1).max(50).describe("Media item ids, up to 50."),
      ...accountArg,
    },
    risk: "write",
    summary: (args) => `remove ${args.media_item_ids.length} item(s) from album ${args.album_id}`,
    handler: async (args, ctx) => {
      await ctx.client.request("library", `/albums/${encodeURIComponent(args.album_id)}:batchRemoveMediaItems`, {
        method: "POST",
        body: { mediaItemIds: args.media_item_ids },
      });
      return { album_id: args.album_id, removed: args.media_item_ids.length, note: "The items remain in the library." };
    },
  }),

  defineTool({
    name: "add_album_enrichment",
    title: "Add a caption, location or map to an album",
    description:
      "Insert an enrichment into an album: a text caption, a named location, or a map between two places. Enrichments sit between photos and are how an album reads as a story rather than a grid.\n\nPosition defaults to the end of the album.",
    schema: {
      album_id: z.string().describe("The album to enrich."),
      type: z.enum(["text", "location", "map"]).describe("What to add."),
      text: z.string().optional().describe("For type 'text': the caption."),
      location_name: z.string().optional().describe("For type 'location': the place name to show."),
      latitude: z.number().optional().describe("For type 'location': latitude."),
      longitude: z.number().optional().describe("For type 'location': longitude."),
      origin_name: z.string().optional().describe("For type 'map': the starting place name."),
      origin_latitude: z.number().optional().describe("For type 'map': starting latitude."),
      origin_longitude: z.number().optional().describe("For type 'map': starting longitude."),
      destination_name: z.string().optional().describe("For type 'map': the ending place name."),
      destination_latitude: z.number().optional().describe("For type 'map': ending latitude."),
      destination_longitude: z.number().optional().describe("For type 'map': ending longitude."),
      after_media_item_id: z
        .string()
        .optional()
        .describe("Place the enrichment after this item. Omit to put it at the end of the album."),
      ...accountArg,
    },
    risk: "write",
    summary: (args) => `add ${args.type} enrichment to album ${args.album_id}`,
    handler: async (args, ctx) => {
      const position = args.after_media_item_id
        ? { position: "AFTER_MEDIA_ITEM", relativeMediaItemId: args.after_media_item_id }
        : { position: "LAST_IN_ALBUM" };

      let enrichment: Record<string, unknown>;
      if (args.type === "text") {
        if (!args.text) throw new Error("type 'text' needs `text`.");
        enrichment = { textEnrichment: { text: args.text } };
      } else if (args.type === "location") {
        if (!args.location_name || args.latitude === undefined || args.longitude === undefined) {
          throw new Error("type 'location' needs location_name, latitude and longitude.");
        }
        enrichment = {
          locationEnrichment: {
            location: {
              locationName: args.location_name,
              latlng: { latitude: args.latitude, longitude: args.longitude },
            },
          },
        };
      } else {
        const need = [
          args.origin_name,
          args.origin_latitude,
          args.origin_longitude,
          args.destination_name,
          args.destination_latitude,
          args.destination_longitude,
        ];
        if (need.some((v) => v === undefined)) {
          throw new Error("type 'map' needs origin_name/latitude/longitude and destination_name/latitude/longitude.");
        }
        enrichment = {
          mapEnrichment: {
            origin: {
              locationName: args.origin_name,
              latlng: { latitude: args.origin_latitude, longitude: args.origin_longitude },
            },
            destination: {
              locationName: args.destination_name,
              latlng: { latitude: args.destination_latitude, longitude: args.destination_longitude },
            },
          },
        };
      }

      const data = await ctx.client.request<{ enrichmentItem?: { id?: string } }>(
        "library",
        `/albums/${encodeURIComponent(args.album_id)}:addEnrichment`,
        { method: "POST", body: { newEnrichmentItem: enrichment, albumPosition: position } },
      );
      return { album_id: args.album_id, enrichment_id: data.enrichmentItem?.id, type: args.type };
    },
  }),
];
