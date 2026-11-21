const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buscarRepertorio, statusParaFiltro, tomCanonico, TONS_REPERTORIO } = require('../web/repertorio-busca.js');

const musicas = [
  { titulo: 'Santo Pra Sempre', cantor: 'Banda Água Viva', compositor: 'Ana Luz', status: 'Ok', ativo: true, tomSelecionado: 'A#m' },
  { titulo: 'Santuário', cantor: 'Outro', compositor: 'Bruno', status: 'Em análise', ativo: false, tomSelecionado: 'F' },
  { titulo: 'Aleluia', cantor: 'Água Viva', compositor: 'Carlos', status: 'Pendente', ativo: false, tomDiakonia: 'Bb\nIntro: F' },
];

test('busca sem acento, por palavras fora de ordem e pelos três campos', () => {
  assert.deepEqual(buscarRepertorio(musicas, { busca: 'viva santo' }).map((m) => m.titulo), ['Santo Pra Sempre']);
  assert.deepEqual(buscarRepertorio(musicas, { busca: 'ANA agua' }).map((m) => m.titulo), ['Santo Pra Sempre']);
});

test('pequenos erros de digitação entram depois das correspondências exatas', () => {
  assert.deepEqual(buscarRepertorio(musicas, { busca: 'santu' }).map((m) => m.titulo), ['Santuário', 'Santo Pra Sempre']);
  assert.deepEqual(buscarRepertorio(musicas, { busca: 'snt' }), []); // Não aproxima termos curtos.
});

test('filtros por disponibilidade e tom tratam dados anteriores e tons equivalentes', () => {
  assert.equal(TONS_REPERTORIO.length, 25);
  assert.equal(new Set(TONS_REPERTORIO.map(([valor]) => valor)).size, 25);
  assert.equal(statusParaFiltro(musicas[2]), 'Inativo');
  assert.equal(tomCanonico('Bb'), 'A#');
  assert.deepEqual(buscarRepertorio(musicas, { status: 'Inativo', tom: 'A#' }).map((m) => m.titulo), ['Aleluia']);
  assert.deepEqual(buscarRepertorio(musicas, { status: 'OK', tom: 'A#m' }).map((m) => m.titulo), ['Santo Pra Sempre']);
});

test('painel monta o repertório por script, com o CSS próprio e a busca antes', () => {
  const html = fs.readFileSync(path.join(__dirname, '../web/painel.html'), 'utf8');
  assert.match(html, /id="repertorio-tela"/);
  assert.match(html, /\/repertorio\.css\?v=\d+/);
  assert.doesNotMatch(html, /id="dlg-repertorio"/, 'a janela antiga de edição saiu');
  assert.match(html, /id="dlg-importar-repertorio"/);
  const busca = html.indexOf('/repertorio-busca.js?v=2');
  const repertorio = html.match(/\/repertorio\.js\?v=(\d+)/);
  assert.ok(busca >= 0 && repertorio && Number(repertorio[1]) >= 2 && busca < html.indexOf(repertorio[0]));
});
