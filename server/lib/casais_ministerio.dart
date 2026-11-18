import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:diako_core/diako_core.dart';

import 'auth.dart';
import 'casais.dart';
import 'email_casais.dart';
import 'permissoes.dart';
import 'store.dart';

/// Histórico operacional restrito, sem cadastro paralelo de pessoas.
class MinisterioCasais {
  MinisterioCasais(this.store,
      {DateTime Function()? agora,
      String Function()? igreja,
      Future<void> Function(EmailCasais)? enviar})
      : _agora = agora ?? DateTime.now,
        _igreja = igreja ?? (() => 'Igreja'),
        _enviar = enviar;

  final Store store;
  final DateTime Function() _agora;
  final String Function() _igreja;
  final Future<void> Function(EmailCasais)? _enviar;
  final Map<String, ({String hash, String usuarioId, DateTime validade})>
      _previas = {};

  static void _exigir(Conta conta, Permissao permissao) {
    if (!conta.pode(permissao))
      throw StateError('Sem permissão para esta operação de Casais e Família.');
  }

  // O retorno não compartilha listas ou mapas mutáveis com o Store.
  static Map<String, dynamic> _copia(Map<String, dynamic> doc) =>
      jsonDecode(jsonEncode(doc)) as Map<String, dynamic>;

  static String _data(Object? valor) {
    if (valor is! String || !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(valor)) {
      throw const FormatException('Informe uma data válida.');
    }
    final data = DateTime.tryParse(valor);
    if (data == null ||
        data.year < 1900 ||
        data.year > 2200 ||
        diaIso(data) != valor) {
      throw const FormatException('Informe uma data válida.');
    }
    return valor;
  }

  static String _nome(String nome) =>
      semAcento(nome.trim().toLowerCase())!.replaceAll(RegExp(r'\s+'), ' ');

  ({Map<String, dynamic> casal, EmailCasais email}) _mensagem(
      Map<String, dynamic> corpo) {
    const campos = {
      'membrosIds',
      'dataCasamento',
      'conjugeNome',
      'ocorrencia',
      'destinatarioMembroId',
      'texto',
      'previaId',
      'confirmar'
    };
    if (corpo.keys.any((c) => !campos.contains(c)))
      throw const FormatException('Campos inválidos para a mensagem.');
    final ocorrencia = _data(corpo['ocorrencia']);
    final casal = _resolverCasal(corpo, DateTime.parse(ocorrencia).year);
    if (casal['dataAniversario'] != ocorrencia)
      throw const FormatException('Aniversário inválido.');
    final id = corpo['destinatarioMembroId'];
    if (id is! String || !(casal['membrosIds'] as List).contains(id))
      throw const FormatException('Selecione um dos cônjuges cadastrados.');
    final contato = (casal['contatos'] as List)
        .cast<Map>()
        .where((c) => c['membroId'] == id)
        .firstOrNull;
    final email = contato?['email'];
    if (email is! String ||
        !RegExp(r'^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$').hasMatch(email)) {
      throw const FormatException(
          'Destinatário sem e-mail elegível ou sem consentimento vigente.');
    }
    // consentimentoEm é o estado vigente; a última revogação permanece como
    // histórico mesmo depois de a pessoa autorizar novamente.
    final texto = corpo['texto'];
    if (corpo.containsKey('texto') &&
        (texto is! String || texto.trim().isEmpty || texto.length > 10000)) {
      throw const FormatException('Informe mensagem de 1 a 10000 caracteres.');
    }
    return (
      casal: casal,
      email: montarEmailCasais(casal,
          destinatario: email.trim(),
          igreja: _igreja(),
          texto: texto as String?)
    );
  }

  static String _hash(Object valor) =>
      sha256.convert(utf8.encode(jsonEncode(valor))).toString();
  static String _impressao(Map<String, dynamic> casal, EmailCasais email) =>
      _hash([
        casal['casalChave'],
        casal['dataAniversario'],
        email.destinatario,
        email.assunto,
        email.texto,
        email.html
      ]);

