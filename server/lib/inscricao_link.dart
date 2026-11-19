import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';

import 'auth.dart';
import 'permissoes.dart';
import 'store.dart';

/// Texto do aceite mostrado na página pública (guardado com a versão em cada inscrição).
const textoConsentimentoInscricao =
    'Autorizo a igreja a usar o meu nome, WhatsApp e e-mail (e os nomes dos meus acompanhantes) '
    'somente para organizar este encontro e falar comigo sobre ele.';
const versaoConsentimentoInscricao = 1;

/// Inscrições em encontros por um link público (`/inscricao/<código>`).
///
/// O encontro guarda `linkInscricao` = {ativo, codigo, ate?, pergunta?}. A inscrição pelo link
/// vale na hora (estado "confirmada") enquanto houver vagas; sem vagas, entra na lista de espera
/// (estado "espera", que não ocupa vaga) e a equipe confirma pelo painel. O formulário não consulta
/// o cadastro de membros: a pessoa entra como "pelo link" e a equipe pode vinculá-la depois.
/// O link de cancelamento enviado por e-mail é um token aleatório; só o hash fica salvo.
class InscricoesPeloLink {
  InscricoesPeloLink(this.store, {DateTime Function()? agora, Random? aleatorio})
      : _agora = agora ?? DateTime.now,
        _aleatorio = aleatorio ?? Random.secure();

  final Store store;
  final DateTime Function() _agora;
  final Random _aleatorio;

  static Map<String, dynamic> _copia(Map doc) => jsonDecode(jsonEncode(doc)) as Map<String, dynamic>;
  static String hash(String token) => sha256.convert(utf8.encode(token)).toString();

  String _token(int bytes) =>
      base64Url.encode(List<int>.generate(bytes, (_) => _aleatorio.nextInt(256))).replaceAll('=', '');

  Future<T> _serializar<T>(Future<T> Function() acao) => store.serializarCasais(acao);

  static String? _texto(Object? valor, String campo, int limite, {bool obrigatorio = false}) {
    if (valor == null || (valor is String && valor.trim().isEmpty)) {
      if (obrigatorio) throw FormatException('Informe $campo.');
      return null;
    }
    if (valor is! String || valor.trim().length > limite) throw FormatException('$campo inválido.');
    return valor.trim().replaceAll(RegExp(r'\s+'), ' ');
  }

  /// Só dígitos; aceita com ou sem 55. Guarda com DDD (10 ou 11 dígitos) e o 55 na frente.
  static String whatsapp(Object? valor) {
    final digitos = (valor is String ? valor : '').replaceAll(RegExp(r'\D'), '');
    final nacional = digitos.length >= 12 && digitos.startsWith('55') ? digitos.substring(2) : digitos;
    if (nacional.length != 10 && nacional.length != 11) {
      throw const FormatException('Informe o WhatsApp com DDD.');
    }
    return '55$nacional';
  }

  static String? _email(Object? valor) {
    final email = _texto(valor, 'o e-mail', 160);
    if (email == null) return null;
    if (!RegExp(r'^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$').hasMatch(email)) {
      throw const FormatException('E-mail inválido.');
    }
    return email.toLowerCase();
  }

  int _ocupadas(String encontroId) => store
      .listar('inscricoes')
      .where((i) => i['encontroId'] == encontroId && i['estado'] == 'confirmada')
      .fold(0, (n, i) => n + (i['participantes'] as List).length);

  // ---------- Equipe (painel) ----------

