const BASE_URL =
  typeof window !== "undefined" && window.media3xvRuntime?.baseUrl
    ? String(window.media3xvRuntime.baseUrl).replace(/\/+$/, "")
    : "";

const withBase = (p) => `${BASE_URL}${p}`;

export const INDEX_URL = withBase("/api/media-index-lite");
export const CONFIG_URL = withBase("/api/config");
export const CACHE_CLEANUP_URL = withBase("/api/cache-cleanup");
export const CACHE_STATS_URL = withBase("/api/cache-stats");
export const UPLOAD_URL = withBase("/api/upload-media");
export const UPDATE_MEDIA_DATE_URL = withBase("/api/update-media-date");
export const DELETE_URL = withBase("/api/delete-media");
export const PARTITIONS_URL = withBase("/api/partitions");
export const REINDEX_PARTITION_URL = withBase("/api/reindex-partition");
export const LIVE_PREPARE_URL = withBase("/live/web-video-prepare");
export const LIVE_STATUS_URL = withBase("/live/web-video-status");
export const FAVORITES_KEY = "media3xv:favorites";
export const INDEX_POLL_MS = 15000;
export const DEBUG_CLIENT = new URLSearchParams(location.search).get('debug') === 'true';

export const IMG = /\.(jpg|jpeg|png|gif|webp|bmp|heic|heif|avif)$/i;
export const VID = /\.(mp4|webm|mov|mkv|avi|3gp)$/i;
export const AUD = /\.(mp3|m4a|wav|ogg|flac)$/i;

export const SIZES = ['XS','S','M','L','XL'];
export const SIZE_PX = [80, 120, 160, 220, 300];
