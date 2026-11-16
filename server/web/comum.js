'use strict';
// Funções compartilhadas pelo painel (/painel) e pela administração (/admin).
// Cada página define sua própria função sair(), chamada quando a sessão expira.

let token = localStorage.getItem('diako_token');

async function api(metodo, caminho, corpo, { bruto = false, tipo, cabecalhos = {} } = {}) {
  const headers = { ...cabecalhos, Authorization: 'Bearer ' + token };
  let body;
  if (bruto) {
    body = corpo;
    if (tipo) headers['Content-Type'] = tipo;
  } else if (corpo !== undefined) {
    body = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
    headers['Content-Type'] = typeof corpo === 'string' ? 'text/plain; charset=utf-8' : 'application/json';
  }
  const r = await fetch(caminho, { method: metodo, headers, body });
  if (r.status === 401) {
    sair();
    throw new Error('Sessão expirada. Entre novamente.');
  }
  const j = await r.json().catch(() => ({}));
  // Senha temporária ainda não trocada (ex.: redefinida enquanto a página estava aberta):
  // recarrega, e a tela de primeiro acesso aparece.
  if (r.status === 403 && j.codigo === 'trocar-senha') {
    location.reload();
    throw new Error(j.erro);
  }
  if (!r.ok) {
    const erro = new Error(j.erro || 'Erro ' + r.status);
    erro.ajuda = j.ajuda; // página de ajuda que explica como resolver (ex.: agenda do Google)
    throw erro;
  }
  return j;
}

/** Mensagem de erro com o link "Como resolver", quando o servidor manda um. */
function textoDoErro(err) {
  return [err.message, err.ajuda ? [' ', el('a', { href: err.ajuda, target: '_blank', rel: 'noopener' }, 'Como resolver')] : null];
}

/** Baixa um arquivo protegido por login (ex: backup) e salva no computador. */
async function baixarArquivo(caminho, nomePadrao) {
  const r = await fetch(caminho, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 401) {
    sair();
    throw new Error('Sessão expirada. Entre novamente.');
  }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.erro || 'Erro ' + r.status);
  }
  const nome = (r.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || nomePadrao;
  const url = URL.createObjectURL(await r.blob());
  const a = el('a', { href: url, download: nome });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** URL de exibição para arquivo protegido por login (fotos de membros): fetch com o
 *  token + blob, já que <img src> não manda o cabeçalho Authorization. Cache por
 *  caminho na sessão — inclua ?v=<versão> para forçar nova busca quando o arquivo muda. */
const _urlsAutenticadas = new Map();
async function urlAutenticada(caminho) {
  if (_urlsAutenticadas.has(caminho)) return _urlsAutenticadas.get(caminho);
  const r = await fetch(caminho, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 401) {
    sair();
    throw new Error('Sessão expirada. Entre novamente.');
  }
  if (!r.ok) return null;
  const url = URL.createObjectURL(await r.blob());
  _urlsAutenticadas.set(caminho, url);
  return url;
}

/** Cria elementos sem innerHTML (o conteúdo vem de usuários). */
function el(tag, props = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) e.append(f);
  return e;
}

const $ = (id) => document.getElementById(id);
const botao = (texto, onclick, classe = 'secundario pequeno') => el('button', { class: 'botao ' + classe, type: 'button', onclick }, texto);

function mensagem(alvo, texto, ok = true) {
  alvo.textContent = texto;
  alvo.className = ok ? 'sucesso' : 'erro';
}

function dataCurta(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function tamanhoLegivel(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

/** Abre um <dialog>; [salvar] lança um erro para mostrar a mensagem no diálogo. */
function abrirDialogo(dialogo, erroEl, salvar) {
  erroEl.hidden = true;
  const form = dialogo.querySelector('form');
  form.onsubmit = async (e) => {
    if (e.submitter && e.submitter.value === 'cancelar') return;
    e.preventDefault();
    // Botão desativado enquanto salva: clique duplo não grava duas vezes.
    const botaoSalvar = e.submitter || form.querySelector('button:not([type=button])');
    if (botaoSalvar && botaoSalvar.disabled) return;
    if (botaoSalvar) botaoSalvar.disabled = true;
    erroEl.hidden = true;
    try {
      await salvar();
      dialogo.close();
    } catch (err) {
      erroEl.replaceChildren(...textoDoErro(err).flat().filter(Boolean));
      erroEl.hidden = false;
    } finally {
      if (botaoSalvar) botaoSalvar.disabled = false;
    }
  };
  dialogo.showModal();
}

/**
 * Cartão com a senha temporária e o texto para entregar o acesso pelo WhatsApp (prévia editável,
 * Copiar e Abrir no WhatsApp, como no texto da escala). O sistema não manda mensagens sozinho.
 * [r]: resposta do servidor ao criar a conta ou gerar senha (senhaTemporaria, mensagemAcesso, whatsapp).
 */
function cartaoEntregaAcesso(nome, login, r) {
  const texto = el('textarea', { rows: 8, 'aria-label': 'Mensagem com o acesso de ' + nome, style: 'min-height:170px;font-family:inherit' });
  texto.value = r.mensagemAcesso || `Usuário: ${login}\nSenha temporária: ${r.senhaTemporaria}`;
  const abrir = el('a', { class: 'botao pequeno', target: '_blank', rel: 'noopener' },
    r.whatsapp ? 'Abrir conversa no WhatsApp' : 'Abrir no WhatsApp');
  const atualizar = () => {
    abrir.href = 'https://wa.me/' + (r.whatsapp || '') + '?text=' + encodeURIComponent(texto.value);
  };
  texto.addEventListener('input', atualizar);
  atualizar();
  const status = el('span', { role: 'status' });
  const copiarTexto = botao('Copiar', async () => {
    try {
      await navigator.clipboard.writeText(texto.value);
      mensagem(status, 'Texto copiado.');
    } catch {
      texto.select();
      mensagem(status, 'Selecione o texto e copie.', false);
    }
  });
  return el('div', { class: 'entrega-acesso', style: 'display:flex;flex-direction:column;gap:8px' },
    el('p', { style: 'margin:0' }, el('strong', {}, `Acesso de ${nome}`), ' · usuário ', el('code', {}, login),
      ' · senha temporária ', el('code', {}, r.senhaTemporaria)),
    el('p', { class: 'dica', style: 'margin:0' },
      'A senha só aparece agora e vale por 7 dias. Revise o texto e envie para a pessoa; no primeiro acesso ela cria a própria senha. ',
      r.whatsapp ? 'O botão abre a conversa com o WhatsApp do cadastro de membros.'
        : 'Sem WhatsApp no cadastro de membros: o botão abre o WhatsApp para você escolher o contato.'),
    texto,
    el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;align-items:center' }, copiarTexto, abrir, status));
}
