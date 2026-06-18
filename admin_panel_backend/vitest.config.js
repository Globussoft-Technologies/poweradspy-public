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
        "index.js",
        "config/**/*.js",
        "db-connections/**/*.js",
        "es-connections/**/*.js",
        "mongo-db/**/*.js",
        "routes/**/*.js",
        "services/**/*.js",
        "src/**/*.js",
        "utils/**/*.js",
        "websocket/**/*.js",
      ],
      exclude: [
        "tests/**",
        "**/node_modules/**",
        "coverage/**",
        "logs/**",
      ],
    },
  },
});

