/* The two import.meta spellings that do NOT lower, each refused by name.
 *
 * `import.meta.dirname` and `import.meta.filename` DO lower, to the source
 * file's build-time directory and path (corpus 7333/7334, and
 * tests/harness/import-meta-dirname.test.ts pins the divergence that
 * follows from "build-time"). What is refused here is the URL spelling,
 * because a file: URL is a percent-encoded serialization whose exact rules
 * decide byte-equality: an approximate one would compare unequal to Node's
 * and misparse when read back, which is a silent wrong answer rather than
 * a missing feature. Its hint names the two spellings that work.
 */
export {}
console.log(import.meta.url);
