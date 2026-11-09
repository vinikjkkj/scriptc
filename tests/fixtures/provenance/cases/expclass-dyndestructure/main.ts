// `const { Redis } = await import("pkg")` — destructuring the import() namespace directly, the spelling zapo's store factories use — binds the class and the
// function exactly as `const ns = await import("pkg"); const { Redis } = ns` does.
async function main(): Promise<void> {
  const { Redis, helper } = await import("expclass");
  const r = new Redis({ host: "h" });
  console.log(r.get("k"), helper(2), r instanceof Redis);
}
main();