  /// Liga/desliga o link, define a data limite e a pergunta; `novoCodigo: true` invalida o link antigo.
  Future<Map<String, dynamic>> configurar(String encontroId, Map<String, dynamic> corpo, {required Conta conta}) =>
      _serializar(() async {
        if (!conta.pode(Permissao.encontros)) throw StateError('Sem permissão para gerenciar encontros.');
        if (corpo.keys.any((k) => !{'ativo', 'ate', 'pergunta', 'novoCodigo'}.contains(k))) {
          throw const FormatException('Campo não permitido.');
        }
        final encontro = store.buscar('encontros', encontroId);
        if (encontro == null) throw const NaoEncontrado('Encontro não encontrado.');
        final atual = Map<String, dynamic>.from((encontro['linkInscricao'] as Map?) ?? {});
        final ativo = corpo.containsKey('ativo') ? corpo['ativo'] : (atual['ativo'] ?? false);
        if (ativo is! bool) throw const FormatException('Informe se o link está ativo.');
        if (ativo && encontro['estado'] == 'cancelado') throw const FormatException('Encontro cancelado não recebe inscrições.');
        Object? ate = corpo.containsKey('ate') ? corpo['ate'] : atual['ate'];
        if (ate == '') ate = null;
        if (ate != null) {
          if (ate is! String || !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(ate) || DateTime.tryParse(ate) == null) {
            throw const FormatException('Data limite inválida.');
          }
        }
        final pergunta = _texto(corpo.containsKey('pergunta') ? corpo['pergunta'] : atual['pergunta'], 'a pergunta', 200);
        final novo = <String, dynamic>{
          'ativo': ativo,
          'codigo': corpo['novoCodigo'] == true || atual['codigo'] == null ? _token(12) : atual['codigo'],
          if (ate != null) 'ate': ate,
          if (pergunta != null) 'pergunta': pergunta,
        };
        await store.salvar('encontros', {
          ...encontro,
          'linkInscricao': novo,
          'alteradoEm': _agora().toIso8601String(),
          'alteradoPor': conta.id,
        });
        return novo;
      });

  /// Confirma uma inscrição da lista de espera, se couber nas vagas.
  Future<Map<String, dynamic>> promover(String inscricaoId, {required Conta conta}) => _serializar(() async {
        if (!conta.pode(Permissao.encontros)) throw StateError('Sem permissão para gerenciar encontros.');
        final inscricao = store.buscar('inscricoes', inscricaoId);
        if (inscricao == null) throw const NaoEncontrado('Inscrição não encontrada.');
        if (inscricao['estado'] != 'espera') throw const FormatException('A inscrição não está na lista de espera.');
        final encontro = store.buscar('encontros', inscricao['encontroId'] as String)!;
        if (encontro['estado'] == 'cancelado') throw const FormatException('Encontro cancelado.');
        final capacidade = encontro['capacidade'];
        final total = (inscricao['participantes'] as List).length;
        if (capacidade is int && _ocupadas(encontro['id'] as String) + total > capacidade) {
          throw FormatException('Não há vagas para $total ${total == 1 ? 'pessoa' : 'pessoas'}. '
              'Aumente as vagas do encontro ou cancele outra inscrição.');
        }
        final doc = {
          ..._copia(inscricao),
          'estado': 'confirmada',
          'confirmadaEm': _agora().toIso8601String(),
          'alteradoEm': _agora().toIso8601String(),
          'alteradoPor': conta.id,
        };
        await store.salvar('inscricoes', doc);
        return _copia(doc);
      });

  /// Liga a pessoa que se inscreveu pelo link ao cadastro de membros.
  Future<Map<String, dynamic>> vincular(String inscricaoId, Map<String, dynamic> corpo, {required Conta conta}) =>
      _serializar(() async {
        if (!conta.pode(Permissao.encontros)) throw StateError('Sem permissão para gerenciar encontros.');
        final inscricao = store.buscar('inscricoes', inscricaoId);
        if (inscricao == null) throw const NaoEncontrado('Inscrição não encontrada.');
        if (inscricao['origem'] != 'link') throw const FormatException('Só inscrições feitas pelo link são vinculadas.');
        final membroId = corpo['membroId'];
        if (corpo.length != 1 || membroId is! String || store.buscar('membros', membroId) == null) {
          throw const FormatException('Membro não encontrado no cadastro.');
        }
        final jaInscrito = store.listar('inscricoes').any((i) =>
            i['id'] != inscricaoId &&
            i['encontroId'] == inscricao['encontroId'] &&
            i['estado'] != 'cancelada' &&
            (i['participantes'] as List).any((p) => p['membroId'] == membroId));
        if (jaInscrito) throw const FormatException('Esse membro já tem outra inscrição neste encontro.');
        final participantes = [
          for (final p in (inscricao['participantes'] as List).cast<Map>())
            if (p['titular'] == true)
              {for (final e in p.entries) if (e.key != 'nomeAcompanhante') e.key: e.value, 'membroId': membroId}
            else
              Map<String, dynamic>.from(p),
        ];
        final doc = {
          ..._copia(inscricao),
          'responsavelMembroId': membroId,
          'participantes': participantes,
          'alteradoEm': _agora().toIso8601String(),
          'alteradoPor': conta.id,
        };
        await store.salvar('inscricoes', doc);
        return _copia(doc);
      });

