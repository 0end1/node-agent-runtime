// ESLint 9 flat config（M6 P2.2）
// 分工：ESLint 只管「正确性 / 一致性」，代码格式交给 Prettier（见 .prettierrc）。
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "examples/desktop-tauri/src-tauri/**",
      "examples/desktop-tauri/dist/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      // 引擎契约层大量使用 any（工具参数 / JSON payload / 远端 schema），按项目口径放宽
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-empty-object-type": "off",
      // TS 已做类型检查（npm run typecheck），避免与 tsc 重复报错
      "no-undef": "off",
    },
  },
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
);
