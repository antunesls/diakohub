'use strict';

// Materiais e roteiros dos encontros, de qualquer ministério (aba "Materiais e roteiros" de
// Encontros). Usa os auxiliares de encontros.js (carregado antes). Inerte na carga: permissões e
// sessão só são lidas nas ações.

const publicosMaterial = {
  todos: 'Todos', criancas: 'Crianças', adolescentes: 'Adolescentes', jovens: 'Jovens', adultos: 'Adultos',
  casais: 'Casais', familias: 'Famílias', mulheres: 'Mulheres', homens: 'Homens', lideranca: 'Liderança',
};
let tiposMaterial = [];

/** Texto do material para prévia e cópia: só o conteúdo, sem autoria, contatos ou participantes. */
function textoMaterial(material) {
  const texto = valor => typeof valor === 'string' ? valor.replace(/\r\n?/g, '\n').trim() : '';
  const linhas = [texto(material.titulo)];
  const resumo = [texto(material.tipoNome), Number.isInteger(material.duracaoMinutos) ? `Duração: ${material.duracaoMinutos} minutos` : '']
    .filter(Boolean).join(' · ');
  if (resumo) linhas.push(resumo);
  for (const [campo, rotulo] of [
    ['objetivo', 'Objetivo'], ['referenciasBiblicas', 'Referências bíblicas'],
    ['preparacao', 'Preparação'], ['passos', 'Passos da atividade'], ['perguntas', 'Perguntas para conversa'],
  ]) {
    const valor = texto(material[campo]);
    if (valor) linhas.push(`${rotulo}:\n${valor}`);
  }
  return linhas.filter(Boolean).join('\n\n');
}

async function carregarTiposMaterial() {
  tiposMaterial = listaEncontros(await api('GET', '/api/materiais/tipos'), 'tipos');
  return tiposMaterial;
}

const nomeMinisterioMaterial = id => id ? (ministeriosEncontros.find(m => m.id === id)?.nome || 'Ministério removido') : 'Geral';

/** Etiquetas do cartão: ministério, tipo, público e arquivado. */
function etiquetasMaterial(m) {
  return [
    el('span', { class: 'etiqueta nova' }, nomeMinisterioMaterial(m.ministerioId)),
    m.tipoNome ? el('span', { class: 'etiqueta' }, m.tipoNome) : null,
    el('span', { class: 'etiqueta' }, publicosMaterial[m.publico] || 'Público não informado'),
    m.arquivado ? el('span', { class: 'etiqueta alerta' }, 'Arquivado') : null,
  ].filter(Boolean).flatMap(e => [' ', e]);
}

/** Filtros da biblioteca e do "Montar roteiro". [ministerio]: "" todos, "geral" ou o id. */
function filtrarMateriais(lista, { busca = '', ministerio = '', tipo = '', publico = '', arquivados = false } = {}) {
  const consulta = busca.trim().toLocaleLowerCase('pt-BR');
  return lista.filter(m => (arquivados || !m.arquivado) &&
    (!ministerio || (ministerio === 'geral' ? !m.ministerioId : m.ministerioId === ministerio)) &&
    (!tipo || m.tipoId === tipo) &&
    (!publico || m.publico === publico || m.publico === 'todos') &&
    (!consulta || textoMaterial(m).toLocaleLowerCase('pt-BR').includes(consulta)));
}

function seletorFiltro(rotulo, opcoes) {
  return el('select', { 'aria-label': rotulo }, ...Object.entries(opcoes).map(([value, texto]) => el('option', { value }, texto)));
}

