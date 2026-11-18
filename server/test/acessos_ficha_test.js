const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const web = (arquivo) => fs.readFileSync(path.join(__dirname, '../web', arquivo), 'utf8');

/** Roda só a desenharFicha(), com um DOM de mentira, e devolve o que foi para replaceChildren. */
function desenhar(usuario) {
  const js = web('acessos.js');
  const inicio = js.indexOf('function desenharFicha() {');
  const quebra = js.includes('\r\n') ? '\r\n' : '\n';
  const fim = js.indexOf(`${quebra}}${quebra}`, inicio);
  assert.ok(inicio >= 0 && fim > inicio, 'desenharFicha não encontrada');
  const fonte = js.slice(inicio, fim + quebra.length + 1);

  const ficha = { filhos: [], replaceChildren: (...filhos) => { ficha.filhos = filhos; } };
  const el = (tag, props = {}, ...filhos) => ({ tag, props, filhos: filhos.flat().filter((f) => f !== null && f !== undefined) });
  const contexto = vm.createContext({
    console,
    $: () => ficha,
    el,
    botao: (texto) => ({ tag: 'button', texto }),
    blocoPermissoes: () => ({ tag: 'div' }),
    dataCurta: () => '01/01/2026',
    nomePerfil: (id) => (id === 'lider-casais' ? 'Líder de Casais e Família' : id),
    perfilPorId: (id) => id === 'lider-casais'
      ? { id, nome: 'Líder de Casais e Família', descricao: 'Consulta casais e contatos limitados.', permissoes: ['casais', 'devocionais'] }
      : null,
    idsDe: () => ['lider-casais'],
    souAdmin: () => true,
    foraDoAlcance: () => false,
    pessoas: [usuario],
    perfis: [],
    selecionada: usuario.id,
    rascunho: null,
  });
  vm.runInContext(fonte, contexto);
  contexto.desenharFicha();
  return ficha.filhos;
}

const poliana = {
  id: 'p1', nome: 'POLIANA CRISTINA GUIGON DA CRUZ', login: 'poliana', ativo: true,
  ultimoAcesso: null, membroId: 'm1', trocarSenha: true, senhaTemporariaVencida: false,
};

test('ficha de quem está no primeiro acesso não escreve "null" na tela', () => {
  const filhos = desenhar(poliana);
  assert.ok(filhos.length >= 4, 'a ficha precisa mostrar topo, perfis, permissões e ações');
  assert.ok(!filhos.includes(null), 'replaceChildren não pode receber null (vira o texto "null")');
  assert.ok(!filhos.some((f) => typeof f === 'string' && f.trim() === 'null'));
});

test('ficha de conta ativa, sem mudança pendente, também não escreve "null"', () => {
  const filhos = desenhar({ ...poliana, trocarSenha: false, ultimoAcesso: '2026-11-18T10:00:00' });
  assert.ok(!filhos.includes(null));
  assert.ok(!filhos.some((f) => typeof f === 'string' && f.trim() === 'null'));
});
