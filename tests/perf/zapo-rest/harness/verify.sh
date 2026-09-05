#!/bin/sh
# Verification run for the compiled zapo-rest binary.
#   1. start it on a fresh SQLite file
#   2. prove it serves the API (health, routes, store reads, auth gate, 404)
#   3. prove N SESSIONS IN ONE FILE DO NOT SEE EACH OTHER
#   4. kill it, restart it on the SAME file, and show every session came back
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
HARNESS=$(cd "$(dirname "$0")" && pwd)
# ZAPO_REST_APP is where isolation.mjs finds better-sqlite3 for its OWN,
# second connection to the file. It never speaks to the HTTP API.
export ZAPO_REST_APP=${ZAPO_REST_APP:-$HARNESS/../app}

[ -n "${VERIFY_ENV:-}" ] && . "$VERIFY_ENV"
export ZAPO_REST_PORT=$PORT
export ZAPO_REST_TOKEN=$TOKEN
export ZAPO_DB="$DB"
export ZAPO_SESSION=verify
# AUTOCONNECT DEFAULTS OFF HERE, and that is deliberate. `connect()` creates
# and PERSISTS credentials for every session it starts, so with it on the row
# counts move underneath the restart diff for reasons that have nothing to do
# with persistence. Set ZAPO_AUTOCONNECT=1 to watch real connect attempts.
export ZAPO_AUTOCONNECT=${ZAPO_AUTOCONNECT:-0}
export USERPROFILE='C:\Users\vinicius'

H="-H x-api-key:$TOKEN"
B="http://127.0.0.1:$PORT"
A=alpha
BB=beta
G=ghost
FAILS=0

mkdir -p "$RUN"
rm -f "$RUN"/verify.sqlite*
cd "$RUN" || exit 1

if [ ! -d "$ZAPO_REST_APP/node_modules/better-sqlite3" ]; then
  echo "ABORT: no better-sqlite3 under $ZAPO_REST_APP/node_modules --"
  echo "       the isolation probe reads the database directly and cannot run without it."
  echo "       (run 'npm install' in the app directory, or point ZAPO_REST_APP at one that has it)"
  exit 2
fi

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

# ---------------------------------------------------------------------------
# Assertion helpers. Each one PRINTS THE NUMBER IT EXPECTED, so a query that
# quietly matched nothing fails loudly instead of reporting a clean zero.
# ---------------------------------------------------------------------------
EVAL='let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let v;try{const j=JSON.parse(s);v=(new Function("r","j","return ("+process.argv[1]+")"))(j.result,j);}catch(e){v="ERR:"+e.message}process.stdout.write(String(v));});'

