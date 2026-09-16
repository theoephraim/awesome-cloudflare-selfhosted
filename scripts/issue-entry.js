/**
 * Turn a submission issue into an entry file.
 *
 * Contributors don't write entry files -- most of the fields are derived, and
 * hand-written `license`/`bindings` are exactly what the audit exists to
 * distrust. They open an issue with the three things only a human knows (which
 * repo, which category, what it replaces) and this builds the rest.
 *
 * Everything here treats the issue body as hostile input: it is attacker-
 * controlled text that ends up in a file, a branch name and a commit. Fields
 * are validated against fixed shapes, never interpolated into a shell command,
 * and anything that could break out of YAML frontmatter is rejected.
 */

import { loadCategories } from "./data.js";

/** `owner/repo`, GitHub's own allowed character set, nothing else. */
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** Accepts a bare `owner/repo` or any GitHub URL pointing at one. */
export function normaliseRepo(value) {
  if (!value) return null;
  let text = value.trim();

  const url = text.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+?)(?:\.git)?(?:[/#?].*)?$/i,
  );
  if (url) text = url[1];

  text = text.replace(/\.git$/i, "").replace(/\/+$/, "");
  if (!REPO_RE.test(text)) return null;
  if (text.split("/").some((part) => part === "." || part === "..")) return null;
  return text;
}

/**
 * Collapse a submitted summary to something that can sit in frontmatter.
 * A stray newline or a `---` line would otherwise corrupt every field after it.
 */
export function cleanSummary(value) {
  if (!value) return null;
  const text = value
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["']|["']$/g, "");

  if (!text) return null;
  if (text.length > 200) return null;
  if (/^-{3,}/.test(text)) return null;
  return text;
}

/**
 * Parse a GitHub issue-form body.
 *
 * The form renders as `### Label` followed by the value, and `_No response_`
 * for anything left empty.
 */
export function parseIssueBody(body) {
  const fields = {};
  if (!body) return fields;

  const parts = body.split(/^###[ \t]+(.+?)[ \t]*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const label = parts[i].trim();
    const value = parts[i + 1]?.trim() ?? "";
    fields[label] = value === "_No response_" ? "" : value;
  }
  return fields;
}

export const FIELDS = {
  repo: "Repository",
  category: "Category",
  summary: "What it replaces, in one sentence",
  notes: "Anything else",
};

/**
 * Validate a parsed submission. Returns `{ ok, errors, entry }` rather than
 * throwing, so the workflow can post every problem back at once instead of
 * making the submitter play whack-a-mole.
 */
export function validateSubmission(fields, categories = loadCategories()) {
  const errors = [];

  const repo = normaliseRepo(fields[FIELDS.repo]);
  if (!repo) {
    errors.push(
      `**Repository** must be a GitHub repo, as \`owner/name\` or a github.com URL. ` +
        `Got: \`${truncate(fields[FIELDS.repo])}\``,
    );
  }

  const categoryName = (fields[FIELDS.category] ?? "").trim();
  const category = categories.find((c) => c.name === categoryName || c.slug === categoryName);
  if (!category) {
    errors.push(
      `**Category** must be one of: ${categories.map((c) => c.name).join(", ")}. ` +
        `Got: \`${truncate(categoryName)}\``,
    );
  }

  const summary = cleanSummary(fields[FIELDS.summary]);
  if (!summary) {
    errors.push(
      "**Summary** must be one sentence, 200 characters or fewer, on a single line.",
    );
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    entry: { repo, category, summary, slug: slugForRepo(repo) },
  };
}

/** Entry id: the repository name, lowercased. Filenames are ids. */
export function slugForRepo(repo) {
  const slug = repo
    .split("/")[1]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) throw new Error(`cannot derive a slug from ${repo}`);
  return slug;
}

/**
 * Render the entry file. `license`, `bindings` and `popular` are filled from the
 * repository, not by the submitter.
 */
export function renderEntry({
  name, repo, category, summary, license, bindings, licenseNote, popular, deploy,
}) {
  const lines = [
    "---",
    `name: ${name}`,
    `repo: ${repo}`,
    `category: ${category}`,
    `license: ${license ?? "null"}`,
  ];
  if (licenseNote) lines.push(`license_note: ${licenseNote}`);
  lines.push(`bindings: [${(bindings ?? []).join(", ")}]`);
  // Only when true -- an explicit `popular: false` on 96 files is noise.
  if (popular) lines.push("popular: true");
  if (deploy) lines.push("deploy: true");
  lines.push(`summary: ${summary}`, "---", "");
  return lines.join("\n");
}

function truncate(value, max = 80) {
  const text = (value ?? "").replace(/[\r\n]+/g, " ").trim();
  if (!text) return "(empty)";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
