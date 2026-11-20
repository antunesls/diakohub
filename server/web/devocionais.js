'use strict';

// Página Devocionais do painel: lista, editor (trilhas, série, agendamento), calendário e assinantes.
// Não acessar eu/pode na carga: este arquivo precede painel.js.
let devocionaisIniciado = false;
let devocionalEdicao = null;
let devocionalAlterado = false;
let devocionalOcupado = false;
let devocionaisLista = [];
let trilhasDevocionais = [];
let devAbaAtual = 'lista';
let devMes = null; // primeiro dia do mês mostrado no calendário

const SITUACOES_DEVOCIONAL = { rascunho: 'Rascunho', agendado: 'Agendado', publicado: 'Publicado' };

function confirmarSaidaDevocional() {
  if (devocionalOcupado) { alert('Aguarde a operação terminar.'); return false; }
  return !devocionalAlterado || confirm('Há alterações não salvas no devocional. Sair sem salvar?');
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (evento) => {
    if (devocionalAlterado || devocionalOcupado) { evento.preventDefault(); evento.returnValue = ''; }
  });
}

/** "2026-11-19T07:00" -> "19/11/2026 às 07:00"; "2026-11-19" -> "19/11/2026". */
function dataDevocional(valor) {
  if (!valor) return '';
  const [dia, hora] = String(valor).split('T');
  const br = dia.split('-').reverse().join('/');
  return hora ? `${br} às ${hora.slice(0, 5)}` : br;
}

function nomeTrilhaDevocional(id) {
  return trilhasDevocionais.find((t) => t.id === id)?.nome || id;
}

function situacaoDevocional(d) {
  if (d.status === 'agendado') return `Agendado para ${dataDevocional(d.publicarEm)}${d.enviarAoPublicar ? ' · envia e-mail aos assinantes' : ''}`;
  return SITUACOES_DEVOCIONAL[d.status] || d.status || 'Rascunho';
}

/** Situação do e-mail na lista: "✓ Enviado a 36", "36 enviados · 1 falha" ou "Não enviado" (só publicados). */
function seloEnvioDevocional(d) {
  const e = d.envio || {};
  if (e.enviados || e.falhas || e.incertos) {
    const extra = [e.falhas ? `${e.falhas} falha${e.falhas === 1 ? '' : 's'}` : '', e.incertos ? `${e.incertos} a conferir` : ''].filter(Boolean).join(' · ');
    const texto = !e.enviados && e.falhas ? `Envio falhou: ${e.falhas} não receberam` : extra ? `${e.enviados || 0} enviados · ${extra}` : `✓ Enviado a ${e.enviados}`;
    return el('span', { class: 'selo-envio ' + (extra ? 'atencao' : 'ok') }, texto);
  }
  return d.status === 'publicado' ? el('span', { class: 'selo-envio nao' }, 'E-mail não enviado') : null;
}

function serieDevocional(d) {
  return d.serie ? `Série ${d.serie}${d.serieParte ? ' · parte ' + d.serieParte : ''}` : '';
}

async function carregarDevocionais() {
  if (!pode('devocionais')) return;
  if (!devocionaisIniciado) {
    $('devocional-novo').addEventListener('click', () => abrirEditorDevocional());
    for (const id of ['dev-filtro-status', 'dev-filtro-trilha', 'dev-filtro-busca']) $(id).addEventListener('input', desenharListaDevocionais);
    document.querySelectorAll('[data-dev-aba]').forEach((b) => b.addEventListener('click', () => mostrarAbaDevocionais(b.dataset.devAba)));
    $('dev-mes-anterior').addEventListener('click', () => { devMes = new Date(devMes.getFullYear(), devMes.getMonth() - 1, 1); desenharCalendarioDevocionais(); });
    $('dev-mes-proximo').addEventListener('click', () => { devMes = new Date(devMes.getFullYear(), devMes.getMonth() + 1, 1); desenharCalendarioDevocionais(); });
    $('dev-projetar-qr').addEventListener('click', projetarQrDevocionais);
    const hoje = new Date();
    devMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    devocionaisIniciado = true;
  }
  await listarDevocionais();
}

