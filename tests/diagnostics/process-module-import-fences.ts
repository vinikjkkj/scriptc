/* The two `process`-module import shapes that stay refused, beside the
 * ones that lower (tests/corpus/7450-process-module-esm-import-forms.ts).
 *
 * The module IS the global — @types/node and the shipped fallback both
 * declare it `export = process` over the same variable — so a NAMESPACE
 * or DEFAULT binding names that object and its member reads lower through
 * the process surface. What the surface needs is the RECEIVER.
 *
 *  - a NAMED import binds a member, not the object: there is no receiver
 *    left for the read to lower through. This is the line the CommonJS
 *    spelling already drew at a destructuring pattern
 *    (processModuleAliasRequire7 admits `const process = require(...)`
 *    and refuses `const { env } = require(...)`);
 *  - DESTRUCTURING the namespace binding at a use site is that same line
 *    one statement later, and keeps the same refusal.
 *
 * Both are pinned here so that admitting the namespace form cannot later
 * turn either of them into a silent answer.
 *
 * KNOWN WORDING GAP, pinned as it is rather than papered over: the
 * message below says the module "is not supported yet", which is no
 * longer the true reason — the module is supported, and what has no
 * static representation is the process OBJECT taken as a value (the bare
 * global `const { platform } = process` says exactly that, with SC2020).
 * The use-site fence routes through fencedBuiltinImportOf, which claims
 * any builtin specifier with no canonical module and so claims this one.
 * The same imprecision has always applied to the admitted CommonJS
 * spelling. Fixing it means teaching the value paths that this binding is
 * a registered stdlib-global alias, which is a lowering change, not a
 * preflight one — and until then a refusal with an imperfect reason is
 * the right side of the line to be on.
 */
import * as proc from 'node:process'

const { platform } = proc
console.log(platform)
