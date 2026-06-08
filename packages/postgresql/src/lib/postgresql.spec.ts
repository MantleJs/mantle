import { postgresql } from './postgresql.js';

describe('postgresql', () => {
  it('should work', () => {
    expect(postgresql()).toEqual('postgresql');
  });
});
