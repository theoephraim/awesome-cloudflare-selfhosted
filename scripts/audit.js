#!/usr/bin/env node
/**
 * Audit every entry in data/entries/ against its GitHub repository.
 *
 * Checks the claims this list makes: that each project's license is what the
 * entry says, that it ships a Cloudflare deploy configuration, and that it is
 * still alive. The bindings reported here are the source of truth for the
 * `·`-separated list on each README line.
 *
 *   node scripts/audit.js            # audit every entry
 *   node scripts/audit.js --stale    # only entries inactive 12+ months
 *   node scripts/audit.js --json     # machine-readable output
 *
 * Requires `gh` (https://cli.github.com) authenticated, for API quota.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { ROOT, loadEntries } from "./data.js";
import {
  ALCHEMY_RE,
  WRANGLER_RE,
  bindingsInFile,
  classifyLicense,
  deployConfigs,
  licenseStatus,
} from "./config-parser.js";

const CACHE_PATH = path.join(ROOT, ".audit-cache.json");
export const STALE_DAYS = 365;


/** Projects that deploy into your own account without committing a config,
 *  because their own installer or CLI generates one. Each needs a reason and a
 *  pointer to the code that does the generating -- not a blanket waiver. */
export const DEPLOY_EXCEPTIONS = {
  "openRin/Rin": "rin-cli generates wrangler.json at deploy time (cli/src/lib/wrangler.ts)",
};

const LICENSE_FILE_RE = /^(LICENSE|LICENCE|COPYING)(\.\w+)?$/i;

const cache = fs.existsSync(CACHE_PATH)
  ? JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"))
  : {};

function saveCache() {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
}

