import { defineConfig } from "vite";
import { resolve } from "node:path";
// 見本版（Claudeのアプリで開く版）。Firebase の代わりに demo/ を使い、データはこの端末の中に置く。
// 作り方: npx vite build --config vite.demo.config.ts → dist-demo/
const d = (f: string) => resolve(__dirname, "demo", f);
export default defineConfig({
  base: "./",
  define: { __FB__: JSON.stringify({ config: {}, emulator: null }), __DEMO__: "true" },
  resolve: { alias: { "firebase/app": d("app.ts"), "firebase/auth": d("auth.ts"), "firebase/firestore": d("firestore.ts"), "firebase/functions": d("functions.ts"), "firebase/storage": d("storage.ts") } },
  build: { outDir: "dist-demo", emptyOutDir: true, target: "es2022" },
});
