#!/bin/bash
# diag.sh <build.log>: the compiler's diagnostics of one REST build, for the job log (LABECHO echoes $ART/diag-*.txt).
# 1. the summary line(s) ("N advisories (the build succeeded)", "N errors"), 2. a histogram by kind and code, 3. EVERY non-advice diagnostic
# (error / warning / refusal / info / note with its SC code, plus the two lines after it), and the other non-advice, non-provenance output lines, 4. the last 40 lines.
bl=$1
echo "# build log $bl: $(wc -l < "$bl") lines"
echo "# ---- summary"; grep -nE "[0-9]+ (advisories|advisory|errors?|warnings?)\b|^rc=" "$bl"
echo "# ---- histogram of diagnostic codes (count kind SCcode)"; grep -oE " - (advice|error|warning|info|note|refusal) SC[0-9]+" "$bl" | sed 's/^ - //' | sort | uniq -c | sort -rn
echo "# ---- every non-advice diagnostic (with 2 lines of context)"
grep -nE " - (error|warning|info|note|refusal) SC[0-9]+" "$bl" -A2 | cut -c1-400
echo "# ---- other non-advice lines (not provenance, not an advice block, not source context)"
grep -vE " - advice SC[0-9]+|^provenance:|^[[:space:]]*[0-9]+ \||^[[:space:]]+hint:|^[[:space:]]*$|^[[:space:]]+~|^[[:space:]]*\|" "$bl" | grep -vE " - (error|warning|info|note|refusal) SC[0-9]+" | head -200 | cut -c1-300
echo "# ---- tail"; tail -40 "$bl" | cut -c1-300
