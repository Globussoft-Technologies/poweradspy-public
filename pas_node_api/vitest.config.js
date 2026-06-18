import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.{js,mjs,cjs}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: [
        "src/**/*.js",
      ],
      exclude: [
        "tests/**",
        "**/node_modules/**",
        "coverage/**",
        "src/server.js",
        "src/app.js",
        "src/admin/public/**",
      ],
    },
  },
});
