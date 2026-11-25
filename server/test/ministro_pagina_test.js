const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Minha escala oferece editor de músicas só nos cultos autorizados', () => {
  const html = fs.readFileSync(path.join(__dirname, '../web/minha-escala.html'), 'utf8');
  assert.match(html, /if \(c\.podeEscolherMusicas\)/);
  assert.match(html, /dados\.repertorio/);
  assert.match(html, /\/api\/minha-escala\/cultos\/\$\{c\.id\}\/musicas/);
  assert.match(html, /'PUT'/);
});

test('painel encaminha quem não tem aba no painel (integrante, ministro, louvor) para a página do perfil', () => {
  const js = fs.readFileSync(path.join(__dirname, '../web/painel.js'), 'utf8');
  assert.match(js, /const abas = gruposPermitidos\(eu\.permissoes\)\.flatMap\(\(g\) => g\.itens\);/);
  assert.match(js, /if \(!abas\.length && eu\.entrada && eu\.entrada !== '\/painel'\) \{\r?\n    location\.replace\(eu\.entrada\);/);
  assert.doesNotMatch(js, /eu\.perfil === 'integrante'/, 'a regra vale para qualquer perfil, não pelo nome');
  const menu = require('../web/menu-lateral.js');
  for (const permissoes of [['sessao', 'minhaEscala'], ['sessao', 'minhaEscala', 'indisponibilidade', 'musicasMinistro']]) {
    assert.equal(menu.gruposPermitidos(permissoes).flatMap((g) => g.itens).length, 0, permissoes.join());
  }
});

test('Louvor não vê formulário de indisponibilidade em Minha escala', () => {
  const html = fs.readFileSync(path.join(__dirname, '../web/minha-escala.html'), 'utf8');
  assert.match(html, /\$\('form'\)\.hidden = !dados\.podeAvisarIndisponibilidade/);
  assert.match(html, /\$\('abrir-nao-vou'\)\.hidden = !dados\.podeAvisarIndisponibilidade/);
  assert.match(html, /dados\.podeAvisarIndisponibilidade \? botao\('Não vou neste'/);
  // Pôr na agenda vale para qualquer pessoa escalada.
  assert.match(html, /\$\('agenda'\)\.hidden = n === 0;/);
});

test('Minha escala (opção A): próximo culto em destaque, lista curta, ações no rodapé e conta separada', () => {
  const html = fs.readFileSync(path.join(__dirname, '../web/minha-escala.html'), 'utf8');
  for (const id of ['destaque', 'depois', 'acoes-fixas', 'abrir-nao-vou', 'abrir-conta', 'dlg-nao-vou', 'dlg-conta', 'dlg-culto', 'dlg-agenda']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  // Formulário de falta e troca de senha saíram do meio da página para as folhas.
  assert.ok(html.indexOf('id="form"') > html.indexOf('<dialog id="dlg-nao-vou"'));
  assert.ok(html.indexOf('id="form-senha"') > html.indexOf('<dialog id="dlg-conta"'));
  assert.ok(html.indexOf('id="sair"') > html.indexOf('<dialog id="dlg-conta"'));
  assert.match(html, /const \[proximo, \.\.\.depois\] = dados\.cultos;/);
  assert.match(html, /if \(ehAndroid\(\)\) return criar\('a', \{ className: classe, href: linkGoogleAgenda\(c\)/);
});

test('administração de acessos permite vincular contas da Minha escala de qualquer perfil', () => {
  const js = fs.readFileSync(path.join(__dirname, '../web/acessos-escala.js'), 'utf8');
  assert.match(js, /usuariosAcesso\.filter\(\(u\) => \(u\.perfis \|\| \[u\.perfil\]\)\.join\(\) !== 'integrante' && !u\.membroId\)/);
  assert.match(js, /u\.perfilNome \|\| u\.perfil/);
  assert.match(js, /mostrarEntregaAcesso\(r\.usuario\.nome, r\.usuario\.login, r\)/);
});

test('painel invalida cache dos scripts de perfis e acessos atualizados', () => {
  const html = fs.readFileSync(path.join(__dirname, '../web/painel.html'), 'utf8');
  const versaoPainel = Number(html.match(/src="\/painel\.js\?v=(\d+)"/)?.[1]);
  assert.ok(versaoPainel >= 18, 'painel deve carregar versão atualizada');
  assert.match(html, /src="\/acessos-escala\.js\?v=4"/);
});
