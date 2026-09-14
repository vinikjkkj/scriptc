/* The text the COMPILER SERVED for a source file, when that is not the text
 * on disk.
 *
 * Two parts of the pipeline read a program file's bytes independently: the
 * frontend gets them through the tsgo host (and therefore through the host's
 * fsShadow), while the C emitter's source-site labels (srcSite) read the file
 * off disk a second time, to turn a SrcLoc's character OFFSET into
 * `file:line:col`. Those two reads agree only for as long as nothing shadows
 * the file.
 *
 * --provenance-sources now shadows some of them: a mapped source tree's own
 * path-alias specifiers are rewritten, per tree, before tsgo parses them (see
 * provenance-rewrite.ts), because tsconfig "paths" is one table per PROGRAM
 * and two attested checkouts routinely spell the same alias. The rewrite
 * changes no LINES, but it does change the offsets after each import, so a
 * line index built from the disk bytes answers a later line than the one the
 * offset came from -- measured at roughly twenty lines by the end of a file
 * that imports fifty aliases. A source site naming the wrong line is worse
 * than none.
 *
 * So the shadow is recorded here, at the one place both sides can see, and
 * srcSite prefers it. Empty by default (the flag off, nothing shadowed), in
 * which case every lookup misses and the disk read stands exactly as before. */

const served = new Map<string, string>();

function key(file: string): string {
  return file.split("\\").join("/");
}

/** Records the text the compiler served for `file` (the tsgo host's answer),
 * replacing any earlier record. */
export function setServedSourceText(file: string, text: string): void {
  served.set(key(file), text);
}

/** The served text for `file`, or undefined when the file was never
 * shadowed -- the caller then reads the disk exactly as before. */
export function servedSourceText(file: string): string | undefined {
  return served.get(key(file));
}

/** Drops every record. One compile's shadows must not answer the next one's
 * questions (the in-process API compiles more than once per process). */
export function clearServedSourceText(): void {
  served.clear();
}
