/**
 * Minimal Gherkin parser for Blackbook's BDD suite (docs/qa/bdd/*.feature).
 *
 * Scope is deliberately limited to the constructs those files actually use:
 * tags, Feature, Rule, Scenario, Scenario Outline + Examples, and
 * Given/When/Then/And/But steps. No Background, DocStrings, or DataTables.
 * Keeping this hand-rolled avoids a new dependency while letting the `.feature`
 * files remain the literal source of truth for executable tests.
 */

export interface Step {
  /** Original keyword (Given/When/Then/And/But). */
  keyword: string;
  /** Step text with any `<placeholder>` already substituted for outlines. */
  text: string;
}

export interface Scenario {
  feature: string;
  rule?: string;
  name: string;
  /** Feature + rule + scenario tags, merged (Cucumber inheritance). */
  tags: string[];
  steps: Step[];
  /** True when expanded from a Scenario Outline example row. */
  outline: boolean;
}

const STEP_RE = /^(Given|When|Then|And|But|\*)\s+(.*)$/;
const TAG_LINE_RE = /^@[\w-]+(\s+@[\w-]+)*\s*$/;

function parseTableRow(line: string): string[] {
  return line
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());
}

/** Parse one `.feature` file's text into fully-expanded scenarios. */
export function parseFeature(src: string): Scenario[] {
  const lines = src.split(/\r?\n/);
  const scenarios: Scenario[] = [];

  let featureName = '';
  let featureTags: string[] = [];
  let ruleName: string | undefined;
  let ruleTags: string[] = [];
  let pendingTags: string[] = [];

  // Current scenario / outline being accumulated.
  type Draft = {
    name: string;
    tags: string[];
    rule?: string;
    steps: Step[];
    isOutline: boolean;
  };
  let draft: Draft | null = null;

  // Examples accumulation for the active outline.
  let inExamples = false;
  let exampleHeader: string[] | null = null;
  let exampleRows: string[][] = [];

  const flushDraft = () => {
    if (!draft) return;
    if (draft.isOutline) {
      // Expand one scenario per example row.
      if (exampleHeader) {
        for (const row of exampleRows) {
          const subst = (s: string) =>
            exampleHeader!.reduce(
              (acc, col, i) => acc.split(`<${col}>`).join(row[i] ?? ''),
              s,
            );
          scenarios.push({
            feature: featureName,
            rule: draft.rule,
            name: subst(draft.name),
            tags: draft.tags,
            steps: draft.steps.map((st) => ({ keyword: st.keyword, text: subst(st.text) })),
            outline: true,
          });
        }
      }
    } else {
      scenarios.push({
        feature: featureName,
        rule: draft.rule,
        name: draft.name,
        tags: draft.tags,
        steps: draft.steps,
        outline: false,
      });
    }
    draft = null;
    inExamples = false;
    exampleHeader = null;
    exampleRows = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    if (TAG_LINE_RE.test(line)) {
      pendingTags.push(...line.split(/\s+/).map((t) => t.replace(/^@/, '')));
      continue;
    }

    if (line.startsWith('Feature:')) {
      flushDraft();
      featureName = line.slice('Feature:'.length).trim();
      featureTags = pendingTags;
      pendingTags = [];
      ruleName = undefined;
      ruleTags = [];
      continue;
    }

    if (line.startsWith('Rule:')) {
      flushDraft();
      ruleName = line.slice('Rule:'.length).trim();
      ruleTags = pendingTags;
      pendingTags = [];
      continue;
    }

    if (line.startsWith('Scenario Outline:') || line.startsWith('Scenario:') || line.startsWith('Example:')) {
      flushDraft();
      const isOutline = line.startsWith('Scenario Outline:');
      const name = line.slice(line.indexOf(':') + 1).trim();
      draft = {
        name,
        tags: Array.from(new Set([...featureTags, ...ruleTags, ...pendingTags])),
        rule: ruleName,
        steps: [],
        isOutline,
      };
      pendingTags = [];
      continue;
    }

    if (line.startsWith('Examples:')) {
      inExamples = true;
      exampleHeader = null;
      continue;
    }

    if (line.startsWith('|')) {
      const row = parseTableRow(line);
      if (inExamples) {
        if (!exampleHeader) exampleHeader = row;
        else exampleRows.push(row);
      }
      continue;
    }

    const stepMatch = STEP_RE.exec(line);
    if (stepMatch && draft) {
      draft.steps.push({ keyword: stepMatch[1], text: stepMatch[2].trim() });
      continue;
    }
    // Anything else is descriptive prose — ignored.
  }

  flushDraft();
  return scenarios;
}
