// main.ts — hands the entry in. Node 22, standard library only, no network.
//
// The game is game/: static files the browser loads as ES modules, three.js from the page's
// import map. This program copies game/ and screenshots/ beside it to the output directory
// (MAKEFUN_OUTPUT_DIR stands in for /output outside the grader), then writes dossier.json —
// the one artifact the judge reads — with the kit's own buildDossier, using the bounty's caps.
// It prints the numbers it acted on so a run can be checked without opening the files.
//
//   node --experimental-strip-types main.ts
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node --experimental-strip-types main.ts
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier, readGameTree } from './vendor/makefun-threejs.ts';

// The bounty's caps (the scorer's gate.json). Only text_max_bytes shapes the dossier's bytes;
// the rest are the limits an entry would be refused on, checked here so a run fails loudly.
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// A clean output directory: a stale file from an earlier run would change the dossier and,
// under the gate's byte-for-byte comparison, look like a different entry.
mkdirSync(out, { recursive: true });
for (const part of ['game', 'screenshots']) {
  rmSync(join(out, part), { recursive: true, force: true });
}
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });

const shotSource = join(here, 'screenshots');
if (!existsSync(shotSource)) throw new Error('main.ts: no screenshots/: an entry hands in 3 or 4 renders of its game');
mkdirSync(join(out, 'screenshots'), { recursive: true });
const shots = readdirSync(shotSource)
  .filter((name) => /\.(png|jpe?g)$/i.test(name) && !name.startsWith('.'))
  .sort();
if (shots.length < 3 || shots.length > CAPS.screenshots.max) {
  throw new Error(`main.ts: screenshots/ holds ${shots.length} images; an entry hands in 3 or 4`);
}
for (const name of shots) {
  const bytes = readFileSync(join(shotSource, name));
  if (bytes.length > CAPS.screenshots.max_bytes) {
    throw new Error(`main.ts: screenshots/${name} is ${bytes.length} bytes, over the ${CAPS.screenshots.max_bytes} cap`);
  }
  writeFileSync(join(out, 'screenshots', name), bytes);
}

const dossier = buildDossier(out, CAPS);
writeFileSync(join(out, 'dossier.json'), dossier);

// The numbers behind the hand-in, from the same walk the dossier makes.
const tree = readGameTree(join(out, 'game'), CAPS);
const source = tree.files.filter((file) => file.cls === 'source');
const vendored = tree.files.filter((file) => file.cls === 'vendored');
const assets = tree.files.filter((file) => file.cls === 'asset');
const sourceBytes = source.reduce((sum, file) => sum + file.bytes, 0);
const cover = shots[0];
console.log(`dossier   ${dossier.length} bytes  ${join(out, 'dossier.json')}`);
console.log(`game      ${tree.count} entries, ${tree.totalBytes} bytes, ${source.length} source files (${sourceBytes} bytes, cap ${CAPS.text_max_bytes})`);
console.log(`vendored  ${vendored.length} files, ${vendored.reduce((sum, file) => sum + file.bytes, 0)} bytes`);
console.log(`assets    ${assets.length} files`);
console.log(`shots     ${shots.length}: ${shots.map((name) => `${name} ${readFileSync(join(out, 'screenshots', name)).length}b`).join(', ')}`);
console.log(`cover     ${cover}`);