  Map<String, dynamic> previaParabens(Map<String, dynamic> corpo,
      {required Conta conta}) {
    _exigir(conta, Permissao.casaisGerenciar);
    final mensagem = _mensagem(corpo);
    final agora = _agora();
    _previas.removeWhere((_, p) => !p.validade.isAfter(agora));
    if (_previas.length >= 500)
      throw StateError('Aguarde antes de preparar novas prévias.');
    final id = novoId();
    _previas[id] = (
      hash: _impressao(mensagem.casal, mensagem.email),
      usuarioId: conta.id,
      validade: agora.add(const Duration(minutes: 15))
    );
    return {
      'previaId': id,
      'destinatario': mensagem.email.destinatario,
      'assunto': mensagem.email.assunto,
      'texto': mensagem.email.texto,
      'html': mensagem.email.html
    };
  }

  Future<Map<String, dynamic>> enviarParabens(Map<String, dynamic> corpo,
      {required Conta conta}) async {
    final reserva = await _serializar(() async {
      _exigir(conta, Permissao.casaisGerenciar);
      if (corpo['confirmar'] != true)
        throw const FormatException(
            'Confirme explicitamente o envio da prévia.');
      final mensagem = _mensagem(corpo);
      final previa = _previas[corpo['previaId']];
      if (previa == null ||
          previa.usuarioId != conta.id ||
          !previa.validade.isAfter(_agora()) ||
          previa.hash != _impressao(mensagem.casal, mensagem.email)) {
        throw const FormatException(
            'A mensagem ou destinatário mudou; revise uma nova prévia.');
      }
      if (_enviar == null)
        throw StateError('Transporte de e-mail indisponível.');
      final hashDestinatario = _hash(mensagem.email.destinatario.toLowerCase());
      final casal = mensagem.casal;
      final duplicado = store.listar('casaisEnvios').any((d) =>
          d['casalChave'] == casal['casalChave'] &&
          d['ocorrencia'] == corpo['ocorrencia'] &&
          d['destinatarioHash'] == hashDestinatario);
      if (duplicado)
        throw StateError(
            'Já existe envio ou tentativa para este destinatário e aniversário. Confira o histórico antes de agir.');
      final doc = <String, dynamic>{
        'id': novoId(),
        'finalidade': 'parabens',
        'membrosIds': casal['membrosIds'],
        'casalChave': casal['casalChave'],
        'ocorrencia': corpo['ocorrencia'],
        'destinatarioHash': hashDestinatario,
        'destinatarioMembroId': corpo['destinatarioMembroId'],
        'estado': 'reservado',
        'registradoEm': _agora().toIso8601String(),
        'usuarioId': conta.id,
        'usuarioNome': conta.nome
      };
      await store.salvar('casaisEnvios', doc);
      _previas.remove(corpo['previaId']);
      return (doc: doc, hash: previa.hash);
    });
    final doc = reserva.doc;
    // Uma limpeza/revogação pode ter entrado na fila durante a gravação da
    // reserva. Revalidar e INICIAR o transporte no lock, mas aguardar fora dele.
    final inicio = await _serializar<
        ({
          Future<String>? transporte,
          Map<String, dynamic>? cancelado
        })>(() async {
      final atual = store.buscar('casaisEnvios', doc['id'] as String);
      if (atual == null)
        return (transporte: null, cancelado: {'estado': 'nao_enviado'});
      EmailCasais email;
      try {
        _exigir(conta, Permissao.casaisGerenciar);
        final mensagem = _mensagem(corpo);
        if (_impressao(mensagem.casal, mensagem.email) != reserva.hash) {
          throw const FormatException('Prévia alterada.');
        }
        email = mensagem.email;
      } catch (_) {
        final cancelado = {
          ...atual,
          'estado': 'nao_enviado',
          'finalizadoEm': _agora().toIso8601String()
        };
        try {
          await store.salvar('casaisEnvios', cancelado);
        } catch (_) {
          // A reserva anterior permanece bloqueando nova tentativa.
        }
        return (transporte: null, cancelado: cancelado);
      }
      final transporte = Future<void>.sync(() => _enviar!(email)).then(
          (_) => 'aceito_smtp',
          onError: (Object _, StackTrace __) => 'incerto');
      return (transporte: transporte, cancelado: null);
    });
    if (inicio.cancelado != null) return _copia(inicio.cancelado!);
    final estado = await inicio.transporte!;
    final resultado = {
      ...doc,
      'estado': estado,
      'finalizadoEm': _agora().toIso8601String()
    };
    try {
      await _serializar(() async {
        final atual = store.buscar('casaisEnvios', doc['id'] as String);
        if (atual != null)
          await store.salvar('casaisEnvios', {
            ...atual,
            'estado': estado,
            'finalizadoEm': resultado['finalizadoEm']
          });
      });
    } catch (_) {
      return {
        ...doc,
        'estado': 'incerto'
      }; // A reserva durável continua impedindo repetição.
    }
    return _copia(resultado);
  }

