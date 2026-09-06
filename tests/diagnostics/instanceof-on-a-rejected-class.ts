// `instanceof` whose LEFT operand's class was REJECTED. The right-hand
// spelling has always poisoned this site; the left one reached a bare
// `throw new Error("lowerer bug: ...")` instead, so a single refused class
// plus a PARAMETER typed as it aborted the whole analysis and the program
// reported NOTHING -- strictly worse than the fence it stood in for. Found
// on mongodb's `operations/` tree, where every subclass of the generic
// `CommandOperation` is rejected at its `extends` clause and
// `execute_operation.ts`'s `operation instanceof AbstractOperation`
// arrives with one of them as its static type.
//
// A PARAMETER is what makes it reachable: `new Bad()` poisons at the
// construction, so a locally built value never gets that far, while a
// parameter takes its type from the checker and arrives naming a class
// the lowering never registered.

const k = "dyn" + String(1);

class Base {
  tag = 1;
}

// Rejected: a computed field name.
class Bad extends Base {
  [k]: number = 2;
}

// The NAMED-target spelling.
function isBase(x: Bad): boolean {
  return x instanceof Base;
}

// The class-VALUE target spelling: the target's own lookup was already
// guarded, the operand's was not.
const C: typeof Base = Base;
function isBaseValue(x: Bad): boolean {
  return x instanceof C;
}

// Two statements: a poisoned construction ends the one it stands in, so a
// single `console.log` of both calls would leave the second function
// unreached -- and an unreached body never lowers, which is exactly how a
// site like this stays invisible until a real program reaches it.
console.log(isBase(new Bad()));
console.log(isBaseValue(new Bad()));
