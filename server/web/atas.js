'use strict';

// Atas de reunião: lista, editor, ficha (finalizar, aprovar, retificar, PDF, e-mail, anexos)
// e encaminhamentos pendentes. Carregado antes de painel.js, que registra carregarAtas no mapa carregar.

let atasLista = [];
let atasPendentes = [];
let atasPessoas = [];
const tiposAta = {
  conselho: 'Conselho', diretoria: 'Diretoria', assembleia: 'Assembleia',
  ministerio: 'Ministério / equipe', outra: 'Outra reunião',
};
const tiposAtaFormais = new Set(['conselho', 'diretoria', 'assembleia']);
const statusAta = { rascunho: 'Rascunho', finalizada: 'Finalizada', aprovada: 'Aprovada' };
const dataAta = (v) => v ? new Date(`${v}T12:00:00`).toLocaleDateString('pt-BR') : '';

function tituloAta(a) {
  const tipo = tiposAta[a.tipo] || 'Reunião';
  if (Number.isInteger(a.numero)) return `Ata nº ${a.numero}/${a.ano} — ${tipo}${a.titulo ? `: ${a.titulo}` : ''}`;
  return a.titulo || `Reunião — ${tipo}`;
}

function situacaoAta(a) {
  if (a.status === 'finalizada' && tiposAtaFormais.has(a.tipo)) return 'Aguardando aprovação';
  return statusAta[a.status] || a.status;
}

function atualizarBadgeAtas() {
  const badge = $('badge-atas');
  if (!badge) return;
  const hoje = diaIso(new Date());
  const vencidos = atasPendentes.filter((e) => e.prazo && e.prazo < hoje).length;
  badge.textContent = vencidos;
  badge.hidden = vencidos === 0;
  badge.title = 'Encaminhamentos de atas com prazo vencido';
}

async function carregarAtas() {
  try {
    [atasLista, atasPendentes, atasPessoas] = await Promise.all([
      api('GET', '/api/atas'), api('GET', '/api/atas/encaminhamentos'), api('GET', '/api/atas/pessoas'),
    ]);
    atualizarBadgeAtas();
    preencherAnosAtas();
    renderAtas();
  } catch (e) { mensagem($('atas-resultado'), e.message, false); }
}


function preencherAnosAtas() {
  const sel = $('atas-ano');
  const atual = sel.value;
  const anos = [...new Set(atasLista.map((a) => a.data.slice(0, 4)))].sort().reverse();
  sel.replaceChildren(el('option', { value: '' }, 'Todos'), ...anos.map((a) => el('option', { value: a }, a)));
  if (anos.includes(atual)) sel.value = atual;
}

