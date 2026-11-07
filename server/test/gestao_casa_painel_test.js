const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Gestão da Casa tem página no painel, menu protegido e interface de tarefas', () => {
  const html = fs.readFileSync(path.join(__dirname, '../web/painel.html'), 'utf8');
  const menu = fs.readFileSync(path.join(__dirname, '../web/menu-lateral.js'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../web/gestao-casa.js'), 'utf8');
  assert.match(html, /data-painel="gestaoCasa"/);
  assert.match(html, /gestao-casa\.js/);
  assert.match(menu, /permissao: 'gestaoCasa'/);
  for (const acao of ['/api/casa/tarefas', '/api/casa/rotinas', '/concluir', '/anexos']) {
    assert.ok(script.includes(acao), acao);
  }
  assert.match(script, /function carregarCasa/);
});

test('script da Casa é carregado antes de painel.js, que referencia carregarCasa ao iniciar', () => {
  const html = fs.readFileSync(path.join(__dirname, '../web/painel.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="\/([^"?]+)\?v=\d+"><\/script>/g)].map((m) => m[1]);
  const casa = scripts.indexOf('gestao-casa.js');
  const painel = scripts.indexOf('painel.js');
  assert.ok(casa >= 0 && painel >= 0 && casa < painel,
    'gestao-casa.js precisa definir carregarCasa antes da avaliação de painel.js');
});

test('painel e menu mostram atrasadas e próximas, e diálogo da Casa permite formulário rolável', () => {
  const html = fs.readFileSync(path.join(__dirname, '../web/painel.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../web/gestao-casa.js'), 'utf8');
  assert.match(html, /id="ind-casa"[^>]*data-permissao="gestaoCasa"/);
  assert.match(html, /id="ck-casa"/);
  assert.match(script, /function atualizarResumoCasa\(/);
  assert.match(script, /badge\.textContent\s*=\s*[^;]*proxim/);
  assert.match(html, /dialog\.dialogo-largo form\.casa-form\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(html, /dialog\.dialogo-largo\.casa-dialogo \.dialogo-coluna\s*\{[^}]*overflow-y:\s*auto/);
});
