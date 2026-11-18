/// Permissões e perfis de acesso. O servidor confere cada rota pela permissão exigida e o
/// painel/app escondem o que o perfil não permite. Os perfis são configuráveis no /admin
/// (data/perfis.json); [PerfilPadrao] guarda só os padrões de fábrica.
library;

/// Áreas que agrupam as permissões na tela de perfis (mesma ordem do menu do painel).
enum AreaPermissao {
  painel('Painel e telão'),
  oracao('Oração e mensagens'),
  pessoas('Pessoas e visitantes'),
  escalas('Escalas e louvor'),
  comunicacao('Comunicação'),
  gestao('Gestão'),
  administracao('Administração');

  const AreaPermissao(this.nome);
  final String nome;
}

enum Permissao {
  /// Estar logado (logout, "eu", WebSocket). Todo perfil tem.
  sessao('Entrar no painel', AreaPermissao.painel, ''),
  painel('Início, Status e Histórico', AreaPermissao.painel, 'Abas Visão geral, Histórico e Status do painel.'),
  projetar('Projetar no telão', AreaPermissao.painel, 'Mandar recados, pedidos, cartazes e a Palavra para o Holyrics; operar o tablet.'),
  motivosVer('Ver pedidos de oração públicos', AreaPermissao.oracao, 'Aba Motivos de oração (só os públicos).'),
  motivosParticulares('Ver pedidos particulares e o nome de quem pediu', AreaPermissao.oracao, 'Inclui os pedidos marcados como particulares.'),
  motivosEditar('Aprovar, editar e marcar pedidos como atendidos', AreaPermissao.oracao, ''),
  mensagens('Caixa de mensagens', AreaPermissao.oracao, 'Mensagens enviadas pelo site (dúvidas, sugestões, críticas).'),
  membros('Cadastro de membros', AreaPermissao.pessoas, 'Aba Membros, fichas, certificado de batismo e contato com visitantes.'),
  casais('Consultar Casais e Família', AreaPermissao.pessoas, 'Aniversários de casamento por mês e contatos limitados. Não permite consultar ou editar fichas completas.'),
  casaisGerenciar('Gerenciar Casais e Família', AreaPermissao.pessoas, 'Registrar contatos e organizar os materiais do ministério. Não permite consultar ou editar fichas completas.'),
  encontros('Encontros e inscrições', AreaPermissao.pessoas, 'Organizar encontros, inscrições, presença e tarefas para qualquer público. Não exige vínculo de casal nem permite editar fichas completas.'),
  devocionais('Escrever, publicar e enviar devocionais', AreaPermissao.comunicacao, 'Página Devocionais: escrever, agendar e publicar em qualquer trilha e enviar por e-mail aos assinantes (envio só após confirmação). Não dá acesso a Casais e Família.'),
  ministerios('Cadastro de ministérios', AreaPermissao.pessoas, 'Criar ministérios e dizer quem participa de cada um (decide quem vê as atas de cada ministério).'),
  visitantes('Ver os visitantes do dia e dar as boas-vindas', AreaPermissao.pessoas, ''),
  visitantesHistorico('Ver visitantes de outros dias', AreaPermissao.pessoas, 'Sem esta, só aparecem os visitantes de hoje (como na Recepção).'),
  visitantesCadastrar('Cadastrar visitantes (recepção)', AreaPermissao.pessoas, 'Página /recepcao pelo celular.'),
  escalasVer('Ver as escalas', AreaPermissao.escalas, 'Abas Escalas, Repertório e Roteiros (só consulta).'),
  escalaPastoral('Montar a escala pastoral e os cultos do mês', AreaPermissao.escalas, ''),
  escalaLouvor('Montar a escala e as músicas do louvor', AreaPermissao.escalas, ''),
  minhaEscala('Consultar a própria escala', AreaPermissao.escalas, 'Página Minha escala.'),
  indisponibilidade('Avisar indisponibilidade', AreaPermissao.escalas, 'Na Minha escala, marcar os dias em que não pode servir.'),
  musicasMinistro('Escolher as músicas dos cultos em que ministra', AreaPermissao.escalas, 'Na Minha escala, para quem é ministro de louvor.'),
  acessosEscala('Administrar acessos individuais às escalas', AreaPermissao.escalas, 'Criar contas da Minha escala para os membros.'),
  palavras('Preparar as próprias Palavras (sermões) no painel', AreaPermissao.escalas, ''),
  palavrasTodas('Ver e revisar as Palavras de todos os pregadores', AreaPermissao.escalas, ''),
  recados('Recados', AreaPermissao.comunicacao, ''),
  agendaVer('Ver a agenda', AreaPermissao.comunicacao, ''),
  agendaEditar('Criar e editar eventos da agenda', AreaPermissao.comunicacao, ''),
  cartazes('Cartazes', AreaPermissao.comunicacao, ''),
  galeria('Galeria do site', AreaPermissao.comunicacao, 'Fotos do carrossel da página inicial.'),
  gestaoCasa('Gestão da Casa: pendências, compras e manutenção', AreaPermissao.gestao, ''),
  atas('Atas de reunião', AreaPermissao.gestao, ''),
  atasSigilosas('Ver e escrever atas sigilosas', AreaPermissao.gestao, ''),
  atasTodosMinisterios('Ver atas de todos os ministérios', AreaPermissao.gestao, 'Sem esta, a pessoa só vê as atas dos ministérios de que participa (pelo cadastro de membro ligado à conta).'),
  resumo('Resumo da semana', AreaPermissao.gestao, ''),
  admin('Administração', AreaPermissao.administracao, 'Página /admin: configurações, backup, integrações e auditoria.'),
  usuarios('Usuários e perfis', AreaPermissao.administracao, 'Página Usuários e acessos: criar contas, dar perfis, redefinir senhas e configurar perfis (só o que a própria pessoa pode).');

