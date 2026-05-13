import * as fs from "node:fs/promises";
import * as path from "node:path";
import pkg from "../../package.json";

// Shared adapter plumbing. Helpers here must be agent-agnostic — anything
// Claude-Code-specific (default install path, allowed root) lives in the
// adapter file that imports from here. Codex / Cursor / future adapters
// re-use these helpers via the same import path.

export const DEFAULT_BASE_RAW_URL = "https://raw.githubusercontent.com/hanv89/azure-icons-for-architecture-diagrams/main";

// Same repo root without the ref segment; baseUrl() appends `main` (default)
// or `skill-vX.Y.Z` when --version is supplied.
const RAW_BASE_NO_REF = "https://raw.githubusercontent.com/hanv89/azure-icons-for-architecture-diagrams";

const VERSION_RE = /^\d+\.\d+\.\d+$/;

// SKILL_NAME must stay in lockstep with dist/skill/SKILL.md frontmatter `name`.
// Renaming the skill is a breaking change requiring a coordinated CLI release;
// existing installs become un-uninstallable until users upgrade the CLI
// (uninstall's allow-list refuses folders whose SKILL.md `name` differs).
export const SKILL_NAME = "azure-architecture-diagram";

// Fetched at install/update time from dist/skill/manifest.json. files[0] MUST
// be SKILL.md so the frontmatter precheck has a stable target.
export const MANIFEST_PATH = "dist/skill/manifest.json";

export const CANARY_ICON_PATH = "dist/Azure/Compute/AzureVirtualMachine.png";

export const FETCH_TIMEOUT_MS = 30_000;
export const USER_AGENT = `azure-arch-skill/${pkg.version}`;

const ALLOWED_BASE_URL_HOSTS = new Set(["raw.githubusercontent.com"]);
const ALLOWED_BASE_URL_PATH_PREFIX = "/hanv89/azure-icons-for-architecture-diagrams/";

export interface ManifestFile {
  src: string;
  dest: string;
  role: "skill" | "example";
}

export interface Manifest {
  name: string;
  version: string;
  requires_icons: string;
  files: ManifestFile[];
}

export interface Frontmatter {
  name?: string;
  version?: string;
  requires_icons?: string;
}

/**
 * Resolve the base URL for fetching the skill bundle.
 *
 * - `version` undefined → `<RAW_BASE>/main` (default, tracks the upstream main branch).
 * - `version="X.Y.Z"`   → `<RAW_BASE>/skill-vX.Y.Z` (tag-pinned fetch).
 * - `AZURE_ARCH_SKILL_BASE_URL` env set → env override wins; `version` is ignored
 *   (the env exists only for validation harnesses).
 *
 * `version` is validated against the strict X.Y.Z regex here as defense-in-depth;
 * `src/index.ts` also rejects malformed values pre-dispatch.
 */
