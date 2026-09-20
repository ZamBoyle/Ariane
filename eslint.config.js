'use strict';

/**
 * Three environments live in this repo and they must not bleed into each other:
 * the Node core and Electron main process, the sandboxed renderer (browser
 * globals only), and the test suite.
 */

const nodeGlobals = {
  require: 'readonly', module: 'writable', exports: 'writable',
  process: 'readonly', __dirname: 'readonly', __filename: 'readonly',
  console: 'readonly', Buffer: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', URL: 'readonly',
};

const browserGlobals = {
  window: 'readonly', document: 'readonly', console: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', HTMLElement: 'readonly',
};

const shared = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-var': 'error',
  'prefer-const': 'error',
  eqeqeq: ['error', 'smart'],
  'no-implicit-globals': 'error',
  'no-throw-literal': 'error',
};

module.exports = [
  {
    files: ['src/core/**/*.js', 'src/main/**/*.js', 'src/preload/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules: shared,
  },
  {
    // The renderer is sandboxed: no Node globals are available to it.
    files: ['src/renderer/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: browserGlobals,
    },
    rules: shared,
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...nodeGlobals, ...browserGlobals },
    },
    rules: shared,
  },
];
