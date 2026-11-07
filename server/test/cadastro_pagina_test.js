const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('formulário público reúne ficha, família, foto e termo de consentimento', () => {
  const pagina = fs.readFileSync(path.join(__dirname, '../web/cadastro.html'), 'utf8');
  for (const campo of ['nome', 'aniversario', 'telefone', 'email', 'cpf', 'rua', 'dataBatismo',
    'emergenciaNome', 'familiares', 'foto', 'autorizo', 'responsavel']) {
    assert.match(pagina, new RegExp(`id="${campo}"`));
  }
  assert.match(pagina, /\/api\/public\/cadastro/);
  assert.match(pagina, /\/api\/public\/termo-lgpd/);
});

test('painel mostra pendências e link compartilhável para o cadastro', () => {
  const pagina = fs.readFileSync(path.join(__dirname, '../web/painel.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../web/painel.js'), 'utf8');
  assert.match(pagina, /id="solicitacoes-membros"/);
  assert.match(pagina, /href="\/cadastro"/);
  assert.match(script, /\/api\/solicitacoes-membros/);
  assert.match(script, /\/aprovar/);
  assert.match(script, /\/rejeitar/);
});
