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
      el('p', { class: 'sub' }, el('span', { class: 'selo-dev ' + (d.status || 'rascunho') }, situacaoDevocional(d)),
        d.envioAutomatico ? ` · envio automático: ${d.envioAutomatico.enviados} enviado(s)${d.envioAutomatico.falhas ? ', ' + d.envioAutomatico.falhas + ' falha(s)' : ''}` : '')),
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

function abrirEditorDevocional(d = {}, saidaConfirmada = false) {
  if (!pode('devocionais') || (!saidaConfirmada && !confirmarSaidaDevocional())) return;
  devocionalEdicao = { ...d };
  devocionalAlterado = false;
  const caixa = $('devocional-editor');
  caixa.hidden = false;
  const campos = {};
  const status = el('p', { role: 'status' });
  const previa = el('section', { class: 'devocional-previa', 'aria-label': 'Prévia do devocional', hidden: true });
  const compartilhamento = el('div', { class: 'devocional-acoes' });
  const email = el('section');
  const controles = [];
  let previaRevisada = false;
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
  const trilhasCampo = el('fieldset', { class: 'campo largo dev-trilhas', id: 'devocional-trilhas' },
    el('legend', {}, 'Trilhas'), el('p', { class: 'dica' }, 'Quem assina qualquer uma delas recebe o e-mail (uma vez só).'), ...caixasTrilha);

  const enviarAoPublicar = el('input', { type: 'checkbox', id: 'devocional-enviarAoPublicar' });
  enviarAoPublicar.checked = d.enviarAoPublicar === true;
  controles.push(enviarAoPublicar);
  const agenda = el('fieldset', { class: 'campo largo dev-agenda' }, el('legend', {}, 'Agendar publicação (opcional)'),
    campo('publicarEm', 'Publicar em', 'datetime-local'),
    el('label', { class: 'marcar' }, enviarAoPublicar, 'Enviar por e-mail aos assinantes das trilhas quando publicar'),
    el('p', { class: 'dica' }, 'No horário marcado o devocional entra no ar sozinho. Sem esta opção, ninguém recebe e-mail.'));

  const grade = el('div', { class: 'devocional-grade' }, campo('titulo', 'Título'), campo('autorNome', 'Autor', 'text', eu?.nome || ''), campo('data', 'Data', 'date', data),
    campo('referencia', 'Referência bíblica'), trilhasCampo,
    campo('serie', 'Série (opcional)', 'text', '', { maxlength: 120, placeholder: 'ex.: Frutos do Espírito' }),
    campo('serieParte', 'Parte da série', 'number', '', { min: 1, max: 365 }),
    campo('texto', 'Reflexão', 'textarea'), campo('aplicacao', 'Aplicação', 'textarea'), campo('oracao', 'Oração', 'textarea'), agenda);

  const ler = () => {
    const parte = campos.serieParte.value.trim();
    return {
      ...Object.fromEntries(['titulo', 'autorNome', 'data', 'referencia', 'texto', 'aplicacao', 'oracao', 'serie'].map((k) => [k, campos[k].value.trim()])),
      trilhas: caixasTrilha.map((l) => l.children[0]).filter((i) => i.checked).map((i) => i.value),
      serieParte: parte ? Number(parte) : null,
      publicarEm: campos.publicarEm.value || null,
      enviarAoPublicar: enviarAoPublicar.checked,
    };
  };
  function alterou() {
    devocionalAlterado = true;
    previaRevisada = false;
    publicar.textContent = 'Publicar agora';
    compartilhamento.replaceChildren(); email.replaceChildren(); previa.hidden = true;
    mensagem(status, 'Alterações não salvas. Salve antes de compartilhar o link ou enviar e-mail.');
  }
  form.addEventListener('input', alterou);
  form.addEventListener('change', alterou);
  async function operacao(fn) {
    if (devocionalOcupado) return;
    devocionalOcupado = true;
    controles.forEach((c) => { c.disabled = true; });
    try { await fn(); }
    catch (e) { mensagem(status, e.message, false); }
    finally { devocionalOcupado = false; controles.forEach((c) => { c.disabled = false; }); }
  }
  async function salvar(novoStatus) {
    if (!form.reportValidity()) return;
    const corpo = { ...ler(), status: novoStatus };
    if (!corpo.trilhas.length) return mensagem(status, 'Marque pelo menos uma trilha.', false);
    if (corpo.serie === '') corpo.serie = null;
    if (novoStatus === 'agendado' && !corpo.publicarEm) return mensagem(status, 'Escolha a data e a hora de publicação para agendar.', false);
    await operacao(async () => {
      const id = devocionalEdicao.id;
      const salvo = await api(id ? 'PUT' : 'POST', '/api/devocionais' + (id ? '/' + encodeURIComponent(id) : ''), corpo);
      devocionalEdicao = { ...devocionalEdicao, ...corpo, ...salvo };
      if (!devocionalEdicao.id) throw new Error('O servidor não retornou o identificador. Recarregue a lista antes de continuar.');
      devocionalAlterado = false;
      mensagem(status, {
        publicado: 'Publicado. Nenhum e-mail foi enviado.',
        agendado: `Agendado para ${dataDevocional(salvo.publicarEm)}. ${salvo.enviarAoPublicar ? 'Na hora, sai o e-mail para os assinantes das trilhas.' : 'Nenhum e-mail será enviado.'}`,
      }[novoStatus] || 'Rascunho salvo. Não está disponível pelo link público.');
      atualizarCompartilhamento(); email.replaceChildren();
      await listarDevocionais();
    });
  }
  function acao(texto, fn, classe) { const b = botao(texto, fn, classe); controles.push(b); return b; }
  function atualizarCompartilhamento() {
    const link = linkDevocional(devocionalEdicao);
    compartilhamento.replaceChildren();
    if (!link || devocionalAlterado) return;
    compartilhamento.append(el('a', { class: 'botao secundario pequeno', href: link, target: '_blank', rel: 'noopener' }, 'Abrir página pública'),
      el('a', { class: 'botao secundario pequeno', target: '_blank', rel: 'noopener', href: 'https://wa.me/?text=' + encodeURIComponent(`${devocionalEdicao.titulo}\nUm devocional para você. Leia: ${link}`) }, 'Compartilhar link no WhatsApp'),
      acao('Preparar e-mail', async () => {
        await operacao(async () => { await prepararEmailDevocional(devocionalEdicao, email, () => devocionalAlterado); });
      }));
  }
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
  const publicar = acao('Publicar agora', async () => {
    previa.replaceChildren(renderizarDevocional(ler())); previa.hidden = false;
    if (!previaRevisada) {
      previaRevisada = true; publicar.textContent = 'Confirmar publicação';
      mensagem(status, 'Confira a prévia abaixo. Depois clique em Confirmar publicação. Nenhum e-mail será enviado.');
      return;
    }
    if (confirm('Publicar este conteúdo para qualquer pessoa com o link? Nenhum e-mail será enviado.')) await salvar('publicado');
  });
  const acoes = el('div', { class: 'devocional-acoes' },
    acao('Salvar', () => salvar(devocionalEdicao.status || 'rascunho'), 'pequeno'),
    acao('Salvar como rascunho / retirar do ar', () => salvar('rascunho')),
    acao('Agendar', () => salvar('agendado')),
    acao('Ver prévia', () => { previa.replaceChildren(renderizarDevocional(ler())); previa.hidden = false; }),
    publicar,
    acao('Copiar texto integral', async () => {
      try { await navigator.clipboard.writeText(textoDevocional(ler())); mensagem(status, 'Texto integral copiado. Cole na conversa desejada.'); }
      catch { mensagem(status, 'Não foi possível copiar. Use a prévia para selecionar e copiar o texto.', false); }
    }),
    acao('Fechar edição', () => { if (confirmarSaidaDevocional()) { devocionalAlterado = false; caixa.hidden = true; } }),
    d.id ? acao('Excluir', async () => {
      if (!confirm('Excluir este devocional? O link deixará de funcionar e alterações não salvas serão descartadas.')) return;
      await operacao(async () => { await api('DELETE', `/api/devocionais/${encodeURIComponent(devocionalEdicao.id)}`); devocionalAlterado = false; caixa.hidden = true; await listarDevocionais(); });
    }, 'perigo pequeno') : null);
  form.addEventListener('submit', (e) => { e.preventDefault(); salvar(devocionalEdicao.status || 'rascunho'); });
  form.append(grade, el('div', { class: 'campo' }, el('label', { for: 'devocional-importar' }, 'Importar reflexão (.docx, .txt ou .md)'), arquivo), acoes, status);
  const situacao = d.id ? el('p', { class: 'dica' }, situacaoDevocional(d),
    d.envioAutomatico ? ` · envio automático em ${dataDevocional(String(d.envioAutomatico.em || '').slice(0, 16))}: ${d.envioAutomatico.enviados} enviado(s)` : '') : null;
  caixa.replaceChildren(...[el('h3', {}, d.id ? 'Editar devocional' : 'Novo devocional'), situacao, form, previa, compartilhamento, email].filter(Boolean));
  atualizarCompartilhamento(); campos.titulo.focus();
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
