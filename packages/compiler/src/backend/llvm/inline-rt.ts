/* Runtime helpers the C emission gets as `static inline` from scr_runtime.h and the LLVM lane used to CALL out of line, one call per use.
 * The .ll and the runtime are separate translation units under one clang -O2 with no LTO, so a callee that lives in the runtime is never
 * inlined into the program, whatever its size. Measured on the redis bench (main 18ec1be0c, one runner, LLVM vs C): 134M calls to the
 * scr_*_retain_v adapters and 135M to scr_bytes_get_fast / scr_bytes_set_fast, each a call, a return and the caller's live floating-point
 * registers spilled around it. The finished module text is rewritten here in one place, like strunion.ts: a DIRECT call of the adapter becomes a
 * call of an `internal alwaysinline` copy of the header body defined at the end of the module. An adapter whose address is taken (the arm
 * descriptors, container RC tables) is not a call and keeps the runtime's symbol, so descriptor identity is untouched.
 *
 * Every layout number below is proved against scr_runtime.h by runtime-layout.test.ts (RUNTIME_FIELD_OFFSETS). The bodies are the headers'
 * bodies, line for line; the slow arm of the byte accessors calls the same out-of-line function as before, so every trap and every rare index
 * still goes through the one implementation. Not applied to an audit (--sanitize) build: scr_arr_retain checks the dead-source tombstone there. */

import { CYC_COLOR_OFF_FROM_OBJ } from "./shapes.js";
import { SCR_ARR_ELEM_TRACE_OFFSET, SCR_BYTES_DATA_OFFSET, SCR_BYTES_ELEM_OFFSET, SCR_BYTES_LEN_OFFSET } from "./runtime-layout.js";

const ATTR = "alwaysinline nounwind";
const TWO53 = "0x4340000000000000";
const TWO63 = "0x43E0000000000000";
const NEG2P63 = "0xC3E0000000000000";

/** rc at offset 0 (size_t, SIZE_MAX = immortal) then, for a cycle-headered type, mark live (color byte at obj-8), optionally only when the
 *  pointer at `guardOff` is non-null (an array marks only when it has an element trace). */
function wordRetain(name: string, mark: "none" | "always" | "traced-array"): string[] {
  const o = [
    `define internal ptr @sc_inl_${name}_retain(ptr %o) ${ATTR} {`,
    `entry:`,
    `  %rc = load i64, ptr %o`,
    `  %imm = icmp eq i64 %rc, -1`,
    `  br i1 %imm, label %done, label %inc`,
    `inc:`,
    `  %n = add i64 %rc, 1`,
    `  store i64 %n, ptr %o`,
  ];
  if (mark === "none") o.push(`  br label %done`);
  else if (mark === "always") o.push(`  %cp = getelementptr i8, ptr %o, i64 ${CYC_COLOR_OFF_FROM_OBJ}`, `  store i8 0, ptr %cp`, `  br label %done`);
  else {
    o.push(
      `  %tp = getelementptr i8, ptr %o, i64 ${SCR_ARR_ELEM_TRACE_OFFSET}`,
      `  %tr = load ptr, ptr %tp`,
      `  %has = icmp ne ptr %tr, null`,
      `  br i1 %has, label %mark, label %done`,
      `mark:`,
      `  %cp = getelementptr i8, ptr %o, i64 ${CYC_COLOR_OFF_FROM_OBJ}`,
      `  store i8 0, ptr %cp`,
      `  br label %done`,
    );
  }
  o.push(`done:`, `  ret ptr %o`, `}`);
  return o;
}

const STR_RETAIN = [
  `define internal ptr @sc_inl_str_retain(ptr %o) ${ATTR} {`,
  `entry:`,
  `  %rc = load i32, ptr %o`,
  `  %imm = icmp eq i32 %rc, -1`,
  `  br i1 %imm, label %done, label %inc`,
  `inc:`,
  `  %n = add i32 %rc, 1`,
  `  store i32 %n, ptr %o`,
  `  br label %done`,
  `done:`,
  `  ret ptr %o`,
  `}`,
];

const RETAINS: readonly { sym: string; name: string; body: () => string[] }[] = [
  { sym: "scr_str_retain_v", name: "sc_inl_str_retain", body: () => STR_RETAIN },
  { sym: "scr_bytes_retain_v", name: "sc_inl_bytes_retain", body: () => wordRetain("bytes", "none") },
  { sym: "scr_arr_retain_v", name: "sc_inl_arr_retain", body: () => wordRetain("arr", "traced-array") },
  { sym: "scr_union_retain_v", name: "sc_inl_union_retain", body: () => wordRetain("union", "always") },
  { sym: "scr_closure_retain_v", name: "sc_inl_closure_retain", body: () => wordRetain("closure", "always") },
  { sym: "scr_dyn_retain_v", name: "sc_inl_dyn_retain", body: () => wordRetain("dyn", "always") },
];

