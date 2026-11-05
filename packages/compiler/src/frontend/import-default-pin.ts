/* IMPORT-DEFAULT PIN: tsc's `__importDefault(require("m"))` is `require("m")` when "m" is a stamped CommonJS module.
 *
 * THE DEFECT. Every CommonJS file tsc compiles from `import x from "m"` reads the dependency through its interop helper,
 *
 *     var __importDefault = (this && this.__importDefault) || function (mod) {
 *         return (mod && mod.__esModule) ? mod : { "default": mod };
 *     };
 *     const m_1 = __importDefault(require("m"));       ...  (0, m_1.default)(args)
 *
 * and the checker types the helper's result `any`, so `m_1.default` is a dynamic member and `(0, m_1.default)(args)` a
 * dynamic call whose result is `unknown`: ioredis's `standard_as_callback` call, typed `Promise<T>` by the package's own
 * declaration, reached a typed Promise slot as a dynamic value and was refused.
 *
 * WHY THE REPAIR IS EXACT. The helper returns its argument itself when the argument has an own `__esModule` that is truthy.
 * The pin fires only where that is certain: the helper is tsc's own text, the dependency is a CommonJS source file whose
 * statements open with `Object.defineProperty(exports, "__esModule", { value: true })`, and nothing in it assigns
 * `module.exports` (a replacement object would not carry the stamp, and the helper would wrap it). Then
 * `__importDefault(require("m"))` and `require("m")` are the same value, and the checker types the second as the module.
 * Any other shape keeps the dynamic helper. The edit is the retype pin's replacement form, applied by the same second load. */
import { readFileSync } from "node:fs";
import * as ts from "./ts7/adapter.js";
import type { RetypePin } from "./retype-pin.js";

const STAMP = /^\s*Object\.defineProperty\(\s*exports\s*,\s*["']__esModule["']\s*,\s*\{\s*value\s*:\s*true\s*\}\s*\)\s*;?\s*$/;
const MODULE_EXPORTS_ASSIGN = /\bmodule\.exports\s*=[^=]/;

/** The first statement that is not a directive, as source text: tsc's output opens with `"use strict";` then the stamp. */
const STAMPED_TEXT = /^\s*(?:(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*)\s*)*(?:["']use strict["'];?\s*)?Object\.defineProperty\(\s*exports\s*,\s*["']__esModule["']\s*,\s*\{\s*value\s*:\s*true\s*\}\s*\)\s*;?/;

/** Is `sf` a CommonJS module whose own first export action is the interop stamp, with no replacement of module.exports? A package
 * that ships a declaration file resolves to it, not to the implementation, so the implementation beside it is read off disk
 * (`x.d.ts` -> `x.js`, `x.d.cts` -> `x.cjs`). */
function stampedCommonJs(sf: ts.SourceFile): boolean {
  if (sf.isDeclarationFile) {
    const impl = /\.d\.ts$/.test(sf.fileName) ? sf.fileName.replace(/\.d\.ts$/, ".js") : /\.d\.cts$/.test(sf.fileName) ? sf.fileName.replace(/\.d\.cts$/, ".cjs") : null;
    if (impl === null) return false;
    let text: string;
    try {
      text = readFileSync(impl, "utf8");
    } catch {
      return false;
    }
    return STAMPED_TEXT.test(text) && !MODULE_EXPORTS_ASSIGN.test(text);
  }
  if (!/\.(c|m)?js$/.test(sf.fileName)) return false;
  if (MODULE_EXPORTS_ASSIGN.test(sf.text)) return false;
  for (const st of sf.statements) {
    if (ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression)) continue; // "use strict"
    return ts.isExpressionStatement(st) && STAMP.test(st.getText());
  }
  return false;
}

/** tsc's helper, by its text: a variable named __importDefault whose initializer is the `(this && this.__importDefault) ||
 * function (mod) { return (mod && mod.__esModule) ? mod : { "default": mod }; }` form. */
function isTscHelper(decl: ts.Node | undefined): boolean {
  if (decl === undefined || !ts.isVariableDeclaration(decl) || decl.initializer === undefined) return false;
  const t = decl.initializer.getText().replace(/\s+/g, " ");
  // The loader's JS desugar may already have dropped the `(this && this.__importDefault) ||` prefix.
  return /return \(mod && mod\.__esModule\) \? mod : \{ ["']?default["']?: mod \};?/.test(t);
}

const why = (sf: ts.SourceFile, n: ts.Node, r: string): void => {
  if (/standard-as-callback|ioredis|built[\\/](transaction|cluster)/.test(sf.fileName) || sf.text.includes("standard-as-callback")) process.stderr.write(`[importdefault] ${sf.fileName}:${n.getStart()} ${r} :: ${n.getText().slice(0, 80)}\n`);
};

export function computeImportDefaultPins(program: ts.Program): Map<string, RetypePin[]> {
  const checker = program.getTypeChecker();
  const out = new Map<string, RetypePin[]>();
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || !/\.(c|m)?js$/.test(sf.fileName) || !sf.text.includes("__importDefault(")) continue;
    if (/[\\/]node_modules[\\/]typescript[\\/]/.test(sf.fileName)) continue;
    const pins: RetypePin[] = [];
    ts.walkPreorder(sf, (n) => {
      if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression) || n.expression.text !== "__importDefault") return undefined;
      if (n.arguments.length !== 1) return why(sf, n, "args!=1");
      let inner: ts.Expression = n.arguments[0]!;
      // `__importDefault(__sc_r0)` after the loader hoisted the require: the argument names a const bound to it.
      if (ts.isIdentifier(inner)) {
        const sym = checker.getSymbolAtLocation(inner);
        const d = sym === undefined ? undefined : checker.declarationsOf(sym)[0];
        if (d === undefined || !ts.isVariableDeclaration(d) || d.initializer === undefined) return why(sf, n, "arg ident has no initializer");
        inner = d.initializer;
      }
      if (
        !ts.isCallExpression(inner) || !ts.isIdentifier(inner.expression) || inner.expression.text !== "require" ||
        inner.arguments.length !== 1 || !ts.isStringLiteral(inner.arguments[0]!)
      ) {
        return why(sf, n, "arg is not require(literal)");
      }
      const helper = checker.getSymbolAtLocation(n.expression);
      if (!isTscHelper(helper === undefined ? undefined : checker.declarationsOf(helper)[0])) return why(sf, n, "not tsc helper");
      // The module the specifier names: the checker resolves a JS `require("m")` to the module's symbol.
      const spec = checker.getSymbolAtLocation(inner.arguments[0]!) ?? checker.getTypeAtLocation(inner).getSymbol();
      const depSf = spec === undefined ? undefined : checker.declarationsOf(spec).find(ts.isSourceFile);
      const stamped = depSf !== undefined && stampedCommonJs(depSf);
      {
        process.stderr.write(`[importdefault] ${sf.fileName}:${n.getStart()} dep=${depSf?.fileName ?? "unresolved"} stamped=${stamped}\n`);
      }
      if (!stamped) return undefined;
      pins.push({
        start: n.getStart(),
        end: n.getEnd(),
        text: n.getText(),
        why: `tsc's __importDefault of the stamped CommonJS module ${depSf.fileName} is the module itself`,
        replacement: inner.getText(),
      });
      return undefined;
    });
    if (pins.length > 0) out.set(sf.fileName, pins);
  }
  return out;
}
