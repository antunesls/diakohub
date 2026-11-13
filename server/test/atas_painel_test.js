const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ler = (arquivo) => fs.readFileSync(path.join(__dirname, '../web', arquivo), 'utf8');
const menu = require('../web/menu-lateral.js');

test('Atas têm seção no painel, menu protegido e link de ajuda', () => {
  const html = ler('painel.html');
  assert.match(html, /data-painel="atas"/);
  assert.match(html, /href="\/ajuda\/atas"/);
  for (const id of ['atas-nova', 'atas-busca', 'atas-tipo', 'atas-status', 'atas-ano', 'atas-lista', 'atas-pendentes', 'atas-resultado']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  const operacao = menu.gruposPermitidos(['atas']).flatMap((g) => g.itens);
  assert.deepEqual(operacao.map((i) => i.id), ['atas']);
  assert.equal(operacao[0].badge, 'badge-atas');
  assert.ok(!menu.gruposPermitidos(['painel']).flatMap((g) => g.itens).some((i) => i.id === 'atas'));
});

test('atas.js carrega antes de painel.js, que registra carregarAtas no mapa carregar', () => {
  const html = ler('painel.html');
  const scripts = [...html.matchAll(/<script src="\/([^"?]+)\?v=\d+"><\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.indexOf('atas.js') >= 0 && scripts.indexOf('atas.js') < scripts.indexOf('painel.js'));
  assert.match(ler('painel.js'), /atas: carregarAtas,/);
  const script = ler('atas.js');
  assert.match(script, /async function carregarAtas\(/);
  for (const rota of ['/api/atas', '/api/atas/encaminhamentos', '/api/atas/pessoas', '/finalizar', '/reabrir',
    '/aprovar', '/retificar', '/pdf', '/email', '/anexos']) {
    assert.ok(script.includes(rota), rota);
  }
});

test('página de ajuda explica numeração, aprovação, sigilo e e-mail', () => {
  const ajuda = ler('ajuda-atas.html');
  for (const ancora of ['tipos', 'fluxo', 'retificacao', 'encaminhamentos', 'sigilo', 'pdf', 'acesso']) {
    assert.match(ajuda, new RegExp(`id="${ancora}"`), ancora);
  }
});
