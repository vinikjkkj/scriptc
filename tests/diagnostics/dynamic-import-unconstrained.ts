// A specifier with no static part names no file the build could compile: a compile-time refusal, never a run-time rejection.
export {};
async function load(name: string): Promise<unknown> {
  return import(name);
}
void load("./x.ts");