ck () { # label, path, expression over r (= .result), expected
  got=$(curl -s $H "$B$2" | node -e "$EVAL" "$3")
  if [ "$got" = "$4" ]; then
    echo "  PASS  $1 = $got"
  else
    echo "  FAIL  $1: got '$got', expected '$4'"
    FAILS=$((FAILS+1))
  fi
}
ckp () { # label, path, expression, expected -- same, but POST
  got=$(curl -s -X POST $H "$B$2" | node -e "$EVAL" "$3")
  if [ "$got" = "$4" ]; then
    echo "  PASS  $1 = $got"
  else
    echo "  FAIL  $1: got '$got', expected '$4'"
    FAILS=$((FAILS+1))
  fi
}
cks () { # label, path, expected status
  got=$(curl -s -o /dev/null -w '%{http_code}' $H "$B$2")
  if [ "$got" = "$3" ]; then
    echo "  PASS  $1 -> $got"
  else
    echo "  FAIL  $1: status $got, expected $3"
    FAILS=$((FAILS+1))
  fi
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

echo; echo
echo "=============== MULTI-SESSION ==============="
echo "### GET /sessions on a fresh file (only the default, '$ZAPO_SESSION')"
curl -s $H "$B/sessions"
echo
ck "session count" "/sessions" "r.sessions.length" "1"
ck "default session id" "/sessions" "r.sessions[0].id" "$ZAPO_SESSION"

echo; echo "### GET /sessions/connection -- ONE connection, with a negative control"
curl -s $H "$B/sessions/connection"
echo
ck "stores' own options see the TEMP row" "/sessions/connection" "r.storeOptionsHandle.seesTheTempRow" "true"
ck "different-pragma control does NOT"    "/sessions/connection" "r.differentPragmaControl.seesTheTempRow" "false"
ck "verdict"                              "/sessions/connection" "r.verdict.slice(0,3)" "ONE"

echo; echo "### POST /sessions/create for $A and $BB"
curl -s -X POST $H "$B/sessions/create?id=$A&autoconnect=0"; echo
curl -s -X POST $H "$B/sessions/create?id=$BB&autoconnect=0"; echo
ck "session count after two creates" "/sessions" "r.sessions.length" "3"
ck "$A is live"                      "/sessions" "r.sessions.filter(s=>s.id==='$A')[0].live" "true"

echo; echo "### malformed and missing identifiers"
cks "GET /s/nope/health (unknown session)"        "/s/nope/health"            404
cks "GET /s/bad%20id/health (space in the id)"    "/s/bad%20id/health"        400
cks "GET /s//health (empty id)"                   "/s//health"                400
ID64=$(node -e 'process.stdout.write("x".repeat(64))')
ID65=$(node -e 'process.stdout.write("x".repeat(65))')
cks "GET /s/<64 chars>/health (the longest legal id)" "/s/$ID64/health"  404
cks "GET /s/<65 chars>/health (one over the limit)"   "/s/$ID65/health"  400
echo "### POST /sessions/remove?id=nope (unknown, must be 404)"
curl -s -o /dev/null -w '  status=%{http_code} (expected 404)\n' -X POST $H "$B/sessions/remove?id=nope"
echo "### POST /sessions/create?id=  (empty, must be 400)"
curl -s -o /dev/null -w '  status=%{http_code} (expected 400)\n' -X POST $H "$B/sessions/create?id="

echo; echo "### a real zapo WRITE on ONE session only: $A gets credentials, $BB does not"
curl -s -X POST $H "$B/s/$A/auth/loadOrCreateCredentials"; echo
echo "  rows for $A and $BB, straight from the database:"
node "$HARNESS/isolation.mjs" counts "$DB" "$A" "$BB" "$ZAPO_SESSION" 2>&1 | sed 's/^/  /'

echo; echo "### warm the mailbox domain -- store-sqlite migrations are LAZY and PER-DOMAIN,"
echo "###   so mailbox_threads does not exist until a mailbox read happens"
curl -s $H "$B/s/$A/store/threads?limit=1" > /dev/null
curl -s $H "$B/s/$BB/store/threads?limit=1" > /dev/null
echo "### plant asymmetric mailbox rows for $A, $BB and a THIRD id ($G) with no client"
node "$HARNESS/isolation.mjs" plant "$DB" "$A" "$BB" "$G" || FAILS=$((FAILS+1))

echo; echo "### the per-session row table, read straight from the file (NOT through the API)"
node "$HARNESS/isolation.mjs" counts "$DB" "$A" "$BB" "$G" "$ZAPO_SESSION"
echo
node "$HARNESS/isolation.mjs" check "$DB" "$A" "$BB" "$G" || FAILS=$((FAILS+1))

echo; echo "### and now the SAME numbers through the API, one session at a time"
ck "$A  /store/threads"  "/s/$A/store/threads?limit=100"  "r.length" "3"
ck "$BB /store/threads"  "/s/$BB/store/threads?limit=100" "r.length" "1"
ck "$A  /store/contacts" "/s/$A/store/contacts?limit=100" "r.length" "2"
ck "$BB /store/contacts" "/s/$BB/store/contacts?limit=100" "r.length" "4"
ck "$A  /store/messages in ITS OWN thread"        "/s/$A/store/messages?thread=A0@s.whatsapp.net&limit=100"  "r.length" "5"
ck "$BB /store/messages in ALPHA's thread jid"    "/s/$BB/store/messages?thread=A0@s.whatsapp.net&limit=100" "r.length" "0"
ck "$BB /store/messages in ITS OWN thread"        "/s/$BB/store/messages?thread=B0@s.whatsapp.net&limit=100" "r.length" "2"
ck "$A  /store/thread by ALPHA's jid"             "/s/$A/store/thread?jid=A0@s.whatsapp.net"  "r===null?'null':r.jid" "A0@s.whatsapp.net"
ck "$BB /store/thread by ALPHA's jid (must miss)" "/s/$BB/store/thread?jid=A0@s.whatsapp.net" "r===null?'null':r.jid" "null"
ck "$A  /store/counts session vs total (threads)" "/s/$A/store/counts" "r.tables.mailbox_threads.session+'/'+r.tables.mailbox_threads.total" "3/11"
ck "$BB /store/counts session vs total (threads)" "/s/$BB/store/counts" "r.tables.mailbox_threads.session+'/'+r.tables.mailbox_threads.total" "1/11"
ck "$G is listed but not live"                    "/sessions" "r.sessions.filter(s=>s.id==='$G')[0].live" "false"
ck "/sessions/rows for $G"                        "/sessions/rows?id=$G" "r.rows.mailbox_threads" "7"

echo; echo "### $A addressed while $BB is mid-operation (a slow $BB call in flight)"
curl -s $H "$B/s/$BB/store/messages?thread=B0@s.whatsapp.net&limit=100" > "$RUN/beta-inflight.json" &
INFLIGHT=$!
ck "$A  /store/threads during a $BB call" "/s/$A/store/threads?limit=100" "r.length" "3"
ck "$A  /health during a $BB call"        "/s/$A/health" "r.store.sessionId" "$A"
wait $INFLIGHT 2>/dev/null
echo "  the in-flight $BB call returned $(node -e "$EVAL" 'r.length' < "$RUN/beta-inflight.json") message(s) (expected 2)"

echo; echo "### two sessions writing at once, on a SECOND connection (the harsher case)"
node "$HARNESS/isolation.mjs" hammer "$DB" "$A" "$BB" 250 || FAILS=$((FAILS+1))
ck "$A  threads after the hammer"  "/s/$A/store/threads?limit=1000"  "r.length" "253"
ck "$BB threads after the hammer"  "/s/$BB/store/threads?limit=1000" "r.length" "251"

echo; echo "### remove $A (NO purge) while $BB keeps working"
curl -s -X POST $H "$B/sessions/remove?id=$A"; echo
cks "GET /s/$A/health after removal"  "/s/$A/health"  404
ck  "$BB still serves"                "/s/$BB/store/threads?limit=1000" "r.length" "251"
ck  "$A is listed as known-not-live"  "/sessions" "r.sessions.filter(s=>s.id==='$A')[0].live" "false"
ck  "$A's rows are STILL in the file" "/sessions/rows?id=$A" "r.rows.mailbox_threads" "253"
echo "  and from the database directly:"
node "$HARNESS/isolation.mjs" counts "$DB" "$A" "$BB" "$G" | sed 's/^/  /'

echo; echo "### purge: create a throwaway, give it rows, remove it WITH purge=1"
curl -s -X POST $H "$B/sessions/create?id=temp1&autoconnect=0"; echo
curl -s -X POST $H "$B/s/temp1/auth/loadOrCreateCredentials" > /dev/null
ck "temp1 has credential rows before the purge" "/sessions/rows?id=temp1" "r.rows.auth_credentials" "1"
echo "  removing WITHOUT purge first, to show rows survive:"
curl -s -X POST $H "$B/sessions/remove?id=temp1" | head -c 400; echo
ck "temp1 rows survive a plain remove" "/sessions/rows?id=temp1" "r.rows.auth_credentials" "1"
echo "  now WITH purge=1:"
curl -s -X POST $H "$B/sessions/remove?id=temp1&purge=1" | head -c 600; echo
ck "temp1 credential rows are gone" "/sessions/rows?id=temp1" "r.rows.auth_credentials" "0"
ck "$BB is untouched by the purge"  "/sessions/rows?id=$BB" "r.rows.mailbox_threads" "251"

echo; echo "### row counts BEFORE restart"
curl -s $H "$B/store/counts" > "$RUN/counts-before.json"
cat "$RUN/counts-before.json"
node "$HARNESS/isolation.mjs" json "$DB" "$A" "$BB" "$G" "$ZAPO_SESSION" > "$RUN/rows-before.json"

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

echo "### every session comes back, still separate"
curl -s $H "$B/sessions" | head -c 1200
echo
# $A was REMOVED before the restart with its rows kept, so it comes back as a
# live session rediscovered from its rows -- that is the documented meaning of
# a plain remove.
ck "$A  is live again after the restart"  "/sessions" "r.sessions.filter(s=>s.id==='$A')[0].live" "true"
ck "$BB is live again after the restart"  "/sessions" "r.sessions.filter(s=>s.id==='$BB')[0].live" "true"
ck "$G  is rediscovered from its rows"    "/sessions" "r.sessions.filter(s=>s.id==='$G')[0].live" "true"
ck "temp1 is gone (purged)"               "/sessions" "r.sessions.filter(s=>s.id==='temp1').length" "0"
ck "$A  /store/threads after restart"     "/s/$A/store/threads?limit=1000"  "r.length" "253"
ck "$BB /store/threads after restart"     "/s/$BB/store/threads?limit=1000" "r.length" "251"
ck "$G  /store/threads after restart"     "/s/$G/store/threads?limit=1000"  "r.length" "7"
ck "$A  credentials survived"             "/s/$A/health" "r.store.hasCredentials" "true"
ck "$BB has NO credentials"               "/s/$BB/health" "r.store.hasCredentials" "false"
ck "one connection, still"                "/sessions/connection" "r.verdict.slice(0,3)" "ONE"

echo; echo "### row counts AFTER restart"
curl -s $H "$B/store/counts" > "$RUN/counts-after.json"
cat "$RUN/counts-after.json"
node "$HARNESS/isolation.mjs" json "$DB" "$A" "$BB" "$G" "$ZAPO_SESSION" > "$RUN/rows-after.json"
echo; echo "### /health after restart"
curl -s $H "$B/health"
echo
echo "### the per-session table after the restart"
node "$HARNESS/isolation.mjs" counts "$DB" "$A" "$BB" "$G" "$ZAPO_SESSION"
node "$HARNESS/isolation.mjs" check "$DB" "$A" "$BB" "$G" > /dev/null 2>&1
echo "(the planted-row assertions no longer hold: the hammer added 250 threads to each of $A and $BB)"
taskkill //F //IM "$IMG" > /dev/null 2>&1

echo; echo "=============== DIFF ==============="
if diff "$RUN/counts-before.json" "$RUN/counts-after.json" > /dev/null; then
  echo "/store/counts IDENTICAL across the restart"
else
  echo "/store/counts CHANGED across the restart:"
  diff "$RUN/counts-before.json" "$RUN/counts-after.json"
  FAILS=$((FAILS+1))
fi
if diff "$RUN/rows-before.json" "$RUN/rows-after.json" > /dev/null; then
  echo "per-session row counts read from the DATABASE are IDENTICAL across the restart"
else
  echo "per-session row counts CHANGED across the restart:"
  diff "$RUN/rows-before.json" "$RUN/rows-after.json"
  FAILS=$((FAILS+1))
fi

echo; echo "=============== run1 log ==============="
head -40 "$RUN/run1.log"
echo "=============== run2 log ==============="
head -30 "$RUN/run2.log"

echo
if [ "$FAILS" -eq 0 ]; then
  echo "=============== VERIFY: ALL ASSERTIONS PASSED ==============="
else
  echo "=============== VERIFY: $FAILS ASSERTION(S) FAILED ==============="
fi
exit $FAILS
