#!/usr/bin/env node
/**
 * Patch Ink to fix a bug that breaks Esc-to-close on tall detail views.
 *
 * BUG:
 *   When a rendered frame's outputHeight >= terminal rows, Ink writes directly
 *   to stdout via `clearTerminal + output`, bypassing logUpdate. logUpdate's
 *   internal previousOutput/previousLineCount stays stale. On the next render
 *   that returns to a shorter output (height < rows), Ink goes back through
 *   logUpdate. If the new (short) output happens to equal logUpdate's stale
 *   previousOutput (e.g., the user opened a tall detail from a list and closed
 *   it back to the same list), logUpdate silently SKIPS the write — the screen
 *   stays stuck on the tall content until something else forces a write.
 *
 *   In Blackbook this manifests as: in the Installed tab, opening a Skill or
 *   Plugin detail (both can render taller than the terminal) and pressing Esc
 *   appears to do nothing until another key is pressed.
 *
 * FIX:
 *   1. Patch ink/build/log-update.js so the returned `render` function tracks
 *      its previousOutput/previousLineCount on the render function itself
 *      (`render._prev`, `render._lines`) and exposes a `render._setState(str)`
 *      method to prime that state without writing to stdout. This lets the
 *      caller align logUpdate's bookkeeping with content that was written
 *      directly to stdout via a different path.
 *
 *   2. Patch ink/build/ink.js so that when onRender takes the tall-write path
 *      (`outputHeight >= rows`), it sets `lastWasTall = true` and primes
 *      logUpdate's state via `this.log._setState(output)`. Subsequent short
 *      renders then correctly compute eraseLines against the actually-on-screen
 *      content and write the new frame.
 *
 * Both patches are idempotent and bail out cleanly if the upstream source has
 * drifted from the expected shape.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const inkPath = resolve(here, "..", "node_modules", "ink", "build", "ink.js");
const logUpdatePath = resolve(here, "..", "node_modules", "ink", "build", "log-update.js");

const MARKER = "// [PATCH-BLACKBOOK-INK-TALL-WRITE]";

let alreadyPatchedLog = false;
let alreadyPatchedInk = false;

function patchLogUpdate() {
  if (!existsSync(logUpdatePath)) return false;
  let src = readFileSync(logUpdatePath, "utf-8");
  if (src.includes(MARKER)) { alreadyPatchedLog = true; return true; }

  const target = `import ansiEscapes from 'ansi-escapes';
import cliCursor from 'cli-cursor';
const create = (stream, { showCursor = false } = {}) => {
    let previousLineCount = 0;
    let previousOutput = '';
    let hasHiddenCursor = false;
    const render = (str) => {
        if (!showCursor && !hasHiddenCursor) {
            cliCursor.hide();
            hasHiddenCursor = true;
        }
        const output = str + '\\n';
        if (output === previousOutput) {
            return;
        }
        previousOutput = output;
        stream.write(ansiEscapes.eraseLines(previousLineCount) + output);
        previousLineCount = output.split('\\n').length;
    };
    render.clear = () => {
        stream.write(ansiEscapes.eraseLines(previousLineCount));
        previousOutput = '';
        previousLineCount = 0;
    };
    render.done = () => {
        previousOutput = '';
        previousLineCount = 0;
        if (!showCursor) {
            cliCursor.show();
            hasHiddenCursor = false;
        }
    };
    return render;
};`;

  const replacement = `${MARKER}
import ansiEscapes from 'ansi-escapes';
import cliCursor from 'cli-cursor';
const create = (stream, { showCursor = false } = {}) => {
    let previousLineCount = 0;
    let previousOutput = '';
    let hasHiddenCursor = false;
    const render = (str) => {
        if (!showCursor && !hasHiddenCursor) {
            cliCursor.hide();
            hasHiddenCursor = true;
        }
        const output = str + '\\n';
        if (output === previousOutput) {
            return;
        }
        previousOutput = output;
        stream.write(ansiEscapes.eraseLines(previousLineCount) + output);
        previousLineCount = output.split('\\n').length;
    };
    render.clear = () => {
        stream.write(ansiEscapes.eraseLines(previousLineCount));
        previousOutput = '';
        previousLineCount = 0;
    };
    render.done = () => {
        previousOutput = '';
        previousLineCount = 0;
        if (!showCursor) {
            cliCursor.show();
            hasHiddenCursor = false;
        }
    };
    // [PATCH-BLACKBOOK-INK-TALL-WRITE] Prime internal state to match content that
    // was written to the stream via a different path (e.g., Ink's clearTerminal
    // tall-write branch). Without this, logUpdate's state diverges from the
    // actual screen and subsequent renders may silently skip writes.
    render._setState = (str) => {
        const output = str + '\\n';
        previousOutput = output;
        previousLineCount = output.split('\\n').length;
    };
    return render;
};`;

  if (!src.includes(target)) {
    console.warn("[patch-ink] log-update.js target not found, skipping");
    return false;
  }
  src = src.replace(target, replacement);
  writeFileSync(logUpdatePath, src);
  return true;
}

function patchInk() {
  if (!existsSync(inkPath)) return false;
  let src = readFileSync(inkPath, "utf-8");
  if (src.includes(MARKER)) { alreadyPatchedInk = true; return true; }

  const target = `        if (outputHeight >= this.options.stdout.rows) {
            this.options.stdout.write(ansiEscapes.clearTerminal + this.fullStaticOutput + output);
            this.lastOutput = output;
            return;
        }`;

  const replacement = `        if (outputHeight >= this.options.stdout.rows) {
            this.options.stdout.write(ansiEscapes.clearTerminal + this.fullStaticOutput + output);
            this.lastOutput = output;
            // ${MARKER.slice(3)} Sync logUpdate's internal state to what we just
            // wrote. Without this, the next short render that happens to equal
            // logUpdate's stale previousOutput would silently skip the write.
            if (typeof this.log._setState === 'function') {
                this.log._setState(output);
            }
            return;
        }`;

  if (!src.includes(target)) {
    console.warn("[patch-ink] ink.js target not found, skipping");
    return false;
  }
  src = src.replace(target, replacement);
  writeFileSync(inkPath, src);
  return true;
}

const a = patchLogUpdate();
const b = patchInk();
if (a && b) {
  if (alreadyPatchedLog && alreadyPatchedInk) {
    console.log("[patch-ink] already patched");
  } else {
    console.log("[patch-ink] applied Ink tall-write/short-write transition fix");
  }
} else {
  console.log("[patch-ink] partial or no-op (a=" + a + " b=" + b + ")");
}
