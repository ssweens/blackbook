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
import { indexSourceSkills, getProjects, isGlobalWorkspace, workspaceSkillsDir } from "./projects.js";
import { getConfigRepoPath } from "./config.js";
import { loadConfig as loadYamlConfig } from "./config/loader.js";
import { lockInstallBreakdown, lockInstallGap, planInstall, sameGithubSource } from "./lock-install-sync.js";
import { skillsSourceForRepo } from "./project-actions.js";
import { projectSkillAgents, runSkillsCli, summarizeCliFailure } from "./skills-cli.js";
import { callGroups, type CliCallResult } from "./plugin-skills-cli.js";

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
  /**
   * Blackbook meta, only meaningful on a WORKSPACE lock (a project's
   * skills-lock.json or the global lock): the profiles assigned to that
   * workspace. Stored in the lock itself so the mapping travels with the repo
   * and an auto-detected workspace shows its profiles on any machine.
   */
  profiles?: string[];
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
    const raw = JSON.parse(readFileSync(path, "utf-8")) as { version?: unknown; skills?: Record<string, Record<string, unknown>>; profiles?: unknown };
    if (!raw || typeof raw !== "object" || !raw.skills || typeof raw.skills !== "object") return null;
    const skills: Record<string, LockEntry> = {};
    for (const [name, entry] of Object.entries(raw.skills)) {
      const p = entry && typeof entry === "object" ? portable(entry) : null;
      // The CLI writes project-lock `local` sources relative to the project dir.
      if (p && localBase && p.sourceType === "local" && !isAbsolute(p.source)) p.source = resolve(localBase, p.source);
      if (p) skills[name] = p;
    }
    const profiles = Array.isArray(raw.profiles)
      ? [...new Set(raw.profiles.filter((p): p is string => typeof p === "string" && p.trim().length > 0))]
      : undefined;
    return { version: typeof raw.version === "number" ? raw.version : 1, skills, ...(profiles && profiles.length > 0 ? { profiles } : {}) };
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

// isGlobalWorkspace / workspaceSkillsDir live in projects.ts (one definition); re-exported for callers.
export { isGlobalWorkspace, workspaceSkillsDir };

/** Path of the lock that defines a workspace: the project's skills-lock.json, or the global lock for $HOME. */
export function workspaceLockPath(path: string): string {
  return isGlobalWorkspace(path) ? globalLockPath() : join(path, "skills-lock.json");
}

/** The lock that defines a workspace: the project's skills-lock.json, or the global lock for $HOME. */
export function workspaceLock(path: string): SkillLockFile {
  return readLockFile(workspaceLockPath(path), isGlobalWorkspace(path) ? undefined : path) ?? { version: 1, skills: {} };
}

// ── Profile ↔ workspace mapping (stored IN the workspace lock) ───────────────

/** Profiles assigned to a workspace, read from its lock's `profiles` meta. */
export function workspaceProfiles(path: string): string[] {
  return [...(workspaceLock(path).profiles ?? [])].sort();
}

/**
 * Write the workspace lock's `profiles` meta, touching nothing else in the
 * file (the CLI owns the rest — hashes, versions). Never fabricates a lock:
 * if there is no lock file yet there is nothing installed to map a profile
 * to, and creating one with the wrong `version` would make the CLI wipe it.
 * Returns false when the lock file doesn't exist.
 */
export function setWorkspaceProfiles(path: string, names: string[]): boolean {
  const file = workspaceLockPath(path);
  if (!existsSync(file)) return false;
  let raw: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as unknown;
    raw = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return false;
  }
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort();
  if (clean.length > 0) raw.profiles = clean;
  else delete raw.profiles;
  atomicWriteFileSync(file, JSON.stringify(raw, null, 2) + "\n");
  return true;
}

/** Assign a profile to a workspace (idempotent). */
export function assignProfileToWorkspace(path: string, name: string): boolean {
  const current = workspaceProfiles(path);
  if (current.includes(name)) return true;
  return setWorkspaceProfiles(path, [...current, name]);
}

/**
 * Remove a profile from a workspace's assignment (does not uninstall skills).
 * Also forgets the machine-local apply snapshot, so a profile applied before
 * the mapping existed (snapshot only, no lock meta) can be unassigned too.
 */
export function unassignProfileFromWorkspace(path: string, name: string): boolean {
  clearSnapshot(path, name);
  const current = workspaceProfiles(path);
  if (!current.includes(name)) return true;
  return setWorkspaceProfiles(path, current.filter((n) => n !== name));
}

