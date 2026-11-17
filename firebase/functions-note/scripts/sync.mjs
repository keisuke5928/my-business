// 新人向けアプリ（apps/note）と同じ処理と設定を、サーバー側でも使うために写す。
// 直すのは apps/note のほう。ここに写したもの（src/shared、src/config）は手で直さない。
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url)), app = join(here, "../../../apps/note");
for (const d of ["shared", "config"]) { rmSync(join(here, "../src", d), { recursive: true, force: true }); mkdirSync(join(here, "../src", d), { recursive: true }); }
for (const f of ["normalize.ts", "danger.ts", "pii.ts", "dates.ts", "ai.ts"]) cpSync(join(app, "src/lib", f), join(here, "../src/shared", f));
for (const f of ["limits.json", "ai.json", "skeleton.json", "events.json", "copy.json"]) cpSync(join(app, "config", f), join(here, "../src/config", f));
