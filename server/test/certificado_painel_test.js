const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const web = (f) => fs.readFileSync(path.join(__dirname, '../web', f), 'utf8');

test('ficha do membro tem o botão do certificado e o painel carrega o script', () => {
  const html = web('painel.html');
  const painel = web('painel.js');
  assert.match(html, /id="certificado-da-ficha"[^>]*hidden/);
  assert.match(html, /<dialog id="dlg-certificado">/);
  assert.ok(html.indexOf('/painel.js?v=32') !== -1);
  assert.ok(html.indexOf('/painel.js?v=32') < html.indexOf('/certificado.js?v=1'));
  // Só aparece para quem tem data de batismo (o servidor recusa sem ela).
  assert.match(painel, /\$\('certificado-da-ficha'\)\.hidden = !m\.dataBatismo/);
  assert.match(painel, /Certificado\.abrir\(fichaAberta\)/);
});

/** Elemento falso, só com o que certificado.js usa. */
function elemento() {
  const ouvintes = {};
  return {
    hidden: false, value: '', textContent: '', className: '', disabled: false, checked: false, files: [],
    style: {}, filhos: [],
    addEventListener(tipo, fn) { (ouvintes[tipo] ||= []).push(fn); },
    disparar(tipo) { for (const fn of ouvintes[tipo] || []) fn({}); },
    replaceChildren(...f) { this.filhos = f; },
    showModal() { this.open = true; },
    close() { this.open = false; this.disparar('close'); },
  };
}

function carregar({ config, respostaPdf }) {
  const els = {};
  const chamadas = [];
  const abas = [];
  const sandbox = {
    $: (id) => (els[id] ||= elemento()),
    el: () => elemento(),
    mensagem: (alvo, texto, ok = true) => { alvo.textContent = texto; alvo.className = ok ? 'sucesso' : 'erro'; },
    api: async (metodo, caminho, corpo) => {
      chamadas.push({ metodo, caminho, corpo });
      if (metodo === 'GET' && caminho === '/api/certificado/config') return config;
      return {};
    },
    urlAutenticada: async () => 'blob:previa',
    dataBr: (iso) => iso.split('-').reverse().join('/'),
    token: 'tk',
    sair: () => {},
    confirm: () => true,
    setTimeout: () => {},
    URLSearchParams,
    URL: { createObjectURL: () => 'blob:pdf', revokeObjectURL: () => {} },
    fetch: async (url, opcoes) => {
      chamadas.push({ metodo: 'FETCH', caminho: url, opcoes });
      return respostaPdf;
    },
    window: {
      open: () => {
        const aba = { closed: false, document: {}, location: { href: '' }, close() { this.closed = true; } };
        abas.push(aba);
        return aba;
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(web('certificado.js') + '\nthis.Certificado = Certificado;', sandbox);
  return { Certificado: sandbox.Certificado, els, chamadas, abas };
}

const membro = { id: 'm1', nome: 'José da Silva', dataBatismo: '2025-03-09' };
const pdfOk = { ok: true, status: 200, blob: async () => ({}), json: async () => ({}) };

test('gera o PDF com assinatura, carimbo e quem assina, e abre na aba aberta no clique', async () => {
  const t = carregar({ config: { pastor: 'Pr. Marcos', cargo: 'Pastor', assinatura: true, carimbo: true }, respostaPdf: pdfOk });
  await t.Certificado.abrir(membro);
  assert.equal(t.els['dlg-certificado'].open, true);
  assert.equal(t.els['cert-resumo'].textContent, 'José da Silva · batismo em 09/03/2025');
  assert.equal(t.els['cert-pastor'].value, 'Pr. Marcos');

  t.els['cert-cargo'].value = 'Pastor presidente';
  t.els['cert-gerar'].disparar('click');
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  const salvar = t.chamadas.find((c) => c.metodo === 'PUT');
  assert.deepEqual({ ...salvar.corpo }, { pastor: 'Pr. Marcos', cargo: 'Pastor presidente' });
  const pdf = t.chamadas.find((c) => c.metodo === 'FETCH');
  assert.equal(pdf.caminho,
    '/api/membros/m1/certificado-batismo?assinatura=1&carimbo=1&pastor=Pr.+Marcos&cargo=Pastor+presidente');
  assert.equal(pdf.opcoes.headers.Authorization, 'Bearer tk');
  assert.equal(t.abas.length, 1);
  assert.equal(t.abas[0].location.href, 'blob:pdf');
  assert.equal(t.els['cert-baixar'].hidden, false);
  assert.equal(t.els['cert-baixar'].download, 'certificado-batismo-jose-da-silva.pdf');
});

test('sem imagens salvas não pede assinatura nem carimbo; erro do servidor fecha a aba e aparece no diálogo', async () => {
  const erro = { ok: false, status: 422, json: async () => ({ erro: 'A ficha não tem data de batismo.' }) };
  const t = carregar({ config: { pastor: '', cargo: 'Pastor', assinatura: false, carimbo: false }, respostaPdf: erro });
  await t.Certificado.abrir(membro);
  t.els['cert-gerar'].disparar('click');
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  const pdf = t.chamadas.find((c) => c.metodo === 'FETCH');
  assert.equal(pdf.caminho, '/api/membros/m1/certificado-batismo?cargo=Pastor');
  assert.equal(t.abas[0].closed, true);
  assert.equal(t.els['cert-resultado'].textContent, 'A ficha não tem data de batismo.');
  assert.equal(t.els['cert-resultado'].className, 'erro');
  assert.equal(t.els['cert-baixar'].hidden, true);
});
