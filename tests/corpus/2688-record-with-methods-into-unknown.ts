// A record carrying FUNCTION fields flowing into an `unknown` parameter --
// the shape a teardown helper takes when it probes for an optional method.
// A plain record already converted; any function field refused it, because
// the per-type to-dyn converter has no case for a closure. The record walker
// now boxes each field through the same path a bare function takes, which is
// the union-arm rule one container over.
type Store = {
  readonly clear: () => Promise<void>;
  readonly count: number;
  readonly name: string;
};

type Destroyable = { destroy: () => Promise<void> };

function hasDestroy(v: unknown): v is Destroyable {
  return typeof v === "object" && v !== null && "destroy" in v;
}

async function destroyIfSupported(value: unknown): Promise<void> {
  if (!hasDestroy(value)) {
    console.log("no destroy");
    return;
  }
  await value.destroy();
}

let torn = 0;

const plain: Store = {
  clear: async () => {},
  count: 1,
  name: "plain",
};

const withDestroy = {
  clear: async (): Promise<void> => {},
  destroy: async (): Promise<void> => {
    torn += 1;
  },
  count: 2,
  name: "teardown",
};

async function main(): Promise<void> {
  await destroyIfSupported(plain);
  await destroyIfSupported(withDestroy);
  console.log(torn, plain.name, withDestroy.count);

  // The boxed value keeps its data fields readable through the dyn side.
  const asUnknown: unknown = plain;
  console.log(typeof asUnknown);
}

void main();
