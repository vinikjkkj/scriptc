function saslprep(input: string, opts?: { allowUnassigned?: boolean }): string {
  return opts && opts.allowUnassigned ? input + "!" : input.toUpperCase();
}
saslprep.saslprep = saslprep;
saslprep.default = saslprep;
saslprep.tag = "tagged";
export = saslprep;
