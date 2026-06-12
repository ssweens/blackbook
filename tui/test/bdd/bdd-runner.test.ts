/**
 * Executable BDD runner for Blackbook.
 *
 * Treats `docs/qa/bdd/*.feature` as the literal source of truth and runs every
 * scenario whose steps are backed by real production logic as a genuine
 * red/green test. Scenarios that have no step bindings yet are surfaced as
 * `it.todo` (pending) — never faked green — so the suite honestly tracks how
 * much of the spec is actually executable today.
 */
import { describe, it, afterEach } from 'vitest';
import { readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFeature, type Scenario } from './gherkin.js';
import { steps, type StepDef } from './steps.js';

const here = dirname(fileURLToPath(import.meta.url));
// Feature files are at <project-root>/docs/qa/bdd/ — three levels up from tui/test/bdd/
const bddDir = join(here, '..', '..', '..', 'docs', 'qa', 'bdd');

function loadScenarios(): { file: string; scenarios: Scenario[] }[] {
  if (!existsSync(bddDir)) {
    return [];
  }
  return readdirSync(bddDir)
    .filter((f) => f.endsWith('.feature'))
    .sort()
    .map((f) => ({
      file: f,
      scenarios: parseFeature(readFileSync(join(bddDir, f), 'utf8')),
    }));
}

/** Find the single step definition matching a step's text, if any. */
function matchStep(text: string): { def: StepDef; m: RegExpMatchArray } | null {
  for (const def of steps) {
    const m = text.match(def.re);
    if (m) return { def, m };
  }
  return null;
}

/** A scenario is executable only when EVERY step is bound to real logic. */
function isBound(s: Scenario): boolean {
  return s.steps.length > 0 && s.steps.every((st) => matchStep(st.text) !== null);
}

const features = loadScenarios();

describe('BDD: docs/qa/bdd feature files', () => {
  it('discovers feature files and scenarios', () => {
    expect(features.length).toBeGreaterThan(0);
    const total = features.reduce((n, f) => n + f.scenarios.length, 0);
    expect(total).toBeGreaterThan(0);
  });

  for (const { file, scenarios } of features) {
    describe(file, () => {
      for (const s of scenarios) {
        const title = s.tags.length ? `[${s.tags.join(',')}] ${s.name}` : s.name;
        // Skip scenarios tagged with @wip
        if (s.tags.includes('wip')) {
          it.skip(title, () => {});
          continue;
        }
        if (isBound(s)) {
          it(title, () => {
            const world = { tmpDir: '' };
            try {
              for (const step of s.steps) {
                const hit = matchStep(step.text);
                if (!hit) throw new Error(`Unbound step: "${step.text}"`);
                hit.def.run(world, hit.m);
              }
            } finally {
              if (world.tmpDir && existsSync(world.tmpDir)) {
                rmSync(world.tmpDir, { recursive: true, force: true });
              }
            }
          });
        } else {
          it.todo(title);
        }
      }
    });
  }
});
