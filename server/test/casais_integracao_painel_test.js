const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = () => fs.readFileSync(path.join(__dirname, '../web/painel.html'), 'utf8');
const web = (nome) => fs.readFileSync(path.join(__dirname, '../web', nome), 'utf8');

test('encontros têm aba própria e não ficam dentro de Casais', () => {
  const pagina = html();
  assert.match(pagina, /<section data-painel="encontros" hidden>/);
  assert.match(pagina, /id="encontros-conteudo"/);
  const inicioCasais = pagina.indexOf('<section data-painel="casais"');
  const fimCasais = pagina.indexOf('<section data-painel="encontros"');
  assert.ok(inicioCasais !== -1 && fimCasais > inicioCasais);
  assert.doesNotMatch(pagina.slice(inicioCasais, fimCasais), /id="encontros-conteudo"/);
  for (const script of ['encontros.js', 'materiais.js', 'casais.js']) {
    const pos = pagina.indexOf(`/${script}?`);
    assert.ok(pos !== -1 && pos < pagina.indexOf('/painel.js?'), script);
  }
  assert.match(pagina, /casais-ano[^>]*max="2200"/);
  assert.match(pagina, /Não registre detalhes de aconselhamento/);
});

test('menu e painel registram a aba independente de encontros', () => {
  const menu = require('../web/menu-lateral.js');
  const itens = menu.gruposPermitidos(['encontros']).flatMap((g) => g.itens);
  assert.ok(itens.some((i) => i.id === 'encontros' && i.titulo === 'Encontros e inscrições'));
  assert.match(web('painel.js'), /encontros: carregarEncontros/);
  assert.match(web('encontros.js'), /pode\('encontros'\)/);
  assert.doesNotMatch(web('encontros.js'), /casaisGerenciar|\/api\/casais/);
});

test('mudanças de encontros atualizam a aba sem fechar diálogo em uso', () => {
  const js = web('painel.js');
  assert.match(js, /abaAtual === 'casais' && tipo\.startsWith\('casais'\) && !casaisEdicao && !document\.querySelector\('dialog\[open\]'\)/);
  assert.match(js, /abaAtual === 'encontros' && \['encontros', 'inscricoes', 'tarefasEncontros', 'materiais', 'tiposMaterial'\]\.includes\(tipo\)/);
  // Editor de material aberto (formulário inline) não é descartado por atualização em tempo real.
  assert.match(js, /!document\.querySelector\('#encontros-materiais form'\)/);
});

test('materiais saíram de Casais e viraram aba de Encontros', () => {
  const pagina = html();
  const inicioCasais = pagina.indexOf('<section data-painel="casais"');
  const fimCasais = pagina.indexOf('<section data-painel="encontros"');
  assert.doesNotMatch(pagina.slice(inicioCasais, fimCasais), /casais-materiais-conteudo|id="encontros-materiais"/);
  assert.match(pagina, /data-ir="encontros" data-sub="materiais"/);
  assert.match(pagina, /data-encontros-aba="materiais"/);
  assert.match(pagina, /id="encontros-materiais"/);
  assert.ok(!fs.existsSync(path.join(__dirname, '../web/casais-materiais.js')));
  assert.match(web('painel.js'), /definirSubAba\(b\.dataset\.ir, b\.dataset\.sub\)/);
  assert.doesNotMatch(web('materiais.js'), /\/api\/casais|casaisGerenciar/);
});
