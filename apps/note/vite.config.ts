import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// 新人向けアプリ。公開先は Firebase Hosting の /note/（firebase/public/note に出す）。
// Firebase の設定は、NOTE_CONFIG で指定したファイルから読む（指定がなければ、練習用の環境の設定）。
const cfgPath = process.env.NOTE_CONFIG ? resolve(process.env.NOTE_CONFIG) : resolve(__dirname, "../../firebase/config.emulator.json");
const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
export default defineConfig({
  base: "/note/",
  define: { __FB__: JSON.stringify({ config: cfg.config, emulator: cfg.emulator || null }), __DEMO__: "false" },
  build: { outDir: "../../firebase/public/note", emptyOutDir: true, target: "es2022" },
  test: { include: ["tests/**/*.test.ts"] },
});
