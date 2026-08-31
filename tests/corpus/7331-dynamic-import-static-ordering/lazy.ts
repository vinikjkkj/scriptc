console.log("lazy body");
export function open(name: string): string {
  if (name === "bad") throw new Error("cannot open " + name);
  return "opened " + name;
}
