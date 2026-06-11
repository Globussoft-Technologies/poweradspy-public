import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: [
        "core/**/*.js",
        "utils/**/*.js",
        "resources/**/*.js",
        "models/**/*.js",
        "Sequelize/**/*.js",
        "server.js",
      ],
      exclude: ["tests/**", "**/node_modules/**", "resources/views/**"],
    },
  },
});
