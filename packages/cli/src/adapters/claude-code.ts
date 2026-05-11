import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import pkg from "../../package.json";
import { Adapter, InstallOptions, UninstallOptions, UpdateOptions, ListOptions } from "./types";

const DEFAULT_BASE_RAW_URL = "https://raw.githubusercontent.com/hanv89/azure-icons-for-architecture-diagrams/main";

// SKILL_NAME must stay in lockstep with dist/skill/SKILL.md frontmatter `name`.
// Renaming the skill is a breaking change requiring a coordinated CLI release;
// existing installs become un-uninstallable until users upgrade the CLI
// (uninstall's allow-list refuses folders whose SKILL.md `name` differs).
const SKILL_NAME = "azure-architecture-diagram";

interface BundleFile { src: string; dest: string; }
const BUNDLE_FILES: BundleFile[] = [
  { src: "dist/skill/SKILL.md",                 dest: "SKILL.md" },
  { src: "dist/skill/examples/01-context.puml", dest: "examples/01-context.puml" },
];

const CANARY_ICON_PATH = "dist/Azure/Compute/AzureVirtualMachine.png";

const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT = `azure-arch-skill/${pkg.version}`;

const ALLOWED_BASE_URL_HOSTS = new Set(["raw.githubusercontent.com"]);
const ALLOWED_BASE_URL_PATH_PREFIX = "/hanv89/azure-icons-for-architecture-diagrams/";

function baseUrl(): string {
  const override = process.env.AZURE_ARCH_SKILL_BASE_URL;
  if (!override) return DEFAULT_BASE_RAW_URL;
  let u: URL;
  try {
    u = new URL(override);
  } catch {
    throw new Error(`AZURE_ARCH_SKILL_BASE_URL is not a valid URL: ${override}`);
  }
  if (u.protocol !== "https:") {
    throw new Error(`AZURE_ARCH_SKILL_BASE_URL must use https; got ${u.protocol}`);
  }
  if (!ALLOWED_BASE_URL_HOSTS.has(u.hostname)) {
    throw new Error(`AZURE_ARCH_SKILL_BASE_URL host '${u.hostname}' not in allow-list (${[...ALLOWED_BASE_URL_HOSTS].join(", ")})`);
  }
  if (!u.pathname.startsWith(ALLOWED_BASE_URL_PATH_PREFIX)) {
    throw new Error(`AZURE_ARCH_SKILL_BASE_URL path must start with ${ALLOWED_BASE_URL_PATH_PREFIX}`);
  }
  process.stderr.write(`warn: AZURE_ARCH_SKILL_BASE_URL override active: ${override}\n`);
  return override.replace(/\/$/, "");
}

function defaultTarget(): string {
  return path.join(os.homedir(), ".claude", "skills", SKILL_NAME);
}

function defaultSkillsRoot(): string {
  return path.join(os.homedir(), ".claude", "skills");
}

let envTargetRootWarned = false;

/**
 * Resolve `target` and assert it lives inside an allowed root. Resolution
 * follows symlinks (via fs.realpath on the deepest existing ancestor) so
 * a symlink inside an allowed root that points outside cannot bypass the
 * check.
 *
 * The default allow-list is `~/.claude/` only. Setting the
 * `AZURE_ARCH_SKILL_TARGET_ROOT` env var widens it to include that root
 * (intended for validation/CI use against a `mktemp -d` directory).
 * Production users should never set the env var.
 */
async function safeResolveTarget(target: string): Promise<string> {
  const lexicallyResolved = path.resolve(target);

  // Walk up to the deepest existing ancestor and realpath it — install creates
  // a not-yet-existing target so we can't realpath the leaf directly.
  let probe = lexicallyResolved;
  let realProbe: string | null = null;
  while (true) {
    try {
      realProbe = await fs.realpath(probe);
      break;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw err;
      const parent = path.dirname(probe);
      if (parent === probe) {
        throw new Error(`unable to resolve target ${target}`);
      }
      probe = parent;
    }
  }
  const tail = lexicallyResolved.slice(probe.length);
  const realResolved = path.resolve(realProbe + tail);

  const home = os.homedir();
  const explicit = process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
  if (explicit && !envTargetRootWarned) {
    process.stderr.write(`warn: AZURE_ARCH_SKILL_TARGET_ROOT override active: ${explicit}\n`);
    envTargetRootWarned = true;
  }

  const allowedRoots = [
    path.resolve(path.join(home, ".claude")),
    explicit ? path.resolve(explicit) : null,
  ].filter((r): r is string => r !== null);

  const inside = allowedRoots.some(root => realResolved === root || realResolved.startsWith(root + path.sep));
  if (!inside) {
    const allowList = `~/.claude${explicit ? `, $AZURE_ARCH_SKILL_TARGET_ROOT=${explicit}` : ""}`;
    throw new Error(`refusing to operate on ${realResolved} (resolved from ${target}) - outside allowed roots (${allowList})`);
  }
  return realResolved;
}