  Future<T> _serializar<T>(Future<T> Function() operacao) =>
      store.serializarCasais(operacao);

  Map<String, dynamic> consultar(
      {required int mes, required int ano, required Conta conta}) {
    _exigir(conta, Permissao.casais);
    final resultado = consultarCasais(
        [for (final d in store.listar('membros')) Membro.fromJson(d)],
        mes: mes, ano: ano);
    resultado['casais'] =
        (resultado['casais'] as List).cast<Map<String, dynamic>>().map((item) {
      final corpo = {
        'membrosIds': [
          item['membroId'],
          if (item['conjugeId'] != null) item['conjugeId']
        ],
        'dataCasamento': item['dataCasamento'],
        'conjugeNome': item['conjugeNome']
      };
      final casal = _resolverCasal(corpo, ano);
      final historico = store
          .listar('casaisContatos')
          .where((d) => d['casalChave'] == casal['casalChave'])
          .map(_copia)
          .toList()
        ..sort((a, b) => (b['registradoEm'] as String)
            .compareTo(a['registradoEm'] as String));
      final parabens = historico
          .where((d) =>
              d['tipo'] == 'parabenizado' &&
              d['ocorrencia'] == casal['dataAniversario'] &&
              d['anuladoEm'] == null)
          .firstOrNull;
      return {...casal, 'contatosHistory': historico, 'parabenizado': parabens};
    }).toList();
    return resultado;
  }

  List<Map<String, dynamic>> listarContatos(
      {required int mes, required int ano, required Conta conta}) {
    _exigir(conta, Permissao.casais);
    if (mes < 1 || mes > 12 || ano < 1900 || ano > 2200) {
      throw const FormatException(
          'Informe mês de 1 a 12 e ano de 1900 a 2200.');
    }
    final prefixo = '$ano-${mes.toString().padLeft(2, '0')}-';
    final lista = store
        .listar('casaisContatos')
        .where((d) => ((d['ocorrencia'] ?? d['realizadoEm']) as String)
            .startsWith(prefixo))
        .map(_copia)
        .toList();
    lista.sort((a, b) =>
        (b['registradoEm'] as String).compareTo(a['registradoEm'] as String));
    return lista;
  }

