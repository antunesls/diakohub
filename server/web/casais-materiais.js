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

async function carregarCasaisMateriais() {
  const raiz = $('casais-materiais-conteudo');
  if (!raiz) return;
  raiz.replaceChildren(el('p', {}, 'Carregando materiais…'));
  try {
    const resposta = await api('GET', '/api/casais/materiais?arquivados=true');
    const materiais = Array.isArray(resposta) ? resposta : resposta.materiais || [];
    const status = el('p', { role: 'status', 'aria-live': 'polite' });
    const lista = el('div', { class: 'lista-cards' });
    const trabalho = el('section', { 'aria-label': 'Editor e prévia de materiais', style: 'min-width:0;overflow-wrap:anywhere' });
    const busca = el('input', { type: 'search', 'aria-label': 'Buscar materiais', placeholder: 'Buscar materiais', style: 'max-width:100%;box-sizing:border-box' });
    const publico = el('select', { 'aria-label': 'Filtrar público' },
      el('option', { value: '' }, 'Todos os públicos'), el('option', { value: 'casais' }, 'Casais'),
      el('option', { value: 'familia' }, 'Família'), el('option', { value: 'ambos' }, 'Ambos'));
    const arquivados = el('input', { type: 'checkbox', id: 'casais-materiais-arquivados' });
    const filtros = el('div', { class: 'acoes', style: 'display:flex;flex-wrap:wrap;gap:8px' }, busca, publico,
      el('label', { for: 'casais-materiais-arquivados' }, arquivados, ' Mostrar arquivados'));
    const links = pode('devocionais')
      ? [el('a', { href: '/painel?aba=devocionais' }, 'Gerenciar devocionais')]
      : [el('a', { href: '/devocional?trilha=casais' }, 'Devocionais para casais'),
        el('a', { href: '/devocional?trilha=familia' }, 'Devocionais para família')];
    const acoes = el('div', { class: 'acoes', style: 'display:flex;flex-wrap:wrap;gap:8px' }, ...links);
    const gerir = pode('casaisGerenciar');
    if (gerir) {
      acoes.append(botao('Novo material', () => editor()), botao('Associar ao encontro', associar));
    }
    raiz.replaceChildren(el('h3', {}, 'Materiais e atividades'), acoes, filtros, status, lista, trabalho);

    function previa(material) {
      const texto = textoMaterialCasais(material);
      const area = el('textarea', { rows: 14, readonly: true, 'aria-label': 'Prévia do material', style: 'width:100%;max-width:100%;box-sizing:border-box' });
      area.value = texto;
      trabalho.replaceChildren(el('h4', {}, 'Prévia do material'), area,
        botao('Copiar material', async () => {
          try { await navigator.clipboard.writeText(texto); mensagem(status, 'Material copiado. Nenhum contato ou participante foi incluído.'); }
          catch (_) { area.focus(); area.select?.(); mensagem(status, 'Selecione o texto da prévia para copiar.', false); }
        }), botao('Fechar prévia', () => trabalho.replaceChildren()));
      area.focus();
    }

    function renderizar() {
      const consulta = busca.value.trim().toLocaleLowerCase('pt-BR');
      const visiveis = materiais.filter(m => (arquivados.checked || !m.arquivado) &&
        (!publico.value || m.publico === publico.value || m.publico === 'ambos') &&
        textoMaterialCasais(m).toLocaleLowerCase('pt-BR').includes(consulta));
      lista.replaceChildren(...visiveis.map(m => {
        const card = el('article', { class: 'card', style: 'min-width:0;overflow-wrap:anywhere' },
          el('h4', {}, typeof m.titulo === 'string' ? m.titulo : ''),
          el('p', {}, `${m.publico || ''} · ${m.duracaoMinutos || ''} minutos${m.arquivado ? ' · Arquivado' : ''}`),
          botao('Prévia', () => previa(m)));
        if (gerir && !m.arquivado) {
          card.append(botao('Editar', () => editor(m)), botao('Arquivar', async () => {
            if (!confirm('Arquivar este material? Roteiros anteriores serão preservados.')) return;
            try {
              await api('PUT', '/api/casais/materiais/' + encodeURIComponent(m.id), { arquivado: true });
              await carregarCasaisMateriais();
            } catch (err) { mensagem(status, err.message, false); }
          }));
        }
        return card;
      }));
      if (!visiveis.length) lista.append(el('p', {}, 'Nenhum material encontrado.'));
    }
    busca.addEventListener('input', renderizar);
    publico.addEventListener('change', renderizar);
    arquivados.addEventListener('change', renderizar);
    renderizar();

    function editor(material = {}) {
      const campos = {};
      const erro = el('p', { role: 'alert' });
      const form = el('form', { style: 'max-width:100%' });
      for (const [nome, rotulo] of [
        ['titulo', 'Título'], ['publico', 'Público'], ['duracaoMinutos', 'Duração em minutos'],
        ['objetivo', 'Objetivo'], ['referenciasBiblicas', 'Referências bíblicas'],
        ['preparacao', 'Preparação'], ['passos', 'Passos da atividade'], ['perguntas', 'Perguntas para conversa'],
      ]) {
        const id = 'casais-material-' + nome;
        const props = { id, name: nome, style: 'display:block;width:100%;max-width:100%;box-sizing:border-box' };
        let input;
        if (nome === 'publico') {
          input = el('select', props, ...[['casais', 'Casais'], ['familia', 'Família'], ['ambos', 'Ambos']].map(([value, texto]) => el('option', { value }, texto)));
          input.value = material[nome] || 'casais';
        } else if (nome === 'duracaoMinutos') {
          input = el('input', { ...props, type: 'number', min: 1, max: 480, step: 1, required: true });
          input.value = material[nome] ?? 30;
        } else {
          input = el(nome === 'titulo' ? 'input' : 'textarea', { ...props, required: nome === 'titulo', maxlength: 20000, rows: 3 });
          input.value = typeof material[nome] === 'string' ? material[nome] : '';
        }
        campos[nome] = input;
        form.append(el('label', { for: id }, rotulo), input);
      }
      const salvar = el('button', { type: 'submit', class: 'botao' }, 'Salvar material');
      form.append(el('p', {}, 'Até 20.000 caracteres no total. Não inclua aconselhamento ou dados pessoais.'), erro,
        salvar, botao('Cancelar edição', () => trabalho.replaceChildren()));
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
      trabalho.replaceChildren(el('h4', {}, material.id ? 'Editar material' : 'Novo material'), form);
      campos.titulo.focus();
    }

    async function associar() {
      try {
        const resposta = await api('GET', '/api/casais/encontros');
        const encontros = Array.isArray(resposta) ? resposta : resposta.encontros || [];
        const ativos = materiais.filter(m => !m.arquivado);
        if (!encontros.length || !ativos.length) {
          mensagem(status, 'Cadastre um encontro e um material ativo antes de montar o roteiro.', false); return;
        }
        const encontro = el('select', { id: 'casais-roteiro-encontro', 'aria-label': 'Encontro do roteiro', style: 'max-width:100%' },
          ...encontros.map(e => el('option', { value: e.id }, e.titulo || 'Encontro')));
        encontro.value = encontros[0].id;
        const seletor = el('select', { id: 'casais-roteiro-material', 'aria-label': 'Material para adicionar', style: 'max-width:100%' },
          ...ativos.map(m => el('option', { value: m.id }, m.titulo || 'Material')));
        seletor.value = ativos[0].id;
        const ordem = el('ol'); const selecionados = [];
        const aviso = el('p', { role: 'status' });
        function ordenar() {
          ordem.replaceChildren(...selecionados.map((id, i) => {
            const subir = botao('Subir ' + (i + 1), () => { [selecionados[i - 1], selecionados[i]] = [selecionados[i], selecionados[i - 1]]; ordenar(); });
            subir.disabled = i === 0;
            const descer = botao('Descer ' + (i + 1), () => { [selecionados[i + 1], selecionados[i]] = [selecionados[i], selecionados[i + 1]]; ordenar(); });
            descer.disabled = i === selecionados.length - 1;
            return el('li', {}, ativos.find(m => m.id === id).titulo || '', subir, descer,
              botao('Remover ' + (i + 1), () => { selecionados.splice(i, 1); ordenar(); }));
          }));
        }
        const salvar = botao('Salvar roteiro', async () => {
          if (salvar.disabled || !confirm('Substituir o roteiro deste encontro pelas versões atuais dos materiais selecionados?')) return;
          salvar.disabled = true;
          try {
            await api('PUT', '/api/casais/encontros/' + encodeURIComponent(encontro.value) + '/roteiro', { materiaisIds: [...selecionados] });
            mensagem(aviso, 'Roteiro salvo com cópia das versões utilizadas.');
          } catch (err) { mensagem(aviso, err.message, false); }
          finally { salvar.disabled = false; }
        });
        trabalho.replaceChildren(el('h4', {}, 'Roteiro do encontro'),
          el('p', {}, 'Monte a lista na ordem desejada (máximo 20). Salvar substitui o roteiro; uma lista vazia remove os materiais.'),
          el('label', { for: 'casais-roteiro-encontro' }, 'Encontro'), encontro,
          el('label', { for: 'casais-roteiro-material' }, 'Material'), seletor,
          botao('Adicionar material', () => {
            if (selecionados.length >= 20 || selecionados.includes(seletor.value)) {
              mensagem(aviso, 'Selecione até 20 materiais distintos.', false); return;
            }
            selecionados.push(seletor.value); ordenar();
          }), ordem, aviso, salvar, botao('Fechar roteiro', () => trabalho.replaceChildren()));
        encontro.focus();
      } catch (err) { mensagem(status, err.message, false); }
    }
  } catch (err) { raiz.replaceChildren(el('p', { role: 'alert' }, err.message)); }
}
