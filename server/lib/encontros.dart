import 'dart:convert';
import 'package:diako_core/diako_core.dart';
import 'auth.dart';
import 'permissoes.dart';
import 'store.dart';

/// Encontros, inscrições, presença e tarefas de qualquer público. Não depende de
/// vínculo de casal; as leituras são protegidas por `encontros` nas rotas.
/// A fila é compartilhada por Store, inclusive entre instâncias deste serviço.
class Encontros {
  Encontros(this.store,
      {DateTime Function()? agora, this.responsavelValido})
      : _agora = agora ?? DateTime.now;
  final Store store;
  final DateTime Function() _agora;
  final bool Function(String id)? responsavelValido;
  Future<T> _alterar<T>(Conta conta, Future<T> Function() operacao) {
    return store.serializarCasais(() {
      if (!conta.pode(Permissao.encontros))
        throw StateError('Sem permissão para gerenciar encontros.');
      return operacao();
    });
  }

  static Map<String, dynamic> _copia(Map doc) =>
      jsonDecode(jsonEncode(doc)) as Map<String, dynamic>;
  static void _campos(Map corpo, Set<String> permitidos) {
    if (corpo.keys.any((k) => !permitidos.contains(k)))
      throw const FormatException(
          'Campo não permitido. Não inclua saúde, documentos ou observações pessoais.');
  }

  static String _texto(dynamic valor, String campo, int limite,
      {bool obrigatorio = false}) {
    if (valor == null && !obrigatorio) return '';
    if (valor is! String ||
        valor.trim().length > limite ||
        (obrigatorio && valor.trim().isEmpty))
      throw FormatException('$campo inválido.');
    return valor.trim();
  }

  static String _data(dynamic valor, {bool hora = false}) {
    if (valor is! String ||
        !RegExp(hora
                ? r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?$'
                : r'^\d{4}-\d{2}-\d{2}$')
            .hasMatch(valor)) throw const FormatException('Data inválida.');
    final local = DateTime.tryParse(valor.substring(0, 10));
    final data = DateTime.tryParse(valor);
    if (data == null ||
        local == null ||
        local.year < 1900 ||
        local.year > 2200 ||
        local.toIso8601String().substring(0, 10) != valor.substring(0, 10) ||
        (hora &&
            (int.parse(valor.substring(11, 13)) > 23 ||
                int.parse(valor.substring(14, 16)) > 59 ||
                (valor.length > 16 &&
                    valor[16] == ':' &&
                    int.parse(valor.substring(17, 19)) > 59))))
      throw const FormatException('Data inválida.');
    return valor;
  }

  Map<String, dynamic> _buscar(String colecao, String id) {
    final doc = store.buscar(colecao, id);
    if (doc == null) throw const FormatException('Registro não encontrado.');
    return _copia(doc);
  }

  Map<String, dynamic> _autoria(Conta conta, {bool novo = false}) => {
        if (novo) ...{
          'criadoEm': _agora().toIso8601String(),
          'usuarioId': conta.id,
          'usuarioNome': conta.nome
        },
        'alteradoEm': _agora().toIso8601String(),
        'alteradoPor': conta.id,
      };
  int _ocupadas(String id) => store
      .listar('inscricoes')
      .where((i) => i['encontroId'] == id && i['estado'] == 'confirmada')
      .fold(0, (n, i) => n + (i['participantes'] as List).length);
  List<Map<String, dynamic>> listarEncontros() {
    final lista = store
        .listar('encontros')
        .map((e) => encontro(e['id'] as String))
        .toList();
    lista.sort((a, b) =>
        DateTime.parse(a['inicio']).compareTo(DateTime.parse(b['inicio'])));
    return lista;
  }

  Map<String, dynamic> encontro(String id) {
    final doc = _buscar('encontros', id);
    final ocupadas = _ocupadas(id);
    return {
      ...doc,
      'vagasOcupadas': ocupadas,
      'vagasDisponiveis': doc['capacidade'] == null
          ? null
          : (doc['capacidade'] as int) - ocupadas
    };
  }

  Map<String, dynamic> _validarEncontro(Map corpo) {
    final titulo = _texto(corpo['titulo'], 'Título', 160, obrigatorio: true);
    if (!{'culto', 'conferencia', 'retiro', 'acampamento', 'jantar', 'palestra', 'treinamento',
          'encontro_familias', 'outro'}
            .contains(corpo['tipo']) ||
        !{'rascunho', 'aberto', 'encerrado', 'cancelado'}
            .contains(corpo['estado']))
      throw const FormatException('Tipo ou estado inválido.');
    final inicio = _data(corpo['inicio'], hora: true),
        fim = _data(corpo['fim'], hora: true);
    if (!DateTime.parse(fim).isAfter(DateTime.parse(inicio)))
      throw const FormatException('Fim deve ser posterior ao início.');
    final capacidade = corpo['capacidade'];
    if (capacidade != null &&
        (capacidade is! int || capacidade < 1 || capacidade > 100000))
      throw const FormatException('Capacidade inválida.');
    return {
      'titulo': titulo,
      'tipo': corpo['tipo'],
      'inicio': inicio,
      'fim': fim,
      'local': _texto(corpo['local'], 'Local', 300),
      'descricao': _texto(corpo['descricao'], 'Descrição', 3000),
      'capacidade': capacidade,
      'estado': corpo['estado']
    };
  }

