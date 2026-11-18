const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const web = (arquivo) => fs.readFileSync(path.join(__dirname, '../web', arquivo), 'utf8');

/** Roda opcoesPessoas() com um select de mentira e devolve o que foi para replaceChildren. */
function opcoes(pessoas, tipo = 'louvor') {
  const js = web('escalas.js');
  const inicio = js.indexOf('function opcoesPessoas(select) {');
  const quebra = js.includes('\r\n') ? '\r\n' : '\n';
  const fim = js.indexOf(`${quebra}}${quebra}`, inicio);
  assert.ok(inicio >= 0 && fim > inicio, 'opcoesPessoas não encontrada');
  const select = { recebidos: [], replaceChildren: (...nos) => { select.recebidos = nos; } };
  const contexto = vm.createContext({
    console,
    el: (tag, props = {}, ...filhos) => ({ tag, props, filhos: filhos.flat().filter((f) => f !== null && f !== undefined) }),
    NOMES_ESCALA: { pastoral: 'Pastoral', louvor: 'Louvor' },
    escala: { tipo, dados: { pessoas } },
  });
  vm.runInContext(js.slice(inicio, fim + quebra.length + 1), contexto);
  contexto.opcoesPessoas(select);
  return select.recebidos;
}

test('lista de indisponibilidades não escreve "null" quando todos (ou ninguém) têm o ministério', () => {
  const todos = opcoes([{ id: '1', nome: 'Ana', louvor: true }, { id: '2', nome: 'Bia', louvor: true }]);
  const nenhum = opcoes([{ id: '3', nome: 'Caio', louvor: false }]);
  for (const recebidos of [todos, nenhum]) {
    assert.ok(!recebidos.includes(null), 'replaceChildren não pode receber null');
    assert.ok(!recebidos.some((n) => typeof n === 'string' && n.trim() === 'null'));
  }
  assert.equal(todos.length, 2, 'opção vazia + grupo do ministério');
  assert.equal(nenhum.length, 2, 'opção vazia + grupo dos outros');
});
