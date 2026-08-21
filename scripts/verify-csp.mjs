// Guard del CSP: verifica que cada script inline del build tenga su hash
// SHA-256 en la política de la misma página. Sin 'unsafe-inline' en script-src,
// un script inline nuevo sin hash queda bloqueado por el navegador — este
// check lo detecta en CI (falla `npm run build` vía postbuild) y no en prod.
//
// Si este guard falla: copiá el hash que imprime, actualizá script-src en
// src/layouts/Layout.astro y volvé a construir.

import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const DIST = new URL('../dist', import.meta.url).pathname;

function* walkHtml(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkHtml(p);
    else if (entry.name === 'index.html') yield p;
  }
}

function sha256b64(body) {
  return `'sha256-${createHash('sha256').update(body).digest('base64')}'`;
}

const INLINE_RE = /<script\b([^>]*)>(.*?)<\/script>/gs;

let errores = 0;
let inlineTotal = 0;

for (const file of walkHtml(DIST)) {
  const html = readFileSync(file, 'utf8');
  const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/)?.[1] || '';
  if (!csp) {
    console.error(`✗ ${file}: sin meta CSP`);
    errores++;
    continue;
  }
  for (const m of html.matchAll(INLINE_RE)) {
    const attrs = m[1];
    const body = m[2];
    if (/\bsrc=/.test(attrs)) continue; // script externo
    if (!body.trim()) continue;
    inlineTotal++;
    const hash = sha256b64(body);
    if (!csp.includes(hash)) {
      console.error(`✗ ${file}: script inline sin hash en el CSP.`);
      console.error(`  Hash a agregar a script-src en Layout.astro: ${hash}`);
      errores++;
    }
  }
}

if (errores > 0) {
  console.error(`\nverify-csp: ${errores} error(es), ${inlineTotal} script(s) inline revisado(s).`);
  process.exit(1);
}
console.log(`verify-csp: OK (${inlineTotal} script(s) inline cubierto(s) por hash).`);
