#!/bin/sh
# Verification run for the compiled zapo-rest binary.
#   1. start it on a fresh SQLite file
#   2. prove it serves the API (health, routes, store reads, auth gate, 404)
#   3. kill it, restart it on the SAME file, and show the store came back
set -u
EXE=${EXE:?set EXE to the built zapo-rest binary}
# The kill below is BY IMAGE NAME, because $! under Git Bash is the MSYS pid
# and taskkill silently matches nothing on it. That makes the image name
# load-bearing: hardcoding "zapo-rest.exe" meant a verification run would
# also kill a zapo-rest.exe the USER was running from another directory.
# It is taken from $EXE, so verifying a copy under a distinct name cannot
# reach anyone else's process.
IMG=$(basename "$EXE")
RUN=${RUN:-$PWD/verify-run}
PORT=${PORT:-18933}
TOKEN=verify-secret
DB="$RUN/verify.sqlite"

[ -n "${VERIFY_ENV:-}" ] && . "$VERIFY_ENV"
export ZAPO_REST_PORT=$PORT
export ZAPO_REST_TOKEN=$TOKEN
export ZAPO_DB="$DB"
export ZAPO_SESSION=verify
export ZAPO_AUTOCONNECT=${ZAPO_AUTOCONNECT:-1}
export USERPROFILE='C:\Users\vinicius'

H="-H x-api-key:$TOKEN"
B="http://127.0.0.1:$PORT"

mkdir -p "$RUN"
rm -f "$RUN"/verify.sqlite*
cd "$RUN" || exit 1

boot () {
  "$EXE" > "$RUN/$1.log" 2>&1 &
  echo $!
}
waitup () {
  i=0
  while [ $i -lt 120 ]; do
    if curl -s -m 1 $H "$B/health" > /dev/null 2>&1; then return 0; fi
    i=$((i+1))
  done
  return 1
}

echo "=============== RUN 1 (fresh store) ==============="
PID1=$(boot run1)
if ! waitup; then echo "SERVER DID NOT COME UP"; cat "$RUN/run1.log"; kill $PID1 2>/dev/null; exit 1; fi
echo "--- server is up, pid $PID1 ---"

echo; echo "### GET /health"
curl -s $H "$B/health"
echo; echo "### GET /health WITHOUT the key (must be 401)"
curl -s -o /dev/null -w 'status=%{http_code}\n' "$B/health"
echo "### GET /nosuchroute (must be 404)"
curl -s -o /dev/null -w 'status=%{http_code}\n' $H "$B/nosuchroute"
echo "### GET /state"
curl -s $H "$B/state"
echo; echo "### GET /qr (text)"
curl -s $H "$B/qr" | head -c 400
echo; echo "### GET /store/tables"
curl -s $H "$B/store/tables"
echo; echo "### GET /store/counts"
curl -s $H "$B/store/counts"
echo; echo "### GET /store/threads?limit=5"
curl -s $H "$B/store/threads?limit=5"
echo; echo "### GET /store/contacts?limit=5"
curl -s $H "$B/store/contacts?limit=5"
echo; echo "### a route that needs a live connection (expect 500 or 501, never a crash)"
curl -s $H "$B/group/queryAllGroups" | head -c 300
echo; echo "### a required-parameter miss (expect 400)"
curl -s -o /dev/null -w 'status=%{http_code}\n' $H "$B/group/queryGroupMetadata"
echo "### bad JSON body (expect 400)"
curl -s -o /dev/null -w 'status=%{http_code}\n' -X POST $H -d 'not json' "$B/message/sendText"

echo; echo "### POST /message/send with a content OBJECT (the SC2003 route: must NOT be 501)"
curl -s -X POST $H -H content-type:application/json -d '{"to":"5511999999999","content":{"type":"text","text":"hello"}}' "$B/message/send" | head -c 300
echo; echo "### the same with an unknown content type (expect 500 whose detail names the set -- the /message/sendMedia convention)"
curl -s -o /dev/null -w 'status=%{http_code}\n' -X POST $H -H content-type:application/json -d '{"to":"x","content":{"type":"nope"}}' "$B/message/send"
echo "### GET /message/downloadBytes without seq (expect 400)"
curl -s -o /dev/null -w 'status=%{http_code}\n' $H "$B/message/downloadBytes"
echo "### GET /message/downloadBytes with an unknown seq (expect 500 naming the buffer, never 501)"
curl -s $H "$B/message/downloadBytes?seq=99999" | head -c 260
echo; echo "### GET /messages?since=0"
curl -s $H "$B/messages?since=0&limit=3" | head -c 200
echo; echo "### row counts BEFORE restart"
curl -s $H "$B/store/counts" > "$RUN/counts-before.json"
cat "$RUN/counts-before.json"

echo; echo "--- killing $PID1 and WAITING for it to actually die ---"
# NOTE: $! under Git Bash is the MSYS pid, NOT the Windows pid, so
# `taskkill /PID $!` silently matches nothing -- which is exactly how the
# first run of this script produced a bogus "identical row counts" result.
# Kill by IMAGE NAME, which is unambiguous here (one binary under test).
taskkill //F //IM "$IMG" > /dev/null 2>&1
# The previous revision of this script trusted taskkill and started run 2
# immediately. run 1 was still listening, run 2 died with EADDRINUSE, and the
# "after restart" counts were served by the SAME process that produced the
# "before" counts -- a persistence proof that proved nothing. So: poll until
# the port is genuinely refused AND no zapo-rest image is left running.
dead=no
i=0
while [ $i -lt 60 ]; do
  if ! curl -s -m 1 $H "$B/health" > /dev/null 2>&1; then dead=yes; break; fi
  i=$((i+1))
done
left=$(tasklist //FI "IMAGENAME eq $IMG" //NH 2>/dev/null | grep -c -F "$IMG")
echo "port refuses connections: $dead   $IMG images still running: $left"
if [ "$dead" != yes ]; then echo "ABORT: run 1 is still serving; the restart test would be a lie"; exit 1; fi
if [ "$left" != "0" ]; then
  echo "a $IMG image is still up; killing by image name"
  taskkill //F //IM "$IMG" > /dev/null 2>&1
fi
ls -la "$RUN"/verify.sqlite* 2>/dev/null

echo; echo "=============== RUN 2 (same store file) ==============="
PID2=$(boot run2)
if ! waitup; then echo "SERVER DID NOT COME BACK"; cat "$RUN/run2.log"; kill $PID2 2>/dev/null; exit 1; fi
if grep -q EADDRINUSE "$RUN/run2.log" 2>/dev/null; then
  echo "ABORT: run 2 could not bind (EADDRINUSE) -- whatever answered is run 1"; cat "$RUN/run2.log"; exit 1
fi
echo "--- server is back up, pid $PID2 ---"
echo "### row counts AFTER restart"
curl -s $H "$B/store/counts" > "$RUN/counts-after.json"
cat "$RUN/counts-after.json"
echo; echo "### /health after restart"
curl -s $H "$B/health"
echo
taskkill //F //IM "$IMG" > /dev/null 2>&1

echo; echo "=============== DIFF ==============="
if diff "$RUN/counts-before.json" "$RUN/counts-after.json" > /dev/null; then
  echo "row counts IDENTICAL across the restart"
else
  echo "row counts CHANGED across the restart:"
  diff "$RUN/counts-before.json" "$RUN/counts-after.json"
fi
echo; echo "=============== run1 log ==============="
head -30 "$RUN/run1.log"
echo "=============== run2 log ==============="
head -20 "$RUN/run2.log"
