/**
 * Reads Cloudflare bindings out of a project's deploy configuration.
 *
 * Split out from the audit so it can be tested without touching the network --
 * every rule here exists because a real config produced a wrong answer.
 */

/**
 * Binding name -> pattern matched against a wrangler config.
 *
 * Bindings are not inherited by wrangler environments, so a project deployed
 * with `--env production` declares every one of them under
 * `[env.production.<name>]`. The underscore-named keys match by substring and
 * survive that; the table-header forms (`[ai]`, `[[queues.producers]]`,
 * `[triggers]`) are anchored, so each allows a dotted prefix.
 */
export const BINDINGS = [
  ["D1", /d1_databases/i],
  ["R2", /r2_buckets/i],
  ["KV", /kv_namespaces/i],
  ["Durable Objects", /durable_objects/i],
  ["Queues", /"?queues"?\s*[:=]|\[\[?(?:[\w-]+\.)*queues[\].]/i],
  ["Workers AI", /"?ai"?\s*[:=]\s*[{[]|\[(?:[\w-]+\.)*ai\]/i],
  ["AI Gateway", /ai_gateway/i],
  ["Vectorize", /vectorize/i],
  ["Workflows", /"?workflows"?\s*[:=]|\[\[(?:[\w-]+\.)*workflows/i],
  ["Email", /send_email/i],
  ["Analytics Engine", /analytics_engine/i],
  ["Browser Rendering", /"?browser"?\s*[:=]\s*\{|browser_rendering|\[(?:[\w-]+\.)*browser\]/i],
  ["Hyperdrive", /hyperdrive/i],
  ["Images", /"?images"?\s*[:=]\s*\{|\[(?:[\w-]+\.)*images\]/i],
  ["Pipelines", /pipelines/i],
  ["Containers", /"?containers"?\s*[:=]|\[\[(?:[\w-]+\.)*containers/i],
  ["Cron", /"?crons"?\s*[:=]|\[(?:[\w-]+\.)*triggers\]/i],
];

/**
 * Alchemy (https://alchemy.run) declares Cloudflare infrastructure in TypeScript
 * instead of a wrangler config. A project using it has no wrangler.toml at all,
 * so checking only for wrangler files rejects it as undeployable -- which is
 * wrong, and quietly loses some of the largest projects in this space.
 */
export const ALCHEMY_BINDINGS = [
  ["D1", /\bD1Database\s*\(/],
  ["R2", /\bR2Bucket\s*\(/],
  ["KV", /\bKVNamespace\s*\(/],
  ["Durable Objects", /\bDurableObjectNamespace\s*\(/],
  ["Queues", /\bQueue\s*\(/],
  ["Workers AI", /\bAi\s*\(/],
  ["AI Gateway", /\bAiGateway\s*\(/],
  ["Vectorize", /\bVectorizeIndex\s*\(/],
  ["Workflows", /\bWorkflow\s*\(/],
  ["Email", /\bEmail(Address|Routing)?\s*\(/],
  ["Analytics Engine", /\bAnalyticsEngineDataset\s*\(/],
  ["Browser Rendering", /\bBrowser(Rendering)?\s*\(/],
  ["Hyperdrive", /\bHyperdrive\s*\(/],
  ["Images", /\bImages\s*\(/],
  ["Pipelines", /\bPipeline\s*\(/],
  ["Containers", /\bContainer\s*\(/],
  ["Cron", /crons\s*:/],
];

export const ALCHEMY_RE = /(^|\/)alchemy\.run\.(ts|js|mjs)$/;

export const WRANGLER_RE = new RegExp(
  [
    String.raw`(^|/)wrangler\.(toml|json|jsonc)(\.example|\.ci|\.template)?$`,
    String.raw`(^|/)wrangler\.[\w-]+\.(toml|json|jsonc)$`,
    String.raw`(^|/)wrangler\.(toml|json|jsonc)\.(example|template)$`,
  ].join("|"),
);

/**
 * Configs under these directories describe something other than this project's
 * own deployment -- a scaffold it emits, a test fixture, a superseded setup --
 * and crediting their bindings to the project overstates what it actually uses.
 */
const NON_DEPLOY_PATH =
  /(^|\/)(old|legacy|deprecated|examples?|fixtures?|templates?|__tests__|tests?|e2e)\//i;

/**
 * Comment runs carrying one of these links are wrangler's own `init` scaffold,
 * which ships every binding commented out whether or not the project uses it.
 */
const SCAFFOLD_LINK =
  /developers\.cloudflare\.com\/workers\/(wrangler\/configuration|configuration|observability|runtime-apis)/i;

/**
 * Split each line into [code, comment], honouring string literals.
 *
 * Written as a scanner rather than a regex because comment markers appear
 * inside perfectly ordinary config values: `/fonts/*` and `"/api/*"` both
 * contain the block-comment opener, and a regex rule treats them as one and
 * eats the rest of the file -- which silently erased the bindings of every
 * project whose config held a path glob.
 */
export function splitComments(text, jsonc) {
  const lines = [];
  let inBlock = false;

  for (const line of text.split("\n")) {
    let code = "";
    let comment = "";
    let i = 0;
    let inStr = false;
    let quote = "";
    let esc = false;

    while (i < line.length) {
      const ch = line[i];
      const nxt = line[i + 1] ?? "";

      if (inBlock) {
        comment += ch;
        if (jsonc && ch === "*" && nxt === "/") {
          comment += nxt;
          i += 2;
          inBlock = false;
          continue;
        }
        i += 1;
        continue;
      }
      if (inStr) {
        code += ch;
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === quote) inStr = false;
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inStr = true;
        quote = ch;
        code += ch;
        i += 1;
        continue;
      }
      if (jsonc && ch === "/" && nxt === "/") {
        comment += line.slice(i);
        break;
      }
      if (jsonc && ch === "/" && nxt === "*") {
        inBlock = true;
        comment += line.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (!jsonc && ch === "#") {
        comment += line.slice(i);
        break;
      }
      code += ch;
      i += 1;
    }
    lines.push([code, comment]);
  }
  return lines;
}

/**
 * Return `text` with scaffold boilerplate removed, comments otherwise kept.
 *
 * Two things look alike in a wrangler config and mean opposite things:
 *
 * - A binding committed commented-out because its id has to be filled in
 *   locally (`# [[d1_databases]]  # uncomment and add your database_id`).
 *   That IS a binding the project uses.
 * - The block `wrangler init` scaffolds, listing every binding Cloudflare
 *   offers, each behind a docs URL. Those are NOT bindings the project uses.
 *
 * So comments cannot simply be dropped -- that loses the first kind, and
 * understated punctual and CloudFlare-ImgBed down to nothing. Instead, split
 * into runs of consecutive comment lines and discard only the runs advertising
 * a wrangler docs link.
 *
 * Comment syntax is per-format: TOML has `#` and no block comments at all.
 */
export function usableConfig(text, filePath) {
  const jsonc = /\.jsonc?$/.test(filePath) || filePath.includes(".json");
  const lines = splitComments(text, jsonc);

  const out = [];
  let run = [];
  const flush = () => {
    // Keep a comment run unless it is wrangler's scaffold advertisement.
    if (run.length && !run.some((c) => SCAFFOLD_LINK.test(c))) out.push(...run);
    run = [];
  };

  for (const [code, comment] of lines) {
    if (comment && !code.trim()) {
      run.push(comment);
    } else {
      flush();
      out.push(code + (comment ? ` ${comment}` : ""));
    }
  }
  flush();
  return out.join("\n");
}

/** Bindings declared by one config file, dispatching on its format. */
export function bindingsInFile(text, filePath) {
  const found = new Set();
  if (ALCHEMY_RE.test(filePath)) {
    // TypeScript: comments here are prose about the deploy, not disabled
    // bindings, and the resource constructors are unambiguous.
    for (const [name, pattern] of ALCHEMY_BINDINGS) {
      if (pattern.test(text)) found.add(name);
    }
  } else {
    const blob = usableConfig(text, filePath);
    for (const [name, pattern] of BINDINGS) {
      if (pattern.test(blob)) found.add(name);
    }
  }
  return BINDINGS.filter(([name]) => found.has(name)).map(([name]) => name);
}

/** Deploy configurations in a repo, whichever tool declares them. */
export function deployConfigs(paths) {
  const found = paths.filter((p) => WRANGLER_RE.test(p) || ALCHEMY_RE.test(p));
  const live = found.filter((p) => !NON_DEPLOY_PATH.test(p));
  // Prefer configs outside those directories. But some projects ship their real
  // deploy as exactly that -- kukuroo's only config is
  // `templates/standalone/wrangler.jsonc`, which is what you deploy -- so fall
  // back rather than calling the project undeployable.
  return live.length ? live : found;
}

const LICENSE_TABLE = [
  ["gnu affero", "AGPL-3.0"],
  ["gnu lesser", "LGPL-3.0"],
  ["gnu general public license", "GPL-3.0"],
  ["apache license", "Apache-2.0"],
  ["mit license", "MIT"],
  ["permission is hereby granted, free of charge", "MIT"],
  ["mozilla public license", "MPL-2.0"],
  ["isc license", "ISC"],
  // BSD says "All rights reserved." in its own text, so it has to be matched
  // before the proprietary fallback or it reads as custom terms.
  ["bsd 3-clause", "BSD-3-Clause"],
  ["bsd 2-clause", "BSD-2-Clause"],
  ["redistribution and use in source and binary forms", "BSD-3-Clause"],
  ["creative commons legal code", "CC0-1.0"],
  ["cc0 1.0 universal", "CC0-1.0"],
  ["this is free and unencumbered software released into the public domain", "Unlicense"],
  ["eclipse public license", "EPL-2.0"],
  ["boost software license", "BSL-1.0"],
  ["zlib license", "Zlib"],
  ["the artistic license", "Artistic-2.0"],
  ["business source license", "BUSL-1.1"],
  ["functional source license", "FSL-1.1"],
  ["polyform", "PolyForm"],
  ["server side public license", "SSPL"],
  ["elastic license", "Elastic-2.0"],
  ["commons clause", "Commons-Clause"],
];

/**
 * Source-available licenses: published code, but with conditions an open-source
 * license would not impose. Nothing is rejected for being on this list -- the
 * entry is marked so a reader knows to check the terms before relying on it.
 *
 * Most of these restrict competing commercially with the licensor and permit
 * self-hosting for your own use, which is what this list is about. PolyForm
 * Noncommercial is the sharp one: it bars commercial use outright, so a company
 * running it internally is outside the grant.
 */
export const SOURCE_AVAILABLE_LICENSES = new Set([
  "BUSL-1.1", "FSL-1.1", "FSL-1.1-ALv2", "FSL-1.1-MIT",
  "PolyForm", "PolyForm-Noncommercial-1.0.0", "PolyForm-Shield-1.0.0",
  "Elastic-2.0", "SSPL-1.0", "Commons-Clause",
  // Custom terms, recognised by their wording rather than an SPDX id.
  "Source-Available", "Proprietary",
]);

/**
 * Open-source licenses common enough to accept without comment. This is a
 * convenience for keeping the audit quiet, NOT the definition of acceptable --
 * OSI approves around 120 licenses and no list here will be complete. Anything
 * absent is reported for a human to judge, never rejected.
 */
export const RECOGNISED_LICENSES = new Set([
  "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "ISC",
  "MPL-2.0", "GPL-2.0", "GPL-3.0", "LGPL-2.1", "LGPL-3.0", "AGPL-3.0",
  "Unlicense", "CC0-1.0", "Zlib", "EUPL-1.2", "EPL-2.0", "Artistic-2.0",
  "BSL-1.0", "PostgreSQL", "Python-2.0", "CC-BY-4.0", "CC-BY-SA-4.0",
  "WTFPL", "MIT-0", "BSD-4-Clause", "NCSA", "OSL-3.0", "AFL-3.0",
]);

/**
 * What a license means for a reader. Nothing here rejects an entry; the list
 * reports the terms and lets you decide whether they suit you.
 *
 *   "none"              no license file -- marked, since the default is
 *                       all-rights-reserved
 *   "source-available"  published under conditions -- marked, check the terms
 *   "open"              recognised open source
 *   "unrecognised"      something else -- shown as-is
 */
export function licenseStatus(spdx) {
  if (spdx === null || spdx === undefined) return "none";
  if (SOURCE_AVAILABLE_LICENSES.has(spdx)) return "source-available";
  if (RECOGNISED_LICENSES.has(spdx)) return "open";
  return "unrecognised";
}

/** Best-effort SPDX id from a license file's text. */
export function classifyLicense(body) {
  if (!body || !body.trim()) return null;
  const full = body.split(/\s+/).join(" ").toLowerCase();
  // Commons Clause is an addendum bolted onto an otherwise open license, so it
  // can appear well past the header and still govern what you may do.
  if (full.includes("commons clause")) return "Commons-Clause";
  const head = full.slice(0, 400);
  for (const [needle, spdx] of LICENSE_TABLE) {
    if (head.includes(needle)) return spdx;
  }
  // Only after the known licenses: several of them ("All rights reserved."
  // appears verbatim in BSD) would otherwise be misread as custom terms.
  if (full.includes("source-available") || full.includes("source available")) {
    return "Source-Available";
  }
  if (full.includes("all rights reserved")) return "Proprietary";
  return "UNKNOWN";
}
