/**
 * Loader for the content in `data/`.
 *
 * `data/` is the source of truth for this list:
 *
 *   data/categories/<slug>.md   one per section, ordered by its `order` field
 *   data/entries/<slug>.md      one per project, referencing a category slug
 *
 * A file's name is its id. `data/entries/punctual.md` is the entry `punctual`,
 * and its `category: business-and-operations` points at
 * `data/categories/business-and-operations.md`. Nothing else links them, so a
 * rename is a broken reference the loader catches rather than a silent drift.
 *
 * README.md is generated from all of it by `build.js`, and a site can
 * import this module directly.
 *
 * Frontmatter is a deliberately small YAML subset -- scalars and inline lists --
 * parsed here so the tooling has no dependencies.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { licenseStatus } from "./config-parser.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = path.join(ROOT, "data");
export const CATEGORIES_DIR = path.join(DATA_DIR, "categories");
export const ENTRIES_DIR = path.join(DATA_DIR, "entries");
/** Stars at or above which an entry's badge is highlighted. */
export const POPULAR_THRESHOLD = 1000;

const REQUIRED_ENTRY = ["name", "repo", "category", "summary"];
const REQUIRED_CATEGORY = ["name", "order"];

export function parseFrontmatter(text) {
  if (!text.startsWith("---")) throw new Error("missing frontmatter");
  const parts = text.split("---");
  const fm = parts[1];
  const body = parts.slice(2).join("---").trim();

  const data = {};
  for (const line of fm.trim().split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();

    if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = value
        .slice(1, -1)
        .split(",")
        .map((v) => v.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    } else if (value === "" || value === "null" || value === "~") {
      data[key] = null;
    } else if (value === "true" || value === "false") {
      data[key] = value === "true";
    } else if (/^-?\d+$/.test(value)) {
      data[key] = Number(value);
    } else {
      data[key] = value.replace(/^['"]|['"]$/g, "");
    }
  }
  return { data, body };
}

function readDir(dir, required) {
  if (!fs.existsSync(dir)) throw new Error(`missing directory: ${dir}`);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((file) => {
      const { data, body } = parseFrontmatter(fs.readFileSync(path.join(dir, file), "utf8"));
      const slug = file.replace(/\.md$/, "");
      const missing = required.filter((k) => data[k] === undefined || data[k] === null);
      if (missing.length) throw new Error(`${file}: missing ${missing.join(", ")}`);
      return { ...data, slug, body };
    });
}

/** Sections, in display order. */
export function loadCategories() {
  const cats = readDir(CATEGORIES_DIR, REQUIRED_CATEGORY);
  cats.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return cats;
}

/**
 * Every entry, each with its `category` resolved to the category object.
 * Throws if an entry points at a category slug that has no file.
 */
export function loadEntries(categories = loadCategories()) {
  const bySlug = new Map(categories.map((c) => [c.slug, c]));
  const order = new Map(categories.map((c, i) => [c.slug, i]));

  const entries = readDir(ENTRIES_DIR, REQUIRED_ENTRY).map((entry) => {
    const category = bySlug.get(entry.category);
    if (!category) {
      throw new Error(
        `${entry.slug}.md: category "${entry.category}" has no file in data/categories/`,
      );
    }
    return {
      ...entry,
      category,
      categorySlug: entry.category,
      bindings: entry.bindings ?? [],
      license: entry.license ?? null,
      popular: entry.popular === true,
      deploy: entry.deploy === true,
      // Derived, never stored: the owner is already in `repo`, so this cannot
      // drift and needs no refresh. Cheaper than every other marker here.
      official: entry.repo.split("/")[0].toLowerCase() === "cloudflare",
    };
  });

  entries.sort((a, b) => {
    const byCat = order.get(a.categorySlug) - order.get(b.categorySlug);
    return byCat !== 0 ? byCat : a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  return entries;
}

/** Categories with their entries attached, ready to render. */
export function loadSections() {
  const categories = loadCategories();
  const entries = loadEntries(categories);
  return categories
    .map((category) => ({
      ...category,
      entries: entries.filter((e) => e.categorySlug === category.slug),
    }))
    .filter((section) => section.entries.length);
}

/**
 * Badges render 20px tall natively, which exactly fills the line box -- so when
 * the pair wraps, the two rows sit flush against each other. Drawing them a
 * couple of pixels shorter lets the line height show through as a gap. It is
 * the only way to get vertical spacing here: GitHub strips both `style` and
 * `vspace`.
 */
const BADGE_HEIGHT = 18;

export function starBadge(repo, popular = false) {
  // Fetched live by the reader's browser, so no count is stored here.
  // flat-square is ~760 bytes against ~2.8KB for the default, which matters
  // when a page carries one per entry.
  //
  // An <img> rather than `![]()` for `align` and `height`, the levers GitHub's
  // sanitiser leaves: it strips `style` and substitutes its own, and drops
  // `vspace`. No `hspace` -- it pads both sides, and the badge sits flush left.
  // Green rather than a gold, which would sit in the same family as the orange
  // licence warning. The warning is the signal that matters; the highlight must
  // not compete with it.
  const colour = popular ? "&amp;color=brightgreen" : "";
  const src =
    `https://img.shields.io/github/stars/${repo}?style=flat-square&amp;label=%E2%98%85${colour}`;
  return `<img alt="stars" src="${src}" align="absmiddle" height="${BADGE_HEIGHT}">`;
}

/**
 * Shields escaping for a static badge: a literal dash doubles, a space becomes
 * an underscore, and a literal underscore doubles. Percent-encoding first
 * leaves dashes alone, so the doubling has to follow it.
 */
function shieldsText(text) {
  return encodeURIComponent(text)
    .replace(/_/g, "__")
    .replace(/-/g, "--")
    .replace(/%20/g, "_");
}

/**
 * The licence as a badge rather than a code span.
 *
 * Two images of the same height sit on the same line cleanly; an image beside
 * a code span does not, whichever `align` is used -- the span keeps its own
 * box and the pair reads as misaligned. It also stops a long licence wrapping
 * mid-phrase in a narrow column.
 *
 * Static `/badge/` endpoints, so unlike the star badge these never touch the
 * GitHub API and cannot be rate-limited.
 */
export function licenseBadge(license) {
  const status = licenseStatus(license);
  const warn = status === "none" || status === "source-available";
  const label = license ?? "unlicensed";
  const text = shieldsText(`${warn ? "⚠ " : ""}${label}`);
  const colour = warn ? "orange" : "lightgrey";
  const src = `https://img.shields.io/badge/${text}-${colour}?style=flat-square`;
  const alt = `${warn ? "⚠ " : ""}${label}`;
  return `<img alt="${alt}" src="${src}" align="absmiddle" height="${BADGE_HEIGHT}">`;
}

/**
 * One README table row, as [left, right].
 *
 * Two columns with the detail stacked underneath each: identity and provenance
 * on the left, what it does and what it runs on beneath that on the right. A
 * flat bullet carrying all five facts ran past 300 characters and read as a
 * wall; splitting it lets the eye scan one column at a time.
 *
 * Licensing is reported, never used to exclude. The orange badge marks the two
 * cases where a reader should read the terms first: no licence at all, and a
 * source-available licence imposing conditions an open-source one would not.
 *
 * Bold names are possible here only because these are table cells --
 * awesome-lint's list-item rule, which forbids a bolded link, does not apply.
 */
export function renderRow(entry) {
  const left = `**[${entry.name}](https://github.com/${entry.repo})**<br>` +
    `${starBadge(entry.repo, entry.popular)}&nbsp;${licenseBadge(entry.license)}`;

  // Noted, not linked. A deploy button is not something a reader clicks cold --
  // they will read the project's own docs first -- so this is a signal that the
  // project made deploying easy, and the reader goes to the repository for it.
  // Storing only the fact, never the URL: nothing is displayed that a stored
  // link would add, and an unused URL is one more thing that can rot.
  const parts = [...(entry.bindings ?? [])];
  if (entry.deploy) parts.push("⚡ 1-click deploy");
  if (entry.official) parts.push("🧡 by Cloudflare");
  const detail = parts.join(" · ");
  // No wrapper at all. <sub> was the obvious choice for smaller text, but GitHub
  // sets `line-height: 0` on it so a subscript cannot disturb the line box --
  // which means any <sub> that wraps renders its lines on top of each other, and
  // this one wraps whenever a project has several bindings. <small> would be
  // right, but GitHub's sanitiser strips it. Plain text wraps correctly, and a
  // dotted list is distinguishable from a sentence without a size difference.
  const right = detail ? `${entry.summary}<br>${detail}` : entry.summary;

  return [left, right];
}

export function slugify(value) {
  return value
    .split("/")
    .pop()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
