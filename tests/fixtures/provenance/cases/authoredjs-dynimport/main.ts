// A TypeScript-source mapped package reached ONLY through import(), which itself statically imports an
// authored-JavaScript package. Its declaration twin (authoredjs/index.d.ts -> index.js) must still enter
// the module order, or the reads inside refuse as "ships only a declaration file" (zapo's
// `await import('@zapo-js/store-mysql')` -> mysql2/promise `createPool` hit exactly this).
async function main(): Promise<void> {
  const m = await import("dynhost");
  for (const line of m.report()) console.log(line);
}
main();
