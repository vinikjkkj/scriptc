# The rig, and how to re-run it

A rig that is not in the repo dies with its worktree. This one is committed
whole: nine scripts, the driver tree's `package.json` and `tsconfig.json`, the
drivers, the fixtures and every `sites.mjs` record the tables are computed from.

## Files

| file | what it is |
| --- | --- |
| `env.sh` / `env.ps1` | the pinned environment. Every path derives from one root, so the edit cannot be half-done. Both **end by running the guard**, so sourcing them is a gate, not a convenience |
| `guard.mjs` | refuses to let anything run unless all eight cache/temp variables are set **and** point at `G:`. `STORESTATUS_GUARD_SELFTEST=1` proves it can fail |
| `spawn.ps1` | detaches one job so it survives the agent turn. Writes the command to a generated `.sh` rather than quoting a `bash -c` payload through PowerShell — that quoting eats backslashes here and the failure mode is a child that exits instantly leaving an **empty** log, which reads exactly like "still starting up". Every job ends with a `GATE-EXIT rc=` sentinel; a log without one was truncated, not finished |
| `analyse1.sh` | one `analyze()` pass. **Analyse level only** — it stops before `ir/validate.ts` and both emitters |
| `build1.sh` | one strict build, no `--best-effort`. Build level: rc, bytes, run, oracle, fences, engine scan |
| `fences.sh` | fences across **every** emitted TU, split at `SC900x` |
| `engine-scan.sh` / `arm-engine-scan.sh` | the scan, and the control that says which markers may be quoted |
| `sites.mjs` | the per-entry site dump. Self-guarding; throws `BLIND: …` rather than writing a record that merely looks empty |
| `tally.mjs` | summarises one or more records. Prints the **state** before any count |
| `ladder.sh` | the 12-arm substitution ladder, with its A/A control |
| `queue.sh` | every measurement in this survey, by stage name |
| `trailer-check.sh` + `ctl-trailered.txt` | the attribution check and its positive control |

## Re-running it

```sh
# 1. worktree + compiler (node v22.18.0 BUILDS, v25.9.0 MEASURES)
git worktree add <blocks>/storestatus/wt -b block/storestatus main
pwsh -c '. tests/perf/storestatus/harness/env.ps1; pnpm install --frozen-lockfile'
pwsh -c '. tests/perf/storestatus/harness/env.ps1; cd packages/compiler; node node_modules/typescript5/bin/tsc -p tsconfig.json'
pwsh -c '. tests/perf/storestatus/harness/env.ps1; cd packages/cli;      node ../compiler/node_modules/typescript5/bin/tsc -p tsconfig.json'

# 2. the driver tree: harness/napp-package.json + napp-tsconfig.json into
#    $LAB/napp, then `npm install`, then drivers/ and fixtures/ beside it
# 3. the controls, first and separately
bash tests/perf/storestatus/harness/arm-engine-scan.sh
bash tests/perf/storestatus/harness/ladder.sh
# 4. the survey, ONE STAGE AT A TIME on a loaded box
bash tests/perf/storestatus/harness/queue.sh consumer1     # ... etc
```

## Is it worth keeping?

Yes, with one caveat. `analyse1.sh`, `build1.sh`, `fences.sh`, `guard.mjs`,
`engine-scan.sh` and `ladder.sh` are the survey instrument for **any** package
on the provenance lane, not just `store-*`; three of them are hardened against
false zeros that have actually been recorded in this tree. `sites.mjs` and
`tally.mjs` are inherited from `pkgstatus-0907` with two changes (self-guard,
no `WT` default) and should be kept in one place rather than copied a third
time — a future block should import them rather than fork them again.

The caveat: the **driver tree** (`$LAB/napp`, 85 MB of `node_modules` pinned to
specific published versions) is not committed and cannot be. Its manifest is
(`napp-package.json`), and the resolved versions every number was taken against
are named in `README.md`, but `npm install` a month from now resolves a
different tree and the numbers move. Any re-run must state the versions it got.
