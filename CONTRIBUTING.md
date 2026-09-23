# Contributing

Additions are welcome, including your own project. Say so if it's yours — that's fine here, it
just goes on the record in the issue.

**New entries go through [the issue form](../../issues/new?template=add-entry.yml), not a pull
request.** The list is generated from `data/`, and half of each entry — the license, the bindings —
is read out of the repository by tooling that exists precisely because those fields shouldn't be
taken on trust. A hand-written entry file would be guessing at values the bot can determine.

Everything else — fixing a description, arguing with the criteria, improving the tooling — is a
normal pull request.

## Inclusion criteria

An entry must meet **all** of these.

1. **It replaces something you'd otherwise pay for.** A product, not a capability. "A Calendly
   alternative" qualifies. "A router for Workers" does not, however good it is.
2. **It deploys into the submitter's own Cloudflare account,** and the repository proves it with
   a deploy configuration — a `wrangler.toml`/`.json`/`.jsonc` (a committed `.example` or
   `.template` variant counts), or an [Alchemy](https://alchemy.run) `alchemy.run.ts`. A project
   whose own installer or CLI generates the config instead can be added to `DEPLOY_EXCEPTIONS` in
   the audit script, with a pointer to the code that generates it.
3. **Cloudflare is where it runs, not something it talks to.** A Node or Docker app that uses
   Email Routing for inbound mail belongs in
   [awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted). A Worker that
   proxies a hosted API is a shim, not a replacement. An app hosted elsewhere with one tracking
   Worker on the side is hosted elsewhere.
4. **It is complete enough to use.** Not a demo, a proof of concept, or a scaffold you finish
   yourself.
5. **Its license is stated, and preferably open.** See below.
6. **It is alive.** A commit in the last 12 months. The audit flags entries that go quiet; they
   get removed unless someone makes the case for keeping them.

## Licensing

**Nothing is excluded because of its license.** The list reports the terms and marks the ones
worth reading; whether they suit you is your call, not this list's.

That is a change from how this started. The original rule turned away source-available licenses —
BUSL, FSL, PolyForm, Elastic, SSPL — on the grounds that they conflict with owning your
deployment. They mostly don't. BUSL and FSL typically restrict *competing commercially with the
licensor* and permit self-hosting for your own use, which is exactly what this list is for, and
both convert to an open license on a fixed date. Refusing them policed a case the list never
covers.

Two situations get a `⚠` marker, because a reader should look before relying on the project:

- **No license file.** GitHub's default reserves all rights, so strictly nobody else may use,
  modify or deploy the code. It is nearly always an oversight, and adding a `LICENSE` is one
  commit. When it lands, drop the marker.
- **A source-available license.** Published code under conditions an open-source license would not
  impose. Read them. Most permit self-hosting freely, but PolyForm Noncommercial is the sharp
  exception: it bars commercial use outright, so a company running it internally is outside the
  grant.

Everything else is shown as-is. There is no allowlist of acceptable licenses — OSI approves around
120 and any fixed list is mostly a record of what its author happened to think of. An earlier
version of this repo held 16, which auto-rejected EPL-2.0, Artistic-2.0 and BSL-1.0 among others.
`SOURCE_AVAILABLE_LICENSES` and `RECOGNISED_LICENSES` in
[`scripts/config-parser.js`](scripts/config-parser.js) drive the marker and nothing more.

## Out of scope

These belong somewhere, just not here:

- **Frameworks, routers, adapters, SDKs, libraries** — building blocks, not applications
- **Starters, templates, boilerplates** — you still have to build the product
- **Docker/VPS self-hosted software** → [awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted)
- **Workers-compatible runtimes you host yourself** — these replace Cloudflare rather than run on it
- **Dashboards for administering Cloudflare** — a control panel, not a SaaS replacement
- **Proxy, VPN and subscription-generator scripts** → [awesome-tunneling](https://github.com/anderspitman/awesome-tunneling)
- **API relays, key rotators, LLM proxies** — a shim in front of someone else's SaaS

## How a submission becomes an entry

1. You open [the issue form](../../issues/new?template=add-entry.yml) with a repository, a
   category and a one-line summary — and a name, if the project calls itself something other
   than its repository. It is labelled `submission`.
2. `scripts/propose-entry.js` runs straight away and comments the verdict. It applies every rule a
   machine can decide: a Cloudflare deploy configuration, a commit inside 12 months, and not
   already listed. The license is reported, never a reason to refuse.
3. If it fails, the comment lists every reason at once. Edit the issue and the checks run again.
4. **A maintainer comments `/approve`.** Passing the checks is not the same as qualifying —
   whether a project is a SaaS replacement rather than a framework or a template is a judgement,
   and the name, summary and category need reading.
5. That opens the pull request: the entry is generated, README.md is rebuilt, and the PR closes
   the issue. The issue also picks up an `approved` label as a record.

Nothing is written to this repository until step 4. The automatic stage only reads the submitted
project and comments; it never runs its code. The pull request is created by the maintainer's
approval, not by submitting.

### For maintainers

Comment `/approve` on a `submission` issue that has a passing check comment. That is the whole
gesture — it opens the pull request. The `approved` label is added afterwards so the issue list
stays filterable, but nothing watches for it.

Who may approve is the `MAINTAINERS` list at the top of
[`.github/workflows/approve.yml`](.github/workflows/approve.yml): one username per line, matched
exactly. Anyone can comment on a public issue, so that list is the check. It is explicit rather
than an inferred permission because `author_association` reports `CONTRIBUTOR` for anyone who has
ever landed a commit, which is not the same as being allowed to approve. Adding someone is a
commit, so approval rights stay reviewable in history.

A pull request cannot add its own author to that list and self-approve: workflows triggered by
issue comments always run from the default branch, so the change has to be merged first.

Approve only what you've actually read — `/approve` is what turns a stranger's issue into a branch
on this repository. If a submission passed the checks but doesn't belong, say why and close it; the
criteria in this file are the argument to point at.

## The data, for maintainers and PRs that touch it

`data/` is the source of truth. README.md is generated from it, so never hand-edit the list in the
README — your change would be overwritten.

```
data/
  categories/<slug>.md   one per section — name, order, description
  entries/<slug>.md      one per project — references a category by its slug
```

Filenames are ids. Name the entry file after the repository, lowercased:
`CCCrafts/punctual` → `data/entries/punctual.md`.

```markdown
---
name: Punctual
repo: CCCrafts/punctual
category: business-and-operations
license: MIT
bindings: [D1, R2, KV, Durable Objects, Cron]
summary: Calendly alternative for a single team, with booking pages rendered at the edge.
---

Optional longer prose. Not used by the README; it's there for the site.
```

- **category** is the slug of a file in `data/categories/`. Pointing at one that doesn't exist is
  a load error, not a silent omission.
- **license** is the SPDX identifier, matching the repository. Leave it empty for a repo with no
  license file, and add a `license_note:` line explaining that.
- **bindings** come from the deploy config, in the order the audit reports them. Don't write these
  by hand — run the audit and copy what it found.
- **stars** are not a field. The rendered line carries a live shields.io badge built from `repo`,
  so no count is ever written down and none can go stale.
- **summary** is one sentence. Lead with the product it stands in for when there's an obvious one.
  Say what it does, not how it feels about it. No "blazing fast", no "modern", no "simple".

Then regenerate and check:

```bash
npm run build     # rewrite README.md from data/
npm run audit     # verify against GitHub
npm test          # parser tests
```

The tooling is plain Node with no dependencies; there is nothing to `npm install`.

All three have to pass, and the regenerated files go in the commit alongside the data change.
The audit needs
[`gh`](https://cli.github.com) authenticated for API quota; delete `.audit-cache.json` to force a
fresh fetch.

To remove an entry, open an issue saying which rule it broke.

### Adding a category

Only when an entry genuinely fits nowhere — a thin section is worse than a slightly loose fit.
Add `data/categories/<slug>.md` with a `name`, an `order` (they step by 10, so there's room to
insert) and a one-line `summary` describing what belongs there. An empty category is dropped from
the README automatically.

## Reporting a detection bug

If the audit misreads a project — wrong bindings, or "no deploy config" for something that plainly
deploys — that's a bug in the tooling, not a reason to exclude the project. Open an issue with the
repo and what it should have found. Every case in
[`scripts/config-parser.test.js`](scripts/config-parser.test.js) started as one of these.
