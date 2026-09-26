// BLACKBOOK PATCH tests: central store keying + store-backed installs.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getDevShortcut, getStoreKey, getStoreRoot, isInStore, urlStoreKey } from './store.ts';
import { parseSource } from './source-parser.ts';
import {
  getCanonicalPath,
  getCanonicalSkillsDir,
  installBlobSkillForAgent,
  installSkillForAgent,
  installWellKnownSkillForAgent,
} from './installer.ts';

describe('getStoreKey', () => {
  it('keys every GitHub input form to the same namespace', () => {
    const inputs = [
      'ssweens/playbook',
      'SSweens/Playbook',
      'https://github.com/ssweens/playbook',
      'https://github.com/ssweens/playbook.git',
      'https://github.com/ssweens/playbook/tree/main/skills/blast-radius',
      'ssweens/playbook#some-branch',
      'ssweens/playbook@blast-radius',
    ];
    for (const input of inputs) {
      expect(getStoreKey(parseSource(input)), input).toBe('github.com/ssweens/playbook');
    }
  });

  it('keys GitLab (including subgroups and self-hosted) by host + path', () => {
    expect(getStoreKey(parseSource('https://gitlab.com/Group/Sub/Repo'))).toBe('gitlab.com/group/sub/repo');
    expect(getStoreKey(parseSource('gitlab:group/repo'))).toBe('gitlab.com/group/repo');
  });

  it('keys generic git by host (+port) + path, dropping user, scheme, and .git', () => {
    expect(getStoreKey(parseSource('git@git.example.com:team/skills.git'))).toBe('git.example.com/team/skills');
    expect(getStoreKey({ type: 'git', url: 'ssh://git@git.example.com:2222/team/skills.git' })).toBe(
      'git.example.com/2222/team/skills'
    );
    expect(getStoreKey({ type: 'git', url: 'https://user:tok@git.example.com/Team/Skills.git' })).toBe(
      'git.example.com/Team/Skills'
    );
  });

  it('keys local sources by absolute path', () => {
    expect(getStoreKey(parseSource('/Users/me/src/playbook'))).toBe('local/Users/me/src/playbook');
    expect(getStoreKey({ type: 'local', url: '/a/b', localPath: '/x/y' })).toBe('local/x/y');
  });

  it('keys well-known endpoints and direct downloads by URL without query/fragment', () => {
    expect(getStoreKey({ type: 'well-known', url: 'https://Docs.Example.com/guide/?ref=1#x' })).toBe(
      'docs.example.com/guide'
    );
    expect(getStoreKey({ type: 'download', url: 'https://cdn.example.com/skills/pdf.zip?sig=abc' })).toBe(
      'cdn.example.com/skills/pdf.zip'
    );
  });

  it('keys node_modules skills by package, including scopes', () => {
    expect(getStoreKey({ type: 'node_modules', packageName: '@acme/skills' })).toBe('node_modules/@acme/skills');
  });

  it('never produces traversal segments', () => {
    expect(urlStoreKey('https://example.com/a/../../etc')).not.toContain('..');
    expect(getStoreKey({ type: 'node_modules', packageName: '../../x' })).toBe('node_modules/_/_/x');
  });
});

