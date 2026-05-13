import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { Adapter, InstallOptions, UninstallOptions, UpdateOptions, ListOptions } from "./types";
import {
  SKILL_NAME,
  baseUrl,
  fetchManifest,
  fetchText,
  fetchWithTimeout,
  parseFrontmatter,
  safeResolveTarget,
  verifyIconsAvailability,
  withFatalReturn,
} from "./_shared";

// Codex CLI discovers user-installed skills at $CODEX_HOME/skills/<name>/SKILL.md,
// defaulting to ~/.codex/skills/ when CODEX_HOME is unset. Verified against the
// Codex Rust binary's bundled prompt strings (`strings codex | grep skills`).
// See https://github.com/openai/codex.

export { fetchWithTimeout, parseFrontmatter };

function codexRootDir(): string {
  const explicit = process.env.CODEX_HOME;
  if (explicit) return path.resolve(explicit);
  return path.join(os.homedir(), ".codex");
}

function defaultTarget(): string {
  return path.join(codexRootDir(), "skills", SKILL_NAME);
}

function defaultSkillsRoot(): string {
  return path.join(codexRootDir(), "skills");
}

function codexRootDisplay(): string {
  return process.env.CODEX_HOME ? `$CODEX_HOME=${process.env.CODEX_HOME}` : "~/.codex";
}

async function resolveTarget(target: string): Promise<string> {
  return safeResolveTarget(target, codexRootDir(), codexRootDisplay());
}

async function isOurSkillDir(dir: string): Promise<boolean> {
  try {
    const skillMd = await fs.readFile(path.join(dir, "SKILL.md"), "utf8");
    const fm = parseFrontmatter(skillMd);
    return fm.name === SKILL_NAME;
  } catch {
    return false;
  }
}

async function install(opts: InstallOptions): Promise<number> {
  return withFatalReturn(async () => {
    const target = await resolveTarget(opts.target ?? defaultTarget());
    const base = baseUrl(opts.version);

    if (!process.env.AZURE_ARCH_SKILL_TARGET_ROOT && path.basename(target) !== SKILL_NAME) {
      throw new Error(`refusing to install at ${target} - target basename must be '${SKILL_NAME}' (default ${codexRootDisplay()}/skills/${SKILL_NAME}/). Set AZURE_ARCH_SKILL_TARGET_ROOT to install into a custom test root.`);
    }

    const manifest = await fetchManifest(base);
    if (manifest.name !== SKILL_NAME) {
      throw new Error(`manifest name mismatch: expected '${SKILL_NAME}', got '${manifest.name}'. CLI and bundle are out of sync.`);
    }

    const presence = await Promise.all(
      manifest.files.map(async ({ dest }) => ({
        dest,
        exists: await fs.stat(path.join(target, dest)).then(() => true).catch(() => false),
      })),
    );
    const someExist = presence.some(p => p.exists);
    const allExist = presence.every(p => p.exists);
    if (someExist && !opts.overwrite) {
      throw new Error(allExist
        ? `${target} already contains an install. Run 'azure-arch-skill update --agent=codex' to refresh.`
        : `${target} contains a partial install (${presence.filter(p => !p.exists).map(p => p.dest).join(", ")} missing). Run 'azure-arch-skill update --agent=codex' to repair.`);
    }

    const skillUrl = `${base}/${manifest.files[0].src}`;
    const skillMd = await fetchText(skillUrl);
    const fm = parseFrontmatter(skillMd);
    if (!fm.requires_icons) {
      throw new Error("SKILL.md missing requires_icons frontmatter");
    }
    await verifyIconsAvailability(base, manifest, opts.version);

    for (const { dest } of manifest.files) {
      await fs.mkdir(path.dirname(path.join(target, dest)), { recursive: true });
    }
    await fs.writeFile(path.join(target, manifest.files[0].dest), skillMd, "utf8");
    for (const { src, dest } of manifest.files.slice(1)) {
      const body = await fetchText(`${base}/${src}`);
      await fs.writeFile(path.join(target, dest), body, "utf8");
    }

    process.stdout.write(`installed ${SKILL_NAME} to ${target}\n`);
    return 0;
  });
}

async function uninstall(opts: UninstallOptions): Promise<number> {
  return withFatalReturn(async () => {
    const target = await resolveTarget(opts.target ?? defaultTarget());

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
    const root = await resolveTarget(opts.target ?? defaultSkillsRoot());

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

export const codexAdapter: Adapter = { install, uninstall, update, list };
