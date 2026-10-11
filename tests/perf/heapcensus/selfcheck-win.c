/* selfcheck-win.c - the collision test the header exists to pass.
 *
 * scr_heap_census.h is force-included AHEAD of every translation unit, and
 * several of them include <windows.h> afterwards. That is why HeapWalk and
 * friends are declared under private names bound with __asm__ instead of
 * their own. The peak block added beside them declares six more Win32
 * entry points and one more struct, and every one of them is a fresh
 * chance to collide:
 *
 *   CreateThread, Sleep, GetCurrentProcess, QueryPerformanceCounter,
 *   QueryPerformanceFrequency  -- all declared by <windows.h>
 *   K32GetProcessMemoryInfo and PROCESS_MEMORY_COUNTERS_EX
 *                              -- declared by <psapi.h>
 *
 * A collision here is a compile error in EVERY unit of a program that
 * takes sixteen minutes to build. It costs two seconds to find here.
 * selfcheck.c proves the header type-checks; this one proves it still does
 * when the SDK headers land on top of it, which is the arrangement the
 * real subject actually compiles under.
 *
 *   zig cc -c -target x86_64-windows-gnu -DSCR_HEAPCEN_PEAK \
 *     -include tests/perf/heapcensus/scr_heap_census.h \
 *     tests/perf/heapcensus/selfcheck-win.c -o <tmp>/hc-selfcheck-win.o
 */
#include <windows.h>
#include <psapi.h>

/* Touch the SDK's own spellings so they are really instantiated and not
 * merely declared-and-dropped, and touch the header's private ones in the
 * same unit so both sets have to coexist. */
int main(void) {
  PROCESS_MEMORY_COUNTERS_EX sdk;
  memset(&sdk, 0, sizeof sdk);
  sdk.cb = (DWORD)sizeof sdk;
  LARGE_INTEGER li;
  QueryPerformanceCounter(&li);
  Sleep(0);
  HANDLE me = GetCurrentProcess();

  ScrHcPmc mine;
  memset(&mine, 0, sizeof mine);
  mine.cb = (unsigned long)sizeof mine;
  scr_hc_GetPMI(scr_hc_CurProc(), &mine, (unsigned long)sizeof mine);
  scr_hc_Sleep(0);
  scr_hc_note(64, 16);
  scr_hc_fnote(64);
  scr_hc_run_close(0x1000, 0x3000);

  return (me != NULL) + (int)(li.QuadPart != 0) + (int)scr_hc_pkpolls +
         (int)scr_hc_pages;
}