describe('store-backed installs', () => {
  let root: string;
  let project: string;
  let skillSrc: string;
  const prevStore = process.env.SKILLS_STORE_DIR;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bb-skills-store-'));
    project = join(root, 'project');
    skillSrc = join(root, 'src', 'skills', 'demo');
    mkdirSync(join(project, '.claude'), { recursive: true });
    mkdirSync(skillSrc, { recursive: true });
    writeFileSync(join(skillSrc, 'SKILL.md'), '---\nname: demo\ndescription: d\n---\n# demo\n');
    process.env.SKILLS_STORE_DIR = join(root, 'store');
  });

  afterEach(() => {
    if (prevStore === undefined) delete process.env.SKILLS_STORE_DIR;
    else process.env.SKILLS_STORE_DIR = prevStore;
    rmSync(root, { recursive: true, force: true });
  });

  const skill = () => ({ name: 'demo', description: 'd', path: skillSrc }) as never;
  const storeKey = 'github.com/acme/skills';

  it('writes the real files to the store and symlinks universal + agent dirs to it', async () => {
    const universal = await installSkillForAgent(skill(), 'codex', { cwd: project, storeKey });
    const claude = await installSkillForAgent(skill(), 'claude-code', { cwd: project, storeKey });
    expect(universal.success && claude.success).toBe(true);

    const storeDir = join(getStoreRoot(), storeKey, 'demo');
    expect(universal.canonicalPath).toBe(storeDir);
    expect(readFileSync(join(storeDir, 'SKILL.md'), 'utf-8')).toContain('# demo');

    for (const link of [join(project, '.agents/skills/demo'), join(project, '.claude/skills/demo')]) {
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readlinkSync(link)).toBe(storeDir); // absolute into the store
    }
    expect(isInStore(storeDir)).toBe(true);
  });

  it('refuses a project symlink install without a store key', async () => {
    const r = await installSkillForAgent(skill(), 'codex', { cwd: project });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no store key/);
    expect(existsSync(join(project, '.agents'))).toBe(false);
  });

  it('covers blob and well-known installers too', async () => {
    const files = [{ path: 'SKILL.md', contents: '---\nname: blob\ndescription: b\n---\n' }];
    const blob = await installBlobSkillForAgent({ installName: 'blob', files }, 'codex', {
      cwd: project,
      storeKey: 'github.com/acme/blob',
    });
    expect(blob.success).toBe(true);
    expect(readlinkSync(join(project, '.agents/skills/blob'))).toBe(join(getStoreRoot(), 'github.com/acme/blob/blob'));

    const wk = await installWellKnownSkillForAgent(
      {
        name: 'wk',
        description: 'w',
        content: '---\nname: wk\ndescription: w\n---\n',
        installName: 'wk',
        sourceUrl: 'https://docs.example.com/.well-known/skills/wk/SKILL.md',
        providerId: 'well-known',
        sourceIdentifier: 'docs.example.com',
        files: new Map([['SKILL.md', '---\nname: wk\ndescription: w\n---\n']]),
        indexEntry: { name: 'wk', description: 'w', files: ['SKILL.md'] },
      } as never,
      'codex',
      { cwd: project, storeKey: 'docs.example.com' }
    );
    expect(wk.success).toBe(true);
    expect(readlinkSync(join(project, '.agents/skills/wk'))).toBe(join(getStoreRoot(), 'docs.example.com/wk'));
  });

  // Only universal agents here: non-universal agents' global dirs (e.g. Claude's)
  // are resolved from HOME at module load, so they can't be isolated in-process.
  // The subprocess test in tui/src/lib/skills-cli.integration.test.ts covers them.
  it('global installs live in the store and ~/.agents/skills/<name> links to it', async () => {
    const home = join(root, 'home');
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      // A pre-existing real copy (what upstream `-g` leaves) is replaced by the link.
      mkdirSync(join(home, '.agents/skills/demo'), { recursive: true });
      writeFileSync(join(home, '.agents/skills/demo/SKILL.md'), '# old copy\n');

      const r = await installSkillForAgent(skill(), 'codex', { global: true, storeKey });
      expect(r.success).toBe(true);
      const storeDir = join(getStoreRoot(), storeKey, 'demo');
      expect(readlinkSync(join(home, '.agents/skills/demo'))).toBe(storeDir);
      expect(readFileSync(join(home, '.agents/skills/demo/SKILL.md'), 'utf-8')).toContain('# demo');

      // Without a key, the global canonical dir is still ~/.agents/skills (what list/remove scan).
      expect(getCanonicalSkillsDir(true, project)).toBe(join(home, '.agents/skills'));
      expect((await installSkillForAgent(skill(), 'codex', { global: true })).success).toBe(false);
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
    }
  });

  it('explicit --copy stays on the upstream copy path', async () => {
    const copied = await installSkillForAgent(skill(), 'codex', { cwd: project, mode: 'copy' });
    expect(copied.success).toBe(true);
    expect(lstatSync(join(project, '.agents/skills/demo')).isSymbolicLink()).toBe(false);
  });

  it('getCanonicalPath without a key still points at the project link (what list/remove scan)', () => {
    expect(getCanonicalPath('demo', { cwd: project })).toBe(join(project, '.agents/skills/demo'));
    expect(getCanonicalPath('demo', { cwd: project, storeKey })).toBe(join(getStoreRoot(), storeKey, 'demo'));
  });
});

