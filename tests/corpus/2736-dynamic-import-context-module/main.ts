// import() with a specifier that has a static part: every file the pattern can name joins the compiled graph, loads lazily on first use, and a key
// for a file that does not exist rejects with Node's own ERR_MODULE_NOT_FOUND (code, message and url).
export {};
async function locale(lang: string): Promise<void> {
  try {
    const m: any = await import(`./locales/${lang}.ts`);
    console.log("locale", lang, m.greeting, typeof m.plural === "function" ? m.plural(1) : "-");
  } catch (e) {
    const err = e as Error & { code?: string; url?: string };
    console.log("rejected", err.name, err.code, err.message.split(import.meta.dirname).join("<dir>"), (err.url ?? "").split(import.meta.dirname).join("<dir>"));
  }
}
async function plugin(name: string): Promise<void> {
  try {
    const m: any = await import("./plugins/" + name + ".ts");
    console.log("plugin", m.name, m.run());
  } catch (e) {
    console.log("rejected", (e as Error & { code?: string }).code);
  }
}
console.log("start");
await locale("en");
await locale("pt");
await locale("sub/de");
await locale("fr");
await plugin("alpha");
await plugin("beta");
await plugin("gamma");
await locale("en");
