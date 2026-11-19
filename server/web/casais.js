'use strict';

// Casais e Família: aniversários de casamento do mês. Os devocionais têm página própria (devocionais.js).
// Não acessar eu/pode na carga: este arquivo precede painel.js.
let casaisIniciado = false;
let casaisEdicao = false;
let casaisConsultando = false;
let casaisEditorAtivo = null;

function confirmarSaidaCasais() {
  if (casaisEdicao && !confirm('Descartar a mensagem de Casais e Família em edição?')) return false;
  casaisEdicao = false;
  return true;
}

async function carregarCasais() {
  if (!pode('casais')) return;
  if (!casaisIniciado) {
    const agora = new Date();
    $('casais-mes').replaceChildren(...Array.from({ length: 12 }, (_, i) => el('option', { value: i + 1 }, new Date(2024, i, 1).toLocaleDateString('pt-BR', { month: 'long' }))));
    $('casais-mes').value = String(agora.getMonth() + 1);
    $('casais-ano').value = String(agora.getFullYear());
    $('casais-filtro').addEventListener('submit', (e) => { e.preventDefault(); consultarCasais(); });
    window.addEventListener('beforeunload', (e) => { if (casaisEdicao) { e.preventDefault(); e.returnValue = ''; } });
    casaisIniciado = true;
  }
  await consultarCasais();
}

async function consultarCasais() {
  if (casaisConsultando) return;
  if (casaisEdicao && !confirm('Descartar a mensagem em edição e atualizar a consulta?')) return;
  casaisConsultando = true;
  mensagem($('casais-resultado'), 'Consultando aniversários…');
  try {
    const mes = Number($('casais-mes').value), ano = Number($('casais-ano').value);
    if (!Number.isInteger(mes) || mes < 1 || mes > 12 || !Number.isInteger(ano) || ano < 1900 || ano > 2200) throw new Error('Informe mês e ano válidos.');
    const r = await api('GET', `/api/casais?mes=${mes}&ano=${ano}`);
    $('casais-lista').replaceChildren(...r.casais.map(cartaoCasal));
    casaisEdicao = false;
    casaisEditorAtivo = null;
    mensagem($('casais-resultado'), r.casais.length ? `${r.casais.length} casamento(s) neste mês.` : 'Nenhum aniversário de casamento neste mês.');
  } catch (e) { mensagem($('casais-resultado'), e.message, false); }
  finally { casaisConsultando = false; }
}

function baseCasal(casal) {
  return { membrosIds: casal.membrosIds || [casal.membroId, casal.conjugeId].filter(Boolean),
    dataCasamento: casal.dataCasamento, ...(!casal.conjugeId ? { conjugeNome: casal.conjugeNome } : {}) };
}

function acaoCasal(rotulo, fn, resultado) {
  const b = botao(rotulo, async () => {
    if (b.disabled) return;
    b.disabled = true;
    try { await fn(); } catch (e) { mensagem(resultado, e.message, false); }
    finally { b.disabled = false; }
  });
  return b;
}

const tiposContatoCasal = { parabenizado: 'Parabéns', convite_enviado: 'Convite enviado', contato_realizado: 'Contato realizado' };
// "2026-11-19" ou "2026-11-19T10:00:00" → "19/11/2026" (lê o texto, sem fuso).
const diaCasal = (iso) => String(iso || '').slice(0, 10).split('-').reverse().join('/');

function cartaoCasal(casal) {
  const resultado = el('p', { role: 'status', 'aria-live': 'polite' });
  const historicoLista = casal.contatosHistory || [];
  const conteudo = el('div', { class: 'conteudo' },
    el('div', { class: 'titulo' }, `${casal.nome} e ${casal.conjugeNome || 'cônjuge não informado'}`, ' ',
      el('span', { class: `etiqueta ${casal.parabenizado ? 'nova' : ''}` }, casal.parabenizado ? 'Parabenizado' : 'Parabéns pendentes')),
    el('p', { class: 'sub' }, `${diaCasal(casal.dataAniversario)} · ${casal.anos} ${casal.anos === 1 ? 'ano' : 'anos'} de casamento`),
    ...(casal.contatos || []).map(c => el('p', { class: 'sub' }, `${c.nome}: ${[...new Set([c.telefone, c.whatsapp, c.email].filter(Boolean))].join(' · ') || 'Sem contato informado'}`)),
    casal.parabenizado ? el('p', { class: 'sub' }, `Parabéns registrados por ${casal.parabenizado.usuarioNome || 'responsável'} em ${diaCasal(casal.parabenizado.realizadoEm)}.`) : null);
  const gerenciar = pode('casaisGerenciar');
  const historico = el('details', { class: 'casais-detalhes' }, el('summary', {}, `Histórico operacional (${historicoLista.length})`));
  if (!historicoLista.length) historico.append(el('p', { class: 'dica' }, 'Nenhum contato registrado.'));
  for (const contato of historicoLista) {
    const linha = el('div', { class: 'casais-historico' }, el('p', {}, `${tiposContatoCasal[contato.tipo] || contato.tipo} · ${diaCasal(contato.realizadoEm)} · ${contato.usuarioNome || 'Responsável'}${contato.anuladoEm ? ` · anulado em ${diaCasal(contato.anuladoEm)}` : ''}`));
    if (gerenciar && !contato.anuladoEm) linha.append(acaoCasal('Anular registro', async () => {
      if (!confirm('Anular este registro? A autoria e a anulação serão preservadas.')) return;
      await api('POST', `/api/casais/contatos/${encodeURIComponent(contato.id)}/anular`, {});
      await consultarCasais();
    }, resultado));
    historico.append(linha);
  }
  if (gerenciar) {
    const editor = el('div', { class: 'casais-editor' });
    const preparar = acaoCasal('Preparar mensagem', async () => {
      if (casaisEdicao && !confirm('Descartar edição anterior e preparar esta mensagem?')) return;
      if (casaisEditorAtivo) casaisEditorAtivo.replaceChildren();
      editor.replaceChildren();
      casaisEditorAtivo = editor;
      abrirMensagemCasal(casal, editor, resultado);
      casaisEdicao = true;
    }, resultado);
    const tipo = el('select', { 'aria-label': 'Tipo de contato' },
      ...Object.entries(tiposContatoCasal).map(([v, t]) => el('option', { value: v }, t)));
    tipo.value = 'parabenizado';
    const hoje = new Date();
    const data = el('input', { type: 'date', 'aria-label': 'Data do contato', value: `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}` });
    conteudo.append(el('div', { class: 'casais-acoes' }, preparar), editor,
      el('div', { class: 'casais-acoes casais-registro' }, el('span', { class: 'dica' }, 'Registrar contato feito:'), tipo, data, acaoCasal('Registrar contato realizado', async () => {
        if (!confirm('Confirmar que este contato foi realizado?')) return;
        await api('POST', '/api/casais/contatos', { ...baseCasal(casal), tipo: tipo.value, realizadoEm: data.value,
          ...(tipo.value === 'parabenizado' ? { ocorrencia: casal.dataAniversario } : {}) });
        await consultarCasais();
      }, resultado)));
  }
  conteudo.append(historico, resultado);
  return el('article', { class: 'item casais-cartao' }, conteudo);
}

