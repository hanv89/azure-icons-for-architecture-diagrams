import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Adapter } from "./types";
import { ADAPTERS } from "./registry";
import { parseFrontmatter } from "./claude-code";

// ---- Adapter round-trip (install → list → uninstall) ----
// Iterates over every adapter in the shared registry. Adding a new adapter
// is a one-line entry in registry.ts plus (if the adapter writes a different
// on-disk layout than the manifest-mirror default) one EXPECTATIONS entry.

const SYNTHETIC_SKILL_MD = [
  "---",
  "name: azure-architecture-diagram",
  "description: test fixture",
  "version: 0.5.0",
  'requires_icons: ">=0.2.2"',
  "---",
  "# Test skill body",
  "",
  "This is a synthetic SKILL.md used only by the round-trip test fixture.",
].join("\n");

const SYNTHETIC_EXAMPLE = "@startuml\ntitle Test\n@enduml\n";

const SYNTHETIC_MANIFEST = {
  $schema: "./manifest.schema.json",
  name: "azure-architecture-diagram",
  version: "0.5.0",
  requires_icons: ">=0.2.2",
  files: [
    { src: "dist/skill/SKILL.md", dest: "SKILL.md", role: "skill" },
    { src: "dist/skill/examples/01-context.puml", dest: "examples/01-context.puml", role: "example" },
  ],
};

const realFetch = globalThis.fetch;

function installFetchMock(): { restore: () => void } {
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = url.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "HEAD") {
      return new Response(null, { status: 200 });
    }
    if (u.endsWith("/dist/skill/manifest.json")) {
      return new Response(JSON.stringify(SYNTHETIC_MANIFEST), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u.endsWith("/dist/skill/SKILL.md")) {
      return new Response(SYNTHETIC_SKILL_MD, { status: 200 });
    }
    if (u.endsWith("/dist/skill/examples/01-context.puml")) {
      return new Response(SYNTHETIC_EXAMPLE, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = realFetch; } };
}

function mkTmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "azure-arch-skill-test-"));
}

function rmTmpdir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Per-adapter assertion overrides for adapters whose on-disk layout differs
// from the default manifest-mirror (Claude Code + Codex install a folder
// containing SKILL.md + examples/; Cursor installs a single .mdc file).
interface Expectations {
  installedFile: (target: string) => string;     // file whose existence proves install ran
  readdirAt: (skillsRoot: string, target: string) => string;   // dir to scan for the post-install entry
  expectedTopEntries: string[];                  // expected immediate entries at readdirAt
  listTarget: (skillsRoot: string, target: string) => string;  // what to pass as `list({ target })`
  uninstallProbeMissing: (target: string) => string;           // path that should not exist post-uninstall
}

const FOLDER_INSTALL: Expectations = {
  installedFile: (t) => path.join(t, "SKILL.md"),
  readdirAt: (skillsRoot) => skillsRoot,
  expectedTopEntries: ["azure-architecture-diagram"],
  listTarget: (skillsRoot) => skillsRoot,
  uninstallProbeMissing: (t) => t,
};

const CURSOR_INSTALL: Expectations = {
  installedFile: (t) => path.join(t, "azure-arch-skill.mdc"),
  readdirAt: (_skillsRoot, target) => target,
  expectedTopEntries: ["azure-arch-skill.mdc"],
  listTarget: (_skillsRoot, target) => target,
  uninstallProbeMissing: (t) => path.join(t, "azure-arch-skill.mdc"),
};

const EXPECTATIONS: Record<string, Expectations> = {
  "claude-code": FOLDER_INSTALL,
  "codex":       FOLDER_INSTALL,
  "cursor":      CURSOR_INSTALL,
};

const ADAPTER_ENTRIES = Object.entries(ADAPTERS) as Array<[string, Adapter]>;