/**
 * Fetch with timeout and 2-retry exponential backoff on transient 5xx
 * responses. Used by `fetchText` and `headOk`; both inherit the retry
 * behavior. Default `retries = 2` matches the R30 fix (Phase 1.0) —
 * future agent adapters reusing this helper get the retry path for free.
 *
 * Backoff schedule: 500ms after attempt 0, 1s after attempt 1, 2s after
 * attempt 2. Network errors (AbortError, DNS failures) re-throw only
 * after the final attempt.
 *
 * @internal — exported only so unit tests can mock `globalThis.fetch`
 *             around it. Not part of the public adapter API.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  retries = 2,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: { ...(init.headers || {}), "User-Agent": USER_AGENT },
      });
      if (res.status < 500 || attempt === retries) {
        return res;
      }
      // 5xx with retries remaining: fall through to backoff.
    } catch (e) {
      lastError = e;
      if (attempt === retries) throw e;
    } finally {
      clearTimeout(t);
    }
    // Exponential backoff: 500ms, 1s, 2s.
    await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
  }
  // Unreachable: the loop body always returns or throws on the final attempt.
  throw lastError ?? new Error("fetchWithTimeout: exhausted retries");
}

async function fetchText(url: string): Promise<string> {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`fetch ${url} returned HTTP ${res.status}`);
  return res.text();
}

async function headOk(url: string): Promise<boolean> {
  const res = await fetchWithTimeout(url, { method: "HEAD" });
  return res.ok;
}

interface Frontmatter {
  name?: string;
  version?: string;
  requires_icons?: string;
}

/**
 * Minimal YAML frontmatter parser — supports only single-line scalar `key: value`
 * pairs with optional `"` or `'` quoting. Multi-line scalars (`|`, `>`), nested
 * mappings, lists, comments after `#`, and YAML null/booleans are NOT handled
 * and may silently mis-parse.
 *
 * Intentional: SKILL.md frontmatter currently has 4 single-line scalar keys
 * (name, description, version, requires_icons). Swap in `js-yaml` when the
 * format grows beyond that.
 */
