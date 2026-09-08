# env-build.sh — build lane (node v22.18.0). pnpm install/build MUST run here:
# v25's pnpm 10.6.4 and v22's corepack pnpm 11.20.0 disagree about the store
# layout and v25 aborts with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY.
. "$(dirname "${BASH_SOURCE[0]}")/env.sh" || return 1
export PATH="/c/nvm4w/nodejs:$PATH"
