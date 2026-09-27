import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const flushModule = fileURLToPath(new URL("./flush.ts", import.meta.url));

describe("flushStdio", () => {
  it("lets output far past the 64 KB pipe buffer reach a pipe before process.exit", () => {
    const size = 400_000;
    const script = `import { flushStdio } from ${JSON.stringify(flushModule)};
process.stdout.write("x".repeat(${size}));
await flushStdio();
process.exit(0);`;
    // spawnSync reads stdout through a pipe, like `blackbook list --json | jq`.
    const r = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      encoding: "utf-8",
      maxBuffer: 10 * size,
    });
    expect(r.status).toBe(0);
    expect(r.stdout.length).toBe(size);
  }, 30_000);
});
