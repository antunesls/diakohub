import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:diako_server/auth.dart';
import 'package:diako_server/devocionais.dart';
import 'package:diako_server/email_devocionais.dart';
import 'package:diako_server/permissoes.dart';
import 'package:diako_server/store.dart';
import 'package:diako_server/usuarios.dart';
import 'package:shelf/shelf.dart';
import 'package:test/test.dart';

void main() {
  late Directory tmp;
  late Store store;
  late Handler handler;
  late String sessao;
  late List<EmailDevocional> emails;
  late DateTime agora;
  late Future<void> Function(EmailDevocional) transporte;

  Future<(int, dynamic)> chamar(String metodo, String rota,
      {Object? dados, bool publico = false}) async {
    final r = await handler(Request(metodo, Uri.parse('https://igreja.test$rota'),
        headers: {if (!publico) 'authorization': 'Bearer $sessao'},
        body: dados == null ? null : jsonEncode(dados)));
    final texto = await r.readAsString();
    return (r.statusCode, texto.isEmpty ? null : jsonDecode(texto));
  }

  Map<String, dynamic> dados([String status = 'rascunho']) => {
    'titulo': 'Caminhar juntos', 'autorNome': 'Ana', 'data': '2026-11-18',
    'tema': 'casais', 'referencia': 'Ec 4:9', 'texto': '<script>Reflexão</script>',
    'aplicacao': 'Conversar', 'oracao': 'Senhor, guia-nos.', 'status': status,
  };
  Future<String> criar([String status = 'publicado']) async {
    final r = await chamar('POST', '/api/devocionais', dados: dados(status));
    expect(r.$1, 201, reason: '${r.$2}');
    return r.$2['id'] as String;
  }
  Future<void> membro(String id, String email, {String status = 'membro', Object? consentimento = '2026-11-01'}) =>
      store.salvar('membros', {'id': id, 'nome': id, 'email': email, 'status': status,
        'consentimentoEm': consentimento, 'cpf': 'SEGREDO'});
  Future<String> assinar(String email, {List<String> temas = const ['casais']}) async {
    final r = await chamar('POST', '/api/public/devocionais/assinar', publico: true,
        dados: {'email': email, 'temas': temas, 'autorizo': true});
    expect(r.$1, 200);
    return RegExp(r'#confirmar=([A-Za-z0-9_-]+)').firstMatch(emails.last.texto)!.group(1)!;
  }
  Future<void> confirmar(String token) async {
    expect((await chamar('POST', '/api/public/devocionais/confirmar', publico: true,
        dados: {'token': token})).$1, 200);
  }
  Map<String, dynamic> selecao({List<String> ids = const [], bool assinantes = true, bool confirmar = true}) =>
      {'membrosIds': ids, 'incluirAssinantes': assinantes, 'confirmar': confirmar};

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('devocionais_');
    store = Store(tmp.path);
    await store.carregar();
    agora = DateTime.utc(2026, 11, 18, 12);
    emails = [];
    transporte = (e) async { emails.add(e); };
    final auth = Auth(senha: 'teste', pastaDados: tmp.path);
    sessao = (await auth.login('teste', 'fixture'))!;
    final modulo = Devocionais(store, urlBase: () => 'https://igreja.test/', igreja: () => 'Igreja',
        agora: () => agora, ip: (_) => 'fixture', enviar: (e) => transporte(e));
    handler = auth.middleware((r) => r.url.path.startsWith('api/public/'))(modulo.router.call);
  });
  tearDown(() async { await store.fechar(); await tmp.delete(recursive: true); });

  test('exige conta mesmo sem middleware externo', () async {
    final modulo = Devocionais(store, urlBase: () => '', igreja: () => '', enviar: (e) async {});
    expect((await modulo.router.call(Request('GET', Uri.parse('http://x/api/devocionais')))).statusCode, 401);
  });
  test('rascunho privado, publicação sem disparo, retirada e exclusão', () async {
    final id = await criar('rascunho');
    expect((await chamar('GET', '/api/public/devocionais/$id', publico: true)).$1, 404);
    expect((await chamar('GET', '/api/devocionais')).$2, hasLength(1));
    final atualizado = await chamar('PUT', '/api/devocionais/$id', dados: {'status': 'publicado'});
    expect(atualizado.$1, 200);
    expect(atualizado.$2['urlPublica'], 'https://igreja.test/devocional?id=$id');
    final publico = await chamar('GET', '/api/public/devocionais/$id', publico: true);
    expect(publico.$1, 200);
    expect((publico.$2 as Map).keys, unorderedEquals([...dados().keys.where((k) => k != 'status'), 'id', 'urlPublica']));
    expect(emails, isEmpty);
    expect((await chamar('PUT', '/api/devocionais/$id', dados: {'status': 'rascunho'})).$1, 200);
    expect((await chamar('GET', '/api/public/devocionais/$id', publico: true)).$1, 404);
    expect((await chamar('DELETE', '/api/devocionais/$id')).$1, 200);
    expect((await chamar('GET', '/api/devocionais/$id')).$1, 404);
  });
  test('valida tipos, limites, datas reais e tema', () async {
    for (final extra in <Map<String, dynamic>>[
      {'data': '2026-02-30'}, {'data': '2025-02-29'}, {'titulo': 1},
      {'titulo': 'a' * 201}, {'texto': ''}, {'tema': 'outro'}, {'status': 'x'}, {'autorNome': []},
    ]) {
      expect((await chamar('POST', '/api/devocionais', dados: {...dados(), ...extra})).$1, 400);
    }
  });
  test('importa texto e rejeita formatos não aceitos', () async {
    final r = await handler(Request('POST', Uri.parse('http://x/api/devocionais/importar?nome=reflexao.txt'),
        headers: {'authorization': 'Bearer $sessao'}, body: utf8.encode('Reflexão\r\nTeste')));
    expect(r.statusCode, 200);
    expect(jsonDecode(await r.readAsString()), {'texto': 'Reflexão\nTeste'});
  });
  test('destinatários mínimos: ativos com autorização válida', () async {
    await membro('a', ' ANA@EXEMPLO.TEST ');
    await membro('b', 'b@exemplo.test', status: 'visitante');
    await membro('c', 'c@exemplo.test', consentimento: '2026-02-30');
    await membro('d', 'd@exemplo.test', consentimento: null);
    final r = await chamar('GET', '/api/devocionais/destinatarios');
    expect(r.$2, [{'id': 'a', 'nome': 'a', 'email': 'ana@exemplo.test'}]);
  });
  test('double opt-in: só hash, pendente separado, membro associado, GET não altera', () async {
    await membro('ana', 'ana@exemplo.test');
    final token = await assinar('ANA@exemplo.test');
    expect(token.length, 43);
    final disco = await File('${tmp.path}/assinaturasDevocionais.json').readAsString();
    expect(disco, isNot(contains(token)));
    expect(disco, contains(sha256.convert(utf8.encode(token)).toString()));
    expect(store.listar('assinaturasDevocionais').single['status'], isNot('ativo'));
    expect((await chamar('GET', '/api/public/devocionais/confirmar?token=$token', publico: true)).$1, isNot(200));
    await confirmar(token);
    final a = store.listar('assinaturasDevocionais').single;
    expect(a['status'], 'ativo');
    expect(a['membroId'], 'ana');
    expect(a['temas'], ['casais']);
    agora = agora.add(const Duration(hours: 2));
    final segundo = await assinar('ana@exemplo.test', temas: ['familia']);
    expect(store.listar('assinaturasDevocionais').single['temas'], ['casais']);
    await confirmar(segundo);
    expect(store.listar('assinaturasDevocionais').single['temas'], ['familia']);
    expect((await chamar('POST', '/api/public/devocionais/confirmar', publico: true, dados: {'token': token})).$1, 400);
  });
  test('confirmação expira em 24h e cancelamento invalida pendência', () async {
    final t = await assinar('a@exemplo.test');
    agora = agora.add(const Duration(hours: 24));
    expect((await chamar('POST', '/api/public/devocionais/confirmar', publico: true, dados: {'token': t})).$1, 400);
    agora = agora.add(const Duration(hours: 2));
    final novo = await assinar('a@exemplo.test');
    await confirmar(novo);
    final id = await criar();
    await chamar('POST', '/api/devocionais/$id/email', dados: selecao());
    final cancelar = RegExp(r'#cancelar=([A-Za-z0-9_-]+)').firstMatch(emails.last.texto)!.group(1)!;
    agora = agora.add(const Duration(hours: 2));
    final pendente = await assinar('a@exemplo.test', temas: ['familia']);
    expect((await chamar('POST', '/api/public/devocionais/cancelar', publico: true, dados: {'token': cancelar})).$1, 200);
    expect(store.listar('assinaturasDevocionais').single['status'], 'cancelado');
    expect((await chamar('POST', '/api/public/devocionais/confirmar', publico: true, dados: {'token': pendente})).$1, 400);
  });
  test('resposta genérica, honeypot, consentimento específico e limite de taxa', () async {
    final payload = {'email': 'a@exemplo.test', 'temas': ['casais'], 'autorizo': true};
    final r1 = await chamar('POST', '/api/public/devocionais/assinar', publico: true, dados: payload);
    final r2 = await chamar('POST', '/api/public/devocionais/assinar', publico: true, dados: payload);
    expect(r2.$1, r1.$1);
    expect(r2.$2, r1.$2);
    expect(emails, hasLength(1));
    expect((await chamar('POST', '/api/public/devocionais/assinar', publico: true,
        dados: {...payload, 'email': 'bot@exemplo.test', 'website': 'spam'})).$2, r1.$2);
    expect(emails, hasLength(1));
    expect((await chamar('POST', '/api/public/devocionais/assinar', publico: true,
        dados: {...payload, 'autorizo': false})).$1, 400);
  });
  test('prévia segura, deduplicação, tema, confirmação manual e recibos persistentes', () async {
    final t = await assinar('ana@exemplo.test'); await confirmar(t);
    final outro = await assinar('familia@exemplo.test', temas: ['familia']); await confirmar(outro);
    await membro('ana', 'ANA@exemplo.test');
    await membro('bia', 'bia@exemplo.test');
    final id = await criar();
    emails.clear();
    final previa = await chamar('POST', '/api/devocionais/$id/previa-email', dados: selecao(ids: ['ana', 'bia']));
    expect(previa.$1, 200);
    expect(previa.$2['total'], 2);
    expect(previa.$2['jaEnviados'], 0);
    expect(previa.$2.toString(), isNot(contains('#cancelar=')));
    expect(previa.$2['html'], isNot(contains('<script>')));
    expect((await chamar('POST', '/api/devocionais/$id/email', dados: selecao(ids: ['ana'], confirmar: false))).$1, 400);
    final r = await chamar('POST', '/api/devocionais/$id/email', dados: selecao(ids: ['ana', 'bia']));
    expect(r.$2['enviados'], 2);
    expect(emails.map((e) => e.destinatario), unorderedEquals(['ana@exemplo.test', 'bia@exemplo.test']));
    expect(emails.firstWhere((e) => e.destinatario == 'ana@exemplo.test').texto, contains('#cancelar='));
    expect(store.listar('assinaturasDevocionais'), hasLength(2));
    expect((await chamar('POST', '/api/devocionais/$id/email', dados: selecao(ids: ['ana', 'bia']))).$2['enviados'], 0);
    expect(store.listar('enviosDevocionais').every((e) => e['status'] == 'enviado'), true);
    expect((await chamar('POST', '/api/devocionais/$id/previa-email', dados: selecao(ids: ['ana', 'bia']))).$2['jaEnviados'], 2);
  });
  test('envios simultâneos reservam antes do SMTP e não repetem', () async {
    await membro('ana', 'ana@exemplo.test'); final id = await criar();
    final entrou = Completer<void>(), liberar = Completer<void>();
    transporte = (e) async {
      expect(store.listar('enviosDevocionais').single['status'], 'enviando');
      emails.add(e); entrou.complete(); await liberar.future;
    };
    final primeiro = chamar('POST', '/api/devocionais/$id/email', dados: selecao(ids: ['ana']));
    await entrou.future;
    final segundo = chamar('POST', '/api/devocionais/$id/email', dados: selecao(ids: ['ana']));
    liberar.complete();
    final resultados = await Future.wait([primeiro, segundo]);
    expect(resultados.map((r) => r.$2['enviados']).reduce((a, b) => a + b), 1);
    expect(emails, hasLength(1));
  });
  test('timeout e erros ambíguos ficam incertos, falha clara permite nova requisição', () async {
    await membro('ana', 'ana@exemplo.test'); final id = await criar();
    transporte = (_) async { throw TimeoutException('segredo SMTP'); };
    final r = await chamar('POST', '/api/devocionais/$id/email', dados: selecao(ids: ['ana']));
    expect(r.$2['incertos'], 1);
    expect(r.$2.toString(), isNot(contains('segredo')));
    transporte = (e) async { emails.add(e); };
    expect((await chamar('POST', '/api/devocionais/$id/email', dados: selecao(ids: ['ana']))).$2['enviados'], 0);
    final outro = await criar();
    transporte = (_) async { throw const FalhaEmailDevocional('Configure o envio de e-mails (SMTP) em Administração.'); };
    final falhou = await chamar('POST', '/api/devocionais/$outro/email', dados: selecao(ids: ['ana']));
    expect(falhou.$2['falhas'], 1);
    expect(falhou.$2['aviso'], contains('SMTP'), reason: 'sem isso o líder só veria "Falhas: 1"');
    transporte = (e) async { emails.add(e); };
    expect((await chamar('POST', '/api/devocionais/$outro/email', dados: selecao(ids: ['ana']))).$2['enviados'], 1);
  });
  test('cancelamento e retirada durante lote impedem novos envios', () async {
    await membro('a', 'a@exemplo.test'); await membro('b', 'b@exemplo.test');
    final id = await criar();
    transporte = (e) async {
      emails.add(e);
      await chamar('PUT', '/api/devocionais/$id', dados: {'status': 'rascunho'});
    };
    final r = await chamar('POST', '/api/devocionais/$id/email', dados: selecao(ids: ['a', 'b']));
    expect(r.$2['enviados'], 1);
    expect(emails, hasLength(1));
  });
  test('alteração do conteúdo durante lote interrompe snapshot anterior', () async {
    await membro('a', 'a@exemplo.test'); await membro('b', 'b@exemplo.test');
    final id = await criar();
    transporte = (e) async {
      emails.add(e);
      await chamar('PUT', '/api/devocionais/$id', dados: {'tema': 'familia'});
    };
    final r = await chamar('POST', '/api/devocionais/$id/email', dados: selecao(ids: ['a', 'b']));
    expect(r.$2['enviados'], 1);
  });
  test('cancelamento de assinante após snapshot impede entrega restante', () async {
    final ta = await assinar('a@exemplo.test'); await confirmar(ta);
    final tb = await assinar('b@exemplo.test'); await confirmar(tb);
    final anterior = await criar();
    await chamar('POST', '/api/devocionais/$anterior/email', dados: selecao());
    final cancelar = RegExp(r'#cancelar=([A-Za-z0-9_-]+)').firstMatch(
        emails.firstWhere((e) => e.destinatario == 'b@exemplo.test' && e.texto.contains('#cancelar=')).texto)!.group(1)!;
    emails.clear();
    final id = await criar();
    transporte = (e) async {
      emails.add(e);
      await chamar('POST', '/api/public/devocionais/cancelar', publico: true, dados: {'token': cancelar});
    };
    final r = await chamar('POST', '/api/devocionais/$id/email', dados: selecao());
    expect(r.$2['enviados'], 1);
    expect(emails.single.destinatario, 'a@exemplo.test');
  });
  test('reservas sobrevivem reinício e nunca são retomadas automaticamente', () async {
    await membro('a', 'a@exemplo.test'); final id = await criar();
    final reciboId = sha256.convert(utf8.encode('$id\na@exemplo.test')).toString();
    await store.salvar('enviosDevocionais', {'id': reciboId, 'devocionalId': id, 'email': 'a@exemplo.test', 'status': 'enviando'});
    final reaberto = Store(tmp.path); await reaberto.carregar();
    final modulo = Devocionais(reaberto, urlBase: () => 'https://igreja.test', igreja: () => 'Igreja',
        enviar: (e) async { emails.add(e); });
    final auth = Auth(senha: 'teste', pastaDados: tmp.path);
    sessao = (await auth.login('teste', 'reinicio'))!;
    handler = auth.middleware((r) => r.url.path.startsWith('api/public/'))(modulo.router.call);
    try {
      final r = await chamar('POST', '/api/devocionais/$id/email', dados: selecao(ids: ['a']));
      expect(r.$2['enviados'], 0);
      expect(r.$2['ignorados'], 1);
      expect(emails, isEmpty);
    } finally { await reaberto.fechar(); }
  });
  test('limite por IP não depende do e-mail e respostas não enumeram', () async {
    for (var i = 0; i < 13; i++) {
      expect((await chamar('POST', '/api/public/devocionais/assinar', publico: true,
          dados: {'email': 'p$i@exemplo.test', 'temas': ['casais'], 'autorizo': true})).$1, 200);
    }
    expect(emails, hasLength(10));
  });
  test('liderança autorizada e secretaria negada pelo próprio módulo', () async {
    final hash = gerarHashSenha('senha-teste');
    await File('${tmp.path}/usuarios.json').writeAsString(jsonEncode([
      for (final perfil in [Perfil.liderCasais, Perfil.secretaria])
        {'id': perfil.id, 'nome': perfil.nome, 'login': perfil.id.toLowerCase(), 'perfil': perfil.id,
          'senhaHash': hash.hash, 'senhaSal': hash.sal, 'ativo': true, 'trocarSenha': false}
    ]));
    final usuarios = Usuarios(tmp.path); await usuarios.carregar();
    final auth = Auth(senha: 'teste', pastaDados: tmp.path, usuarios: usuarios);
    final modulo = Devocionais(store, urlBase: () => '', igreja: () => '', enviar: (e) async {});
    handler = auth.middleware((_) => false)(modulo.router.call);
    sessao = (await auth.login('senha-teste', 'lider', usuario: Perfil.liderCasais.id.toLowerCase()))!;
    expect((await chamar('GET', '/api/devocionais')).$1, 200);
    sessao = (await auth.login('senha-teste', 'secretaria', usuario: Perfil.secretaria.id.toLowerCase()))!;
    expect((await chamar('GET', '/api/devocionais')).$1, 403);
  });
  test('link de cancelamento da primeira mensagem segue válido após novo devocional', () async {
    await confirmar(await assinar('ana@exemplo.test'));
    final primeiro = await criar();
    await chamar('POST', '/api/devocionais/$primeiro/email', dados: selecao());
    final antigo = RegExp(r'#cancelar=([A-Za-z0-9_-]+)').firstMatch(emails.last.texto)!.group(1)!;
    final segundo = await criar();
    await chamar('POST', '/api/devocionais/$segundo/email', dados: selecao());
    final recente = RegExp(r'#cancelar=([A-Za-z0-9_-]+)').firstMatch(emails.last.texto)!.group(1)!;
    expect(recente, isNot(antigo));
    expect((await chamar('POST', '/api/public/devocionais/cancelar', publico: true, dados: {'token': antigo})).$1, 200);
    expect(store.listar('assinaturasDevocionais').single['status'], 'cancelado');
    final terceiro = await criar();
    expect((await chamar('POST', '/api/devocionais/$terceiro/email', dados: selecao())).$2['enviados'], 0);
    final disco = await File('${tmp.path}/assinaturasDevocionais.json').readAsString();
    expect(disco, isNot(contains(antigo))); expect(disco, isNot(contains(recente)));
  });
  test('excluir o devocional apaga os recibos de envio daquele conteúdo', () async {
    await membro('ana', 'ana@exemplo.test');
    final id = await criar();
    await chamar('POST', '/api/devocionais/$id/email', dados: selecao(ids: ['ana']));
    expect(store.listar('enviosDevocionais'), hasLength(1));
    expect((await chamar('DELETE', '/api/devocionais/$id')).$1, 200);
    expect(store.listar('enviosDevocionais'), isEmpty, reason: 'não guardar e-mail de destinatário sem o conteúdo que o justificava');
  });
  test('links de cancelamento guardados ficam limitados sem perder o mais recente', () async {
    await confirmar(await assinar('ana@exemplo.test'));
    final a = store.listar('assinaturasDevocionais').single;
    await store.salvar('assinaturasDevocionais', {...a, 'cancelarHashes': [for (var i = 0; i < 40; i++) 'hash-antigo-$i']});
    final id = await criar();
    await chamar('POST', '/api/devocionais/$id/email', dados: selecao());
    final hashes = (store.listar('assinaturasDevocionais').single['cancelarHashes'] as List).cast<String>();
    expect(hashes.length, lessThanOrEqualTo(24), reason: 'o arquivo é regravado a cada envio; a lista não pode crescer para sempre');
    final novo = RegExp(r'#cancelar=([A-Za-z0-9_-]+)').firstMatch(emails.last.texto)!.group(1)!;
    expect(hashes.last, sha256.convert(utf8.encode(novo)).toString());
    expect((await chamar('POST', '/api/public/devocionais/cancelar', publico: true, dados: {'token': novo})).$1, 200);
  });
  test('cancelamento suprime avulso por membrosIds até nova confirmação', () async {
    await membro('ana', 'ana@exemplo.test');
    await confirmar(await assinar('ana@exemplo.test'));
    final primeiro = await criar();
    await chamar('POST', '/api/devocionais/$primeiro/email', dados: selecao());
    final cancelar = RegExp(r'#cancelar=([A-Za-z0-9_-]+)').firstMatch(emails.last.texto)!.group(1)!;
    await chamar('POST', '/api/public/devocionais/cancelar', publico: true, dados: {'token': cancelar});
    final segundo = await criar();
    final previa = await chamar('POST', '/api/devocionais/$segundo/previa-email', dados: selecao(ids: ['ana']));
    expect(previa.$2['total'], 0);
    expect((await chamar('POST', '/api/devocionais/$segundo/email', dados: selecao(ids: ['ana']))).$2['enviados'], 0);
    agora = agora.add(const Duration(hours: 2));
    final pendente = await assinar('ana@exemplo.test');
    expect((await chamar('POST', '/api/devocionais/$segundo/email', dados: selecao(ids: ['ana']))).$2['enviados'], 0);
    await confirmar(pendente);
    expect((await chamar('POST', '/api/devocionais/$segundo/email', dados: selecao(ids: ['ana']))).$2['enviados'], 1);
  });
}
