'use strict';

// Página pública: sem token de sessão, contatos ou relação de assinantes.
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
    const id = new URLSearchParams(location.search).get('id');
    if (id) carregar(id);
  }
  async function carregar(id) {
    informar('devocional-resultado', 'Carregando devocional…');
    try {
      const d = await publico('/api/public/devocionais/' + encodeURIComponent(id));
      const artigo = criar('article'); artigo.className = 'devocional-leitura';
      const autoria = criar('p', [d.autorNome, d.data, d.tema === 'familia' ? 'Família' : 'Casais'].filter(Boolean).join(' · ')); autoria.className = 'dica';
      artigo.append(criar('h1', d.titulo), autoria, criar('p', d.referencia));
      for (const [titulo, texto] of [['Reflexão', d.texto], ['Aplicação', d.aplicacao], ['Oração', d.oracao]]) {
        artigo.append(criar('h2', titulo));
        for (const parte of String(texto || '').split(/\n\s*\n/).filter(Boolean)) {
          const cabecalho = parte.match(/^#{1,3}\s+([^\n]+)$/);
          artigo.append(criar(cabecalho ? 'h3' : 'p', cabecalho ? cabecalho[1] : parte));
        }
      }
      porId('devocional-conteudo').replaceChildren(artigo);
      informar('devocional-resultado', '');
    } catch (e) {
      porId('devocional-conteudo').replaceChildren(criar('h1', 'Devocional indisponível'));
      informar('devocional-resultado', e.message, true);
    }
  }
  let solicitando = false;
  porId('assinatura-form').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (solicitando) return;
    const temas = ['casais', 'familia'].filter((tema) => porId('tema-' + tema).checked);
    if (!temas.length || !porId('autorizo').checked) { informar('assinatura-resultado', 'Escolha ao menos um tema e autorize o recebimento.', true); return; }
    solicitando = true; porId('assinatura-enviar').disabled = true;
    try {
      const r = await publico('/api/public/devocionais/assinar', { email: porId('email').value.trim(), temas, autorizo: true, website: porId('website').value });
      informar('assinatura-resultado', r.mensagem || 'Se a solicitação puder ser atendida, você receberá as orientações por e-mail. Confira também a caixa de spam.');
    } catch (e) { informar('assinatura-resultado', e.message, true); }
    finally { solicitando = false; porId('assinatura-enviar').disabled = false; }
  });
})();
