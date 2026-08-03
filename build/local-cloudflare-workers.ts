// The personal archive uses IndexedDB in local mode, so no Cloudflare binding
// is needed. This shim only lets Vite resolve server modules that are reserved
// for the hosted version.
export const env: Record<string, never> = {};
