/**
 * Tests for the deploy-config parser.
 *
 * Every case here is a real config shape that produced a wrong answer at some
 * point. Run with: node --test scripts/
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  bindingsInFile,
  classifyLicense,
  deployConfigs,
  licenseStatus,
} from "./config-parser.js";

// A prose comment containing a path glob must not open a block comment and
// swallow the bindings below it. This erased punctual's entire config.
test("toml: /* in a comment is not a block comment", () => {
  const cfg = `
name = "punctual"
# Requests under /fonts/* are the only ones this intercepts; everything
# else still falls through to the Worker below.
[[d1_databases]]
binding = "DB"
[[kv_namespaces]]
binding = "CACHE"
`;
  assert.deepEqual(bindingsInFile(cfg, "wrangler.toml"), ["D1", "KV"]);
});

// Same hazard in JSONC, via a route glob in a string value. This erased OmniMail.
test("jsonc: /* inside a string is not a block comment", () => {
  const cfg = `
{
  "assets": { "run_worker_first": ["/api", "/api/*"] },
  "d1_databases": [{ "binding": "DB" }],
  "r2_buckets": [{ "binding": "MAIL" }]
}
`;
  assert.deepEqual(bindingsInFile(cfg, "wrangler.jsonc"), ["D1", "R2"]);
});

// wrangler's scaffold ships every binding commented out behind a docs link.
// Counting those credited cloudflare-drop with Vectorize and Hyperdrive.
test("scaffold boilerplate does not count as a binding", () => {
  const cfg = `
name = "app"
[triggers]
crons = ["*/10 * * * *"]

# Bind the Workers AI model catalog.
# Docs: https://developers.cloudflare.com/workers/wrangler/configuration/#workers-ai
# [ai]
# binding = "AI"

# Docs: https://developers.cloudflare.com/workers/wrangler/configuration/#vectorize-indexes
# [[vectorize]]
# binding = "VEC"
`;
  assert.deepEqual(bindingsInFile(cfg, "wrangler.toml"), ["Cron"]);
});

// A binding commented out because the id must be filled in locally is still a
// real binding. Dropping all comments understated CloudFlare-ImgBed to nothing.
test("project-authored commented binding still counts", () => {
  const cfg = `
name = "imgbed"
# Uncomment and fill in your own database_id before deploying:
# [[d1_databases]]
# binding = "DB"
# database_id = "your-id-here"
`;
  assert.deepEqual(bindingsInFile(cfg, "wrangler.toml"), ["D1"]);
});

test("jsonc: genuine block comment is ignored", () => {
  const cfg = `
{
  /* https://developers.cloudflare.com/workers/wrangler/configuration/
     "vectorize": [{ "binding": "VEC" }] */
  "kv_namespaces": [{ "binding": "CACHE" }]
}
`;
  assert.deepEqual(bindingsInFile(cfg, "wrangler.jsonc"), ["KV"]);
});

// An apostrophe inside a TOML comment must not start a string and swallow
// the following lines.
test("toml: apostrophe in prose does not open a string", () => {
  const cfg = `
name = "app"
# Cloudflare's edge serves this; don't route it through the Worker.
[[r2_buckets]]
binding = "FILES"
`;
  assert.deepEqual(bindingsInFile(cfg, "wrangler.toml"), ["R2"]);
});

// Alchemy declares the same infrastructure in TypeScript. Missing this rejected
// OpenSEO -- an 18.7k-star Ahrefs alternative -- as undeployable.
// TOML declares queues as table arrays and images as a plain table -- neither
// puts a `=` after the name, so the JSON-shaped patterns saw nothing. codeseer
// (KV + Queues) audited as KV only.
test("toml: queues and images table headers count as bindings", () => {
  const toml = `
name = "app"

[[kv_namespaces]]
binding = "STATE"
id = "abc"

[[queues.producers]]
binding = "JOBS"
queue = "jobs"

[[queues.consumers]]
queue = "jobs"
max_batch_size = 1

[images]
binding = "IMAGES"
`;
  assert.deepEqual(bindingsInFile(toml, "wrangler.toml"), ["KV", "Queues", "Images"]);
  assert.deepEqual(
    bindingsInFile(`{"queues":{"producers":[{"binding":"JOBS","queue":"jobs"}]},"images":{"binding":"IMAGES"}}`, "wrangler.json"),
    ["Queues", "Images"],
  );
});

test("alchemy: bindings come from resource constructors", () => {
  const program = `