  const Permissao(this.descricao, this.area, this.dica);
  final String descricao;
  final AreaPermissao area;
  final String dica;

  static Permissao? porNome(String nome) => values.where((p) => p.name == nome).firstOrNull;

  /// Permissões que esta exige para fazer sentido (marcar uma marca as outras).
  Set<Permissao> get implica => switch (this) {
        motivosParticulares || motivosEditar => {motivosVer},
        visitantesHistorico || visitantesCadastrar => {visitantes},
        escalaPastoral || escalaLouvor => {escalasVer},
        indisponibilidade || musicasMinistro => {minhaEscala},
        palavrasTodas => {palavras},
        agendaEditar => {agendaVer},
        casaisGerenciar => {casais},
        atasSigilosas || atasTodosMinisterios => {atas},
        _ => const {},
      };

  /// [conjunto] mais a sessão e tudo o que as permissões dele implicam.
  static Set<Permissao> completar(Iterable<Permissao> conjunto) {
    final r = {sessao, ...conjunto};
    var mudou = true;
    while (mudou) {
      final antes = r.length;
      r.addAll([for (final p in r.toList()) ...p.implica]);
      mudou = r.length != antes;
    }
    return r;
  }

  Map<String, dynamic> toJson() => {
        'id': name,
        'descricao': descricao,
        'area': area.name,
        'areaNome': area.nome,
        'dica': dica,
        'implica': [for (final p in implica) p.name],
      };
}

// Visão geral, Histórico e Status (permissão painel) ficam com a equipe do telão e a administração;
// os perfis de uma área só (comissão, gestão da casa, pregador) entram direto na própria aba.
const _base = {Permissao.sessao, Permissao.painel, Permissao.motivosVer, Permissao.recados, Permissao.agendaVer, Permissao.cartazes};

