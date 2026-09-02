#!/bin/bash
# count diagnostics in a build log: total sites, distinct (file:line,code), by code
L="$1"
[ -f "$L" ] || { echo "no log $L"; exit 1; }
tot=$(rg -a -c ' - error SC[0-9]{4}: ' "$L" 2>/dev/null); tot=${tot:-0}
echo "log=$(basename "$L")  error-sites=$tot"
rg -a -o ' - error (SC[0-9]{4}): ' -r '$1' "$L" 2>/dev/null | sort | uniq -c | sort -rn | head -15
echo "-- distinct (file:line code):"
rg -a -o '^[^ ]+:[0-9]+:[0-9]+ - error SC[0-9]{4}' "$L" 2>/dev/null | sed 's/:[0-9]*  *-  *error / /' | sort -u | wc -l
echo "-- top messages:"
rg -a -o ' - error SC[0-9]{4}: .*' "$L" 2>/dev/null | sed 's/^ - error //' | cut -c1-95 | sort | uniq -c | sort -rn | head -12
rg -a -n 'fetch failed|island path used|no source mapping' "$L" | head -5
