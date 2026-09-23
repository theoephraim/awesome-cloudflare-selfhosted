#!/usr/bin/env node
/**
 * Build an entry from a submission issue, or explain why it doesn't qualify.
 *
 *   ISSUE_BODY="..." ISSUE_NUMBER=12 node scripts/propose-entry.js
 *
 * Writes `data/entries/<slug>.md` on success; the workflow runs `npm run build`
 * afterwards to regenerate README.md. Always writes a markdown verdict to
 * `proposal-comment.md` for the workflow to post back, and a machine-readable
 * summary to stdout as JSON.
 *
 * Exit codes: 0 accepted (a PR should open), 1 rejected (comment and stop).
 *
 * The rules applied here are the ones in CONTRIBUTING.md that a machine can
 * decide -- license, deploy config, staleness, duplicates. Whether a project is
 * really a SaaS replacement and not a framework is a human call, left to review.
 */

import fs from "node:fs";
import path from "node:path";

import { ENTRIES_DIR, POPULAR_THRESHOLD, loadCategories, loadEntries } from "./data.js";
import { STALE_DAYS, inspectRepo } from "./audit.js";
import {
  FIELDS,
  parseIssueBody,
  renderEntry,
  validateSubmission,
} from "./issue-entry.js";

const COMMENT_PATH = "proposal-comment.md";

// Links in a bot comment. Relative paths do resolve on an issue page, but only
// by accident of the URL shape; an absolute base built from the Actions
// environment is what actually survives. Falls back to relative when run
// locally, where there is no repository to point at.
const BASE = process.env.GITHUB_REPOSITORY
  ? `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY}/blob/main`
  : "../blob/main";

function comment(lines) {
  fs.writeFileSync(COMMENT_PATH, `${lines.join("\n")}\n`);
}

function reject(reasons, extra = []) {
  comment([
    "Thanks for the submission. It doesn't qualify yet:",
    "",
    ...reasons.map((r) => `- ${r}`),
    ...(extra.length ? ["", ...extra] : []),
    "",
    "Fix the underlying issue and edit this issue — the checks run again on every edit.",
    `The criteria are in [CONTRIBUTING.md](${BASE}/CONTRIBUTING.md).`,
  ]);
  console.log(JSON.stringify({ ok: false, reasons }, null, 1));
  process.exit(1);
}

