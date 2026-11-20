function collectUniqueUserJids(...candidates) {
  const out = [];
  for (const c of candidates) { if (typeof c === "string" && c.includes("@") && !out.includes(c)) out.push(c); }
  return out;
}
function resolve(key, group) {
  if (key.fromMe) return null;
  const raw = group ? key.participant : key.remoteJid;
  return collectUniqueUserJids(raw)[0] ?? null;
}
console.log(resolve({ fromMe: false, remoteJid: "a@s.whatsapp.net" }, false), resolve({ fromMe: false, remoteJid: "bad" }, false), resolve({ fromMe: true }, false));