function renderAtas() {
  const texto = $('atas-busca').value.trim().toLocaleLowerCase('pt-BR');
  const tipo = $('atas-tipo').value;
  const status = $('atas-status').value;
  const ano = $('atas-ano').value;
  const lista = atasLista.filter((a) =>
    (!tipo || a.tipo === tipo) && (!status || a.status === status) && (!ano || a.data.startsWith(ano)) &&
    (!texto || [tituloAta(a), a.ministerio, a.local, ...(a.pauta || []).map((p) => p.titulo)]
      .some((v) => (v || '').toLocaleLowerCase('pt-BR').includes(texto))));
  $('atas-lista').replaceChildren(...(lista.length ? lista.map((a) =>
    el('div', { class: 'casa-linha ata-linha' },
      el('span', { class: 'casa-prazo' }, dataAta(a.data)),
      el('div', {}, el('span', { class: 'casa-titulo' }, tituloAta(a)),
        el('small', {}, [tiposAta[a.tipo], a.ministerio, a.local].filter(Boolean).join(' · '))),
      el('span', {}, el('span', { class: `ata-status ata-${a.status}` }, situacaoAta(a)),
        a.sigilosa ? el('span', { class: 'ata-sigilosa' }, 'Sigilosa') : null),
      el('div', { class: 'casa-acoes' }, botao('Abrir', () => abrirFichaAta(a.id))))
  ) : [el('p', { class: 'vazio' }, atasLista.length ? 'Nenhuma ata neste filtro.' : 'Nenhuma ata registrada ainda. Clique em "+ Nova ata".')]));

  const hoje = diaIso(new Date());
  $('atas-pendentes').replaceChildren(...(atasPendentes.length ? atasPendentes.map((e) =>
    el('div', { class: 'item' },
      el('div', { class: 'conteudo' },
        el('strong', {}, e.descricao),
        el('p', { class: 'dica' }, [
          e.responsavel || 'Sem responsável',
          e.prazo ? `${e.prazo < hoje ? 'venceu' : 'prazo'} ${dataAta(e.prazo)}` : 'sem prazo',
          e.ataTitulo,
        ].join(' · '))),
      botao('Ver ata', () => abrirFichaAta(e.ataId)),
      botao('Concluído', async () => {
        try { await api('PUT', `/api/atas/${e.ataId}/encaminhamentos/${e.id}`, { concluido: true }); await carregarAtas(); }
        catch (ex) { mensagem($('atas-resultado'), ex.message, false); }
      }, 'pequeno')))
    : [el('p', { class: 'dica' }, 'Nenhum encaminhamento pendente.')]));
}

for (const id of ['atas-busca', 'atas-tipo', 'atas-status', 'atas-ano']) $(id).addEventListener('input', renderAtas);
$('atas-nova').addEventListener('click', () => abrirEditorAta(null));

function janelaAta(titulo) {
  const dlg = el('dialog', { class: 'dialogo-largo casa-dialogo' });
  const corpo = el('div', { class: 'dialogo-coluna' }, el('h2', {}, titulo));
  dlg.append(corpo); document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove(), { once: true });
  dlg.showModal();
  return { dlg, corpo };
}

function campoAta(rotulo, valor = '', { tipo = 'text', opcoes, largo = false, obrigatorio = false, max } = {}) {
  let input;
  if (opcoes) {
    input = el('select', {});
    for (const [id, texto] of opcoes) input.append(el('option', { value: id }, texto));
  } else if (tipo === 'textarea') input = el('textarea', { rows: 4 });
  else input = el('input', { type: tipo });
  input.value = valor ?? '';
  input.required = obrigatorio;
  if (max) input.maxLength = max;
  return { label: el('label', { class: largo ? 'largo' : '' }, rotulo, input), input };
}

// ---------- Editor ----------

/** Lista de pessoas (presentes/ausentes): escolhe do cadastro ou digita um nome livre. */
function seletorPessoas(rotulo, iniciais, { comJustificativa = false } = {}) {
  const pessoas = (iniciais || []).map((p) => ({ ...p }));
  const lista = el('div', { class: 'ata-pessoas' });
  const idLista = `ata-pessoas-${Math.random().toString(36).slice(2)}`;
  const entrada = el('input', { type: 'text', list: idLista, placeholder: 'Nome (escolha da lista ou digite)' });
  const sugestoes = el('datalist', { id: idLista }, ...atasPessoas.map((p) => el('option', { value: p.nome })));
  const justificativa = comJustificativa ? el('input', { type: 'text', placeholder: 'Justificativa (opcional)', maxlength: 300 }) : null;
  function desenhar() {
    lista.replaceChildren(...pessoas.map((p, i) => el('span', { class: 'ata-chip' },
      p.justificativa ? `${p.nome} (${p.justificativa})` : p.nome,
      el('button', { type: 'button', class: 'link', 'aria-label': `Remover ${p.nome}`, onclick: () => { pessoas.splice(i, 1); desenhar(); } }, '×'))));
  }
  function adicionar() {
    const nome = entrada.value.trim();
    if (!nome) return;
    const doCadastro = atasPessoas.find((p) => p.nome.toLocaleLowerCase('pt-BR') === nome.toLocaleLowerCase('pt-BR'));
    if (pessoas.some((p) => p.nome.toLocaleLowerCase('pt-BR') === nome.toLocaleLowerCase('pt-BR'))) { entrada.value = ''; return; }
    const pessoa = { nome: doCadastro ? doCadastro.nome : nome };
    if (doCadastro) pessoa.membroId = doCadastro.id;
    if (justificativa && justificativa.value.trim()) pessoa.justificativa = justificativa.value.trim();
    pessoas.push(pessoa);
    entrada.value = ''; if (justificativa) justificativa.value = '';
    desenhar(); entrada.focus();
  }
  entrada.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); adicionar(); } });
  desenhar();
  const bloco = el('div', { class: 'largo' },
    el('strong', {}, rotulo),
    el('div', { class: 'ata-linha-entrada' }, entrada, justificativa, botao('Adicionar', adicionar)),
    sugestoes, lista);
  return { bloco, valor: () => pessoas };
}

