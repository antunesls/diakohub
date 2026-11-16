import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

import 'auth.dart';
import 'perfis.dart';
import 'permissoes.dart';
import 'store.dart';

/// Pessoa com acesso ao painel/app (a conta principal "admin" não fica aqui: é a senha do /admin).
class Usuario {
  Usuario({
    required this.id,
    required this.nome,
    required this.login,
    required this.perfil,
    this.senhaHash = '',
    this.senhaSal = '',
    this.ativo = true,
    required this.criadoEm,
    this.ultimoAcesso,
    this.membroId,
    this.trocarSenha = false,
    this.senhaTemporariaEm,
  });

  final String id;
  String nome;
  final String login;

  /// Objeto compartilhado com [Perfis]: editar o perfil vale na hora para a conta.
  Perfil perfil;
  String senhaHash;
  String senhaSal;
  bool ativo;
  final DateTime criadoEm;
  DateTime? ultimoAcesso;
  String? membroId;

  /// Senha temporária (conta nova ou senha redefinida): só entra para criar a própria senha.
  bool trocarSenha;

  /// Quando a senha temporária foi gerada (vale [Usuarios.validadeSenhaTemporaria]).
  DateTime? senhaTemporariaEm;

  /// [perfilDe] resolve o id gravado no perfil configurado (perfil apagado: sem acesso).
  factory Usuario.fromJson(Map<String, dynamic> j, {Perfil Function(String id)? perfilDe}) {
    final idPerfil = j['perfil'] as String? ?? '';
    return Usuario(
      id: j['id'] as String,
      nome: j['nome'] as String? ?? '',
      login: j['login'] as String,
      perfil: perfilDe?.call(idPerfil) ?? Perfil.porNome(idPerfil) ?? Perfil.semAcesso(idPerfil),
      senhaHash: j['senhaHash'] as String? ?? '',
      senhaSal: j['senhaSal'] as String? ?? '',
      ativo: j['ativo'] as bool? ?? true,
      criadoEm: DateTime.tryParse(j['criadoEm'] as String? ?? '') ?? DateTime.now(),
      ultimoAcesso: DateTime.tryParse(j['ultimoAcesso'] as String? ?? ''),
      membroId: j['membroId'] as String?,
      trocarSenha: j['trocarSenha'] as bool? ?? false,
      senhaTemporariaEm: DateTime.tryParse(j['senhaTemporariaEm'] as String? ?? ''),
    );
  }

  /// A senha temporária passou da validade?
  bool senhaTemporariaVencida(DateTime agora) =>
      trocarSenha && senhaTemporariaEm != null && agora.difference(senhaTemporariaEm!) > Usuarios.validadeSenhaTemporaria;

  /// Até quando vale a senha temporária (null se a pessoa já criou a própria).
  DateTime? get senhaTemporariaAte => trocarSenha ? senhaTemporariaEm?.add(Usuarios.validadeSenhaTemporaria) : null;

  /// [comSenha] só para gravar no disco; o painel nunca recebe o hash.
  Map<String, dynamic> toJson({bool comSenha = false}) => {
        'id': id,
        'nome': nome,
        'login': login,
        'perfil': perfil.id,
        'perfilNome': perfil.nome,
        'ativo': ativo,
        'criadoEm': criadoEm.toIso8601String(),
        'ultimoAcesso': ultimoAcesso?.toIso8601String(),
        'membroId': membroId,
        'trocarSenha': trocarSenha,
        'senhaTemporariaEm': senhaTemporariaEm?.toIso8601String(),
        if (!comSenha) 'senhaTemporariaVencida': senhaTemporariaVencida(DateTime.now()),
        if (comSenha) ...{'senhaHash': senhaHash, 'senhaSal': senhaSal},
      };
}

/// Resultado do login de um usuário.
enum ResultadoLogin { ok, invalido, temporariaVencida }

/// Usuários em data/usuarios.json. Fica fora do backup (guarda os hashes das senhas).
/// Os perfis (data/perfis.json) moram junto: [perfis].
class Usuarios {
  Usuarios(String pastaDados, {DateTime Function()? relogio})
      : _arquivo = File(p.join(pastaDados, 'usuarios.json')),
        perfis = Perfis(pastaDados),
        _agora = relogio ?? DateTime.now;

  final File _arquivo;
  final Perfis perfis;
  final DateTime Function() _agora;
  final List<Usuario> _lista = [];
  Future<void> _fila = Future.value();

  static const maximo = 100;
  static const validadeSenhaTemporaria = Duration(days: 7);
  static final _formatoLogin = RegExp(r'^[a-z0-9][a-z0-9._-]{2,29}$');

  List<Usuario> get lista => List.unmodifiable(_lista);

  /// Perfil configurado com este id; sem ele, a conta fica sem acesso.
  Perfil perfilDe(String id) => perfis.buscar(id) ?? Perfil.semAcesso(id);

  /// Contas que usam o perfil.
  int quantosUsam(String idPerfil) => _lista.where((u) => u.perfil.id == idPerfil).length;

  Future<void> carregar() async {
    await perfis.carregar();
    if (!await _arquivo.exists()) return;
    final j = jsonDecode(await _arquivo.readAsString()) as List;
    _lista
      ..clear()
      ..addAll([for (final u in j) Usuario.fromJson(Map<String, dynamic>.from(u as Map), perfilDe: perfilDe)]);
  }

