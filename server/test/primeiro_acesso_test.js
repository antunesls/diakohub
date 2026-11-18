const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const web = (arquivo) => fs.readFileSync(path.join(__dirname, '../web', arquivo), 'utf8');

test('sem senha temporária, o primeiro acesso só devolve /api/eu (sem tela)', async () => {
  const PrimeiroAcesso = require('../web/primeiro-acesso.js');
  let chamadas = 0;
  const eu = await PrimeiroAcesso.garantir({ token: 't', buscarEu: async () => { chamadas++; return { nome: 'Ana', trocarSenha: false }; } });
  assert.equal(eu.nome, 'Ana');
  assert.equal(chamadas, 1);
});

test('todas as entradas passam pela tela de primeiro acesso e lembram a senha digitada', () => {
  for (const [arquivo, pagina] of [['painel.js', 'painel.html'], ['admin.js', 'admin.html'], ['acessos.js', 'acessos.html']]) {
    assert.match(web(arquivo), /PrimeiroAcesso\.garantir\(\{ token, buscarEu: \(\) => api\('GET', '\/api\/eu'\), aoSair: sair \}\)/, arquivo);
    assert.match(web(arquivo), /if \(j\.trocarSenha\) PrimeiroAcesso\.lembrar\(/, arquivo);
    assert.match(web(pagina), /<script src="\/primeiro-acesso\.js\?v=\d+"><\/script>/, pagina);
  }
  for (const pagina of ['minha-escala.html', 'recepcao.html']) {
    const html = web(pagina);
    assert.match(html, /<script src="\/primeiro-acesso\.js\?v=\d+"><\/script>/, pagina);
    assert.match(html, /PrimeiroAcesso\.garantir\(/, pagina);
    assert.match(html, /if \(j\.trocarSenha\) PrimeiroAcesso\.lembrar\(\$\('senha'\)\.value\);/, pagina);
  }
});

test('a tela de primeiro acesso confere as senhas antes de mandar e usa a rota da própria senha', () => {
  const js = web('primeiro-acesso.js');
  assert.match(js, /if \(nova\.value !== confirma\.value\) return avisar\('As duas senhas não são iguais\.'\);/);
  assert.match(js, /if \(nova\.value === temporaria\.value\) return avisar/);
  assert.match(js, /fetch\('\/api\/eu\/senha'/);
  assert.match(js, /role: 'dialog', 'aria-modal': 'true'/);
});

test('a resposta "trocar-senha" de qualquer chamada recarrega e mostra a tela', () => {
  assert.match(web('comum.js'), /if \(r\.status === 403 && j\.codigo === 'trocar-senha'\) \{\r?\n    location\.reload\(\);/);
});

test('entrega do acesso: prévia editável, copiar e WhatsApp com ou sem número', () => {
  const js = web('comum.js');
  assert.match(js, /function cartaoEntregaAcesso\(nome, login, r\)/);
  assert.match(js, /abrir\.href = 'https:\/\/wa\.me\/' \+ \(r\.whatsapp \|\| ''\) \+ '\?text=' \+ encodeURIComponent\(texto\.value\);/);
  assert.match(js, /texto\.addEventListener\('input', atualizar\);/);
  assert.match(web('acessos.js'), /caixa\.replaceChildren\(cartaoEntregaAcesso\(nome, login, r\),/);
  assert.match(web('acessos-escala.js'), /caixa\.replaceChildren\(cartaoEntregaAcesso\(nome, login, r\)\);/);
  assert.match(web('painel.html'), /<div id="acesso-entrega" hidden><\/div>/);
});

test('usuários e perfis saem do /admin e ficam em /acessos', () => {
  const admin = web('admin.html');
  assert.doesNotMatch(admin, /id="tabela-usuarios"|id="lista-perfis"|<dialog id="dlg-perfil"/);
  assert.match(admin, /<a class="botao" href="\/acessos">/);
  assert.match(web('admin.js'), /location\.replace\('\/acessos'\)/); // quem só cuida dos usuários vai direto
  const html = web('acessos.html');
  for (const secao of ['pessoas', 'perfis', 'comparar', 'registro']) assert.match(html, new RegExp(`data-secao="${secao}"`));
  assert.match(html, /<dialog id="dlg-perfil"/);
  assert.match(html, /<script src="\/acessos\.js\?v=\d+"><\/script>/);
});

test('acessos: vários perfis por pessoa, salvos juntos, e editor de perfis por área', () => {
  const js = web('acessos.js');
  assert.match(js, /eu\.permissoes\.includes\('usuarios'\)/); // a página é de quem cuida dos usuários
  assert.match(js, /api\('PUT', '\/api\/admin\/usuarios\/' \+ u\.id, \{ perfis: rascunho \}\)/);
  assert.match(js, /api\('POST', '\/api\/admin\/usuarios', \{ nome: valor\('n-nome'\), login: valor\('n-login'\), perfis: escolhidos \}\)/);
  assert.match(js, /'A pessoa precisa de pelo menos um perfil/);
  assert.match(js, /'de ' \+ origem\.get\(c\.id\)\.join\(', '\)/); // de qual perfil veio cada permissão
  assert.match(js, /function foraDoAlcance\(perfil\)/); // ninguém dá o que não tem
  assert.match(js, /api\('GET', '\/api\/admin\/perfis'\)/);
  assert.match(js, /api\('POST', `\/api\/admin\/perfis\/\$\{encodeURIComponent\(p\.id\)\}\/restaurar`\)/);
  assert.match(js, /'Incluída por: '/);
  assert.match(js, /api\('GET', '\/api\/auditoria\?tipo=acesso&limite=200'\)/);
});
