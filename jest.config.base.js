/* eslint-disable @typescript-eslint/no-var-requires */
// const { pathsToModuleNameMapper } = require("ts-jest/utils");
// const { compilerOptions } = require("./tsconfig");

// eslint-disable-next-line no-undef
module.exports = {
  preset: "ts-jest",
  testMatch: ["**/+(*.)+(spec|test).+(ts)?(x)"],
  transform: {
    "^.+\\.(ts)$": "ts-jest",
  },
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "html"],
  coverageReporters: ["lcov", "text"],
  coverageThreshold: {
    global: {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: -5,
    },
  },
  // testEnvironment: "node",
  moduleNameMapper: {
    "^@mantlejs/(.*)$": "<rootDir>/packages/$1/src",
  },
  // moduleNameMapper: {
  //   ...pathsToModuleNameMapper(compilerOptions.paths),
  // },
  verbose: true,
};
