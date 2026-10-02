/**
 * Pre-deploy check: every JS file parses, every file index.html references
 * exists, and the version in app-core.js matches package.json.
 * Usage: npm run check   (exit code 1 on any problem)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
let problems = 0;
const fail = (msg) => { console.error('✗ ' + msg); problems++; };

for (const dir of ['js', 'vendor']) {
  for (const f of fs.readdirSync(path.join(root, dir)).filter((n) => n.endsWith('.js'))) {
    try { execFileSync(process.execPath, ['--check', path.join(root, dir, f)], { stdio: 'pipe' }); }
    catch (e) { fail(`${dir}/${f} does not parse: ${String(e.stderr).split('\n')[0]}`); }
  }
}

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const m of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) {
  if (!fs.existsSync(path.join(root, m[1]))) fail(`index.html references missing file ${m[1]}`);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const core = fs.readFileSync(path.join(root, 'js/app-core.js'), 'utf8');
const v = (core.match(/VERSION = '([^']+)'/) || [])[1];
if (v !== pkg.version) fail(`version mismatch: app-core.js ${v} vs package.json ${pkg.version}`);

if (problems) { console.error(`\n${problems} problem(s).`); process.exit(1); }
console.log(`✓ Structura ${pkg.version} is ready to deploy.`);
