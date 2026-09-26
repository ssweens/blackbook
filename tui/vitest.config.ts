import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Blackbook delegates skills to the bundled skills CLI; unit tests keep the
    // old in-process behavior unless a test opts in (BLACKBOOK_SKILLS_CLI=1).
    env: { BLACKBOOK_SKILLS_CLI: "0" },
    include: ["src/**/*.test.ts", "vendor/skills/src/**/*.test.ts", "src/**/*.test.tsx", "test/**/*.test.ts"],
  },
});
