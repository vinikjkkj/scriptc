/*
 * sampler.c - per-function CPU for the SHIPPING binary, by sampling,
 * scoped to the bench's own phase markers.
 *
 * Instrumentation is closed for a program this size, and all three walls
 * are properties of that ONE route: every TU that gets -include scr_prof.h
 * defines __cyg_profile_func_enter, which must carry an external name, so
 * lld-link rejects the duplicate weak symbol; zig cc refuses
 * --allow-multiple-definition; and selectany applies only to data.
 *
 * Sampling needs none of it. But a naive sampler is confidently WRONG here
 * in six ways, each found by measurement, each producing a clean table:
 *
 *  1. Idle threads outvote the work: a first cut put 99% of hits in ntdll
 *     wait stubs. Samples are gated on each thread's own cycle delta.
 *  2. A thread inside a syscall parks its USER rip on an ntdll stub, so it
 *     walks to the first frame inside the program.
 *  3. "Inside the program" must mean the EXECUTABLE sections, not the
 *     module: a module-wide test accepted an .rdata address as a frame and
 *     reported a confident 97% for a symbol that cannot execute.
 *  4. The PE has NO debug directory and NO DWARF, so DbgHelp can never
 *     symbolise the live process. The .pdb beside it is a valid MSF 7.00
 *     file, so symbols resolve OFFLINE: load the .pdb ITSELF as the module
 *     image at a synthetic base and map each sample by RVA.
 *  5. Picking the single busiest thread per round over-selects a thread
 *     that WAKES often over one that COMPUTES: a 1 kHz child-process pump
 *     took 93.81% that way, refuted because buildContacts measures 20.5%
 *     CPU while being 97% RPC wait. So every thread that burned cycles is
 *     sampled, and each sample is WEIGHTED by that thread's cycle delta.
 *
 *  6. The RVA is taken from the MODULE base, not from .text. Narrowing
 *     imgLo to the first executable section (lie 3) and then reusing it as
 *     the base for `symBase + (q - imgLo)` resolved every sample 0x1000
 *     bytes early, because .text sits at RVA 0x1000 on
 *     x86_64-windows-gnu. The tell was that three reported names --
 *     crypto_x25519_dirty_fast, g_rounds and scr_win_run_sync -- are
 *     UNREACHABLE in the program profiled, while fe_mul and fe_sq, which
 *     cannot fail to dominate an X25519 workload, were absent. Found by
 *     block/computecpu (e6cab267) with a 40-function control where exactly
 *     one function runs: the skewed build reported hot_15 73.18% and
 *     hot_14 26.82%, neither ever called; corrected, hot_20 100.00%.
 *     modBase is kept for this and imgLo stays narrowed for lie 3.
 *
 * Phase scoping closes the last gap: percentages are otherwise the whole
 * run's, not the phase's, and the run is dominated by one phase. cpuphase
 * already emits the markers; this reads the same ones.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <windows.h>
#include <tlhelp32.h>
#include <dbghelp.h>
#include <psapi.h>

#define MAXHITS 4000000
#define MAXPH 32
#define MAXTH 512

typedef struct { DWORD64 pc; ULONG64 w; int ph; int walked; } Hit;
static Hit *hits;
static volatile LONG nhits;
static DWORD64 imgLo, imgHi, modBase;
static HANDLE gProc;
static DWORD gPid;
static volatile LONG nWait;
static int progOnly;
static volatile LONG curPhase = -1;
static char phName[MAXPH][64];
static int nph;
static volatile LONG pollStop;
static DWORD periodMs = 1;
static DWORD thId[MAXTH];
static ULONG64 thCyc[MAXTH];
static int nth;

static ULONG64 *cycSlot(DWORD id) {
  for (int i = 0; i < nth; i++) if (thId[i] == id) return &thCyc[i];
  if (nth >= MAXTH) return NULL;
  thId[nth] = id; thCyc[nth] = 0;
  return &thCyc[nth++];
}

static void sample_once(void) {
  HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
  if (snap == INVALID_HANDLE_VALUE) return;
  THREADENTRY32 te;
  te.dwSize = sizeof te;
  int ph = (int)curPhase;
  if (Thread32First(snap, &te)) {
    do {
      if (te.th32OwnerProcessID != gPid) continue;
      HANDLE th = OpenThread(THREAD_SUSPEND_RESUME | THREAD_GET_CONTEXT | THREAD_QUERY_INFORMATION,
                             FALSE, te.th32ThreadID);
      if (th == NULL) continue;
      ULONG64 cyc = 0, delta = 0;
      if (QueryThreadCycleTime(th, &cyc)) {
        ULONG64 *slot = cycSlot(te.th32ThreadID);
        if (slot != NULL) {
          if (*slot != 0 && cyc > *slot) delta = cyc - *slot;
          *slot = cyc;
        }
      }
      /* Weight, not argmax: a thread that wakes often but computes little
       * contributes proportionally little. */
      if (delta == 0) { CloseHandle(th); continue; }
      if (SuspendThread(th) != (DWORD)-1) {
        CONTEXT ctx;
        memset(&ctx, 0, sizeof ctx);
        ctx.ContextFlags = CONTEXT_FULL;
        if (GetThreadContext(th, &ctx) && nhits < MAXHITS) {
          DWORD64 pick = ctx.Rip;
          int walked = 0;
          if (!(pick >= imgLo && pick < imgHi)) {
            walked = 1;
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
          int inProg = (pick >= imgLo && pick < imgHi);
          if (!inProg) nWait++;
          if (inProg || !progOnly) {
            LONG k = nhits;
            hits[k].pc = pick; hits[k].w = delta; hits[k].ph = ph;
            hits[k].walked = walked && (pick != ctx.Rip);
            nhits = k + 1;
          }
        }
        ResumeThread(th);
      }
      CloseHandle(th);
    } while (Thread32Next(snap, &te));
  }
  CloseHandle(snap);
}