  /// Depois de restaurar ou excluir perfis: as contas voltam a apontar para os objetos atuais.
  void religarPerfis() {
    for (final u in _lista) {
      u.perfil = perfilDe(u.perfil.id);
    }
  }

  Usuario? buscar(String id) => _lista.where((u) => u.id == id).firstOrNull;
  Usuario? porLogin(String login) => _lista.where((u) => u.login == login.trim().toLowerCase()).firstOrNull;
  Usuario? porMembro(String id) => _lista.where((u) => u.membroId == id).firstOrNull;

  Future<Usuario> vincular(String usuarioId, String membroId) async {
    final u = buscar(usuarioId);
    if (u == null) throw const FormatException('Usuário não encontrado.');
    final outro = porMembro(membroId);
    if (outro != null && outro.id != usuarioId) {
      throw const FormatException('Este membro já tem uma conta vinculada.');
    }
    u.membroId = membroId;
    await _salvar();
    return u;
  }

  /// Usuário ativo com esta senha, ou null. Registra o último acesso.
  Future<Usuario?> autenticar(String login, String senha) async => (await entrar(login, senha)).usuario;

  /// Como [autenticar], dizendo também se a senha temporária venceu.
  Future<({ResultadoLogin resultado, Usuario? usuario})> entrar(String login, String senha) async {
    final u = porLogin(login);
    if (u == null || !u.ativo || !conferirHashSenha(senha, hash: u.senhaHash, sal: u.senhaSal)) {
      return (resultado: ResultadoLogin.invalido, usuario: null);
    }
    if (u.senhaTemporariaVencida(_agora())) return (resultado: ResultadoLogin.temporariaVencida, usuario: null);
    u.ultimoAcesso = _agora();
    await _salvar();
    return (resultado: ResultadoLogin.ok, usuario: u);
  }

  /// Cria o usuário com a senha dada. Lança [FormatException] com a mensagem para o painel.
  /// [temporaria]: a pessoa terá de criar a própria senha no primeiro acesso.
  Future<Usuario> criar({
    required String nome,
    required String login,
    required Perfil perfil,
    required String senha,
    String? membroId,
    bool temporaria = false,
  }) async {
    final l = login.trim().toLowerCase();
    if (_lista.length >= maximo) throw const FormatException('Limite de $maximo usuários atingido.');
    _validarNome(nome);
    if (!_formatoLogin.hasMatch(l)) {
      throw const FormatException('Usuário inválido: use de 3 a 30 letras minúsculas, números, ponto, hífen ou _ (ex.: maria.silva).');
    }
    if (l == Auth.idPrincipal) throw const FormatException('"admin" é reservado para a conta principal.');
    if (porLogin(l) != null) throw const FormatException('Já existe um usuário com esse nome de acesso.');
    if (membroId != null && porMembro(membroId) != null) throw const FormatException('Este membro já tem uma conta vinculada.');
    final h = gerarHashSenha(senha);
    final u = Usuario(
        id: novoId(),
        nome: nome.trim(),
        login: l,
        perfil: perfis.buscar(perfil.id) ?? perfil,
        senhaHash: h.hash,
        senhaSal: h.sal,
        membroId: membroId,
        criadoEm: _agora(),
        trocarSenha: temporaria,
        senhaTemporariaEm: temporaria ? _agora() : null);
    _lista.add(u);
    await _salvar();
    return u;
  }

  Future<Usuario> atualizar(String id, {String? nome, Perfil? perfil, bool? ativo}) async {
    final u = buscar(id);
    if (u == null) throw const FormatException('Usuário não encontrado.');
    if (nome != null) {
      _validarNome(nome);
      u.nome = nome.trim();
    }
    if (perfil != null) u.perfil = perfis.buscar(perfil.id) ?? perfil;
    if (ativo != null) u.ativo = ativo;
    await _salvar();
    return u;
  }

  /// Grava a senha. [temporaria]: senha gerada por quem administra; a pessoa troca no primeiro acesso.
  Future<void> definirSenha(String id, String senha, {bool temporaria = false}) async {
    final u = buscar(id);
    if (u == null) throw const FormatException('Usuário não encontrado.');
    final h = gerarHashSenha(senha);
    u
      ..senhaHash = h.hash
      ..senhaSal = h.sal
      ..trocarSenha = temporaria
      ..senhaTemporariaEm = temporaria ? _agora() : null;
    await _salvar();
  }

  bool conferirSenha(String id, String senha) {
    final u = buscar(id);
    return u != null && conferirHashSenha(senha, hash: u.senhaHash, sal: u.senhaSal);
  }

  Future<bool> excluir(String id) async {
    final antes = _lista.length;
    _lista.removeWhere((u) => u.id == id);
    if (_lista.length == antes) return false;
    await _salvar();
    return true;
  }

  static void _validarNome(String nome) {
    if (nome.trim().isEmpty) throw const FormatException('Informe o nome da pessoa.');
    if (nome.trim().length > 60) throw const FormatException('Nome muito longo.');
  }

  Future<void> _salvar() {
    final conteudo = const JsonEncoder.withIndent('  ').convert([for (final u in _lista) u.toJson(comSenha: true)]);
    return _fila = _fila.then((_) async {
      await _arquivo.parent.create(recursive: true);
      final tmp = File('${_arquivo.path}.tmp');
      await tmp.writeAsString(conteudo, flush: true);
      if (!Platform.isWindows) await Process.run('chmod', ['600', tmp.path]);
      await tmp.rename(_arquivo.path);
    });
  }
}