function gh(apiPath) {
  if (apiPath in cache) return cache[apiPath];
  let value = null;
  try {
    const out = execFileSync("gh", ["api", apiPath], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    value = JSON.parse(out);
  } catch {
    value = null;
  }
  cache[apiPath] = value;
  return value;
}

async function raw(repo, branch, filePath) {
  const key = `RAW:${repo}:${branch}:${filePath}`;
  if (key in cache) return cache[key];
  let text = "";
  try {
    const res = await fetch(
      `https://raw.githubusercontent.com/${repo}/${branch}/${filePath}`,
      { signal: AbortSignal.timeout(20_000) },
    );
    if (res.ok) text = await res.text();
  } catch {
    text = "";
  }
  cache[key] = text.slice(0, 120_000);
  return cache[key];
}

/**
 * Everything the list needs to know about a repository, read from the
 * repository itself. No opinion about whether it belongs -- that is applied by
 * auditEntry (for a listed entry) or propose-entry.js (for a submission).
 */
export async function inspectRepo(repo) {
  const meta = gh(`repos/${repo}`);
  if (!meta) return null;

  const branch = meta.default_branch ?? "main";
  const tree = gh(`repos/${repo}/git/trees/${branch}?recursive=1`);
  const paths = (tree?.tree ?? []).filter((n) => n.type === "blob").map((n) => n.path);

  // License: read the file rather than trusting GitHub's classifier.
  let license = meta.license?.spdx_id ?? null;
  if (license === null || license === "NOASSERTION") {
    const licFiles = paths.filter((p) => LICENSE_FILE_RE.test(p));
    const body = licFiles.length ? (await raw(repo, branch, licFiles[0])).slice(0, 4000) : "";
    license = classifyLicense(body);
  }

  const configs = deployConfigs(paths);
  const found = new Set();
  for (const p of configs.slice(0, 8)) {
    for (const b of bindingsInFile(await raw(repo, branch, p), p)) found.add(b);
  }

  // A "Deploy to Cloudflare" button is the strongest form of what this list is
  // about: into your own account without touching a terminal. Read from the
  // README because that is where projects put it, and it often points at a
  // separate template repo rather than the project itself.
  const readmePath = paths.find((p) => /^readme(\.md)?$/i.test(p));
  const readme = readmePath ? await raw(repo, branch, readmePath) : "";
  const deploy =
    readme.match(/https:\/\/deploy\.workers\.cloudflare\.com\/\?url=[^\s)"'\]]+/)?.[0] ?? null;

  const pushed = meta.pushed_at.slice(0, 10);
  return {
    repo,
    branch,
    description: meta.description ?? "",
    stars: meta.stargazers_count,
    pushed,
    archived: meta.archived,
    release: gh(`repos/${repo}/releases/latest`)?.tag_name ?? null,
    license,
    licenseStatus: licenseStatus(license),
    configs,
    deploy,
    bindings: [...found],
    daysSincePush: Math.floor((Date.now() - Date.parse(pushed)) / 86_400_000),
    deployException: DEPLOY_EXCEPTIONS[repo] ?? null,
    saveCache,
  };
}

async function auditEntry(entry) {
  const { name, repo, license: declaredLicense, bindings: declaredBindings } = entry;
  const result = { name, repo, problems: [], notes: [] };

  const info = await inspectRepo(repo);
  if (!info) {
    result.problems.push("repository not found or renamed");
    return result;
  }

  result.stars = info.stars;
  result.pushed = info.pushed;
  result.archived = info.archived;
  result.release = info.release;
  const spdx = info.license;
  result.license = spdx;

  switch (info.licenseStatus) {
    case "none":
      // Listed but marked. The README renders these as "no license"; the entry
      // file must leave `license:` empty so the two agree.
      if (declaredLicense) {
        result.problems.push("entry declares a license but the repo has no license file");
      } else {
        result.notes.push("no license file -- listed with a warning marker");
      }
      break;
    case "source-available":
      result.notes.push(`source-available license ${spdx} -- listed with a marker`);
      break;
    case "unrecognised":
      result.notes.push(`unrecognised license ${spdx} -- worth a human check`);
      break;
  }
  if (spdx !== null && declaredLicense && declaredLicense !== spdx) {
    result.problems.push(`entry says ${declaredLicense}, repo says ${spdx}`);
  }

  // Deploy configuration and the bindings it declares.
  const configs = info.configs;
  result.configs = configs.slice(0, 6);
  const found = new Set(info.bindings);
  result.bindings = info.bindings;

  if (!configs.length) {
    if (repo in DEPLOY_EXCEPTIONS) {
      result.notes.push(`deploy exception: ${DEPLOY_EXCEPTIONS[repo]}`);
    } else {
      result.problems.push("no deploy config found (wrangler or alchemy)");
    }
  } else {
    const missing = (declaredBindings ?? []).filter((b) => !found.has(b));
    if (missing.length) {
      result.problems.push(`entry claims bindings not in config: ${missing.join(", ")}`);
    }
  }

  if (info.archived) result.problems.push("repository is archived");

  result.daysSincePush = info.daysSincePush;
  if (info.daysSincePush > STALE_DAYS) {
    result.problems.push(`no commits in ${info.daysSincePush} days`);
  }

  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const wantJson = args.includes("--json");
  const staleOnly = args.includes("--stale");

  const all = loadEntries();
  let results = [];

  for (const [i, entry] of all.entries()) {
    if (!wantJson) {
      process.stderr.write(`\r  auditing ${i + 1}/${all.length} ${entry.repo.padEnd(50)}`);
    }
    results.push(await auditEntry(entry));
    saveCache();
  }
  if (!wantJson) process.stderr.write(`\r${" ".repeat(70)}\r`);

  if (staleOnly) results = results.filter((r) => (r.daysSincePush ?? 0) > STALE_DAYS);

  if (wantJson) {
    console.log(JSON.stringify(results, null, 1));
    return 0;
  }

  const flagged = results.filter((r) => r.problems.length);
  const noted = results.filter((r) => r.notes.length && !r.problems.length);

  for (const r of flagged) {
    console.log(`${r.name} (${r.repo})`);
    for (const p of r.problems) console.log(`    - ${p}`);
  }
  for (const r of noted) {
    console.log(`${r.name} (${r.repo})`);
    for (const n of r.notes) console.log(`    · ${n}`);
  }
  console.log();
  console.log(
    `${results.length} entries audited, ${flagged.length} flagged, ${noted.length} noted`,
  );
  return flagged.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
