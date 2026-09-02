export default [
  {
    ignores: ["node_modules/**", ".e2e-artifacts/**", ".e2e-state/**"],
  },
  {
    files: ["bin/**/*.js", "src/**/*.js", "test/**/*.js", "test/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        AbortSignal: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        WebSocket: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
        setTimeout: "readonly"
      }
    },
    rules: {
      complexity: ["error", 30],
      eqeqeq: "error",
      "no-constant-condition": ["error", { "checkLoops": false }],
      "no-undef": "error",
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_", "caughtErrors": "none" }]
    }
  },
  {
    files: ["test/fixtures/app/**/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        FormData: "readonly",
        window: "readonly"
      }
    }
  }
];
