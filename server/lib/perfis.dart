import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

import 'permissoes.dart';

/// Perfis de acesso configuráveis, em data/perfis.json. Começa com os padrões de fábrica
/// ([PerfilPadrao]); a administração edita, cria, duplica e exclui pelo /admin.
///
/// Fica fora do backup, como data/usuarios.json: os perfis acompanham as contas.
///
/// Os objetos [Perfil] são compartilhados com as contas e editados no lugar, então uma mudança
/// vale na próxima requisição de quem usa o perfil, sem precisar entrar de novo.
class Perfis {
  Perfis(String pastaDados) : _arquivo = File(p.join(pastaDados, 'perfis.json')) {
    _lista.addAll([for (final d in PerfilPadrao.values) d.criar()]);
  }

  final File _arquivo;
  final List<Perfil> _lista = [];

  /// Padrões de fábrica que a administração excluiu (não voltam sozinhos numa atualização).
  final Set<String> _padroesExcluidos = {};
  Future<void> _fila = Future.value();

  static const maximo = 60;

  /// Descrições de fábrica de versões anteriores. Um perfil padrão que ainda guarda uma delas
  /// (a administração não a editou) passa a mostrar a descrição atual.
  static const _descricoesAntigas = {
    'liderCasais': {
      'Consulta casais e contatos limitados; escreve, publica e envia devocionais. Sem acesso às fichas completas.',
      'Gerencia contatos e materiais de Casais e Família; organiza encontros e inscrições; escreve, publica e envia devocionais. Sem acesso às fichas completas.',
    },
  };

  /// Permissões que saíram de dentro de outra: um perfil (padrão ou criado) que tinha a antiga
  /// ganha a nova na atualização, para ninguém perder o que já fazia.
  static const _separadas = {
    Permissao.cultos: Permissao.escalaPastoral,
    // "Ver as escalas" mostrava a pastoral e o louvor; agora cada escala tem a sua.
    Permissao.verPastoral: Permissao.escalasVer,
    Permissao.verLouvor: Permissao.escalasVer,
  };

  static String _descricaoAtual(PerfilPadrao? fabrica, String salva) =>
      fabrica != null && (_descricoesAntigas[fabrica.id]?.contains(salva) ?? false) ? fabrica.descricao : salva;

  List<Perfil> get lista => List.unmodifiable(_lista);
  Perfil? buscar(String id) => _lista.where((x) => x.id == id).firstOrNull;

  /// Padrões de fábrica excluídos que podem ser trazidos de volta.
  List<PerfilPadrao> get padroesExcluidos => [for (final d in PerfilPadrao.values) if (_padroesExcluidos.contains(d.id)) d];

  /// Lê o arquivo. Sem arquivo, ficam os padrões. Permissões criadas numa versão nova do
  /// servidor entram nos perfis padrão que as têm de fábrica; padrões novos são adicionados.
  Future<void> carregar() async {
    if (!await _arquivo.exists()) {
      await _salvar();
      return;
    }
    final j = jsonDecode(await _arquivo.readAsString()) as Map<String, dynamic>;
    final conhecidas = {...((j['permissoesConhecidas'] as List?) ?? const []).cast<String>()};
    _padroesExcluidos
      ..clear()
      ..addAll(((j['padroesExcluidos'] as List?) ?? const []).cast<String>());
    final lidos = <Perfil>[];
    for (final item in (j['perfis'] as List? ?? const [])) {
      final m = Map<String, dynamic>.from(item as Map);
      final id = m['id'] as String? ?? '';
      if (id.isEmpty || lidos.any((x) => x.id == id)) continue;
      final fabrica = PerfilPadrao.porId(id);
      final permissoes = {
        for (final n in (m['permissoes'] as List? ?? const []).cast<String>())
          if (Permissao.porNome(n) case final q?) q,
        // Permissão nova (que o arquivo ainda não conhecia): o padrão de fábrica decide.
        if (fabrica != null)
          for (final nova in fabrica.permissoes) if (!conhecidas.contains(nova.name)) nova,
      };
      for (final MapEntry(key: nova, value: origem) in _separadas.entries) {
        if (!conhecidas.contains(nova.name) && permissoes.contains(origem)) permissoes.add(nova);
      }
      lidos.add(Perfil(
          id: id,
          nome: m['nome'] as String? ?? id,
          descricao: _descricaoAtual(fabrica, m['descricao'] as String? ?? ''),
          permissoes: id == PerfilPadrao.administrador.id ? fabrica!.permissoes : permissoes,
          padrao: fabrica != null));
    }
    for (final d in PerfilPadrao.values) {
      if (!lidos.any((x) => x.id == d.id) && !_padroesExcluidos.contains(d.id)) lidos.add(d.criar());
    }
    // Mantém os objetos já distribuídos (as contas apontam para eles).
    for (final novo in lidos) {
      final atual = buscar(novo.id);
      if (atual != null) {
        atual
          ..nome = novo.nome
          ..descricao = novo.descricao
          ..permissoes = novo.permissoes;
      }
    }
    _lista
      ..removeWhere((x) => !lidos.any((n) => n.id == x.id))
      ..addAll(lidos.where((n) => buscar(n.id) == null));
    _ordenar();
    if (conhecidas.length != Permissao.values.length) await _salvar();
  }