async function carregarMateriais() {
  const raiz = $('encontros-materiais');
  if (!raiz) return;
  raiz.replaceChildren(el('p', { class: 'dica' }, 'Carregando materiais…'));
  try {
    const [resposta] = await Promise.all([api('GET', '/api/materiais?arquivados=true'), carregarTiposMaterial()]);
    const materiais = listaEncontros(resposta, 'materiais');
    const gerir = pode('encontros');
    const status = el('p', { role: 'status', 'aria-live': 'polite' });
    const lista = el('div', { class: 'lista' });
    // Editor e prévia abrem logo abaixo dos botões, perto de onde a pessoa clicou.
    const trabalho = el('section', { class: 'casais-trabalho', 'aria-label': 'Editor e prévia de materiais' });
    const busca = el('input', { type: 'search', 'aria-label': 'Buscar materiais', placeholder: 'Buscar por título ou conteúdo' });
    const ministerio = seletorFiltro('Filtrar ministério', { '': 'Todos os ministérios', geral: 'Gerais', ...Object.fromEntries(ministeriosEncontros.map(m => [m.id, m.nome])) });
    const tipo = seletorFiltro('Filtrar tipo', { '': 'Todos os tipos', ...Object.fromEntries(tiposMaterial.map(t => [t.id, t.nome])) });
    const publico = seletorFiltro('Filtrar público', { '': 'Qualquer público', ...publicosMaterial });
    const arquivados = el('input', { type: 'checkbox', id: 'materiais-arquivados' });
    const filtros = el('div', { class: 'casais-filtros-materiais' }, busca, ministerio, tipo, publico,
      el('label', { for: 'materiais-arquivados', class: 'casais-marcar' }, arquivados, ' Mostrar arquivados'));
    const acoes = el('div', { class: 'barra' });
    if (gerir) acoes.append(botao('Novo material', () => editor(), 'pequeno'), botao('Tipos de material', () => gerenciarTiposMaterial(carregarMateriais)));
    raiz.replaceChildren(el('p', { class: 'dica' }, 'Modelos reaproveitáveis de dinâmicas, estudos e atividades. Monte o roteiro de cada encontro pelo botão "Montar roteiro" no próprio encontro; o roteiro guarda uma cópia da versão usada.'),
      acoes, trabalho, filtros, status, lista);

    function previa(material) {
      const texto = textoMaterial(material);
      const area = el('textarea', { rows: 14, readonly: true, 'aria-label': 'Prévia do material' });
      area.value = texto;
      trabalho.replaceChildren(el('h3', {}, 'Prévia: ' + (typeof material.titulo === 'string' ? material.titulo : 'material')), area,
        el('div', { class: 'dialogo-acoes' }, botao('Fechar prévia', () => trabalho.replaceChildren(), 'secundario'),
          botao('Copiar material', async () => {
            try { await navigator.clipboard.writeText(texto); mensagem(status, 'Material copiado. Nenhum contato ou participante foi incluído.'); }
            catch (_) { area.focus(); area.select?.(); mensagem(status, 'Selecione o texto da prévia para copiar.', false); }
          }, '')));
      area.focus();
    }

    function renderizar() {
      const visiveis = filtrarMateriais(materiais, { busca: busca.value, ministerio: ministerio.value, tipo: tipo.value, publico: publico.value, arquivados: arquivados.checked });
      lista.replaceChildren(...visiveis.map(m => {
        const botoes = el('div', { class: 'acoes' }, botao('Prévia', () => previa(m)));
        if (gerir && !m.arquivado) {
          botoes.append(botao('Editar', () => editor(m)), botao('Arquivar', async () => {
            if (!confirm('Arquivar este material? Roteiros anteriores serão preservados.')) return;
            try {
              await api('PUT', '/api/materiais/' + encodeURIComponent(m.id), { arquivado: true });
              await carregarMateriais();
            } catch (err) { mensagem(status, err.message, false); }
          }));
        }
        return el('article', { class: 'item' },
          el('div', { class: 'conteudo' },
            el('div', { class: 'titulo' }, typeof m.titulo === 'string' ? m.titulo : '', ...etiquetasMaterial(m)),
            el('p', { class: 'sub' }, [m.duracaoMinutos ? `${m.duracaoMinutos} minutos` : '', m.versao ? `versão ${m.versao}` : '',
              typeof m.objetivo === 'string' ? m.objetivo.split('\n')[0].slice(0, 120) : ''].filter(Boolean).join(' · '))),
          botoes);
      }));
      if (!visiveis.length) lista.append(el('p', { class: 'vazio' }, materiais.length ? 'Nenhum material encontrado com estes filtros.' : 'Nenhum material cadastrado ainda.'));
    }
    busca.addEventListener('input', renderizar);
    for (const filtro of [ministerio, tipo, publico, arquivados]) filtro.addEventListener('change', renderizar);
    renderizar();

    function editor(material = {}) {
      const campos = {};
      const erro = el('p', { role: 'alert' });
      const form = el('form', { class: 'grade-form' });
      for (const [nome, rotulo] of [
        ['titulo', 'Título'], ['ministerioId', 'Ministério'], ['tipoId', 'Tipo'], ['publico', 'Público'],
        ['duracaoMinutos', 'Duração em minutos'], ['objetivo', 'Objetivo'], ['referenciasBiblicas', 'Referências bíblicas'],
        ['preparacao', 'Preparação'], ['passos', 'Passos da atividade'], ['perguntas', 'Perguntas para conversa'],
      ]) {
        const id = 'material-' + nome;
        const props = { id, name: nome };
        let input;
        if (['ministerioId', 'tipoId', 'publico'].includes(nome)) {
          const opcoes = nome === 'ministerioId' ? { '': 'Geral (qualquer ministério)', ...Object.fromEntries(ministeriosEncontros.map(m => [m.id, m.nome])) }
            : nome === 'tipoId' ? { '': 'Sem tipo', ...Object.fromEntries(tiposMaterial.map(t => [t.id, t.nome])) }
              : publicosMaterial;
          input = el('select', props, ...Object.entries(opcoes).map(([value, texto]) => el('option', { value }, texto)));
          input.value = material[nome] || (nome === 'publico' ? 'todos' : '');
        } else if (nome === 'duracaoMinutos') {
          input = el('input', { ...props, type: 'number', min: 1, max: 480, step: 1, required: true });
          input.value = material[nome] ?? 30;
        } else {
          input = el(nome === 'titulo' ? 'input' : 'textarea', { ...props, required: nome === 'titulo', maxlength: 20000, rows: 3 });
          input.value = typeof material[nome] === 'string' ? material[nome] : '';
        }
        campos[nome] = input;
        form.append(el('label', { for: id, class: ['titulo', 'objetivo', 'referenciasBiblicas', 'preparacao', 'passos', 'perguntas'].includes(nome) ? 'largo' : null }, rotulo, input));
      }
      const salvar = el('button', { type: 'submit', class: 'botao' }, 'Salvar material');
      form.append(el('p', { class: 'dica largo' }, 'Até 20.000 caracteres no total. Não inclua aconselhamento ou dados pessoais.'),
        el('div', { class: 'largo' }, erro),
        el('div', { class: 'dialogo-acoes largo' }, botao('Cancelar edição', () => trabalho.replaceChildren(), 'secundario'), salvar));
      form.addEventListener('submit', async evento => {
        evento.preventDefault();
        if (salvar.disabled || !form.reportValidity()) return;
        const corpo = Object.fromEntries(Object.entries(campos).map(([nome, input]) =>
          [nome, nome === 'duracaoMinutos' ? Number(input.value) : ['ministerioId', 'tipoId'].includes(nome) ? input.value || null : input.value]));
        const total = ['titulo', 'objetivo', 'referenciasBiblicas', 'preparacao', 'passos', 'perguntas'].reduce((n, c) => n + corpo[c].length, 0);
        if (total > 20000) { mensagem(erro, 'Material limitado a 20.000 caracteres de texto.', false); return; }
        salvar.disabled = true;
        try {
          await api(material.id ? 'PUT' : 'POST', '/api/materiais' + (material.id ? '/' + encodeURIComponent(material.id) : ''), corpo);
          await carregarMateriais();
        } catch (err) { mensagem(erro, err.message, false); }
        finally { salvar.disabled = false; }
      });
      trabalho.replaceChildren(el('h3', {}, material.id ? 'Editar material' : 'Novo material'), form);
      campos.titulo.focus();
    }
  } catch (err) { raiz.replaceChildren(el('p', { role: 'alert', class: 'erro' }, err.message)); }
}

