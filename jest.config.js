const tsJestPreset = require('ts-jest/jest-preset');
const localstackPreset = require('@thadeu/jest-localstack-preset');

module.exports = {
  ...tsJestPreset,
  ...localstackPreset,
  testEnvironment: 'node',
  testPathIgnorePatterns: ['<rootDir>/dist'],
  setupFiles: ['./jest.setup.js'],
};
