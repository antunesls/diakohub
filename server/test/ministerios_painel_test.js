const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const web = (arquivo) => fs.readFileSync(path.join(__dirname, '../web', arquivo), 'utf8');

test('menu mostra Ministérios só para quem cuida do cadastro de ministérios', () => {
  const menu = require('../web/menu-lateral.js');
  const ids = (permissoes) => menu.gruposPermitidos(permissoes).flatMap((g) => g.itens).map((i) => i.id);
  assert.ok(ids(['ministerios']).includes('ministerios'));
  assert.ok(!ids(['atas', 'membros']).includes('ministerios'));
});

test('a aba Ministérios existe no painel e carrega o script com versão nova', () => {
  const html = web('painel.html');
  assert.match(html, /<section data-painel="ministerios" hidden>/);
  assert.match(html, /<script src="\/ministerios\.js\?v=\d+"><\/script>/);
  assert.match(html, /<script src="\/atas\.js\?v=2"><\/script>/);
  assert.match(html, /<script src="\/menu-lateral\.js\?v=7"><\/script>/);
  const js = web('ministerios.js');
  assert.match(js, /carregar\.ministerios = carregarMinisterios;/);
  assert.match(js, /\/api\/ministerios\/membros/, 'escolhe pessoas sem precisar do cadastro de membros completo');
});

test('a ata escolhe o ministério do cadastro (id), não um nome digitado', () => {
  const js = web('atas.js');
  assert.match(js, /api\('GET', '\/api\/ministerios'\)/);
  assert.match(js, /ministerioId: tiposAtaFormais\.has\(tipo\.input\.value\) \? '' : ministerio\.input\.value/);
  assert.match(js, /atasMinisterios\.filter\(\(m\) => !m\.fixo && \(m\.podeAtas \|\| m\.id === atual\?\.ministerioId\)\)/);
  assert.doesNotMatch(js, /ministerio: ministerio\.input\.value\.trim\(\)/);
});