function blocoPauta(itens) {
  const caixa = el('div', { class: 'largo ata-blocos' });
  function item(dados = {}) {
    const titulo = campoAta('Assunto', dados.titulo, { max: 200 });
    const discussao = campoAta('Discussão (o que foi dito)', dados.discussao, { tipo: 'textarea', max: 20000 });
    const deliberacao = campoAta('Deliberação (o que foi decidido)', dados.deliberacao, { tipo: 'textarea', max: 4000 });
    deliberacao.input.rows = 2;
    const div = el('fieldset', { class: 'ata-bloco' }, titulo.label, discussao.label, deliberacao.label,
      botao('Remover item', () => div.remove()));
    div._valor = () => ({ titulo: titulo.input.value.trim(), discussao: discussao.input.value.trim(), deliberacao: deliberacao.input.value.trim() });
    caixa.append(div);
  }
  (itens || []).forEach(item);
  const novo = botao('+ Item de pauta', () => item());
  return { bloco: el('div', { class: 'largo' }, el('h3', {}, 'Pauta'), caixa, novo),
    valor: () => [...caixa.children].map((c) => c._valor()).filter((p) => p.titulo || p.discussao || p.deliberacao) };
}

function blocoEncaminhamentos(itens) {
  const caixa = el('div', { class: 'largo ata-blocos' });
  function item(dados = {}) {
    const descricao = campoAta('O que fazer', dados.descricao, { max: 500, largo: true });
    const responsavel = campoAta('Responsável', dados.responsavel, { max: 120 });
    responsavel.input.setAttribute('list', 'ata-responsaveis');
    const prazo = campoAta('Prazo', dados.prazo, { tipo: 'date' });
    const div = el('fieldset', { class: 'ata-bloco ata-encaminhamento' }, descricao.label, responsavel.label, prazo.label,
      dados.concluido ? el('p', { class: 'dica' }, `Concluído em ${dataAta(dados.concluidoEm)}`) : null,
      botao('Remover', () => div.remove()));
    div._valor = () => ({ id: dados.id, descricao: descricao.input.value.trim(), responsavel: responsavel.input.value.trim(),
      prazo: prazo.input.value, concluido: !!dados.concluido });
    caixa.append(div);
  }
  (itens || []).forEach(item);
  return { bloco: el('div', { class: 'largo' }, el('h3', {}, 'Encaminhamentos'),
    el('datalist', { id: 'ata-responsaveis' }, ...atasPessoas.map((p) => el('option', { value: p.nome }))),
    caixa, botao('+ Encaminhamento', () => item())),
    valor: () => [...caixa.children].map((c) => c._valor()).filter((e) => e.descricao || e.responsavel || e.prazo) };
}

