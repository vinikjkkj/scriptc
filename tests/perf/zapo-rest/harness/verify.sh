#!/bin/sh
# Verification run for the compiled zapo-rest binary.
#   1. start it on a fresh SQLite file
#   2. prove it serves the API (health, routes, store reads, auth gate, 404)
#   3. kill it, restart it on the SAME file, and show the store came back
set -u
EXE=/g/blocks/restapi/out/zapo-rest.exe
RUN=/g/blocks/restapi/lab/run
PORT=18899
TOKEN=verify-secret
DB="$RUN/verify.sqlite"

. /g/blocks/restapi/env.sh
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

echo; echo "### row counts BEFORE restart"
curl -s $H "$B/store/counts" > "$RUN/counts-before.json"
cat "$RUN/counts-before.json"

echo; echo "--- killing $PID1 ---"
taskkill //F //T //PID $PID1 > /dev/null 2>&1
sleep 2 2>/dev/null || true
ls -la "$RUN"/verify.sqlite* 2>/dev/null

echo; echo "=============== RUN 2 (same store file) ==============="
PID2=$(boot run2)
if ! waitup; then echo "SERVER DID NOT COME BACK"; cat "$RUN/run2.log"; kill $PID2 2>/dev/null; exit 1; fi
echo "--- server is back up, pid $PID2 ---"
echo "### row counts AFTER restart"
curl -s $H "$B/store/counts" > "$RUN/counts-after.json"
cat "$RUN/counts-after.json"
echo; echo "### /health after restart"
curl -s $H "$B/health"
echo
taskkill //F //T //PID $PID2 > /dev/null 2>&1

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
