/**
 * BDD coverage report — shows which scenarios are bound vs pending.
 *
 * Run this test to see the current BDD coverage status:
 *   pnpm test -- bdd-coverage.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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

function matchStep(text: string): { def: StepDef; m: RegExpMatchArray } | null {
  for (const def of steps) {
    const m = text.match(def.re);
    if (m) return { def, m };
  }
  return null;
}

function isBound(s: Scenario): boolean {
  return s.steps.length > 0 && s.steps.every((st) => matchStep(st.text) !== null);
}

const features = loadScenarios();

describe('BDD coverage', () => {
  it('reports scenario coverage', () => {
    const total = features.reduce((n, f) => n + f.scenarios.length, 0);
    const bound = features.reduce(
      (n, f) => n + f.scenarios.filter(isBound).length,
      0,
    );
    const pending = total - bound;

    console.log('\n📊 BDD Coverage Report');
    console.log('─'.repeat(50));
    console.log(`Total scenarios: ${total}`);
    console.log(`Bound (executable): ${bound}`);
    console.log(`Pending: ${pending}`);
    console.log(`Coverage: ${total > 0 ? Math.round((bound / total) * 100) : 0}%`);
    console.log('─'.repeat(50));

    for (const { file, scenarios } of features) {
      const fileBound = scenarios.filter(isBound).length;
      const fileTotal = scenarios.length;
      const status = fileBound === fileTotal ? '✅' : fileBound > 0 ? '🔶' : '❌';
      console.log(`${status} ${file}: ${fileBound}/${fileTotal} bound`);

      for (const s of scenarios) {
        if (!isBound(s)) {
          const unboundSteps = s.steps.filter((st) => !matchStep(st.text));
          console.log(`   ⏳ ${s.name}`);
          for (const step of unboundSteps) {
            console.log(`      → ${step.keyword} ${step.text}`);
          }
        }
      }
    }

    // Always passes — this is informational
    expect(total).toBeGreaterThanOrEqual(0);
  });

  it('lists all unbound steps for implementation', () => {
    const unbound = new Map<string, number>();

    for (const { scenarios } of features) {
      for (const s of scenarios) {
        for (const step of s.steps) {
          if (!matchStep(step.text)) {
            const key = `${step.keyword} ${step.text}`;
            unbound.set(key, (unbound.get(key) || 0) + 1);
          }
        }
      }
    }

    if (unbound.size > 0) {
      console.log('\n🔧 Steps needing implementation:');
      console.log('─'.repeat(50));
      const sorted = [...unbound.entries()].sort((a, b) => b[1] - a[1]);
      for (const [step, count] of sorted) {
        console.log(`  ${count}x ${step}`);
      }
    }

    expect(unbound.size).toBeGreaterThanOrEqual(0);
  });
});
