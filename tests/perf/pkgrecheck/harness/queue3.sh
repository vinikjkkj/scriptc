#!/bin/bash
L=/g/blocks/pkgrecheck-lab
bash $L/bo.sh drivers/voip-errsub.ts voip-errsub
bash $L/bo.sh drivers/voip-srtp.ts   voip-srtp --provenance-sources
echo QUEUE3_DONE
