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
import * as ts from "./ts7/adapter.js";
import type { RetypePin } from "./retype-pin.js";

const STAMP = /^\s*Object\.defineProperty\(\s*exports\s*,\s*["']__esModule["']\s*,\s*\{\s*value\s*:\s*true\s*\}\s*\)\s*;?\s*$/;
const MODULE_EXPORTS_ASSIGN = /\bmodule\.exports\s*=[^=]/;

/** Is `sf` a CommonJS source whose own first export action is the interop stamp, with no replacement of module.exports? */
function stampedCommonJs(sf: ts.SourceFile): boolean {
  if (sf.isDeclarationFile || !/\.(c|m)?js$/.test(sf.fileName)) return false;
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

export function computeImportDefaultPins(program: ts.Program): Map<string, RetypePin[]> {
  const checker = program.getTypeChecker();
  const out = new Map<string, RetypePin[]>();
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || !/\.(c|m)?js$/.test(sf.fileName) || !sf.text.includes("__importDefault(")) continue;
    if (/[\\/]node_modules[\\/]typescript[\\/]/.test(sf.fileName)) continue;
    const pins: RetypePin[] = [];
    ts.walkPreorder(sf, (n) => {
      if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression) || n.expression.text !== "__importDefault") return undefined;
      if (n.arguments.length !== 1) return undefined;
      let inner: ts.Expression = n.arguments[0]!;
      // `__importDefault(__sc_r0)` after the loader hoisted the require: the argument names a const bound to it.
      if (ts.isIdentifier(inner)) {
        const sym = checker.getSymbolAtLocation(inner);
        const d = sym === undefined ? undefined : checker.declarationsOf(sym)[0];
        if (d === undefined || !ts.isVariableDeclaration(d) || d.initializer === undefined) return undefined;
        inner = d.initializer;
      }
      if (
        !ts.isCallExpression(inner) || !ts.isIdentifier(inner.expression) || inner.expression.text !== "require" ||
        inner.arguments.length !== 1 || !ts.isStringLiteral(inner.arguments[0]!)
      ) {
        return undefined;
      }
      const helper = checker.getSymbolAtLocation(n.expression);
      if (!isTscHelper(helper === undefined ? undefined : checker.declarationsOf(helper)[0])) return undefined;
      // The module the specifier names: the checker resolves a JS `require("m")` to the module's symbol.
      const spec = checker.getSymbolAtLocation(inner.arguments[0]!) ?? checker.getTypeAtLocation(inner).getSymbol();
      const depSf = spec === undefined ? undefined : checker.declarationsOf(spec).find(ts.isSourceFile);
      const stamped = depSf !== undefined && stampedCommonJs(depSf);
      if (process.env["SCRIPTC_IMPORT_DEFAULT_WHY"] !== undefined) {
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
