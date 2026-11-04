# entries.sh <driver>: sets $entry (the rig file) and $extra (compiler flags) for a driver name. Sourced by build.sh and run-compare.sh.
# mysql2 is measured WITH --npm-static mysql2 (the defined mysql2 count); the connect and roundtrip entries use the same recipe.
case "$driver" in
  mysql2)           entry=mysql-entry.ts;      extra=(--npm-static mysql2) ;;
  pg)               entry=pg-entry.ts;         extra=() ;;
  ioredis)          entry=redis-entry.ts;      extra=() ;;
  mongodb)          entry=mongo-entry.ts;      extra=() ;;
  mysql2-connect)   entry=mysql-connect.ts;    extra=(--npm-static mysql2) ;;
  pg-connect)       entry=pg-connect.ts;       extra=() ;;
  mysql2-roundtrip) entry=mysql-roundtrip.ts;  extra=(--npm-static mysql2) ;;
  pg-roundtrip)     entry=pg-roundtrip.ts;     extra=() ;;
  *) echo "unknown driver: $driver" >&2; exit 2 ;;
esac
