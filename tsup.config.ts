import { defineConfig } from "tsup";

export default defineConfig(() => {
  const entry = ["src/index.ts"];
  const external = ["react", "react-dom"];
  const target = "es2019";

  return [
    // cjs.dev.js
    {
      entry,
      format: "cjs",
      sourcemap: true,
      external,
      target,
      dts: true,
    },

    // esm + d.ts
    {
      entry,
      format: "esm",
      sourcemap: true,
      external,
      target,
      dts: true,
    },
  ];
});