function abrirEditorAta(atual) {
  const { dlg, corpo } = janelaAta(atual ? `Editar: ${tituloAta(atual)}` : 'Nova ata');
  const form = el('form', { class: 'casa-form' });
  const numerada = atual && Number.isInteger(atual.numero);
  const tipo = campoAta('Tipo de reunião', atual?.tipo || 'conselho', { opcoes: Object.entries(tiposAta) });
  if (numerada) tipo.input.disabled = true;
  const ministerio = campoAta('Ministério / equipe', atual?.ministerio, { max: 100 });
  const titulo = campoAta('Título', atual?.titulo, { max: 160, largo: true });
  const data = campoAta('Data', atual?.data || diaIso(new Date()), { tipo: 'date', obrigatorio: true });
  const local = campoAta('Local', atual?.local, { max: 120 });
  const inicio = campoAta('Início', atual?.horaInicio, { tipo: 'time' });
  const fim = campoAta('Término', atual?.horaFim, { tipo: 'time' });
  const presidente = campoAta('Quem presidiu', atual?.presidente, { max: 120 });
  const secretario = campoAta('Secretário(a)', atual?.secretario, { max: 120 });
  for (const c of [presidente, secretario]) c.input.setAttribute('list', 'ata-responsaveis');
  const presentes = seletorPessoas('Presentes', atual?.presentes);
  const ausentes = seletorPessoas('Ausentes', atual?.ausentes, { comJustificativa: true });
  const pauta = blocoPauta(atual?.pauta?.length ? atual.pauta : [{}]);
  const encaminhamentos = blocoEncaminhamentos(atual?.encaminhamentos);
  const observacoes = campoAta('Observações', atual?.observacoes, { tipo: 'textarea', largo: true, max: 10000 });
  const sigilosa = el('input', { type: 'checkbox' });
  sigilosa.checked = !!atual?.sigilosa;
  const rotuloSigilo = el('label', { class: 'largo ata-check' }, sigilosa,
    ' Ata sigilosa (só pastor e administrador veem; ex.: disciplina, assuntos pessoais)');
  if (!pode('atasSigilosas')) rotuloSigilo.hidden = true;

  function ajustarTipo() {
    const formal = tiposAtaFormais.has(tipo.input.value);
    ministerio.label.hidden = tipo.input.value !== 'ministerio';
    titulo.input.required = !formal;
    titulo.label.firstChild.textContent = formal ? 'Título (opcional — a ata recebe número ao finalizar)' : 'Título';
  }
  tipo.input.addEventListener('change', ajustarTipo);
  ajustarTipo();

  const erro = el('p', { class: 'largo', role: 'alert' });
  form.append(tipo.label, ministerio.label, titulo.label, data.label, local.label, inicio.label, fim.label,
    presidente.label, secretario.label, el('h3', { class: 'largo' }, 'Presença'), presentes.bloco, ausentes.bloco,
    pauta.bloco, encaminhamentos.bloco, observacoes.label, rotuloSigilo, erro,
    el('div', { class: 'dialogo-acoes largo' }, botao('Cancelar', () => dlg.close(), 'secundario'),
      el('button', { type: 'submit', class: 'botao' }, 'Salvar')));
  corpo.append(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dados = {
      tipo: tipo.input.value, ministerio: ministerio.input.value.trim(), titulo: titulo.input.value.trim(),
      data: data.input.value, local: local.input.value.trim(), horaInicio: inicio.input.value, horaFim: fim.input.value,
      presidente: presidente.input.value.trim(), secretario: secretario.input.value.trim(),
      presentes: presentes.valor(), ausentes: ausentes.valor(), pauta: pauta.valor(),
      encaminhamentos: encaminhamentos.valor(), observacoes: observacoes.input.value.trim(),
    };
    if (pode('atasSigilosas')) dados.sigilosa = sigilosa.checked;
    try {
      const salva = await api(atual ? 'PUT' : 'POST', atual ? `/api/atas/${atual.id}` : '/api/atas', dados);
      dlg.close(); await carregarAtas(); abrirFichaAta(salva.id);
    } catch (ex) { erro.textContent = ex.message; }
  });
}

// ---------- Ficha ----------

