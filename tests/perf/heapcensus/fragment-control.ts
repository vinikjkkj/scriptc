/* The free-side census's control, and it tests the one thing that matters:
 * can it tell free space that is PAGE-SHAPED from free space that is not.
 *
 * The settled zapo process holds 72.84 MiB of committed-but-free CRT heap
 * in 107,512 blocks averaging 710 bytes, against 40.65 MiB busy. Whether
 * any of that can ever be returned depends entirely on whether the holes
 * form contiguous runs with whole 4 KiB pages inside them, and a mean hole
 * size cannot answer that. HCRUN and HCPAGE do.
 *
 * So this allocates a large population of blocks ABOVE SCR_POOL_MAX (256),
 * which is what routes them past both arenas and straight to malloc, then
 * retains a tenth of them in one of two placements:
 *
 *   stride  every tenth block. The survivors are spread through the whole
 *           address range, so the free space between them is chopped into
 *           holes the size of the blocks. Whole free pages should be a
 *           small fraction of free bytes. This is the zapo shape.
 *   prefix  the first tenth, contiguous. The freed nine tenths form long
 *           runs, and whole free pages should be most of free bytes.
 *
 * Same binary, same retained COUNT and BYTES, only placement differs. A
 * page ceiling that read near zero for both would be indistinguishable
 * from one that was never computed; a ceiling that read high for both
 * would be measuring nothing. It has to separate them, in both directions.
 *
 * KC_SZ defaults to 700 because that is the observed mean hole size on the
 * real process, so the control sits in the size class the finding is about.
 */
const N = Number(process.env["KC_N"] !== undefined ? process.env["KC_N"] : "120000");
const SZ = Number(process.env["KC_SZ"] !== undefined ? process.env["KC_SZ"] : "700");
const KEEP = Number(process.env["KC_KEEP"] !== undefined ? process.env["KC_KEEP"] : "10");
const MODE = process.env["KC_MODE"] !== undefined ? process.env["KC_MODE"] : "stride";

function main(): void {
  /* Uint8Array and not a string: strings can be interned or shared, and an
   * interned survivor would not pin the block this control means to pin. */
  const built: Uint8Array[] = [];
  for (let i = 0; i < N; i++) {
    const b = new Uint8Array(SZ);
    b[0] = i & 255;
    b[SZ - 1] = 1;
    built.push(b);
  }
  const held: Uint8Array[] = [];
  if (MODE === "prefix") {
    const keepN = Math.floor(built.length / KEEP);
    for (let i = 0; i < keepN; i++) held.push(built[i]!);
  } else {
    for (let i = 0; i < built.length; i += KEEP) held.push(built[i]!);
  }
  built.length = 0;

  let sink = 0;
  for (let i = 0; i < held.length; i += 331) sink += held[i]![0]!;
  setTimeout((): void => {
    console.log("hcctl n=" + String(N) + " sz=" + String(SZ) + " keep=" +
      String(KEEP) + " mode=" + MODE + " held=" + String(held.length) +
      " sink=" + String(sink));
    /* Exit from inside the callback with `held` still referenced, so the
     * census sees the retained population rather than a torn-down heap. */
    process.exit(0);
  }, 1500);
}

main();
