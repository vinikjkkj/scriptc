#!/bin/bash
L=/g/blocks/pkgrecheck-lab
bash $L/bo.sh drivers/drv-pg-cleanup2.ts   store-postgres-cleanup2 --provenance-sources
bash $L/bo.sh drivers/drv-redis-helpers.ts store-redis-helpers     --provenance-sources
bash $L/bo.sh drivers/drv-mysql-helpers2.ts store-mysql-helpers2   --provenance-sources
bash $L/bo.sh drivers/drv-pg-helpers2.ts   store-postgres-helpers2 --provenance-sources
echo QUEUE1_DONE
