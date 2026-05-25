export const INDEX_URL = "/api/media-index-lite";
export const CONFIG_URL = "/api/config";
export const CACHE_CLEANUP_URL = "/api/cache-cleanup";
export const CACHE_STATS_URL = "/api/cache-stats";
export const LIVE_PREPARE_URL = "/live/web-video-prepare";
export const LIVE_STATUS_URL = "/live/web-video-status";
export const FAVORITES_KEY = "media3xv:favorites";
export const INDEX_POLL_MS = 15000;
export const DEBUG_CLIENT = new URLSearchParams(location.search).get('debug') === 'true';

export const IMG = /\.(jpg|jpeg|png|gif|webp|bmp|heic)$/i;
export const VID = /\.(mp4|webm|mov|mkv|avi|3gp)$/i;
export const AUD = /\.(mp3|m4a|wav|ogg|flac)$/i;

export const SIZES = ['XS','S','M','L','XL'];
export const SIZE_PX = [80, 120, 160, 220, 300];
