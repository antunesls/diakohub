const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const web = (nome) => fs.readFileSync(require('node:path').join(__dirname, '../web', nome), 'utf8');

function ambiente(permissoes = ['casais', 'devocionais'], arquivo = 'casais.js') {
  class No {
    constructor(tag, props = {}, filhos = []) { this.tag = tag; this.props = props; this.children = filhos.flat().filter(Boolean); this.value = props.value || ''; this.checked = false; this.disabled = false; this.hidden = false; this.events = {}; }
    append(...filhos) { this.children.push(...filhos.flat()); }
    replaceChildren(...filhos) { this.children = filhos.flat(); }
    addEventListener(nome, fn) { this.events[nome] = fn; }
    setAttribute(nome, valor) { this.props[nome] = valor; }
    focus() {}
    reportValidity() { return true; }
  }
  const nos = new Map();
  const chamadas = [];
  const contexto = vm.createContext({ console, URL, URLSearchParams, Date, setTimeout,
    el: (tag, props = {}, ...filhos) => new No(tag, props, filhos),
    botao: (texto, fn) => new No('button', { onclick: fn }, [texto]),
    $: (id) => { if (!nos.has(id)) nos.set(id, new No('div')); return nos.get(id); },
    mensagem: (no, texto) => { no.textContent = texto; },
    pode: (p) => permissoes.includes(p), eu: { nome: 'Líder' },
    window: { addEventListener() {} }, document: { addEventListener() {}, querySelectorAll: () => [] }, location: { origin: 'https://igreja.test' },
    confirm: () => true, alert() {}, navigator: { clipboard: { writeText: async () => {} } },
    api: async (metodo, url, corpo) => { chamadas.push({ metodo, url, corpo }); if (url.startsWith('/api/casais')) return { casais: [{ id: 'c', nome: '<img>', conjugeNome: 'Ana', dataAniversario: '2026-11-20', anos: 5, contatos: [] }] }; return []; },
  });
  vm.runInContext(web(arquivo), contexto);
  return { contexto, nos, chamadas, run: (codigo) => vm.runInContext(codigo, contexto) };
}

test('menu e painel integram Casais e Família, que não carrega mais devocionais', () => {
  const menu = require('../web/menu-lateral.js');
  assert.ok(menu.gruposPermitidos(['casais']).find((g) => g.nome === 'Acompanhamento').itens.some((i) => i.id === 'casais'));
  const html = web('painel.html');
  assert.match(html, /data-painel="casais"/);
  assert.ok(html.indexOf('/casais.js?') < html.indexOf('/painel.js?'));
  assert.match(web('painel.js'), /casais: carregarCasais/);
  assert.doesNotMatch(web('casais.js'), /api\/devocionais|abrirEditorDevocional|devocionais-gestao/);
  assert.match(html, /data-ir="devocionais"/); // atalho para a página própria
});

test('consulta mensal restrita não busca membros nem devocionais e usa DOM seguro', async () => {
  const a = ambiente(['casais']);
  await a.run('carregarCasais()');
  assert.equal(a.chamadas.length, 1);
  assert.match(a.chamadas[0].url, /^\/api\/casais\?mes=\d+&ano=\d+/);
  assert.ok(a.nos.get('casais-lista').children.length);
  assert.doesNotMatch(web('casais.js'), /innerHTML|\/api\/membros/);
});

module.exports = { ambiente, web };
