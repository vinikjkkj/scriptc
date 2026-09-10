@echo off
REM ===========================================================================
REM  zapo-rest 1.8.2, memory build  --  port 8791, beside everything else.
REM ===========================================================================
REM
REM  SAME PROGRAM as zapo-rest-183-llvm.exe. Same source, same zapo-js 1.8.2,
REM  same behaviour, same LLVM backend. The difference is in the runtime's
REM  allocators, and what it is worth is written up in README-184.md with the
REM  measurement floor beside every number.
REM
REM  THE STORE IS A SEPARATE FILE ON PURPOSE.
REM
REM  ZAPO_DB below points at zapo-state-184.sqlite, NOT at your live
REM  zapo-state.sqlite. Out of the box this starts an EMPTY session and asks
REM  you to scan a QR; your live store is not opened, not read and not
REM  migrated.
REM
REM  This binary carries @zapo-js/store-sqlite 1.2.0, whose migrations
REM  0017/0018/0019/0020 the 1.0.2 binaries do not have. They are applied the
REM  first time this .exe opens a database file and they are ONE-WAY. They are
REM  strictly additive, so the older zapo-rest*.exe keep working on a migrated
REM  file; the risk is not corruption, it is that you cannot go back.
REM
REM  To try it against your EXISTING paired session, copy all three files
REM  first, with the live service stopped:
REM
REM      copy zapo-state.sqlite      zapo-state-184.sqlite
REM      copy zapo-state.sqlite-wal  zapo-state-184.sqlite-wal
REM      copy zapo-state.sqlite-shm  zapo-state-184.sqlite-shm
REM
REM  Other knobs:
REM    ZAPO_REST_TOKEN : set a secret and every request must send x-api-key
REM    ZAPO_REST_PORT  : 8791 here, so it collides with none of 8787, 8788
REM                      (zapo-rest-182), 8789 (no-buffer) or 8790 (183-llvm)
REM ===========================================================================

set ZAPO_REST_HOST=127.0.0.1
set ZAPO_REST_PORT=8791
set ZAPO_DB=%~dp0zapo-state-184.sqlite
set ZAPO_SESSION=default

"%~dp0zapo-rest-184.exe"
