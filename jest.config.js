/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['dist/test'],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest'
  }
}