  static const _camposEncontro = {
    'titulo',
    'tipo',
    'inicio',
    'fim',
    'local',
    'descricao',
    'capacidade',
    'estado'
  };
  Future<Map<String, dynamic>> criarEncontro(Map corpo,
          {required Conta conta}) =>
      _alterar(conta, () async {
        _campos(corpo, _camposEncontro);
        final doc = {
          'id': novoId(),
          ..._validarEncontro({'estado': 'rascunho', ...corpo}),
          ..._autoria(conta, novo: true)
        };
        await store.salvar('encontros', doc);
        return encontro(doc['id'] as String);
      });
  Future<Map<String, dynamic>> editarEncontro(String id, Map corpo,
          {required Conta conta}) =>
      _alterar(conta, () async {
        _campos(corpo, _camposEncontro);
        final antigo = _buscar('encontros', id);
        if (antigo['estado'] == 'cancelado')
          throw const FormatException(
              'Encontro cancelado não pode ser editado.');
        final novo = _validarEncontro({...antigo, ...corpo});
        if (novo['capacidade'] != null && novo['capacidade'] < _ocupadas(id))
          throw const FormatException('Capacidade inferior às vagas ocupadas.');
        final doc = {...antigo, ...novo, ..._autoria(conta)};
        if (novo['estado'] == 'cancelado')
          doc.addAll({
            'canceladoEm': _agora().toIso8601String(),
            'canceladoPor': conta.id
          });
        await store.salvar('encontros', doc);
        return encontro(id);
      });
  Future<Map<String, dynamic>> cancelarEncontro(String id,
          {required Conta conta}) =>
      editarEncontro(id, {'estado': 'cancelado'}, conta: conta);
  List<Map<String, dynamic>> listarInscricoes(String encontroId) {
    _buscar('encontros', encontroId);
    return store
        .listar('inscricoes')
        .where((i) => i['encontroId'] == encontroId)
        .map(_copia)
        .map((i) {
      for (final p in i['participantes'] as List) {
        if (p['membroId'] != null)
          p['nome'] = store.buscar('membros', p['membroId'])?['nome'] ??
              'Membro removido';
      }
      return i;
    }).toList();
  }

