// Launch Radar — Signal v5 (clean rebuild). Entry point.
//
// Reads the sealed DefiLlama snapshot, builds the ranked board with the
// model in lib/model.ts, and writes everything the gate checks:
//   /output/board.json       the ranked board (rows + a small meta block)
//   /output/data.js          the same board, as a script the page loads
//   /output/dashboard/       the page (index.html + app.css + app.js)
//   /output/screenshots/     the three screenshots of that page
//   /output/dossier.json     the dossier buildDossier writes from them
//
// Standard library only. Deterministic: the same input bytes always produce
// the same output bytes — no clock, no randomness, no network.
//
// Run it the way the kit says:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBoard } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

function argValue(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function fail(message: string): never {
  throw new Error("signal-v5: " + message);
}

function copyTree(srcDir: string, dstDir: string): string[] {
  const copied: string[] = [];
  mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      copied.push(...copyTree(join(srcDir, entry.name), join(dstDir, entry.name)));
    } else if (entry.isFile()) {
      writeFileSync(join(dstDir, entry.name), readFileSync(join(srcDir, entry.name)));
      copied.push(join(dstDir, entry.name));
    }
  }
  return copied;
}

function main(): void {
  const inputPath = argValue("--input", "/input/snapshot.json");
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "out";
  const snapshot = JSON.parse(readFileSync(inputPath, "utf8"));
  const board = buildBoard(snapshot);
  const { rows, comps, stats } = board;

  // --- the gate's own shape, checked here before anything is written ---
  if (rows.length < 100 || rows.length > 4000) fail(`board has ${rows.length} rows, the gate wants 100 to 4000`);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.rank !== i + 1) fail(`row ${row.slug} has rank ${row.rank} at position ${i + 1}`);
    if (i > 0 && row.implied_value_usd > rows[i - 1].implied_value_usd) fail(`implied value rises at rank ${row.rank}`);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) fail(`row ${row.slug} has a bad implied value`);
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) fail(`row ${row.slug} has ${row.farm_steps.length} farm steps`);
    for (const step of row.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) fail(`row ${row.slug} has a farm step of ${trimmed.length} characters`);
    }
  }
  const watchlist = new Set<string>(snapshot.watchlist as string[]);
  const covered = rows.filter((r) => watchlist.has(r.slug)).length;
  if (covered !== watchlist.size) fail(`board covers ${covered} of ${watchlist.size} watchlist protocols`);

  // --- write the outputs ---
  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, "dashboard"), { recursive: true });
  mkdirSync(join(outDir, "screenshots"), { recursive: true });

  writeFileSync(
    join(outDir, "board.json"),
    JSON.stringify(
      {
        rows,
        meta: {
          as_of: stats.asOf,
          protocols_read: stats.protocolsRead,
          ranked: stats.rankedCount,
          total_implied_usd: stats.totalImpliedUsd,
          checksum: stats.checksum,
        },
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(join(outDir, "data.js"), "window.LAUNCH_RADAR = " + JSON.stringify(board) + ";\n");

  copyTree(join(HERE, "dashboard"), join(outDir, "dashboard"));
  const shotDir = join(HERE, "screenshots");
  if (!existsSync(shotDir)) fail("no screenshots/ directory beside main.ts");
  copyTree(shotDir, join(outDir, "screenshots"));

  const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
  if (dossier.length > 1.5 * 1024 * 1024) fail(`dossier is ${dossier.length} bytes, over the 1.5 MiB cap`);
  writeFileSync(join(outDir, "dossier.json"), Buffer.from(dossier));

  console.log(
    [
      `${stats.protocolsRead} protocols, ${stats.watchlistCount} on the watchlist, ${stats.rankedCount} rows ranked (${stats.verdicts.FARM} farm, ${stats.verdicts.MARGINAL} marginal, ${stats.verdicts.SKIP} skip)`,
      `size curve log10(mcap) = ${stats.fit.intercept.toFixed(3)} + ${stats.fit.slope.toFixed(3)} x log10(TVL), R2 ${stats.fit.r2.toFixed(3)}, sd ${stats.fit.sd.toFixed(3)} dex, n=${stats.fit.n}`,
      `launch odds: ${stats.bands.map((b) => `${b.label} ${(b.rate * 100).toFixed(1)}%`).join(" | ")}`,
      `growth coefficient ${stats.growth.coefficient.toFixed(3)} (n=${stats.growth.n}): not priced`,
      `total implied $${stats.totalImpliedUsd.toLocaleString("en-US")}, checksum ${stats.checksum}`,
      `wrote ${outDir}/board.json, ${outDir}/data.js, ${outDir}/dashboard, ${outDir}/screenshots and ${outDir}/dossier.json (${dossier.length.toLocaleString("en-US")} bytes)`,
    ].join("\n"),
  );
}

main();
