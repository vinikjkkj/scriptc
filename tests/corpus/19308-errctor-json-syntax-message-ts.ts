function parse(s: string): number {
  return JSON.parse(s).length;
}
try { parse("[1,"); } catch (e) {
  const err = e as Error;
  console.log("name", err.name);
  console.log("ctorname", err.constructor.name);
}