  /// O cliente informa os IDs e os dados do vínculo que viu. Tudo é conferido
  /// novamente; nomes iguais não criam vínculos e chave/autoria não vêm do corpo.
  Map<String, dynamic> _resolverCasal(Map<String, dynamic> corpo, int ano) {
    final ids = corpo['membrosIds'];
    if (ids is! List ||
        ids.isEmpty ||
        ids.length > 2 ||
        ids.any((id) => id is! String || id.isEmpty) ||
        ids.toSet().length != ids.length) {
      throw const FormatException('Informe os membros do casal.');
    }
    final ordenados = ids.cast<String>().toList()..sort();
    final casamento = _data(corpo['dataCasamento']);
    final membros = [
      for (final d in store.listar('membros')) Membro.fromJson(d)
    ];
    final casais = consultarCasais(membros,
        mes: DateTime.parse(casamento).month, ano: ano)['casais'] as List;
    for (final item in casais.cast<Map<String, dynamic>>()) {
      final atuais = [
        item['membroId'] as String,
        if (item['conjugeId'] != null) item['conjugeId'] as String
      ]..sort();
      if (jsonEncode(atuais) != jsonEncode(ordenados) ||
          item['dataCasamento'] != casamento) continue;
      String? externo;
      if (atuais.length == 1) {
        final visto = corpo['conjugeNome'];
        externo = _nome(item['conjugeNome'] as String);
        if (visto is! String || _nome(visto) != externo) continue;
      }
      final chave = sha256
          .convert(utf8.encode(jsonEncode([atuais, casamento, externo])))
          .toString();
      return {...item, 'membrosIds': atuais, 'casalChave': chave};
    }
    throw const FormatException(
        'O casal foi alterado ou não está elegível. Atualize a consulta.');
  }

  Future<Map<String, dynamic>> registrarContato(Map<String, dynamic> corpo,
          {required Conta conta}) =>
      _serializar(() async {
        _exigir(conta, Permissao.casaisGerenciar);
        const campos = {
          'membrosIds',
          'dataCasamento',
          'conjugeNome',
          'tipo',
          'ocorrencia',
          'realizadoEm'
        };
        if (corpo.keys.any((c) => !campos.contains(c))) {
          throw const FormatException(
              'Informe apenas os dados operacionais do contato, sem observações pessoais.');
        }
        final tipo = corpo['tipo'];
        if (!{'parabenizado', 'convite_enviado', 'contato_realizado'}
            .contains(tipo)) {
          throw const FormatException('Tipo de contato inválido.');
        }
        final hoje = _agora();
        final realizado = _data(corpo['realizadoEm']);
        if (realizado.compareTo(diaIso(hoje)) > 0)
          throw const FormatException('O contato não pode estar no futuro.');
        String? ocorrencia;
        if (tipo == 'parabenizado') {
          ocorrencia = _data(corpo['ocorrencia']);
        } else if (corpo.containsKey('ocorrencia')) {
          throw const FormatException(
              'Ocorrência é exclusiva dos parabéns de aniversário.');
        }
        final casal = _resolverCasal(corpo,
            ocorrencia == null ? hoje.year : DateTime.parse(ocorrencia).year);
        if (ocorrencia != null && ocorrencia != casal['dataAniversario']) {
          throw const FormatException(
              'A ocorrência não corresponde ao aniversário do casal.');
        }
        if (ocorrencia != null) {
          final anterior = store
              .listar('casaisContatos')
              .where((d) =>
                  d['casalChave'] == casal['casalChave'] &&
                  d['tipo'] == 'parabenizado' &&
                  d['ocorrencia'] == ocorrencia &&
                  d['anuladoEm'] == null)
              .firstOrNull;
          if (anterior != null) return _copia(anterior);
        }
        final doc = <String, dynamic>{
          'id': novoId(),
          'membrosIds': casal['membrosIds'],
          'casalChave': casal['casalChave'],
          'tipo': tipo,
          if (ocorrencia != null) 'ocorrencia': ocorrencia,
          'realizadoEm': realizado,
          'registradoEm': hoje.toIso8601String(),
          'usuarioId': conta.id,
          'usuarioNome': conta.nome,
        };
        await store.salvar('casaisContatos', doc);
        return _copia(doc);
      });

  Future<Map<String, dynamic>> anularContato(String id,
          {required Conta conta}) =>
      _serializar(() async {
        _exigir(conta, Permissao.casaisGerenciar);
        final anterior = store.buscar('casaisContatos', id);
        if (anterior == null)
          throw const FormatException('Contato não encontrado.');
        if (anterior['anuladoEm'] != null) return _copia(anterior);
        final doc = {
          ...anterior,
          'anuladoEm': _agora().toIso8601String(),
          'anuladoPor': conta.id
        };
        await store.salvar('casaisContatos', doc);
        return _copia(doc);
      });
}
