import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, fetchWithTimeout } from "./_shared";

test("parseFrontmatter: BOM-prefixed input parses correctly", () => {
  const md = "﻿---\nname: foo\nversion: 1.2.3\nrequires_icons: \">=0.1.0\"\n---\n# body";
  const fm = parseFrontmatter(md);
  assert.equal(fm.name, "foo");
  assert.equal(fm.version, "1.2.3");
  assert.equal(fm.requires_icons, ">=0.1.0");
});

test("parseFrontmatter: requires_icons with >= prefix preserved", () => {
  const md = '---\nrequires_icons: ">=0.1.0"\n---';
  assert.equal(parseFrontmatter(md).requires_icons, ">=0.1.0");
});

test("parseFrontmatter: trailing # comment stripped from unquoted value", () => {
  const md = "---\nname: foo  # canonical name\n---";
  assert.equal(parseFrontmatter(md).name, "foo");
});

test("parseFrontmatter: # inside quoted value preserved", () => {
  const md = '---\nname: "foo # not-a-comment"\n---';
  assert.equal(parseFrontmatter(md).name, "foo # not-a-comment");
});

test("parseFrontmatter: no frontmatter returns empty object", () => {
  assert.deepEqual(parseFrontmatter("# just a markdown heading\nbody"), {});
});

test("parseFrontmatter: missing closing --- returns empty object", () => {
  assert.deepEqual(parseFrontmatter("---\nname: foo\nbody"), {});
});

test("parseFrontmatter: only known keys are extracted", () => {
  const md = "---\nname: foo\ndescription: long blob\nrandom_key: x\n---";
  const fm = parseFrontmatter(md);
  assert.equal(fm.name, "foo");
  // description + random_key are not in the typed set
  assert.equal(("description" in fm), false);
});

test("parseFrontmatter: CRLF line endings supported", () => {
  const md = "---\r\nname: foo\r\nrequires_icons: \">=0.1.0\"\r\n---\r\n";
  const fm = parseFrontmatter(md);
  assert.equal(fm.name, "foo");
  assert.equal(fm.requires_icons, ">=0.1.0");
});

// ---- fetchWithTimeout retry path (transient-5xx absorption) ----
// Mock `globalThis.fetch` per-test; restore after. Tests use the function's
// real exponential backoff (max ~1.5s wall-clock for the exhaustion case).

const realFetch = globalThis.fetch;

test("fetchWithTimeout: returns response on first attempt when upstream returns 200", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    calls.push(url.toString());
    return new Response("OK", { status: 200 });
  }) as typeof fetch;
  try {
    const res = await fetchWithTimeout("https://example.com/x");
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "OK");
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("fetchWithTimeout: retries once on 503 then succeeds on 200", async () => {
  let attempt = 0;
  globalThis.fetch = (async () => {
    attempt++;
    return new Response("", { status: attempt === 1 ? 503 : 200 });
  }) as typeof fetch;
  try {
    const res = await fetchWithTimeout("https://example.com/y", {}, 2);
    assert.equal(res.status, 200);
    assert.equal(attempt, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("fetchWithTimeout: returns the final 5xx response after exhausting retries", async () => {
  let attempt = 0;
  globalThis.fetch = (async () => {
    attempt++;
    return new Response("", { status: 503 });
  }) as typeof fetch;
  try {
    const res = await fetchWithTimeout("https://example.com/z", {}, 2);
    assert.equal(res.status, 503);
    assert.equal(attempt, 3); // initial attempt + 2 retries
  } finally {
    globalThis.fetch = realFetch;
  }
});
