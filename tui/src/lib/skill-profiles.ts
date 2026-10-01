/**
 * Skill-lock profiles: reusable fragments of a `skills-lock.json`.
 *
 * A profile is a file `<source repo>/profiles/<name>.skills-lock.json` in the
 * skills CLI's own lockfile format:
 *
 *   { "version": 1, "skills": { "<name>": { "source": "owner/repo",
 *       "sourceType": "github", "skillPath": "skills/x/SKILL.md" } } }
 *
 * so it is usable without Blackbook: copy its entries into a project's
 * skills-lock.json and run `npx skills experimental_install`. Profiles are
 * versioned with the source repo and identical on every machine.
 *
 * A project's own skills-lock.json (or the global ~/.agents/.skill-lock.json
 * for the Global workspace) is the source of truth for what a project uses.
 * Profile coverage is derived by comparing the two; the only extra state is a
 * machine-local snapshot of what each profile contained when it was applied
 * (so "removed from the profile since" can be shown). Losing that snapshot
 * only loses the "removed" count.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "fs";
import { homedir } from "os";
import { basename, isAbsolute, join, relative, resolve, sep } from "path";
import type { ToolInstance } from "./types.js";
import { atomicWriteFileSync } from "./fs-utils.js";
import { getCacheDir } from "./config/path.js";
import { indexSourceSkills } from "./projects.js";
import { skillsSourceForRepo } from "./project-actions.js";
import { enabledSkillAgents, runSkillsCli, summarizeCliFailure } from "./skills-cli.js";
import { callGroups, runSkillsCliSync } from "./plugin-skills-cli.js";

export const PROFILE_SUFFIX = ".skills-lock.json";
export const PROFILES_SUBDIR = "profiles";

export interface LockEntry {
  source: string;
  sourceType: string;
  sourceUrl?: string;
  ref?: string;
  skillPath?: string;
}

export interface SkillLockFile {
  version: number;
  skills: Record<string, LockEntry>;
}

const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;

export function isValidProfileName(name: string): boolean {
  return PROFILE_NAME.test(name) && !name.includes("..");
}

export function profilesDir(sourceRepo: string): string {
  return join(sourceRepo, PROFILES_SUBDIR);
}

/** Absolute path to a profile's lock file in the source repo. */
export function profileLockPath(sourceRepo: string, name: string): string {
  return profilePath(sourceRepo, name);
}

function profilePath(sourceRepo: string, name: string): string {
  return join(profilesDir(sourceRepo), `${name}${PROFILE_SUFFIX}`);
}

/** Only the portable fields — hashes, timestamps, and machine paths never go in a profile. */
function portable(entry: Partial<LockEntry> & Record<string, unknown>): LockEntry | null {
  if (typeof entry.source !== "string" || typeof entry.sourceType !== "string") return null;
  const out: LockEntry = { source: entry.source, sourceType: entry.sourceType };
  if (typeof entry.sourceUrl === "string" && entry.sourceType !== "github") out.sourceUrl = entry.sourceUrl;
  if (typeof entry.ref === "string" && entry.ref) out.ref = entry.ref;
  if (typeof entry.skillPath === "string" && entry.skillPath) out.skillPath = entry.skillPath;
  return out;
}

function readLockFile(path: string, localBase?: string): SkillLockFile | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as { version?: unknown; skills?: Record<string, Record<string, unknown>> };
    if (!raw || typeof raw !== "object" || !raw.skills || typeof raw.skills !== "object") return null;
    const skills: Record<string, LockEntry> = {};
    for (const [name, entry] of Object.entries(raw.skills)) {
      const p = entry && typeof entry === "object" ? portable(entry) : null;
      // The CLI writes project-lock `local` sources relative to the project dir.
      if (p && localBase && p.sourceType === "local" && !isAbsolute(p.source)) p.source = resolve(localBase, p.source);
      if (p) skills[name] = p;
    }
    return { version: typeof raw.version === "number" ? raw.version : 1, skills };
  } catch {
    return null;
  }
}

