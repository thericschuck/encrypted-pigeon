/**
 * Where browser-image-compression's web worker loads the library from.
 *
 * By default it importScripts() it from cdn.jsdelivr.net — when that CDN
 * is slow or blocked (it is on some networks), compressing an avatar or
 * chat image hangs forever before any upload even starts. The same file
 * is served from our own origin instead (public/vendor/, copied from
 * node_modules/browser-image-compression/dist; bump the file together
 * with the package version).
 */
export const IMAGE_COMPRESSION_LIB_URL = "/vendor/browser-image-compression-2.0.2.js";
