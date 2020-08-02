/* eslint-disable @typescript-eslint/no-var-requires, no-undef */
const pack = require("./package");
const base = require("../../jest.config.base");
const removeScope = require("remove-scope").removeScope;

module.exports = {
  ...base,
  name: pack.name,
  displayName: pack.name,
  rootDir: "../..",
  testMatch: [`<rootDir>/packages/${removeScope(pack.name)}/**/+(*.)+(spec|test).+(ts|js)?(x)`],
  globals: {
    "ts-jest": {
      tsConfig: `<rootDir>/packages/${removeScope(pack.name)}/tsconfig.spec.json`,
    },
  },
};