function writeLockFile(path: string, lock: SkillLockFile): void {
  const skills: Record<string, LockEntry> = {};
  for (const name of Object.keys(lock.skills).sort()) skills[name] = lock.skills[name];
  mkdirSync(resolve(path, ".."), { recursive: true });
  atomicWriteFileSync(path, JSON.stringify({ version: 1, skills }, null, 2) + "\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Profiles on disk
// ─────────────────────────────────────────────────────────────────────────────

export function listProfileLocks(sourceRepo: string | null): Record<string, SkillLockFile> {
  const out: Record<string, SkillLockFile> = {};
  if (!sourceRepo) return out;
  let entries: string[] = [];
  try {
    entries = readdirSync(profilesDir(sourceRepo));
  } catch {
    return out;
  }
  for (const file of entries.sort()) {
    if (!file.endsWith(PROFILE_SUFFIX)) continue;
    const name = file.slice(0, -PROFILE_SUFFIX.length);
    const lock = readLockFile(join(profilesDir(sourceRepo), file));
    if (lock && isValidProfileName(name)) out[name] = lock;
  }
  return out;
}

export function writeProfileLock(sourceRepo: string, name: string, lock: SkillLockFile): void {
  if (!isValidProfileName(name)) throw new Error(`Invalid profile name: ${name}`);
  writeLockFile(profilePath(sourceRepo, name), lock);
}

export function deleteProfileLock(sourceRepo: string, name: string): boolean {
  const path = profilePath(sourceRepo, name);
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Building entries
// ─────────────────────────────────────────────────────────────────────────────

export function globalLockPath(): string {
  const state = process.env.XDG_STATE_HOME;
  return state ? join(state, "skills", ".skill-lock.json") : join(homedir(), ".agents", ".skill-lock.json");
}

/** Portable entries for every globally installed CLI skill (third-party sources included). */
export function globalLockEntries(): Record<string, LockEntry> {
  return readLockFile(globalLockPath())?.skills ?? {};
}

/** A lock entry for a skill in the configured source repo (its GitHub remote), or null. */
export function sourceRepoEntry(sourceRepo: string, skillDir: string): LockEntry | null {
  const { source, warning } = skillsSourceForRepo(sourceRepo);
  if (warning || !/^[\w.-]+\/[\w.-]+$/.test(source)) return null;
  const rel = relative(resolve(sourceRepo), resolve(skillDir)).split(sep).join("/");
  if (!rel || rel.startsWith("..")) return null;
  return { source, sourceType: "github", skillPath: `${rel}/SKILL.md` };
}

/**
 * Build a profile from skill names picked in the builder. Each name keeps its
 * existing profile entry, else the global lock's entry (so third-party skills
 * keep their real source), else the source repo's. Names with no known source
 * are returned in `unresolved`.
 */
export function buildProfileLock(
  names: string[],
  sourceRepo: string | null,
  existing?: SkillLockFile,
): { lock: SkillLockFile; unresolved: string[] } {
  const global = globalLockEntries();
  const sourceIndex = sourceRepo ? indexSourceSkills(sourceRepo) : new Map<string, string>();
  const skills: Record<string, LockEntry> = {};
  const unresolved: string[] = [];
  for (const name of names) {
    const fromSource = sourceRepo && sourceIndex.get(name) ? sourceRepoEntry(sourceRepo, sourceIndex.get(name)!) : null;
    const entry = existing?.skills[name] ?? global[name] ?? fromSource;
    if (entry) skills[name] = entry;
    else unresolved.push(name);
  }
  return { lock: { version: 1, skills }, unresolved };
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspaces (project or global) and coverage
// ─────────────────────────────────────────────────────────────────────────────

export function isGlobalWorkspace(path: string): boolean {
  return resolve(path) === resolve(homedir());
}

/** The lock that defines a workspace: the project's skills-lock.json, or the global lock for $HOME. */
export function workspaceLock(path: string): SkillLockFile {
  const file = isGlobalWorkspace(path) ? globalLockPath() : join(path, "skills-lock.json");
  return readLockFile(file, isGlobalWorkspace(path) ? undefined : path) ?? { version: 1, skills: {} };
}

function sameSource(a: LockEntry, b: LockEntry): boolean {
  if (a.sourceType === "local" || b.sourceType === "local") return resolve(a.source) === resolve(b.source);
  const norm = (s: string) => s.toLowerCase().replace(/^github:/, "").replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
  return norm(a.source) === norm(b.source);
}

export interface ProfileCoverage {
  profile: string;
  total: number;
  /** Profile skills the workspace already has from the same source. */
  present: string[];
  /** Profile skills the workspace lacks (or has from a different source). */
  missing: string[];
  /** Skills dropped from the profile since it was applied here, still in the workspace. */
  removed: string[];
  /** True once the profile was applied here (a snapshot exists). */
  applied: boolean;
}

export function profileCoverage(
  name: string,
  profile: SkillLockFile,
  lock: SkillLockFile,
  snapshot?: string[],
): ProfileCoverage {
  const present: string[] = [];
  const missing: string[] = [];
  for (const [skill, entry] of Object.entries(profile.skills)) {
    const have = lock.skills[skill];
    if (have && sameSource(have, entry)) present.push(skill);
    else missing.push(skill);
  }
  const removed = (snapshot ?? []).filter((s) => !(s in profile.skills) && s in lock.skills);
  return { profile: name, total: Object.keys(profile.skills).length, present: present.sort(), missing: missing.sort(), removed: removed.sort(), applied: snapshot !== undefined };
}

// ── machine-local apply snapshots ───────────────────────────────────────────

function snapshotsPath(): string {
  return join(getCacheDir(), "profile-applications.json");
}

type Snapshots = Record<string, Record<string, string[]>>;

function readSnapshots(): Snapshots {
  try {
    return JSON.parse(readFileSync(snapshotsPath(), "utf-8")) as Snapshots;
  } catch {
    return {};
  }
}

export function profileSnapshot(workspace: string, profile: string): string[] | undefined {
  return readSnapshots()[resolve(workspace)]?.[profile];
}

function recordSnapshot(workspace: string, profile: string, names: string[]): void {
  const all = readSnapshots();
  const key = resolve(workspace);
  all[key] = { ...(all[key] ?? {}), [profile]: [...names].sort() };
  mkdirSync(getCacheDir(), { recursive: true });
  atomicWriteFileSync(snapshotsPath(), JSON.stringify(all, null, 2) + "\n");
}

/** Coverage of every profile for one workspace. */
export function workspaceCoverage(path: string, profiles: Record<string, SkillLockFile>): ProfileCoverage[] {
  const lock = workspaceLock(path);
  return Object.entries(profiles).map(([name, profile]) => profileCoverage(name, profile, lock, profileSnapshot(path, name)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply
// ─────────────────────────────────────────────────────────────────────────────

/** The `skills add` source argument for a lock entry. */
export function addSourceFor(entry: LockEntry): string {
  if (entry.sourceType === "github") return entry.ref ? `${entry.source}#${entry.ref}` : entry.source;
  return entry.sourceUrl ?? entry.source;
}

export interface ApplyResult {
  added: string[];
  removed: string[];
  errors: string[];
}

/**
 * Bring a workspace up to a profile: add its missing skills (one `skills add`
 * per source) and remove skills dropped from it since it was last applied
 * here. Project workspaces install for Blackbook's enabled agents (so Claude
 * gets links too); the Global workspace installs with `-g` for the universal
 * agents and each Claude instance.
 */
export async function applyProfileToWorkspace(
  workspace: string,
  name: string,
  profile: SkillLockFile,
  instances: ToolInstance[],
): Promise<ApplyResult> {
  const coverage = profileCoverage(name, profile, workspaceLock(workspace), profileSnapshot(workspace, name));
  const result: ApplyResult = { added: [], removed: [], errors: [] };
  const global = isGlobalWorkspace(workspace);

  const bySource = new Map<string, string[]>();
  for (const skill of coverage.missing) {
    const src = addSourceFor(profile.skills[skill]);
    bySource.set(src, [...(bySource.get(src) ?? []), skill]);
  }

  for (const [source, skills] of bySource) {
    const base = ["add", source, "-y", ...skills.flatMap((s) => ["--skill", s])];
    if (global) {
      let ok = true;
      for (const g of callGroups(instances)) {
        const r = runSkillsCliSync([...base, "-g", ...g.agents.flatMap((a) => ["-a", a])], g.env);
        if (!r.ok) {
          ok = false;
          result.errors.push(`${source}: ${r.error}`);
        }
      }
      if (ok) result.added.push(...skills);
    } else {
      const r = await runSkillsCli([...base, ...enabledSkillAgents().flatMap((a) => ["-a", a])], { cwd: workspace });
      if (r.code === 0) result.added.push(...skills);
      else result.errors.push(`${source}: ${summarizeCliFailure(r)}`);
    }
  }

  if (coverage.removed.length > 0) {
    if (global) {
      for (const g of callGroups(instances)) {
        const agentArgs = g.agents.includes("codex") ? [] : g.agents.flatMap((a) => ["-a", a]);
        const r = runSkillsCliSync(["remove", ...coverage.removed, "-g", "-y", ...agentArgs], g.env);
        if (!r.ok) result.errors.push(`remove: ${r.error}`);
      }
    } else {
      const r = await runSkillsCli(["remove", ...coverage.removed, "-y"], { cwd: workspace });
      if (r.code !== 0) result.errors.push(`remove: ${summarizeCliFailure(r)}`);
    }
    if (!result.errors.some((e) => e.startsWith("remove:"))) result.removed.push(...coverage.removed);
  }

  if (result.errors.length === 0) recordSnapshot(workspace, name, Object.keys(profile.skills));
  return result;
}

/**
 * A workspace's current lock (project or global) as a profile. A `local`
 * entry inside the source repo becomes that repo's remote entry, so the profile
 * works on any machine. Other `local` entries are kept but listed in
 * `localOnly`, because their absolute paths only exist on this machine.
 */
export function lockAsProfile(workspace: string, sourceRepo: string | null): { lock: SkillLockFile; localOnly: string[] } {
  const skills: Record<string, LockEntry> = {};
  const localOnly: string[] = [];
  for (const [name, entry] of Object.entries(workspaceLock(workspace).skills)) {
    if (entry.sourceType !== "local") {
      skills[name] = entry;
      continue;
    }
    const skillDir = entry.skillPath ? join(entry.source, entry.skillPath.replace(/\/?SKILL\.md$/, "")) : entry.source;
    const fromRepo = sourceRepo ? sourceRepoEntry(sourceRepo, skillDir) : null;
    if (fromRepo) {
      skills[name] = fromRepo;
    } else {
      skills[name] = entry;
      localOnly.push(name);
    }
  }
  return { lock: { version: 1, skills }, localOnly: localOnly.sort() };
}

/** Mark a profile as applied to a workspace with exactly these skills (after saving it from that workspace). */
export function markProfileApplied(workspace: string, profile: string, names: string[]): void {
  recordSnapshot(workspace, profile, names);
}

export function profileDisplayPath(sourceRepo: string, name: string): string {
  return join(basename(sourceRepo), PROFILES_SUBDIR, `${name}${PROFILE_SUFFIX}`);
}
