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
import 'package:diako_server/mensagem_acesso.dart';
import 'package:diako_server/perfis.dart';
import 'package:diako_server/permissoes.dart';
import 'package:diako_server/store.dart';
import 'package:diako_server/usuarios.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:path/path.dart' as p;
import 'package:shelf/shelf.dart';
import 'package:test/test.dart';

void main() {
  group('Perfis (data/perfis.json)', () {
    late Directory pasta;
    setUp(() async => pasta = await Directory.systemTemp.createTemp('diako_perfis'));
    tearDown(() => pasta.delete(recursive: true));

    test('começa com os padrões de fábrica e grava o arquivo', () async {
      final perfis = Perfis(pasta.path);
      await perfis.carregar();
      expect([for (final x in perfis.lista) x.id], [for (final d in PerfilPadrao.values) d.id]);
      expect(File(p.join(pasta.path, 'perfis.json')).existsSync(), isTrue);
      expect(perfis.buscar('comissao-louvor')!.pode(Permissao.escalaLouvor), isTrue);
    });

    test('edições, perfis novos e exclusões persistem; o Administrador é travado', () async {
      final perfis = Perfis(pasta.path);
      await perfis.carregar();
      await perfis.atualizar('midia', permissoes: {Permissao.cartazes});
      final jovens = await perfis.criar(nome: 'Líder de Jovens', permissoes: {Permissao.agendaEditar});
      expect(jovens.id, 'lider-de-jovens');
      expect(jovens.permissoes, containsAll([Permissao.sessao, Permissao.agendaEditar, Permissao.agendaVer]));
      await perfis.excluir('player');
      await expectLater(perfis.atualizar('administrador', nome: 'Chefe'), throwsFormatException);
      await expectLater(perfis.excluir('administrador'), throwsFormatException);
      await expectLater(perfis.criar(nome: 'líder de jovens', permissoes: const {}), throwsFormatException);

      final deNovo = Perfis(pasta.path);
      await deNovo.carregar();
      expect(deNovo.buscar('midia')!.permissoes, {Permissao.sessao, Permissao.cartazes});
      expect(deNovo.buscar('lider-de-jovens')!.nome, 'Líder de Jovens');
      expect(deNovo.buscar('player'), isNull, reason: 'padrão excluído não volta sozinho');
      expect(deNovo.padroesExcluidos, [PerfilPadrao.player]);

      await deNovo.restaurar('player');
      await deNovo.restaurar('midia');
      expect(deNovo.buscar('player'), isNotNull);
      expect(Perfis.igualAoPadrao(deNovo.buscar('midia')!), isTrue);
      await expectLater(deNovo.restaurar('lider-de-jovens'), throwsFormatException);
    });

    test('permissão nova do servidor entra nos padrões que a têm de fábrica, não nos criados', () async {
      // Arquivo de uma versão que ainda não conhecia "indisponibilidade" nem "musicasMinistro".
      final antigas = [for (final x in Permissao.values) if (x != Permissao.indisponibilidade && x != Permissao.musicasMinistro) x.name];
      await File(p.join(pasta.path, 'perfis.json')).writeAsString(jsonEncode({
        'permissoesConhecidas': antigas,
        'perfis': [
          {'id': 'ministro', 'nome': 'Ministro', 'permissoes': ['sessao', 'minhaEscala']},
          {'id': 'integrante', 'nome': 'Integrante', 'permissoes': ['sessao', 'minhaEscala']},
          {'id': 'escala-livre', 'nome': 'Escala livre', 'permissoes': ['sessao', 'minhaEscala']},
          {'id': 'administrador', 'nome': 'Administrador', 'permissoes': ['sessao']},
        ],
      }));
      final perfis = Perfis(pasta.path);
      await perfis.carregar();
      expect(perfis.buscar('ministro')!.permissoes, containsAll([Permissao.indisponibilidade, Permissao.musicasMinistro]));
      expect(perfis.buscar('integrante')!.pode(Permissao.indisponibilidade), isTrue);
      expect(perfis.buscar('integrante')!.pode(Permissao.musicasMinistro), isFalse);
      expect(perfis.buscar('escala-livre')!.permissoes, {Permissao.sessao, Permissao.minhaEscala});
      expect(perfis.buscar('administrador')!.permissoes, Permissao.completar(PerfilPadrao.administrador.permissoes),
          reason: 'o Administrador sempre tem tudo de fábrica');
      expect(perfis.buscar('pastor'), isNotNull, reason: 'padrão ausente do arquivo é adicionado');
    });

    test('migra gestão de casais só nos padrões, preservando remoção posterior', () async {
      await File(p.join(pasta.path, 'perfis.json')).writeAsString(jsonEncode({
        'permissoesConhecidas': [for (final q in Permissao.values) if (q.name != 'casaisGerenciar') q.name],
        'perfis': [
          for (final id in ['liderCasais', 'pastor', 'secretaria', 'consulta-customizada'])
            {'id': id, 'nome': id, 'permissoes': ['sessao', 'casais']},
        ],
      }));
      final perfis = Perfis(pasta.path);
      await perfis.carregar();
      final gestao = Permissao.porNome('casaisGerenciar');
      expect(gestao, isNotNull);
      for (final id in ['liderCasais', 'pastor', 'administrador']) {
        expect(perfis.buscar(id)!.pode(gestao!), isTrue);
      }
      for (final id in ['secretaria', 'consulta-customizada']) {
        expect(perfis.buscar(id)!.pode(gestao!), isFalse);
      }
      await perfis.atualizar('liderCasais', permissoes: {Permissao.casais});
      final recarregado = Perfis(pasta.path);
      await recarregado.carregar();
      expect(recarregado.buscar('liderCasais')!.pode(gestao!), isFalse);
    });

    test('dependências entre permissões e página de entrada do perfil', () {
      expect(Permissao.completar({Permissao.atasSigilosas}), {Permissao.sessao, Permissao.atas, Permissao.atasSigilosas});
      expect(Permissao.completar({Permissao.musicasMinistro}), {Permissao.sessao, Permissao.minhaEscala, Permissao.musicasMinistro});
      expect(Perfil.recepcao.entrada, '/recepcao');
      expect(Perfil.integrante.entrada, '/minha-escala');
      expect(Perfil.ministro.entrada, '/minha-escala');
      expect(Perfil.louvor.entrada, '/minha-escala');
      expect(Perfil.comissaoLouvor.entrada, '/painel');
      expect(Perfil.secretaria.entrada, '/painel');
    });

    test('contas gravadas antes da troca obrigatória não são forçadas a trocar', () {
      final u = Usuario.fromJson({'id': 'x', 'login': 'antigo', 'perfil': 'secretaria'});
      expect(u.trocarSenha, isFalse);
      expect(u.perfil.id, 'secretaria');
      expect(Usuario.fromJson({'id': 'y', 'login': 'sumido', 'perfil': 'perfil-apagado'}).perfil.permissoes, {Permissao.sessao});
    });
  });

  test('mensagem de acesso para o WhatsApp e número do membro', () {
    final texto = mensagemAcesso(
        nome: 'Bruno Reis', igreja: 'Igreja Teste', endereco: 'https://igreja.org/minha-escala', login: 'bruno.reis',
        senha: 'abc234defg', valeAte: DateTime(2026, 11, 23));
    expect(texto, startsWith('Olá, Bruno! Este é o seu acesso ao DiakoHub da Igreja Teste.'));
    expect(texto, contains('Entre em: https://igreja.org/minha-escala'));
    expect(texto, contains('Usuário: bruno.reis'));
    expect(texto, contains('Senha temporária: abc234defg'));
    expect(texto, contains('vale até 23/11'));
    expect(whatsappDoMembro({'whatsapp': '(11) 91234-5678'}), '5511912345678');
    expect(whatsappDoMembro({'telefone': '11 3456-7890'}), '551134567890');
    expect(whatsappDoMembro({'whatsapp': '123', 'telefone': ''}), isNull);
    expect(whatsappDoMembro(null), isNull);
  });

  group('servidor', () {
    late Directory tmp;
    late Store store;
    late Handler handler;
    late Usuarios usuarios;
    late String admin;
    var agora = DateTime(2026, 11, 16, 10);

    Future<(int, dynamic)> chamar(String metodo, String caminho, {String? token, Object? json}) async {
      final r = await handler(Request(metodo, Uri.parse('http://x$caminho'),
          headers: {if (token != null) 'authorization': 'Bearer $token', 'content-type': 'application/json'},
          body: json == null ? null : jsonEncode(json)));
      final texto = await r.readAsString();
      return (r.statusCode, texto.startsWith('{') || texto.startsWith('[') ? jsonDecode(texto) : texto);
    }

    Future<(int, dynamic)> entrar(String usuario, String senha) =>
        chamar('POST', '/api/login', json: {'usuario': usuario, 'senha': senha});

    setUp(() async {
      agora = DateTime(2026, 11, 16, 10);
      tmp = await Directory.systemTemp.createTemp('diako_perfis_api');
      final config = Config.lerJson('{"senhaAdmin":"senha-principal"}', pastaBase: tmp.path);
      store = Store(config.pastaDados);
      await store.carregar();
      final cfg = await Configuracoes.carregar(config, urlDetectada: 'http://192.168.0.10:8080');
      usuarios = Usuarios(config.pastaDados, relogio: () => agora);
      await usuarios.carregar();
      final auth = Auth(conferirSenha: cfg.conferirSenha, pastaDados: config.pastaDados, usuarios: usuarios);
      final web = Directory(p.join(tmp.path, 'web'))..createSync();
      handler = Servidor(
        store: store,
        auth: auth,
        holyrics: HolyricsDireto(
            host: 'h', porta: 1, token: 't', cliente: MockClient((_) async => http.Response('{"status":"ok"}', 200))),
        cartazes: Cartazes(config.pastaCartazes),
        backup: Backup(pastaDados: config.pastaDados, configuracoes: cfg.publicas),
        pastaWeb: web.path,
        urlOracao: cfg.urlOracao,
        cartazesNoHolyrics: false,
        historico: Historico(config.pastaDados),
        cfg: cfg,
      ).handler;
      admin = (await entrar('', 'senha-principal')).$2['token'] as String;
    });
    tearDown(() async {
      await store.fechar();
      await tmp.delete(recursive: true);
    });

    /// Cria a conta e devolve (id, token já com a senha própria).
    Future<(String, String)> criar(String login, String perfil) async {
      final (st, j) = await chamar('POST', '/api/admin/usuarios',
          token: admin, json: {'nome': 'Pessoa $login', 'login': login, 'perfil': perfil});
      expect(st, 201, reason: '$j');
      final token = (await entrar(login, j['senhaTemporaria'] as String)).$2['token'] as String;
      await chamar('POST', '/api/eu/senha', token: token, json: {'atual': j['senhaTemporaria'], 'nova': 'senha-propria-1'});
      return (j['usuario']['id'] as String, token);
    }

    test('perfil criado a partir de outro; mudar as permissões vale na próxima requisição', () async {
      final (st, novo) = await chamar('POST', '/api/admin/perfis',
          token: admin, json: {'nome': 'Líder de jovens', 'copiarDe': 'secretaria'});
      expect(st, 201, reason: '$novo');
      expect(novo['id'], 'lider-de-jovens');
      expect(novo['permissoes'], contains('mensagens'));

      final (_, lider) = await criar('lider.jovens', 'lider-de-jovens');
      expect((await chamar('GET', '/api/mensagens', token: lider)).$1, 200);

      final semMensagens = [for (final x in novo['permissoes'] as List) if (x != 'mensagens') x];
      final (stEd, editado) = await chamar('PUT', '/api/admin/perfis/lider-de-jovens',
          token: admin, json: {'permissoes': semMensagens});
      expect(stEd, 200, reason: '$editado');
      expect(editado['usuarios'], 1);
      expect((await chamar('GET', '/api/mensagens', token: lider)).$1, 403, reason: 'sem entrar de novo');
      final (_, eu) = await chamar('GET', '/api/eu', token: lider);
      expect(eu['permissoes'], isNot(contains('mensagens')));
      expect(eu['perfilNome'], 'Líder de jovens');

      final (_, lista) = await chamar('GET', '/api/admin/perfis', token: admin);
      final linha = (lista['perfis'] as List).firstWhere((x) => x['id'] == 'lider-de-jovens');
      expect(linha['usuarios'], 1);
      expect(lista['permissoes'], isNotEmpty);
      expect((await chamar('GET', '/api/admin/perfis', token: lider)).$1, 403, reason: 'só quem gerencia usuários');

      final (_, auditoria) = await chamar('GET', '/api/auditoria?tipo=acesso', token: admin);
      expect([for (final e in auditoria as List) e['acao']], containsAll(['perfil-criado', 'perfil-editado']));
    });

    test('Administrador travado; perfil em uso não é excluído; restaurar padrão', () async {
      expect((await chamar('PUT', '/api/admin/perfis/administrador', token: admin, json: {'nome': 'Chefe'})).$1, 400);
      expect((await chamar('DELETE', '/api/admin/perfis/administrador', token: admin)).$1, 400);
      expect((await chamar('PUT', '/api/admin/perfis/midia', token: admin, json: {'permissoes': ['naoExiste']})).$1, 400);

      final (_, midia) = await criar('midia1', 'midia');
      await chamar('PUT', '/api/admin/perfis/midia', token: admin, json: {'permissoes': ['cartazes']});
      expect((await chamar('GET', '/api/estado', token: midia)).$1, 403);
      final (stEx, ex) = await chamar('DELETE', '/api/admin/perfis/midia', token: admin);
      expect(stEx, 400);
      expect(ex['erro'], contains('1 conta tem'));

      final (_, perfis) = await chamar('GET', '/api/admin/perfis', token: admin);
      expect((perfis['perfis'] as List).firstWhere((x) => x['id'] == 'midia')['alterado'], isTrue);
      expect((await chamar('POST', '/api/admin/perfis/midia/restaurar', token: admin)).$1, 200);
      expect((await chamar('GET', '/api/estado', token: midia)).$1, 200);

      expect((await chamar('DELETE', '/api/admin/perfis/player', token: admin)).$1, 200);
      expect((await chamar('DELETE', '/api/admin/perfis/integrante', token: admin)).$1, 400,
          reason: 'Acessos às escalas cria contas com ele');
      final (_, depois) = await chamar('GET', '/api/admin/perfis', token: admin);
      expect([for (final x in depois['padroesExcluidos'] as List) x['id']], ['player']);
    });

    test('primeiro acesso: a senha temporária só serve para criar a própria', () async {
      final (st, j) = await chamar('POST', '/api/admin/usuarios',
          token: admin, json: {'nome': 'Ana Souza', 'login': 'ana.souza', 'perfil': 'secretaria'});
      expect(st, 201);
      expect(j['mensagemAcesso'], contains('Senha temporária: ${j['senhaTemporaria']}'));
      expect(j['mensagemAcesso'], contains('/painel'));
      expect(j['usuario']['trocarSenha'], isTrue);
      final temporaria = j['senhaTemporaria'] as String;

      final (_, login) = await entrar('ana.souza', temporaria);
      expect(login['trocarSenha'], isTrue);
      final token = login['token'] as String;
      final (stAgenda, bloqueio) = await chamar('GET', '/api/agenda', token: token);
      expect(stAgenda, 403);
      expect(bloqueio['codigo'], 'trocar-senha');
      final (_, eu) = await chamar('GET', '/api/eu', token: token);
      expect(eu['trocarSenha'], isTrue);
      expect((await chamar('POST', '/api/eu/senha', token: token, json: {'atual': temporaria, 'nova': temporaria})).$1, 400);
      expect((await chamar('POST', '/api/eu/senha', token: token, json: {'atual': temporaria, 'nova': 'minha-senha-boa'})).$1, 200);
      expect((await chamar('GET', '/api/agenda', token: token)).$1, 200);
      expect((await entrar('ana.souza', 'minha-senha-boa')).$2['trocarSenha'], isFalse);
    });

    test('senha temporária vence em 7 dias; gerar outra libera de novo', () async {
      final (_, j) = await chamar('POST', '/api/admin/usuarios',
          token: admin, json: {'nome': 'Caio', 'login': 'caio', 'perfil': 'midia'});
      agora = agora.add(const Duration(days: 8));
      final (st, erro) = await entrar('caio', j['senhaTemporaria'] as String);
      expect(st, 401);
      expect(erro['erro'], contains('vencida'));
      final (_, lista) = await chamar('GET', '/api/admin/usuarios', token: admin);
      expect((lista['usuarios'] as List).single['trocarSenha'], isTrue);

      final (stNova, nova) = await chamar('POST', '/api/admin/usuarios/${j['usuario']['id']}/senha', token: admin);
      expect(stNova, 200);
      expect(nova['mensagemAcesso'], contains('Senha temporária: ${nova['senhaTemporaria']}'));
      expect((await entrar('caio', nova['senhaTemporaria'] as String)).$1, 200);
    });

    test('acesso às escalas leva o WhatsApp do membro e o endereço da Minha escala', () async {
      final (_, membro) = await chamar('POST', '/api/membros',
          token: admin, json: {'nome': 'Bruno Reis', 'whatsapp': '(11) 91234-5678'});
      final (st, criado) = await chamar('POST', '/api/acessos-escala',
          token: admin, json: {'membroId': membro['id'], 'nome': 'Bruno Reis', 'login': 'bruno.reis'});
      expect(st, 201, reason: '$criado');
      expect(criado['whatsapp'], '5511912345678');
      expect(criado['mensagemAcesso'], contains('/minha-escala'));
      expect(criado['mensagemAcesso'], startsWith('Olá, Bruno!'));
      final (_, lista) = await chamar('GET', '/api/acessos-escala', token: admin);
      final conta = (lista['usuarios'] as List).single;
      expect(conta['perfilNome'], 'Integrante');
      expect(conta['trocarSenha'], isTrue);
    });

    test('perfil próprio herda as regras que antes dependiam do nome do perfil', () async {
      // Um "Obreiro" igual à Recepção: só vê os visitantes de hoje.
      await chamar('POST', '/api/admin/perfis', token: admin, json: {'nome': 'Obreiro', 'copiarDe': 'recepcao'});
      final (_, obreiro) = await criar('obreiro1', 'obreiro');
      final (_, eu) = await chamar('GET', '/api/eu', token: obreiro);
      expect(eu['entrada'], '/recepcao');
      expect(eu['permissoes'], isNot(contains('visitantesHistorico')));
      // Um "Cantor" só com a própria escala: não avisa indisponibilidade.
      await chamar('POST', '/api/admin/perfis', token: admin, json: {'nome': 'Cantor', 'permissoes': ['minhaEscala']});
      final (_, cantor) = await criar('cantor1', 'cantor');
      expect((await chamar('POST', '/api/minha-escala/indisponivel', token: cantor, json: {'de': '2099-01-01'})).$1, 403);
    });
  });
}
