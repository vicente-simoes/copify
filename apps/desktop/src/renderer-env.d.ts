import type { CopifyApi } from "./preload";

declare global {
  interface Window { copify: CopifyApi; }
}

export {};
