/**
 * Shaping media items for a model.
 *
 * Raw Google Photos JSON is mostly fields a model never uses: focal ratios,
 * exposure times, camera model strings, a `productUrl` that only works for the
 * signed-in owner. Passing it through verbatim spends thousands of tokens per
 * page on noise.
 *
 * What is kept is what a model reasons about, plus the one thing that trips
 * everyone up: `baseUrl` is not a permanent link. It expires roughly 60 minutes
 * after it is issued, and it needs a size suffix before it will serve bytes.
 * Both facts are stated in the output itself, because a model that stores a
 * bare baseUrl and uses it tomorrow gets a 403 it cannot explain.
 */

export type RawMediaItem = {
  id?: string;
  description?: string;
  productUrl?: string;
  baseUrl?: string;
  mimeType?: string;
  filename?: string;
  mediaMetadata?: {
    creationTime?: string;
    width?: string;
    height?: string;
    photo?: Record<string, unknown>;
    video?: { status?: string; fps?: number };
  };
};

export type MediaItem = {
  id: string;
  filename: string;
  mime_type: string;
  kind: "photo" | "video" | "unknown";
  created_at?: string;
  width?: number;
  height?: number;
  description?: string;
  /** Expires in ~60 minutes. Needs a size suffix. See `url_note` on the envelope. */
  base_url?: string;
  video_status?: string;
};

export function shapeItem(raw: RawMediaItem): MediaItem {
  const meta = raw.mediaMetadata ?? {};
  const width = meta.width ? Number(meta.width) : undefined;
  const height = meta.height ? Number(meta.height) : undefined;

  return {
    id: raw.id ?? "",
    filename: raw.filename ?? "",
    mime_type: raw.mimeType ?? "",
    kind: meta.video ? "video" : meta.photo ? "photo" : raw.mimeType?.startsWith("video/") ? "video" : raw.mimeType?.startsWith("image/") ? "photo" : "unknown",
    ...(meta.creationTime ? { created_at: meta.creationTime } : {}),
    ...(Number.isFinite(width) ? { width } : {}),
    ...(Number.isFinite(height) ? { height } : {}),
    ...(raw.description ? { description: raw.description } : {}),
    ...(raw.baseUrl ? { base_url: raw.baseUrl } : {}),
    ...(meta.video?.status ? { video_status: meta.video.status } : {}),
  };
}

export const URL_NOTE =
  "base_url expires about 60 minutes after this call and is not a permanent link. It also serves nothing on its own: append a size suffix such as '=w2048-h1024' for an image, '=d' to download the original, or '=dv' for a video. Use download_media_item rather than handing a base_url to the user.";

export type RawAlbum = {
  id?: string;
  title?: string;
  productUrl?: string;
  mediaItemsCount?: string;
  coverPhotoBaseUrl?: string;
  coverPhotoMediaItemId?: string;
  isWriteable?: boolean;
  shareInfo?: {
    shareableUrl?: string;
    shareToken?: string;
    isJoined?: boolean;
    isOwned?: boolean;
    sharedAlbumOptions?: { isCollaborative?: boolean; isCommentable?: boolean };
  };
};

export type Album = {
  id: string;
  title: string;
  item_count: number;
  /** False when this app did not create the album, in which case it cannot be edited. */
  writeable: boolean;
  cover_media_item_id?: string;
  shared?: {
    url?: string;
    collaborative?: boolean;
    commentable?: boolean;
    owned_by_this_account?: boolean;
  };
};

export function shapeAlbum(raw: RawAlbum): Album {
  const share = raw.shareInfo;
  return {
    id: raw.id ?? "",
    title: raw.title ?? "(untitled)",
    item_count: Number(raw.mediaItemsCount ?? 0),
    writeable: raw.isWriteable ?? false,
    ...(raw.coverPhotoMediaItemId ? { cover_media_item_id: raw.coverPhotoMediaItemId } : {}),
    ...(share
      ? {
          shared: {
            ...(share.shareableUrl ? { url: share.shareableUrl } : {}),
            ...(share.sharedAlbumOptions?.isCollaborative !== undefined
              ? { collaborative: share.sharedAlbumOptions.isCollaborative }
              : {}),
            ...(share.sharedAlbumOptions?.isCommentable !== undefined
              ? { commentable: share.sharedAlbumOptions.isCommentable }
              : {}),
            ...(share.isOwned !== undefined ? { owned_by_this_account: share.isOwned } : {}),
          },
        }
      : {}),
  };
}

/** The envelope every listing returns, so pagination is uniform. */
export function page<T>(
  items: T[],
  nextPageToken: string | undefined,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    count: items.length,
    items,
    ...(nextPageToken ? { next_page_token: nextPageToken, more: true } : { more: false }),
    ...extra,
  };
}
