import type { Plugin } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Pinboard Worker default (`wrangler dev`). Override with VITE_DEV_API_PROXY_TARGET if needed. */
const DEV_API = process.env.VITE_DEV_API_PROXY_TARGET?.trim() || "http://localhost:8787";

/**
 * So `/loading-bay` and other client routes serve `index.html` in dev and preview.
 * When `base` is `/pinboard/`, only paths under that prefix are rewritten to `base` + query.
 */
function spaHistoryFallback(base: string): Plugin {
  const basePath = base.replace(/\/$/, "") || ""; // "" for base "/", "/pinboard" for "/pinboard/"

  return {
    name: "spa-history-fallback",
    configureServer(server) {
      return () => {
        server.middlewares.use((req, _res, next) => {
          if (req.method !== "GET" && req.method !== "HEAD") return next();
          const raw = req.url ?? "";
          const pathOnly = raw.split("?")[0] ?? "";
          const search = raw.includes("?") ? "?" + raw.split("?").slice(1).join("?") : "";
          if (basePath && pathOnly !== basePath && !pathOnly.startsWith(`${basePath}/`)) return next();
          const rel =
            basePath === ""
              ? pathOnly
              : pathOnly === basePath || pathOnly === `${basePath}/`
                ? "/"
                : pathOnly.slice(basePath.length) || "/";
          if (rel.includes(".")) return next();
          if (rel.startsWith("/api")) return next();
          if (rel.startsWith("/@")) return next();
          if (rel.startsWith("/src")) return next();
          if (rel.startsWith("/node_modules")) return next();
          const prefix = basePath ? `${basePath}/` : "/";
          req.url = search ? prefix + search : prefix;
          next();
        });
      };
    },
    configurePreviewServer(server) {
      return () => {
        server.middlewares.use((req, _res, next) => {
          if (req.method !== "GET" && req.method !== "HEAD") return next();
          const raw = req.url ?? "";
          const pathOnly = raw.split("?")[0] ?? "";
          const search = raw.includes("?") ? "?" + raw.split("?").slice(1).join("?") : "";
          if (basePath && pathOnly !== basePath && !pathOnly.startsWith(`${basePath}/`)) return next();
          const rel =
            basePath === ""
              ? pathOnly
              : pathOnly === basePath || pathOnly === `${basePath}/`
                ? "/"
                : pathOnly.slice(basePath.length) || "/";
          if (rel.includes(".")) return next();
          if (rel.startsWith("/api")) return next();
          const prefix = basePath ? `${basePath}/` : "/";
          req.url = search ? prefix + search : prefix;
          next();
        });
      };
    },
  };
}

export default defineConfig(({ mode }) => {
  /** gladesystems.uk serves this app under `/pinboard/` (router strips prefix when proxying to Pages). */
  const base = mode === "production" ? "/pinboard/" : "/";

  return {
    plugins: [react(), spaHistoryFallback(base)],
    base,
    server: {
      proxy: {
        // Same-origin `/api/*` in dev → avoids browser CORS (Vite :5173 → Worker :8787).
        "/api": {
          target: DEV_API,
          changeOrigin: true,
        },
      },
    },
  };
});