async function main() {
  // Stage one reports on the submission and stops; stage two runs after a
  // maintainer approves and its output becomes the pull request.
  const checkOnly = process.argv.includes("--check-only");
  const body = process.env.ISSUE_BODY ?? "";
  const categories = loadCategories();

  const fields = parseIssueBody(body);
  const submission = validateSubmission(fields, categories);
  if (!submission.ok) reject(submission.errors);

  const { repo, name, nameFromRepo, category, summary, slug } = submission.entry;

  // Already listed?
  const existing = loadEntries(categories).find(
    (e) => e.repo.toLowerCase() === repo.toLowerCase(),
  );
  if (existing) {
    reject([
      `\`${repo}\` is already listed as [\`${existing.slug}\`](${BASE}/data/entries/${existing.slug}.md).`,
    ]);
  }
  if (fs.existsSync(path.join(ENTRIES_DIR, `${slug}.md`))) {
    reject([
      `\`data/entries/${slug}.md\` already exists for a different repository. ` +
        "Two projects share a name — pick a distinct id and say so in the issue.",
    ]);
  }

  const info = await inspectRepo(repo);
  if (!info) reject([`\`${repo}\` could not be read. Is it public, and spelled right?`]);

  const reasons = [];

  if (info.archived) reasons.push("The repository is archived.");

  if (info.daysSincePush > STALE_DAYS) {
    reasons.push(
      `No commits in ${info.daysSincePush} days. Entries need activity within ${STALE_DAYS} days.`,
    );
  }

  if (!info.configs.length && !info.deployException) {
    reasons.push(
      "No Cloudflare deploy configuration found — no `wrangler.toml`/`.json`/`.jsonc` " +
        "(a committed `.example` counts) and no `alchemy.run.ts`. If this project deploys " +
        "to Cloudflare some other way, say how and it can be added as a documented exception.",
    );
  }

  // Nothing is rejected on licensing. The terms are reported and marked; whether
  // they suit a given reader is that reader's call, not this list's.
  const unlicensed = info.licenseStatus === "none";

  if (reasons.length) reject(reasons);

  // A check reports; only the approved stage writes. Keeping stage one
  // side-effect free means it can be re-run at any time, locally included,
  // without leaving an entry behind that makes the next run report a duplicate.
  const entryFile = renderEntry({
    name,
    repo,
    category: category.slug,
    summary,
    license: info.license,
    bindings: info.bindings,
    // Set at creation from the stars already fetched, so a popular submission
    // is highlighted the moment it lands rather than at the next refresh.
    popular: info.stars >= POPULAR_THRESHOLD,
    deploy: Boolean(info.deploy),
    licenseNote: unlicensed
      ? "No LICENSE file in the repository, so it is technically all-rights-reserved " +
        "until the maintainer adds one"
      : null,
  });

  if (!checkOnly) {
    fs.mkdirSync(ENTRIES_DIR, { recursive: true });
    fs.writeFileSync(path.join(ENTRIES_DIR, `${slug}.md`), entryFile);
  }

  const notes = [];
  if (unlicensed) {
    notes.push(
      "⚠️ This repository has **no license file**, so it will be listed with a " +
        "`⚠ no license` marker. Adding a `LICENSE` is a one-commit fix for the maintainer.",
    );
  }
  if (info.licenseStatus === "source-available") {
    notes.push(
      `⚠️ \`${info.license}\` is source-available rather than open source. That is not a ` +
        "reason to exclude it — these licenses generally permit self-hosting for your own " +
        "use — but the entry will carry a marker so readers check the terms.",
    );
  }
  if (info.licenseStatus === "unrecognised") {
    notes.push(
      `❓ \`${info.license}\` isn't a license this list sees often. Worth a glance to ` +
        "confirm it says what you would expect.",
    );
  }
  if (info.deployException) notes.push(`Deploy exception applies: ${info.deployException}.`);
  if (nameFromRepo && checkOnly) {
    notes.push(
      `No name was given, so the entry is called \`${name}\` after the repository. ` +
        "If the project calls itself something else, edit the issue and fill in **Name**.",
    );
  }
  if (!info.bindings.length) {
    notes.push(
      "No bindings were detected. That is fine for a stateless Worker, but if this project " +
        "does use D1/R2/KV, the parser has a bug worth reporting.",
    );
  }

  comment([
    checkOnly
      ? `Checks passed for [\`${repo}\`](https://github.com/${repo}). Waiting on a maintainer.`
      : `Approved. Opening a pull request for [\`${repo}\`](https://github.com/${repo}).`,
    "",
    `| | |`,
    `| --- | --- |`,
    `| Entry | \`data/entries/${slug}.md\` |`,
    `| Name | ${name} |`,
    `| Category | ${category.name} |`,
    `| License | ${info.license ?? "none found"} |`,
    `| Bindings | ${info.bindings.join(", ") || "none detected"} |`,
    `| Last commit | ${info.pushed} |`,
    ...(notes.length ? ["", ...notes.map((n) => `> ${n}`)] : []),
    "",
    ...(checkOnly
      ? [
          "This only means the automatic checks passed — an accepted open-source license (or none, " +
            "which is listed with a marker), a Cloudflare deploy configuration, recent activity, " +
            "and not already listed.",
          "",
          "A maintainer still decides whether it belongs: whether it is genuinely a SaaS " +
            "replacement rather than a framework or a template, and whether the name, summary " +
            "and category are right. The pull request opens when a maintainer comments `/approve`.",
        ]
      : [
          nameFromRepo
            ? "The name is taken from the repository; that, the summary and the category"
            : "The name and summary come from the issue; those and the category",
          "still get a human read before merge.",
        ]),
  ]);

  console.log(
    JSON.stringify(
      { ok: true, repo, slug, name, nameFromRepo, category: category.name, license: info.license },
      null,
      1,
    ),
  );
  info.saveCache?.();
  return 0;
}

process.exit(await main());
