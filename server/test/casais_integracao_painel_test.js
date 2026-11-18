const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = () => fs.readFileSync(path.join(__dirname, '../web/painel.html'), 'utf8');

test('área de casais tem seções operacionais e scripts carregados antes do painel', () => {
  const pagina = html();
  for (const id of ['casais-encontros-conteudo', 'casais-materiais-conteudo']) {
    assert.match(pagina, new RegExp(`id="${id}"`));
  }
  for (const script of ['casais-encontros.js', 'casais-materiais.js', 'casais.js']) {
    const pos = pagina.indexOf(`/${script}?`);
    assert.ok(pos !== -1 && pos < pagina.indexOf('/painel.js?'), script);
  }
  assert.match(pagina, /casais-ano[^>]*max="2200"/);
  assert.match(pagina, /Não registre detalhes de aconselhamento/);
});

test('mudanças do ministério atualizam a área sem interromper edição ou diálogo', () => {
  const js = fs.readFileSync(path.join(__dirname, '../web/painel.js'), 'utf8');
  assert.match(js, /abaAtual === 'casais' && tipo\.startsWith\('casais'\) && !casaisEdicao && !document\.querySelector\('dialog\[open\]'\)/);
});
