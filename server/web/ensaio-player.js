'use strict';
// Modo ensaio da Minha Escala: toca os vídeos das músicas de um culto em sequência, com o tom e a
// 1ª nota em destaque, pausa com contagem entre as músicas e a ordem do culto embaixo.
// Usa o player sem cookies do YouTube (API oficial do iframe); nada é salvo no YouTube.
// Tudo fica dentro de um escopo próprio: a página já tem $, criar e outros nomes globais.
(function () {
  /** Id do vídeo de um link do YouTube (watch, youtu.be, shorts, embed); null se não for. */
  function idVideo(link) {
    let url;
    try { url = new URL(String(link || '').trim()); } catch (_) { return null; }
    const partes = url.pathname.split('/').filter(Boolean);
    let id = null;
    if (url.hostname === 'youtu.be') id = partes[0];
    else if (/(^|\.)youtube(-nocookie)?\.com$/.test(url.hostname)) {
      id = url.pathname === '/watch' ? url.searchParams.get('v')
        : (partes.length === 2 && ['shorts', 'live', 'embed'].includes(partes[0]) ? partes[1] : null);
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
  }

  /** Índice da próxima música com vídeo a partir de [i] no sentido [passo] (1 ou -1); -1 se não há. */
  function proximaComVideo(musicas, i, passo) {
    for (let j = i + passo; j >= 0 && j < musicas.length; j += passo) if (idVideo(musicas[j].youtube)) return j;
    return -1;
  }

  const quantasComVideo = (musicas) => (musicas || []).filter((m) => idVideo(m.youtube)).length;
  const mmss = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const PAUSA_SEGUNDOS = 5;

  const ICONES = {
    play: '<path d="M8 5v14l11-7z"/>',
    pausa: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
    anterior: '<path d="M6 5h2v14H6zM20 5v14L9 12z"/>',
    proxima: '<path d="M16 5h2v14h-2zM4 5v14l11-7z"/>',
  };
  function icone(nome) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'currentColor'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICONES[nome]; // ícone fixo deste arquivo
    return s;
  }
  function el(tag, props = {}, ...filhos) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    e.append(...filhos.flat().filter((f) => f !== null && f !== undefined && f !== false && f !== ''));
    return e;
  }
  const barrinhas = () => el('span', { class: 'ens-eq', 'aria-hidden': 'true' }, el('i'), el('i'), el('i'), el('i'));

  // ---------- API do YouTube (carregada uma vez, só quando alguém abre o ensaio) ----------
  let apiPronta = null;
  function carregarApi() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (apiPronta) return apiPronta;
    apiPronta = new Promise((resolve, reject) => {
      const anterior = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (anterior) anterior(); resolve(window.YT); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => { apiPronta = null; reject(new Error('Não foi possível carregar o player do YouTube. Confira a internet e tente de novo.')); };
      document.head.append(s);
    });
    return apiPronta;
  }

  // ---------- Diálogo ----------
  let dlg = null;
  const estado = { musicas: [], atual: -1, tocando: false, repetir: false, pausaEntre: true, espera: 0, player: null, relogio: 0, contagem: 0, fim: false, trocando: false };
  const q = (sel) => dlg.querySelector(sel);

  function montarDialogo() {
    dlg = el('dialog', { class: 'ensaio', 'aria-labelledby': 'ens-titulo' },
      el('div', { class: 'ens-barra' },
        el('div', { class: 'ens-culto' }, el('small', { text: 'Modo ensaio' }), el('strong', { id: 'ens-titulo' })),
        el('button', { type: 'button', class: 'ens-fechar', text: 'Fechar', onclick: () => dlg.close() })),
      el('div', { class: 'ens-palco' },
        el('div', { class: 'ens-video' }, el('div', { id: 'ens-player' })),
        el('p', { class: 'ens-erro', role: 'alert', hidden: true }),
        el('div', { class: 'ens-titulo-linha' },
          el('div', {}, el('span', { class: 'ens-pos' }), el('h2', { class: 'ens-musica' })),
          el('div', { class: 'ens-notas' },
            el('div', { class: 'ens-nota' }, el('small', { text: 'Tom' }), el('b', { class: 'ens-tom' })),
            el('div', { class: 'ens-nota' }, el('small', { text: '1ª nota' }), el('b', { class: 'ens-primeira' }))))),
      el('div', { class: 'ens-controles' },
        el('div', { class: 'ens-progresso', 'aria-hidden': 'true' }, el('div')),
        el('div', { class: 'ens-tempos' }, el('span', { class: 'ens-t' }), el('span', { class: 'ens-tt' })),
        el('div', { class: 'ens-botoes' },
          el('button', { type: 'button', class: 'ens-ant', 'aria-label': 'Música anterior', onclick: () => irPara(proximaComVideo(estado.musicas, estado.atual, -1)) }, icone('anterior')),
          el('button', { type: 'button', class: 'ens-play', onclick: alternar }),
          el('button', { type: 'button', class: 'ens-prox', 'aria-label': 'Próxima música', onclick: () => irPara(proximaComVideo(estado.musicas, estado.atual, 1)) }, icone('proxima'))),
        el('div', { class: 'ens-opcoes' },
          el('button', { type: 'button', class: 'ens-alterna', 'data-opcao': 'repetir', 'aria-pressed': 'false', text: 'Repetir esta', onclick: () => { estado.repetir = !estado.repetir; desenhar(); } }),
          el('button', { type: 'button', class: 'ens-alterna', 'data-opcao': 'pausaEntre', 'aria-pressed': 'true', text: 'Pausa entre músicas', onclick: () => { estado.pausaEntre = !estado.pausaEntre; desenhar(); } }))),
      el('div', { class: 'ens-fila' }, el('h3', { text: 'Ordem do culto' }), el('ol', { class: 'ens-lista' })),
      el('div', { class: 'ens-pausa', 'aria-live': 'polite', hidden: true },
        el('p', { text: 'Próxima música em' }),
        el('span', { class: 'ens-seg' }),
        el('strong', { class: 'ens-prox-titulo' }),
        el('p', { class: 'ens-prox-det' }),
        el('button', { type: 'button', class: 'ens-fechar', text: 'Pular a espera', onclick: () => irPara(proximaComVideo(estado.musicas, estado.atual, 1)) })));
    dlg.addEventListener('close', parar);
    document.body.append(dlg);
  }

  const detalhe = (m) => [m.tom && `tom ${m.tom}`, m.primeiraNota && `1ª nota ${m.primeiraNota}`].filter(Boolean).join(' · ');

  function desenhar() {
    const m = estado.musicas[estado.atual];
    const total = quantasComVideo(estado.musicas);
    const ordem = estado.musicas.slice(0, estado.atual + 1).filter((x) => idVideo(x.youtube)).length;
    q('.ens-pos').textContent = estado.fim ? 'Fim do ensaio' : `Música ${ordem} de ${total}`;
    q('.ens-musica').textContent = estado.fim ? 'Todas as músicas tocaram' : (m ? m.titulo : '');
    q('.ens-tom').textContent = (!estado.fim && m && m.tom) || '–';
    q('.ens-primeira').textContent = (!estado.fim && m && m.primeiraNota) || '–';
    const play = q('.ens-play');
    play.replaceChildren(icone(estado.tocando ? 'pausa' : 'play'));
    play.setAttribute('aria-label', estado.tocando ? 'Pausar' : 'Tocar');
    q('.ens-ant').disabled = proximaComVideo(estado.musicas, estado.atual, -1) < 0;
    q('.ens-prox').disabled = proximaComVideo(estado.musicas, estado.atual, 1) < 0;
    for (const b of dlg.querySelectorAll('.ens-alterna')) b.setAttribute('aria-pressed', String(estado[b.dataset.opcao]));
    q('.ens-lista').replaceChildren(...estado.musicas.map((x, i) => {
      const tem = !!idVideo(x.youtube);
      const atual = i === estado.atual && !estado.fim;
      return el('li', {}, el('button', {
        type: 'button', class: ['ens-faixa', atual && 'atual', tem && i < estado.atual && 'tocada'].filter(Boolean).join(' '),
        disabled: !tem, 'aria-current': atual ? 'true' : null, onclick: () => irPara(i) },
      el('span', { class: 'n', text: String(i + 1) }),
      el('span', { class: 't' }, x.titulo, el('small', { text: tem ? (x.primeiraNota ? `1ª nota ${x.primeiraNota}` : '') : 'sem vídeo · pulada' })),
      atual && estado.tocando ? barrinhas() : null,
      el('span', { class: 'tom', 'aria-label': x.tom ? `tom ${x.tom}` : 'sem tom', text: x.tom || '–' })));
    }));
    const prox = estado.musicas[proximaComVideo(estado.musicas, estado.atual, 1)];
    q('.ens-pausa').hidden = !(estado.espera > 0);
    q('.ens-seg').textContent = String(Math.ceil(estado.espera));
    q('.ens-prox-titulo').textContent = prox ? prox.titulo : '';
    q('.ens-prox-det').textContent = prox ? detalhe(prox) : '';
    tempo();
  }

  function tempo() {
    const p = estado.player;
    const atual = p && p.getCurrentTime ? p.getCurrentTime() || 0 : 0;
    const total = p && p.getDuration ? p.getDuration() || 0 : 0;
    q('.ens-progresso div').style.width = total ? `${Math.min(atual / total, 1) * 100}%` : (estado.fim ? '100%' : '0');
    q('.ens-t').textContent = mmss(atual);
    q('.ens-tt').textContent = mmss(total);
  }

  function erro(texto) {
    const p = q('.ens-erro');
    p.textContent = texto || '';
    p.hidden = !texto;
  }

  function cancelarEspera() {
    clearInterval(estado.contagem);
    estado.contagem = 0;
    estado.espera = 0;
  }

  /** Toca a música [i] (ignora índices sem vídeo); [aviso] fica visível enquanto ela toca. */
  function irPara(i, aviso = '') {
    const id = i >= 0 ? idVideo((estado.musicas[i] || {}).youtube) : null;
    if (!id) return;
    cancelarEspera();
    erro(aviso);
    estado.atual = i;
    estado.fim = false;
    // Ao trocar de vídeo o YouTube pode avisar "terminou" do anterior; só vale depois que o novo começar.
    estado.trocando = true;
    if (estado.player && estado.player.loadVideoById) estado.player.loadVideoById(id);
    desenhar();
  }

  function alternar() {
    const p = estado.player;
    if (!p) return;
    if (estado.fim) return irPara(proximaComVideo(estado.musicas, -1, 1));
    if (estado.tocando) p.pauseVideo(); else p.playVideo();
  }

  function terminou() {
    if (estado.repetir) { estado.player.seekTo(0, true); estado.player.playVideo(); return; }
    const prox = proximaComVideo(estado.musicas, estado.atual, 1);
    if (prox < 0) { estado.fim = true; estado.tocando = false; return desenhar(); }
    if (!estado.pausaEntre) return irPara(prox);
    estado.espera = PAUSA_SEGUNDOS;
    estado.contagem = setInterval(() => {
      estado.espera -= 1;
      if (estado.espera <= 0) irPara(prox); else desenhar();
    }, 1000);
    desenhar();
  }

  function aoMudarEstado(e) {
    const YT = window.YT;
    if (e.data === YT.PlayerState.PLAYING) { estado.tocando = true; estado.trocando = false; cancelarEspera(); }
    else if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.CUED) estado.tocando = false;
    else if (e.data === YT.PlayerState.ENDED) {
      estado.tocando = false;
      // "Terminou" que não é do vídeo atual, ou repetido durante a contagem, não avança a sequência.
      if (estado.trocando || estado.contagem) return desenhar();
      desenhar();
      return terminou();
    }
    desenhar();
  }

  /** Vídeo removido ou que não deixa tocar fora do YouTube: avisa e passa para o próximo. */
  function aoErro() {
    const m = estado.musicas[estado.atual];
    const prox = proximaComVideo(estado.musicas, estado.atual, 1);
    const titulo = m ? `"${m.titulo}"` : 'Esta música';
    if (prox < 0) return erro(`O vídeo de ${titulo} não toca fora do YouTube.`);
    const aviso = `${titulo} foi pulada: o vídeo não toca fora do YouTube. Vale trocar o link no Repertório.`;
    const daVez = estado.atual;
    erro(`O vídeo de ${titulo} não toca fora do YouTube; indo para a próxima.`);
    setTimeout(() => { if (estado.atual === daVez && dlg.open) irPara(prox, aviso); }, 2500);
  }

  function parar() {
    cancelarEspera();
    clearInterval(estado.relogio);
    estado.relogio = 0;
    if (estado.player && estado.player.destroy) estado.player.destroy();
    estado.player = null;
    estado.tocando = false;
    const lugar = q('.ens-video');
    lugar.replaceChildren(el('div', { id: 'ens-player' }));
  }

  /** Abre o ensaio do culto: [titulo] como "Domingo, 29/11 · 9h"; [musicas] com titulo, tom, primeiraNota e youtube. */
  async function abrir(titulo, musicas) {
    if (!dlg) montarDialogo();
    estado.musicas = musicas || [];
    estado.atual = proximaComVideo(estado.musicas, -1, 1);
    estado.fim = false;
    estado.tocando = false;
    cancelarEspera();
    q('#ens-titulo').textContent = titulo;
    erro('');
    desenhar();
    if (!dlg.open) dlg.showModal();
    if (estado.atual < 0) return erro('Nenhuma música deste culto tem vídeo cadastrado.');
    try {
      const YT = await carregarApi();
      if (!dlg.open) return;
      estado.trocando = true;
      estado.player = new YT.Player('ens-player', {
        host: 'https://www.youtube-nocookie.com',
        videoId: idVideo(estado.musicas[estado.atual].youtube),
        playerVars: { autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1 },
        events: { onStateChange: aoMudarEstado, onError: aoErro },
      });
      estado.relogio = setInterval(() => { if (estado.tocando) tempo(); }, 500);
    } catch (e) {
      erro(e.message);
    }
  }

  /** Botão "Ensaiar na sequência · N músicas"; null quando nenhuma música do culto tem vídeo. */
  function botaoEnsaio(titulo, musicas, classe) {
    const n = quantasComVideo(musicas);
    if (!n) return null;
    return el('button', { type: 'button', class: classe, onclick: () => abrir(titulo, musicas) },
      icone('play'), `Ensaiar na sequência · ${n} ${n === 1 ? 'música' : 'músicas'}`);
  }

  const api = { idVideo, proximaComVideo, quantasComVideo, abrir, botaoEnsaio };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.EnsaioPlayer = api;
})();