async function abrirFichaAta(id) {
  let a;
  try { a = await api('GET', `/api/atas/${id}`); } catch (e) { mensagem($('atas-resultado'), e.message, false); return; }
  const { dlg, corpo } = janelaAta(tituloAta(a));
  const erro = el('p', { role: 'alert' });
  const reabrir = async () => { dlg.close(); await carregarAtas(); abrirFichaAta(id); };
  const acao = (texto, fn, classe) => botao(texto, async () => {
    try { await fn(); } catch (e) { erro.textContent = e.message; }
  }, classe);

  corpo.append(el('p', { class: 'dica' }, [
    situacaoAta(a), a.status === 'aprovada' ? `em ${dataAta(a.aprovadaEm)}` : '', a.sigilosa ? '· Sigilosa' : '',
  ].filter(Boolean).join(' ')));
  const dados = [
    ['Data', [dataAta(a.data), [a.horaInicio, a.horaFim].filter(Boolean).join(' às ')].filter(Boolean).join(', ')],
    ['Local', a.local], ['Ministério', a.ministerio], ['Presidência', a.presidente], ['Secretaria', a.secretario],
  ].filter(([, v]) => v);
  corpo.append(el('dl', { class: 'ata-dados' }, ...dados.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])));
  if (a.presentes?.length) corpo.append(el('p', {}, el('strong', {}, `Presentes (${a.presentes.length}): `), a.presentes.map((p) => p.nome).join(', ')));
  if (a.ausentes?.length) corpo.append(el('p', {}, el('strong', {}, `Ausentes (${a.ausentes.length}): `),
    a.ausentes.map((p) => p.justificativa ? `${p.nome} (${p.justificativa})` : p.nome).join(', ')));
  if (a.pauta?.length) {
    corpo.append(el('h3', {}, 'Pauta'));
    a.pauta.forEach((p, i) => corpo.append(el('div', { class: 'ata-item' },
      el('strong', {}, `${i + 1}. ${p.titulo}`),
      p.discussao ? el('p', { class: 'ata-texto' }, p.discussao) : null,
      p.deliberacao ? el('p', { class: 'ata-deliberacao' }, `Deliberação: ${p.deliberacao}`) : null)));
  }
  if (a.encaminhamentos?.length) {
    corpo.append(el('h3', {}, 'Encaminhamentos'));
    for (const e of a.encaminhamentos) {
      const marca = el('input', { type: 'checkbox' });
      marca.checked = !!e.concluido;
      marca.disabled = a.status === 'rascunho';
      marca.addEventListener('change', async () => {
        try { await api('PUT', `/api/atas/${a.id}/encaminhamentos/${e.id}`, { concluido: marca.checked }); await carregarAtas(); }
        catch (ex) { erro.textContent = ex.message; marca.checked = !marca.checked; }
      });
      corpo.append(el('label', { class: 'ata-check' }, marca,
        ` ${e.descricao}`, el('small', {}, ` — ${[e.responsavel, e.prazo ? `até ${dataAta(e.prazo)}` : ''].filter(Boolean).join(', ')}`)));
    }
  }
  if (a.observacoes) corpo.append(el('h3', {}, 'Observações'), el('p', { class: 'ata-texto' }, a.observacoes));
  if (a.retificacoes?.length) {
    corpo.append(el('h3', {}, 'Retificações'));
    for (const r of a.retificacoes) corpo.append(el('p', {}, el('strong', {}, `${new Date(r.em).toLocaleDateString('pt-BR')} (${r.por}): `), r.texto));
  }

  // Anexos
  const anexos = el('div', { class: 'lista' });
  const desenharAnexos = () => anexos.replaceChildren(...(a.anexos || []).map((nome) => el('div', { class: 'item' },
    botao(nome.endsWith('.pdf') ? 'Abrir PDF' : 'Abrir foto', async () => {
      const url = await urlAutenticada(`/api/atas/anexos/${nome}`);
      if (url) window.open(url, '_blank', 'noopener'); else erro.textContent = 'Anexo não encontrado.';
    }),
    a.status !== 'aprovada' ? acao('Remover', async () => {
      if (!confirm('Remover este anexo?')) return;
      await api('DELETE', `/api/atas/${a.id}/anexos/${nome}`);
      a.anexos = a.anexos.filter((n) => n !== nome); desenharAnexos();
    }) : null)));
  desenharAnexos();
  const arquivo = el('input', { type: 'file', accept: 'image/jpeg,image/png,application/pdf' });
  arquivo.addEventListener('change', async () => {
    const f = arquivo.files[0]; if (!f) return;
    if (f.size > 15 * 1024 * 1024) { erro.textContent = 'Arquivo maior que 15 MB.'; return; }
    try {
      const r = await api('POST', `/api/atas/${a.id}/anexos`, f, { bruto: true, tipo: f.type });
      a.anexos = [...(a.anexos || []), r.nome]; desenharAnexos();
    } catch (e) { erro.textContent = e.message; }
    arquivo.value = '';
  });
  corpo.append(el('h3', {}, 'Anexos'), anexos, el('label', {}, 'Anexar foto ou PDF (até 15 MB)', arquivo));

  corpo.append(el('h3', {}, 'Histórico'));
  for (const h of a.historico || []) corpo.append(el('p', { class: 'dica' },
    `${new Date(h.em).toLocaleString('pt-BR')} — ${h.acao} por ${h.por}${h.numero ? ` (nº ${h.numero})` : ''}`));

  const formal = tiposAtaFormais.has(a.tipo);
  corpo.append(erro, el('div', { class: 'dialogo-acoes ata-acoes' },
    a.status !== 'aprovada' ? botao('Editar', () => { dlg.close(); abrirEditorAta(a); }) : null,
    a.status === 'rascunho' ? acao(formal ? 'Finalizar e numerar' : 'Finalizar', async () => {
      if (!confirm(formal ? 'Finalizar a ata? Ela recebe o próximo número do livro de atas.' : 'Finalizar a ata?')) return;
      await api('POST', `/api/atas/${a.id}/finalizar`); await reabrir();
    }, 'pequeno') : null,
    a.status === 'finalizada' ? acao('Voltar para rascunho', async () => {
      await api('POST', `/api/atas/${a.id}/reabrir`); await reabrir();
    }) : null,
    a.status === 'finalizada' && formal ? botao('Registrar aprovação', () => abrirAprovacaoAta(a, dlg), 'pequeno') : null,
    a.status === 'aprovada' ? botao('Retificar', () => abrirRetificacaoAta(a, dlg)) : null,
    acao('Baixar PDF', async () => {
      await baixarArquivo(`/api/atas/${a.id}/pdf`, `ata-${a.data}.pdf`);
    }),
    a.status !== 'rascunho' ? botao('Enviar por e-mail', () => abrirEnvioAta(a)) : null,
    a.status === 'rascunho' && !Number.isInteger(a.numero) ? acao('Excluir rascunho', async () => {
      if (!confirm('Excluir este rascunho e seus anexos? Não dá para desfazer.')) return;
      await api('DELETE', `/api/atas/${a.id}`); dlg.close(); await carregarAtas();
    }) : null,
    botao('Fechar', () => dlg.close(), 'secundario')));
}

