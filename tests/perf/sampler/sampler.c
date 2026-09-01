/*
 * sampler.c - per-function CPU for the SHIPPING binary, by sampling.
 *
 * The instrumentation route is closed for a program this size, and all
 * three walls are properties of that ONE route: every TU that gets
 * -include scr_prof.h defines __cyg_profile_func_enter, which must carry an
 * external name, so lld-link rejects the duplicate weak symbol; zig cc
 * refuses --allow-multiple-definition; and selectany applies only to data.
 * scr_prof.h predicts the first of those itself.
 *
 * Sampling needs none of it: no recompile, no link-time hooks, and the
 * binary under measurement is the one that SHIPS rather than a different
 * program built with instrumentation. It also sees time the user-space
 * hooks never could -- a sample landing in kernel mode still attributes to
 * the thread that is there.
 *
 * Leaf RIP only, deliberately. That is SELF time per function, which is what
 * "where does the CPU go" means. A full StackWalk64 would add inclusive cost
 * and a great deal more that can go wrong.
 *
 *   sampler.exe [--hz N] [--top N] -- <cmd> [args...]
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <windows.h>
#include <tlhelp32.h>
#include <dbghelp.h>
#include <psapi.h>

#define MAXHITS 4000000
static DWORD64 *hits;
static long nhits;
/* The program image's address range. A thread inside a syscall parks its
 * user-mode RIP on an ntdll stub, so a leaf-only profile attributes
 * everything to ntdll and names nothing. Walking up to the first frame
 * INSIDE this range charges the syscall to the program function that made
 * it, which is the question. */
static DWORD64 imgLo, imgHi;
static HANDLE gProc;

/* Idle threads dominate a naive sample: a first cut put 99% of hits in
 * ntdll, which is every parked thread sitting in NtWaitForSingleObject.
 * Gate on the thread's own cycle counter so only threads that actually
 * BURNED CPU since the last round are sampled -- that turns the profile
 * from "where are the threads" into "where does the CPU go". */
#define MAXTH 512
static DWORD thId[MAXTH];
static ULONG64 thCyc[MAXTH];
static int nth;

static ULONG64 *cycSlot(DWORD id) {
  for (int i = 0; i < nth; i++) if (thId[i] == id) return &thCyc[i];
  if (nth >= MAXTH) return NULL;
  thId[nth] = id; thCyc[nth] = 0;
  return &thCyc[nth++];
}

static void sample_once(DWORD pid) {
  HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
  if (snap == INVALID_HANDLE_VALUE) return;
  THREADENTRY32 te;
  te.dwSize = sizeof te;
  if (Thread32First(snap, &te)) {
    do {
      if (te.th32OwnerProcessID != pid) continue;
      HANDLE th = OpenThread(THREAD_SUSPEND_RESUME | THREAD_GET_CONTEXT | THREAD_QUERY_INFORMATION,
                             FALSE, te.th32ThreadID);
      if (th == NULL) continue;
      ULONG64 cyc = 0;
      int busy = 1;
      if (QueryThreadCycleTime(th, &cyc)) {
        ULONG64 *slot = cycSlot(te.th32ThreadID);
        if (slot != NULL) {
          busy = (*slot != 0 && cyc > *slot);
          *slot = cyc;
        }
      }
      if (!busy) { CloseHandle(th); continue; }
      if (SuspendThread(th) != (DWORD)-1) {
        CONTEXT ctx;
        memset(&ctx, 0, sizeof ctx);
        ctx.ContextFlags = CONTEXT_FULL;
        if (GetThreadContext(th, &ctx) && nhits < MAXHITS) {
          DWORD64 pick = ctx.Rip;
          if (!(pick >= imgLo && pick < imgHi)) {
            STACKFRAME64 fr;
            memset(&fr, 0, sizeof fr);
            fr.AddrPC.Offset = ctx.Rip;    fr.AddrPC.Mode = AddrModeFlat;
            fr.AddrFrame.Offset = ctx.Rbp; fr.AddrFrame.Mode = AddrModeFlat;
            fr.AddrStack.Offset = ctx.Rsp; fr.AddrStack.Mode = AddrModeFlat;
            for (int d = 0; d < 40; d++) {
              if (!StackWalk64(IMAGE_FILE_MACHINE_AMD64, gProc, th, &fr, &ctx, NULL,
                               SymFunctionTableAccess64, SymGetModuleBase64, NULL)) break;
              if (fr.AddrPC.Offset == 0) break;
              if (fr.AddrPC.Offset >= imgLo && fr.AddrPC.Offset < imgHi) { pick = fr.AddrPC.Offset; break; }
            }
          }
          hits[nhits++] = pick;
        }
        ResumeThread(th);
      }
      CloseHandle(th);
    } while (Thread32Next(snap, &te));
  }
  CloseHandle(snap);
}

typedef struct { char name[240]; long n; } Row;

static int cmprow(const void *a, const void *b) {
  long x = ((const Row *)a)->n, y = ((const Row *)b)->n;
  return x < y ? 1 : (x > y ? -1 : 0);
}

