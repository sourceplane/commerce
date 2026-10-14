import { defineConfig } from "vitest/config";
import * as path from "node:path";

// Upstream imports its own modules by bare path (`lib/shopify`,
// `components/...`) through tsconfig `baseUrl: "."`; the aliases make the
// same specifiers resolve from here.
const app = path.resolve(__dirname, "../../apps/web");

export default defineConfig({
  resolve: {
    alias: [
      { find: /^app\//, replacement: `${app}/app/` },
      { find: /^components\//, replacement: `${app}/components/` },
      { find: /^lib\//, replacement: `${app}/lib/` },
    ],
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