function abrirAprovacaoAta(a, fichaDlg) {
  const { dlg, corpo } = janelaAta('Registrar aprovação');
  const form = el('form', { class: 'casa-form' });
  const data = campoAta('Data da reunião que aprovou', diaIso(new Date()), { tipo: 'date', obrigatorio: true });
  const outras = atasLista.filter((x) => x.id !== a.id && x.tipo === a.tipo && x.data >= a.data);
  const naAta = campoAta('Aprovada na ata (opcional)', '', { opcoes: [['', '—'], ...outras.map((x) => [x.id, tituloAta(x)])] });
  const erro = el('p', { class: 'largo', role: 'alert' });
  form.append(el('p', { class: 'largo dica' }, 'Depois de aprovada, a ata não pode mais ser editada; correções entram como retificação.'),
    data.label, naAta.label, erro, el('div', { class: 'dialogo-acoes largo' },
      botao('Voltar', () => dlg.close(), 'secundario'), el('button', { type: 'submit', class: 'botao' }, 'Aprovar')));
  corpo.append(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', `/api/atas/${a.id}/aprovar`, { data: data.input.value, naAtaId: naAta.input.value });
      dlg.close(); fichaDlg.close(); await carregarAtas(); abrirFichaAta(a.id);
    } catch (ex) { erro.textContent = ex.message; }
  });
}

