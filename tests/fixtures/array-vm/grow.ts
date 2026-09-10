/* Arrays that cross every boundary the reservation-backed growth path has.
 *
 * scr_arr_grow promotes a data buffer off the CRT heap once it reaches
 * SCR_ARR_VM_MIN (8,192 bytes = 1,024 elements) and then COMMITS instead of
 * reallocating. Three things can go wrong there and none of them are visible
 * in a program that only grows a little:
 *
 *   the copy on PROMOTION can lose or shift elements (it is the one memcpy
 *   the new path still does);
 *   a COMMIT that silently fails would hand back a pointer into reserved but
 *   unreadable address space, which faults on the next write;
 *   an array past SCR_ARR_VM_RESERVE (16 MiB = 2,097,152 elements) has to
 *   copy back OUT to the heap, and that path never runs on a workload that
 *   stays small.
 *
 * So: sizes below the threshold, straddling it, well past it, and past the
 * reservation. Every element is written AND read back, because a buffer that
 * is the right length and the wrong contents is the failure a length check
 * cannot see.
 *
 * The expected output is arithmetic, not whatever it printed first:
 * sum(0..n-1) = n*(n-1)/2, computed independently below.
 */
function build(n: number): number[] {
  const a: number[] = [];
  for (let i = 0; i < n; i++) a.push(i);
  return a;
}

function checksum(a: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]!;
  return s;
}

function expect(n: number): number {
  return (n * (n - 1)) / 2;
}

function main(): void {
  /* 1023/1024/1025 straddle the 1,024-element promotion point; 300000 is well
   * past it; 2100000 is past the 16 MiB reservation and forces the copy-out. */
  const sizes = [0, 1, 4, 5, 1023, 1024, 1025, 4096, 300000, 2100000];
  let ok = 0;
  for (const n of sizes) {
    const a = build(n);
    const got = checksum(a);
    const want = expect(n);
    if (a.length === n && got === want) ok++;
    else console.log("MISMATCH n=" + String(n) + " len=" + String(a.length) + " got=" + String(got) + " want=" + String(want));
  }
  /* A grown array that is then written through must still be the same buffer
   * the reads see -- a promotion that left `data` stale would pass every
   * check above and fail here. */
  const b = build(200000);
  for (let i = 0; i < b.length; i += 1000) b[i] = -1;
  let neg = 0;
  for (let i = 0; i < b.length; i++) if (b[i]! < 0) neg++;
  console.log("array-vm " + String(ok) + "/" + String(sizes.length) + " neg=" + String(neg));
}

main();
