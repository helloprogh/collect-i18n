import { defineConfig } from "tsup";

// Optional engines that @vue/compiler-sfc lazily require()s inside try/catch
// (only used for non-default <template lang="...">), plus playwright-core's
// optional WebDriver BiDi bridge (the collector drives Chrome over CDP). They
// are never invoked at runtime, so leaving them as unresolved external requires
// is safe and keeps them out of the bundle.
const optionalExternals = [
  "chromium-bidi",
  "atpl", "babel-core", "bracket-template", "coffee-script", "dot",
  "dustjs-linkedin", "eco", "ect", "ejs", "haml-coffee", "hamlet", "hamljs",
  "handlebars", "hogan.js", "htmling", "jazz", "jqtpl", "just", "liquor",
  "marko", "mote", "mustache", "plates", "ractive", "react", "react-dom",
  "slm", "squirrelly", "teacup", "templayed", "toffee", "twig", "twing",
  "underscore", "vash", "velocityjs", "walrus", "whiskers",
];

export default defineConfig({
  entry: ["src/bin.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "bundle",
  clean: true,
  splitting: false,
  sourcemap: false,
  dts: false,
  // Inline the workspace packages + commander (tsup would otherwise externalize
  // them as direct dependencies). Their transitive pure-JS deps are bundled too.
  noExternal: [
    "@collect-i18n/analyzer",
    "@collect-i18n/core",
    "@collect-i18n/excel",
    "@collect-i18n/runner",
    "@collect-i18n/runtime",
    "@collect-i18n/vite-vue",
    "commander",
  ],
  external: ["playwright-core", "vite", ...optionalExternals],
  banner: {
    js: "import { createRequire as __collectI18nCreateRequire } from 'node:module';const require = __collectI18nCreateRequire(import.meta.url);",
  },
});