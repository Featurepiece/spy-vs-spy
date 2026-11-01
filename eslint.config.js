export default [
  {
    files: ['src/**/*.js', 'tests/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { window: 'readonly', document: 'readonly', navigator: 'readonly', localStorage: 'readonly', location: 'readonly', URLSearchParams: 'readonly', performance: 'readonly', requestAnimationFrame: 'readonly', matchMedia: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', URL: 'readonly', crypto: 'readonly', WebSocket: 'readonly', console: 'readonly', process: 'readonly' },
    },
    rules: { 'no-unused-vars': 'warn', 'no-undef': 'error' },
  },
];