for (const [name, adapter] of ADAPTER_ENTRIES) {
  const exp = EXPECTATIONS[name];
  if (!exp) {
    throw new Error(`adapter '${name}' is missing an EXPECTATIONS entry in adapters-roundtrip.test.ts`);
  }

  test(`${name} round-trip: install writes SKILL.md + example into target`, async () => {
    const tmpdir = mkTmpdir();
    const target = path.join(tmpdir, "skills", "azure-architecture-diagram");
    const prevEnv = process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
    process.env.AZURE_ARCH_SKILL_TARGET_ROOT = tmpdir;
    const { restore } = installFetchMock();
    try {
      const exit = await adapter.install({ target });
      assert.equal(exit, 0);
      assert.ok(fs.existsSync(exp.installedFile(target)), `installed file present at ${exp.installedFile(target)}`);
      const written = fs.readFileSync(exp.installedFile(target), "utf8");
      assert.ok(written.startsWith("---"), "installed file preserves frontmatter");
      // Cursor renders its own frontmatter then embeds the SKILL body; the upstream
      // skill name still appears as part of the provenance marker / body text.
      assert.match(written, /azure-architecture-diagram/);
    } finally {
      restore();
      if (prevEnv === undefined) delete process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
      else process.env.AZURE_ARCH_SKILL_TARGET_ROOT = prevEnv;
      rmTmpdir(tmpdir);
    }
  });

  test(`${name} round-trip: list after install discovers the installed skill`, async () => {
    // Assert via fs + parseFrontmatter rather than capturing list()'s stdout:
    // hijacking process.stdout.write inside node:test confuses the runner's
    // buffered reporter (other tests' ✔ lines get eaten by the capture buffer).
    const tmpdir = mkTmpdir();
    const skillsRoot = path.join(tmpdir, "skills");
    const target = path.join(skillsRoot, "azure-architecture-diagram");
    const prevEnv = process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
    process.env.AZURE_ARCH_SKILL_TARGET_ROOT = tmpdir;
    const { restore } = installFetchMock();
    try {
      await adapter.install({ target });

      const skillEntries = fs.readdirSync(exp.readdirAt(skillsRoot, target), { withFileTypes: true }).map(d => d.name);
      assert.deepEqual(skillEntries, exp.expectedTopEntries, "post-install directory contains exactly the expected entries");

      const installedPath = exp.installedFile(target);
      const body = fs.readFileSync(installedPath, "utf8");
      const fm = parseFrontmatter(body);
      if (name === "cursor") {
        // Cursor adapter regenerates frontmatter (description-driven rule);
        // the upstream skill name + version live in the provenance marker.
        assert.match(body, /<!--\s*azure-architecture-diagram\s+v0\.5\.0\s+/);
      } else {
        assert.equal(fm.name, "azure-architecture-diagram");
        assert.equal(fm.version, "0.5.0");
      }

      const exit = await adapter.list({ target: exp.listTarget(skillsRoot, target) });
      assert.equal(exit, 0);
    } finally {
      restore();
      if (prevEnv === undefined) delete process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
      else process.env.AZURE_ARCH_SKILL_TARGET_ROOT = prevEnv;
      rmTmpdir(tmpdir);
    }
  });

  test(`${name} round-trip: uninstall removes the installed skill`, async () => {
    const tmpdir = mkTmpdir();
    const target = path.join(tmpdir, "skills", "azure-architecture-diagram");
    const prevEnv = process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
    process.env.AZURE_ARCH_SKILL_TARGET_ROOT = tmpdir;
    const { restore } = installFetchMock();
    try {
      await adapter.install({ target });
      assert.ok(fs.existsSync(exp.installedFile(target)), "precondition: install landed");
      const exit = await adapter.uninstall({ target });
      assert.equal(exit, 0);
      assert.equal(fs.existsSync(exp.uninstallProbeMissing(target)), false, "post-uninstall: target absent");
    } finally {
      restore();
      if (prevEnv === undefined) delete process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
      else process.env.AZURE_ARCH_SKILL_TARGET_ROOT = prevEnv;
      rmTmpdir(tmpdir);
    }
  });
}
