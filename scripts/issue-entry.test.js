/**
 * Tests for parsing a submission issue.
 *
 * The issue body is written by anyone on the internet and ends up in a file
 * and a branch name, so these lean on the hostile cases.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { loadCategories } from "./data.js";
import {
  FIELDS,
  cleanName,
  cleanSummary,
  normaliseRepo,
  parseIssueBody,
  renderEntry,
  slugForRepo,
  validateSubmission,
} from "./issue-entry.js";

const categories = loadCategories();

function body({ repo = "CCCrafts/punctual", name = "_No response_", category = "Business and operations", summary = "Calendly alternative.", notes = "_No response_" } = {}) {
  return [
    `### ${FIELDS.repo}`, "", repo, "",
    `### ${FIELDS.name}`, "", name, "",
    `### ${FIELDS.category}`, "", category, "",
    `### ${FIELDS.summary}`, "", summary, "",
    `### ${FIELDS.notes}`, "", notes, "",
  ].join("\n");
}

test("parses an issue-form body into fields", () => {
  const fields = parseIssueBody(body());
  assert.equal(fields[FIELDS.repo], "CCCrafts/punctual");
  assert.equal(fields[FIELDS.category], "Business and operations");
  assert.equal(fields[FIELDS.summary], "Calendly alternative.");
  assert.equal(fields[FIELDS.notes], "", "_No response_ becomes empty");
});

test("accepts a bare repo or any GitHub URL form", () => {
  for (const input of [
    "CCCrafts/punctual",
    "  CCCrafts/punctual  ",
    "https://github.com/CCCrafts/punctual",
    "http://www.github.com/CCCrafts/punctual",
    "github.com/CCCrafts/punctual",
    "https://github.com/CCCrafts/punctual.git",
    "https://github.com/CCCrafts/punctual/tree/main/src",
    "https://github.com/CCCrafts/punctual#readme",
  ]) {
    assert.equal(normaliseRepo(input), "CCCrafts/punctual", `failed on ${input}`);
  }
});

test("rejects anything that is not a plain owner/repo", () => {
  for (const input of [
    "", "   ", "not-a-repo", "https://gitlab.com/a/b", "a/b/c",
    "../../etc/passwd", "a/../../b", "owner/repo; rm -rf /",
    "owner/repo`whoami`", "owner/$(id)", "<script>alert(1)</script>",
  ]) {
    assert.equal(normaliseRepo(input), null, `should have rejected ${JSON.stringify(input)}`);
  }
});

test("a summary cannot break out of frontmatter", () => {
  // A newline plus a fake key would forge fields in the generated file.
  assert.equal(
    cleanSummary("Real summary\nlicense: MIT\nbindings: [D1]"),
    "Real summary license: MIT bindings: [D1]",
  );
  assert.equal(cleanSummary("---\nname: evil"), null, "a --- opener is refused");
  assert.equal(cleanSummary("  spaced   out  "), "spaced out");
  assert.equal(cleanSummary("x".repeat(201)), null, "over-long is refused");
  assert.equal(cleanSummary(""), null);
});

test("a colon in a summary survives, because the parser splits on the first one", () => {
  const summary = cleanSummary("Canny alternative: boards, roadmap and changelog.");
  const file = renderEntry({
    name: "feedlog", repo: "linkcraftstudio/feedlog", category: "business-and-operations",
    summary, license: "MIT", bindings: ["R2"],
  });
  assert.match(file, /^summary: Canny alternative: boards, roadmap and changelog\.$/m);
});

test("slugs come from the repo name and are filesystem-safe", () => {
  assert.equal(slugForRepo("CCCrafts/punctual"), "punctual");
  assert.equal(slugForRepo("MarSeventh/CloudFlare-ImgBed"), "cloudflare-imgbed");
  assert.equal(slugForRepo("inngest/typedwebhook.tools"), "typedwebhook-tools");
  for (const repo of ["a/..", "a/.", "a/---"]) {
    assert.throws(() => slugForRepo(repo), /cannot derive a slug/);
  }
});

test("validation reports every problem at once", () => {
  const result = validateSubmission(
    parseIssueBody(body({ repo: "nope", category: "Nonexistent", summary: "" })),
    categories,
  );
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 3, "repo, category and summary all reported");
});

test("a valid submission resolves its category", () => {
  const result = validateSubmission(parseIssueBody(body()), categories);
  assert.equal(result.ok, true);
  assert.equal(result.entry.repo, "CCCrafts/punctual");
  assert.equal(result.entry.category.slug, "business-and-operations");
  assert.equal(result.entry.slug, "punctual");
});

test("the name comes from the issue, or the repository when none is given", () => {
  const fallback = validateSubmission(parseIssueBody(body()), categories);
  assert.equal(fallback.entry.name, "punctual");
  assert.equal(fallback.entry.nameFromRepo, true);

  const given = validateSubmission(
    parseIssueBody(body({ repo: "EdgeKits/repoaccess-core", name: "RepoAccess" })),
    categories,
  );
  assert.equal(given.entry.name, "RepoAccess");
  assert.equal(given.entry.nameFromRepo, false);
  assert.equal(given.entry.slug, "repoaccess-core", "the id still follows the repository");
});

test("a name cannot break out of frontmatter either", () => {
  for (const name of ["---\nname: evil", "x".repeat(61)]) {
    const result = validateSubmission(parseIssueBody(body({ name })), categories);
    assert.equal(result.ok, false, `should have refused ${JSON.stringify(name)}`);
    assert.match(result.errors[0], /\*\*Name\*\*/);
  }
  assert.equal(cleanName("Two\nlines"), "Two lines");
});

test("a category may be given by slug as well as by name", () => {
  const result = validateSubmission(
    parseIssueBody(body({ category: "business-and-operations" })),
    categories,
  );
  assert.equal(result.ok, true);
  assert.equal(result.entry.category.slug, "business-and-operations");
});

test("renderEntry emits an unlicensed entry with a note and empty license", () => {
  const file = renderEntry({
    name: "smail", repo: "akazwz/smail", category: "email-and-inboxes",
    summary: "Temporary mailbox.", license: null, bindings: [],
    licenseNote: "No LICENSE file in the repository",
  });
  assert.match(file, /^license: null$/m);
  assert.match(file, /^license_note: No LICENSE file in the repository$/m);
  assert.match(file, /^bindings: \[\]$/m);
});
