# What goes beside the user's binaries

These are the delivery files for the no-buffer build. The **binary itself is not
committed** — it is 31 MB and is rebuilt from `../build.sh nobuf`. It is staged
next to these files in the block directory as `zapo-rest-182-nobuf.exe`.

| file | goes to |
|---|---|
| `zapo-rest-182-nobuf.exe` (staged, not committed) | beside `zapo-rest-182.exe` |
| `start-182-nobuf.cmd` | same directory; port **8789**, own `ZAPO_DB` |
| `README-182-nobuf.md` | same directory |

The name is deliberately distinct from `zapo-rest-182.exe`: same zapo-js
version, different program behaviour, and confusing the two would mean a service
that silently stopped retaining events.

`start-182-nobuf.cmd` uses **port 8789** — neither 8787 (live) nor 8788
(`zapo-rest-182.exe`) — and points `ZAPO_DB` at its own
`zapo-state-182-nobuf.sqlite`. The one-way `store-sqlite` 1.2.0 migration
caution is repeated in full in both the script header and the README; it is not
assumed remembered from `start-182.cmd`.
