// Upstream ships no ESLint config (its `test` is a prettier check); the port
// lints with the workspace's shared config. The template's server actions
// swallow errors with `catch (e)` and answer a message instead, which is kept
// as written.
import config from "../../tooling/eslint/index.js";

export default [
  ...config,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
];
