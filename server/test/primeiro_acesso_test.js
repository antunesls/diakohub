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
  for (const [arquivo, pagina] of [['painel.js', 'painel.html'], ['admin.js', 'admin.html']]) {
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
  assert.match(web('admin.js'), /caixa\.replaceChildren\(cartaoEntregaAcesso\(nome, login, r\)\);/);
  assert.match(web('acessos-escala.js'), /caixa\.replaceChildren\(cartaoEntregaAcesso\(nome, login, r\)\);/);
  assert.match(web('painel.html'), /<div id="acesso-entrega" hidden><\/div>/);
});

test('admin: seção Perfis com editor por área e dependências entre permissões', () => {
  const html = web('admin.html');
  assert.match(html, /<a href="#perfis">Perfis<\/a>/);
  assert.match(html, /<section class="cartao" id="perfis">/);
  assert.match(html, /<dialog id="dlg-perfil"/);
  const js = web('admin.js');
  assert.match(js, /api\('GET', '\/api\/admin\/perfis'\)/);
  assert.match(js, /api\('POST', `\/api\/admin\/perfis\/\$\{encodeURIComponent\(p\.id\)\}\/restaurar`\)/);
  assert.match(js, /'Incluída por: '/);
  assert.match(js, /p\.travado \? null : excluir/);
});
