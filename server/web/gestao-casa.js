'use strict';

let dadosCasa = { tarefas: [], rotinas: [] };
let responsaveisCasa = [];
const nomesTipoCasa = { pendencia: 'Pendência', compra: 'Compra planejada', preventiva: 'Manutenção preventiva' };
const nomesEstadoCasa = { aberta: 'A fazer', emAndamento: 'Em andamento', concluida: 'Concluída', cancelada: 'Cancelada' };
const dataCasa = (valor) => valor ? new Date(`${valor}T12:00:00`).toLocaleDateString('pt-BR') : 'Sem data';

function atualizarBadgeCasa(dados) {
  const badge = $('badge-casa');
  if (!badge) return;
  const semana = diaIso(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 7));
  const proximas = dados.tarefas.filter((t) =>
    !['concluida', 'cancelada'].includes(t.estado) && t.prazo <= semana).length;
  badge.textContent = proximas;
  badge.hidden = proximas === 0;
  badge.title = 'Tarefas atrasadas ou com prazo nos próximos 7 dias';
}

function atualizarResumoCasa(dados) {
  atualizarBadgeCasa(dados);
  const hoje = diaIso(new Date());
  const semana = diaIso(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 7));
  const pendentes = dados.tarefas.filter((t) => !['concluida', 'cancelada'].includes(t.estado));
  const atrasadas = pendentes.filter((t) => t.prazo < hoje);
  const proximas = pendentes.filter((t) => t.prazo >= hoje && t.prazo <= semana);
  indicador('ind-casa', atrasadas.length, `${proximas.length} vencem nos próximos 7 dias`, atrasadas.length > 0);
  $('ck-casa').replaceChildren(...(atrasadas.length || proximas.length
    ? [...atrasadas, ...proximas].slice(0, 4).map((t) =>
        el('div', { class: 'linha-ck' }, el('div', { class: 'conteudo' },
          el('strong', { class: 'texto' }, t.titulo),
          el('span', { class: 'sub' }, `${t.prazo < hoje ? 'Atrasada' : 'Prazo'} · ${dataCasa(t.prazo)} · ${t.local || 'Local não informado'}`))))
    : [el('p', { class: 'vazio-ck' }, 'Nenhum prazo atrasado ou próximo.')]));
}

async function carregarCasa() {
  try {
    [dadosCasa, responsaveisCasa] = await Promise.all([
      api('GET', '/api/casa'), api('GET', '/api/casa/responsaveis'),
    ]);
    atualizarBadgeCasa(dadosCasa);
    if (abaAtual === 'gestaoCasa') atualizarResumoCasa(dadosCasa);
    renderCasa();
  } catch (e) { mensagem($('casa-resultado'), e.message, false); }
}