  // ---------- Público ----------

  Map<String, dynamic>? _encontroDoCodigo(String codigo) => store
      .listar('encontros')
      .where((e) => (e['linkInscricao'] as Map?)?['codigo'] == codigo && codigo.length >= 12)
      .firstOrNull;

  /// O link aceita inscrições? (link ativo, encontro aberto, antes da data limite e do início).
  String? _motivoFechado(Map<String, dynamic> e) {
    final link = (e['linkInscricao'] as Map?) ?? {};
    if (link['ativo'] != true || e['estado'] == 'rascunho') return 'As inscrições por este link não estão abertas.';
    if (e['estado'] == 'cancelado') return 'Este encontro foi cancelado.';
    if (e['estado'] != 'aberto') return 'As inscrições deste encontro foram encerradas.';
    final agora = _agora();
    final hoje = '${agora.year.toString().padLeft(4, '0')}-${agora.month.toString().padLeft(2, '0')}-${agora.day.toString().padLeft(2, '0')}';
    if (link['ate'] is String && hoje.compareTo(link['ate'] as String) > 0) return 'O prazo de inscrição terminou.';
    if (!agora.isBefore(DateTime.parse(e['inicio'] as String))) return 'O encontro já começou.';
    return null;
  }

  /// Só o que a página pública precisa: nada de inscritos, autoria ou ids internos.
  Map<String, dynamic> info(String codigo) {
    final e = _encontroDoCodigo(codigo);
    if (e == null) throw const NaoEncontrado('Link de inscrição não encontrado.');
    final capacidade = e['capacidade'];
    final restantes = capacidade is int ? max(0, capacidade - _ocupadas(e['id'] as String)) : null;
    final fechado = _motivoFechado(e);
    return {
      'titulo': e['titulo'],
      'tipo': e['tipo'],
      'inicio': e['inicio'],
      'fim': e['fim'],
      'local': e['local'] ?? '',
      'descricao': e['descricao'] ?? '',
      'vagasRestantes': restantes,
      'aberto': fechado == null,
      if (fechado != null) 'motivo': fechado,
      if ((e['linkInscricao'] as Map)['ate'] != null) 'ate': (e['linkInscricao'] as Map)['ate'],
      if ((e['linkInscricao'] as Map)['pergunta'] != null) 'pergunta': (e['linkInscricao'] as Map)['pergunta'],
      'consentimento': textoConsentimentoInscricao,
    };
  }