/// Os perfis de fábrica. Viram dados editáveis em data/perfis.json; "Restaurar padrão" volta a estes.
enum PerfilPadrao {
  administrador('Administrador', 'Tudo, inclusive configurações, backup e usuários.', {
    ..._base, Permissao.motivosParticulares, Permissao.motivosEditar, Permissao.mensagens, Permissao.agendaEditar,
    Permissao.galeria, Permissao.membros, Permissao.gestaoCasa, Permissao.resumo, Permissao.projetar, Permissao.admin, Permissao.usuarios,
    Permissao.visitantes, Permissao.visitantesHistorico, Permissao.visitantesCadastrar, Permissao.escalasVer,
    Permissao.escalaPastoral, Permissao.escalaLouvor, Permissao.minhaEscala, Permissao.indisponibilidade,
    Permissao.acessosEscala, Permissao.palavras, Permissao.palavrasTodas, Permissao.atas, Permissao.atasSigilosas,
    Permissao.ministerios, Permissao.atasTodosMinisterios, Permissao.casais, Permissao.casaisGerenciar, Permissao.encontros,
    Permissao.devocionais,
  }),
  pastor('Pastor', 'Todo o conteúdo, inclusive pedidos particulares. Sem configurações técnicas.', {
    ..._base, Permissao.motivosParticulares, Permissao.motivosEditar, Permissao.mensagens, Permissao.agendaEditar,
    Permissao.galeria, Permissao.membros, Permissao.gestaoCasa, Permissao.resumo, Permissao.projetar,
    Permissao.visitantes, Permissao.visitantesHistorico, Permissao.visitantesCadastrar, Permissao.escalasVer,
    Permissao.escalaPastoral, Permissao.escalaLouvor, Permissao.minhaEscala, Permissao.indisponibilidade,
    Permissao.palavras, Permissao.palavrasTodas, Permissao.atas, Permissao.atasSigilosas,
    Permissao.ministerios, Permissao.atasTodosMinisterios, Permissao.casais, Permissao.casaisGerenciar, Permissao.encontros,
    Permissao.devocionais,
  }),
  secretaria('Secretaria', 'Recados, agenda, mensagens, aniversariantes e pedidos públicos.', {
    ..._base, Permissao.motivosEditar, Permissao.mensagens, Permissao.agendaEditar, Permissao.membros, Permissao.gestaoCasa, Permissao.resumo,
    Permissao.visitantes, Permissao.visitantesHistorico, Permissao.visitantesCadastrar, Permissao.escalasVer,
    Permissao.minhaEscala, Permissao.indisponibilidade, Permissao.acessosEscala, Permissao.atas, Permissao.ministerios, Permissao.casais,
    Permissao.encontros,
  }),
  midia('Mídia', 'Cartazes, galeria do site, recados e projeção no telão.', {
    ..._base, Permissao.galeria, Permissao.projetar, Permissao.escalasVer,
  }),
  telao('Telão (tablet)', 'Operar o telão no culto: recados, pedidos públicos, boas-vindas e projeção.', {
    ..._base, Permissao.projetar, Permissao.visitantes, Permissao.visitantesHistorico, Permissao.escalasVer,
  }),
  recepcao('Recepção', 'Obreiro da recepção: cadastra visitantes pelo celular (/recepcao) e vê os do dia. Nada mais.', {
    Permissao.sessao, Permissao.visitantes, Permissao.visitantesCadastrar,
  }),
  gestaoCasa('Gestão da Casa', 'Cuida das pendências, compras planejadas e manutenções preventivas.', {
    Permissao.sessao, Permissao.gestaoCasa,
  }),
  liderCasais('Líder de Casais e Família', 'Gerencia contatos e materiais de Casais e Família; organiza encontros e inscrições; escreve, publica e envia devocionais. Sem acesso às fichas completas.', {
    Permissao.sessao, Permissao.casais, Permissao.casaisGerenciar, Permissao.encontros, Permissao.devocionais,
  }),
  comissaoLouvor('Comissão do Louvor', 'Membros da comissão: montam a escala e as músicas do louvor e veem a escala pastoral e a agenda.', {
    Permissao.sessao, Permissao.agendaVer, Permissao.escalasVer, Permissao.escalaLouvor, Permissao.minhaEscala,
    Permissao.indisponibilidade,
  }),
  louvor('Louvor', 'Consulta somente a própria escala e as músicas dos cultos em que serve.', {
    Permissao.sessao, Permissao.minhaEscala,
  }),
  ministro('Ministro', 'Escolhe as músicas dos cultos em que ministra e consulta a própria escala.', {
    Permissao.sessao, Permissao.minhaEscala, Permissao.indisponibilidade, Permissao.musicasMinistro,
  }),
  pregador('Pregador', 'Prepara as próprias Palavras (sermões) no painel e consulta a própria escala.', {
    Permissao.sessao, Permissao.palavras, Permissao.escalasVer, Permissao.minhaEscala, Permissao.indisponibilidade,
  }),
  integrante('Integrante', 'Consulta a própria escala e avisa indisponibilidades.', {
    Permissao.sessao, Permissao.minhaEscala, Permissao.indisponibilidade,
  }),
  // Conta de máquina: o DiakoPlayer (PC do som) lê o culto e o repertório para montar a fila do louvor.
  player('DiakoPlayer', 'Conta do PC do som: o DiakoPlayer lê as escalas e o repertório para montar a fila do louvor. Não entra no painel.', {
    Permissao.sessao, Permissao.escalasVer,
  });