/** Diálogo de tipos de material: criar, renomear e excluir (só sem materiais). */
async function gerenciarTiposMaterial(aoMudar) {
  const janela = janelaEncontro('Tipos de material');
  const lista = el('div', { class: 'lista' });
  const novo = el('input', { maxlength: 60, 'aria-label': 'Nome do novo tipo', placeholder: 'Ex.: Teatro, Gincana, Testemunho' });
  let mudou = false;
  janela.dlg.addEventListener('close', () => { if (mudou && aoMudar) aoMudar(); });
  const executar = async (acao) => {
    try { await acao(); mudou = true; janela.erro.replaceChildren(); await desenhar(); }
    catch (e) { mensagem(janela.erro, e.message, false); }
  };
  async function desenhar() {
    await carregarTiposMaterial();
    lista.replaceChildren(...tiposMaterial.map(t => {
      const nome = el('input', { maxlength: 60, 'aria-label': 'Nome do tipo ' + t.nome });
      nome.value = t.nome;
      return el('div', { class: 'item encontro-linha' },
        el('div', { class: 'conteudo' }, nome,
          el('p', { class: 'sub' }, t.materiais ? `${t.materiais} ${t.materiais === 1 ? 'material' : 'materiais'}` : 'Sem materiais')),
        el('div', { class: 'acoes' },
          botao('Renomear', () => executar(() => api('PUT', '/api/materiais/tipos/' + encodeURIComponent(t.id), { nome: nome.value }))),
          t.materiais ? null : botao('Excluir', () => {
            if (!confirm(`Excluir o tipo "${t.nome}"?`)) return;
            executar(() => api('DELETE', '/api/materiais/tipos/' + encodeURIComponent(t.id)));
          }, 'perigo pequeno')));
    }));
  }
  janela.conteudo.append(el('p', { class: 'dica' }, 'Os tipos organizam a biblioteca. Um tipo usado por algum material não pode ser excluído: renomeie ou mude o tipo dos materiais.'),
    el('div', { class: 'campo-com-botao' }, novo, botao('Adicionar tipo', () => executar(async () => {
      await api('POST', '/api/materiais/tipos', { nome: novo.value });
      novo.value = '';
    }), 'pequeno')),
    el('h3', {}, 'Tipos cadastrados'), lista);
  try { await desenhar(); } catch (e) { mensagem(janela.erro, e.message, false); }
}