  /// Cria um perfil novo. Lança [FormatException] com a mensagem para o admin.
  Future<Perfil> criar({required String nome, String descricao = '', required Iterable<Permissao> permissoes}) async {
    if (_lista.length >= maximo) throw const FormatException('Limite de $maximo perfis atingido.');
    final n = _validarNome(nome);
    final id = _novoId(n);
    final perfil = Perfil(id: id, nome: n, descricao: _validarDescricao(descricao), permissoes: permissoes);
    _lista.add(perfil);
    _ordenar();
    await _salvar();
    return perfil;
  }

  Future<Perfil> atualizar(String id, {String? nome, String? descricao, Iterable<Permissao>? permissoes}) async {
    final perfil = buscar(id);
    if (perfil == null) throw const FormatException('Perfil não encontrado.');
    if (perfil.travado) throw const FormatException('O perfil Administrador não pode ser alterado.');
    if (nome != null) perfil.nome = _validarNome(nome, ignorar: id);
    if (descricao != null) perfil.descricao = _validarDescricao(descricao);
    if (permissoes != null) perfil.permissoes = Permissao.completar(permissoes);
    await _salvar();
    return perfil;
  }

  /// Volta um perfil padrão ao de fábrica (ou traz de volta um padrão excluído).
  Future<Perfil> restaurar(String id) async {
    final fabrica = PerfilPadrao.porId(id);
    if (fabrica == null) throw const FormatException('Só os perfis padrão podem ser restaurados.');
    final perfil = buscar(id);
    if (perfil == null) {
      final novo = fabrica.criar();
      _padroesExcluidos.remove(id);
      _lista.add(novo);
      _ordenar();
      await _salvar();
      return novo;
    }
    perfil
      ..nome = fabrica.nome
      ..descricao = fabrica.descricao
      ..permissoes = Permissao.completar(fabrica.permissoes);
    await _salvar();
    return perfil;
  }

  /// Exclui o perfil. Quem chama confere antes se alguma conta usa.
  Future<void> excluir(String id) async {
    final perfil = buscar(id);
    if (perfil == null) throw const FormatException('Perfil não encontrado.');
    if (perfil.travado) throw const FormatException('O perfil Administrador não pode ser excluído.');
    _lista.remove(perfil);
    if (perfil.padrao) _padroesExcluidos.add(id);
    await _salvar();
  }

  /// Igual ao padrão de fábrica? (para mostrar "Restaurar padrão" só quando muda algo).
  static bool igualAoPadrao(Perfil perfil) {
    final f = PerfilPadrao.porId(perfil.id);
    return f != null &&
        f.nome == perfil.nome &&
        f.descricao == perfil.descricao &&
        Permissao.completar(f.permissoes).length == perfil.permissoes.length &&
        perfil.permissoes.containsAll(f.permissoes);
  }

  String _validarNome(String nome, {String? ignorar}) {
    final n = nome.trim().replaceAll(RegExp(r'\s+'), ' ');
    if (n.isEmpty) throw const FormatException('Dê um nome ao perfil.');
    if (n.length > 40) throw const FormatException('Nome do perfil muito longo (até 40 letras).');
    if (_lista.any((x) => x.id != ignorar && x.nome.toLowerCase() == n.toLowerCase())) {
      throw const FormatException('Já existe um perfil com esse nome.');
    }
    return n;
  }

  static String _validarDescricao(String d) {
    final t = d.trim();
    if (t.length > 200) throw const FormatException('Descrição muito longa (até 200 letras).');
    return t;
  }

  /// "Líder de jovens" -> "lider-de-jovens" (sem colidir com outro perfil nem com um padrão).
  String _novoId(String nome) {
    const de = 'áàâãäéèêëíìîïóòôõöúùûüçñ', para = 'aaaaaeeeeiiiiooooouuuucn';
    final base = nome
        .toLowerCase()
        .split('')
        .map((c) => de.contains(c) ? para[de.indexOf(c)] : c)
        .join()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
        .replaceAll(RegExp(r'^-+|-+$'), '');
    final raiz = base.isEmpty ? 'perfil' : (base.length > 30 ? base.substring(0, 30) : base);
    bool ocupado(String id) => buscar(id) != null || PerfilPadrao.porId(id) != null;
    var id = raiz;
    for (var i = 2; ocupado(id); i++) {
      id = '$raiz-$i';
    }
    return id;
  }

  /// Padrões primeiro, na ordem de fábrica; depois os criados, por nome.
  void _ordenar() {
    int ordem(Perfil x) => PerfilPadrao.porId(x.id)?.index ?? PerfilPadrao.values.length;
    _lista.sort((a, b) {
      final c = ordem(a).compareTo(ordem(b));
      return c != 0 ? c : a.nome.toLowerCase().compareTo(b.nome.toLowerCase());
    });
  }

  Future<void> _salvar() {
    final conteudo = const JsonEncoder.withIndent('  ').convert({
      'permissoesConhecidas': [for (final x in Permissao.values) x.name],
      'padroesExcluidos': [..._padroesExcluidos],
      'perfis': [
        for (final x in _lista)
          {'id': x.id, 'nome': x.nome, 'descricao': x.descricao, 'permissoes': [for (final q in x.permissoes) q.name]},
      ],
    });
    return _fila = _fila.then((_) async {
      await _arquivo.parent.create(recursive: true);
      final tmp = File('${_arquivo.path}.tmp');
      await tmp.writeAsString(conteudo, flush: true);
      await tmp.rename(_arquivo.path);
    });
  }
}
