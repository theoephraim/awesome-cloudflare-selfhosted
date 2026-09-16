# How the audit works

The list claims its facts are read from each project rather than taken on trust. This is how.

## The data

`data/` is the source of truth. README.md and the issue form are generated from it, so edit the
data, not the page.

```
data/
  categories/<slug>.md   one per section — name, order, description
  entries/<slug>.md      one per project — references a category by its slug
```

A file's name is its id. `data/entries/punctual.md` is the entry `punctual`, and its
`category: business-and-operations` points at `data/categories/business-and-operations.md`.
Nothing else links the two, so a rename surfaces as a load error rather than an entry quietly
disappearing from the list.

Generated files are deliberately absent from pull requests. Two submissions that each regenerated
README.md would both rewrite the entry count to the same new number, and git merges identical
changes cleanly — no conflict, but a README that disagrees with the data and silently omits one of
the two entries. A push to `main` regenerates instead.

## Commands

```bash
npm run build           # regenerate README.md and the issue form from data/
npm run audit           # re-check every entry against GitHub
npm run audit:stale     # only entries inactive for 12+ months
npm run audit -- --json # machine-readable
npm test                # test the deploy-config parser
npm run lint            # awesome-lint
```

No dependencies — Node 20+ and [`gh`](https://cli.github.com) are all you need. The audit uses
`gh` for API quota; CI runs it monthly and on every pull request.

## Highlighted entries

An entry at or above 1,000 stars — about a fifth of the list — carries
`popular: true` in its frontmatter and draws its star badge in green.

Only the flag is stored, never a count. The badge fetches the live number from
shields on every page load, so nothing stale is ever displayed; the flag decides
the colour and nothing else.

It lives on the entry rather than in a shared list because `propose-entry` sets
it from the stars it has already fetched, so a popular submission is highlighted
the moment it lands instead of waiting for a refresh — and because a central list
would be a file every submission appends to, which is exactly the collision this
repo avoids by keeping generated files out of pull requests. It also matches how
`license` and `bindings` already work: derived from the repository, written into
the entry.

`npm run popular` re-checks every entry monthly and rewrites only the files whose
status changed, so a month where nothing crossed the line touches nothing.

## One-click deploy

Where a project's README carries a **Deploy to Cloudflare** button, its entry
records `deploy: true` and the list notes it — currently 45 of 118.

Only the fact is stored, never the URL. The marker is not a link: a deploy
button is not something a reader clicks cold, so the useful signal is that the
project made deploying easy, and the reader follows the entry to the repository
to read its docs first. A URL that is never rendered is one more thing that can
rot.

`propose-entry` sets it from the README it already reads, so a new submission
carries the marker without a separate pass.

## Cloudflare's own projects

Three entries are published by Cloudflare itself and are marked `◆ by Cloudflare`.

This marker is derived from the repository owner rather than stored, so unlike
the others it cannot drift and needs no refresh. It keys on the exact owner:
`Cloudflare-Studio` and `cloudflarebase` are other people.

Being Cloudflare's does not exempt a project from the criteria. `cloudflare/agents`
and `cloudflare/sandbox-sdk` are a framework and an SDK, so neither is listed.

## What the audit checks

[`scripts/audit.js`](../scripts/audit.js) walks every entry and reports:

- the resolved SPDX licence, read from the repository's licence file rather than trusting GitHub's
  classifier, and whether it warrants a marker
- whether a Cloudflare deploy configuration exists — `wrangler.toml`, `.json`, `.jsonc`, a
  committed `.example` variant, or an Alchemy `alchemy.run.ts`
- the bindings that configuration declares, which is where each entry's binding list comes from
- last push date, latest release tag, and archived status

## Why reading a config is harder than it looks

Getting this wrong in either direction misleads people, and each of these produced a wrong answer
against a real project before it was fixed:

- A path glob like `/fonts/*` or `"/api/*"` looks exactly like the start of a block comment. A
  regex that treats it as one swallows the rest of the file, erasing every binding below it.
- `wrangler init` scaffolds every binding Cloudflare offers as commented placeholders. Counting
  those credits a project with Vectorize and Hyperdrive it has never used.
- A binding commented out because its id must be filled in locally *is* real, so comments cannot
  simply be dropped either.
- "All rights reserved." appears verbatim in BSD's own text, so a proprietary-licence fallback has
  to run after the known licences or BSD reads as custom terms.

[`scripts/config-parser.js`](../scripts/config-parser.js) holds the rules and
[`config-parser.test.js`](../scripts/config-parser.test.js) pins down each case.

## Not every project uses wrangler

[Alchemy](https://alchemy.run) declares the same infrastructure in TypeScript, and a checker that
only looks for `wrangler.toml` rejects those projects as undeployable — which is how a list like
this quietly loses some of its best entries. Both forms are recognised. If a project deploys to
Cloudflare some third way, that is a bug worth reporting rather than a reason to exclude it.
