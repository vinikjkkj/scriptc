# entries.sh <driver>: sets $entry (the rig file) and $extra (compiler flags) for a driver name. Sourced by build.sh and run-compare.sh.
# zapo-core is the zapo-js CORE reached through a public-API client over the MySQL store (the same recipe as mysql2); zapo-core-llvm is the same entry on the LLVM backend.
# zapo-startup (and -llvm) is the same recipe over an entry that is RUN: a client constructed the way the REST app constructs it, compared with Node.
# mysql2 is measured WITH --npm-static mysql2 (the defined mysql2 count); the connect and roundtrip entries use the same recipe.
backend=c
case "$driver" in
  mysql2)           entry=mysql-entry.ts;      extra=(--npm-static mysql2) ;;
  pg)               entry=pg-entry.ts;         extra=() ;;
  ioredis)          entry=redis-entry.ts;      extra=() ;;
  mongodb)          entry=mongo-entry.ts;      extra=() ;;
  zapo-core)        entry=zapo-core.ts;        extra=(--npm-static mysql2) ;;
  zapo-core-llvm)   entry=zapo-core.ts;        extra=(--npm-static mysql2); backend=llvm ;;
  zapo-startup)     entry=zapo-startup.ts;     extra=(--npm-static mysql2) ;;
  zapo-startup-llvm) entry=zapo-startup.ts;    extra=(--npm-static mysql2); backend=llvm ;;
  mysql2-connect)   entry=mysql-connect.ts;    extra=(--npm-static mysql2) ;;
  pg-connect)       entry=pg-connect.ts;       extra=() ;;
  mysql2-roundtrip) entry=mysql-roundtrip.ts;  extra=(--npm-static mysql2) ;;
  pg-roundtrip)     entry=pg-roundtrip.ts;     extra=() ;;
  *) echo "unknown driver: $driver" >&2; exit 2 ;;
esac