  const PerfilPadrao(this.nome, this.descricao, this.permissoes);
  final String nome;
  final String descricao;
  final Set<Permissao> permissoes;

  /// Identificador gravado nas contas (as contas antigas "louvor" agora são somente leitura).
  String get id => this == PerfilPadrao.comissaoLouvor ? 'comissao-louvor' : name;

  static PerfilPadrao? porId(String id) => values.where((p) => p.id == id).firstOrNull;

  Perfil criar() => Perfil(id: id, nome: nome, descricao: descricao, permissoes: permissoes, padrao: true);
}

/// Perfil de acesso: um conjunto nomeado de permissões. Os de fábrica ([padrao]) podem ser editados
/// e restaurados; o Administrador é travado para ninguém perder o acesso à administração.
class Perfil {
  Perfil({required this.id, required this.nome, this.descricao = '', required Iterable<Permissao> permissoes, this.padrao = false})
      : permissoes = Permissao.completar(permissoes);

  final String id;
  String nome;
  String descricao;
  Set<Permissao> permissoes;

  /// Veio de fábrica ([PerfilPadrao]); pode ser restaurado.
  final bool padrao;

  bool get travado => id == PerfilPadrao.administrador.id;
  bool pode(Permissao p) => permissoes.contains(p);

  /// Perfil de uma conta cujo perfil foi apagado ou não existe: só entra, não vê nada.
  factory Perfil.semAcesso(String id) => Perfil(id: id, nome: 'Sem perfil', permissoes: const {});

  /// O que uma conta com vários perfis pode: a soma das permissões (nenhum perfil tira nada).
  /// Com um perfil só, devolve o próprio objeto (compartilhado com `Perfis`); sem nenhum, sem acesso.
  /// Calculado na hora: editar um dos perfis já vale para a conta.
  static Perfil combinado(List<Perfil> perfis) {
    if (perfis.isEmpty) return Perfil.semAcesso('');
    if (perfis.length == 1) return perfis.single;
    return Perfil(
        id: perfis.first.id,
        nome: perfis.map((p) => p.nome).join(' + '),
        permissoes: {for (final p in perfis) ...p.permissoes});
  }

  // Os padrões de fábrica, para código e testes que precisam de um perfil conhecido.
  static final administrador = PerfilPadrao.administrador.criar();
  static final pastor = PerfilPadrao.pastor.criar();
  static final secretaria = PerfilPadrao.secretaria.criar();
  static final midia = PerfilPadrao.midia.criar();
  static final telao = PerfilPadrao.telao.criar();
  static final recepcao = PerfilPadrao.recepcao.criar();
  static final gestaoCasa = PerfilPadrao.gestaoCasa.criar();
  static final liderCasais = PerfilPadrao.liderCasais.criar();
  static final comissaoLouvor = PerfilPadrao.comissaoLouvor.criar();
  static final louvor = PerfilPadrao.louvor.criar();
  static final ministro = PerfilPadrao.ministro.criar();
  static final pregador = PerfilPadrao.pregador.criar();
  static final integrante = PerfilPadrao.integrante.criar();
  static final player = PerfilPadrao.player.criar();

  /// Os padrões de fábrica, na ordem de [PerfilPadrao].
  static final List<Perfil> values = [
    administrador, pastor, secretaria, midia, telao, recepcao, gestaoCasa, comissaoLouvor, louvor, ministro, pregador,
    integrante, player, liderCasais,
  ];

  /// Padrão de fábrica com este id (os perfis configurados ficam em `Perfis`).
  static Perfil? porNome(String id) => values.where((p) => p.id == id).firstOrNull;

  /// Página onde a pessoa deste perfil entra: /recepcao, /minha-escala ou /painel.
  String get entrada {
    final uteis = permissoes.difference({Permissao.sessao, Permissao.indisponibilidade, Permissao.musicasMinistro});
    if (uteis.every({Permissao.visitantes, Permissao.visitantesCadastrar}.contains) && pode(Permissao.visitantesCadastrar)) {
      return '/recepcao';
    }
    if (uteis.length == 1 && uteis.single == Permissao.minhaEscala) return '/minha-escala';
    return '/painel';
  }

  Perfil copia() => Perfil(id: id, nome: nome, descricao: descricao, permissoes: permissoes, padrao: padrao);

  Map<String, dynamic> toJson() => {
        'id': id,
        'nome': nome,
        'descricao': descricao,
        'permissoes': [for (final p in Permissao.values) if (permissoes.contains(p)) p.name],
        'padrao': padrao,
        'travado': travado,
      };
}

