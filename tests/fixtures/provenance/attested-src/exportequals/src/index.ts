// The saslprep shape: a function with expando members, then `export =`.
// Consumers read the members by name (`{ saslprep }`), by default, and
// through the function object itself.
function saslprep(input: string, opts?: { allowUnassigned?: boolean }): string {
  return opts && opts.allowUnassigned ? input + "!" : input.toUpperCase();
}
saslprep.saslprep = saslprep;
saslprep.default = saslprep;
saslprep.tag = "tagged";
export = saslprep;
