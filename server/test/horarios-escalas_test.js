const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TIPOS_ESCALA, horariosParaEscalas, cultosDaEscala } = require('../web/horarios-escalas.js');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('reconhece os horários do site com chave estável, sem depender do nome', () => {
  const horarios = horariosParaEscalas('Domingo — 19h\nQuarta-feira | 20h30 — Oração\nSábado - 9:00\nA combinar');
  assert.deepEqual(horarios.map((h) => h.chave), ['7@19:00', '3@20:30', '6@09:00']);
  assert.equal(horarios[1].rotulo, 'Quarta-feira | 20h30 — Oração');
  assert.deepEqual(horariosParaEscalas('Quarta — 25h\nQuarta — 20h\nQuarta — 20h').map((h) => h.chave), ['3@20:00']);
});

test('cada aba mostra apenas os cultos que participam, mantendo compatibilidade', () => {
  const cultos = [{ id: 'domingo' }, { id: 'quarta', escalaLouvor: false }, { id: 'sexta', escalaPastoral: false }];
  assert.deepEqual(cultosDaEscala(cultos, 'louvor').map((c) => c.id), ['domingo', 'sexta']);
  assert.deepEqual(cultosDaEscala(cultos, 'pastoral').map((c) => c.id), ['domingo', 'quarta']);
  const comInfantil = [...cultos, { id: 'sabado', escalaInfantil: false }];
  assert.deepEqual(cultosDaEscala(comInfantil, 'infantil').map((c) => c.id), ['domingo', 'quarta', 'sexta']);
  assert.deepEqual(TIPOS_ESCALA.map((t) => t.id), ['pastoral', 'louvor', 'infantil', 'recepcao']);
});

test('admin permite desmarcar só louvor e salva as duas opções com os horários', () => {
  const elemento = () => ({
    filhos: [], style: {}, eventos: {}, value: '',
    replaceChildren() { this.filhos = []; },
    append(...filhos) { this.filhos.push(...filhos); },
    setAttribute() {},
    addEventListener(nome, fn) { this.eventos[nome] = fn; },
  });
  const elementos = new Map();
  const $ = (id) => {
    if (!elementos.has(id)) elementos.set(id, elemento());
    return elementos.get(id);
  };
  $('siteCultos').value = 'Domingo — 19h\nQuarta — 20h';
  let salvo;
  const contexto = vm.createContext({ $, TIPOS_ESCALA, horariosParaEscalas, document: {
    createElement: elemento, createTextNode: (texto) => texto,
  }, salvar: (campos) => { salvo = campos; } });
  const js = fs.readFileSync(path.join(__dirname, '../web/admin.js'), 'utf8');
  vm.runInContext(js.slice(js.indexOf('let participacaoCultos'), js.indexOf('// ---------- Carregar')), contexto);
  vm.runInContext('preencherParticipacaoCultos();', contexto);
  const quarta = $('cultos-escalas').filhos[1];
  const louvor = quarta.filhos[2].filhos[0];
  assert.equal(louvor.checked, true);
  louvor.checked = false;
  louvor.eventos.change();
  // Alterar o nome do culto não deve perder a marcação (chave dia + hora).
  $('siteCultos').value = 'Domingo — 19h\nQuarta — 20h — Oração';
  $('siteCultos').eventos.input();
  assert.equal($('cultos-escalas').filhos[1].filhos[2].filhos[0].checked, false);
  vm.runInContext(js.slice(js.indexOf("$('form-inicio').addEventListener"), js.indexOf("$('muralBoasVindas').addEventListener")), contexto);
  $('form-inicio').eventos.submit({ preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(salvo.cultosEscalas)), {
    '7@19:00': { pastoral: true, louvor: true, infantil: true, recepcao: true },
    '3@20:00': { pastoral: true, louvor: false, infantil: true, recepcao: true },
  });
  assert.match(salvo.siteCultos, /Oração/);
});