function sameSource(a: LockEntry, b: LockEntry): boolean {
  if (a.sourceType === "local" || b.sourceType === "local") return resolve(a.source) === resolve(b.source);
  return sameGithubSource(a.source, b.source);
}

/** Case-insensitive profile ordering — the ONE comparator every profile list and picker uses. */
export function compareProfileNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

/** "ssweens/playbook ×47, anthropics/skills ×1" — where a profile's skills come from. */
export function profileSources(lock: { skills: Record<string, { source: string }> }): string {
  const counts = new Map<string, number>();
  for (const e of Object.values(lock.skills)) counts.set(e.source, (counts.get(e.source) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([src, n]) => `${src} ×${n}`).join(", ");
}

/**
 * A legacy config.yaml profile (a list of skill names) resolved into a lock on
 * the fly, or null when no such legacy profile exists. Saving it in the builder
 * converts it to a real profiles/<name>.skills-lock.json.
 */
export function legacyProfileLock(name: string, sourceRepo: string | null): SkillLockFile | null {
  const names = loadYamlConfig().config.profiles?.[name];
  return names ? buildProfileLock(names, sourceRepo).lock : null;
}

/** Every workspace whose lock can carry a profile assignment: Global plus the registered projects. */
export function knownWorkspaces(): string[] {
  const paths = new Set<string>([homedir()]);
  try { for (const p of getProjects()) if (!p.synthetic) paths.add(p.path); } catch { /* best effort */ }
  return [...paths];
}

/** A profile was renamed: carry its assignment to the new name in every workspace lock that had it. */
export function renameProfileAssignments(oldName: string, newName: string): number {
  let changed = 0;
  for (const ws of knownWorkspaces()) {
    const current = workspaceProfiles(ws);
    if (!current.includes(oldName)) continue;
    if (setWorkspaceProfiles(ws, current.map((n) => (n === oldName ? newName : n)))) changed++;
  }
  return changed;
}

/** A profile was deleted: drop its assignment (and apply snapshot) from every workspace. */
export function unassignProfileEverywhere(name: string): number {
  let changed = 0;
  for (const ws of knownWorkspaces()) {
    const had = workspaceProfiles(ws).includes(name) || profileSnapshot(ws, name) !== undefined;
    if (!had) continue;
    if (unassignProfileFromWorkspace(ws, name)) changed++;
  }
  return changed;
}

/**
 * The configured source repo as a skills-CLI GitHub source ("owner/repo"), or
 * undefined when none is configured or it has no usable GitHub remote. Used to
 * recognise lock entries that point at the source repo.
 */
export function configuredRepoSource(): string | undefined {
  const repo = getConfigRepoPath();
  if (!repo) return undefined;
  const { source, warning } = skillsSourceForRepo(repo);
  return warning || !/^[\w.-]+\/[\w.-]+$/.test(source) ? undefined : source;
}

/** Lock-only coverage of a profile against a workspace (what profileCoverage computes). */
export interface ProfileCoverageBase {
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

/** Full status of a profile against a workspace: lock coverage + disk truth + assignment. */
export interface ProfileCoverage extends ProfileCoverageBase {
  /** True when the workspace lock's `profiles` meta names this profile. */
  assigned: boolean;
  /** Profile skills in the workspace lock but not installed on disk in its agent skills dir. */
  installMissing: string[];
  /** Profile skills installed on disk whose content differs from the source. */
  drifted: string[];
  /** Profile skills from the source repo that the repo no longer has — an apply can't install them; edit the profile. */
  unresolvable: string[];
  /** Everything an apply must act on: missing from the lock ∪ missing on disk. */
  toApply: string[];
  /** Nothing to apply, nothing drifted, nothing removed. */
  upToDate: boolean;
}

export function profileCoverage(
  name: string,
  profile: SkillLockFile,
  lock: SkillLockFile,
  snapshot?: string[],
): ProfileCoverageBase {
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

/** Forget that a profile was applied to a workspace (used when unassigning). */
function clearSnapshot(workspace: string, profile: string): void {
  const all = readSnapshots();
  const key = resolve(workspace);
  if (!all[key] || !(profile in all[key])) return;
  delete all[key][profile];
  if (Object.keys(all[key]).length === 0) delete all[key];
  mkdirSync(getCacheDir(), { recursive: true });
  atomicWriteFileSync(snapshotsPath(), JSON.stringify(all, null, 2) + "\n");
}

/**
 * THE apply plan for a profile against a workspace: everything missing or
 * drifted on disk (planInstall) plus everything the workspace LOCK lacks —
 * a skill copied onto disk by hand still has to be recorded by `skills add`.
 * Pure and synchronous; used by applyProfileToWorkspace and by the BDD suite.
 */
export function planApply(
  profileSkills: Record<string, LockEntry>,
  workspaceLockSkills: Record<string, LockEntry>,
  installedDir: string,
  sourceIndex: Map<string, string>,
  repoSource?: string,
): string[] {
  const gap = lockInstallGap(profileSkills, installedDir, sourceIndex, repoSource);
  const unresolvable = new Set(gap.unresolvable);
  const set = new Set([...gap.missing, ...gap.drifted]);
  for (const [skill, entry] of Object.entries(profileSkills)) {
    const have = workspaceLockSkills[skill];
    // Lock-missing too — but never a skill nothing can install.
    if ((!have || !sameSource(have, entry)) && !unresolvable.has(skill)) set.add(skill);
  }
  return [...set].sort();
}

/**
 * "Is this profile up to date with this workspace?" — one function for the
 * Projects drill-in, the project list row and the profile detail. Up to date
 * means every profile skill is in the workspace lock from the same source,
 * installed on disk in the workspace's agent skills dir, not drifted from its
 * source, and nothing dropped from the profile is lingering.
 */
export function profileWorkspaceStatus(
  name: string,
  profile: SkillLockFile,
  workspace: string,
  sourceIndex: Map<string, string>,
  lock: SkillLockFile = workspaceLock(workspace),
  repoSource: string | undefined = configuredRepoSource(),
): ProfileCoverage {
  const base = profileCoverage(name, profile, lock, profileSnapshot(workspace, name));
  const gap = lockInstallGap(profile.skills, workspaceSkillsDir(workspace), sourceIndex, repoSource);
  // Nothing can apply an unresolvable skill, so it is reported, not planned.
  const unresolvable = new Set(gap.unresolvable);
  const toApply = [...new Set([...base.missing, ...gap.missing])].filter((s) => !unresolvable.has(s)).sort();
  return {
    ...base,
    // Lock meta is the source of truth; a legacy apply snapshot (from before
    // the mapping existed) also counts, and the next apply writes the meta.
    assigned: (lock.profiles ?? []).includes(name) || base.applied,
    installMissing: gap.missing,
    drifted: gap.drifted,
    unresolvable: gap.unresolvable,
    toApply,
    upToDate: toApply.length === 0 && gap.drifted.length === 0 && gap.unresolvable.length === 0 && base.removed.length === 0,
  };
}

/**
 * Coverage of every profile for one workspace. Assigned profiles get the full
 * disk-truth status (presence + drift); the rest get lock coverage only — no
 * hashing for profiles the workspace doesn't track.
 */
export function workspaceCoverage(path: string, profiles: Record<string, SkillLockFile>): ProfileCoverage[] {
  const lock = workspaceLock(path);
  const assigned = new Set(lock.profiles ?? []);
  const sourceRepo = getConfigRepoPath();
  const sourceIndex = sourceRepo ? indexSourceSkills(sourceRepo) : new Map<string, string>();
  const repoSource = configuredRepoSource();
  return Object.entries(profiles).map(([name, profile]) => {
    if (assigned.has(name) || profileSnapshot(path, name) !== undefined) return profileWorkspaceStatus(name, profile, path, sourceIndex, lock, repoSource);
    const base = profileCoverage(name, profile, lock, profileSnapshot(path, name));
    return { ...base, assigned: false, installMissing: [], drifted: [], unresolvable: [], toApply: [...base.missing], upToDate: false };
  });
}

/**
 * "N to apply, M drifted, K removed" — or "up to date". The one summary of a
 * profile's state against a workspace, used by the Projects drill-in line,
 * the project list row and the profile detail's "Used by".
 */
export function profileStatusSummary(c: ProfileCoverage): string {
  if (c.upToDate) return "up to date";
  return [
    c.toApply.length ? `${c.toApply.length} to apply` : "",
    c.drifted.length ? `${c.drifted.length} drifted` : "",
    c.unresolvable.length ? `${c.unresolvable.length} not in source repo` : "",
    c.removed.length ? `${c.removed.length} removed` : "",
  ].filter(Boolean).join(", ");
}

/** Shared breakdown wording for a lock hint ("N missing, M drifted, K not in source repo"). */
export { lockInstallBreakdown };

// ─────────────────────────────────────────────────────────────────────────────
// Apply
// ─────────────────────────────────────────────────────────────────────────────

/** The `skills add` source argument for a lock entry. */
export function addSourceFor(entry: LockEntry): string {
  if (entry.sourceType === "github") return entry.ref ? `${entry.source}#${entry.ref}` : entry.source;
  return entry.sourceUrl ?? entry.source;
}

export interface ApplyResult {
  /** Skills verified present on disk after the install calls. */
  added: string[];
  removed: string[];
  /** Hard failures: a `skills add`/`remove` call that exited non-zero. */
  errors: string[];
  /**
   * Skills a call was asked to install that did NOT land on disk even though
   * the call exited 0 — the CLI skips a `--skill` it can't find at the source
   * and still reports success. Each carries the best reason we could extract
   * ("not found at source", or the CLI's last line).
   */
  notInstalled: { skill: string; reason: string }[];
  /** The profile was recorded in the workspace lock's `profiles` meta (false when the workspace has no lock file yet). */
  assigned: boolean;
}

/**
 * After a `skills add` call, check which requested skills actually exist in
 * the target agent skills dir. The CLI exits 0 even when a `--skill` matches
 * nothing at the source, so the exit code alone over-reports success.
 */
function verifyLanded(skills: string[], installedDir: string, output: string | undefined, result: ApplyResult): void {
  const notFound = new Set<string>();
  const m = output?.match(/No matching skills found for:\s*([^\n]+)/i);
  if (m) for (const s of m[1].split(",").map((x) => x.trim()).filter(Boolean)) notFound.add(s);
  for (const skill of skills) {
    if (existsSync(join(installedDir, skill))) result.added.push(skill);
    else result.notInstalled.push({ skill, reason: notFound.has(skill) ? "not found at source" : "did not install" });
  }
}

/**
 * Bring a workspace up to a profile: add its missing skills (one `skills add`
 * per source) and remove skills dropped from it since it was last applied
 * here. Project workspaces install for Blackbook's enabled agents (so Claude
 * gets links too); the Global workspace installs with `-g` for the universal
 * agents and each Claude instance.
 */
/**
 * One Global-scope CLI call (`-g`, per call group), run ASYNC like the project
 * path. The plugin installer's `runSkillsCliSync` blocks the event loop, which
 * freezes Ink for the whole call: with one call per enabled tool per source,
 * each fetching from GitHub, a Global apply froze the spinner (and every key)
 * for minutes. Same cwd/env/result shape as the sync runner.
 */
async function runGlobalCli(args: string[], env: Record<string, string>): Promise<CliCallResult> {
  const r = await runSkillsCli(args, { cwd: process.env.HOME || process.cwd(), env });
  if (r.code === 0) return { ok: true, output: `${r.stderr}\n${r.stdout}` };
  return { ok: false, error: summarizeCliFailure(r) };
}

export async function applyProfileToWorkspace(
  workspace: string,
  name: string,
  profile: SkillLockFile,
  instances: ToolInstance[],
): Promise<ApplyResult> {
  // `coverage` still decides what to REMOVE (skills dropped from the profile
  // since it was applied here). What to INSTALL comes from the on-disk plan —
  // the same planInstall every install path uses — so a skill that is in the
  // workspace lock but absent (or drifted) on disk is reinstalled, where the
  // old lock-diff reported "already up to date" and did nothing.
  const wsLock = workspaceLock(workspace);
  const coverage = profileCoverage(name, profile, wsLock, profileSnapshot(workspace, name));
  const result: ApplyResult = { added: [], removed: [], errors: [], notInstalled: [], assigned: false };
  const global = isGlobalWorkspace(workspace);
  const sourceRepo = getConfigRepoPath();
  const sourceIndex = sourceRepo ? indexSourceSkills(sourceRepo) : new Map<string, string>();
  const installedDir = workspaceSkillsDir(workspace);
  const repoSource = configuredRepoSource();
  const toInstall = planApply(profile.skills, wsLock.skills, installedDir, sourceIndex, repoSource);
  // Skills the source repo no longer has can't be installed by anyone: report them up front.
  for (const skill of lockInstallGap(profile.skills, installedDir, sourceIndex, repoSource).unresolvable) {
    result.notInstalled.push({ skill, reason: "not in source repo" });
  }

  const bySource = new Map<string, string[]>();
  for (const skill of toInstall) {
    const src = addSourceFor(profile.skills[skill]);
    bySource.set(src, [...(bySource.get(src) ?? []), skill]);
  }

  for (const [source, skills] of bySource) {
    const base = ["add", source, "-y", ...skills.flatMap((s) => ["--skill", s])];
    let output: string | undefined;
    if (global) {
      let ok = true;
      for (const g of callGroups(instances)) {
        const r = await runGlobalCli([...base, "-g", ...g.agents.flatMap((a) => ["-a", a])], g.env);
        output = (output ?? "") + (r.output ?? "");
        if (!r.ok) {
          ok = false;
          result.errors.push(`${source}: ${r.error}`);
        }
      }
      if (ok) verifyLanded(skills, installedDir, output, result);
    } else {
      const r = await runSkillsCli([...base, ...projectSkillAgents().flatMap((a) => ["-a", a])], { cwd: workspace });
      if (r.code === 0) verifyLanded(skills, installedDir, `${r.stdout}\n${r.stderr}`, result);
      else result.errors.push(`${source}: ${summarizeCliFailure(r)}`);
    }
  }

  if (coverage.removed.length > 0) {
    if (global) {
      for (const g of callGroups(instances)) {
        const agentArgs = g.agents.includes("codex") ? [] : g.agents.flatMap((a) => ["-a", a]);
        const r = await runGlobalCli(["remove", ...coverage.removed, "-g", "-y", ...agentArgs], g.env);
        if (!r.ok) result.errors.push(`remove: ${r.error}`);
      }
    } else {
      const r = await runSkillsCli(["remove", ...coverage.removed, "-y"], { cwd: workspace });
      if (r.code !== 0) result.errors.push(`remove: ${summarizeCliFailure(r)}`);
    }
    if (!result.errors.some((e) => e.startsWith("remove:"))) result.removed.push(...coverage.removed);
  }

  // Applying IS assigning: the user explicitly applied this profile here, so
  // record it in the workspace lock's `profiles` meta (and the apply snapshot)
  // even when some skills failed — the status then shows exactly what's left.
  // It can only fail when the workspace has no lock file yet (nothing landed).
  recordSnapshot(workspace, name, Object.keys(profile.skills));
  result.assigned = assignProfileToWorkspace(workspace, name);
  return result;
}

/**
 * Install exactly `skillNames` from `lockSkills` into a workspace — the
 * reconcile primitive behind "Install N skills". Unlike applyProfileToWorkspace
 * (which only adds skills missing from the workspace LOCK), the caller passes
 * the on-DISK gap, so a skill that is in the lock yet absent from the agent
 * skills directory is reinstalled. Project workspaces install for the enabled
 * agents; the Global workspace installs with `-g`.
 */
export async function installLockSkills(
  workspace: string,
  lockSkills: Record<string, LockEntry>,
  skillNames: string[],
  instances: ToolInstance[],
): Promise<ApplyResult> {
  const result: ApplyResult = { added: [], removed: [], errors: [], notInstalled: [], assigned: false };
  const global = isGlobalWorkspace(workspace);
  const installedDir = workspaceSkillsDir(workspace);
  const bySource = new Map<string, string[]>();
  for (const name of skillNames) {
    const entry = lockSkills[name];
    if (!entry) { result.errors.push(`${name}: not in lock`); continue; }
    const src = addSourceFor(entry);
    bySource.set(src, [...(bySource.get(src) ?? []), name]);
  }
  for (const [source, skills] of bySource) {
    const base = ["add", source, "-y", ...skills.flatMap((s) => ["--skill", s])];
    let output: string | undefined;
    if (global) {
      let ok = true;
      for (const g of callGroups(instances)) {
        const r = await runGlobalCli([...base, "-g", ...g.agents.flatMap((a) => ["-a", a])], g.env);
        output = (output ?? "") + (r.output ?? "");
        if (!r.ok) { ok = false; result.errors.push(`${source}: ${r.error}`); }
      }
      if (ok) verifyLanded(skills, installedDir, output, result);
    } else {
      const r = await runSkillsCli([...base, ...projectSkillAgents().flatMap((a) => ["-a", a])], { cwd: workspace });
      if (r.code === 0) verifyLanded(skills, installedDir, `${r.stdout}\n${r.stderr}`, result);
      else result.errors.push(`${source}: ${summarizeCliFailure(r)}`);
    }
  }
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
