import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.{js,mjs}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: [
        "core/**/*.js",
        "utils/**/*.js",
        "resources/**/*.js",
        "Sequelize_cli/**/*.js",
        "project.server.js",
      ],
      exclude: [
        "tests/**",
        "**/node_modules/**",
        "coverage/**",
        "Sequelize_cli/migrations/**",
        "Sequelize_cli/seeders/**",
        "resources/views/**",
      ],
    },
  },
});
