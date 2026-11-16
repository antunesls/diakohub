import 'dart:convert';
import 'dart:io';

import 'package:diako_news/data/conta_repo.dart';
import 'package:diako_news/sync/server_api.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  late Directory tmp;
  setUp(() async => tmp = await Directory.systemTemp.createTemp('diako_conta_app'));
  tearDown(() => tmp.delete(recursive: true));

  ServerApi api(http.Response Function(http.Request) resposta) =>
      ServerApi(() => const ServidorConfig(base: 'http://srv:8080', sessao: 's'),
          httpClient: MockClient((req) async => resposta(req)));

  http.Response json(Object corpo, [int status = 200]) => http.Response.bytes(utf8.encode(jsonEncode(corpo)), status);

  test('perfil do servidor, guardado para abrir sem conexão', () async {
    var foraDoAr = false;
    final servidor = api((req) {
      if (foraDoAr) throw const SocketException('sem rede');
      expect(req.url.path, '/api/eu');
      return json({'nome': 'Tablet do culto', 'perfilNome': 'Telão (tablet)', 'permissoes': ['recados', 'projetar', 'motivosVer']});
    });
    final conta = ContaRepo(api: servidor, cache: () async => File('${tmp.path}/conta.json'));
    expect(conta.pode('mensagens'), isTrue); // antes de saber: tudo liberado (o servidor recusa)
    await conta.sincronizar();
    expect(conta.nome, 'Tablet do culto');
    expect(conta.pode('projetar'), isTrue);
    expect(conta.pode('mensagens'), isFalse);
    expect(conta.pode('motivosEditar'), isFalse);

    foraDoAr = true;
    final outra = ContaRepo(api: servidor, cache: () async => File('${tmp.path}/conta.json'));
    await outra.carregar();
    await outra.sincronizar(); // sem conexão: mantém o cache
    expect(outra.pode('mensagens'), isFalse);
    expect(outra.perfil, 'Telão (tablet)');

    await outra.limpar();
    expect(outra.nome, '');
    expect(File('${tmp.path}/conta.json').existsSync(), isFalse);
  });

  test('servidor antigo (sem /api/eu): tudo liberado, como antes dos perfis', () async {
    final conta = ContaRepo(api: api((_) => json({'erro': 'Não encontrado'}, 404)), cache: () async => File('${tmp.path}/conta.json'));
    await conta.sincronizar();
    expect(conta.pode('mensagens'), isTrue);
    expect(conta.pode('admin'), isTrue);
  });

  test('perfis configuráveis: as regras vêm das permissões; servidor anterior segue pelo nome do perfil', () async {
    final novo = ContaRepo(
        api: api((_) => json({'nome': 'Obreiro', 'perfilNome': 'Obreiro', 'permissoes': ['visitantes'], 'entrada': '/recepcao'})),
        cache: () async => File('${tmp.path}/conta-nova.json'));
    await novo.sincronizar();
    expect(novo.perfisConfiguraveis, isTrue);
    expect(novo.pode('visitantesHistorico'), isFalse);

    final antigo = ContaRepo(
        api: api((_) => json({'nome': 'Recepção', 'perfilNome': 'Recepção', 'permissoes': ['visitantes']})),
        cache: () async => File('${tmp.path}/conta-antiga.json'));
    await antigo.sincronizar();
    expect(antigo.perfisConfiguraveis, isFalse);
    await antigo.limpar();
    expect(novo.perfisConfiguraveis, isTrue);
  });

  test('login avisa quando a senha é temporária', () async {
    final servidor = api((req) {
      if (req.url.path == '/api/login') return json({'token': 'abc', 'trocarSenha': true});
      expect(req.url.path, '/api/eu/senha');
      expect(req.headers['Authorization'], 'Bearer abc');
      expect(jsonDecode(req.body), {'atual': 'temp12345', 'nova': 'minha-senha'});
      return json({'ok': true});
    });
    final r = await servidor.entrar('http://srv:8080', 'temp12345', usuario: 'ana');
    expect(r.token, 'abc');
    expect(r.trocarSenha, isTrue);
    await servidor.criarMinhaSenha('http://srv:8080', r.token, atual: 'temp12345', nova: 'minha-senha');
    expect(await servidor.login('http://srv:8080', 'temp12345'), 'abc');
  });
}
