// DUSTLINE's entry program (Node 22, standard library only).
//
// The game is this directory's game/ folder, plain static files the browser loads as
// ES modules with three.js from an import map. This program copies game/ to /output,
// decodes the screenshots (stored here as base64 text, because the push route carries
// UTF-8 files only) into whole JPEGs in /output/screenshots, and writes
// /output/dossier.json with the vendored make.fun library. The program is
// deterministic: the same repository always writes the same bytes, so the grader's
// two runs agree.
//
// Serve the game locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });

// The screenshots the judge reads are stored in this repository as base64 text
// (screenshots/<name>.jpg.b64): the push route carries UTF-8 files only, so the
// binary JPEGs cannot be pushed as files. This program decodes each one into a
// whole JPEG in /output. The .jpg files beside them in screenshots/ are the same
// views for a human reader; the program reads only the .b64 text, so a local run
// and the grader's run decode the same bytes.
const shotsDir = join(here, 'screenshots');
const encoded = existsSync(shotsDir) ? readdirSync(shotsDir).filter((n) => n.endsWith('.jpg.b64')) : [];
if (encoded.length < 3 || encoded.length > 4) {
  process.stderr.write(`dustline: screenshots/ holds ${encoded.length} base64 views: hand in 3 or 4\n`);
  process.exit(1);
}
mkdirSync(join(out, 'screenshots'), { recursive: true });
const shots: string[] = [];
for (const name of encoded.sort()) {
  const outName = name.slice(0, -4);
  if (!IMAGE_NAME.test(outName)) {
    process.stderr.write(`dustline: screenshots/${outName}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
  const bytes = Buffer.from(readFileSync(join(shotsDir, name), 'utf8').replace(/\s+/g, ''), 'base64');
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    process.stderr.write(`dustline: screenshots/${name} does not decode to a whole JPEG\n`);
    process.exit(1);
  }
  if (bytes.length > 262144) {
    process.stderr.write(`dustline: screenshots/${outName} is ${bytes.length} bytes, past the 256 KiB cap\n`);
    process.exit(1);
  }
  writeFileSync(join(out, 'screenshots', outName), bytes);
  shots.push(outName);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, game_max_files: 993, game_max_bytes: 50331648 }),
);

process.stdout.write(`dustline: wrote ${join(out, 'game')} and ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`);
