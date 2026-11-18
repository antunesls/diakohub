'use strict';

let membrosAcesso = [];
let usuariosAcesso = [];

function preencherPessoas(select, pessoas) {
  select.replaceChildren(new Option('Escolha…', ''), ...pessoas.map((m) => new Option(m.nome, m.id)));
}

/** Mostra a senha temporária com a prévia do texto para o WhatsApp. */
function mostrarEntregaAcesso(nome, login, r) {
  const caixa = $('acesso-entrega');
  caixa.replaceChildren(cartaoEntregaAcesso(nome, login, r));
  caixa.hidden = false;
  caixa.scrollIntoView({ block: 'nearest' });
}

async function carregarAcessosEscala() {
  try {
    [membrosAcesso, { usuarios: usuariosAcesso }] = await Promise.all([
      api('GET', '/api/membros'), api('GET', '/api/acessos-escala'),
    ]);
    const disponiveis = membrosAcesso.filter((m) => !usuariosAcesso.some((u) => u.membroId === m.id));
    preencherPessoas($('acesso-membro'), disponiveis);
    preencherPessoas($('acesso-pastor-membro'), disponiveis);
    // O servidor só lista contas da Minha escala (quem consulta a própria escala, sem administrar acessos).
    $('acesso-pastor').replaceChildren(new Option('Escolha…', ''),
      ...usuariosAcesso.filter((u) => (u.perfis || [u.perfil]).join() !== 'integrante' && !u.membroId)
        .map((u) => new Option(`${u.nome} (${u.login}) · ${u.perfilNome || u.perfil}`, u.id)));
    const lista = $('acessos-lista');
    lista.replaceChildren();
    for (const u of usuariosAcesso.filter((u) => u.membroId)) {
      const linha = document.createElement('p');
      linha.textContent = `${u.nome} · ${u.login} · ${u.perfilNome || u.perfil}${u.trocarSenha ? ' · aguardando primeiro acesso' : ''}`;
      if ((u.perfis || [u.perfil]).join() === 'integrante') {
        const redefinir = document.createElement('button');
        redefinir.type = 'button'; redefinir.className = 'botao secundario pequeno';
        redefinir.style.marginLeft = '10px'; redefinir.textContent = 'Nova senha e enviar';
        redefinir.addEventListener('click', async () => {
          if (!confirm(`Gerar uma senha nova para ${u.nome}? A sessão atual da pessoa será encerrada.`)) return;
          try {
            const r = await api('POST', `/api/acessos-escala/${encodeURIComponent(u.id)}/senha`);
            mostrarEntregaAcesso(u.nome, u.login, r);
            await carregarAcessosEscala();
          } catch (err) { mensagem($('acesso-resultado'), err.message, false); }
        });
        linha.append(redefinir);
      }
      lista.append(linha);
    }
    if (!lista.children.length) lista.textContent = 'Nenhuma conta vinculada ainda.';
  } catch (err) { mensagem($('acesso-resultado'), err.message, false); }
}

carregar.acessos = carregarAcessosEscala;

$('form-acesso-escala').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('acesso-membro').value;
  const membro = membrosAcesso.find((m) => m.id === id);
  if (!membro) return;
  try {
    const r = await api('POST', '/api/acessos-escala', { membroId: id, nome: membro.nome, login: $('acesso-login').value.trim() });
    await carregarAcessosEscala();
    mensagem($('acesso-resultado'), `Usuário ${r.usuario.login} criado.`);
    mostrarEntregaAcesso(r.usuario.nome, r.usuario.login, r);
    $('acesso-login').value = '';
  } catch (err) { mensagem($('acesso-resultado'), err.message, false); }
});

$('form-vinculo-escala').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('POST', '/api/acessos-escala/vincular', { usuarioId: $('acesso-pastor').value, membroId: $('acesso-pastor-membro').value });
    await carregarAcessosEscala();
    mensagem($('vinculo-resultado'), 'Conta vinculada. A pessoa já pode entrar com a senha atual.');
  } catch (err) { mensagem($('vinculo-resultado'), err.message, false); }
});
