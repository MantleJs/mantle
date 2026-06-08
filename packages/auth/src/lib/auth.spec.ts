import { auth } from './auth.js';

describe('auth', () => {
  it('should work', () => {
    expect(auth()).toEqual('auth');
  });
});