export function baseUrl(version?: string): string {
  const override = process.env.AZURE_ARCH_SKILL_BASE_URL;
  if (override) {
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

  if (version !== undefined) {
    if (!VERSION_RE.test(version)) {
      throw new Error(`--version must match X.Y.Z (got: ${version})`);
    }
    return `${RAW_BASE_NO_REF}/skill-v${version}`;
  }

  return DEFAULT_BASE_RAW_URL;
}

let envTargetRootWarned = false;

/**
 * Resolve `target` and assert it lives inside an allowed root. Resolution
 * follows symlinks (via fs.realpath on the deepest existing ancestor) so
 * a symlink inside an allowed root that points outside cannot bypass the
 * check.
 *
 * `defaultAllowedRoot` is supplied by the adapter (e.g. `~/.claude` for the
 * Claude Code adapter, `~/.codex` for a future Codex adapter). Setting the
 * `AZURE_ARCH_SKILL_TARGET_ROOT` env var widens the allow-list to include
 * that root (intended for validation/CI use against a `mktemp -d` directory).
 * Production users should never set the env var.
 *
 * `displayName` controls how the default root appears in error messages
 * when the check fails (e.g. `~/.claude` instead of `/home/user/.claude`).
 * Defaults to the resolved absolute path.
 */
export async function safeResolveTarget(
  target: string,
  defaultAllowedRoot: string,
  displayName: string = defaultAllowedRoot,
): Promise<string> {
  const lexicallyResolved = path.resolve(target);

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

  const explicit = process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
  if (explicit && !envTargetRootWarned) {
    process.stderr.write(`warn: AZURE_ARCH_SKILL_TARGET_ROOT override active: ${explicit}\n`);
    envTargetRootWarned = true;
  }

  const allowedRoots = [
    path.resolve(defaultAllowedRoot),
    explicit ? path.resolve(explicit) : null,
  ].filter((r): r is string => r !== null);

  const inside = allowedRoots.some(root => realResolved === root || realResolved.startsWith(root + path.sep));
  if (!inside) {
    const allowList = `${displayName}${explicit ? `, $AZURE_ARCH_SKILL_TARGET_ROOT=${explicit}` : ""}`;
    throw new Error(`refusing to operate on ${realResolved} (resolved from ${target}) - outside allowed roots (${allowList})`);
  }
  return realResolved;
}

/**
 * Fetch with timeout and 2-retry exponential backoff on transient 5xx
 * responses. Used by `fetchText` and `headOk`; both inherit the retry
 * behavior. The 2-retry default was added to absorb transient 5xx upstream
 * errors — future agent adapters reusing this helper get the retry path
 * for free.
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
    } catch (e) {
      lastError = e;
      if (attempt === retries) throw e;
    } finally {
      clearTimeout(t);
    }
    await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
  }
  throw lastError ?? new Error("fetchWithTimeout: exhausted retries");
}

export async function fetchText(url: string): Promise<string> {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`fetch ${url} returned HTTP ${res.status}`);
  return res.text();
}

export async function headOk(url: string): Promise<boolean> {
  const res = await fetchWithTimeout(url, { method: "HEAD" });
  return res.ok;
}

/**
 * Fetch + parse the bundle manifest. Validates required fields and the
 * SKILL.md-at-index-0 invariant. Throws with a clear error on any issue —
 * callers should not silently fall back.
 */
export async function fetchManifest(base: string): Promise<Manifest> {
  const url = `${base}/${MANIFEST_PATH}`;
  const body = await fetchText(url);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    throw new Error(`manifest ${url} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`manifest ${url} did not parse to an object`);
  }
  const m = parsed as Partial<Manifest>;
  for (const key of ["name", "version", "requires_icons"] as const) {
    if (typeof m[key] !== "string" || !m[key]) {
      throw new Error(`manifest ${url} missing required field: ${key}`);
    }
  }
  if (!Array.isArray(m.files) || m.files.length === 0) {
    throw new Error(`manifest ${url} files[] missing or empty`);
  }
  for (const [i, f] of m.files.entries()) {
    if (!f || typeof f !== "object") {
      throw new Error(`manifest ${url} files[${i}] not an object`);
    }
    for (const key of ["src", "dest", "role"] as const) {
      if (typeof (f as Partial<ManifestFile>)[key] !== "string") {
        throw new Error(`manifest ${url} files[${i}].${key} missing`);
      }
    }
  }
  if (m.files[0].dest !== "SKILL.md" || m.files[0].role !== "skill") {
    throw new Error(`manifest ${url} files[0] must be SKILL.md (role=skill); got dest=${m.files[0].dest} role=${m.files[0].role}`);
  }
  return m as Manifest;
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
  const text = md.replace(/^﻿/, "");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out: Frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*?)\s*$/);
    if (!kv) continue;
    const [, key] = kv;
    let rawValue = kv[2];
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
 * Strip the leading `---\n...\n---\n` YAML frontmatter block from a markdown
 * string. Returns the body unchanged if no frontmatter is detected.
 *
 * Used by adapters that re-render the upstream SKILL.md for a different host
 * (e.g. Cursor's `.mdc` rule files, which carry their own frontmatter shape
 * and embed the SKILL.md body without its original frontmatter).
 */
export function stripFrontmatter(md: string): string {
  const text = md.replace(/^﻿/, "");
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? text.slice(match[0].length) : text;
}

/**
 * Test whether an icons-tag semver satisfies the SKILL.md's `requires_icons`
 * constraint. Hand-rolled to keep the runtime dep tree minimal (commander +
 * nothing else; pulling in `semver` would add transitive deps for a feature
 * that today only needs `>=X.Y.Z` matching).
 *
 * Supported constraint forms:
 *   - "X.Y.Z"     (exact match)
 *   - ">=X.Y.Z"   (tag >= constraint)
 *   - "^X.Y.Z"    (same major, tag >= constraint — npm caret semantics)
 *   - "~X.Y.Z"    (same major.minor, tag.patch >= constraint.patch)
 *
 * Throws on any other input. The project's SKILL.md frontmatter only ships
 * `>=X.Y.Z` today; the other 3 forms exist for future-proofing.
 *
 * Numeric encoding `maj * 1e6 + min * 1e3 + pat` rules out individual segments
 * >= 1000, which is fine for icons semver in the foreseeable future.
 */
export function satisfiesRequiresIcons(constraint: string, iconsSemver: string): boolean {
  const tagParts = iconsSemver.split(".").map(Number);
  if (tagParts.length !== 3 || tagParts.some(n => isNaN(n))) {
    throw new Error(`icons semver malformed: ${iconsSemver}`);
  }
  const [tagMaj, tagMin, tagPat] = tagParts;

  const trimmed = constraint.trim().replace(/^["']|["']$/g, "");
  const m = trimmed.match(/^(>=|\^|~|)(\d+)\.(\d+)\.(\d+)$/);
  if (!m) {
    throw new Error(`requires_icons constraint form not supported: ${constraint}`);
  }
  const [, op, majS, minS, patS] = m;
  const maj = Number(majS);
  const min = Number(minS);
  const pat = Number(patS);
  const tag = tagMaj * 1e6 + tagMin * 1e3 + tagPat;
  const ref = maj * 1e6 + min * 1e3 + pat;

  if (op === "")    return tag === ref;
  if (op === ">=")  return tag >= ref;
  if (op === "^")   return tagMaj === maj && tag >= ref;
  if (op === "~")   return tagMaj === maj && tagMin === min && tagPat >= pat;
  throw new Error(`unreachable constraint op: ${op}`);
}

/**
 * Verify the icon set the skill bundle references is reachable AND its
 * semver satisfies SKILL.md's requires_icons.
 *
 * - Always: HEAD the canary icon URL (`CANARY_ICON_PATH` at the current base).
 *   Unreachable → throw with the URL in the message.
 * - If `requestedVersion` is provided: additionally infer the icons-tag from
 *   `manifest.requires_icons`'s lower bound and assert it satisfies the
 *   constraint via `satisfiesRequiresIcons`. The inference is intentionally
 *   simple: `requires_icons` lower bound IS the icons-tag the skill was
 *   built against. Future work: record an exact `icons_version` field in
 *   `manifest.json` and read it here directly.
 */
export async function verifyIconsAvailability(
  base: string,
  manifest: Manifest,
  requestedVersion: string | undefined,
): Promise<void> {
  const requires = manifest.requires_icons;

  const canaryUrl = `${base}/${CANARY_ICON_PATH}`;
  const reachable = await headOk(canaryUrl);
  if (!reachable) {
    throw new Error(`icon-set unreachable - HEAD ${canaryUrl} failed (skill declares requires_icons=${requires}; this release verifies reachability only, strict semver match planned)`);
  }

  if (!requestedVersion) {
    return;
  }

  const lowerMatch = requires.match(/(\d+\.\d+\.\d+)/);
  if (!lowerMatch) {
    throw new Error(`SKILL.md requires_icons has no parseable lower bound: ${requires}`);
  }
  const iconsTagSemver = lowerMatch[1];
  if (!satisfiesRequiresIcons(requires, iconsTagSemver)) {
    throw new Error(`requires_icons constraint ${requires} not satisfied by inferred icons tag ${iconsTagSemver}`);
  }
}

export async function withFatalReturn(fn: () => Promise<number>): Promise<number> {
  try {
    return await fn();
  } catch (err) {
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
