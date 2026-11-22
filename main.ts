// Signal v4 — the token-radar-01 entry (Node 22+, standard library only).
//
// Reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// scores every pre-token protocol with the fitted model in lib/model.ts,
// writes the ranked board to /output/board.json, and copies this
// repository's dashboard/ and screenshots/ to /output. Last, it writes
// /output/dossier.json, the summary the judge reads, with the vendored
// make.fun library.
//
// The dashboard is a static page, no framework and no network:
// dashboard/index.html, dashboard/app.css and dashboard/app.js read
// /output/data.js, which this program writes from the same board.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify(board)}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const fit = board.model.fit;
const ev = board.model.evidence;
const sizeTerm = ev.valueTerms.find((t) => t.term === 'size curve, in TVL')!;
const flatTerm = ev.valueTerms.find((t) => t.term === 'flat median multiple')!;
const ageTerm = ev.oddsTerms.find((t) => t.term === '+ age, years listed')!;
const baseTerm = ev.oddsTerms.find((t) => t.term === 'base rate of peers')!;
const a = board.coverage.accounting;
process.stdout.write(
  `token radar v4: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.rows.length} rows ranked (${board.coverage.farm} farm, ${board.coverage.marginal} marginal, ${board.coverage.skip} skip)\n` +
    `token radar v4: size curve log10(mcap) = ${fit.intercept.toFixed(3)} + ${fit.slope.toFixed(3)} x log10(tvl), R2 ${fit.r2.toFixed(3)}, n ${fit.n}, resid sd ${fit.residSd.toFixed(3)}\n` +
    `token radar v4: held-out miss walk-forward x${sizeTerm.wfMiss.toFixed(2)} vs flat x${flatTerm.wfMiss.toFixed(2)} (leave-one-out x${sizeTerm.looMiss.toFixed(2)} vs x${flatTerm.looMiss.toFixed(2)})\n` +
    `token radar v4: odds Brier leave-one-out ${ageTerm.looBrier.toFixed(3)} vs base ${baseTerm.looBrier.toFixed(3)} (walk-forward ${ageTerm.wfBrier.toFixed(3)} vs ${baseTerm.wfBrier.toFixed(3)}); range P25-P75 holds ${ev.range.looP25P75}% LOO, ${ev.range.wfP25P75}% WF\n` +
    `token radar v4: ledger ${a.rankedWatchlist} watchlist + ${a.rankedEarly} early + ${a.rankedOffList} off-list + ${a.tokenPriced} priced + ${a.tokenNoCap} no-cap + ${a.outBridge} bridge + ${a.outLiquid} liquid + ${a.outExchange} exchange + ${a.outVersioned} versioned = ${a.total}; checksum ${board.model.integrity.checksum}; total implied $${board.model.integrity.totalImpliedUsd.toLocaleString('en-US')}\n` +
    `token radar v4: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')}, ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
