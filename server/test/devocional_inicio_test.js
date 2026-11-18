const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = () => fs.readFileSync(path.join(__dirname, '../web/inicio.html'), 'utf8');

test('devocional fica logo abaixo dos atalhos, em largura total, fora da coluna lateral', () => {
  const pagina = html();
  // Um bloco de largura total, na ordem: atalhos -> devocional -> colunas.
  const atalhos = pagina.indexOf('id="atalhos"');
  const devocional = pagina.indexOf('id="devocional"');
  const principal = pagina.indexOf('id="principal"');
  assert.ok(atalhos >= 0 && devocional > atalhos && principal > devocional,
    'o devocional deve vir depois dos atalhos e antes das colunas');
  assert.match(pagina, /<section class="largura-toda[^"]*devocional-semana[^"]*" id="devocional"/);
  // Não é mais empilhado na coluna da direita (cultos, Pix, etc.).
  assert.doesNotMatch(pagina, /lateral\.push\(el\('section', \{ class: 'caixa devocional-semana'/);
  assert.match(pagina, /\$\('devocional'\)\.replaceChildren\(/);
  assert.match(pagina, /\$\('devocional'\)\.hidden = false/);
});

test('faixa de atalhos não imprime "null" quando o Pix não está configurado', () => {
  const pagina = html();
  assert.match(pagina, /const faixaAtalhos = \[/);
  assert.match(pagina, /\]\.filter\(Boolean\);\s*\$\('atalhos'\)\.replaceChildren\(\.\.\.faixaAtalhos\);/);
});

test('no desktop o texto e os botões do devocional ocupam a largura toda em duas áreas', () => {
  const pagina = html();
  assert.match(pagina, /\.devocional-semana \{ display: grid;/);
  assert.match(pagina, /\.devocional-semana \.acoes-devocional \{/);
  assert.match(pagina, /@media \(min-width: 760px\) \{\s*\.devocional-semana \{ grid-template-columns: minmax\(0, 1fr\) auto; \}/);
  // Texto em linha confortável mesmo com o bloco largo.
  assert.match(pagina, /\.devocional-semana p \{ margin: 0; line-height: 1\.55; max-width: 78ch; \}/);
});