export function parseFrontmatter(md: string): Frontmatter {
  // Strip optional UTF-8 BOM (some editors emit it on save).
  const text = md.replace(/^﻿/, "");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out: Frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*?)\s*$/);
    if (!kv) continue;
    const [, key] = kv;
    let rawValue = kv[2];
    // Strip trailing ` # comment` from unquoted scalars.
    if (!rawValue.startsWith('"') && !rawValue.startsWith("'")) {
      rawValue = rawValue.replace(/\s+#.*$/, "");
    }
    const value = rawValue.replace(/^["']|["']$/g, "");
    if (key === "name" || key === "version" || key === "requires_icons") {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Returns true iff `dir` contains a SKILL.md whose frontmatter `name` field
 * matches our skill. Used by uninstall to refuse deleting paths that aren't
 * our skill folder.
 */
async function isOurSkillDir(dir: string): Promise<boolean> {
  try {
    const skillMd = await fs.readFile(path.join(dir, "SKILL.md"), "utf8");
    const fm = parseFrontmatter(skillMd);
    return fm.name === SKILL_NAME;
  } catch {
    return false;
  }
}

async function withFatalReturn(fn: () => Promise<number>): Promise<number> {
  try {
    return await fn();
  } catch (err) {
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

async function install(opts: InstallOptions): Promise<number> {
  return withFatalReturn(async () => {
    const target = await safeResolveTarget(opts.target ?? defaultTarget());
    const base = baseUrl();

    // Strict install path: target must end with the canonical skill folder name
    // unless the caller has opted into a wider AZURE_ARCH_SKILL_TARGET_ROOT.
    if (!process.env.AZURE_ARCH_SKILL_TARGET_ROOT && path.basename(target) !== SKILL_NAME) {
      throw new Error(`refusing to install at ${target} - target basename must be '${SKILL_NAME}' (default ~/.claude/skills/${SKILL_NAME}/). Set AZURE_ARCH_SKILL_TARGET_ROOT to install into a custom test root.`);
    }

    // Detect partial vs complete prior installs across BUNDLE_FILES.
    const presence = await Promise.all(
      BUNDLE_FILES.map(async ({ dest }) => ({
        dest,
        exists: await fs.stat(path.join(target, dest)).then(() => true).catch(() => false),
      })),
    );
    const someExist = presence.some(p => p.exists);
    const allExist = presence.every(p => p.exists);
    if (someExist && !opts.overwrite) {
      throw new Error(allExist
        ? `${target} already contains an install. Run 'azure-arch-skill update --agent=claude-code' to refresh.`
        : `${target} contains a partial install (${presence.filter(p => !p.exists).map(p => p.dest).join(", ")} missing). Run 'azure-arch-skill update --agent=claude-code' to repair.`);
    }

    const skillUrl = `${base}/${BUNDLE_FILES[0].src}`;
    const skillMd = await fetchText(skillUrl);
    const fm = parseFrontmatter(skillMd);
    if (!fm.requires_icons) {
      throw new Error("SKILL.md missing requires_icons frontmatter");
    }
    const canaryUrl = `${base}/${CANARY_ICON_PATH}`;
    const reachable = await headOk(canaryUrl);
    if (!reachable) {
      throw new Error(`icon-set unreachable - HEAD ${canaryUrl} failed (skill declares requires_icons=${fm.requires_icons}; this release verifies reachability only, strict semver match planned)`);
    }

    // Mkdir the parent of every bundle dest so future deeper-nested entries work.
    for (const { dest } of BUNDLE_FILES) {
      await fs.mkdir(path.dirname(path.join(target, dest)), { recursive: true });
    }
    await fs.writeFile(path.join(target, BUNDLE_FILES[0].dest), skillMd, "utf8");
    for (const { src, dest } of BUNDLE_FILES.slice(1)) {
      const body = await fetchText(`${base}/${src}`);
      await fs.writeFile(path.join(target, dest), body, "utf8");
    }

    process.stdout.write(`installed ${SKILL_NAME} to ${target}\n`);
    return 0;
  });
}

async function uninstall(opts: UninstallOptions): Promise<number> {
  return withFatalReturn(async () => {
    const target = await safeResolveTarget(opts.target ?? defaultTarget());

    const exists = await fs.stat(target).then(() => true).catch(() => false);
    if (!exists) {
      process.stdout.write(`(nothing to uninstall at ${target})\n`);
      return 0;
    }

    const ours = await isOurSkillDir(target);
    if (!ours) {
      throw new Error(`refusing to remove ${target} - not an azure-architecture-diagram skill folder (no matching SKILL.md). Move/rename the directory or remove it manually if intentional.`);
    }

    try {
      await fs.rm(target, { recursive: true, force: false });
    } catch (err) {
      const stillExists = await fs.stat(target).then(() => true).catch(() => false);
      if (stillExists) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`uninstall partially failed at ${target}: ${msg}; manual cleanup may be required`);
      }
      throw err;
    }
    process.stdout.write(`uninstalled ${SKILL_NAME} from ${target}\n`);
    return 0;
  });
}

async function update(opts: UpdateOptions): Promise<number> {
  return install({ ...opts, overwrite: true });
}

async function list(opts: ListOptions): Promise<number> {
  return withFatalReturn(async () => {
    const root = await safeResolveTarget(opts.target ?? defaultSkillsRoot());

    const exists = await fs.stat(root).then(() => true).catch(() => false);
    if (!exists) {
      process.stdout.write("(no skills installed)\n");
      return 0;
    }
    const entries = await fs.readdir(root, { withFileTypes: true });
    const rows: string[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const skillMdPath = path.join(root, e.name, "SKILL.md");
      try {
        const md = await fs.readFile(skillMdPath, "utf8");
        const fm = parseFrontmatter(md);
        rows.push(`${fm.name ?? e.name}\t${fm.version ?? "?"}`);
      } catch {
        // not a skill folder; skip silently
      }
    }
    process.stdout.write(rows.length ? rows.join("\n") + "\n" : "(no skills installed)\n");
    return 0;
  });
}

export const claudeCodeAdapter: Adapter = { install, uninstall, update, list };
