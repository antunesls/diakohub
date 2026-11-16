// Primeiro acesso: quem entra com a senha temporária (conta nova ou senha redefinida) cria a
// própria senha antes de usar o sistema. O servidor bloqueia todo o resto (403 "trocar-senha")
// até a troca; esta tela só deixa o passo claro. Usado no painel, no /admin, na Minha escala e
// na recepção.
'use strict';

const PrimeiroAcesso = (() => {
  /** Senha digitada no login, só na memória (preenche "senha temporária" sem pedir de novo). */
  let senhaDoLogin = '';

  function lembrar(senha) {
    senhaDoLogin = senha || '';
  }

  function criar(tag, props = {}, ...filhos) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    e.append(...filhos.filter((f) => f !== null && f !== undefined));
    return e;
  }

  function estilo() {
    if (document.getElementById('estilo-primeiro-acesso')) return;
    const s = document.createElement('style');
    s.id = 'estilo-primeiro-acesso';
    s.textContent = `
      .primeiro-acesso { position: fixed; inset: 0; z-index: 1000; overflow-y: auto; padding: 8vh 16px 32px;
        background: var(--fundo, #f7f5f0); }
      .primeiro-acesso form { max-width: 420px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
      .primeiro-acesso img { display: block; width: 200px; max-width: 70%; margin: 0 auto 8px; }
      .primeiro-acesso h1 { margin: 0; font-size: 26px; }
      .primeiro-acesso p { margin: 0; }
      .primeiro-acesso .mostrar { display: flex; gap: 8px; align-items: center; font-weight: 400; margin: 0; }
      .primeiro-acesso .mostrar input { width: auto; }
      .primeiro-acesso .acoes { display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; align-items: center; }`;
    document.head.append(s);
  }

  /**
   * Mostra a tela até a pessoa criar a senha. [token]: sessão atual; [eu]: resposta de /api/eu;
   * [aoSair]: chamado se a pessoa preferir sair. Resolve quando a senha nova foi aceita.
   */
  function exigir({ token, eu, aoSair }) {
    estilo();
    const minimo = eu.senhaMinima || 8;
    return new Promise((pronto) => {
      const temporaria = criar('input', { type: 'password', id: 'pa-temporaria', autocomplete: 'current-password', required: true });
      temporaria.value = senhaDoLogin;
      const nova = criar('input', { type: 'password', id: 'pa-nova', autocomplete: 'new-password', required: true, minlength: String(minimo) });
      const confirma = criar('input', { type: 'password', id: 'pa-confirma', autocomplete: 'new-password', required: true });
      const mostrar = criar('input', { type: 'checkbox', id: 'pa-mostrar' });
      mostrar.addEventListener('change', () => {
        for (const c of [temporaria, nova, confirma]) c.type = mostrar.checked ? 'text' : 'password';
      });
      const erro = criar('p', { class: 'erro', role: 'alert', hidden: true });
      const botao = criar('button', { class: 'botao', type: 'submit', text: 'Criar senha e entrar' });
      const sair = criar('button', { class: 'botao secundario pequeno', type: 'button', text: 'Sair' });
      const campoTemporaria = criar('div', {},
        criar('label', { for: 'pa-temporaria', text: 'Senha temporária' }), temporaria,
        criar('span', { class: 'dica', text: 'A senha que você recebeu.' }));
      if (senhaDoLogin) campoTemporaria.hidden = true;
      const form = criar('form', { class: 'cartao', 'aria-labelledby': 'pa-titulo', novalidate: true },
        criar('img', { src: '/logo.png', alt: '' }),
        criar('h1', { id: 'pa-titulo', text: 'Crie a sua senha' }),
        criar('p', { class: 'dica', text: `Olá, ${eu.nome.split(' ')[0]}! Este é o seu primeiro acesso. A senha que você recebeu é temporária: escolha uma só sua para continuar.` }),
        campoTemporaria,
        criar('div', {}, criar('label', { for: 'pa-nova', text: 'Nova senha' }), nova,
          criar('span', { class: 'dica', text: `Pelo menos ${minimo} caracteres. Não use a mesma senha de outros sites.` })),
        criar('div', {}, criar('label', { for: 'pa-confirma', text: 'Repita a nova senha' }), confirma),
        criar('label', { class: 'mostrar', for: 'pa-mostrar' }, mostrar, 'Mostrar as senhas'),
        erro,
        criar('div', { class: 'acoes' }, botao, sair));
      const tela = criar('div', { class: 'primeiro-acesso', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pa-titulo' }, form);

      const avisar = (texto) => {
        erro.textContent = texto;
        erro.hidden = false;
      };
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        erro.hidden = true;
        if (!temporaria.value) {
          campoTemporaria.hidden = false;
          temporaria.focus();
          return avisar('Digite a senha temporária que você recebeu.');
        }
        if (nova.value.trim().length < minimo) return avisar(`A nova senha precisa ter pelo menos ${minimo} caracteres.`);
        if (nova.value !== confirma.value) return avisar('As duas senhas não são iguais.');
        if (nova.value === temporaria.value) return avisar('Escolha uma senha diferente da temporária.');
        botao.disabled = true;
        try {
          const r = await fetch('/api/eu/senha', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ atual: temporaria.value, nova: nova.value }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) {
            // Senha temporária errada (por exemplo, depois de recarregar a página): pede de novo.
            if (r.status === 403) campoTemporaria.hidden = false;
            throw new Error(j.erro || 'Não foi possível criar a senha. Tente de novo.');
          }
          senhaDoLogin = '';
          tela.remove();
          pronto();
        } catch (err) {
          avisar(err.message === 'Failed to fetch' ? 'Sem conexão com o servidor.' : err.message);
        } finally {
          botao.disabled = false;
        }
      });
      sair.addEventListener('click', () => {
        senhaDoLogin = '';
        tela.remove();
        if (aoSair) aoSair();
      });
      document.body.append(tela);
      (senhaDoLogin ? nova : temporaria).focus();
    });
  }

  /**
   * Busca /api/eu com [buscarEu]; se a conta ainda usa a senha temporária, mostra a tela e
   * busca de novo depois da troca. Devolve a resposta de /api/eu já liberada.
   */
  async function garantir({ token, buscarEu, aoSair }) {
    let eu = await buscarEu();
    if (eu && eu.trocarSenha) {
      await exigir({ token, eu, aoSair });
      eu = await buscarEu();
    }
    return eu;
  }

  return { lembrar, exigir, garantir };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PrimeiroAcesso;