function renderCasa() {
  const hoje = diaIso(new Date());
  const semana = diaIso(new Date(Date.now() + 7 * 86400000));
  const ativas = dadosCasa.tarefas.filter((t) => !['concluida', 'cancelada'].includes(t.estado));
  const atrasadas = ativas.filter((t) => t.prazo < hoje).length;
  const proximas = ativas.filter((t) => t.prazo >= hoje && t.prazo <= semana).length;
  $('casa-resumo').replaceChildren(
    el('span', { class: atrasadas ? 'atrasado' : '' }, `${atrasadas} atrasadas`),
    el('span', {}, `${proximas} vencem nos próximos 7 dias`),
    el('span', {}, `${ativas.length} a fazer`));
  const texto = $('casa-busca').value.trim().toLocaleLowerCase('pt-BR');
  const tipo = $('casa-tipo').value;
  const estado = $('casa-estado').value;
  const lista = dadosCasa.tarefas.filter((t) =>
    (!tipo || t.tipo === tipo) &&
    (!estado || (estado === 'abertas' ? !['concluida', 'cancelada'].includes(t.estado) : t.estado === estado)) &&
    (!texto || [t.titulo, t.local, t.responsavel].some((v) => (v || '').toLocaleLowerCase('pt-BR').includes(texto))))
    .sort((a, b) => a.prazo.localeCompare(b.prazo) || a.titulo.localeCompare(b.titulo, 'pt-BR'));
  $('casa-lista').replaceChildren(...(lista.length ? lista.map((t) => {
    const vencida = !['concluida', 'cancelada'].includes(t.estado) && t.prazo < hoje;
    return el('div', { class: 'casa-linha' },
      el('span', { class: `casa-prazo ${vencida ? 'atrasado' : ''}` }, dataCasa(t.prazo)),
      el('div', {}, el('span', { class: 'casa-titulo' }, t.titulo),
        el('small', {}, `${nomesTipoCasa[t.tipo]}${t.quantidade ? ` — ${t.quantidade}` : ''}`)),
      el('div', {}, t.local || 'Local não informado', el('small', {}, t.responsavel || 'Sem responsável definido')),
      el('span', {}, nomesEstadoCasa[t.estado]),
      el('div', { class: 'casa-acoes' },
        botao('Ver ficha', () => abrirTarefaCasa(t), 'secundario pequeno'),
        !['concluida', 'cancelada'].includes(t.estado) ? botao('Concluir', () => abrirConclusaoCasa(t), 'pequeno') : null));
  }) : [el('p', { class: 'vazio' }, 'Nenhuma tarefa neste filtro. Crie uma tarefa ou ajuste os filtros.') ]));
  $('casa-rotinas').replaceChildren(...(dadosCasa.rotinas.length ? dadosCasa.rotinas.map((r) =>
    el('div', { class: 'item' },
      el('div', { class: 'conteudo' }, el('strong', {}, r.titulo),
        el('p', { class: 'dica' }, `${r.ativa ? 'Ativa' : 'Pausada'} · a cada ${r.intervalo} ${r.unidade}(s) · ${r.regraData === 'calendario' ? 'data do calendário' : 'data da execução'}`)),
      botao('Editar rotina', () => abrirFormularioCasa(r, true), 'secundario pequeno')))
    : [el('p', { class: 'dica' }, 'Nenhuma compra ou manutenção recorrente programada.')]));
}

for (const id of ['casa-busca', 'casa-tipo', 'casa-estado']) $(id).addEventListener('input', renderCasa);
$('casa-nova-tarefa').addEventListener('click', () => abrirFormularioCasa(null, false));
$('casa-nova-rotina').addEventListener('click', () => abrirFormularioCasa(null, true));

function janelaCasa(titulo) {
  const dlg = el('dialog', { class: 'dialogo-largo casa-dialogo' });
  const corpo = el('div', { class: 'dialogo-coluna' }, el('h2', {}, titulo));
  dlg.append(corpo); document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove(), {once: true});
  dlg.showModal();
  return { dlg, corpo };
}

function campoCasa(rotulo, chave, valor = '', {tipo = 'text', opcoes, obrigatorio = false, largo = false} = {}) {
  const input = opcoes ? document.createElement('select') : document.createElement(tipo === 'textarea' ? 'textarea' : 'input');
  if (opcoes) for (const [id, texto] of opcoes) input.append(el('option', { value: id }, texto));
  else if (tipo !== 'textarea') input.type = tipo;
  input.name = chave; input.value = valor ?? ''; input.required = obrigatorio;
  if (tipo === 'number') input.min = '0';
  if (tipo === 'textarea') input.maxLength = 2000;
  const label = el('label', { class: largo ? 'largo' : '' }, rotulo, input);
  return { label, input };
}