function abrirMensagemCasal(casal, editor, resultado) {
  const contatos = casal.contatos || [];
  const destinatario = el('select', { 'aria-label': 'Destinatário da mensagem' }, ...contatos.map(c => el('option', { value: c.membroId }, c.nome)));
  destinatario.value = contatos[0]?.membroId || '';
  const texto = el('textarea', { rows: 7, maxlength: 10000, 'aria-label': 'Mensagem editável de parabéns' });
  texto.value = `${casal.nome} e ${casal.conjugeNome}, parabéns pelos ${casal.anos} ${casal.anos === 1 ? 'ano' : 'anos'} de casamento em ${(casal.dataAniversario || '').split('-').reverse().join('/')}! Que Deus abençoe a família de vocês.`;
  const previa = el('div', { class: 'casais-previa' });
  let revisada = null;
  const invalidar = () => { revisada = null; previa.replaceChildren(); casaisEdicao = true; };
  texto.addEventListener('input', invalidar);
  destinatario.addEventListener('change', invalidar);
  const pedido = () => ({ ...baseCasal(casal), ocorrencia: casal.dataAniversario, destinatarioMembroId: destinatario.value, texto: texto.value });
  editor.append(el('label', {}, 'Contato selecionado', destinatario), el('label', {}, 'Mensagem', texto),
    el('div', { class: 'casais-acoes' },
      acaoCasal('Copiar mensagem', async () => { await navigator.clipboard.writeText(texto.value); mensagem(resultado, 'Texto copiado; contato não registrado.'); }, resultado),
      acaoCasal('Abrir WhatsApp', async () => {
        const contato = contatos.find(c => c.membroId === destinatario.value);
        let numero = (contato?.whatsapp || contato?.telefone || '').replace(/\D/g, '');
        if (numero.length === 10 || numero.length === 11) numero = `55${numero}`;
        if (numero.length < 12 || numero.length > 15) throw new Error('Contato sem número de WhatsApp válido.');
        window.open(`https://wa.me/${numero}?text=${encodeURIComponent(texto.value)}`, '_blank', 'noopener,noreferrer');
        mensagem(resultado, 'WhatsApp aberto; envio e registro dependem de ação humana.');
      }, resultado),
      acaoCasal('Prévia de e-mail', async () => {
        const corpo = pedido();
        const r = await api('POST', '/api/casais/parabens/previa', corpo);
        if (JSON.stringify(corpo) !== JSON.stringify(pedido())) throw new Error('A mensagem mudou. Prepare nova prévia.');
        revisada = { corpo, previaId: r.previaId };
        previa.replaceChildren(el('p', {}, `Para: ${r.destinatario} · ${r.assunto}`), el('pre', {}, r.texto),
          acaoCasal('Confirmar envio de e-mail', async () => {
            if (!revisada || JSON.stringify(revisada.corpo) !== JSON.stringify(pedido())) throw new Error('Revise uma nova prévia.');
            if (!confirm('Enviar exatamente esta mensagem ao destinatário exibido?')) return;
            const envio = revisada;
            revisada = null;
            const resposta = await api('POST', '/api/casais/parabens/email', { ...envio.corpo, previaId: envio.previaId, confirmar: true });
            previa.replaceChildren();
            const status = { aceito_smtp: 'E-mail aceito pelo SMTP; entrega não garantida e contato não registrado.',
              nao_enviado: 'Envio cancelado antes do SMTP: os dados ou consentimento mudaram. Atualize a consulta.',
              incerto: 'Resultado incerto. Não repita o envio; confira com o destinatário.' };
            mensagem(resultado, status[resposta.estado] || status.incerto);
          }, resultado));
      }, resultado),
      acaoCasal('Fechar mensagem', async () => { if (confirm('Descartar esta edição?')) { editor.replaceChildren(); casaisEdicao = false; casaisEditorAtivo = null; } }, resultado)), previa);
}