static DWORD WINAPI sampler_thread(LPVOID u) {
  (void)u;
  while (!pollStop) { sample_once(); Sleep(periodMs); }
  return 0;
}

typedef struct { char name[240]; ULONG64 w; long n; } Row;
static int cmprow(const void *a, const void *b) {
  ULONG64 x = ((const Row *)a)->w, y = ((const Row *)b)->w;
  return x < y ? 1 : (x > y ? -1 : 0);
}

static int phase_index(const char *name) {
  for (int i = 0; i < nph; i++) if (strcmp(phName[i], name) == 0) return i;
  if (nph >= MAXPH) return -1;
  snprintf(phName[nph], sizeof phName[0], "%s", name);
  return nph++;
}

/* [phase-begin] NAME / [phase-end] NAME, the markers cpuphase reads. */
static void on_line(const char *ln) {
  const char *b = strstr(ln, "[phase-begin]");
  const char *e = strstr(ln, "[phase-end]");
  const char *p = b ? b + 13 : (e ? e + 11 : NULL);
  if (p == NULL) return;
  while (*p == ' ' || *p == 9) p++;
  char nm[64];
  size_t i = 0;
  while (p[i] && p[i] != 13 && p[i] != 10 && p[i] != ' ' && i + 1 < sizeof nm) { nm[i] = p[i]; i++; }
  nm[i] = 0;
  if (i == 0) return;
  int idx = phase_index(nm);
  curPhase = b ? idx : -1;
}

