function cps(s: string): string {
  let r = "";
  for (let i = 0; i < s.length; i++) r += s.charCodeAt(i).toString(16) + " ";
  return r;
}
function show(f: () => string): string {
  try {
    return "OK:" + cps(f());
  } catch {
    return "ERR";
  }
}
const all = new Uint8Array(256);
for (let i = 0; i < 256; i++) all[i] = i;
console.log("ibm866", show(() => new TextDecoder("ibm866").decode(all)).length);
{ const d = new TextDecoder("ibm866"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("ibm866", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("ibm866", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("iso-8859-2", show(() => new TextDecoder("iso-8859-2").decode(all)).length);
{ const d = new TextDecoder("iso-8859-2"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("iso-8859-2", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("iso-8859-2", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("iso-8859-3", show(() => new TextDecoder("iso-8859-3").decode(all)).length);
{ const d = new TextDecoder("iso-8859-3"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("iso-8859-3", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("iso-8859-3", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("iso-8859-4", show(() => new TextDecoder("iso-8859-4").decode(all)).length);
{ const d = new TextDecoder("iso-8859-4"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("iso-8859-4", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("iso-8859-4", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("iso-8859-5", show(() => new TextDecoder("iso-8859-5").decode(all)).length);
{ const d = new TextDecoder("iso-8859-5"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("iso-8859-5", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("iso-8859-5", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("iso-8859-6", show(() => new TextDecoder("iso-8859-6").decode(all)).length);
{ const d = new TextDecoder("iso-8859-6"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("iso-8859-6", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("iso-8859-6", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("iso-8859-7", show(() => new TextDecoder("iso-8859-7").decode(all)).length);
{ const d = new TextDecoder("iso-8859-7"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("iso-8859-7", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("iso-8859-7", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("iso-8859-8", show(() => new TextDecoder("iso-8859-8").decode(all)).length);
{ const d = new TextDecoder("iso-8859-8"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("iso-8859-8", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("iso-8859-8", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("iso-8859-8-i", show(() => new TextDecoder("iso-8859-8-i").decode(all)).length);
{ const d = new TextDecoder("iso-8859-8-i"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("iso-8859-8-i", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("iso-8859-8-i", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("iso-8859-10", show(() => new TextDecoder("iso-8859-10").decode(all)).length);
{ const d = new TextDecoder("iso-8859-10"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("iso-8859-10", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("iso-8859-10", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("iso-8859-13", show(() => new TextDecoder("iso-8859-13").decode(all)).length);
{ const d = new TextDecoder("iso-8859-13"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("iso-8859-13", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("iso-8859-13", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("iso-8859-14", show(() => new TextDecoder("iso-8859-14").decode(all)).length);
{ const d = new TextDecoder("iso-8859-14"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("iso-8859-14", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("iso-8859-14", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("iso-8859-15", show(() => new TextDecoder("iso-8859-15").decode(all)).length);
{ const d = new TextDecoder("iso-8859-15"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("iso-8859-15", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("iso-8859-15", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("iso-8859-16", show(() => new TextDecoder("iso-8859-16").decode(all)).length);
{ const d = new TextDecoder("iso-8859-16"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("iso-8859-16", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("iso-8859-16", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("koi8-r", show(() => new TextDecoder("koi8-r").decode(all)).length);
{ const d = new TextDecoder("koi8-r"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("koi8-r", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("koi8-r", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("koi8-u", show(() => new TextDecoder("koi8-u").decode(all)).length);
{ const d = new TextDecoder("koi8-u"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("koi8-u", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("koi8-u", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("macintosh", show(() => new TextDecoder("macintosh").decode(all)).length);
{ const d = new TextDecoder("macintosh"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("macintosh", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("macintosh", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("windows-874", show(() => new TextDecoder("windows-874").decode(all)).length);
{ const d = new TextDecoder("windows-874"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("windows-874", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("windows-874", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("windows-1250", show(() => new TextDecoder("windows-1250").decode(all)).length);
{ const d = new TextDecoder("windows-1250"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("windows-1250", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("windows-1250", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("windows-1251", show(() => new TextDecoder("windows-1251").decode(all)).length);
{ const d = new TextDecoder("windows-1251"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("windows-1251", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("windows-1251", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("windows-1252", show(() => new TextDecoder("windows-1252").decode(all)).length);
{ const d = new TextDecoder("windows-1252"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("windows-1252", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("windows-1252", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("windows-1253", show(() => new TextDecoder("windows-1253").decode(all)).length);
{ const d = new TextDecoder("windows-1253"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("windows-1253", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("windows-1253", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("windows-1254", show(() => new TextDecoder("windows-1254").decode(all)).length);
{ const d = new TextDecoder("windows-1254"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("windows-1254", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("windows-1254", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("windows-1255", show(() => new TextDecoder("windows-1255").decode(all)).length);
{ const d = new TextDecoder("windows-1255"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("windows-1255", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("windows-1255", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("windows-1256", show(() => new TextDecoder("windows-1256").decode(all)).length);
{ const d = new TextDecoder("windows-1256"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("windows-1256", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("windows-1256", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("windows-1257", show(() => new TextDecoder("windows-1257").decode(all)).length);
{ const d = new TextDecoder("windows-1257"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("windows-1257", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("windows-1257", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("windows-1258", show(() => new TextDecoder("windows-1258").decode(all)).length);
{ const d = new TextDecoder("windows-1258"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("windows-1258", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("windows-1258", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("x-mac-cyrillic", show(() => new TextDecoder("x-mac-cyrillic").decode(all)).length);
{ const d = new TextDecoder("x-mac-cyrillic"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("x-mac-cyrillic", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("x-mac-cyrillic", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("x-user-defined", show(() => new TextDecoder("x-user-defined").decode(all)).length);
{ const d = new TextDecoder("x-user-defined"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("x-user-defined", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("x-user-defined", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("utf-16le", show(() => new TextDecoder("utf-16le").decode(all)).length);
{ const d = new TextDecoder("utf-16le"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("utf-16le", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("utf-16le", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
console.log("utf-16be", show(() => new TextDecoder("utf-16be").decode(all)).length);
{ const d = new TextDecoder("utf-16be"); console.log("stored", d.encoding, cps(d.decode(all)).length, d.fatal, d.ignoreBOM); }
{ const f = new TextDecoder("utf-16be", { fatal: true }); let r = ""; for (let b = 0; b < 256; b++) { try { f.decode(new Uint8Array([b])); r += "1"; } catch { r += "0"; } } console.log("fatal", r); }
{ const d = new TextDecoder("utf-16be", { ignoreBOM: true }); console.log("ign", d.encoding, d.fatal, d.ignoreBOM, show(() => d.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff, 0xfe, 0x41, 0x00])))); }
