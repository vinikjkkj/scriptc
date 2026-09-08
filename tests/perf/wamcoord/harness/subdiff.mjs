// Identity-level diff for a substitution probe. Site COUNTS cannot tell "these
// shared a cause" from "these happened to move"; only (section, code, file,
// line) can. A probe tree is a copy (voipB, voipC, ...), so its path segment is
// normalised back -- and this is done WITHOUT a regex, because a backslash in a
// regex literal does not survive being written through a shell heredoc, and a
// silently broken normaliser reads as "everything moved".
import { readFileSync } from "node:fs";
const BS = String.fromCharCode(92);
const norm = (p) => {
  let s = String(p).split(BS).join("/");
  for (const L of "ABCDEFGHIJ") s = s.split("/voip" + L + "/").join("/voip/");
  const i = s.indexOf("/pkgsrc/");
  if (i >= 0) s = s.slice(i + 8);
  const j = s.indexOf("/packages/voip/src/");
  if (j >= 0) s = "voip/" + s.slice(j + 19);
  return s;
};
const key = (s) => [s.section, s.code, norm(s.file), s.line].join("|");
const load = (f) => new Map(JSON.parse(readFileSync(f, "utf8")).sites.map((s) => [key(s), s]));
const A = load(process.argv[2]);
const B = load(process.argv[3]);
const gone = [...A].filter(([k]) => !B.has(k));
const added = [...B].filter(([k]) => !A.has(k));
const show = (label, rows) => {
  console.log(`  ${label}: ${rows.length}`);
  for (const [, s] of rows) {
    console.log(`    ${s.section.padEnd(11)}${s.code}  ${norm(s.file)}:${s.line}`);
    console.log(`        ${s.message.slice(0, 92)}`);
  }
};
console.log(`  baseline sites=${A.size}   probe sites=${B.size}`);
show("CLEARED by the substitution", gone);
show("NEWLY APPEARING", added);
