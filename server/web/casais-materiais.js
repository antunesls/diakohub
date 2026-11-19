'use strict';
// Carregado antes de painel.js: permissões e sessão só são lidas nas ações.

function textoMaterialCasais(material) {
  const texto = valor => typeof valor === 'string' ? valor.replace(/\r\n?/g, '\n').trim() : '';
  const linhas = [texto(material.titulo)];
  if (Number.isInteger(material.duracaoMinutos)) linhas.push(`Duração: ${material.duracaoMinutos} minutos`);
  for (const [campo, rotulo] of [
    ['objetivo', 'Objetivo'], ['referenciasBiblicas', 'Referências bíblicas'],
    ['preparacao', 'Preparação'], ['passos', 'Passos da atividade'], ['perguntas', 'Perguntas para conversa'],
  ]) {
    const valor = texto(material[campo]);
    if (valor) linhas.push(`${rotulo}:\n${valor}`);
  }
  return linhas.filter(Boolean).join('\n\n');
}

const publicosMaterialCasais = { casais: 'Casais', familia: 'Família', ambos: 'Casais e família' };

async function carregarCasaisMateriais() {
  const raiz = $('casais-materiais-conteudo');
  if (!raiz) return;
  raiz.replaceChildren(el('p', {}, 'Carregando materiais…'));
  try {
    const resposta = await api('GET', '/api/casais/materiais?arquivados=true');
    const materiais = Array.isArray(resposta) ? resposta : resposta.materiais || [];
    const status = el('p', { role: 'status', 'aria-live': 'polite' });
    const lista = el('div', { class: 'lista' });
    // Editor, prévia e roteiro abrem logo abaixo dos botões, perto de onde a pessoa clicou.
    const trabalho = el('section', { class: 'casais-trabalho', 'aria-label': 'Editor e prévia de materiais' });
    const busca = el('input', { type: 'search', 'aria-label': 'Buscar materiais', placeholder: 'Buscar por título ou conteúdo' });
    const publico = el('select', { 'aria-label': 'Filtrar público' },
      el('option', { value: '' }, 'Todos os públicos'), ...Object.entries(publicosMaterialCasais).map(([value, texto]) => el('option', { value }, texto)));
    const arquivados = el('input', { type: 'checkbox', id: 'casais-materiais-arquivados' });
    const filtros = el('div', { class: 'casais-filtros-materiais' }, busca, publico,
      el('label', { for: 'casais-materiais-arquivados', class: 'casais-marcar' }, arquivados, ' Mostrar arquivados'));
    const links = pode('devocionais')
      ? [el('a', { href: '/painel?aba=devocionais' }, 'Gerenciar devocionais')]
      : [el('a', { href: '/devocional?trilha=casais' }, 'Devocionais para casais'),
        el('a', { href: '/devocional?trilha=familia' }, 'Devocionais para família')];
    const acoes = el('div', { class: 'barra' });
    const gerir = pode('casaisGerenciar');
    if (gerir) acoes.append(botao('Novo material', () => editor(), 'pequeno'));
    if (gerir && pode('encontros')) acoes.append(botao('Associar ao encontro', associar));
    acoes.append(el('span', { class: 'espaco' }), ...links);
    raiz.replaceChildren(acoes, trabalho, filtros, status, lista);

    function previa(material) {
      const texto = textoMaterialCasais(material);
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
      const consulta = busca.value.trim().toLocaleLowerCase('pt-BR');
      const visiveis = materiais.filter(m => (arquivados.checked || !m.arquivado) &&
        (!publico.value || m.publico === publico.value || m.publico === 'ambos') &&
        textoMaterialCasais(m).toLocaleLowerCase('pt-BR').includes(consulta));
      lista.replaceChildren(...visiveis.map(m => {
        const botoes = el('div', { class: 'acoes' }, botao('Prévia', () => previa(m)));
        const card = el('article', { class: 'item' },
          el('div', { class: 'conteudo' },
            el('div', { class: 'titulo' }, typeof m.titulo === 'string' ? m.titulo : '', ' ',
              el('span', { class: 'etiqueta' }, publicosMaterialCasais[m.publico] || 'Público não informado'),
              ...(m.arquivado ? [' ', el('span', { class: 'etiqueta' }, 'Arquivado')] : [])),
            el('p', { class: 'sub' }, [m.duracaoMinutos ? `${m.duracaoMinutos} minutos` : '', m.versao ? `versão ${m.versao}` : ''].filter(Boolean).join(' · '))),
          botoes);
        if (gerir && !m.arquivado) {
          botoes.append(botao('Editar', () => editor(m)), botao('Arquivar', async () => {
            if (!confirm('Arquivar este material? Roteiros anteriores serão preservados.')) return;
            try {
              await api('PUT', '/api/casais/materiais/' + encodeURIComponent(m.id), { arquivado: true });
              await carregarCasaisMateriais();
            } catch (err) { mensagem(status, err.message, false); }
          }));
        }
        return card;
      }));
      if (!visiveis.length) lista.append(el('p', { class: 'vazio' }, materiais.length ? 'Nenhum material encontrado com estes filtros.' : 'Nenhum material cadastrado ainda.'));
    }
    busca.addEventListener('input', renderizar);
    publico.addEventListener('change', renderizar);
    arquivados.addEventListener('change', renderizar);
    renderizar();

    function editor(material = {}) {
      const campos = {};
      const erro = el('p', { role: 'alert' });
      const form = el('form', { class: 'grade-form' });
      for (const [nome, rotulo] of [
        ['titulo', 'Título'], ['publico', 'Público'], ['duracaoMinutos', 'Duração em minutos'],
        ['objetivo', 'Objetivo'], ['referenciasBiblicas', 'Referências bíblicas'],
        ['preparacao', 'Preparação'], ['passos', 'Passos da atividade'], ['perguntas', 'Perguntas para conversa'],
      ]) {
        const id = 'casais-material-' + nome;
        const props = { id, name: nome };
        let input;
        if (nome === 'publico') {
          input = el('select', props, ...Object.entries(publicosMaterialCasais).map(([value, texto]) => el('option', { value }, texto)));
          input.value = material[nome] || 'casais';
        } else if (nome === 'duracaoMinutos') {
          input = el('input', { ...props, type: 'number', min: 1, max: 480, step: 1, required: true });
          input.value = material[nome] ?? 30;
        } else {
          input = el(nome === 'titulo' ? 'input' : 'textarea', { ...props, required: nome === 'titulo', maxlength: 20000, rows: 3 });
          input.value = typeof material[nome] === 'string' ? material[nome] : '';
        }
        campos[nome] = input;
        form.append(el('label', { for: id, class: ['titulo', 'publico', 'duracaoMinutos'].includes(nome) ? null : 'largo' }, rotulo, input));
      }
      const salvar = el('button', { type: 'submit', class: 'botao' }, 'Salvar material');
      form.append(el('p', { class: 'dica largo' }, 'Até 20.000 caracteres no total. Não inclua aconselhamento ou dados pessoais.'),
        el('div', { class: 'largo' }, erro),
        el('div', { class: 'dialogo-acoes largo' }, botao('Cancelar edição', () => trabalho.replaceChildren(), 'secundario'), salvar));
      form.addEventListener('submit', async evento => {
        evento.preventDefault();
        if (salvar.disabled || !form.reportValidity()) return;
        const corpo = Object.fromEntries(Object.entries(campos).map(([nome, input]) => [nome, nome === 'duracaoMinutos' ? Number(input.value) : input.value]));
        if (Object.entries(corpo).filter(([nome]) => nome !== 'duracaoMinutos' && nome !== 'publico').reduce((n, [, v]) => n + v.length, 0) > 20000) {
          mensagem(erro, 'Material limitado a 20.000 caracteres de texto.', false); return;
        }
        salvar.disabled = true;
        try {
          await api(material.id ? 'PUT' : 'POST', '/api/casais/materiais' + (material.id ? '/' + encodeURIComponent(material.id) : ''), corpo);
          await carregarCasaisMateriais();
        } catch (err) { mensagem(erro, err.message, false); }
        finally { salvar.disabled = false; }
      });
      trabalho.replaceChildren(el('h3', {}, material.id ? 'Editar material' : 'Novo material'), form);
      campos.titulo.focus();
    }

    async function associar() {
      try {
        const resposta = await api('GET', '/api/encontros');
        // Encontro cancelado não recebe roteiro novo.
        const encontros = (Array.isArray(resposta) ? resposta : resposta.encontros || []).filter(e => e.estado !== 'cancelado');
        const ativos = materiais.filter(m => !m.arquivado);
        if (!encontros.length || !ativos.length) {
          mensagem(status, 'Cadastre um encontro e um material ativo antes de montar o roteiro.', false); return;
        }
        const encontro = el('select', { id: 'casais-roteiro-encontro', 'aria-label': 'Encontro do roteiro' },
          ...encontros.map(e => el('option', { value: e.id }, e.titulo || 'Encontro')));
        encontro.value = encontros[0].id;
        const seletor = el('select', { id: 'casais-roteiro-material', 'aria-label': 'Material para adicionar' },
          ...ativos.map(m => el('option', { value: m.id }, m.titulo || 'Material')));
        seletor.value = ativos[0].id;
        const ordem = el('ol', { class: 'casais-roteiro-ordem' }); const selecionados = [];
        const aviso = el('p', { role: 'status' });
        function ordenar() {
          ordem.replaceChildren(...selecionados.map((id, i) => {
            const subir = botao('Subir ' + (i + 1), () => { [selecionados[i - 1], selecionados[i]] = [selecionados[i], selecionados[i - 1]]; ordenar(); });
            subir.disabled = i === 0;
            const descer = botao('Descer ' + (i + 1), () => { [selecionados[i + 1], selecionados[i]] = [selecionados[i], selecionados[i + 1]]; ordenar(); });
            descer.disabled = i === selecionados.length - 1;
            return el('li', {}, el('span', { class: 'conteudo' }, ativos.find(m => m.id === id).titulo || ''),
              el('span', { class: 'acoes' }, subir, descer, botao('Remover ' + (i + 1), () => { selecionados.splice(i, 1); ordenar(); })));
          }));
          if (!selecionados.length) ordem.append(el('li', { class: 'dica' }, 'Nenhum material na lista: salvar assim remove o roteiro do encontro.'));
        }
        // Começa pelo roteiro que o encontro já tem, para salvar não apagar o que existia.
        function carregarRoteiro() {
          const atual = encontros.find(e => e.id === encontro.value);
          const ids = (Array.isArray(atual?.roteiro) ? atual.roteiro : []).map(r => r.materialId);
          const disponiveis = ids.filter(id => ativos.some(m => m.id === id));
          selecionados.splice(0, selecionados.length, ...disponiveis);
          if (disponiveis.length < ids.length) mensagem(aviso, 'Este roteiro tem material arquivado; ao salvar, ele sai da lista.', false);
          else aviso.replaceChildren();
          ordenar();
        }
        encontro.addEventListener('change', carregarRoteiro);
        const salvar = botao('Salvar roteiro', async () => {
          if (salvar.disabled || !confirm('Substituir o roteiro deste encontro pelas versões atuais dos materiais selecionados?')) return;
          salvar.disabled = true;
          try {
            await api('PUT', '/api/encontros/' + encodeURIComponent(encontro.value) + '/roteiro', { materiaisIds: [...selecionados] });
            mensagem(aviso, 'Roteiro salvo com cópia das versões utilizadas.');
            const salvo = encontros.find(e => e.id === encontro.value);
            if (salvo) salvo.roteiro = selecionados.map(materialId => ({ materialId }));
          } catch (err) { mensagem(aviso, err.message, false); }
          finally { salvar.disabled = false; }
        }, '');
        carregarRoteiro();
        trabalho.replaceChildren(el('h3', {}, 'Roteiro do encontro'),
          el('p', { class: 'dica' }, 'Monte a lista na ordem desejada (máximo 20). Salvar substitui o roteiro do encontro pelas versões atuais dos materiais.'),
          el('div', { class: 'grade-form' },
            el('label', { for: 'casais-roteiro-encontro' }, 'Encontro', encontro),
            el('label', { for: 'casais-roteiro-material' }, 'Material', seletor)),
          el('div', { class: 'barra' }, botao('Adicionar material', () => {
            if (selecionados.length >= 20 || selecionados.includes(seletor.value)) {
              mensagem(aviso, 'Selecione até 20 materiais distintos.', false); return;
            }
            selecionados.push(seletor.value); ordenar();
          })), ordem, aviso,
          el('div', { class: 'dialogo-acoes' }, botao('Fechar roteiro', () => trabalho.replaceChildren(), 'secundario'), salvar));
        encontro.focus();
      } catch (err) { mensagem(status, err.message, false); }
    }
  } catch (err) { raiz.replaceChildren(el('p', { role: 'alert' }, err.message)); }
}
