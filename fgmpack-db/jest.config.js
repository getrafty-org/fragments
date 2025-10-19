module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  moduleNameMapper: {
    '^fgmpack-protocol$': '<rootDir>/../protocol/src/index.ts'
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/__tests__/**/*.ts'
  ]
};