/** "Montar roteiro" no detalhe do encontro: escolhe e ordena materiais da biblioteca. */
async function montarRoteiroEncontro(encontro, atualizar = carregarEncontros) {
  const selecionados = [];
  let materiais = [];
  const { conteudo, erro } = janelaEncontro('Montar roteiro', async () => {
    await api('PUT', caminhoEncontro(encontro.id) + '/roteiro', { materiaisIds: [...selecionados] });
    await atualizar();
  }, { textoSalvar: 'Salvar roteiro' });
  const busca = el('input', { type: 'search', 'aria-label': 'Buscar materiais para o roteiro', placeholder: 'Buscar por título ou conteúdo' });
  const tipo = el('select', { 'aria-label': 'Tipo para o roteiro' });
  const publico = seletorFiltro('Público para o roteiro', { '': 'Qualquer público', ...publicosMaterial });
  const outros = el('input', { type: 'checkbox', id: 'roteiro-outros-ministerios' });
  const disponiveis = el('div', { class: 'lista' });
  const ordem = el('ol', { class: 'casais-roteiro-ordem' });
  const titulo = id => materiais.find(m => m.id === id)?.titulo || 'Material';

  function desenharOrdem() {
    ordem.replaceChildren(...selecionados.map((id, i) => {
      const subir = botao('Subir', () => { [selecionados[i - 1], selecionados[i]] = [selecionados[i], selecionados[i - 1]]; desenhar(); });
      subir.disabled = i === 0;
      const descer = botao('Descer', () => { [selecionados[i + 1], selecionados[i]] = [selecionados[i], selecionados[i + 1]]; desenhar(); });
      descer.disabled = i === selecionados.length - 1;
      return el('li', {}, el('span', { class: 'conteudo' }, titulo(id)),
        el('span', { class: 'acoes' }, subir, descer, botao('Remover', () => { selecionados.splice(i, 1); desenhar(); })));
    }));
    if (!selecionados.length) ordem.append(el('li', { class: 'dica' }, 'Nenhum material no roteiro: salvar assim deixa o encontro sem roteiro.'));
  }
  function desenharDisponiveis() {
    // Por padrão: os gerais e os do ministério do encontro.
    const doMinisterio = m => outros.checked || !encontro.ministerioId || !m.ministerioId || m.ministerioId === encontro.ministerioId;
    const lista = filtrarMateriais(materiais, { busca: busca.value, tipo: tipo.value, publico: publico.value })
      .filter(m => doMinisterio(m) && !selecionados.includes(m.id));
    disponiveis.replaceChildren(...(lista.length ? lista.map(m => el('div', { class: 'item encontro-linha' },
      el('div', { class: 'conteudo' }, el('strong', {}, m.titulo), ...etiquetasMaterial(m),
        el('p', { class: 'sub' }, [m.duracaoMinutos ? `${m.duracaoMinutos} minutos` : '', typeof m.objetivo === 'string' ? m.objetivo.split('\n')[0].slice(0, 120) : ''].filter(Boolean).join(' · '))),
      el('div', { class: 'acoes' }, botao('Adicionar', () => {
        if (selecionados.length >= 20) { mensagem(erro, 'O roteiro aceita até 20 materiais.', false); return; }
        selecionados.push(m.id); desenhar();
      }))))
      : [el('p', { class: 'dica' }, materiais.length ? 'Nenhum material disponível com estes filtros.' : 'A biblioteca está vazia: cadastre materiais na aba "Materiais e roteiros".')]));
  }
  function desenhar() { desenharOrdem(); desenharDisponiveis(); }

  conteudo.append(el('p', { class: 'dica' }, `${encontro.titulo || 'Encontro'} · ${nomeMinisterioEncontro(encontro.ministerioId)}. Salvar guarda uma cópia da versão atual de cada material; editar a biblioteca depois não muda este roteiro.`),
    el('h3', {}, 'Roteiro (na ordem)'), ordem,
    el('h3', {}, 'Adicionar da biblioteca'),
    el('div', { class: 'casais-filtros-materiais' }, busca, tipo, publico,
      encontro.ministerioId ? el('label', { for: 'roteiro-outros-ministerios', class: 'casais-marcar' }, outros, ' Outros ministérios') : null),
    disponiveis);
  busca.addEventListener('input', desenharDisponiveis);
  for (const filtro of [tipo, publico, outros]) filtro.addEventListener('change', desenharDisponiveis);
  try {
    const [resposta] = await Promise.all([api('GET', '/api/materiais'), carregarTiposMaterial()]);
    materiais = listaEncontros(resposta, 'materiais');
    tipo.replaceChildren(...Object.entries({ '': 'Todos os tipos', ...Object.fromEntries(tiposMaterial.map(t => [t.id, t.nome])) })
      .map(([value, texto]) => el('option', { value }, texto)));
    const atuais = (Array.isArray(encontro.roteiro) ? encontro.roteiro : []).map(r => r.materialId);
    selecionados.push(...atuais.filter(id => materiais.some(m => m.id === id)));
    if (selecionados.length < atuais.length) mensagem(erro, 'O roteiro atual tem material arquivado; ao salvar, ele sai do roteiro.', false);
    desenhar();
  } catch (e) { mensagem(erro, e.message, false); }
}
