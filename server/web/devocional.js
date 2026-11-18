'use strict';

// Página pública: sem token de sessão, contatos ou relação de assinantes.
// Sem ?id: o devocional em destaque, o filtro por trilha e a lista. Com ?id: o devocional (e a série).
(() => {
  const porId = (id) => document.getElementById(id);
  const criar = (tag, texto) => { const no = document.createElement(tag); no.textContent = texto || ''; return no; };
  const informar = (id, texto, erro = false) => { const no = porId(id); no.textContent = texto; no.className = erro ? 'erro' : 'sucesso'; };
  async function publico(caminho, corpo) {
    const resposta = await fetch(caminho, corpo === undefined ? { credentials: 'omit' } : {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
    });
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível concluir. Tente novamente mais tarde.');
    return dados;
  }
  const dataBr = (iso) => String(iso || '').split('-').reverse().join('/');
  const serieTexto = (d) => d.serie ? `Série ${d.serie}${d.serieParte ? ' · parte ' + d.serieParte : ''}` : '';
  const link = (href, texto, classe) => { const a = criar('a', texto); a.href = href; if (classe) a.className = classe; return a; };

  // Fragmento nunca é enviado ao servidor. Remover antes de qualquer requisição.
  const fragmento = new URLSearchParams(location.hash.slice(1));
  const acao = fragmento.has('confirmar') ? 'confirmar' : fragmento.has('cancelar') ? 'cancelar' : '';
  let segredo = acao ? fragmento.get(acao) : '';
  if (acao) history.replaceState(null, '', location.pathname + location.search);
  if (acao) {
    porId('token-painel').hidden = false;
    porId('leitura-painel').hidden = true;
    porId('token-titulo').textContent = acao === 'confirmar' ? 'Confirme sua assinatura' : 'Cancelar assinatura';
    porId('token-instrucao').textContent = acao === 'confirmar' ? 'Clique abaixo para confirmar que deseja receber os devocionais.' : 'Clique abaixo para deixar de receber os devocionais desta assinatura.';
    const botao = porId('token-acao');
    botao.textContent = acao === 'confirmar' ? 'Confirmar assinatura' : 'Confirmar cancelamento';
    let ocupado = false;
    botao.addEventListener('click', async () => {
      if (ocupado || !segredo) return;
      ocupado = true; botao.disabled = true;
      try {
        await publico('/api/public/devocionais/' + acao, { token: segredo });
        segredo = '';
        informar('token-resultado', acao === 'confirmar' ? 'Assinatura confirmada.' : 'Assinatura cancelada.');
        botao.hidden = true;
      } catch (e) { informar('token-resultado', e.message, true); botao.disabled = false; }
      finally { ocupado = false; }
    });
  } else {
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    if (id) carregar(id);
    // A lista espera as trilhas (os botões de filtro vêm delas).
    carregarTrilhas().then(() => { if (!id) carregarLista(params.get('trilha') || ''); });
  }

  async function carregar(id) {
    informar('devocional-resultado', 'Carregando devocional…');
    try {
      const d = await publico('/api/public/devocionais/' + encodeURIComponent(id));
      const artigo = criar('article'); artigo.className = 'devocional-leitura';
      const autoria = criar('p', [d.autorNome, dataBr(d.data), (d.trilhasNomes || []).join(', ')].filter(Boolean).join(' · ')); autoria.className = 'dica';
      artigo.append(criar('h1', d.titulo));
      if (d.serie) { const s = criar('p', serieTexto(d)); s.className = 'sobretitulo'; artigo.append(s); }
      artigo.append(autoria, criar('p', d.referencia));
      for (const [titulo, texto] of [['Reflexão', d.texto], ['Aplicação', d.aplicacao], ['Oração', d.oracao]]) {
        artigo.append(criar('h2', titulo));
        for (const parte of String(texto || '').split(/\n\s*\n/).filter(Boolean)) {
          const cabecalho = parte.match(/^#{1,3}\s+([^\n]+)$/);
          artigo.append(criar(cabecalho ? 'h3' : 'p', cabecalho ? cabecalho[1] : parte));
        }
      }
      // Outras partes da série (só as publicadas).
      if ((d.serieItens || []).length > 1) {
        const caixa = criar('nav'); caixa.className = 'dev-serie'; caixa.setAttribute?.('aria-label', 'Partes da série');
        caixa.append(criar('strong', 'Série ' + d.serie));
        const ol = criar('ol');
        for (const p of d.serieItens) {
          const li = criar('li');
          if (p.id === d.id) li.append(criar('strong', p.titulo)); else li.append(link('/devocional?id=' + encodeURIComponent(p.id), p.titulo));
          ol.append(li);
        }
        caixa.append(ol);
        artigo.append(caixa);
      }
      const compartilhar = link('https://wa.me/?text=' + encodeURIComponent(`${d.titulo}\n${location.origin}/devocional?id=${encodeURIComponent(d.id)}`),
        'Compartilhar no WhatsApp', 'botao secundario');
      compartilhar.target = '_blank'; compartilhar.rel = 'noopener';
      artigo.append(compartilhar);
      porId('devocional-conteudo').replaceChildren(link('/devocional', '← Todos os devocionais', 'dev-voltar'), artigo);
      informar('devocional-resultado', '');
    } catch (e) {
      porId('devocional-conteudo').replaceChildren(criar('h1', 'Devocional indisponível'), link('/devocional', 'Ver todos os devocionais'));
      informar('devocional-resultado', e.message, true);
    }
  }

  let trilhas = [];
  let filtro = '';
  async function carregarLista(trilha) {
    filtro = trilha;
    try {
      const r = await publico('/api/public/devocionais' + (trilha ? '?trilha=' + encodeURIComponent(trilha) : ''));
      const blocos = [criar('h1', 'Devocionais'), criar('p', 'Uma pausa para ler, refletir e orar.')];
      if (r.destaque && !trilha) {
        const d = r.destaque;
        const caixa = criar('section'); caixa.className = 'dev-destaque';
        const rotulo = criar('p', 'Devocional da semana' + ((d.trilhasNomes || []).length ? ' · ' + d.trilhasNomes.join(', ') : '')); rotulo.className = 'sobretitulo';
        const titulo = criar('h2', d.titulo);
        caixa.append(rotulo, titulo);
        if (d.serie) { const s = criar('p', serieTexto(d)); s.className = 'dica'; caixa.append(s); }
        caixa.append(criar('p', d.referencia), criar('p', d.resumo), link(d.url, 'Ler o devocional', 'botao'));
        blocos.push(caixa);
      }
      const chips = criar('div'); chips.className = 'dev-chips'; chips.setAttribute?.('role', 'group'); chips.setAttribute?.('aria-label', 'Filtrar por trilha');
      for (const [id, nome] of [['', 'Todos'], ...trilhas.map((t) => [t.id, t.nome])]) {
        const b = criar('button', nome); b.type = 'button';
        b.setAttribute?.('aria-pressed', String(id === trilha));
        b.addEventListener('click', () => {
          history.replaceState(null, '', location.pathname + (id ? '?trilha=' + encodeURIComponent(id) : ''));
          carregarLista(id);
        });
        chips.append(b);
      }
      blocos.push(chips);
      const lista = criar('div'); lista.className = 'dev-lista';
      for (const d of r.devocionais) {
        const a = link('/devocional?id=' + encodeURIComponent(d.id), '');
        a.append(criar('strong', d.titulo), criar('span', [dataBr(d.data), (d.trilhasNomes || []).join(', '), serieTexto(d), d.referencia].filter(Boolean).join(' · ')));
        lista.append(a);
      }
      if (!r.devocionais.length) lista.append(criar('p', trilha ? 'Ainda não há devocionais nesta trilha.' : 'Os primeiros devocionais chegam em breve.'));
      blocos.push(lista);
      porId('devocional-conteudo').replaceChildren(...blocos);
      informar('devocional-resultado', '');
    } catch (e) { informar('devocional-resultado', e.message, true); }
  }

  // Trilhas da assinatura (as ativas, configuradas na administração da igreja).
  async function carregarTrilhas() {
    try {
      trilhas = await publico('/api/public/devocionais/trilhas');
      const caixa = porId('assinatura-trilhas');
      caixa.replaceChildren(...trilhas.map((t) => {
        const rotulo = criar('label'); rotulo.className = 'marcar';
        const input = document.createElement('input'); input.type = 'checkbox'; input.value = t.id; input.id = 'trilha-' + t.id;
        rotulo.append(input, criar('span', t.nome + (t.descricao ? ' — ' + t.descricao : '')));
        return rotulo;
      }));
    } catch {
      // sem trilhas, a lista continua; a assinatura avisa ao enviar
    }
  }

  let solicitando = false;
  porId('assinatura-form').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (solicitando) return;
    const escolhidas = trilhas.map((t) => t.id).filter((id) => porId('trilha-' + id)?.checked);
    if (!escolhidas.length || !porId('autorizo').checked) { informar('assinatura-resultado', 'Escolha ao menos uma trilha e autorize o recebimento.', true); return; }
    solicitando = true; porId('assinatura-enviar').disabled = true;
    try {
      const r = await publico('/api/public/devocionais/assinar', { email: porId('email').value.trim(), temas: escolhidas, autorizo: true, website: porId('website').value });
      informar('assinatura-resultado', r.mensagem || 'Se a solicitação puder ser atendida, você receberá as orientações por e-mail. Confira também a caixa de spam.');
    } catch (e) { informar('assinatura-resultado', e.message, true); }
    finally { solicitando = false; porId('assinatura-enviar').disabled = false; }
  });
})();
