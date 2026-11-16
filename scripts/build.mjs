import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
for (const path of ["styles.css", "full-view"]) {
  await cp(path, `dist/${path}`, { recursive: true });
}
await cp("full-view/index.html", "dist/index.html");
