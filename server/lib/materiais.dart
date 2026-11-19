import 'dart:convert';

import 'package:diako_core/diako_core.dart';

import 'auth.dart';
import 'permissoes.dart';
import 'store.dart';

/// Biblioteca de materiais e roteiros dos encontros, de qualquer ministério.
///
/// Cada material pode ser de um ministério (do cadastro de Ministérios) ou geral (`ministerioId`
/// nulo), tem um tipo cadastrável (coleção `tiposMaterial`) e um público. O roteiro de um encontro
/// guarda uma cópia da versão usada: editar ou arquivar o material depois não muda o histórico.
/// Tudo exige a permissão `encontros`; a fila é a mesma dos encontros e inscrições.
class Materiais {
  Materiais(this.store, {DateTime Function()? agora}) : _agora = agora ?? DateTime.now;

  final Store store;
  final DateTime Function() _agora;

  static const colecao = 'materiais';
  static const colecaoTipos = 'tiposMaterial';

  static const publicos = {
    'todos': 'Todos',
    'criancas': 'Crianças',
    'adolescentes': 'Adolescentes',
    'jovens': 'Jovens',
    'adultos': 'Adultos',
    'casais': 'Casais',
    'familias': 'Famílias',
    'mulheres': 'Mulheres',
    'homens': 'Homens',
    'lideranca': 'Liderança',
  };

  /// Tipos criados na primeira vez; a igreja renomeia, cria e exclui pelo painel.
  static const tiposPadrao = ['Dinâmica', 'Estudo bíblico', 'Oração', 'Quebra-gelo', 'Palestra', 'Louvor', 'Outro'];

  static const _textos = {'titulo', 'objetivo', 'referenciasBiblicas', 'preparacao', 'passos', 'perguntas'};
  static const _campos = {..._textos, 'publico', 'duracaoMinutos', 'ministerioId', 'tipoId'};

  /// Campos copiados para o roteiro do encontro (o nome do tipo vai junto: tipos podem ser renomeados).
  static const camposSnapshot = {..._textos, 'publico', 'duracaoMinutos', 'tipoNome'};

  static Map<String, dynamic> _copia(Map<String, dynamic> d) => jsonDecode(jsonEncode(d)) as Map<String, dynamic>;

  static void _exigir(Conta conta) {
    if (!conta.pode(Permissao.encontros)) throw StateError('Sem permissão para gerenciar materiais.');
  }

  Future<T> _serializar<T>(Future<T> Function() acao) => store.serializarCasais(acao);

  // ---------- Tipos ----------

  /// Lista os tipos em ordem alfabética, criando os padrões na primeira vez.
  Future<List<Map<String, dynamic>>> listarTipos() async {
    if (store.listar(colecaoTipos).isEmpty) {
      await _serializar(() async {
        if (store.listar(colecaoTipos).isNotEmpty) return;
        final agora = _agora().toIso8601String();
        await store.salvarVarios(colecaoTipos, [
          for (final nome in tiposPadrao)
            {'id': novoId(), 'nome': nome, 'criadoEm': agora, 'usuarioId': 'sistema', 'usuarioNome': 'DiakoHub'},
        ]);
      });
    }
    final lista = store.listar(colecaoTipos).map(_copia).toList()
      ..sort((a, b) => _chave(a['nome'] as String).compareTo(_chave(b['nome'] as String)));
    final usos = <String, int>{};
    for (final m in store.listar(colecao)) {
      final t = m['tipoId'];
      if (t is String) usos[t] = (usos[t] ?? 0) + 1;
    }
    return [for (final t in lista) {...t, 'materiais': usos[t['id']] ?? 0}];
  }

  static String _chave(String nome) => semAcento(nome.trim().toLowerCase())!.replaceAll(RegExp(r'\s+'), ' ');

  String _nomeTipo(Object? valor, {String? ignorar}) {
    if (valor is! String || valor.trim().isEmpty || valor.trim().length > 60) {
      throw const FormatException('Informe o nome do tipo (até 60 caracteres).');
    }
    final nome = valor.trim().replaceAll(RegExp(r'\s+'), ' ');
    if (store.listar(colecaoTipos).any((t) => t['id'] != ignorar && _chave(t['nome'] as String) == _chave(nome))) {
      throw const FormatException('Já existe um tipo com esse nome.');
    }
    return nome;
  }

