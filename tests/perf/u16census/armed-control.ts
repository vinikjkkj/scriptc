// THE ARMED CONTROL for scr_u16_census.h. Run this BEFORE reading any
// census, and never after.
//
// It exists because the census answered ZERO on zapo -- a whole 46-second
// paired session, 76 stanzas, twelve messages -- and zero was wrong. The
// build had been driven by the BASE worktree's CLI, whose runtime carries no
// hook, so `SCR_U16CEN_ON` was undefined in scr_string.c while every other
// translation unit still compiled the header, wrote its report file, and
// printed a perfectly well-formed table of nothing. The image even grew by
// 32 KB. An instrument that is IN the binary is not an instrument that is
// ARMED, and the two are indistinguishable from the report.
//
// This program calls `.length` a known number of times. Build it with the
// same compiler, the same flags and the same environment as the subject, run
// it, and require a NON-ZERO count of CTL_N + 1. A zero here means the
// census is broken; only then does a zero on the subject mean the subject.
//
// FOLD RESISTANCE, for runtime.bench.ts's reason. The first version of this
// file used only compile-time constants and the whole loop folded away, so
// it too reported zero -- the same clean null, from a third cause. Every
// term below comes from the environment at run time and the accumulator is
// printed, so nothing here is knowable at compile time.
//
//   SCRIPTC_PROF_CFLAGS="-include <win>/tests/perf/u16census/scr_u16_census.h
//                        -I<win>/tests/perf/u16census"
//   SCRIPTC_NO_CACHE=1
//   CTL_N=1000 CTL_TAG=jid SCR_U16CEN_OUT=<file> ./armed-control.exe
//
// Measured 2026-08-25: 1,001 calls with the branch CLI, 0 with the base
// CLI, same flags, same program, same shell.
const raw = process.env.CTL_N;
const N = raw === undefined ? 7 : Number.parseInt(raw, 10);
const tagRaw = process.env.CTL_TAG;
const tag = tagRaw === undefined ? "x" : tagRaw;

let n = 0;
const seed: string[] = [];
for (let i = 0; i < 32; i++) seed.push(tag + i + "@s.whatsapp.net");
for (let i = 0; i < N; i++) n += seed[i & 31].length;
console.log("armed-control", n, "expect", N + 1, "calls in the census");