function abrirFormularioCasa(atual, rotina) {
  const { dlg, corpo } = janelaCasa(atual ? `Editar ${rotina ? 'rotina' : 'tarefa'}` : rotina ? 'Programar rotina' : 'Nova tarefa');
  const form = el('form', { class: 'casa-form' });
  const campos = {};
  const adicionar = (rotulo, chave, opcoes = {}) => {
    const { label, input } = campoCasa(rotulo, chave, atual?.[chave] ?? '', opcoes);
    campos[chave] = input; form.append(label);
  };
  adicionar('Tipo', 'tipo', {opcoes: rotina
    ? [['compra', 'Compra planejada'], ['preventiva', 'Manutenção preventiva']]
    : Object.entries(nomesTipoCasa)});
  if (atual) campos.tipo.value = atual.tipo;
  adicionar('O que precisa ser feito?', 'titulo', {obrigatorio: true, largo: true});
  adicionar('Local', 'local');
  adicionar('Prazo', 'prazo', {tipo: 'date', obrigatorio: true});
  adicionar('Prioridade', 'prioridade', {opcoes: [['normal','Normal'],['alta','Alta'],['baixa','Baixa']]});
  if (atual) campos.prioridade.value = atual.prioridade;
  adicionar('Responsável (usuário, voluntário ou prestador)', 'responsavel', {largo: true});
  const sugestoes = el('datalist', { id: 'casa-responsaveis' });
  sugestoes.replaceChildren(...responsaveisCasa.map((nome) => el('option', { value: nome })));
  campos.responsavel.setAttribute('list', 'casa-responsaveis');
  form.append(sugestoes);
  adicionar('Quantidade a comprar', 'quantidade');
  adicionar('Valor estimado (R$)', 'valorEstimado', {tipo: 'number'});
  campos.valorEstimado.step = '0.01';
  adicionar('Detalhes', 'detalhes', {tipo: 'textarea', largo: true});
  if (rotina) {
    adicionar('A cada', 'intervalo', {tipo: 'number', obrigatorio: true});
    if (!atual) campos.intervalo.value = '1';
    campos.intervalo.min = '1'; campos.intervalo.max = '120';
    adicionar('Período', 'unidade', {opcoes: [['mes','Mês'],['semana','Semana'],['dia','Dia'],['ano','Ano']]});
    adicionar('Próxima data a partir de', 'regraData', {opcoes: [['calendario','Data programada'],['execucao','Data da execução']]});
    if (atual) { campos.unidade.value = atual.unidade; campos.regraData.value = atual.regraData; }
    if (atual) adicionar('Rotina', 'ativa', {opcoes: [['true','Ativa'],['false','Pausada']]});
    if (atual) campos.ativa.value = String(atual.ativa);
  } else if (atual && atual.estado !== 'concluida') {
    adicionar('Situação', 'estado', {opcoes: [['aberta','A fazer'],['emAndamento','Em andamento'],['cancelada','Cancelada']]});
    campos.estado.value = atual.estado;
  }
  const erro = el('p', { class: 'largo', role: 'alert' }); form.append(erro);
  const acoes = el('div', { class: 'dialogo-acoes largo' });
  acoes.append(botao('Cancelar', () => dlg.close(), 'secundario'), el('button', { class: 'botao', type: 'submit' }, 'Salvar'));
  form.append(acoes); corpo.append(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const valores = Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, v.value.trim()]));
    if (valores.valorEstimado) valores.valorEstimado = Number(valores.valorEstimado);
    else delete valores.valorEstimado;
    if (rotina) { valores.intervalo = Number(valores.intervalo); if ('ativa' in valores) valores.ativa = valores.ativa === 'true'; }
    // Campos de edição controlados pelo servidor, nunca por valores de rotina no navegador.
    const endereco = rotina ? `/api/casa/rotinas${atual ? `/${atual.id}` : ''}` : `/api/casa/tarefas${atual ? `/${atual.id}` : ''}`;
    try {
      await api(atual ? 'PUT' : 'POST', endereco, valores);
      dlg.close(); await carregarCasa();
    } catch (ex) { erro.textContent = ex.message; }
  });
}

function abrirConclusaoCasa(tarefa) {
  const { dlg, corpo } = janelaCasa(`Concluir: ${tarefa.titulo}`);
  const form = el('form', { class: 'casa-form' });
  const campos = {};
  for (const [rotulo, chave, tipo, valor, obrigatorio] of [
    ['Data da execução', 'data', 'date', diaIso(new Date()), true],
    ['Quem executou?', 'executor', 'text', tarefa.responsavel, true],
    ['Valor gasto (R$)', 'valor', 'number', '', false],
    ['O que foi feito?', 'observacao', 'textarea', '', false],
  ]) {
    const {label, input} = campoCasa(rotulo, chave, valor, {tipo, obrigatorio, largo: chave === 'observacao'});
    if (chave === 'valor') input.step = '0.01';
    campos[chave] = input; form.append(label);
  }
  const erro = el('p', { role: 'alert', class: 'largo' });
  form.append(erro, el('div', { class: 'dialogo-acoes largo' },
    botao('Voltar', () => dlg.close(), 'secundario'),
    el('button', { type: 'submit', class: 'botao' }, 'Registrar conclusão')));
  corpo.append(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dados = Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, v.value.trim()]));
    if (dados.valor) dados.valor = Number(dados.valor); else delete dados.valor;
    try {
      await api('POST', `/api/casa/tarefas/${tarefa.id}/concluir`, dados);
      dlg.close(); await carregarCasa();
    } catch (ex) { erro.textContent = ex.message; }
  });
}