/* The remaining `scr_<T>_{retain,release}_v` adapters are a cast around an OUT-OF-LINE function the C emission calls directly: each LLVM call paid
 * a second call level. The two tables below are exactly the adapters of scr_*.c of the form `{ [return] scr_<T>_<op>((<T> *)p); }` whose target is
 * extern in a header and not `static inline` (the inline ones are defined above). test/llvm-inline-rt.test.ts recomputes both tables from the runtime
 * sources, so a new adapter, or an adapter whose target turns inline, fails the test instead of silently missing the pass. */
export const DIRECT_RETAINS: readonly string[] = [
  "scr_abort_signal_retain", "scr_big_retain", "scr_child_retain", "scr_child_stream_retain", "scr_cipher_retain", "scr_date_retain",
  "scr_dgram_retain", "scr_emitter_retain", "scr_error_retain", "scr_event_retain", "scr_fetch_headers_retain", "scr_fetch_init_retain",
  "scr_fh_retain", "scr_gen_retain", "scr_hash_retain", "scr_hmac_retain", "scr_http2_session_retain", "scr_http2_stream_retain",
  "scr_http_client_retain", "scr_http_req_retain", "scr_http_res_retain", "scr_jsval_retain", "scr_keyobj_retain", "scr_map_retain",
  "scr_net_server_retain", "scr_net_sock_retain", "scr_opaque_retain", "scr_promise_retain", "scr_request_retain", "scr_response_retain",
  "scr_secure_ctx_retain", "scr_sp_retain", "scr_spawn_res_retain", "scr_sqlite_db_retain", "scr_sqlite_stmt_retain", "scr_stats_retain",
  "scr_stream_retain", "scr_sym_retain", "scr_testctx_retain", "scr_url_retain", "scr_watcher_retain", "scr_weak_retain",
];
export const DIRECT_RELEASES: readonly string[] = [
  "scr_abort_signal_release", "scr_arr_release", "scr_big_release", "scr_bytes_release", "scr_child_release", "scr_child_stream_release",
  "scr_cipher_release", "scr_closure_release", "scr_date_release", "scr_dgram_release", "scr_dyn_release", "scr_emitter_release",
  "scr_error_release", "scr_event_release", "scr_fetch_headers_release", "scr_fetch_init_release", "scr_fh_release", "scr_gen_release",
  "scr_hash_release", "scr_hmac_release", "scr_http2_session_release", "scr_http2_stream_release", "scr_http_client_release",
  "scr_http_req_release", "scr_http_res_release", "scr_jsval_release", "scr_keyobj_release", "scr_map_release", "scr_net_server_release",
  "scr_net_sock_release", "scr_opaque_release", "scr_promise_release", "scr_regex_release", "scr_request_release", "scr_response_release",
  "scr_secure_ctx_release", "scr_sp_release", "scr_spawn_res_release", "scr_sqlite_db_release", "scr_sqlite_stmt_release",
  "scr_stats_release", "scr_str_release", "scr_stream_release", "scr_sym_release", "scr_testctx_release", "scr_union_release",
  "scr_url_release", "scr_watcher_release", "scr_weak_release",
];

/** The shared test of scr_bytes_{get,set}_inl: 0 <= i < 2^53, n = (int64)i exact, n < len. Leaves %n in `ok`'s dominated block. */
function indexGate(): string[] {
  return [
    `  %ge = fcmp oge double %i, 0.0`,
    `  %lt = fcmp olt double %i, ${TWO53}`,
    `  %in = and i1 %ge, %lt`,
    `  br i1 %in, label %c1, label %slow`,
    `c1:`,
    `  %n = fptosi double %i to i64`,
    `  %back = sitofp i64 %n to double`,
    `  %exact = fcmp oeq double %back, %i`,
    `  %lp = getelementptr inbounds i8, ptr %b, i64 ${SCR_BYTES_LEN_OFFSET}`,
    `  %len = load i64, ptr %lp`,
    `  %inr = icmp ult i64 %n, %len`,
    `  %ok = and i1 %exact, %inr`,
    `  br i1 %ok, label %c2, label %slow`,
    `c2:`,
    `  %ep = getelementptr inbounds i8, ptr %b, i64 ${SCR_BYTES_ELEM_OFFSET}`,
    `  %elem = load i32, ptr %ep`,
    `  %dpp = getelementptr inbounds i8, ptr %b, i64 ${SCR_BYTES_DATA_OFFSET}`,
    `  %data = load ptr, ptr %dpp`,
  ];
}

