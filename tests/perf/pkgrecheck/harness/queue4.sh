#!/bin/bash
L=/g/blocks/pkgrecheck-lab
bash $L/bo.sh drivers/voip-callstate.ts voip-callstate
bash $L/bo.sh drivers/store-sqlite-open.ts store-sqlite-open --provenance-sources --best-effort
echo QUEUE4_DONE