int main(int argc, char **argv) {
  int hz = 1000, top = 40, i = 1;
  for (; i < argc; i++) {
    if (strcmp(argv[i], "--") == 0) { i++; break; }
    if (strcmp(argv[i], "--hz") == 0 && i + 1 < argc) hz = atoi(argv[++i]);
    else if (strcmp(argv[i], "--top") == 0 && i + 1 < argc) top = atoi(argv[++i]);
    else if (strcmp(argv[i], "--program-only") == 0) progOnly = 1;
  }
  if (i >= argc) { fprintf(stderr, "usage: sampler.exe [--hz N] [--top N] [--program-only] -- <cmd>\n"); return 2; }
  hits = (Hit *)malloc(sizeof(Hit) * MAXHITS);
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

  SECURITY_ATTRIBUTES sa;
  sa.nLength = sizeof sa; sa.lpSecurityDescriptor = NULL; sa.bInheritHandle = TRUE;
  HANDLE rd = NULL, wr = NULL;
  if (!CreatePipe(&rd, &wr, &sa, 1 << 20)) { fprintf(stderr, "sampler: pipe failed\n"); return 2; }
  SetHandleInformation(rd, HANDLE_FLAG_INHERIT, 0);

  STARTUPINFOA si; memset(&si, 0, sizeof si); si.cb = sizeof si;
  si.dwFlags = STARTF_USESTDHANDLES;
  si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
  si.hStdOutput = wr; si.hStdError = wr;
  PROCESS_INFORMATION pi;
  if (!CreateProcessA(NULL, cmd, NULL, NULL, TRUE, 0, NULL, NULL, &si, &pi)) {
    fprintf(stderr, "sampler: CreateProcess failed (%lu)\n", (unsigned long)GetLastError());
    return 2;
  }
  CloseHandle(wr);
  gProc = pi.hProcess; gPid = pi.dwProcessId;

  SymSetOptions(SYMOPT_UNDNAME | SYMOPT_LOAD_ANYTHING | SYMOPT_DEFERRED_LOADS);
  char symPath[1024];
  snprintf(symPath, sizeof symPath, "%s", argv[i]);
  {
    char *slash = strrchr(symPath, '/');
    char *bslash = strrchr(symPath, 92);
    if (bslash > slash) slash = bslash;
    if (slash != NULL) *slash = 0; else snprintf(symPath, sizeof symPath, ".");
  }
  SymInitialize(pi.hProcess, symPath, TRUE);   /* for StackWalk64 unwind */

  {
    HMODULE mods[256];
    DWORD needed = 0;
    for (int t = 0; t < 400 && imgHi == 0; t++) {
      if (EnumProcessModules(pi.hProcess, mods, sizeof mods, &needed) && needed >= sizeof(HMODULE)) {
        MODULEINFO mi;
        if (GetModuleInformation(pi.hProcess, mods[0], &mi, sizeof mi)) {
          imgLo = (DWORD64)(ULONG_PTR)mi.lpBaseOfDll;
          imgHi = imgLo + mi.SizeOfImage;
          /* Keep the MODULE base. imgLo is narrowed to the first executable
           * section below, and a PDB indexes by RVA from the module base --
           * see lie 6. */
          modBase = imgLo;
        }
      }
      if (imgHi == 0) Sleep(2);
    }
  }
  /* LIE 7. SymInitialize(pi.hProcess, symPath, TRUE) above runs BEFORE the
   * child has mapped anything -- the EnumProcessModules wait loop is after
   * it -- so DbgHelp invades an empty module list and
   * SymFunctionTableAccess64 answers NULL for every address. StackWalk64 on
   * x86-64 with no RUNTIME_FUNCTION falls back to a frame-POINTER walk, and
   * clang -O2 keeps no frame pointer, so every "frame" it produced was a
   * stale stack word that happened to point into .text. These binaries DO
   * carry a debug directory and .pdata (objdump -p, Entry 6 CodeView), so
   * loading the module now that it exists makes the walk real. Found by
   * block/computecpu; carried here from instr/sampler_fixed.c. */
  SymRefreshModuleList(pi.hProcess);
  if (imgHi != 0)
    SymLoadModuleEx(pi.hProcess, NULL, argv[i], NULL, imgLo,
                    (DWORD)(imgHi - imgLo), NULL, 0);

  /* Narrow to executable sections: see lie 3 above. */
  {
    FILE *pe = fopen(argv[i], "rb");
    if (pe != NULL) {
      unsigned char hdr[4096];
      size_t got = fread(hdr, 1, sizeof hdr, pe);
      fclose(pe);
      if (got > 0x200) {
        DWORD peoff = *(DWORD *)(hdr + 0x3c);
        if (peoff + 0x100 < got) {
          WORD nsec = *(WORD *)(hdr + peoff + 6);
          WORD optsz = *(WORD *)(hdr + peoff + 20);
          unsigned char *sec = hdr + peoff + 24 + optsz;
          DWORD64 lo = 0, hi = 0;
          for (WORD k = 0; k < nsec && (size_t)(sec - hdr) + 40 <= got; k++, sec += 40) {
            DWORD chars = *(DWORD *)(sec + 36);
            if (!(chars & 0x20000000u)) continue;   /* IMAGE_SCN_MEM_EXECUTE */
            DWORD va = *(DWORD *)(sec + 12), vs = *(DWORD *)(sec + 8);
            DWORD64 a = imgLo + va, b = imgLo + va + vs;
            if (lo == 0 || a < lo) lo = a;
            if (b > hi) hi = b;
          }
          if (lo != 0 && hi > lo) { imgLo = lo; imgHi = hi; }
        }
      }
    }
  }
  periodMs = hz > 0 ? (DWORD)(1000 / hz) : 1;
  if (periodMs < 1) periodMs = 1;
  HANDLE sth = CreateThread(NULL, 0, sampler_thread, NULL, 0, NULL);

  /* The main thread reads the child's output, tracks the phase, and passes
   * it through so the bench still prints normally. */
  {
    char buf[8192];
    char line[4096];
    size_t ll = 0;
    DWORD got = 0;
    while (ReadFile(rd, buf, sizeof buf, &got, NULL) && got > 0) {
      fwrite(buf, 1, got, stdout);
      for (DWORD k = 0; k < got; k++) {
        char c = buf[k];
        if (c == 10) { line[ll] = 0; on_line(line); ll = 0; }
        else if (ll + 1 < sizeof line) line[ll++] = c;
      }
    }
    if (ll > 0) { line[ll] = 0; on_line(line); }
  }
  fflush(stdout);
  WaitForSingleObject(pi.hProcess, INFINITE);
  pollStop = 1;
  if (sth != NULL) { WaitForSingleObject(sth, 3000); CloseHandle(sth); }

  /* Offline symbolisation by RVA: see lie 4 above. */
  HANDLE symProc = GetCurrentProcess();
  DWORD64 symBase = 0;
  SymCleanup(symProc);
  if (SymInitialize(symProc, symPath, FALSE)) {
    char pdbPath[1024];
    snprintf(pdbPath, sizeof pdbPath, "%s", argv[i]);
    size_t plen = strlen(pdbPath);
    if (plen > 4 && strcmp(pdbPath + plen - 4, ".exe") == 0)
      snprintf(pdbPath + plen - 4, 5, ".pdb");
    symBase = SymLoadModuleEx(symProc, NULL, pdbPath, "bench", (DWORD64)0x10000000,
                              (DWORD)(imgHi - imgLo), NULL, 0);
    if (symBase == 0)
      symBase = SymLoadModuleEx(symProc, NULL, argv[i], NULL, (DWORD64)0x10000000,
                                (DWORD)(imgHi - imgLo), NULL, 0);
  }

  long cap = 20000;
  Row *rows = (Row *)calloc((size_t)cap, sizeof(Row));
  {
    long nw = 0;
    for (long k = 0; k < nhits; k++) if (hits[k].walked) nw++;
    fprintf(stderr, "\n[sampler] %ld samples, %ld with no program frame%s\n",
            (long)nhits, (long)nWait, progOnly ? " (excluded)" : "");
    fprintf(stderr, "[sampler] %ld of %ld samples (%.1f%%) are STACK-WALKED: the\n"
                    "[sampler] unwinder chose the frame, not the thread PC. The\n"
                    "[sampler] DIRECT tables below do not depend on the unwinder.\n",
            nw, (long)nhits, nhits ? (double)nw * 100.0 / (double)nhits : 0.0);
  }
  /* Two passes. A stack-walked sample is only as good as the unwinder, and
   * the unwinder on this target was wrong for every table taken before the
   * fix above -- it had no .pdata and fell back to a frame-pointer walk that
   * clang -O2 does not support. The DIRECT pass uses nothing but the
   * thread PC, so a name that leads BOTH passes is not an artifact of
   * the unwinder, and one that leads only the first is suspect. */
  for (int pass = 0; pass < 2; pass++) {
  fprintf(stderr, "\n[sampler] ############ %s ############\n",
          pass == 0 ? "ALL SAMPLES (RIP + stack-walked)"
                    : "DIRECT RIP ONLY (no unwinder involved)");
  /* -1 is "outside any phase" and is reported as its own bucket rather than
   * folded into a phase it did not happen in. */
  for (int ph = -1; ph < nph; ph++) {
    long nrows = 0;
    ULONG64 tot = 0;
    memset(rows, 0, sizeof(Row) * (size_t)cap);
    for (long k = 0; k < nhits; k++) {
      if (hits[k].ph != ph) continue;
      if (pass == 1 && hits[k].walked) continue;
      char nbuf[sizeof(SYMBOL_INFO) + 512];
      SYMBOL_INFO *sym = (SYMBOL_INFO *)nbuf;
      memset(nbuf, 0, sizeof nbuf);
      sym->SizeOfStruct = sizeof(SYMBOL_INFO);
      sym->MaxNameLen = 500;
      DWORD64 disp = 0, q = hits[k].pc;
      if (symBase != 0 && q >= imgLo && q < imgHi) q = symBase + (q - modBase);
      char name[240];
      if (SymFromAddr(symProc, q, &disp, sym)) snprintf(name, sizeof name, "%s", sym->Name);
      else snprintf(name, sizeof name, "<0x%llx>", (unsigned long long)hits[k].pc);
      long f = -1;
      for (long r = 0; r < nrows; r++) if (strcmp(rows[r].name, name) == 0) { f = r; break; }
      if (f < 0) { if (nrows >= cap) continue; f = nrows++; snprintf(rows[f].name, sizeof rows[f].name, "%s", name); }
      rows[f].w += hits[k].w; rows[f].n++;
      tot += hits[k].w;
    }
    if (nrows == 0) continue;
    qsort(rows, (size_t)nrows, sizeof(Row), cmprow);
    fprintf(stderr, "\n[sampler] === phase %s === (cycle-weighted)\n",
            ph < 0 ? "<outside>" : phName[ph]);
    fprintf(stderr, "[sampler] %8s %9s  %s\n", "self%", "samples", "function");
    for (long r = 0; r < nrows && r < top; r++) {
      fprintf(stderr, "[sampler] %7.2f%% %9ld  %s\n",
              tot ? (double)rows[r].w * 100.0 / (double)tot : 0.0, rows[r].n, rows[r].name);
    }
  }
  }
  DWORD code = 0; GetExitCodeProcess(pi.hProcess, &code);
  return (int)code;
}
