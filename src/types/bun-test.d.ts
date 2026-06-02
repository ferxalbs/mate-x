declare module 'bun:test' {
  export {
    after,
    afterEach,
    before,
    beforeEach,
    describe,
    it,
    mock,
    test,
  } from 'node:test';

  export { strict as expect } from 'node:assert';
}
