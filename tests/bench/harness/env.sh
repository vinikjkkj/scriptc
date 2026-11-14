# env.sh: sourced by every bench script. BENCH_WORK is the scratch root (default ./.bench-work); the zapo tree and its node_modules live under $BENCH_WORK/app.
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
export BENCH_DIR=$(cd "$HERE/.." && pwd)
export BENCH_ROOT=$(cd "$BENCH_DIR/../.." && pwd)   # repo root
export BENCH_WORK=${BENCH_WORK:-$PWD/.bench-work}
export BENCH_NODE=${BENCH_NODE:-node}
export BENCH_NODE_IMPORT=tsx
export ZB_APP=$BENCH_WORK/app
export TREE=$ZB_APP/tree
# service endpoints (CI service containers: standard ports; the box overrides these)
export ZAPO_TEST_MYSQL_HOST=${ZAPO_TEST_MYSQL_HOST:-127.0.0.1} ZAPO_TEST_MYSQL_PORT=${ZAPO_TEST_MYSQL_PORT:-3306} ZAPO_TEST_MYSQL_USER=${ZAPO_TEST_MYSQL_USER:-root} ZAPO_TEST_MYSQL_PASSWORD=${ZAPO_TEST_MYSQL_PASSWORD-} ZAPO_TEST_MYSQL_DATABASE=${ZAPO_TEST_MYSQL_DATABASE:-zapo_test}
export ZAPO_TEST_PG_HOST=${ZAPO_TEST_PG_HOST:-127.0.0.1} ZAPO_TEST_PG_PORT=${ZAPO_TEST_PG_PORT:-5432} ZAPO_TEST_PG_USER=${ZAPO_TEST_PG_USER:-postgres} ZAPO_TEST_PG_PASSWORD=${ZAPO_TEST_PG_PASSWORD:-x} ZAPO_TEST_PG_DATABASE=${ZAPO_TEST_PG_DATABASE:-zapo_test}
export ZAPO_TEST_REDIS_HOST=${ZAPO_TEST_REDIS_HOST:-127.0.0.1} ZAPO_TEST_REDIS_PORT=${ZAPO_TEST_REDIS_PORT:-6379}