  Future<Map<String, dynamic>> criarTipo(Map<String, dynamic> corpo, {required Conta conta}) => _serializar(() async {
        _exigir(conta);
        if (corpo.keys.any((k) => k != 'nome')) throw const FormatException('Informe apenas o nome do tipo.');
        if (store.listar(colecaoTipos).length >= 60) throw const FormatException('Limite de 60 tipos atingido.');
        final doc = {
          'id': novoId(),
          'nome': _nomeTipo(corpo['nome']),
          'criadoEm': _agora().toIso8601String(),
          'usuarioId': conta.id,
          'usuarioNome': conta.nome,
        };
        await store.salvar(colecaoTipos, doc);
        return _copia(doc);
      });

  Future<Map<String, dynamic>> renomearTipo(String id, Map<String, dynamic> corpo, {required Conta conta}) =>
      _serializar(() async {
        _exigir(conta);
        final atual = store.buscar(colecaoTipos, id);
        if (atual == null) throw const NaoEncontrado('Tipo não encontrado.');
        if (corpo.keys.any((k) => k != 'nome')) throw const FormatException('Informe apenas o nome do tipo.');
        final doc = {
          ...atual,
          'nome': _nomeTipo(corpo['nome'], ignorar: id),
          'alteradoEm': _agora().toIso8601String(),
          'alteradoPor': conta.id,
        };
        await store.salvar(colecaoTipos, doc);
        return _copia(doc);
      });

  /// Exclui um tipo sem materiais (inclusive arquivados). Sempre fica ao menos um tipo.
  Future<void> excluirTipo(String id, {required Conta conta}) => _serializar(() async {
        _exigir(conta);
        if (store.buscar(colecaoTipos, id) == null) throw const NaoEncontrado('Tipo não encontrado.');
        final usos = store.listar(colecao).where((m) => m['tipoId'] == id).length;
        if (usos > 0) {
          throw FormatException('O tipo é usado em $usos ${usos == 1 ? 'material' : 'materiais'}: '
              'mude o tipo deles ou renomeie este tipo.');
        }
        if (store.listar(colecaoTipos).length <= 1) throw const FormatException('Mantenha ao menos um tipo.');
        await store.excluir(colecaoTipos, id);
      });

  // ---------- Materiais ----------

  List<Map<String, dynamic>> listarMateriais({bool arquivados = false, String? ministerioId}) {
    final tipos = {for (final t in store.listar(colecaoTipos)) t['id']: t['nome']};
    final lista = store
        .listar(colecao)
        .where((d) => arquivados || d['arquivado'] != true)
        .where((d) => ministerioId == null || d['ministerioId'] == null || d['ministerioId'] == ministerioId)
        .map((d) => {..._copia(d), if (tipos[d['tipoId']] != null) 'tipoNome': tipos[d['tipoId']]})
        .toList();
    lista.sort((a, b) => _chave(a['titulo'] as String).compareTo(_chave(b['titulo'] as String)));
    return lista;
  }

  Map<String, dynamic>? material(String id) {
    final doc = store.buscar(colecao, id);
    if (doc == null) return null;
    final tipo = doc['tipoId'] == null ? null : store.buscar(colecaoTipos, doc['tipoId'] as String);
    return {..._copia(doc), if (tipo != null) 'tipoNome': tipo['nome']};
  }

  Map<String, dynamic> _validar(Map<String, dynamic> corpo, {Map<String, dynamic>? anterior}) {
    if (corpo.keys.any((k) => !_campos.contains(k))) throw const FormatException('Campo de material não permitido.');
    final dados = <String, dynamic>{};
    var total = 0;
    for (final campo in _textos) {
      final valor = corpo.containsKey(campo) ? corpo[campo] : anterior?[campo] ?? '';
      if (valor is! String) throw FormatException('Informe texto em $campo.');
      final texto = valor.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
      if (campo == 'titulo' && texto.isEmpty) throw const FormatException('Informe o título.');
      total += texto.length;
      dados[campo] = texto;
    }
    if (total > 20000) throw const FormatException('Material limitado a 20.000 caracteres de texto.');
    T? valor<T>(String campo) => (corpo.containsKey(campo) ? corpo[campo] : anterior?[campo]) as T?;
    final publico = corpo.containsKey('publico') ? corpo['publico'] : anterior?['publico'];
    if (!publicos.containsKey(publico)) throw const FormatException('Público inválido.');
    final duracao = corpo.containsKey('duracaoMinutos') ? corpo['duracaoMinutos'] : anterior?['duracaoMinutos'];
    if (duracao is! int || duracao < 1 || duracao > 480) throw const FormatException('Duração de 1 a 480 minutos.');
    final ministerio = corpo.containsKey('ministerioId') ? corpo['ministerioId'] : anterior?['ministerioId'];
    if (ministerio != null && (ministerio is! String || store.buscar('ministerios', ministerio) == null)) {
      throw const FormatException('Ministério não encontrado no cadastro.');
    }
    final tipo = valor<Object>('tipoId');
    if (tipo != null && (tipo is! String || store.buscar(colecaoTipos, tipo) == null)) {
      throw const FormatException('Tipo de material não encontrado.');
    }
    return {...dados, 'publico': publico, 'duracaoMinutos': duracao, 'ministerioId': ministerio, 'tipoId': tipo};
  }