function abrirRetificacaoAta(a, fichaDlg) {
  const { dlg, corpo } = janelaAta('Retificar ata aprovada');
  const form = el('form', { class: 'casa-form' });
  const texto = campoAta('Retificação', '', { tipo: 'textarea', obrigatorio: true, largo: true, max: 4000 });
  texto.input.placeholder = 'Ex.: No item 2, onde se lê "R$ 5.000", leia-se "R$ 5.500".';
  const erro = el('p', { class: 'largo', role: 'alert' });
  form.append(el('p', { class: 'largo dica' }, 'O texto original fica como está; a retificação aparece no fim da ata e no PDF.'),
    texto.label, erro, el('div', { class: 'dialogo-acoes largo' },
      botao('Voltar', () => dlg.close(), 'secundario'), el('button', { type: 'submit', class: 'botao' }, 'Registrar')));
  corpo.append(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', `/api/atas/${a.id}/retificar`, { texto: texto.input.value.trim() });
      dlg.close(); fichaDlg.close(); await carregarAtas(); abrirFichaAta(a.id);
    } catch (ex) { erro.textContent = ex.message; }
  });
}

function abrirEnvioAta(a) {
  const { dlg, corpo } = janelaAta('Enviar ata por e-mail');
  const form = el('form', { class: 'casa-form' });
  const comEmail = (a.presentes || []).filter((p) => atasPessoas.find((x) => x.id === p.membroId)?.temEmail).length;
  const presentes = el('input', { type: 'checkbox' });
  presentes.checked = comEmail > 0;
  const outros = campoAta('Outros e-mails (separados por vírgula)', '', { largo: true });
  const recado = campoAta('Recado (opcional)', '', { tipo: 'textarea', largo: true, max: 2000 });
  recado.input.rows = 3;
  const sigilo = el('input', { type: 'checkbox' });
  const erro = el('p', { class: 'largo', role: 'alert' });
  form.append(
    el('label', { class: 'largo ata-check' }, presentes,
      ` Presentes com e-mail no cadastro (${comEmail} de ${(a.presentes || []).length})`),
    outros.label, recado.label,
    a.sigilosa ? el('label', { class: 'largo ata-check' }, sigilo, ' Esta ata é sigilosa. Confirmo que os destinatários podem recebê-la.') : null,
    el('p', { class: 'largo dica' }, 'A ata vai em PDF anexo, com os destinatários em cópia oculta.'),
    erro, el('div', { class: 'dialogo-acoes largo' },
      botao('Cancelar', () => dlg.close(), 'secundario'), el('button', { type: 'submit', class: 'botao' }, 'Enviar')));
  corpo.append(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    erro.textContent = 'Enviando…';
    try {
      const r = await api('POST', `/api/atas/${a.id}/email`, {
        incluirPresentes: presentes.checked,
        outros: outros.input.value.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean),
        mensagem: recado.input.value.trim(),
        confirmarSigilo: sigilo.checked,
      });
      dlg.close();
      mensagem($('atas-resultado'), `Ata enviada para ${r.destinatarios} ${r.destinatarios === 1 ? 'pessoa' : 'pessoas'}.`);
    } catch (ex) { erro.textContent = ex.message; }
  });
}
