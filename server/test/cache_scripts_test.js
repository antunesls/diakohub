const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('painel carrega a versão atual das escalas, não a versão anterior em cache', () => {
  const html = fs.readFileSync(path.join(__dirname, '../web/painel.html'), 'utf8');
  assert.match(html, /<script src="\/escalas\.js\?v=13"><\/script>/);
  assert.doesNotMatch(html, /<script src="\/escalas\.js\?v=(?:[1-9]|1[0-2])"><\/script>/);
  assert.ok(html.indexOf('/horarios-escalas.js?v=1') < html.indexOf('/escalas.js?v=13'));
  assert.match(html, /<link rel="icon" href="\/logo\.png" type="image\/png">/);
});
