// eslint-disable-next-line no-undef
module.exports = {
  preset: "./jest.config.base.js",
  projects: ["<rootDir>/packages/*/jest.config.js"],
  coverageDirectory: "<rootDir>/coverage/",
};
