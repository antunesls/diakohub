import 'dart:convert';

import 'auth.dart';
import 'permissoes.dart';
import 'store.dart';

/// Biblioteca interna. Conteúdo histórico pertence ao roteiro, não à versão atual.
class CasaisMateriais {
  CasaisMateriais(this.store, {DateTime Function()? agora})
      : _agora = agora ?? DateTime.now;

  final Store store;
  final DateTime Function() _agora;
  static const _textos = {
    'titulo',
    'objetivo',
    'referenciasBiblicas',
    'preparacao',
    'passos',
    'perguntas'
  };
  static const _campos = {..._textos, 'publico', 'duracaoMinutos'};

  static Map<String, dynamic> _copia(Map<String, dynamic> d) =>
      jsonDecode(jsonEncode(d)) as Map<String, dynamic>;
  static void _exigir(Conta conta) {
    if (!conta.pode(Permissao.casaisGerenciar))
      throw StateError('Sem permissão para gerenciar materiais.');
  }

  Future<T> _serializar<T>(Future<T> Function() acao) =>
      store.serializarCasais(acao);

  List<Map<String, dynamic>> listarMateriais({bool arquivados = false}) {
    final lista = store
        .listar('casaisMateriais')
        .where((d) => arquivados || d['arquivado'] != true)
        .map(_copia)
        .toList();
    lista.sort(
        (a, b) => (a['titulo'] as String).compareTo(b['titulo'] as String));
    return lista;
  }

  Map<String, dynamic>? material(String id) {
    final doc = store.buscar('casaisMateriais', id);
    return doc == null ? null : _copia(doc);
  }

  static Map<String, dynamic> _validar(Map<String, dynamic> corpo,
      {Map<String, dynamic>? anterior}) {
    if (corpo.keys.any((k) => !_campos.contains(k)))
      throw const FormatException('Campo de material não permitido.');
    final dados = <String, dynamic>{};
    var total = 0;
    for (final campo in _textos) {
      final valor =
          corpo.containsKey(campo) ? corpo[campo] : anterior?[campo] ?? '';
      if (valor is! String) throw FormatException('Informe texto em $campo.');
      final texto =
          valor.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
      if (campo == 'titulo' && texto.isEmpty)
        throw const FormatException('Informe o título.');
      total += texto.length;
      dados[campo] = texto;
    }
    if (total > 20000)
      throw const FormatException(
          'Material limitado a 20.000 caracteres de texto.');
    final publico =
        corpo.containsKey('publico') ? corpo['publico'] : anterior?['publico'];
    if (!{'casais', 'familia', 'ambos'}.contains(publico))
      throw const FormatException('Público inválido.');
    final duracao = corpo.containsKey('duracaoMinutos')
        ? corpo['duracaoMinutos']
        : anterior?['duracaoMinutos'];
    if (duracao is! int || duracao < 1 || duracao > 480)
      throw const FormatException('Duração de 1 a 480 minutos.');
    return {...dados, 'publico': publico, 'duracaoMinutos': duracao};
  }

  Future<Map<String, dynamic>> criarMaterial(Map<String, dynamic> corpo,
          {required Conta conta}) =>
      _serializar(() async {
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
          'usuarioNome': conta.nome
        };
        await store.salvar('casaisMateriais', doc);
        return _copia(doc);
      });

  Future<Map<String, dynamic>> editarMaterial(
          String id, Map<String, dynamic> corpo,
          {required Conta conta}) =>
      _serializar(() async {
        _exigir(conta);
        final anterior = material(id);
        if (anterior == null) throw StateError('Material não encontrado.');
        if (corpo.length == 1 && corpo['arquivado'] == true)
          return _arquivar(anterior, conta);
        if (anterior['arquivado'] == true)
          throw const FormatException(
              'Material arquivado não pode ser editado.');
        final dados = _validar(corpo, anterior: anterior);
        if (corpo.isEmpty)
          throw const FormatException('Informe os campos a editar.');
        final doc = {
          ...anterior,
          ...dados,
          'versao': (anterior['versao'] as int) + 1,
          'atualizadoEm': _agora().toIso8601String(),
          'atualizadoPor': conta.id
        };
        await store.salvar('casaisMateriais', doc);
        return _copia(doc);
      });

  Future<Map<String, dynamic>> _arquivar(
      Map<String, dynamic> anterior, Conta conta) async {
    if (anterior['arquivado'] == true) return _copia(anterior);
    final doc = {
      ...anterior,
      'arquivado': true,
      'arquivadoEm': _agora().toIso8601String(),
      'arquivadoPor': conta.id
    };
    await store.salvar('casaisMateriais', doc);
    return _copia(doc);
  }

  Future<Map<String, dynamic>> arquivarMaterial(String id,
          {required Conta conta}) =>
      _serializar(() async {
        _exigir(conta);
        final anterior = material(id);
        if (anterior == null) throw StateError('Material não encontrado.');
        return _arquivar(anterior, conta);
      });

  Future<Map<String, dynamic>> associarAoEncontro(
          String id, Map<String, dynamic> corpo,
          {required Conta conta}) =>
      _serializar(() async {
        _exigir(conta);
        if (!conta.pode(Permissao.encontros))
          throw StateError('Sem permissão para alterar o roteiro de encontros.');
        final ids = corpo['materiaisIds'];
        if (corpo.length != 1 ||
            ids is! List ||
            ids.length > 20 ||
            ids.any((x) => x is! String || x.isEmpty) ||
            ids.toSet().length != ids.length) {
          throw const FormatException(
              'Informe até 20 materiais distintos na ordem desejada.');
        }
        final roteiro = <Map<String, dynamic>>[];
        for (final materialId in ids.cast<String>()) {
          final doc = material(materialId);
          if (doc == null || doc['arquivado'] == true)
            throw const FormatException('Material inexistente ou arquivado.');
          roteiro.add({
            'materialId': materialId,
            'versao': doc['versao'],
            'conteudoSnapshot': {for (final campo in _campos) campo: doc[campo]}
          });
        }
        // Leitura e gravação protegidas pela mesma fila usada pelo domínio de encontros.
        final atual = store.buscar('encontros', id);
        if (atual == null) throw StateError('Encontro não encontrado.');
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
