'use strict';

// Não acessar eu/pode na carga: este arquivo precede painel.js.
let casaisIniciado = false;
let devocionalEdicao = null;
let devocionalAlterado = false;
let devocionalOcupado = false;

function confirmarSaidaDevocional() {
  if (devocionalOcupado) { alert('Aguarde a operação terminar.'); return false; }
  return !devocionalAlterado || confirm('Há alterações não salvas no devocional. Sair sem salvar?');
}
window.addEventListener('beforeunload', (evento) => {
  if (devocionalAlterado || devocionalOcupado) { evento.preventDefault(); evento.returnValue = ''; }
});

async function carregarCasais() {
  if (!pode('casais')) return;
  if (!casaisIniciado) {
    const agora = new Date();
    $('casais-mes').replaceChildren(...Array.from({ length: 12 }, (_, i) => el('option', { value: i + 1 }, new Date(2024, i, 1).toLocaleDateString('pt-BR', { month: 'long' }))));
    $('casais-mes').value = String(agora.getMonth() + 1);
    $('casais-ano').value = String(agora.getFullYear());
    $('casais-filtro').addEventListener('submit', (e) => { e.preventDefault(); consultarCasais(); });
    $('devocional-novo').addEventListener('click', () => abrirEditorDevocional());
    casaisIniciado = true;
  }
  $('devocionais-gestao').hidden = !pode('devocionais');
  await consultarCasais();
  if (pode('devocionais')) await listarDevocionais();
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

async function listarDevocionais() {
  if (!pode('devocionais')) return;
  try {
    const lista = await api('GET', '/api/devocionais');
    $('devocionais-lista').replaceChildren(...lista.map((d) => el('article', { class: 'item' },
      el('div', { class: 'conteudo' }, el('strong', {}, d.titulo), el('p', { class: 'sub' }, `${d.data || ''} · ${d.tema === 'familia' ? 'Família' : 'Casais'} · ${d.status === 'publicado' ? 'Publicado' : 'Rascunho'}`)),
      botao('Editar', async () => {
        if (!confirmarSaidaDevocional()) return;
        try { abrirEditorDevocional(await api('GET', `/api/devocionais/${encodeURIComponent(d.id)}`), true); }
        catch (e) { mensagem($('devocionais-resultado'), e.message, false); }
      }))));
    if (!lista.length) $('devocionais-lista').append(el('p', { class: 'dica' }, 'Nenhum devocional. Crie o primeiro rascunho.'));
  } catch (e) { mensagem($('devocionais-resultado'), e.message, false); }
}

function textoDevocional(d) {
  return [d.titulo, [d.autorNome, d.data].filter(Boolean).join(' · '), d.referencia,
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
    el('p', { class: 'dica' }, [d.autorNome, d.data, d.tema === 'familia' ? 'Família' : 'Casais'].filter(Boolean).join(' · ')),
    el('p', {}, d.referencia || ''),
    ...[['Reflexão', d.texto], ['Aplicação', d.aplicacao], ['Oração', d.oracao]].flatMap(([titulo, texto]) => [el('h3', {}, titulo), ...paragrafosDevocional(texto)]));
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
  const compartilhamento = el('div', { class: 'devocional-acoes' });
  const email = el('section');
  const controles = [];
  let previaRevisada = false;
  const form = el('form');
  const hoje = new Date();
  const data = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  function campo(nome, titulo, tipo = 'text', valor = '') {
    const id = 'devocional-' + nome;
    const input = tipo === 'textarea' ? el('textarea', { id, rows: 6 }) : el('input', { id, type: tipo, required: ['titulo', 'autorNome', 'data'].includes(nome), maxlength: tipo === 'text' ? 300 : null });
    input.value = d[nome] || valor;
    campos[nome] = input;
    controles.push(input);
    return el('div', { class: 'campo' + (tipo === 'textarea' ? ' largo' : '') }, el('label', { for: id }, titulo), input);
  }
  const tema = el('select', { id: 'devocional-tema' }, el('option', { value: 'casais' }, 'Casais'), el('option', { value: 'familia' }, 'Família'));
  tema.value = d.tema || 'casais'; campos.tema = tema; controles.push(tema);
  const grade = el('div', { class: 'devocional-grade' }, campo('titulo', 'Título'), campo('autorNome', 'Autor', 'text', eu?.nome || ''), campo('data', 'Data', 'date', data),
    el('div', { class: 'campo' }, el('label', { for: 'devocional-tema' }, 'Tema'), tema), campo('referencia', 'Referência bíblica'), campo('texto', 'Reflexão', 'textarea'), campo('aplicacao', 'Aplicação', 'textarea'), campo('oracao', 'Oração', 'textarea'));
  const ler = () => Object.fromEntries(Object.entries(campos).map(([k, input]) => [k, input.value.trim()]));
  function alterou() {
    devocionalAlterado = true;
    previaRevisada = false;
    publicar.textContent = 'Publicar';
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
    await operacao(async () => {
      const corpo = { ...ler(), status: novoStatus };
      const id = devocionalEdicao.id;
      const salvo = await api(id ? 'PUT' : 'POST', '/api/devocionais' + (id ? '/' + encodeURIComponent(id) : ''), corpo);
      devocionalEdicao = { ...devocionalEdicao, ...corpo, ...salvo };
      if (!devocionalEdicao.id) throw new Error('O servidor não retornou o identificador. Recarregue a lista antes de continuar.');
      devocionalAlterado = false;
      mensagem(status, novoStatus === 'publicado' ? 'Publicado. Nenhum e-mail foi enviado.' : 'Rascunho salvo. Não está disponível pelo link público.');
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
      el('a', { class: 'botao secundario pequeno', target: '_blank', rel: 'noopener', href: 'https://wa.me/?text=' + encodeURIComponent(`${devocionalEdicao.titulo}\nUm devocional para nossa família. Leia: ${link}`) }, 'Compartilhar link no WhatsApp'),
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
  const publicar = acao('Publicar', async () => {
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
  caixa.replaceChildren(el('h3', {}, d.id ? 'Editar devocional' : 'Novo devocional'), form, previa, compartilhamento, email);
  atualizarCompartilhamento(); campos.titulo.focus();
}

async function prepararEmailDevocional(d, caixa, alterado) {
  if (d.status !== 'publicado' || alterado()) throw new Error('Salve e publique o devocional antes de preparar e-mail.');
  const membros = await api('GET', '/api/devocionais/destinatarios');
  const selecoes = membros.map((m) => ({ m, input: el('input', { type: 'checkbox', value: m.id }) }));
  const assinantes = el('input', { type: 'checkbox' });
  const resultado = el('p', { role: 'status' });
  const previa = el('div');
  const selecao = el('fieldset', {}, el('legend', {}, 'Destinatários'),
    el('p', { class: 'dica' }, 'Selecione membros e/ou assinantes confirmados deste tema. Publicar não envia mensagens.'),
    el('div', { class: 'devocional-destinatarios' }, ...selecoes.map(({ m, input }) => el('label', { class: 'marcar' }, input, `${m.nome} (${m.email})`))),
    el('label', { class: 'marcar' }, assinantes, 'Incluir assinantes confirmados do tema'));
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