function abrirTarefaCasa(tarefa) {
  const { dlg, corpo } = janelaCasa(tarefa.titulo);
  corpo.append(el('p', { class: 'dica' }, `${nomesTipoCasa[tarefa.tipo]} · ${nomesEstadoCasa[tarefa.estado]} · ${dataCasa(tarefa.prazo)}`));
  if (tarefa.local) corpo.append(el('p', {}, `Local: ${tarefa.local}`));
  if (tarefa.detalhes) corpo.append(el('p', {}, tarefa.detalhes));
  if (tarefa.estado === 'concluida') corpo.append(el('p', {},
    `Concluída em ${dataCasa(tarefa.concluidaEm)} por ${tarefa.executor}${tarefa.valor != null ? ` · R$ ${Number(tarefa.valor).toFixed(2)}` : ''}`),
    el('p', {}, tarefa.observacao || 'Sem observação.'));
  const erro = el('p', { role: 'alert' });
  const anexos = el('div', { class: 'lista' });
  function mostrarAnexos() {
    anexos.replaceChildren(...((tarefa.anexos || []).map((nome) =>
      el('div', { class: 'item' },
        botao(nome.endsWith('.pdf') ? 'Abrir comprovante' : 'Abrir foto', async () => {
          try { const url = await urlAutenticada(`/api/casa/anexos/${nome}`); window.open(url, '_blank', 'noopener'); }
          catch (e) { erro.textContent = e.message; }
        }, 'secundario pequeno'),
        botao('Remover', async () => {
          if (!confirm('Remover este anexo?')) return;
          try { await api('DELETE', `/api/casa/tarefas/${tarefa.id}/anexos/${nome}`);
            tarefa.anexos = tarefa.anexos.filter((n) => n !== nome); mostrarAnexos(); await carregarCasa();
          } catch (e) { erro.textContent = e.message; }
        }, 'secundario pequeno')))));
  }
  mostrarAnexos(); corpo.append(el('h3', {}, 'Fotos e comprovantes'), anexos);
  const arquivo = el('input', { type: 'file', accept: 'image/jpeg,image/png,application/pdf' });
  corpo.append(el('label', {}, 'Adicionar foto ou PDF (até 15 MB)', arquivo));
  arquivo.addEventListener('change', async () => {
    const f = arquivo.files[0]; if (!f) return;
    if (f.size > 15 * 1024 * 1024) { erro.textContent = 'Arquivo maior que 15 MB.'; return; }
    try {
      const resposta = await api('POST', `/api/casa/tarefas/${tarefa.id}/anexos`, f, {bruto: true, tipo: f.type});
      tarefa.anexos = [...(tarefa.anexos || []), resposta.nome]; mostrarAnexos(); await carregarCasa();
    } catch (e) { erro.textContent = e.message; }
    arquivo.value = '';
  });
  corpo.append(el('h3', {}, 'Histórico'));
  for (const h of tarefa.historico || []) corpo.append(el('p', { class: 'dica' },
    `${new Date(h.em).toLocaleString('pt-BR')} — ${h.acao} por ${h.por}`));
  corpo.append(erro, el('div', { class: 'dialogo-acoes' },
    tarefa.estado !== 'concluida' ? botao('Editar tarefa', () => { dlg.close(); abrirFormularioCasa(tarefa, false); }) : null,
    botao('Fechar', () => dlg.close(), 'secundario')));
}
