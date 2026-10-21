// Parser for ICU resource bundle source files (genrb .txt) as shipped in icu4c/source/data.
// Node kinds: {t:"s",v} string, {t:"t",e:[[key,node]...]} table, {t:"a",e:[node...]} array,
//             {t:"al",v} alias path, {t:"i",v} integer, {t:"iv",v:[n...]} integer vector, {t:"b",v} binary (hex).
import fs from "node:fs";

export function parseIcuTxt(src, file = "?") {
  let i = 0;
  const n = src.length;
  const err = (m) => { throw new Error(`${file}:${lineOf(i)}: ${m}`); };
  const lineOf = (p) => src.slice(0, p).split("\n").length;
  function ws() {
    for (;;) {
      while (i < n && (src[i] === " " || src[i] === "\t" || src[i] === "\n" || src[i] === "\r" || src[i] === "﻿")) i++;
      if (src[i] === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
      if (src[i] === "/" && src[i + 1] === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
      break;
    }
  }
  function str() {
    // at opening quote
    i++;
    let out = "";
    for (;;) {
      if (i >= n) err("unterminated string");
      const c = src[i++];
      if (c === '"') return out;
      if (c === "\\") {
        const d = src[i++];
        if (d === "u") { out += String.fromCharCode(parseInt(src.slice(i, i + 4), 16)); i += 4; }
        else if (d === "U") { out += String.fromCodePoint(parseInt(src.slice(i, i + 8), 16)); i += 8; }
        else if (d === "n") out += "\n";
        else if (d === "t") out += "\t";
        else if (d === "r") out += "\r";
        else if (d === "x") { out += String.fromCharCode(parseInt(src.slice(i, i + 2), 16)); i += 2; }
        else out += d;
      } else out += c;
    }
  }
  function word() {
    const s = i;
    while (i < n && !/[\s{}:,"]/.test(src[i])) {
      if (src[i] === "/" && (src[i + 1] === "/" || src[i + 1] === "*")) break;
      i++;
    }
    return src.slice(s, i);
  }
  // value inside braces; returns node
  function body(type) {
    // after '{'
    ws();
    if (src[i] === "}") { i++; return type === "a" ? { t: "a", e: [] } : type === "iv" ? { t: "iv", v: [] } : { t: "t", e: [] }; }
    if (type === "iv" || type === "i") {
      const vals = [];
      for (;;) {
        ws();
        const w = word();
        if (w === "") err("bad integer list");
        vals.push(Number(w));
        ws();
        if (src[i] === ",") { i++; ws(); }
        if (src[i] === "}") { i++; break; }
      }
      return type === "i" ? { t: "i", v: vals[0] } : { t: "iv", v: vals };
    }
    if (type === "b") { ws(); const s = i; while (src[i] !== "}") i++; const hex = src.slice(s, i).trim(); i++; return { t: "b", v: hex }; }
    if (type === "al") { ws(); let v = ""; while (src[i] === '"') { v += str(); ws(); } i++; return { t: "al", v }; }
    // a quoted first token followed by '{' is a quoted KEY (a table), not a string
    let quotedKey = false;
    if (src[i] === '"' && type !== "a") {
      const save = i;
      str();
      ws();
      quotedKey = src[i] === "{" || src[i] === ":";
      i = save;
    }
    if (!quotedKey && (src[i] === '"' || src[i] === "{" || type === "a")) {
      // elements separated by commas; adjacent strings concatenate
      const elems = [];
      let commas = false;
      for (;;) {
        ws();
        if (src[i] === "}") { i++; break; }
        if (src[i] === ",") { i++; commas = true; continue; }
        if (src[i] === '"') {
          let v = "";
          while (src[i] === '"') { v += str(); ws(); }
          elems.push({ t: "s", v });
        } else if (src[i] === "{") {
          i++;
          elems.push(body(null));
        } else {
          const w = word();
          if (w === "") err("unexpected char " + src[i]);
          elems.push({ t: "i", v: Number(w) });
        }
      }
      if (!commas && elems.length === 1 && elems[0].t === "s" && type !== "a") return elems[0];
      return { t: "a", e: elems };
    }
    // table
    const e = [];
    for (;;) {
      ws();
      if (src[i] === "}") { i++; break; }
      let key;
      if (src[i] === '"') key = str(); else key = word();
      if (key === "") err("empty key near '" + src.slice(i, i + 20) + "'");
      ws();
      let ty = null;
      if (src[i] === ":") {
        i++;
        const tn = word();
        ty = tn;
        // :process(...) / :import etc. may have parens
        if (src[i] === "(") { while (src[i] !== ")") i++; i++; }
        ws();
      }
      if (src[i] !== "{") err(`expected '{' after key ${key}`);
      i++;
      let node;
      if (ty === "alias") node = body("al");
      else if (ty === "int") node = body("i");
      else if (ty === "intvector") node = body("iv");
      else if (ty === "bin") node = body("b");
      else if (ty === "array") node = body("a");
      else if (ty === "table") node = body("t");
      else if (ty === "import") { node = body("b"); }
      else if (ty === "string") { node = body(null); }
      else node = body(null);
      e.push([key, node]);
    }
    return { t: "t", e };
  }
  ws();
  const rootKey = word();
  ws();
  if (src[i] === ":") { i++; word(); ws(); }
  if (src[i] !== "{") err("expected root '{'");
  i++;
  const root = body("t");
  return { name: rootKey, node: root };
}
