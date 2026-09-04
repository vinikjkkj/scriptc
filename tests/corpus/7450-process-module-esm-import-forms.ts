// The ESM spellings of node's `process` MODULE, which is the `process`
// GLOBAL under a module specifier.
//
// @types/node declares it as `export = process` over the global variable,
// so a namespace or default binding of "process" / "node:process" names
// that one object — there is no separate module value to model. The CJS
// spelling `const process = require('node:process')` was already admitted
// and aliased to the global surface (surfaces.ts stdlibGlobalAliasDecl,
// preflight's processModuleAliasRequire7); the ESM spellings were not, and
// met the flat SC1010 "the 'process' module is not supported yet" — a
// refusal for reads that lower perfectly well through the same surface as
// the bare global.
//
// mongodb's src/cmap/handshake/client_metadata.ts opens with
//
//     import * as process from 'process'
//
// and then reads process.platform, process.arch, process.env and
// process.versions — the SHADOWING namespace form, where the imported name
// is spelled the same as the global it aliases. That is r02..r06 here.
//
// Rows: the shadowing namespace import (r01..r06); a namespace import
// under a DIFFERENT name, so the global stays reachable beside it and the
// two are shown to be the same object's surface (r07..r10); the bare
// side-effect import, which binds nothing and must lower to nothing
// (r11); and the node:-prefixed and bare specifiers agreeing (r12).
//
// Everything printed is host-independent: identities and shapes are
// compared against the os module and against typeof, never printed raw,
// so the native binary and node produce the same bytes on any host.
//
// What is NOT admitted, and stays fenced: a NAMED binding (`import { env }
// from 'process'`) binds a member rather than the object, and a member
// binding has no receiver for the surface to lower through — the same line
// the require form draws at a destructuring pattern. DESTRUCTURING the
// namespace binding at a use site (`const { platform } = process`) is that
// same line and keeps its refusal; both are pinned in
// tests/diagnostics/process-module-import-fences.ts.

import * as process from 'process'
import * as nodeProc from 'node:process'
import 'node:process'
import { platform as osPlatform, EOL } from 'os'

function yes(label: string, ok: boolean): void {
    console.log(label + ' ' + String(ok))
}

// ── the shadowing namespace form, mongodb's spelling ────────────────────
yes('r01 object', typeof process === 'object')
yes('r02 platform', process.platform === osPlatform())
yes('r03 arch', process.arch.length > 0)
yes('r04 env', typeof process.env === 'object')
yes('r05 versions', process.versions.node.length > 0)
yes('r06 argv', process.argv.length >= 2)

// A read of an absent environment variable is `undefined` through the
// module binding exactly as through the global.
const absent = process.env['SCRIPTC_ABSENT_7450']
yes('r07 absent-env', absent === undefined)

// ── a namespace import under its own name ───────────────────────────────
// The global is shadowed in this file, so `nodeProc` is how the same
// object is reached beside it. Both bindings are the one process object:
// every member answers identically.
yes('r08 same-platform', nodeProc.platform === process.platform)
yes('r09 same-arch', nodeProc.arch === process.arch)
yes('r10 same-versions', nodeProc.versions.node === process.versions.node)
yes('r11 same-argv0', nodeProc.argv[0] === process.argv[0])

// ── the bare side-effect import binds nothing ───────────────────────────
// `import 'node:process'` above contributes no binding and no statement;
// the program still runs, which is the whole assertion.
yes('r12 side-effect-import-ran', true)

// The two specifiers name one module.
yes('r13 specifiers-agree', nodeProc.platform === osPlatform() && process.arch === nodeProc.arch)

yes('r14 eol', EOL.length >= 1)