int main(int argc, char **argv) {
  int hz = 1000, top = 40, i = 1;
  for (; i < argc; i++) {
    if (strcmp(argv[i], "--") == 0) { i++; break; }
    if (strcmp(argv[i], "--hz") == 0 && i + 1 < argc) hz = atoi(argv[++i]);
    else if (strcmp(argv[i], "--top") == 0 && i + 1 < argc) top = atoi(argv[++i]);
  }
  if (i >= argc) { fprintf(stderr, "usage: sampler.exe [--hz N] [--top N] -- <cmd> [args...]\n"); return 2; }
  hits = (DWORD64 *)malloc(sizeof(DWORD64) * MAXHITS);
  if (hits == NULL) return 2;

  size_t need = 1;
  for (int j = i; j < argc; j++) need += strlen(argv[j]) + 3;
  char *cmd = (char *)calloc(need, 1);
  for (int j = i; j < argc; j++) {
    if (j > i) strcat(cmd, " ");
    int q = (strchr(argv[j], ' ') != NULL);
    if (q) strcat(cmd, "\"");
    strcat(cmd, argv[j]);
    if (q) strcat(cmd, "\"");
  }
  STARTUPINFOA si; memset(&si, 0, sizeof si); si.cb = sizeof si;
  PROCESS_INFORMATION pi;
  if (!CreateProcessA(NULL, cmd, NULL, NULL, TRUE, 0, NULL, NULL, &si, &pi)) {
    fprintf(stderr, "sampler: CreateProcess failed (%lu)\n", (unsigned long)GetLastError());
    return 2;
  }
  gProc = pi.hProcess;
  /* Symbols must be up BEFORE walking: StackWalk64 needs the unwind data
   * DbgHelp serves through SymFunctionTableAccess64. The PE carries .pdata,
   * so unwinding works even when no PDB is present -- only the NAMES need
   * one. */
  SymSetOptions(SYMOPT_UNDNAME | SYMOPT_DEFERRED_LOADS);
  if (!SymInitialize(pi.hProcess, NULL, TRUE)) {
    fprintf(stderr, "sampler: SymInitialize failed (%lu)\n", (unsigned long)GetLastError());
  }
  {
    HMODULE mods[256];
    DWORD needed = 0;
    for (int tries = 0; tries < 200 && imgHi == 0; tries++) {
      if (EnumProcessModules(pi.hProcess, mods, sizeof mods, &needed) && needed >= sizeof(HMODULE)) {
        MODULEINFO mi;
        if (GetModuleInformation(pi.hProcess, mods[0], &mi, sizeof mi)) {
          imgLo = (DWORD64)(ULONG_PTR)mi.lpBaseOfDll;
          imgHi = imgLo + mi.SizeOfImage;
        }
      }
      if (imgHi == 0) Sleep(5);
    }
    fprintf(stderr, "sampler: image range 0x%llx-0x%llx\n",
            (unsigned long long)imgLo, (unsigned long long)imgHi);
  }
  DWORD periodMs = hz > 0 ? (DWORD)(1000 / hz) : 1;
  if (periodMs < 1) periodMs = 1;
  for (;;) {
    if (WaitForSingleObject(pi.hProcess, periodMs) == WAIT_OBJECT_0) break;
    sample_once(pi.dwProcessId);
  }

  /* Symbolise AFTER the run: SymInitialize against a live target would
   * perturb the thing being measured. */
  SymSetOptions(SYMOPT_UNDNAME | SYMOPT_DEFERRED_LOADS);
  if (!SymInitialize(pi.hProcess, NULL, TRUE)) {
    fprintf(stderr, "sampler: SymInitialize failed (%lu); addresses only\n",
            (unsigned long)GetLastError());
  }
  long cap = 20000;
  Row *rows = (Row *)calloc((size_t)cap, sizeof(Row));
  long nrows = 0;
  for (long k = 0; k < nhits; k++) {
    char buf[sizeof(SYMBOL_INFO) + 512];
    SYMBOL_INFO *sym = (SYMBOL_INFO *)buf;
    memset(buf, 0, sizeof buf);
    sym->SizeOfStruct = sizeof(SYMBOL_INFO);
    sym->MaxNameLen = 500;
    DWORD64 disp = 0;
    char name[240];
    if (SymFromAddr(pi.hProcess, hits[k], &disp, sym)) {
      snprintf(name, sizeof name, "%s", sym->Name);
    } else {
      snprintf(name, sizeof name, "<unresolved 0x%llx>", (unsigned long long)hits[k]);
    }
    long f = -1;
    for (long r = 0; r < nrows; r++) if (strcmp(rows[r].name, name) == 0) { f = r; break; }
    if (f < 0) { if (nrows >= cap) continue; f = nrows++; snprintf(rows[f].name, sizeof rows[f].name, "%s", name); }
    rows[f].n++;
  }
  qsort(rows, (size_t)nrows, sizeof(Row), cmprow);
  fprintf(stderr, "\n[sampler] %ld samples, %ld distinct symbols\n", nhits, nrows);
  fprintf(stderr, "[sampler] %8s %9s  %s\n", "self%", "samples", "function");
  for (long r = 0; r < nrows && r < top; r++) {
    fprintf(stderr, "[sampler] %7.2f%% %9ld  %s\n",
            nhits ? (double)rows[r].n * 100.0 / (double)nhits : 0.0, rows[r].n, rows[r].name);
  }
  DWORD code = 0; GetExitCodeProcess(pi.hProcess, &code);
  return (int)code;
}