function mostrarAbaDevocionais(nome) {
  devAbaAtual = nome;
  document.querySelectorAll('[data-dev-aba]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.devAba === nome)));
  for (const aba of ['lista', 'calendario', 'assinantes']) $('dev-aba-' + aba).hidden = aba !== nome;
  if (nome === 'calendario') desenharCalendarioDevocionais();
  if (nome === 'assinantes') carregarAssinantesDevocionais();
}

async function listarDevocionais() {
  if (!pode('devocionais')) return;
  try {
    [devocionaisLista, trilhasDevocionais] = await Promise.all([api('GET', '/api/devocionais'), api('GET', '/api/devocionais/trilhas')]);
    const filtro = $('dev-filtro-trilha'), atual = filtro.value;
    filtro.replaceChildren(el('option', { value: '' }, 'Todas'), ...trilhasDevocionais.map((t) => el('option', { value: t.id }, t.nome + (t.ativa ? '' : ' (desativada)'))));
    filtro.value = trilhasDevocionais.some((t) => t.id === atual) ? atual : '';
    desenharListaDevocionais();
    if (devAbaAtual === 'calendario') desenharCalendarioDevocionais();
  } catch (e) { mensagem($('devocionais-resultado'), e.message, false); }
}

function semAcentoDevocional(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

function desenharListaDevocionais() {
  const status = $('dev-filtro-status').value, trilha = $('dev-filtro-trilha').value, busca = semAcentoDevocional($('dev-filtro-busca').value.trim());
  const lista = devocionaisLista.filter((d) => (!status || d.status === status) && (!trilha || (d.trilhas || []).includes(trilha)) &&
    (!busca || semAcentoDevocional([d.titulo, d.autorNome, d.serie].join(' ')).includes(busca)));
  $('devocionais-lista').replaceChildren(...lista.map((d) => el('article', { class: 'item' },
    el('div', { class: 'conteudo' }, el('strong', {}, d.titulo),
      el('p', { class: 'sub' }, [dataDevocional(d.data), (d.trilhasNomes || []).join(', '), serieDevocional(d)].filter(Boolean).join(' · ')),
      el('p', { class: 'sub' }, el('span', { class: 'selo-dev ' + (d.status || 'rascunho') }, situacaoDevocional(d)), ' ', seloEnvioDevocional(d))),
    botao('Editar', async () => {
      if (!confirmarSaidaDevocional()) return;
      try { abrirEditorDevocional(await api('GET', `/api/devocionais/${encodeURIComponent(d.id)}`), true); }
      catch (e) { mensagem($('devocionais-resultado'), e.message, false); }
    }))));
  if (!lista.length) {
    $('devocionais-lista').append(el('p', { class: 'dica' }, devocionaisLista.length ? 'Nenhum devocional com esse filtro.' : 'Nenhum devocional ainda. Crie o primeiro rascunho.'));
  }
}

// ---------- Calendário ----------

/** Dia em que o devocional aparece no calendário: o do agendamento, senão a data dele. */
function diaNoCalendario(d) {
  return d.status === 'agendado' && d.publicarEm ? d.publicarEm.slice(0, 10) : d.data;
}

function desenharCalendarioDevocionais() {
  const ano = devMes.getFullYear(), mes = devMes.getMonth();
  $('dev-mes-titulo').textContent = devMes.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const doDia = new Map();
  for (const d of devocionaisLista) {
    const dia = diaNoCalendario(d);
    if (!doDia.has(dia)) doDia.set(dia, []);
    doDia.get(dia).push(d);
  }
  const cabecalho = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((n) => el('div', { class: 'dev-cal-cab', 'aria-hidden': 'true' }, n));
  const vazios = Array.from({ length: new Date(ano, mes, 1).getDay() }, () => el('div', { class: 'dev-cal-dia vazio', 'aria-hidden': 'true' }));
  const hoje = new Date();
  const dias = Array.from({ length: new Date(ano, mes + 1, 0).getDate() }, (_, i) => {
    const iso = `${ano}-${String(mes + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
    const itens = doDia.get(iso) || [];
    const ehHoje = hoje.getFullYear() === ano && hoje.getMonth() === mes && hoje.getDate() === i + 1;
    return el('div', { class: 'dev-cal-dia' + (ehHoje ? ' hoje' : '') + (itens.length ? '' : ' livre') },
      el('span', { class: 'dev-cal-num' }, String(i + 1),
        el('span', { class: 'dev-cal-semana' }, ' ' + new Date(ano, mes, i + 1).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''))),
      ...itens.map((d) => el('button', {
        type: 'button', class: 'dev-cal-item ' + (d.status || 'rascunho'), title: `${d.titulo} · ${situacaoDevocional(d)}`,
        onclick: async () => {
          if (!confirmarSaidaDevocional()) return;
          try { abrirEditorDevocional(await api('GET', `/api/devocionais/${encodeURIComponent(d.id)}`), true); }
          catch (e) { mensagem($('devocionais-resultado'), e.message, false); }
        },
      }, (d.status === 'agendado' ? d.publicarEm.slice(11, 16) + ' ' : '') + d.titulo)));
  });
  $('dev-calendario').replaceChildren(...cabecalho, ...vazios, ...dias);
}

// ---------- Assinantes e divulgação ----------

async function carregarAssinantesDevocionais() {
  try {
    const r = await api('GET', '/api/devocionais/assinantes');
    $('dev-assinantes').replaceChildren(
      el('div', { class: 'dev-numeros' },
        el('div', {}, el('strong', {}, String(r.ativos)), el('span', {}, 'assinantes confirmados')),
        el('div', {}, el('strong', {}, String(r.pendentes)), el('span', {}, 'aguardando confirmação')),
        el('div', {}, el('strong', {}, String(r.cancelados)), el('span', {}, 'cancelaram'))),
      el('table', { class: 'dev-tabela' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Trilha'), el('th', {}, 'Assinantes'))),
        el('tbody', {}, r.trilhas.map((t) => el('tr', {}, el('td', {}, t.nome, t.ativa ? '' : ' (desativada)'), el('td', {}, String(t.ativos)))))),
      el('p', { class: 'dica' }, 'Por privacidade, aqui aparecem só os números. Quem assina duas trilhas conta nas duas, mas recebe um e-mail só por devocional.'));
  } catch (e) { mensagem($('devocionais-resultado'), e.message, false); }
}

async function projetarQrDevocionais() {
  try {
    const estadoAtual = await api('GET', '/api/estado');
    if (!estadoAtual.qrDevocionalHolyrics) throw new Error('O QR dos devocionais ainda não foi gerado. Reinicie o servidor.');
    const r = await api('POST', '/api/holyrics/ShowImage', { file: estadoAtual.qrDevocionalHolyrics });
    mensagem($('dev-qr-resultado'), r.status === 'ok' ? 'QR dos devocionais no telão.' : r.error, r.status === 'ok');
  } catch (e) { mensagem($('dev-qr-resultado'), e.message, false); }
}

// ---------- Leitura e texto ----------

function textoDevocional(d) {
  return [d.titulo, serieDevocional(d), [d.autorNome, d.data].filter(Boolean).join(' · '), d.referencia,
    'Reflexão\n' + (d.texto || ''), 'Aplicação\n' + (d.aplicacao || ''), 'Oração\n' + (d.oracao || '')].filter(Boolean).join('\n\n');
}
function linkDevocional(d) {
  return d.status === 'publicado' && d.id ? `${location.origin}/devocional?id=${encodeURIComponent(d.id)}` : '';
}
function paragrafosDevocional(texto) {
  return String(texto || '').split(/\n\s*\n/).filter(Boolean).map((parte) => {
    const titulo = parte.match(/^#{1,3}\s+([^\n]+)$/);
    return el(titulo ? 'h3' : 'p', {}, titulo ? titulo[1] : parte);
  });
}
function renderizarDevocional(d) {
  return el('article', { class: 'devocional-leitura' }, el('h2', {}, d.titulo || 'Sem título'),
    serieDevocional(d) ? el('p', { class: 'dica' }, serieDevocional(d)) : null,
    el('p', { class: 'dica' }, [d.autorNome, dataDevocional(d.data), (d.trilhas || []).map(nomeTrilhaDevocional).join(', ')].filter(Boolean).join(' · ')),
    el('p', {}, d.referencia || ''),
    ...[['Reflexão', d.texto], ['Aplicação', d.aplicacao], ['Oração', d.oracao]].flatMap(([titulo, texto]) => [el('h3', {}, titulo), ...paragrafosDevocional(texto)]));
}

// ---------- Editor ----------
// Texto à esquerda; à direita, o painel "Publicação": situação, quando, trilhas, envio aos assinantes
// (com a quantidade), um botão principal que muda conforme a escolha, teste para mim, histórico e divulgação.

/** "2026-11-20T09:51:00.000" (ISO do servidor) -> "20/11 às 09:51". */
function quandoEnvio(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} às ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Uma linha da linha do tempo de envios: "Enviado a 36 assinantes · 1 falha". */
function textoHistoricoEnvio(h) {
  const falhas = h.falhas ? ` · ${h.falhas} falha${h.falhas === 1 ? '' : 's'}` : '';
  const incertos = h.incertos ? ` · ${h.incertos} a conferir` : '';
  if (h.tipo === 'teste') return 'Teste enviado';
  if (!h.enviados && h.falhas) return `Envio falhou: ${h.falhas} não receberam${h.tipo === 'automatico' ? ' (automático)' : ''}`;
  if (h.tipo === 'automatico') return `Envio automático: ${h.enviados || 0} enviado${h.enviados === 1 ? '' : 's'}${falhas}${incertos}`;
  const quem = h.assinantes ? 'assinantes' : 'pessoas';
  return `Enviado a ${h.enviados || 0} ${quem}${falhas}${incertos}`;
}

/** Texto curto para colar no Canal do WhatsApp: título, referência, começo da reflexão e o link. */
function textoCanalDevocional(d, link) {
  const reflexao = String(d.texto || '').replace(/^#{1,3}\s+.*$/gm, '').trim().split(/\n\s*\n/)[0] || '';
  const trecho = reflexao.length > 280 ? reflexao.slice(0, 277).replace(/\s+\S*$/, '') + '…' : reflexao;
  return [`*${d.titulo}*`, d.referencia, trecho, `Leia o devocional completo: ${link}`].filter(Boolean).join('\n\n');
}

function abrirEditorDevocional(d = {}, saidaConfirmada = false) {
  if (!pode('devocionais') || (!saidaConfirmada && !confirmarSaidaDevocional())) return;
  devocionalEdicao = { ...d };
  devocionalAlterado = false;
  const caixa = $('devocional-editor');
  caixa.hidden = false;
  const campos = {};
  const status = el('p', { role: 'status' });
  const previa = el('section', { class: 'devocional-previa', 'aria-label': 'Prévia do devocional', hidden: true });
  const email = el('section');
  const painel = el('aside', { class: 'dev-publicacao', 'aria-label': 'Publicação' });
  const controles = [];
  const form = el('form');
  const hoje = new Date();
  const data = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  function campo(nome, titulo, tipo = 'text', valor = '', extra = {}) {
    const id = 'devocional-' + nome;
    const input = tipo === 'textarea' ? el('textarea', { id, rows: 6 })
      : el('input', { id, type: tipo, required: ['titulo', 'autorNome', 'data'].includes(nome), maxlength: tipo === 'text' ? 300 : null, ...extra });
    input.value = d[nome] ?? valor;
    campos[nome] = input;
    controles.push(input);
    return el('div', { class: 'campo' + (tipo === 'textarea' ? ' largo' : '') }, el('label', { for: id }, titulo), input);
  }

  // Trilhas: as ativas e, se o devocional já estava numa desativada, ela também (para não sumir sem querer).
  const escolhidas = new Set(d.trilhas || (d.tema ? [d.tema] : []));
  if (!d.id && !escolhidas.size && trilhasDevocionais.some((t) => t.ativa)) escolhidas.add(trilhasDevocionais.find((t) => t.ativa).id);
  const caixasTrilha = trilhasDevocionais.filter((t) => t.ativa || escolhidas.has(t.id)).map((t) => {
    const input = el('input', { type: 'checkbox', value: t.id });
    input.checked = escolhidas.has(t.id);
    controles.push(input);
    return el('label', { class: 'marcar' }, input, t.nome + (t.ativa ? '' : ' (desativada)'));
  });
  const trilhasMarcadas = () => caixasTrilha.map((l) => l.children[0]).filter((i) => i.checked).map((i) => i.value);
  const trilhasCampo = el('fieldset', { class: 'campo largo dev-trilhas', id: 'devocional-trilhas' },
    el('legend', {}, 'Trilhas'), el('p', { class: 'dica' }, 'Quem assina qualquer uma delas recebe o e-mail (uma vez só).'), ...caixasTrilha);

  const grade = el('div', { class: 'devocional-grade' }, campo('titulo', 'Título'), campo('autorNome', 'Autor', 'text', eu?.nome || ''), campo('data', 'Data', 'date', data),
    campo('referencia', 'Referência bíblica'), trilhasCampo,
    campo('serie', 'Série (opcional)', 'text', '', { maxlength: 120, placeholder: 'ex.: Frutos do Espírito' }),
    campo('serieParte', 'Parte da série', 'number', '', { min: 1, max: 365 }),
    campo('texto', 'Reflexão', 'textarea'), campo('aplicacao', 'Aplicação', 'textarea'), campo('oracao', 'Oração', 'textarea'));

  // Controles do painel (fora do <form>, mas contam como alteração do devocional).
  const agendado = d.status === 'agendado';
  const quandoAgora = el('input', { type: 'radio', name: 'devocional-quando', id: 'devocional-quando-agora', value: 'agora' });
  const quandoAgendar = el('input', { type: 'radio', name: 'devocional-quando', id: 'devocional-quando-agendar', value: 'agendar' });
  quandoAgendar.checked = agendado;
  quandoAgora.checked = !agendado;
  const publicarEm = el('input', { type: 'datetime-local', id: 'devocional-publicarEm', 'aria-label': 'Data e hora da publicação' });
  publicarEm.value = d.publicarEm || '';
  campos.publicarEm = publicarEm;
  // Enviar aos assinantes: ligado por padrão (é o que quase sempre se quer); agendado guarda a escolha feita.
  const enviarAoPublicar = el('input', { type: 'checkbox', id: 'devocional-enviarAoPublicar', class: 'interruptor' });
  enviarAoPublicar.checked = agendado ? d.enviarAoPublicar === true : true;
  controles.push(quandoAgora, quandoAgendar, publicarEm, enviarAoPublicar);

  let assinantes = { total: null, porTrilha: {} }; // quantos receberiam com as trilhas marcadas
  let pendentes = null; // publicado: quantos ainda não receberam (novos assinantes e falhas)
  let confirmando = false, enviando = false, resultadoEnvio = null, testeAberto = false;

  const ler = () => {
    const parte = campos.serieParte.value.trim();
    const agendar = quandoAgendar.checked;
    return {
      ...Object.fromEntries(['titulo', 'autorNome', 'data', 'referencia', 'texto', 'aplicacao', 'oracao', 'serie'].map((k) => [k, campos[k].value.trim()])),
      trilhas: trilhasMarcadas(),
      serieParte: parte ? Number(parte) : null,
      publicarEm: agendar ? publicarEm.value || null : null,
      // Publicar agora envia na hora (pelo botão); o servidor só envia sozinho no agendamento.
      enviarAoPublicar: agendar && enviarAoPublicar.checked,
    };
  };

  let recontagem = null;
  async function contarAssinantes() {
    const ids = trilhasMarcadas();
    try {
      const r = ids.length ? await api('GET', '/api/devocionais/assinantes/contagem?trilhas=' + encodeURIComponent(ids.join(','))) : { total: 0, porTrilha: {} };
      assinantes = { total: Number.isFinite(r?.total) ? r.total : null, porTrilha: r?.porTrilha || {} };
    } catch { assinantes = { total: null, porTrilha: {} }; }
    desenharPainel();
  }
  async function contarPendentes() {
    pendentes = null;
    if (devocionalEdicao.status !== 'publicado' || devocionalAlterado || !devocionalEdicao.id) return desenharPainel();
    try {
      const r = await api('POST', `/api/devocionais/${encodeURIComponent(devocionalEdicao.id)}/previa-email`, { membrosIds: [], incluirAssinantes: true });
      pendentes = Number.isFinite(r?.aEnviar) ? r.aEnviar : null;
    } catch { pendentes = null; }
    desenharPainel();
  }

  function alterou() {
    devocionalAlterado = true;
    confirmando = false;
    resultadoEnvio = null;
    email.replaceChildren(); previa.hidden = true;
    mensagem(status, 'Alterações não salvas.');
    desenharPainel();
  }
  form.addEventListener('input', alterou);
  form.addEventListener('change', alterou);
  for (const c of [quandoAgora, quandoAgendar, publicarEm, enviarAoPublicar]) c.addEventListener('change', alterou);
  for (const l of caixasTrilha) l.children[0].addEventListener('change', () => { clearTimeout(recontagem); recontagem = setTimeout(contarAssinantes, 250); });

  async function operacao(fn) {
    if (devocionalOcupado) return;
    devocionalOcupado = true;
    controles.forEach((c) => { c.disabled = true; });
    try { await fn(); }
    catch (e) { mensagem(status, e.message, false); }
    finally { devocionalOcupado = false; controles.forEach((c) => { c.disabled = false; }); desenharPainel(); }
  }

  /** Grava com [novoStatus]; devolve true se gravou. Não envia e-mail (o envio é outra chamada). */
  async function gravar(novoStatus) {
    if (!form.reportValidity()) return false;
    const corpo = { ...ler(), status: novoStatus };
    if (!corpo.trilhas.length) { mensagem(status, 'Marque pelo menos uma trilha.', false); return false; }
    if (corpo.serie === '') corpo.serie = null;
    if (novoStatus === 'agendado' && !corpo.publicarEm) { mensagem(status, 'Escolha a data e a hora de publicação para agendar.', false); return false; }
    const id = devocionalEdicao.id;
    const salvo = await api(id ? 'PUT' : 'POST', '/api/devocionais' + (id ? '/' + encodeURIComponent(id) : ''), corpo);
    devocionalEdicao = { ...devocionalEdicao, ...corpo, ...salvo };
    if (!devocionalEdicao.id) throw new Error('O servidor não retornou o identificador. Recarregue a lista antes de continuar.');
    devocionalAlterado = false;
    return true;
  }
  async function salvar(novoStatus) {
    await operacao(async () => {
      if (!await gravar(novoStatus)) return;
      mensagem(status, {
        publicado: 'Salvo. Está publicado.',
        agendado: `Agendado para ${dataDevocional(devocionalEdicao.publicarEm)}. ${devocionalEdicao.enviarAoPublicar ? 'Na hora, sai o e-mail para os assinantes das trilhas.' : 'Nenhum e-mail será enviado.'}`,
      }[novoStatus] || 'Rascunho salvo. Não está disponível pelo link público.');
      await listarDevocionais();
      await contarPendentes();
    });
  }

  /** Envia aos assinantes das trilhas do devocional publicado (quem já recebeu é pulado no servidor). */
  async function enviarAosAssinantes() {
    enviando = true; desenharPainel();
    const id = devocionalEdicao.id;
    try {
      const r = await api('POST', `/api/devocionais/${encodeURIComponent(id)}/email`, { membrosIds: [], incluirAssinantes: true, confirmar: true });
      resultadoEnvio = r;
      try { devocionalEdicao = { ...devocionalEdicao, ...await api('GET', `/api/devocionais/${encodeURIComponent(id)}`) }; } catch { /* o recibo da resposta basta */ }
    } catch (e) {
      resultadoEnvio = { erro: e.message };
    } finally {
      enviando = false;
    }
    await listarDevocionais();
    await contarPendentes();
  }

  function principal() {
    const st = devocionalEdicao.status || 'rascunho';
    const n = assinantes.total;
    const qtd = n === null ? 'aos assinantes' : `a ${n} assinante${n === 1 ? '' : 's'}`;
    if (st === 'publicado' && !devocionalAlterado) {
      if (!pendentes) return null;
      const jaFoi = (devocionalEdicao.envio?.enviados || 0) > 0;
      return { texto: jaFoi ? `Enviar aos ${pendentes} que faltam` : `Enviar aos ${pendentes} assinante${pendentes === 1 ? '' : 's'}`,
        pergunta: `Enviar "${devocionalEdicao.titulo}" para ${pendentes} pessoa${pendentes === 1 ? '' : 's'} agora? Cada uma recebe uma vez; não dá para desfazer.`,
        sim: 'Sim, enviar', acao: () => operacao(enviarAosAssinantes) };
    }
    if (st === 'publicado') return { texto: 'Salvar alterações', acao: () => salvar('publicado') };
    if (quandoAgendar.checked) {
      return { texto: enviarAoPublicar.checked ? `Agendar e enviar ${qtd}` : 'Agendar', acao: () => salvar('agendado') };
    }
    if (!enviarAoPublicar.checked) {
      return { texto: 'Publicar agora', pergunta: 'Publicar agora? Fica aberto a qualquer pessoa com o link. Ninguém recebe e-mail.',
        sim: 'Sim, publicar', acao: () => salvar('publicado') };
    }
    return { texto: `Publicar e enviar ${qtd}`,
      pergunta: `Publicar agora e enviar ${qtd}? Depois de enviado, não dá para desfazer.`, sim: 'Sim, publicar e enviar',
      acao: () => operacao(async () => {
        if (!await gravar('publicado')) return;
        mensagem(status, 'Publicado.');
        await enviarAosAssinantes();
      }) };
  }

  function recibo() {
    const env = devocionalEdicao.envio || { enviados: 0, falhas: 0, incertos: 0 };
    if (resultadoEnvio?.erro) return el('div', { class: 'dev-recibo erro', role: 'status' }, el('strong', {}, 'O envio não foi concluído'), el('span', {}, resultadoEnvio.erro));
    if (resultadoEnvio?.aviso) return el('div', { class: 'dev-recibo erro', role: 'status' }, el('strong', {}, 'Nenhum e-mail saiu'), el('span', {}, resultadoEnvio.aviso));
    if (!env.enviados && !env.falhas && !env.incertos) return null;
    const ultimo = (devocionalEdicao.historicoEnvios || []).find((x) => x.tipo !== 'teste');
    return el('div', { class: 'dev-recibo', role: 'status' },
      el('strong', {}, `✓ Enviado a ${env.enviados} pessoa${env.enviados === 1 ? '' : 's'}`),
      el('span', {}, [ultimo ? quandoEnvio(ultimo.em) + (ultimo.por ? ' · por ' + ultimo.por : ultimo.tipo === 'automatico' ? ' · automático' : '') : '',
        env.falhas ? `${env.falhas} falha${env.falhas === 1 ? '' : 's'} (o botão abaixo tenta de novo)` : '',
        env.incertos ? `${env.incertos} a conferir (não são reenviados sozinhos)` : ''].filter(Boolean).join(' · ')));
  }

  function desenharPainel() {
    const st = devocionalEdicao.status || 'rascunho';
    const publicado = st === 'publicado';
    const p = principal();
    const linha = (rotulo, ...valor) => el('div', { class: 'dev-linha' }, el('span', {}, rotulo), el('span', {}, ...valor));
    const nomes = trilhasMarcadas().map(nomeTrilhaDevocional);
    const porTrilha = trilhasMarcadas().map((t) => assinantes.porTrilha[t] !== undefined ? `${nomeTrilhaDevocional(t)} (${assinantes.porTrilha[t]})` : nomeTrilhaDevocional(t)).join(', ');
    const n = assinantes.total;

    const blocoQuando = publicado ? null : el('fieldset', { class: 'dev-quando' }, el('legend', {}, 'Quando'),
      el('label', { class: 'marcar' }, quandoAgora, 'Agora'),
      el('label', { class: 'marcar' }, quandoAgendar, 'Agendar'),
      quandoAgendar.checked ? publicarEm : null);
    const blocoEnvio = publicado ? null : el('label', { class: 'dev-interruptor' }, enviarAoPublicar,
      el('span', {}, 'Enviar por e-mail aos assinantes',
        el('small', {}, n === null ? 'Assinantes das trilhas marcadas.' : n === 0 ? 'Ninguém assina essas trilhas ainda.'
          : `${n} pessoa${n === 1 ? '' : 's'}: ${porTrilha}. Quem assina mais de uma recebe um só.`)));

    let acaoPrincipal = null;
    if (enviando) {
      acaoPrincipal = el('div', { class: 'dev-confirmar', role: 'status' }, el('strong', {}, 'Enviando…'), el('span', { class: 'dica' }, 'Pode levar alguns minutos. Não feche esta página.'));
    } else if (p && confirmando && p.pergunta) {
      acaoPrincipal = el('div', { class: 'dev-confirmar' }, el('p', {}, p.pergunta),
        el('div', { class: 'devocional-acoes' }, botao(p.sim, () => { confirmando = false; return p.acao(); }, 'pequeno'), botao('Cancelar', () => { confirmando = false; desenharPainel(); })));
    } else if (p) {
      const b = botao(p.texto, () => { if (!p.pergunta) return p.acao(); confirmando = true; desenharPainel(); }, 'dev-principal');
      b.disabled = devocionalOcupado;
      acaoPrincipal = b;
    } else if (publicado) {
      const env = devocionalEdicao.envio?.enviados || 0;
      acaoPrincipal = el('p', { class: 'dica' }, pendentes === null ? 'Conferindo os assinantes…' : env ? 'Todos os assinantes das trilhas já receberam.' : 'Ninguém assina essas trilhas ainda.');
    }

    // Teste para mim: o e-mail fica guardado neste navegador para a próxima vez.
    let teste = null;
    if (testeAberto) {
      let lembrado = '';
      try { lembrado = localStorage.getItem('diako_email_teste_devocional') || ''; } catch { /* sem armazenamento */ }
      const emailTeste = el('input', { type: 'email', id: 'devocional-email-teste', placeholder: 'seu@email.com', 'aria-label': 'E-mail para o teste' });
      emailTeste.value = lembrado;
      teste = el('div', { class: 'dev-teste' }, emailTeste, botao('Enviar teste', () => operacao(async () => {
        const destino = emailTeste.value.trim();
        if (!destino) throw new Error('Informe o e-mail para o teste.');
        if (!devocionalEdicao.id || devocionalAlterado) {
          if (!await gravar(devocionalEdicao.status || 'rascunho')) return;
          await listarDevocionais();
        }
        await api('POST', `/api/devocionais/${encodeURIComponent(devocionalEdicao.id)}/teste`, { email: destino });
        try { localStorage.setItem('diako_email_teste_devocional', destino); } catch { /* sem armazenamento */ }
        try { devocionalEdicao = { ...devocionalEdicao, ...await api('GET', `/api/devocionais/${encodeURIComponent(devocionalEdicao.id)}`) }; } catch { /* segue */ }
        testeAberto = false;
        mensagem(status, `Teste enviado para ${destino}. Confira a caixa de entrada (e o spam).`);
      }), 'pequeno'));
    }

    const historico = devocionalEdicao.historicoEnvios || [];
    const link = linkDevocional(devocionalEdicao);
    const copiar = (texto, ok) => async () => {
      try { await navigator.clipboard.writeText(texto()); mensagem(status, ok); }
      catch { mensagem(status, 'Não foi possível copiar. Use a prévia para selecionar e copiar o texto.', false); }
    };

    painel.replaceChildren(...[
      el('div', { class: 'cartao dev-cartao' }, el('h4', {}, 'Publicação'),
        linha('Situação', el('span', { class: 'selo-dev ' + st }, publicado ? 'Publicado' : agendadoTexto(st))),
        publicado && devocionalEdicao.publicadoEm ? linha('No ar desde', quandoEnvio(devocionalEdicao.publicadoEm)) : null,
        linha('Trilhas', nomes.join(', ') || '—'),
        blocoQuando, blocoEnvio, recibo(), acaoPrincipal,
        el('div', { class: 'dev-secundarias' },
          testeAberto ? null : botao('Enviar um teste para mim', () => { testeAberto = true; desenharPainel(); }),
          publicado && !devocionalAlterado ? botao('Enviar para pessoas específicas…', () => operacao(async () => {
            await prepararEmailDevocional(devocionalEdicao, email, () => devocionalAlterado);
            if (email.scrollIntoView) email.scrollIntoView({ block: 'start' });
          })) : null),
        teste),
      el('div', { class: 'cartao dev-cartao' }, el('h4', {}, 'Histórico de envios'),
        historico.length ? el('ul', { class: 'dev-historico' }, ...historico.slice(0, 10).map((h) =>
          el('li', { class: h.falhas ? 'falha' : h.tipo === 'teste' ? 'teste' : 'ok' }, el('span', {}, textoHistoricoEnvio(h)),
            el('small', {}, [quandoEnvio(h.em), h.por ? 'por ' + h.por : h.tipo === 'automatico' ? 'agendamento' : ''].filter(Boolean).join(' · ')))))
          : el('p', { class: 'dica' }, (devocionalEdicao.envio?.enviados || 0) ? `${devocionalEdicao.envio.enviados} e-mails enviados antes do histórico existir.` : 'Os envios e testes aparecem aqui, com data e quem fez.')),
      link && !devocionalAlterado ? el('div', { class: 'cartao dev-cartao' }, el('h4', {}, 'Divulgar'),
        el('div', { class: 'dev-secundarias' },
          el('a', { class: 'botao secundario pequeno', href: link, target: '_blank', rel: 'noopener' }, 'Abrir página pública'),
          botao('Copiar link', copiar(() => link, 'Link copiado.')),
          botao('Copiar para o Canal', copiar(() => textoCanalDevocional(devocionalEdicao, link), 'Texto para o Canal do WhatsApp copiado. Cole no Canal da igreja.')),
          el('a', { class: 'botao secundario pequeno', target: '_blank', rel: 'noopener', href: 'https://wa.me/?text=' + encodeURIComponent(`${devocionalEdicao.titulo}\nUm devocional para você. Leia: ${link}`) }, 'Compartilhar no WhatsApp'))) : null,
    ].filter(Boolean));
  }
  function agendadoTexto(st) {
    return st === 'agendado' ? `Agendado · ${dataDevocional(devocionalEdicao.publicarEm)}` : 'Rascunho';
  }

  function acao(texto, fn, classe) { const b = botao(texto, fn, classe); controles.push(b); return b; }
  const arquivo = el('input', { type: 'file', id: 'devocional-importar', accept: '.docx,.txt,.md' }); controles.push(arquivo);
  arquivo.addEventListener('change', async () => {
    const f = arquivo.files?.[0]; if (!f) return;
    if (campos.texto.value && !confirm('Substituir a reflexão pelo texto importado?')) { arquivo.value = ''; return; }
    await operacao(async () => {
      const r = await api('POST', '/api/devocionais/importar?nome=' + encodeURIComponent(f.name), f, { bruto: true, tipo: f.type || 'application/octet-stream' });
      campos.texto.value = r.texto || ''; alterou(); mensagem(status, 'Texto importado para a reflexão. Revise antes de salvar.');
    });
    arquivo.value = '';
  });
  const publicadoAntes = d.status === 'publicado';
  const acoes = el('div', { class: 'devocional-acoes' },
    acao(publicadoAntes ? 'Salvar' : 'Salvar rascunho', () => salvar(devocionalEdicao.status === 'publicado' ? 'publicado' : devocionalEdicao.status === 'agendado' ? 'agendado' : 'rascunho'), 'pequeno'),
    acao('Ver prévia', () => { previa.replaceChildren(renderizarDevocional(ler())); previa.hidden = false; if (previa.scrollIntoView) previa.scrollIntoView({ block: 'start' }); }),
    acao('Copiar texto integral', async () => {
      try { await navigator.clipboard.writeText(textoDevocional(ler())); mensagem(status, 'Texto integral copiado. Cole na conversa desejada.'); }
      catch { mensagem(status, 'Não foi possível copiar. Use a prévia para selecionar e copiar o texto.', false); }
    }),
    acao('Fechar edição', () => { if (confirmarSaidaDevocional()) { devocionalAlterado = false; caixa.hidden = true; } }),
    publicadoAntes ? acao('Retirar do ar', async () => {
      if (!confirm('Retirar do ar? O link deixa de funcionar até publicar de novo. Quem já recebeu o e-mail não é afetado.')) return;
      await salvar('rascunho');
    }) : null,
    d.id ? acao('Excluir', async () => {
      if (!confirm('Excluir este devocional? O link deixará de funcionar e alterações não salvas serão descartadas.')) return;
      await operacao(async () => { await api('DELETE', `/api/devocionais/${encodeURIComponent(devocionalEdicao.id)}`); devocionalAlterado = false; caixa.hidden = true; await listarDevocionais(); });
    }, 'perigo pequeno') : null);
  form.addEventListener('submit', (e) => { e.preventDefault(); salvar(devocionalEdicao.status || 'rascunho'); });
  form.append(grade, el('div', { class: 'campo' }, el('label', { for: 'devocional-importar' }, 'Importar reflexão (.docx, .txt ou .md)'), arquivo), acoes, status);
  caixa.replaceChildren(el('h3', {}, d.id ? 'Editar devocional' : 'Novo devocional'),
    el('div', { class: 'dev-editor-layout' }, el('div', { class: 'dev-editor-texto' }, form, previa, email), painel));
  desenharPainel();
  contarAssinantes();
  contarPendentes();
  campos.titulo.focus();
  if (caixa.scrollIntoView) caixa.scrollIntoView({ block: 'start' });
}

async function prepararEmailDevocional(d, caixa, alterado) {
  if (d.status !== 'publicado' || alterado()) throw new Error('Salve e publique o devocional antes de preparar e-mail.');
  const membros = await api('GET', '/api/devocionais/destinatarios');
  const selecoes = membros.map((m) => ({ m, input: el('input', { type: 'checkbox', value: m.id }) }));
  const assinantes = el('input', { type: 'checkbox' });
  const resultado = el('p', { role: 'status' });
  const previa = el('div');
  const selecao = el('fieldset', {}, el('legend', {}, 'Destinatários'),
    el('p', { class: 'dica' }, 'Selecione membros e/ou os assinantes confirmados das trilhas deste devocional. Publicar não envia mensagens.'),
    el('div', { class: 'devocional-destinatarios' }, ...selecoes.map(({ m, input }) => el('label', { class: 'marcar' }, input, `${m.nome} (${m.email})`))),
    el('label', { class: 'marcar' }, assinantes, 'Incluir assinantes confirmados das trilhas'));
  let ocupado = false, selecaoVersao = 0;
  selecao.addEventListener('change', () => { selecaoVersao++; previa.replaceChildren(); });
  const preparar = botao('Gerar prévia de e-mail', async () => {
    if (ocupado || alterado()) return;
    const corpo = { membrosIds: selecoes.filter(({ input }) => input.checked).map(({ m }) => m.id), incluirAssinantes: assinantes.checked };
    const versao = selecaoVersao;
    ocupado = true; selecao.disabled = true; preparar.disabled = true; previa.replaceChildren();
    try {
      const r = await api('POST', `/api/devocionais/${encodeURIComponent(d.id)}/previa-email`, corpo);
      if (alterado() || versao !== selecaoVersao) return;
      const enviar = botao('Confirmar e enviar e-mail', async () => {
        if (ocupado || alterado() || versao !== selecaoVersao || enviar.disabled) return;
        if (!confirm(`Enviar este devocional para ${r.total} destinatário(s)? Os já enviados não serão repetidos.`)) return;
        ocupado = true; devocionalOcupado = true; enviar.disabled = true; selecao.disabled = true; preparar.disabled = true;
        try {
          const envio = await api('POST', `/api/devocionais/${encodeURIComponent(d.id)}/email`, { ...corpo, confirmar: true });
          const quantidade = (v) => Array.isArray(v) ? v.length : Number(v || 0);
          mensagem(resultado, `Enviados: ${quantidade(envio.enviados)}. Ignorados: ${quantidade(envio.ignorados)}. Falhas: ${quantidade(envio.falhas)}. Incertos: ${quantidade(envio.incertos)}.${envio.aviso ? ' ' + envio.aviso : ' Envios incertos precisam de conferência; não são reenviados automaticamente.'}`, !envio.aviso);
          previa.replaceChildren();
        } catch (e) { mensagem(resultado, e.message + ' Gere uma nova prévia para conferir o estado antes de tentar novamente.', false); previa.replaceChildren(); }
        finally { ocupado = false; devocionalOcupado = false; selecao.disabled = false; preparar.disabled = false; }
      }, 'pequeno');
      enviar.disabled = !r.total;
      previa.replaceChildren(el('h3', {}, r.assunto || d.titulo),
        el('p', {}, `${r.total} destinatário(s). Já enviados: ${Array.isArray(r.jaEnviados) ? r.jaEnviados.length : Number(r.jaEnviados || 0)}.`),
        el('pre', { class: 'devocional-email-texto' }, r.texto || ''), enviar);
    } catch (e) { mensagem(resultado, e.message, false); }
    finally { ocupado = false; selecao.disabled = false; preparar.disabled = false; }
  });
  caixa.replaceChildren(el('h3', {}, 'Envio manual de e-mail'), selecao, preparar, resultado, previa);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { dataDevocional, diaNoCalendario };
