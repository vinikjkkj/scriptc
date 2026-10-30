// Class method: a rejected await inside try; the string written after the
// await must not be visible on the catch path.
class K {
  async m(): Promise<string> {
    let state = 'start';
    try {
      await Promise.reject(new Error('method'));
      state = 'after-await';
    } catch (e: any) {
      console.log('caught method', e.message);
    }
    return state;
  }
}
new K().m().then((v) => console.log('method result', v));