  Future<Map<String, dynamic>> criarMaterial(Map<String, dynamic> corpo, {required Conta conta}) => _serializar(() async {
        _exigir(conta);
        final dados = _validar(corpo);
        final agora = _agora().toIso8601String();
        final doc = <String, dynamic>{
          ...dados,
          'id': novoId(),
          'versao': 1,
          'arquivado': false,
          'criadoEm': agora,
          'atualizadoEm': agora,
          'usuarioId': conta.id,
          'usuarioNome': conta.nome,
        };
        await store.salvar(colecao, doc);
        return material(doc['id'] as String)!;
      });

  Future<Map<String, dynamic>> editarMaterial(String id, Map<String, dynamic> corpo, {required Conta conta}) =>
      _serializar(() async {
        _exigir(conta);
        final anterior = store.buscar(colecao, id);
        if (anterior == null) throw const NaoEncontrado('Material não encontrado.');
        if (corpo.length == 1 && corpo['arquivado'] == true) return _arquivar(_copia(anterior), conta);
        if (anterior['arquivado'] == true) throw const FormatException('Material arquivado não pode ser editado.');
        if (corpo.isEmpty) throw const FormatException('Informe os campos a editar.');
        final dados = _validar(corpo, anterior: anterior);
        final doc = {
          ..._copia(anterior),
          ...dados,
          'versao': (anterior['versao'] as int) + 1,
          'atualizadoEm': _agora().toIso8601String(),
          'atualizadoPor': conta.id,
        };
        await store.salvar(colecao, doc);
        return material(id)!;
      });

  Future<Map<String, dynamic>> arquivarMaterial(String id, {required Conta conta}) => _serializar(() async {
        _exigir(conta);
        final anterior = store.buscar(colecao, id);
        if (anterior == null) throw const NaoEncontrado('Material não encontrado.');
        return _arquivar(_copia(anterior), conta);
      });

  Future<Map<String, dynamic>> _arquivar(Map<String, dynamic> anterior, Conta conta) async {
    if (anterior['arquivado'] == true) return anterior;
    final doc = {
      ...anterior,
      'arquivado': true,
      'arquivadoEm': _agora().toIso8601String(),
      'arquivadoPor': conta.id,
    };
    await store.salvar(colecao, doc);
    return material(anterior['id'] as String)!;
  }

  /// Substitui o roteiro do encontro pelas versões atuais dos materiais, na ordem dada.
  Future<Map<String, dynamic>> associarAoEncontro(String id, Map<String, dynamic> corpo, {required Conta conta}) =>
      _serializar(() async {
        _exigir(conta);
        final ids = corpo['materiaisIds'];
        if (corpo.length != 1 ||
            ids is! List ||
            ids.length > 20 ||
            ids.any((x) => x is! String || x.isEmpty) ||
            ids.toSet().length != ids.length) {
          throw const FormatException('Informe até 20 materiais distintos na ordem desejada.');
        }
        final atual = store.buscar('encontros', id);
        if (atual == null) throw const NaoEncontrado('Encontro não encontrado.');
        if (atual['estado'] == 'cancelado') throw const FormatException('Encontro cancelado não recebe roteiro.');
        final roteiro = <Map<String, dynamic>>[];
        for (final materialId in ids.cast<String>()) {
          final doc = material(materialId);
          if (doc == null || doc['arquivado'] == true) throw const FormatException('Material inexistente ou arquivado.');
          roteiro.add({
            'materialId': materialId,
            'versao': doc['versao'],
            'conteudoSnapshot': {
              for (final campo in camposSnapshot)
                if (doc[campo] != null) campo: doc[campo],
            },
          });
        }
        final atualizado = <String, dynamic>{
          ...atual,
          'roteiro': roteiro,
          'atualizadoEm': _agora().toIso8601String(),
          'atualizadoPor': conta.id,
        };
        await store.salvar('encontros', atualizado);
        return _copia(atualizado);
      });
}
