/* Hand-written exercise of the runtime API, shaped like emitted code:
 * interned literals, RC discipline (every temp owned, released at statement
 * end), console.log. Run under -DSCR_RC_AUDIT + ASan by runtime.test.ts.
 *
 * Expected stdout:
 *   hello world
 *   n = 0.30000000000000004 flag = true
 *   hellohello 10
 *   true
 */
#include "../src/scr_runtime.h"

static SCR_STR_LIT(6) lit_hello = {SCR_STR_IMMORTAL, 5, 5, "hello"};
static SCR_STR_LIT(6) lit_world = {SCR_STR_IMMORTAL, 5, 5, "world"};
static SCR_STR_LIT(5) lit_n_eq = {SCR_STR_IMMORTAL, 4, 4, "n = "};
static SCR_STR_LIT(8) lit_flag = {SCR_STR_IMMORTAL, 7, 7, " flag ="};

int main(void) {
  scr_init();

  /* console.log("hello", "world") */
  {
    ScrLogArg args[2];
    args[0].tag = SCR_ARG_STR;
    args[0].v.s = (ScrStr *)&lit_hello;
    args[1].tag = SCR_ARG_STR;
    args[1].v.s = (ScrStr *)&lit_world;
    scr_console_log(2, args);
  }

  /* const msg = `n = ${0.1 + 0.2}`; console.log(msg + " flag =", true) */
  {
    ScrStr *t0 = scr_f64_to_scrstr(0.1 + 0.2);
    ScrStr *t1 = scr_str_concat((ScrStr *)&lit_n_eq, t0);
    ScrStr *t2 = scr_str_concat(t1, (ScrStr *)&lit_flag);
    ScrLogArg args[2];
    args[0].tag = SCR_ARG_STR;
    args[0].v.s = t2;
    args[1].tag = SCR_ARG_BOOL;
    args[1].v.b = true;
    scr_console_log(2, args);
    scr_str_release(t2);
    scr_str_release(t1);
    scr_str_release(t0);
  }

  /* let s = "hello"; s = s + s; console.log(s + " ", 10) — reassignment RC */
  {
    ScrStr *s = scr_str_retain((ScrStr *)&lit_hello);
    ScrStr *t0 = scr_str_concat(s, s);
    scr_str_release(s);
    s = t0; /* ownership moved */
    ScrLogArg args[2];
    args[0].tag = SCR_ARG_STR;
    args[0].v.s = s;
    args[1].tag = SCR_ARG_F64;
    args[1].v.f = 10;
    scr_console_log(2, args);
    scr_str_release(s);
  }

  /* console.log("hello" + "" === "hello") via eq on fresh heap copy */
  {
    ScrStr *heap = scr_str_new("hello", 5);
    ScrLogArg arg;
    arg.tag = SCR_ARG_BOOL;
    arg.v.b = scr_str_eq(heap, (ScrStr *)&lit_hello);
    scr_console_log(1, &arg);
    scr_str_release(heap);
  }

  return 0;
}
