# Releasing

This is a fork of [`vercel-labs/scriptc`](https://github.com/vercel-labs/scriptc). It publishes its **own** packages, under its own scope, from its own repository. It cannot publish to upstream's packages and upstream cannot publish to ours; the two lines are separate on the registry by name and separate on npm by trusted-publisher configuration.

## What this repository publishes

| workspace directory | published as | replaces upstream's |
| --- | --- | --- |
| `packages/runtime` | `@scriptc-fork/runtime` | `@scriptc/runtime` |
| `packages/compiler` | `@scriptc-fork/compiler` | `@scriptc/compiler` |
| `packages/cli` | `@scriptc-fork/scriptc` | `scriptc` |

The command a user gets on `PATH` is still `scriptc` — the `bin` key in `packages/cli/package.json` is unchanged, only the package name around it moved.

## The aliasing, and why the source tree still says `@scriptc/*`

Around a hundred files in this repository import `@scriptc/compiler` and `@scriptc/runtime` by specifier, and `packages/compiler/src/frontend/shared.ts` resolves its own shipped ambient declarations through `require.resolve("@scriptc/compiler/scriptc.d.ts")`. Renaming those specifiers would touch every one of those files and conflict with every branch in flight.

Instead the packages are renamed and the **old specifier is kept as an alias to the new package**:

```json
"dependencies": {
  "@scriptc/runtime": "workspace:@scriptc-fork/runtime@*"
}
```

`pnpm pack` rewrites that to `"@scriptc/runtime": "npm:@scriptc-fork/runtime@<version>"`, so a consumer who installs `@scriptc-fork/scriptc` gets the fork's compiler installed into a directory literally named `node_modules/@scriptc/compiler`. Every import specifier and every self-referencing `require.resolve` then resolves exactly as it did before the rename. The same aliasing pattern is already used in this repository for `"typescript5": "npm:typescript@5.9.3"`.

Two consequences worth knowing:

- **`packages/compiler` carries a devDependency on itself**, `"@scriptc/compiler": "workspace:@scriptc-fork/compiler@*"`. Node's package self-reference resolves by the `name` field, which no longer matches the `@scriptc/compiler` specifier, so inside the workspace `require.resolve("@scriptc/compiler/scriptc.d.ts")` has nothing to find. The self-alias makes pnpm create `packages/compiler/node_modules/@scriptc/compiler -> ../..` and the resolution works again. It is a **dev**Dependency deliberately: consumers never install devDependencies, so the published package does not ship a copy of itself. Removing it does not break the published package — it breaks the local build and the test suite.
- The `pnpm-lock.yaml` entries for these three specifiers must stay in the alias form. `pnpm install --frozen-lockfile` in the release workflow fails loudly if they drift, which is the intended guard.

The release workflow additionally refuses to publish any tarball whose packed `package.json` still contains a `workspace:` spec — that would mean the rewrite silently did not happen and the package would be uninstallable.

## Versioning

Upstream's line is `0.0.x` (`scriptc@0.0.21` at the fork point). This fork starts at **`0.1.0`**.

A registry collision is impossible in any case — the names differ — so the version is chosen for human legibility, not uniqueness:

- it is a plain release version, with none of the dist-tag and range-matching surprises a `0.0.21-fork.1` prerelease would carry;
- it sorts above every `0.0.x`, so no range written for one line can ever accidentally match the other;
- it leaves upstream's entire `0.0.x` line free, so no version number is ever claimed by both projects;
- it reads as what it is — a different line, not a patch on top of `0.0.21`.

Subsequent releases move `0.1.1`, `0.2.0`, and so on, independently of whatever upstream does.

## One-time setup — a maintainer must do this by hand

None of this can be scripted from the repository, and the first release will fail without it.

1. **Claim the `@scriptc-fork` scope on npmjs.com.** Create it as an organization (or a user scope) under the account that will own the packages. Scope availability has not been checked from this repository — the host it was prepared on has no network access to `registry.npmjs.org`. **Verify the scope is free before committing to the name**; `npm org ls scriptc-fork` or simply trying to create it on npmjs.com will tell you. If it is taken, pick another scope and change it in the three `packages/*/package.json` `name` fields, in the three alias specifiers, in the matching `pnpm-lock.yaml` importer entries, and in the `github.repository` comment in `.github/workflows/release.yml`.
2. **Create a GitHub environment named `Release`** in `vinikjkkj/scriptc` (Settings → Environments). The publish job declares `environment: Release`, and the trusted publisher is matched against it.
3. **Configure trusted publishing for each of the three packages** on npmjs.com, pointing at repository `vinikjkkj/scriptc`, workflow `release.yml`, environment `Release`. Trusted publishing has a bootstrapping wrinkle: a package that does not exist yet cannot be configured. Either publish each package once manually from a logged-in local shell (`npm publish --access public`) and then attach the trusted publisher, or use npm's "pending" trusted-publisher configuration if it is available on the account.
4. Confirm the workflow's repository guard, `if: github.repository == 'vinikjkkj/scriptc'`, names the repository you are actually pushing to.

Until step 3 is done, the publish job fails with an OIDC authentication error **before** anything is uploaded. That is the safe failure: nothing is half-published.

## Preparing a release

1. Bump the version in `packages/cli/package.json`.
2. Run `node scripts/sync-versions.mjs` to stamp the same version into `packages/runtime` and `packages/compiler`, then `pnpm manifest` to restamp `packages/compiler/surface-manifest.json` with the new version, and commit all of it (the test suite's staleness guard fails on a version drift). Neither script hardcodes a package name; both key on the workspace directory, so the rename did not touch them.
3. Fold the `## Unreleased` section of `CHANGELOG.md` into a new `## <version>` entry (newest first, below `## Unreleased`), and leave `## Unreleased` empty for the next cycle.
4. Wrap the new entry in `<!-- release:start -->` and `<!-- release:end -->` markers; this marked block is also the GitHub release body.
5. Remove the `<!-- release:start -->` and `<!-- release:end -->` markers from the previous release entry; only the latest release should have markers.
6. With Zig on `PATH`, run `SCRIPTC_CROSS=1 pnpm exec vitest run tests/harness/library-cross.test.ts` and require the cross-target library conformance lane to pass.
7. Commit to `main`.

## What CI does

`.github/workflows/release.yml` reads **both** the name and the version from `packages/cli/package.json` and compares that version to what the same package has on npm. (The name used to be hardcoded as `scriptc`; after the rename that check would have compared against upstream's package and released on every push.) If the versions differ, it builds the workspace, verifies all three package versions match, and publishes in dependency order — `@scriptc-fork/runtime`, then `@scriptc-fork/compiler`, then `@scriptc-fork/scriptc` — so each package's dependencies are resolvable the moment it lands.

After the publish succeeds, a separate job creates the git tag `v<version>` and the GitHub release with the marked changelog entry as its body, and attaches `surface-manifest.json` — the machine-readable listing of the surface the static tier compiles at that version (stable per-entry ids, so two releases diff mechanically; see `packages/compiler/src/coverage/surface-manifest.ts` for the schema). The job regenerates the manifest from the tree and fails on any byte difference from the committed file before attaching, so the asset is always the manifest of the code being released. The same file ships inside the compiler package, reachable as `@scriptc/compiler/surface-manifest.json` from a consumer's tree.

Two deliberate differences from repositories that ship prebuilt binaries: there are no platform binary assets to build or stage — scriptc compiles programs on the user's machine with a local C compiler — so the GitHub release is a tag, release notes, and the manifest asset only, and the npm publish never waits on the GitHub release (the release job runs after the publish, not before it).

Publishing uses npm trusted publishing (OIDC) — there is no npm token secret anywhere in this repository. Re-runs are safe: any package already on the registry at the target version is skipped, so a partially published release can be resumed by re-running the workflow.

## Verifying a release candidate without publishing

Do not press the button on a release nobody has rehearsed. One command rehearses it:

```console
$ pnpm release:dry-run
```

`scripts/release-dry-run.mjs` builds the workspace, checks that the **workspace** CLI still compiles and runs a program, packs the three packages, checks each packed manifest (versions agree, no `workspace:` spec survived the rewrite, the workspace deps read `npm:@scriptc-fork/<pkg>@<version>`, and the CLI still declares `bin.scriptc`), extracts the three tarballs into the `node_modules` layout npm produces from those alias specs, then compiles and runs a real program through the **installed** CLI. It ends by printing `hello from the fork` from a binary built by the tarballs you are about to publish, or by naming what is wrong. It contacts no registry and publishes nothing.

The workspace check is not redundant with the artifact check, and this is the subtle part. The two resolve `@scriptc/compiler` by different routes: a consumer gets a directory literally named `@scriptc/compiler` because of the `npm:` alias, while the workspace gets there only through the self-alias devDependency on `packages/compiler`. Deleting that devDependency leaves a **perfectly good tarball** and a dead local build — the artifact check passes, the workspace check fails and names the missing devDependency. Verified by doing exactly that and watching the script go red.

It also runs two negative controls and refuses to report success unless both fail as designed:

- **A** — the packed-manifest guard, handed a synthetic manifest that still carries a `workspace:` spec, must reject it.
- **B** — the same build, in a copy of the consumer tree where `@scriptc/compiler` has been renamed to `@scriptc-fork/compiler` (the layout you would get if the alias were dropped), must **fail**.

Control B is the one that earns the report. Without it a passing run is consistent with the compiler coming from somewhere else entirely — a globally installed `scriptc`, or the workspace resolving through a parent directory — and the dry run would print `ok` while proving nothing about the tarballs. If control B ever passes, the script says so and exits non-zero.

Useful flags: `--dir <path>` puts the sandbox somewhere other than the system temp directory (it defaults to `os.tmpdir()`, which honours `TMPDIR`/`TMP`; set it if your temp lives on a small disk), `--keep` leaves the sandbox for inspection, and `--no-build` reuses the current `dist/`.

The script needs a `tar` binary, which every supported platform has. It passes both paths to `tar` relative and slash-separated on purpose: a drive-lettered argument is read as a remote host spec by bsdtar, and GNU tar — what a Git install puts on `PATH` — escapes the backslashes and then cannot find the directory.
