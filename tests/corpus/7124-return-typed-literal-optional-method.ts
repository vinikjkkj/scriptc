// The record literal contextually typed by a RETURN TYPE, not by a const
// annotation -- zapo media-utils' createMediaProcessor shape, five async
// methods each taking an optional trailing context.
//
// The value rule reads the target through getContextualType, and a
// MethodDeclaration is not an Expression, so it was handed null and every
// such method fenced. The literal itself has a contextual type from any
// route the checker knows -- a const annotation, a return type, a
// parameter slot -- and the member is its property; this pins the return
// route and the async form beside it.
interface Ctx { readonly tag: string }
interface Proc {
  plain(a: string, n: number): Promise<string>;
  withCtx(a: string, n: number, ctx?: Ctx): Promise<string>;
}

function make(prefix: string): Proc {
  return {
    async plain(a: string, n: number): Promise<string> {
      return prefix + a + String(n);
    },
    async withCtx(a: string, n: number, ctx?: Ctx): Promise<string> {
      return prefix + a + String(n) + '|' + (ctx === undefined ? 'none' : ctx.tag);
    },
  };
}

async function main(): Promise<void> {
  const p = make('p:');
  console.log(await p.plain('a', 1));
  console.log(await p.withCtx('b', 2));
  console.log(await p.withCtx('c', 3, { tag: 't' }));
  console.log(await p.withCtx('d', 4, undefined));
  console.log(await p.withCtx('e', 5));
}
void main();
