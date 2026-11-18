'use strict';

// Casais e Família: aniversários de casamento do mês. Os devocionais têm página própria (devocionais.js).
// Não acessar eu/pode na carga: este arquivo precede painel.js.
let casaisIniciado = false;

async function carregarCasais() {
  if (!pode('casais')) return;
  if (!casaisIniciado) {
    const agora = new Date();
    $('casais-mes').replaceChildren(...Array.from({ length: 12 }, (_, i) => el('option', { value: i + 1 }, new Date(2024, i, 1).toLocaleDateString('pt-BR', { month: 'long' }))));
    $('casais-mes').value = String(agora.getMonth() + 1);
    $('casais-ano').value = String(agora.getFullYear());
    $('casais-filtro').addEventListener('submit', (e) => { e.preventDefault(); consultarCasais(); });
    casaisIniciado = true;
  }
  await consultarCasais();
}

async function consultarCasais() {
  mensagem($('casais-resultado'), 'Consultando aniversários…');
  try {
    const mes = Number($('casais-mes').value), ano = Number($('casais-ano').value);
    if (!Number.isInteger(mes) || mes < 1 || mes > 12 || !Number.isInteger(ano) || ano < 1900 || ano > 9999) throw new Error('Informe mês e ano válidos.');
    const r = await api('GET', `/api/casais?mes=${mes}&ano=${ano}`);
    $('casais-lista').replaceChildren(...r.casais.map((casal) => el('article', { class: 'item' },
      el('div', { class: 'conteudo' }, el('strong', {}, `${casal.nome} e ${casal.conjugeNome || 'cônjuge não informado'}`),
        el('p', { class: 'sub' }, `${(casal.dataAniversario || '').split('-').reverse().join('/')} · ${casal.anos} anos de casamento`),
        ...(casal.contatos || []).map((c) => el('p', { class: 'sub' }, `${c.nome}: ${[c.telefone, c.whatsapp, c.email].filter(Boolean).join(' · ') || 'Sem contato informado'}`))))));
    mensagem($('casais-resultado'), r.casais.length ? `${r.casais.length} casamento(s) neste mês.` : 'Nenhum aniversário de casamento neste mês.');
  } catch (e) { $('casais-lista').replaceChildren(); mensagem($('casais-resultado'), e.message, false); }
}
