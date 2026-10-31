function run(): void {
  try { JSON.parse("{"); } catch (e: any) {
    const C = e.constructor;
    console.log("nm", C.name, e instanceof SyntaxError);
  }
}
run();
