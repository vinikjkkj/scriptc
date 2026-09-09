@echo off
REM ===========================================================================
REM  zapo-rest 1.8.2 NO-BUFFER  --  runs on port 8789, beside 8787 and 8788.
REM ===========================================================================
REM
REM  READ THIS FIRST: THIS BUILD KEEPS NO EVENT HISTORY.
REM
REM  It is the same program and the same source as zapo-rest-182.exe with one
REM  thing removed: the per-session event ring. An event is delivered to
REM  whatever WebSocket subscribers are connected AT THAT MOMENT and is then
REM  gone. There is no replay.
REM
REM    * You must SUBSCRIBE BEFORE the traffic you care about. A client that
REM      connects one second late has missed that second, permanently.
REM    * GET /s/<id>/events and GET /s/<id>/messages answer 410 Gone. They do
REM      NOT answer an empty list -- an empty list would be indistinguishable
REM      from "nothing has happened yet", and a caller has to be able to tell
REM      those apart.
REM    * ?since=<seq> on the websocket no longer replays. It returns a $gap
REM      frame naming exactly the sequence numbers you will never see.
REM
REM  If you poll /events today, this build will break that code on purpose.
REM  zapo-rest-182.exe on port 8788 still has the ring and still replays.
REM
REM  ---------------------------------------------------------------------
REM  THE STORE IS A SEPARATE FILE ON PURPOSE.
REM
REM  This binary carries @zapo-js/store-sqlite 1.2.0, which has FOUR migrations
REM  the 1.0.2 binaries do not: 0017/0018/0020 each add one nullable column,
REM  and 0019 creates chat_metadata_cache. They are applied the first time this
REM  .exe opens a database file, and they are ONE-WAY -- there is no down
REM  migration. They ARE strictly additive, so the existing zapo-rest*.exe keep
REM  working on a migrated file; the risk is not corruption, it is that you
REM  cannot go back.
REM
REM  So ZAPO_DB below points at zapo-state-182-nobuf.sqlite -- its OWN file,
REM  not your live zapo-state.sqlite and not the 8788 build's
REM  zapo-state-182.sqlite. Out of the box this starts an EMPTY session and
REM  asks you to scan a QR; your live store is not touched or migrated at all.
REM
REM  To try it against your EXISTING paired session, copy the live files first
REM  (all three, while the live service is stopped):
REM
REM      copy zapo-state.sqlite      zapo-state-182-nobuf.sqlite
REM      copy zapo-state.sqlite-wal  zapo-state-182-nobuf.sqlite-wal
REM      copy zapo-state.sqlite-shm  zapo-state-182-nobuf.sqlite-shm
REM
REM  The copy gets migrated on first open; the original stays as it is.
REM  Only point ZAPO_DB at the live file once you have decided the one-way
REM  migration is what you want.
REM
REM  Other knobs:
REM    ZAPO_REST_TOKEN : set a secret and every request must send x-api-key: <secret>
REM    ZAPO_REST_PORT  : 8789 here so it collides with neither 8787 nor 8788
REM    ZAPO_MSG_KEEP   : how many INCOMING messages stay readable by
REM                      /message/downloadBytes (default 1000). This is NOT the
REM                      event ring -- that is gone and has no knob. Set it to 0
REM                      if you never download media and want the memory back.
REM ===========================================================================

set ZAPO_REST_HOST=127.0.0.1
set ZAPO_REST_PORT=8789
set ZAPO_DB=%~dp0zapo-state-182-nobuf.sqlite
set ZAPO_SESSION=default

"%~dp0zapo-rest-182-nobuf.exe"
