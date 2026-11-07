import 'dart:convert';
import 'dart:io';

import 'package:archive/archive.dart';
import 'package:diako_server/app.dart';
import 'package:diako_server/auth.dart';
import 'package:diako_server/backup.dart';
import 'package:diako_server/cartazes.dart';
import 'package:diako_server/config.dart';
import 'package:diako_server/configuracoes.dart';
import 'package:diako_server/historico.dart';
import 'package:diako_server/holyrics.dart';
import 'package:diako_server/permissoes.dart';
import 'package:diako_server/store.dart';
import 'package:diako_server/usuarios.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:image/image.dart' as img;
import 'package:path/path.dart' as p;
import 'package:shelf/shelf.dart';
import 'package:test/test.dart';

void main() {
  late Directory tmp;
  late Store store;
  late Handler handler;
  late String admin;
  late String equipe;

  Future<(int, dynamic)> chamar(String metodo, String caminho, {String? token, Object? json, List<int>? bytes}) async {
    final r = await handler(Request(metodo, Uri.parse('http://x$caminho'),
      headers: {if (token != null) 'authorization': 'Bearer $token', if (json != null) 'content-type': 'application/json'},
      body: bytes ?? (json == null ? null : jsonEncode(json))));
    final dados = await r.read().expand((b) => b).toList();
    final texto = utf8.decode(dados, allowMalformed: true);
    return (r.statusCode, texto.startsWith('{') || texto.startsWith('[') ? jsonDecode(texto) : dados);
  }

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('diako_casa_api');
    final config = Config.lerJson('{"senhaAdmin":"senha-teste"}', pastaBase: tmp.path);
    store = Store(config.pastaDados);
    await store.carregar();
    final cfg = await Configuracoes.carregar(config, urlDetectada: 'http://192.168.0.10:8080');
    final usuarios = Usuarios(config.pastaDados);
    final auth = Auth(conferirSenha: cfg.conferirSenha, pastaDados: config.pastaDados, usuarios: usuarios);
    await usuarios.criar(nome: 'Equipe da casa', login: 'casa', perfil: Perfil.gestaoCasa, senha: 'senha-forte-123');
    final web = Directory(p.join(tmp.path, 'web'))..createSync();
    handler = Servidor(store: store, auth: auth,
      holyrics: HolyricsDireto(host: 'h', porta: 1, token: 't', cliente: MockClient((_) async => http.Response('{}', 200))),
      cartazes: Cartazes(config.pastaCartazes), backup: Backup(pastaDados: config.pastaDados),
      pastaWeb: web.path, urlOracao: cfg.urlOracao, cartazesNoHolyrics: false,
      historico: Historico(config.pastaDados), cfg: cfg,
      restauracao: Restauracao(store: store, backup: Backup(pastaDados: config.pastaDados),
        pastaDados: config.pastaDados, pastaCartazes: config.pastaCartazes)).handler;
    admin = (await chamar('POST', '/api/login', json: {'senha': 'senha-teste'})).$2['token'] as String;
    equipe = (await chamar('POST', '/api/login', json: {'usuario': 'casa', 'senha': 'senha-forte-123'})).$2['token'] as String;
  });
  tearDown(() async { await store.fechar(); await tmp.delete(recursive: true); });

  test('perfil Gestão da Casa só acessa o módulo, sem dados de membros ou administração', () async {
    expect(permissaoDaRota('GET', 'api/casa'), Permissao.gestaoCasa);
    expect((await chamar('GET', '/api/casa')).$1, 401);
    expect((await chamar('GET', '/api/casa', token: equipe)).$1, 200);
    expect((await chamar('GET', '/api/membros', token: equipe)).$1, 403);
    expect((await chamar('GET', '/api/admin/usuarios', token: equipe)).$1, 403);
    final (st, responsaveis) = await chamar('GET', '/api/casa/responsaveis', token: equipe);
    expect(st, 200);
    expect(responsaveis, contains('Equipe da casa'));
  });

  test('API cria rotina, conclui ocorrência e preserva histórico no backup', () async {
    final (st, rotina) = await chamar('POST', '/api/casa/rotinas', token: equipe, json: {
      'tipo': 'compra', 'titulo': 'Café', 'prazo': '2026-11-05', 'intervalo': 1,
      'unidade': 'mes', 'regraData': 'calendario', 'quantidade': '3 pacotes',
    });
    expect(st, 201, reason: '$rotina');
    final primeira = ((await chamar('GET', '/api/casa', token: equipe)).$2['tarefas'] as List).single;
    expect((await chamar('POST', '/api/casa/tarefas/${primeira['id']}/concluir', token: equipe,
      json: {'data': '2026-11-20', 'executor': 'Ana', 'valor': 31.90})).$1, 200);
    final tarefas = (await chamar('GET', '/api/casa', token: equipe)).$2['tarefas'] as List;
    expect(tarefas, hasLength(2));
    expect(tarefas.last['prazo'], '2026-12-05');
    final zipBytes = (await chamar('GET', '/api/backups/agora/download', token: admin)).$2 as List<int>;
    expect(ZipDecoder().decodeBytes(zipBytes).findFile('data/gestaoCasa.json'), isNotNull);
  });

  test('anexo privado e recuperável no backup, sem expor caminho do disco', () async {
    final tarefa = (await chamar('POST', '/api/casa/tarefas', token: equipe, json: {
      'tipo': 'pendencia', 'titulo': 'Trocar lâmpada', 'prazo': '2026-11-15',
    })).$2;
    final foto = img.encodeJpg(img.Image(width: 40, height: 40));
    final (st, salvo) = await chamar('POST', '/api/casa/tarefas/${tarefa['id']}/anexos', token: equipe, bytes: foto);
    expect(st, 201, reason: '$salvo');
    final nome = salvo['nome'];
    expect((await chamar('GET', '/api/casa/anexos/$nome')).$1, 401);
    expect((await chamar('GET', '/api/casa/anexos/$nome', token: equipe)).$1, 200);
    final zipBytes = (await chamar('GET', '/api/backups/agora/download', token: admin)).$2 as List<int>;
    expect(ZipDecoder().decodeBytes(zipBytes).findFile('anexos-casa/$nome'), isNotNull);
    expect((await chamar('DELETE', '/api/casa/tarefas/${tarefa['id']}/anexos/$nome', token: equipe)).$1, 200);
    expect((await chamar('POST', '/api/backups/restaurar', token: admin, bytes: zipBytes)).$1, 200);
    expect((await chamar('GET', '/api/casa/anexos/$nome', token: equipe)).$1, 200);
  });
}
