const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../web/painel.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '../web/painel.js'), 'utf8');

test('formulário do recado mostra a prévia do cartaz escolhido, como no app', () => {
  assert.match(html, /<select id="r-imagem"><\/select>/);
  assert.match(html, /<img id="r-imagem-previa" alt="Prévia do cartaz escolhido" hidden/);
});

test('a prévia acompanha a escolha e some sem cartaz', () => {
  assert.match(js, /function atualizarPreviaCartaz\(\) \{/);
  assert.match(js, /cartazes\.find\(\(c\) => c\.holyrics === \$\('r-imagem'\)\.value\)/);
  assert.match(js, /img\.src = escolhido\.url;/);
  assert.match(js, /\$\('r-imagem'\)\.addEventListener\('change', atualizarPreviaCartaz\);/);
  assert.match(js, /atualizarPreviaCartaz\(\);\s+abrirDialogo\(\$\('dlg-recado'\)/);
});
