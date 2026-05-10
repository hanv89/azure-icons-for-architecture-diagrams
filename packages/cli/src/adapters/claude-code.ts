import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import pkg from "../../package.json";
import { Adapter, InstallOptions, UninstallOptions, UpdateOptions, ListOptions } from "./types";

const DEFAULT_BASE_RAW_URL = "https://raw.githubusercontent.com/hanv89/azure-icons-for-architecture-diagrams/main";
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

/**
 * Resolve `target` and assert it lives inside an allowed root. Prevents an
 * accidental or malicious `--target` from writing to / removing files outside
 * the user's skills tree (e.g. `--target=$HOME` or `--target=/etc`).
 */
function safeResolveTarget(target: string): string {
  const resolved = path.resolve(target);
  const home = os.homedir();
  const explicit = process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
  const allowedRoots = [
    path.resolve(path.join(home, ".claude")),
    path.resolve(os.tmpdir()),
    explicit ? path.resolve(explicit) : null,
  ].filter((r): r is string => r !== null);
  const inside = allowedRoots.some(root => resolved === root || resolved.startsWith(root + path.sep));
  if (!inside) {
    throw new Error(`refusing to operate on ${resolved} — outside allowed roots (~/.claude, ${os.tmpdir()}${explicit ? `, $AZURE_ARCH_SKILL_TARGET_ROOT=${explicit}` : ""})`);
  }
  return resolved;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { ...(init.headers || {}), "User-Agent": USER_AGENT },
    });
  } finally {
    clearTimeout(t);
  }
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
function parseFrontmatter(md: string): Frontmatter {
  // Strip optional UTF-8 BOM (some editors emit it on save).
  const text = md.replace(/^﻿/, "");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out: Frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*?)\s*$/);
    if (!kv) continue;
    const [, key, rawValue] = kv;
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

async function withFatalReturn<T>(fn: () => Promise<T>): Promise<T | number> {
  try {
    return await fn();
  } catch (err) {
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

async function install(opts: InstallOptions): Promise<number> {
  const result = await withFatalReturn(async () => {
    const target = safeResolveTarget(opts.target ?? defaultTarget());
    const base = baseUrl();

    // Refuse to overwrite an existing skill unless the caller passed overwrite (update does).
    const existing = await fs.stat(path.join(target, "SKILL.md")).then(() => true).catch(() => false);
    if (existing && !opts.overwrite) {
      process.stderr.write(`fatal: ${target}/SKILL.md already exists. Run 'azure-arch-skill update --agent=claude-code' to refresh.\n`);
      return 1;
    }

    const skillUrl = `${base}/${BUNDLE_FILES[0].src}`;
    const skillMd = await fetchText(skillUrl);
    const fm = parseFrontmatter(skillMd);
    if (!fm.requires_icons) {
      process.stderr.write("fatal: SKILL.md missing requires_icons frontmatter\n");
      return 1;
    }
    const canaryUrl = `${base}/${CANARY_ICON_PATH}`;
    const reachable = await headOk(canaryUrl);
    if (!reachable) {
      process.stderr.write(`fatal: icon-set unreachable - HEAD ${canaryUrl} failed (skill declares requires_icons=${fm.requires_icons}; this release verifies reachability only, strict semver match planned)\n`);
      return 1;
    }

    await fs.mkdir(path.join(target, "examples"), { recursive: true });
    await fs.writeFile(path.join(target, BUNDLE_FILES[0].dest), skillMd, "utf8");
    for (const { src, dest } of BUNDLE_FILES.slice(1)) {
      const body = await fetchText(`${base}/${src}`);
      await fs.writeFile(path.join(target, dest), body, "utf8");
    }

    process.stdout.write(`installed ${SKILL_NAME} to ${target}\n`);
    return 0;
  });
  return typeof result === "number" ? result : 0;
}

async function uninstall(opts: UninstallOptions): Promise<number> {
  const result = await withFatalReturn(async () => {
    const target = safeResolveTarget(opts.target ?? defaultTarget());

    const exists = await fs.stat(target).then(() => true).catch(() => false);
    if (!exists) {
      process.stdout.write(`(nothing to uninstall at ${target})\n`);
      return 0;
    }

    const ours = await isOurSkillDir(target);
    if (!ours) {
      process.stderr.write(`fatal: refusing to remove ${target} - not an azure-architecture-diagram skill folder (no matching SKILL.md). Move/rename the directory or remove it manually if intentional.\n`);
      return 1;
    }

    await fs.rm(target, { recursive: true, force: false });
    process.stdout.write(`uninstalled ${SKILL_NAME} from ${target}\n`);
    return 0;
  });
  return typeof result === "number" ? result : 0;
}

async function update(opts: UpdateOptions): Promise<number> {
  return install({ ...opts, overwrite: true });
}

async function list(opts: ListOptions): Promise<number> {
  const result = await withFatalReturn(async () => {
    const root = safeResolveTarget(opts.target ?? defaultSkillsRoot());

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
  return typeof result === "number" ? result : 0;
}

export const claudeCodeAdapter: Adapter = { install, uninstall, update, list };
