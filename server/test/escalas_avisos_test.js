const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function tela() {
  const elementos = new Map();
  const criar = (tag, props = {}, ...filhos) => ({
    tag, ...props, filhos: filhos.flat().filter((f) => f != null), eventos: {},
    addEventListener(nome, fn) { this.eventos[nome] = fn; },
    replaceChildren(...itens) { this.filhos = itens.filter((f) => f != null); },
    showModal() { this.open = true; },
    close() { this.open = false; },
  });
  const $ = (id) => {
    if (!elementos.has(id)) elementos.set(id, criar('div'));
    return elementos.get(id);
  };
  const contexto = vm.createContext({ $, el: criar, document: { querySelectorAll: () => [] }, carregar: {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/escalas.js'), 'utf8'), contexto);
  vm.runInContext(`
    escala.mes = '2026-11';
    escala.dados = {
      titulo: 'novembro de 2026', pode: { pastoral: false, louvor: false },
      cultos: [{ rotulo: 'Domingo, 01/11', horaTexto: '19h', nome: 'Culto',
        funcoes: { pastoral: [], louvor: [] }, pastoral: {}, louvor: {}, musicas: [] }],
      avisos: { pastoral: [], louvor: [] }, indisponibilidades: [], whatsapp: {}
    };
  `, contexto);
  return { $, executar: (codigo) => vm.runInContext(codigo, contexto) };
}

const texto = (no) => typeof no === 'string' ? no : (no.filhos || []).map(texto).join('');

test('contador abre modal com título e descrição dos avisos da aba atual', () => {
  const { $, executar } = tela();
  executar(`escala.dados.avisos.louvor = [{ tipo: 'conflito', titulo: 'Ana em duas funções', texto: 'Domingo, 01/11 · Vocal e Teclado' }]; desenharEscala();`);
  const contador = $('escala-resumo').filhos.find((f) => f.class === 'alerta');
  assert.equal(contador.tag, 'button');
  assert.equal(texto(contador), '1 aviso');
  assert.equal(contador['aria-haspopup'], 'dialog');
  contador.onclick();
  assert.equal($('dlg-avisos-escala').open, true);
  assert.match($('avisos-escala-titulo').textContent, /Louvor/);
  assert.match(texto($('avisos-escala-lista')), /Ana em duas funções/);
  assert.match(texto($('avisos-escala-lista')), /Domingo, 01\/11 · Vocal e Teclado/);
  assert.match(texto($('escala-avisos')), /Ana em duas funções/);
  $('avisos-escala-fechar').eventos.click();
  assert.equal($('dlg-avisos-escala').open, false);
});

test('modal acompanha a troca de aba, exibe todos os avisos e não acumula anteriores', () => {
  const { $, executar } = tela();
  executar(`escala.dados.avisos.louvor = [{ tipo: 'conflito', titulo: 'Aviso antigo', texto: 'Louvor' }]; desenharEscala();`);
  $('escala-resumo').filhos.find((f) => f.tag === 'button').onclick();
  $('avisos-escala-fechar').eventos.click();
  executar(`escala.tipo = 'pastoral'; escala.dados.avisos.pastoral = [
    { tipo: 'indisponivel', titulo: 'Indisponível', texto: 'Paulo em 08/11' },
    { tipo: 'vaga', titulo: 'Função vazia', texto: 'Pregação em 15/11' }
  ]; desenharEscala();`);
  const contador = $('escala-resumo').filhos.find((f) => f.tag === 'button');
  assert.equal(texto(contador), '2 avisos');
  contador.onclick();
  assert.match($('avisos-escala-titulo').textContent, /Pastoral/);
  assert.equal($('avisos-escala-lista').filhos.length, 2);
  assert.match(texto($('avisos-escala-lista')), /Paulo em 08\/11/);
  assert.match(texto($('avisos-escala-lista')), /Pregação em 15\/11/);
  assert.doesNotMatch(texto($('avisos-escala-lista')), /Aviso antigo/);
});

test('sem avisos não há contador clicável', () => {
  const { $, executar } = tela();
  executar('desenharEscala();');
  assert.equal($('escala-resumo').filhos.some((f) => f.tag === 'button'), false);
  assert.match(texto($('escala-avisos')), /Nenhum aviso/);
});

test('página contém modal acessível com botão Fechar e script atualizado', () => {
  const html = fs.readFileSync(path.join(__dirname, '../web/painel.html'), 'utf8');
  assert.match(html, /<dialog id="dlg-avisos-escala" aria-labelledby="avisos-escala-titulo">/);
  assert.match(html, /id="avisos-escala-lista" class="escala-avisos"/);
  assert.match(html, /id="avisos-escala-fechar">Fechar<\/button>/);
  assert.ok(Number(html.match(/src="\/escalas\.js\?v=(\d+)"/)[1]) > 10);
});
