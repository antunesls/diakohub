const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ler = (nome) => fs.readFileSync(path.join(__dirname, '../web', nome), 'utf8');

test('ficha, cadastro público e revisão oferecem casamento e autorização opcional', () => {
  const painel = ler('painel.html'), js = ler('painel.js'), cadastro = ler('cadastro.html');
  for (const id of ['b-conjuge-externo', 'b-conjuge-nome', 'b-data-casamento', 'b-casamento-autorizado']) {
    assert.ok(painel.includes(`id="${id}"`));
  }
  for (const id of ['conjugeNome', 'dataCasamento', 'casamentoAutorizado']) assert.ok(cadastro.includes(`id="${id}"`));
  assert.match(cadastro, /dados\.casamentoAutorizado = \$\('casamentoAutorizado'\)\.checked/);
  assert.match(js, /\['dataCasamento', 'Data do casamento', 'data'\]/);
  assert.match(js, /\['casamentoAutorizado', 'Divulgação do casamento', 'booleano'\]/);
  assert.match(js, /conjugeNome:.*b-conjuge-nome/);
  assert.match(js, /dataCasamento:.*b-data-casamento/);
});

test('trocar cônjuge ou data exige novo aceite e nome livre não cria vínculo', () => {
  const ids = ['b-conjuge-externo', 'b-conjuge', 'b-conjuge-nome', 'b-conjuge-nome-campo',
    'b-data-casamento', 'b-casamento-autorizado'];
  const elementos = Object.fromEntries(ids.map((id) => [id, { value: '', checked: false, eventos: {},
    addEventListener(tipo, fn) { this.eventos[tipo] = fn; } }]));
  const js = ler('painel.js');
  const contexto = vm.createContext({ $: (id) => elementos[id] });
  const inicio = js.indexOf('// ----- Campos do casamento -----');
  const fim = js.indexOf('// ----- Fim dos campos do casamento -----');
  assert.ok(inicio >= 0 && fim > inicio);
  vm.runInContext(js.slice(inicio, fim), contexto);
  elementos['b-conjuge-externo'].checked = true;
  elementos['b-conjuge-externo'].eventos.change();
  assert.equal(elementos['b-conjuge'].disabled, true);
  assert.equal(elementos['b-conjuge-nome-campo'].hidden, false);
  elementos['b-conjuge-nome'].value = 'Bruno';
  elementos['b-data-casamento'].value = '2016-11-18';
  elementos['b-data-casamento'].eventos.input();
  assert.equal(elementos['b-casamento-autorizado'].disabled, false);
  elementos['b-casamento-autorizado'].checked = true;
  elementos['b-conjuge-nome'].value = 'Carlos';
  elementos['b-conjuge-nome'].eventos.input();
  assert.equal(elementos['b-casamento-autorizado'].checked, false);
  assert.equal(elementos['b-data-casamento'].value, '', 'a data do casamento anterior não acompanha outro cônjuge');
});
