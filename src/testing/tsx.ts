/**
 * `node --import ./src/testing/tsx.ts`: module hooks for the tests. Node runs `.ts` by
 * itself but not `.tsx`, so a `.tsx` file is compiled here with the Oxc transform of
 * Rolldown — what Vite builds the app with — with an inline source map, so coverage
 * is reported against the `.tsx` lines. A JSON import without `with { type: "json" }`
 * (the way Vite takes them) becomes a module with a default export.
 */
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { transformSync } from "rolldown/experimental";

registerHooks({
  load(url, context, next) {
    if (url.startsWith("file:") && url.endsWith(".tsx")) {
      const file = fileURLToPath(url);
      const out = transformSync(file, readFileSync(file, "utf8"), {
        lang: "tsx",
        sourceType: "module",
        jsx: { runtime: "automatic" },
        sourcemap: true,
      });
      if (out.errors.length) throw new Error(file + ": " + out.errors.map((e) => e.message).join("\n"));
      const map = Buffer.from(JSON.stringify(out.map)).toString("base64");
      return {
        format: "module",
        source: out.code + "\n//# sourceMappingURL=data:application/json;base64," + map + "\n",
        shortCircuit: true,
      };
    }
    if (url.startsWith("file:") && url.endsWith(".json") && context.importAttributes?.type !== "json") {
      return { format: "module", source: "export default " + readFileSync(fileURLToPath(url), "utf8") + ";\n", shortCircuit: true };
    }
    return next(url, context);
  },
});
