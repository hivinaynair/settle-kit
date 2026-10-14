# T9 · Publish `0.1.0` to npm

**Read first:** design doc §9 (last required check), §12 (open-source readiness).
**Depends on:** T5–T7 (T8 can run in parallel). **Needs Vinay:** `npm login` as an
owner of the `@settle-kit` org, and a yes before the real publish.
**Time box:** ~2 hours. **Branch:** `vinay/t9-publish`.
**Done when:** `@settle-kit/core`, `@settle-kit/server` and `@settle-kit/react`
`0.1.0` are on npm, and a brand-new Next.js app outside the monorepo installs them from
the registry and completes a simulated payment by following the README.

---

## Goal

Today the packages export raw TypeScript and only work inside this monorepo
(`transpilePackages`). A published package must ship JavaScript plus type declarations,
keep server code out of browser bundles, and work without our workspace setup.

---

## 1. Build

- Each package gets `tsconfig.build.json` and `"build": "tsc -p tsconfig.build.json"`,
  emitting ESM JavaScript, `.d.ts` and declaration maps to `dist/`. Plain `tsc` keeps
  the `"use workflow"`, `"use step"` and `"use client"` directives exactly where they
  are, which the Workflow SDK compiler and Next.js need. (Don't bundle: a bundler may
  hoist or drop directives. `bun build` also emits no `.d.ts`.)
- Relative imports need `.js` extensions in the emitted output (use
  `"module": "NodeNext"` in the build config, or `rewriteRelativeImportExtensions`).
- `package.json` per package:

  ```json
  {
    "version": "0.1.0",
    "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
    "files": ["dist", "src", "README.md", "LICENSE"],
    "sideEffects": false,
    "repository": { "type": "git", "url": "https://github.com/hivinaynair/settle-kit", "directory": "packages/…" },
    "publishConfig": { "access": "public" }
  }
  ```

  `@settle-kit/react` is not `sideEffects: false` if the style injection runs at import.
- Dependencies: `workspace:*` becomes `0.1.0` on publish (`bun publish` rewrites it;
  check the packed `package.json`). `viem`, `react`, `workflow` and `drizzle-orm` are
  **peer** dependencies (one copy in the host app); `zod` and `uqr` are regular.
- The demo switches from source to the built packages: turbo already runs `^build`
  before `dev`/`build`; drop the packages from `transpilePackages`; add `tsc --watch`
  dev scripts so edits still hot-reload.

## 2. Boundaries

- `@settle-kit/server` must never reach a browser bundle: add `import "server-only"`
  at its entry (Next.js fails the build if a client component imports it).
- `@settle-kit/react` starts with `"use client"` and imports only types from
  `@settle-kit/server` (none at runtime).
- `@settle-kit/core` stays dependency-free apart from the `viem` peer.
- The SQL migration ships inside `@settle-kit/server` (`migrations/0001_init.sql`) and
  the README says how to apply it (`psql` or drizzle-kit).

## 3. Checks before publishing

1. `bun run build && bun pm pack` in each package; inspect each tarball: only `dist`,
   `src`, README, LICENSE; no `.env*`, tests or fixtures.
2. `bunx publint` and `bunx @arethetypeswrong/cli --pack` on each tarball (run once; not
   added as dependencies). Fix every error.
3. **Install test:** in the scratch directory, `bunx create-next-app@latest` a fresh
   app; `bun add` the three tarballs plus `workflow`, `viem`, `drizzle-orm`, `pg`; follow
   the README quickstart literally (test mode, Neon test branch); create an order,
   simulate payment, see `onPaid` fire once and the order `paid`. Any step the README
   doesn't mention is a README bug: fix it.
4. Confirm workflow discovery compiled `payOrder` from `node_modules` (the generated
   `app/.well-known/workflow/v1/manifest.json` lists it).

## 4. Publish (with Vinay)

- Per-package `README.md` (short, links to the root README) and `LICENSE` (MIT).
- `CHANGELOG.md` at the root with `0.1.0` and an "experimental: breaking changes
  possible in 0.x" note (design §12 item 2).
- `bun publish --dry-run` for each, show Vinay the file lists, then once Vinay says yes:
  `bun publish` in order core → server → react.
- Tag `v0.1.0` and create a GitHub release with the changelog.
- Repeat the install test against the registry instead of tarballs.

---

## Acceptance

1. Three packages at `0.1.0` on npm, each with types that `attw` reports clean.
2. The fresh app from the registry reaches a simulated `paid` with no workspace links,
   no `transpilePackages` entry and no step outside the README.
3. Importing `@settle-kit/server` from a client component fails the build with the
   `server-only` error.
4. The demo still builds and runs on the built packages.

## Out of scope

CI publishing with provenance, changesets automation, SQL migrations beyond `0001`,
non-Next.js frameworks (design §12 item 9).

## Questions to answer in the PR description

- Why plain `tsc` instead of a bundler?
- Which dependencies are peers, and why?
- How does a host's build find the `payOrder` workflow inside `node_modules`?
