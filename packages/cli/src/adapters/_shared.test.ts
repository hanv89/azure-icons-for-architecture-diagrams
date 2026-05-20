import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  safeResolveTarget,
  baseUrl,
  fetchManifest,
  stripFrontmatter,
} from "./_shared";

// ---------------------------------------------------------------------------
// safeResolveTarget — the symlink/escape security guard (previously untested).
// ---------------------------------------------------------------------------

test("safeResolveTarget: target inside the allowed root resolves", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "sr-root-"));
  try {
    const target = path.join(root, "skills", "azure-architecture-diagram");
    const resolved = await safeResolveTarget(target, root);
    assert.equal(resolved, path.resolve(target));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("safeResolveTarget: target outside the allowed root is refused", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "sr-root-"));
  const outside = await fsp.mkdtemp(path.join(os.tmpdir(), "sr-out-"));
  try {
    await assert.rejects(
      () => safeResolveTarget(path.join(outside, "x"), root),
      /outside allowed roots/,
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(outside, { recursive: true, force: true });
  }
});

test("safeResolveTarget: a symlink inside root that points outside is refused (realpath escape)", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "sr-root-"));
  const outside = await fsp.mkdtemp(path.join(os.tmpdir(), "sr-out-"));
  try {
    const link = path.join(root, "escape");
    await fsp.symlink(outside, link); // root/escape -> /tmp/sr-out-XXXX
    await assert.rejects(
      () => safeResolveTarget(path.join(link, "skill"), root),
      /outside allowed roots/,
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(outside, { recursive: true, force: true });
  }
});

test("safeResolveTarget: AZURE_ARCH_SKILL_TARGET_ROOT widens the allow-list", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "sr-root-"));
  const widened = await fsp.mkdtemp(path.join(os.tmpdir(), "sr-wide-"));
  const prev = process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
  try {
    process.env.AZURE_ARCH_SKILL_TARGET_ROOT = widened;
    const target = path.join(widened, "skills", "x");
    const resolved = await safeResolveTarget(target, root);
    assert.equal(resolved, path.resolve(target));
  } finally {
    if (prev === undefined) delete process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
    else process.env.AZURE_ARCH_SKILL_TARGET_ROOT = prev;
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(widened, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// baseUrl — AZURE_ARCH_SKILL_BASE_URL override allow-list (previously untested).
// ---------------------------------------------------------------------------

function withBaseUrlEnv(value: string | undefined, fn: () => void): void {
  const prev = process.env.AZURE_ARCH_SKILL_BASE_URL;
  if (value === undefined) delete process.env.AZURE_ARCH_SKILL_BASE_URL;
  else process.env.AZURE_ARCH_SKILL_BASE_URL = value;
  try { fn(); }
  finally {
    if (prev === undefined) delete process.env.AZURE_ARCH_SKILL_BASE_URL;
    else process.env.AZURE_ARCH_SKILL_BASE_URL = prev;
  }
}

test("baseUrl: valid raw.githubusercontent.com override is returned (trailing slash stripped)", () => {
  withBaseUrlEnv(
    "https://raw.githubusercontent.com/hanv89/azure-icons-for-architecture-diagrams/main/",
    () => {
      assert.equal(
        baseUrl(),
        "https://raw.githubusercontent.com/hanv89/azure-icons-for-architecture-diagrams/main",
      );
    },
  );
});

test("baseUrl: non-https override is rejected", () => {
  withBaseUrlEnv("http://raw.githubusercontent.com/hanv89/azure-icons-for-architecture-diagrams/main", () => {
    assert.throws(() => baseUrl(), /must use https/);
  });
});

test("baseUrl: off-allow-list host is rejected", () => {
  withBaseUrlEnv("https://evil.example.com/hanv89/azure-icons-for-architecture-diagrams/main", () => {
    assert.throws(() => baseUrl(), /not in allow-list/);
  });
});

test("baseUrl: wrong path prefix is rejected", () => {
  withBaseUrlEnv("https://raw.githubusercontent.com/someone-else/other-repo/main", () => {
    assert.throws(() => baseUrl(), /path must start with/);
  });
});

// ---------------------------------------------------------------------------
// fetchManifest — error paths (previously only the happy path via integration).
// ---------------------------------------------------------------------------

function mockFetchBody(body: string, status = 200): { restore: () => void } {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(body, { status })) as typeof fetch;
  return { restore: () => { globalThis.fetch = real; } };
}

const BASE = "https://raw.githubusercontent.com/hanv89/azure-icons-for-architecture-diagrams/main";

test("fetchManifest: malformed JSON throws a clear error", async () => {
  const m = mockFetchBody("{ not json");
  try {
    await assert.rejects(() => fetchManifest(BASE), /is not valid JSON/);
  } finally { m.restore(); }
});

test("fetchManifest: missing required field throws", async () => {
  const m = mockFetchBody(JSON.stringify({ name: "x", version: "1.0.0" })); // no requires_icons / files
  try {
    await assert.rejects(() => fetchManifest(BASE), /missing required field|files\[\] missing/);
  } finally { m.restore(); }
});

test("fetchManifest: files[0] not SKILL.md is rejected", async () => {
  const m = mockFetchBody(JSON.stringify({
    name: "x", version: "1.0.0", requires_icons: ">=1.0.0",
    files: [{ src: "dist/skill/examples/01.puml", dest: "examples/01.puml", role: "example" }],
  }));
  try {
    await assert.rejects(() => fetchManifest(BASE), /files\[0\] must be SKILL\.md/);
  } finally { m.restore(); }
});

test("fetchManifest: valid manifest parses", async () => {
  const m = mockFetchBody(JSON.stringify({
    name: "azure-architecture-diagram", version: "1.4.2", requires_icons: ">=1.4.0",
    icons_version: "1.4.0",
    files: [{ src: "dist/skill/SKILL.md", dest: "SKILL.md", role: "skill" }],
  }));
  try {
    const parsed = await fetchManifest(BASE);
    assert.equal(parsed.name, "azure-architecture-diagram");
    assert.equal(parsed.files[0].dest, "SKILL.md");
  } finally { m.restore(); }
});

// ---------------------------------------------------------------------------
// stripFrontmatter (previously untested).
// ---------------------------------------------------------------------------

test("stripFrontmatter: removes the leading --- block", () => {
  const md = "---\nname: x\nversion: 1.0.0\n---\n# Body\ntext";
  assert.equal(stripFrontmatter(md), "# Body\ntext");
});

test("stripFrontmatter: returns body unchanged when no frontmatter", () => {
  const md = "# Body\nno frontmatter here";
  assert.equal(stripFrontmatter(md), md);
});

test("stripFrontmatter: CRLF frontmatter handled", () => {
  const md = "---\r\nname: x\r\n---\r\n# Body";
  assert.equal(stripFrontmatter(md), "# Body");
});
