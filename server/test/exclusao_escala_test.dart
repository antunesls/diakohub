import 'dart:convert';
import 'dart:io';

import 'package:diako_server/app.dart';
import 'package:diako_server/auth.dart';
import 'package:diako_server/backup.dart';
import 'package:diako_server/cartazes.dart';
import 'package:diako_server/config.dart';
import 'package:diako_server/configuracoes.dart';
import 'package:diako_server/historico.dart';
import 'package:diako_server/holyrics.dart';
import 'package:diako_server/limpeza_escalas.dart';
import 'package:diako_server/permissoes.dart';
import 'package:diako_server/store.dart';
import 'package:diako_server/usuarios.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:path/path.dart' as p;
import 'package:shelf/shelf.dart';
import 'package:test/test.dart';

/// Quem sai do cadastro (membro, ou a conta de usuário ligada a ele) sai de todas as escalas.
void main() {
  late Directory tmp;
  late Store store;
  late Usuarios usuarios;
  late Handler handler;
  late String admin;

  Future<(int, dynamic)> chamar(String metodo, String caminho, {Object? json}) async {
    final r = await handler(Request(metodo, Uri.parse('http://x$caminho'),
        headers: {'authorization': 'Bearer $admin', if (json != null) 'content-type': 'application/json'},
        body: json == null ? null : jsonEncode(json)));
    final texto = await r.readAsString();
    return (r.statusCode, texto.isEmpty ? null : jsonDecode(texto));
  }

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('diako_exclusao_escala');
    final config = Config.lerJson('{"senhaAdmin":"senha-teste"}', pastaBase: tmp.path);
    store = Store(config.pastaDados);
    await store.carregar();
    await store.salvarVarios('membros', [
      {'id': 'ana', 'nome': 'Ana', 'status': 'membro'},
      {'id': 'bruno', 'nome': 'Bruno', 'status': 'membro'},
      {'id': 'carla', 'nome': 'Carla', 'status': 'membro'},
    ]);
    await store.salvarVarios('escalas', [
      {'id': 'passado', 'data': '2026-01-04', 'hora': '19:00', 'nome': 'Culto', 'tema': 'Fé',
        'pastoral': {'Direção': ['ana'], 'Pregação': ['bruno']},
        'louvor': {'Vocal': ['ana', 'carla'], 'Teclado': ['carla']},
        'musicas': [{'titulo': 'Bondade de Deus', 'tom': 'G'}]},
      {'id': 'futuro', 'data': '2027-01-03', 'hora': '19:00', 'nome': 'Culto', 'ceia': true,
        'pastoral': {'Santa Ceia': ['bruno', 'ana']}, 'louvor': {'Ministro': ['carla']}},
      {'id': 'sem-ana', 'data': '2027-01-10', 'hora': '19:00', 'nome': 'Culto', 'pastoral': {'Direção': ['bruno']}},
    ]);
    await store.salvarVarios('indisponibilidades', [
      {'id': 'i1', 'membroId': 'ana', 'de': '2027-02-01', 'ate': '2027-02-10'},
      {'id': 'i2', 'membroId': 'bruno', 'de': '2027-02-01', 'ate': '2027-02-10'},
    ]);
    final cfg = await Configuracoes.carregar(config, urlDetectada: 'http://192.168.0.10:8080');
    usuarios = Usuarios(config.pastaDados);
    final auth = Auth(conferirSenha: cfg.conferirSenha, pastaDados: config.pastaDados, usuarios: usuarios);
    final web = Directory(p.join(tmp.path, 'web'))..createSync();
    handler = Servidor(store: store, auth: auth,
      holyrics: HolyricsDireto(host: 'h', porta: 1, token: 't', cliente: MockClient((_) async => http.Response('{}', 200))),
      cartazes: Cartazes(config.pastaCartazes), backup: Backup(pastaDados: config.pastaDados),
      pastaWeb: web.path, urlOracao: cfg.urlOracao, cartazesNoHolyrics: false,
      historico: Historico(config.pastaDados), cfg: cfg).handler;
    final login = await handler(Request('POST', Uri.parse('http://x/api/login'),
        headers: {'content-type': 'application/json'}, body: jsonEncode({'senha': 'senha-teste'})));
    admin = jsonDecode(await login.readAsString())['token'] as String;
  });
  tearDown(() async {
    await store.fechar();
    try {
      await tmp.delete(recursive: true);
    } on FileSystemException {
      // Windows às vezes ainda segura um arquivo; é pasta temporária.
    }
  });

  Map<String, dynamic> culto(String id) => store.buscar('escalas', id)!;

  test('excluir membro tira a pessoa de todos os cultos, inclusive passados, e das indisponibilidades', () async {
    final (st, r) = await chamar('DELETE', '/api/membros/ana');
    expect(st, 200);
    expect(r['escalasAlteradas'], 2);
    expect(culto('passado')['pastoral'], {'Pregação': ['bruno']}); // função vazia sai do mapa
    expect(culto('passado')['louvor'], {'Vocal': ['carla'], 'Teclado': ['carla']});
    expect(culto('futuro')['pastoral'], {'Santa Ceia': ['bruno']});
    // O resto do culto fica intacto.
    expect(culto('passado')['tema'], 'Fé');
    expect(culto('passado')['musicas'], [{'titulo': 'Bondade de Deus', 'tom': 'G'}]);
    expect(culto('futuro')['ceia'], true);
    expect(culto('sem-ana')['pastoral'], {'Direção': ['bruno']});
    expect(store.listar('indisponibilidades').map((d) => d['id']), ['i2']);
    // A escala do mês não mostra mais "(pessoa removida)".
    final (_, janeiro) = await chamar('GET', '/api/escalas?mes=2026-01');
    expect(jsonEncode(janeiro), isNot(contains('pessoa removida')));
  });

  test('excluir usuário ligado a um membro tira a pessoa das escalas; o cadastro continua', () async {
    final u = await usuarios.criar(nome: 'Carla', login: 'carla', perfil: Perfil.integrante, senha: 'senha-forte-123', membroId: 'carla');
    final (st, r) = await chamar('DELETE', '/api/admin/usuarios/${u.id}');
    expect(st, 200);
    expect(r['escalasAlteradas'], 2);
    expect(culto('passado')['louvor'], {'Vocal': ['ana']});
    expect(culto('futuro')['louvor'], isEmpty);
    expect(store.buscar('membros', 'carla'), isNotNull);
  });

  test('limpeza ao iniciar tira quem já tinha sido excluído antes e não mexe em quem existe', () async {
    // Sobra de exclusão antiga: "zeca" não está mais no cadastro.
    await store.salvar('escalas', {...culto('futuro'), 'louvor': {'Ministro': ['carla'], 'Bateria': ['zeca']}});
    await store.salvar('indisponibilidades', {'id': 'i3', 'membroId': 'zeca', 'de': '2027-03-01', 'ate': '2027-03-02'});
    expect(await limparEscalasOrfas(store), 1);
    expect(culto('futuro')['louvor'], {'Ministro': ['carla']});
    expect(culto('futuro')['pastoral'], {'Santa Ceia': ['bruno', 'ana']});
    expect(store.buscar('indisponibilidades', 'i3'), isNull);
    expect(await limparEscalasOrfas(store), 0); // nada mais a limpar
  });

  test('limpeza ao iniciar não faz nada sem membros cadastrados (não esvazia as escalas)', () async {
    for (final m in [...store.listar('membros')]) {
      await store.excluir('membros', m['id'] as String);
    }
    final antes = jsonEncode(store.listar('escalas'));
    expect(await limparEscalasOrfas(store), 0);
    expect(jsonEncode(store.listar('escalas')), antes);
    expect(store.listar('indisponibilidades'), hasLength(2));
  });

  test('excluir usuário sem membro vinculado não mexe nas escalas', () async {
    final antes = jsonEncode(store.listar('escalas'));
    final u = await usuarios.criar(nome: 'Mídia', login: 'midia', perfil: Perfil.midia, senha: 'senha-forte-123');
    final (st, r) = await chamar('DELETE', '/api/admin/usuarios/${u.id}');
    expect(st, 200);
    expect(r['escalasAlteradas'], 0);
    expect(jsonEncode(store.listar('escalas')), antes);
  });
}
