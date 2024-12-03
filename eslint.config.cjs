// import globals from "globals";
const globals = require("globals");
const pluginJs = require("@eslint/js");
// import pluginJs from "@eslint/js";

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  { files: ["**/*.js"], languageOptions: { sourceType: "script" } },
  { languageOptions: { globals: globals.browser } },
  pluginJs.configs.recommended,
];