  String _chave(Map p, String responsavel) => p['membroId'] != null
      ? 'm:${p['membroId']}'
      : 'n:$responsavel:${semAcento((p['nomeAcompanhante'] as String).toLowerCase())!.replaceAll(RegExp(r'\s+'), ' ')}';
  Future<Map<String, dynamic>> inscrever(String encontroId, Map corpo,
          {required Conta conta}) =>
      _alterar(conta, () async {
        _campos(corpo, {'responsavelMembroId', 'participantes'});
        final e = _buscar('encontros', encontroId);
        if (e['estado'] != 'aberto')
          throw const FormatException(
              'Encontro não está aberto para inscrições.');
        final responsavel = _texto(
            corpo['responsavelMembroId'], 'Responsável', 200,
            obrigatorio: true);
        _buscar('membros', responsavel);
        final pessoas = corpo['participantes'];
        if (pessoas is! List || pessoas.isEmpty || pessoas.length > 100)
          throw const FormatException('Informe de 1 a 100 participantes.');
        final chaves = <String>{};
        for (final i in listarInscricoes(encontroId)
            .where((i) => i['estado'] == 'confirmada')) {
          for (final p in i['participantes'] as List) {
            chaves.add(_chave(p as Map, i['responsavelMembroId'] as String));
          }
        }
        final participantes = <Map<String, dynamic>>[];
        for (final pessoa in pessoas) {
          if (pessoa is! Map)
            throw const FormatException('Participante inválido.');
          _campos(pessoa,
              {'membroId', 'nomeAcompanhante', 'crianca', 'confirmado'});
          if ((pessoa['membroId'] != null) ==
              (pessoa['nomeAcompanhante'] != null))
            throw const FormatException(
                'Selecione um membro ou informe um acompanhante.');
          final p = <String, dynamic>{'id': novoId()};
          if (pessoa['membroId'] != null) {
            final id =
                _texto(pessoa['membroId'], 'Membro', 200, obrigatorio: true);
            _buscar('membros', id);
            p['membroId'] = id;
          } else {
            p['nomeAcompanhante'] = _texto(
                pessoa['nomeAcompanhante'], 'Nome do acompanhante', 160,
                obrigatorio: true);
          }
          for (final chave in ['crianca', 'confirmado']) {
            if (pessoa.containsKey(chave) && pessoa[chave] is! bool)
              throw const FormatException('Confirmação deve ser booleana.');
            p[chave] = pessoa[chave] ?? false;
          }
          if (!chaves.add(_chave(p, responsavel)))
            throw const FormatException(
                'Participante já inscrito ou duplicado.');
          participantes.add(p);
        }
        if (e['capacidade'] != null &&
            _ocupadas(encontroId) + participantes.length > e['capacidade'])
          throw const FormatException('Não há vagas suficientes.');
        final doc = {
          'id': novoId(),
          'encontroId': encontroId,
          'responsavelMembroId': responsavel,
          'participantes': participantes,
          'estado': 'confirmada',
          ..._autoria(conta, novo: true)
        };
        await store.salvar('inscricoes', doc);
        return _copia(doc);
      });
  Future<Map<String, dynamic>> cancelarInscricao(String id,
          {required Conta conta}) =>
      _alterar(conta, () async {
        final doc = _buscar('inscricoes', id);
        if (doc['estado'] == 'cancelada') return doc;
        doc.addAll({
          'estado': 'cancelada',
          'canceladoEm': _agora().toIso8601String(),
          'canceladoPor': conta.id,
          ..._autoria(conta)
        });
        await store.salvar('inscricoes', doc);
        return _copia(doc);
      });
  Future<Map<String, dynamic>> registrarPresenca(
          String inscricaoId, String participanteId, Map corpo,
          {required Conta conta}) =>
      _alterar(conta, () async {
        _campos(corpo, {'presente', 'confirmado'});
        if (corpo.isEmpty || corpo.values.any((v) => v is! bool))
          throw const FormatException(
              'Informe presença ou confirmação booleana.');
        final i = _buscar('inscricoes', inscricaoId),
            e = _buscar('encontros',
                _buscar('inscricoes', inscricaoId)['encontroId']);
        if (i['estado'] != 'confirmada' ||
            !{'aberto', 'encerrado'}.contains(e['estado']))
          throw const FormatException(
              'Inscrição ou encontro não permite presença.');
        final p = (i['participantes'] as List)
            .where((p) => p['id'] == participanteId)
            .firstOrNull;
        if (p == null)
          throw const FormatException('Participante não encontrado.');
        if (corpo.containsKey('confirmado'))
          p['confirmado'] = corpo['confirmado'];
        if (corpo['presente'] == true && p['confirmado'] != true)
          throw const FormatException(
              'Confirme o participante antes do check-in.');
        if (corpo.containsKey('presente') || p['confirmado'] == false) {
          p['presenteEm'] =
              corpo['presente'] == true ? _agora().toIso8601String() : null;
          p['presencaPor'] = corpo['presente'] == true ? conta.id : null;
          p['presencaPorNome'] = corpo['presente'] == true ? conta.nome : null;
          p['presencaAlteradaEm'] = _agora().toIso8601String();
          p['presencaAlteradaPor'] = conta.id;
        }
        i.addAll(_autoria(conta));
        await store.salvar('inscricoes', i);
        return _copia(i);
      });
  List<Map<String, dynamic>> listarTarefas(String encontroId) {
    _buscar('encontros', encontroId);
    return store
        .listar('tarefasEncontros')
        .where((t) => t['encontroId'] == encontroId)
        .map(_copia)
        .toList();
  }

  Map<String, dynamic> _validarTarefa(Map corpo) {
    final responsavel = corpo['responsavelUsuarioId'];
    if (responsavel != null &&
        (responsavel is! String ||
            responsavelValido?.call(responsavel) != true))
      throw const FormatException(
          'Responsável deve ser usuário ativo autorizado do ministério.');
    final estado = corpo['estado'] ?? 'pendente';
    if (!{'pendente', 'concluida', 'cancelada'}.contains(estado))
      throw const FormatException('Estado de tarefa inválido.');
    return {
      'descricao':
          _texto(corpo['descricao'], 'Descrição', 1000, obrigatorio: true),
      'responsavelUsuarioId': responsavel,
      'prazo': corpo['prazo'] == null ? null : _data(corpo['prazo']),
      'estado': estado
    };
  }

  static const _camposTarefa = {
    'descricao',
    'responsavelUsuarioId',
    'prazo',
    'estado'
  };
  Future<Map<String, dynamic>> criarTarefa(String encontroId, Map corpo,
          {required Conta conta}) =>
      _alterar(conta, () async {
        _campos(corpo, _camposTarefa);
        final e = _buscar('encontros', encontroId);
        if (e['estado'] == 'cancelado')
          throw const FormatException('Encontro cancelado.');
        final doc = {
          'id': novoId(),
          'encontroId': encontroId,
          ..._validarTarefa(corpo),
          ..._autoria(conta, novo: true)
        };
        await store.salvar('tarefasEncontros', doc);
        return _copia(doc);
      });
  Future<Map<String, dynamic>> editarTarefa(String id, Map corpo,
          {required Conta conta}) =>
      _alterar(conta, () async {
        _campos(corpo, _camposTarefa);
        final antigo = _buscar('tarefasEncontros', id);
        final doc = {
          ...antigo,
          ..._validarTarefa({...antigo, ...corpo}),
          ..._autoria(conta)
        };
        await store.salvar('tarefasEncontros', doc);
        return _copia(doc);
      });
}