/// Permissão exigida por uma rota da API (caminho sem a barra inicial, ex.: "api/motivos/abc").
/// Rota não listada exige [Permissao.admin]: o padrão é negar.
Permissao permissaoDaRota(String metodo, String caminho) {
  final leitura = metodo == 'GET' || metodo == 'HEAD';
  bool comeca(String prefixo) => caminho == prefixo || caminho.startsWith('$prefixo/');

  if (caminho == 'ws' || caminho == 'api/logout' || comeca('api/eu')) return Permissao.sessao;
  if (caminho == 'api/estado' || caminho == 'api/historico' || comeca('api/qr-projetado')) return Permissao.painel;
  if (comeca('api/motivos')) return leitura ? Permissao.motivosVer : Permissao.motivosEditar;
  if (comeca('api/mensagens')) return Permissao.mensagens;
  if (comeca('api/recados')) return Permissao.recados;
  if (comeca('api/agenda/eventos')) return Permissao.agendaEditar;
  if (caminho == 'api/agenda') return Permissao.agendaVer;
  if (comeca('api/cartazes')) return Permissao.cartazes;
  if (comeca('api/galeria')) return Permissao.galeria;
  if (comeca('api/membros')) return Permissao.membros;
  if (comeca('api/casais')) return leitura ? Permissao.casais : Permissao.casaisGerenciar;
  // Encontros e inscrições são uma área própria: não exigem vínculo de casal.
  if (comeca('api/encontros') || comeca('api/inscricoes')) return Permissao.encontros;
  if (comeca('api/devocionais')) return Permissao.devocionais;
  if (comeca('api/solicitacoes-membros')) return Permissao.membros;
  // Certificado de batismo (geração do PDF e as imagens de assinatura/carimbo salvas).
  if (comeca('api/certificado')) return Permissao.membros;
  if (comeca('api/casa')) return Permissao.gestaoCasa;
  // Atas sigilosas: cada handler confere atasSigilosas antes de mostrar ou alterar.
  if (comeca('api/atas')) return Permissao.atas;
  // A lista de ministérios (nomes) serve a todo mundo que escolhe um (atas, membros); quem
  // participa de cada um e as alterações são do cadastro de ministérios.
  if (caminho == 'api/ministerios' && leitura) return Permissao.sessao;
  if (comeca('api/ministerios')) return Permissao.ministerios;
  if (comeca('api/visitas')) {
    // Contato pós-visita mexe com telefone e anotações: só quem cuida do cadastro.
    if (caminho.endsWith('/contato')) return Permissao.membros;
    if (caminho.endsWith('/mencionada') || leitura) return Permissao.visitantes;
    return Permissao.visitantesCadastrar;
  }
  if (caminho == 'api/resumo-semanal') return Permissao.resumo;
  if (comeca('api/minha-escala')) return Permissao.minhaEscala;
  if (comeca('api/acessos-escala')) return Permissao.acessosEscala;
  // A trilha de auditoria (escalas, repertório, músicas, roteiros e indisponibilidades) é só da administração.
  if (comeca('api/auditoria')) return Permissao.admin;
  // Ver basta para entrar; cada alteração confere no handler se é da pastoral ou do louvor.
  if (comeca('api/escalas')) return Permissao.escalasVer;
  if (comeca('api/repertorio')) return Permissao.escalasVer;
  // Modelos de roteiro do Modo Culto: ver com a escala; alterar confere a pastoral no handler.
  if (comeca('api/roteiros')) return Permissao.escalasVer;
  // A Palavra do dia desce para o tablet do culto; o resto é do pregador (cada um vê as suas).
  if (caminho == 'api/palavras/hoje' || caminho == 'api/palavras/prontas' || caminho == 'api/palavras/escolha-dia') {
    return Permissao.projetar;
  }
  if (comeca('api/palavras')) return Permissao.palavras;
  if (caminho == 'api/temas' || comeca('api/holyrics') || comeca('api/projetar')) return Permissao.projetar;
  if (comeca('api/agente-local')) return Permissao.projetar; // parear o tablet com o agente da rede local
  if (comeca('api/admin/usuarios') || comeca('api/admin/perfis')) return Permissao.usuarios;
  return Permissao.admin; // api/admin/*, api/backup(s) e qualquer rota nova não listada
}