  /// Inscreve pelo link. Devolve a inscrição salva e o token de cancelamento (só existe aqui:
  /// vai no e-mail; o banco guarda o hash).
  Future<({Map<String, dynamic> inscricao, Map<String, dynamic> encontro, String token})> inscrever(
          String codigo, Map<String, dynamic> corpo) =>
      _serializar(() async {
        const permitidos = {'nome', 'whatsapp', 'email', 'acompanhantes', 'resposta', 'consentimento', 'website'};
        if (corpo.keys.any((k) => !permitidos.contains(k))) throw const FormatException('Campo não permitido.');
        final e = _encontroDoCodigo(codigo);
        if (e == null) throw const NaoEncontrado('Link de inscrição não encontrado.');
        final fechado = _motivoFechado(e);
        if (fechado != null) throw FormatException(fechado);
        if (corpo['consentimento'] != true) throw const FormatException('Marque a autorização de uso dos dados.');
        final nome = _texto(corpo['nome'], 'o seu nome', 120, obrigatorio: true)!;
        final zap = whatsapp(corpo['whatsapp']);
        final email = _email(corpo['email']);
        final link = e['linkInscricao'] as Map;
        final resposta = link['pergunta'] == null ? null : _texto(corpo['resposta'], 'a resposta', 500);
        final lista = corpo['acompanhantes'] ?? const [];
        if (lista is! List || lista.length > 20) throw const FormatException('Informe até 20 acompanhantes.');
        final acompanhantes = <Map<String, dynamic>>[];
        for (final a in lista) {
          if (a is! Map || a.keys.any((k) => !{'nome', 'crianca'}.contains(k))) {
            throw const FormatException('Acompanhante inválido.');
          }
          final crianca = a['crianca'] ?? false;
          if (crianca is! bool) throw const FormatException('Acompanhante inválido.');
          acompanhantes.add({
            'id': novoId(),
            'nomeAcompanhante': _texto(a['nome'], 'o nome do acompanhante', 120, obrigatorio: true),
            'crianca': crianca,
            'confirmado': true,
          });
        }
        final duplicada = store.listar('inscricoes').any((i) =>
            i['encontroId'] == e['id'] && i['estado'] != 'cancelada' && i['whatsapp'] == zap);
        if (duplicada) {
          throw const FormatException('Já existe uma inscrição com este WhatsApp neste encontro. '
              'Para mudar, cancele pelo link do e-mail ou fale com a equipe.');
        }
        final participantes = [
          {'id': novoId(), 'nomeAcompanhante': nome, 'crianca': false, 'confirmado': true, 'titular': true},
          ...acompanhantes,
        ];
        final capacidade = e['capacidade'];
        final cabe = capacidade is! int || _ocupadas(e['id'] as String) + participantes.length <= capacidade;
        final token = _token(24);
        final agora = _agora().toIso8601String();
        final doc = <String, dynamic>{
          'id': novoId(),
          'encontroId': e['id'],
          'origem': 'link',
          'responsavelMembroId': null,
          'responsavelNome': nome,
          'whatsapp': zap,
          if (email != null) 'email': email,
          if (resposta != null) 'resposta': resposta,
          'participantes': participantes,
          'estado': cabe ? 'confirmada' : 'espera',
          'consentimentoEm': agora,
          'consentimentoVersao': versaoConsentimentoInscricao,
          'cancelamentoHash': hash(token),
          'criadoEm': agora,
          'usuarioId': 'link',
          'usuarioNome': 'Inscrição pelo link',
          'alteradoEm': agora,
          'alteradoPor': 'link',
        };
        await store.salvar('inscricoes', doc);
        return (inscricao: _copia(doc), encontro: _copia(e), token: token);
      });

  Map<String, dynamic>? _porToken(Object? token) {
    if (token is! String || token.length < 20 || token.length > 100) return null;
    final h = hash(token);
    return store.listar('inscricoes').where((i) => i['cancelamentoHash'] == h).firstOrNull;
  }

  /// O que a pessoa vê ao abrir o link do e-mail.
  Map<String, dynamic> consultar(Object? token) {
    final i = _porToken(token);
    if (i == null) throw const NaoEncontrado('Inscrição não encontrada. O link pode estar incompleto.');
    final e = store.buscar('encontros', i['encontroId'] as String);
    return {
      'titulo': e?['titulo'] ?? 'Encontro',
      'inicio': e?['inicio'],
      'local': e?['local'] ?? '',
      'nome': i['responsavelNome'],
      'pessoas': (i['participantes'] as List).length,
      'estado': i['estado'],
    };
  }

  Future<Map<String, dynamic>> cancelar(Object? token) => _serializar(() async {
        final i = _porToken(token);
        if (i == null) throw const NaoEncontrado('Inscrição não encontrada. O link pode estar incompleto.');
        if (i['estado'] != 'cancelada') {
          final agora = _agora().toIso8601String();
          await store.salvar('inscricoes', {
            ...i,
            'estado': 'cancelada',
            'canceladoEm': agora,
            'canceladoPor': 'link',
            'alteradoEm': agora,
            'alteradoPor': 'link',
          });
        }
        return consultar(token);
      });
}
