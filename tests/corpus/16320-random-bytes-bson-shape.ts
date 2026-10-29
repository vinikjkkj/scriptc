// The bson random-bytes shape (node_byte_utils.ts, web_byte_utils.ts): a
// cast of globalThis destructures `crypto` from it, tests `crypto != null`
// and `typeof crypto.getRandomValues === 'function'`, and fills a fresh typed
// array through the destructured binding. The values are random, so the
// program prints only lengths and classes.
type NodeJsBuffer = Uint8Array;
const nodeJsByteUtils = {
  allocate(byteLength: number): NodeJsBuffer {
    return new Uint8Array(byteLength);
  },
  fromNumberArray(a: number[]): NodeJsBuffer {
    return Uint8Array.from(a);
  },
};

function nodejsMathRandomBytes(byteLength: number): NodeJsBuffer {
  return nodeJsByteUtils.fromNumberArray(
    Array.from({ length: byteLength }, () => Math.floor(Math.random() * 256))
  );
}

const { crypto: secureWebCrypto } = globalThis as {
  crypto?: { getRandomValues?: (space: Uint8Array) => Uint8Array };
};
function nodejsSecureRandomBytes(byteLength: number): NodeJsBuffer {
  // @ts-expect-error: crypto.getRandomValues cannot actually be null here
  return secureWebCrypto.getRandomValues(nodeJsByteUtils.allocate(byteLength));
}

const nodejsRandomBytes = (() => {
  const { crypto } = globalThis as {
    crypto?: { getRandomValues?: (space: Uint8Array) => Uint8Array };
  };
  if (crypto != null && typeof crypto.getRandomValues === 'function') {
    return nodejsSecureRandomBytes;
  } else {
    return nodejsMathRandomBytes;
  }
})();

const webRandomBytes: (byteLength: number) => Uint8Array = (() => {
  const { crypto } = globalThis as {
    crypto?: { getRandomValues?: (space: Uint8Array) => Uint8Array };
  };
  if (crypto != null && typeof crypto.getRandomValues === 'function') {
    return (byteLength: number) => {
      // @ts-expect-error: crypto.getRandomValues cannot actually be null here
      return crypto.getRandomValues(new Uint8Array(byteLength));
    };
  } else {
    return nodejsMathRandomBytes;
  }
})();

const a = nodejsRandomBytes(16);
const b = webRandomBytes(7);
console.log(a.length, a instanceof Uint8Array, b.length, b instanceof Uint8Array);
export {};
