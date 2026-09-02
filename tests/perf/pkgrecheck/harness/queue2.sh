#!/bin/bash
L=/g/blocks/pkgrecheck-lab
bash $L/bo.sh drivers/voip-stun.ts  voip-stun  --provenance-sources
bash $L/bo.sh drivers/voip-ssrc.ts  voip-ssrc  --provenance-sources
bash $L/bo.sh drivers/store-sqlite-names.ts store-sqlite-names-be --best-effort
bash $L/bo.sh drivers/wam-wire-probe2.ts wam-wire-probe2 --provenance-sources --npm-static '@vinikjkkj/wa-wam'
echo QUEUE2_DONE
