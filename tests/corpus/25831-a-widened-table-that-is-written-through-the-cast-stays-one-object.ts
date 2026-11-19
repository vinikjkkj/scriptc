// CONTROL for the read-only rule: the same cast, but a member is WRITTEN through the wide name. Node has one object, so the source name sees the write.
// With the write census switched off (SCRIPTC_RECORD_WIDTH_MUTANT=ignorewrites) the cast becomes a copy and this row prints the old values.
interface Wide { code: number; type: string; defaultValue: string | number | boolean }
const table = {
  alpha: { code: 21, type: "bool", defaultValue: false },
  beta: { code: 22, type: "int", defaultValue: 7 },
}
const wide = table as Record<"alpha" | "beta", Wide>
wide.alpha.code = 99
wide.beta.type = "changed"
console.log(table.alpha.code, table.beta.type, wide.alpha.code, wide.beta.type)