function bytesGet(undef: boolean): string[] {
  const name = undef ? "sc_inl_bytes_get_undef" : "sc_inl_bytes_get";
  const slow = undef ? "scr_bytes_get_fast_undef" : "scr_bytes_get_fast";
  return [
    `define internal double @${name}(ptr %b, double %i) ${ATTR} {`,
    `entry:`,
    ...indexGate(),
    `  %isf = icmp eq i32 %elem, 4`,
    `  br i1 %isf, label %f64, label %c3`,
    `f64:`,
    `  %off = shl i64 %n, 3`,
    `  %fp = getelementptr i8, ptr %data, i64 %off`,
    `  %fv = load double, ptr %fp, align 1`,
    ...(undef
      ? [`  %nan = fcmp uno double %fv, %fv`, `  %fc = select i1 %nan, double 0x7FF8000000000000, double %fv`, `  ret double %fc`]
      : [`  ret double %fv`]),
    `c3:`,
    `  %isu = icmp eq i32 %elem, 0`,
    `  br i1 %isu, label %u8, label %slow`,
    `u8:`,
    `  %bp = getelementptr i8, ptr %data, i64 %n`,
    `  %bv = load i8, ptr %bp`,
    `  %bd = uitofp i8 %bv to double`,
    `  ret double %bd`,
    `slow:`,
    `  %sv = call double @${slow}(ptr %b, double %i)`,
    `  ret double %sv`,
    `}`,
  ];
}

function bytesSet(): string[] {
  return [
    `define internal void @sc_inl_bytes_set(ptr %b, double %i, double %v) ${ATTR} {`,
    `entry:`,
    ...indexGate(),
    `  %isf = icmp eq i32 %elem, 4`,
    `  br i1 %isf, label %f64, label %c3`,
    `f64:`,
    `  %off = shl i64 %n, 3`,
    `  %fp = getelementptr i8, ptr %data, i64 %off`,
    `  store double %v, ptr %fp, align 1`,
    `  ret void`,
    `c3:`,
    `  %isu = icmp eq i32 %elem, 0`,
    `  %vge = fcmp oge double %v, ${NEG2P63}`,
    `  %vlt = fcmp olt double %v, ${TWO63}`,
    `  %vin = and i1 %vge, %vlt`,
    `  %uok = and i1 %isu, %vin`,
    `  br i1 %uok, label %u8, label %slow`,
    `u8:`,
    `  %vi = fptosi double %v to i64`,
    `  %vb = trunc i64 %vi to i8`,
    `  %bp = getelementptr i8, ptr %data, i64 %n`,
    `  store i8 %vb, ptr %bp`,
    `  ret void`,
    `slow:`,
    `  call void @scr_bytes_set_fast(ptr %b, double %i, double %v)`,
    `  ret void`,
    `}`,
  ];
}

export function inlineRuntimeHelpers(text: string): string {
  let out = text;
  const defs: string[] = [];
  for (const r of RETAINS) {
    const call = `call ptr @${r.sym}(`;
    if (!out.includes(call)) continue;
    out = out.split(call).join(`call ptr @${r.name}(`);
    defs.push(...r.body(), ``);
  }
  const declared = (sym: string): boolean => out.includes(`@${sym}(`) && new RegExp(`^declare [^\\n]* @${sym}\\(`, "m").test(out);
  const extra: string[] = [];
  // The tables hold the TARGETS' full names (scr_big_release), so llvm-runtime-abi.test.ts checks each against its header prototype; the adapter is `<target>_v`.
  for (const [targets, ret] of [[DIRECT_RETAINS, "ptr"], [DIRECT_RELEASES, "void"]] as const) {
    for (const target of targets) {
      const from = `call ${ret} @${target}_v(`;
      if (!out.includes(from)) continue;
      out = out.split(from).join(`call ${ret} @${target}(`);
      if (!declared(target)) extra.push(`declare ${ret} @${target}(ptr)`);
    }
  }
  if (extra.length > 0) out = `${out}\n${extra.join("\n")}\n`;
  const swaps: readonly { from: string; to: string; body: () => string[] }[] = [
    { from: "call double @scr_bytes_get_fast_undef(", to: "call double @sc_inl_bytes_get_undef(", body: () => bytesGet(true) },
    { from: "call double @scr_bytes_get_fast(", to: "call double @sc_inl_bytes_get(", body: () => bytesGet(false) },
    { from: "call void @scr_bytes_set_fast(", to: "call void @sc_inl_bytes_set(", body: () => bytesSet() },
  ];
  for (const s of swaps) {
    if (!out.includes(s.from)) continue;
    out = out.split(s.from).join(s.to);
    defs.push(...s.body(), ``);
  }
  return defs.length === 0 ? out : `${out}\n; runtime helpers inlined into the program, see backend/llvm/inline-rt.ts\n${defs.join("\n")}\n`;
}
