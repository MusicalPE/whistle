// 코드 검사: 문법, 단추가 부르는 기능이 실제로 있는지, 판 번호가 파일마다 같은지.
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const fail = [];
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

for (const f of readdirSync(new URL('../js', import.meta.url)).filter((x) => x.endsWith('.js'))) {
  try { execFileSync(process.execPath, ['--check', new URL(`../js/${f}`, import.meta.url).pathname], { stdio: 'pipe' }); }
  catch (e) { fail.push(`문법 오류: js/${f}\n${e.stderr}`); }
}

const app = read('js/app.js');
const block = (name) => { const i = app.indexOf(`const ${name} = {`); const j = app.indexOf('\n};', i); return app.slice(i, j); };
const names = (src) => new Set([...src.matchAll(/^\s{2}(?:async\s+)?([A-Za-z]\w*)\s*\(/gm)].map((m) => m[1]));
const acts = names(block('actions')), chgs = names(block('changes'));
for (const m of app.matchAll(/data-act="([^"$]+)"/g)) if (!acts.has(m[1])) fail.push(`단추가 부르는 기능이 없음: ${m[1]}`);
for (const m of app.matchAll(/data-enter="([^"$]+)"/g)) if (!acts.has(m[1])) fail.push(`엔터가 부르는 기능이 없음: ${m[1]}`);
for (const m of app.matchAll(/data-change="([^"$]+)"/g)) if (!chgs.has(m[1])) fail.push(`입력이 부르는 기능이 없음: ${m[1]}`);
for (const m of app.matchAll(/run: '(\w+)'/g)) if (!acts.has(m[1])) fail.push(`확인 창이 부르는 기능이 없음: ${m[1]}`);
for (const m of app.matchAll(/actions\.(\w+)\(/g)) if (!acts.has(m[1])) fail.push(`없는 기능을 부름: actions.${m[1]}`);

const version = read('js/version.js').match(/'([\d.]+)'/)[1];
const html = read('index.html');
for (const m of html.matchAll(/\?v=([\d.]+)/g)) if (m[1] !== version) fail.push(`index.html 판 번호 ${m[1]} ≠ ${version}`);
if (![...html.matchAll(/\?v=/g)].length) fail.push('index.html 에 판 번호가 없음');

if (fail.length) { console.error(fail.join('\n')); process.exit(1); }
console.log(`코드 검사 통과 (v${version}, 단추 기능 ${acts.size}개, 입력 기능 ${chgs.size}개)`);