import * as Cloudflare from "alchemy/cloudflare";
const db = await D1Database("app-db", { migrationsDir: "drizzle" });
const files = await R2Bucket("uploads");
const rooms = DurableObjectNamespace("rooms", { className: "Room" });
export const worker = await Worker("api", { bindings: { db, files, rooms } });
`;
  assert.deepEqual(bindingsInFile(program, "alchemy.run.ts"), [
    "D1",
    "R2",
    "Durable Objects",
  ]);
});

test("deployConfigs: finds both wrangler and alchemy", () => {
  const paths = ["src/index.ts", "alchemy.run.ts", "web/wrangler.jsonc", "README.md"];
  assert.deepEqual(deployConfigs(paths), ["alchemy.run.ts", "web/wrangler.jsonc"]);
});

test("deployConfigs: prefers a real deploy over fixtures and templates", () => {
  const paths = ["fixtures/demo/wrangler.toml", "wrangler.toml", "old/wrangler.jsonc"];
  assert.deepEqual(deployConfigs(paths), ["wrangler.toml"]);
});

// kukuroo's only config is templates/standalone/wrangler.jsonc, and that is
// what you deploy. Filtering it out would call the project undeployable.
test("deployConfigs: falls back when a template is the only config", () => {
  const paths = ["templates/standalone/wrangler.jsonc", "src/index.ts"];
  assert.deepEqual(deployConfigs(paths), ["templates/standalone/wrangler.jsonc"]);
});

test("classifyLicense: reads the file, including source-available ones", () => {
  assert.equal(classifyLicense("MIT License\n\nCopyright (c) 2026"), "MIT");
  assert.equal(classifyLicense("GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3"), "AGPL-3.0");
  assert.equal(classifyLicense("Business Source License 1.1\nParameters"), "BUSL-1.1");
  assert.equal(classifyLicense(""), null);
});

// Nothing is rejected on licensing. These are marked so a reader checks the
// terms -- most permit self-hosting for your own use and only restrict
// competing commercially, which is not what this list is for.
test("licenseStatus: source-available licenses are marked, not rejected", () => {
  for (const l of [
    "BUSL-1.1", "FSL-1.1-ALv2", "PolyForm-Noncommercial-1.0.0",
    "Elastic-2.0", "SSPL-1.0", "Commons-Clause", "Source-Available", "Proprietary",
  ]) {
    assert.equal(licenseStatus(l), "source-available", `${l} should be source-available`);
  }
});

test("licenseStatus: open source beyond the common few is recognised", () => {
  // The old fixed allowlist held 16 licenses; OSI approves roughly 120. These
  // are all legitimate and were being auto-rejected.
  for (const l of ["EPL-2.0", "Artistic-2.0", "BSL-1.0", "PostgreSQL", "Python-2.0", "NCSA", "OSL-3.0"]) {
    assert.equal(licenseStatus(l), "open", `${l} should be open`);
  }
});

test("licenseStatus: anything unfamiliar asks a human rather than refusing", () => {
  assert.equal(licenseStatus("Frobnicate-1.0"), "unrecognised");
  assert.equal(licenseStatus("UNKNOWN"), "unrecognised");
  assert.equal(licenseStatus(null), "none");
});

test("Commons Clause is caught even when bolted onto an open license", () => {
  // It is an addendum, so the file opens as Apache and restricts further down.
  const text = `Apache License Version 2.0, January 2004
    ${"filler ".repeat(120)}
    "Commons Clause" License Condition v1.0
    The Software is provided to you by the Licensor under the License, subject to
    the following condition: without limiting other conditions, the License does
    not grant you the right to Sell the Software.`;
  assert.equal(classifyLicense(text), "Commons-Clause");
  assert.equal(licenseStatus(classifyLicense(text)), "source-available");
});

// "All rights reserved." appears verbatim in BSD's own text, so the proprietary
// fallback has to run after the known licenses or BSD reads as custom terms.
test("classifyLicense: BSD is not mistaken for proprietary", () => {
  const bsd = `BSD 3-Clause License

Copyright (c) 2026, the authors. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:`;
  assert.equal(classifyLicense(bsd), "BSD-3-Clause");
  assert.equal(licenseStatus(classifyLicense(bsd)), "open");
});

test("classifyLicense: custom terms are caught by their wording", () => {
  assert.equal(
    classifyLicense("ResolveHQ Source-Available License\nCopyright (c) 2026. All rights reserved."),
    "Source-Available",
  );
  assert.equal(classifyLicense("Acme Inc. Proprietary. All rights reserved."), "Proprietary");
  assert.equal(classifyLicense("This is free and unencumbered software released into the public domain."), "Unlicense");
});