describe('dev shortcuts', () => {
  let root: string;
  const prev = { store: process.env.SKILLS_STORE_DIR, dev: process.env.SKILLS_DEV_SHORTCUTS };
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bb-skills-dev-'));
    process.env.SKILLS_STORE_DIR = join(root, 'store');
  });
  afterEach(() => {
    for (const [k, v] of [['SKILLS_STORE_DIR', prev.store], ['SKILLS_DEV_SHORTCUTS', prev.dev]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  it('matches exact repos in any spelling and ignores missing checkouts', () => {
    const checkout = join(root, 'playbook');
    mkdirSync(checkout);
    for (const key of ['ssweens/playbook', 'github.com/ssweens/playbook', 'https://github.com/SSweens/Playbook.git', 'git@github.com:ssweens/playbook.git']) {
      process.env.SKILLS_DEV_SHORTCUTS = JSON.stringify({ [key]: checkout });
      expect(getDevShortcut('github.com/ssweens/playbook'), key).toBe(checkout);
      expect(getDevShortcut('github.com/ssweens/other'), key).toBeNull();
    }
    process.env.SKILLS_DEV_SHORTCUTS = JSON.stringify({ 'ssweens/playbook': join(root, 'missing') });
    expect(getDevShortcut('github.com/ssweens/playbook')).toBeNull();
    process.env.SKILLS_DEV_SHORTCUTS = 'not json';
    expect(getDevShortcut('github.com/ssweens/playbook')).toBeNull();
    delete process.env.SKILLS_DEV_SHORTCUTS;
    expect(getDevShortcut('github.com/ssweens/playbook')).toBeNull();
  });

  it('devLink makes the store entry a live link into the checkout; a normal install turns it back into a copy', async () => {
    const skillDir = join(root, 'playbook', 'skills', 'demo');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: demo\ndescription: d\n---\n# v1\n');
    const project = join(root, 'project');
    mkdirSync(project);
    const skill = { name: 'demo', description: 'd', path: skillDir } as never;
    const storeKey = 'github.com/ssweens/playbook';
    const storeDir = join(getStoreRoot(), storeKey, 'demo');

    const r = await installSkillForAgent(skill, 'codex', { cwd: project, storeKey, devLink: true });
    expect(r.success).toBe(true);
    expect(lstatSync(storeDir).isSymbolicLink()).toBe(true);
    expect(readlinkSync(storeDir)).toBe(skillDir);
    expect(readlinkSync(join(project, '.agents/skills/demo'))).toBe(storeDir);
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: demo\ndescription: d\n---\n# v2 live\n');
    expect(readFileSync(join(project, '.agents/skills/demo/SKILL.md'), 'utf-8')).toContain('v2 live');

    // Dropping the shortcut and reinstalling replaces the link with a real copy, leaving the checkout alone.
    await installSkillForAgent(skill, 'codex', { cwd: project, storeKey });
    expect(lstatSync(storeDir).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(storeDir, 'SKILL.md'), 'utf-8')).toContain('v2 live');
    expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true);
  });
});
