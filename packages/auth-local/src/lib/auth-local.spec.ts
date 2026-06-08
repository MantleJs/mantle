import { authLocal } from './auth-local.js';

describe('authLocal', () => {
  it('should work', () => {
    expect(authLocal()).toEqual('auth-local');
  });
});
