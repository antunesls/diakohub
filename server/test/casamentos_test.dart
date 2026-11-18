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
import 'package:diako_server/store.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shelf/shelf.dart';
import 'package:test/test.dart';

void main() {
  late Directory tmp;
  late Store store;
  late Handler handler;
  late String token;

  Future<(int, dynamic)> chamar(String metodo, String caminho, {Object? dados, bool publico = false}) async {
    final r = await handler(Request(metodo, Uri.parse('http://x$caminho'), headers: {
      if (!publico) 'authorization': 'Bearer $token', 'content-type': 'application/json',
    }, body: dados == null ? null : jsonEncode(dados)));
    final texto = await r.readAsString();
    return (r.statusCode, texto.startsWith('{') || texto.startsWith('[') ? jsonDecode(texto) : texto);
  }

  Future<Map<String, dynamic>> criar(String nome, [Map<String, dynamic> extras = const {}]) async {
    final (st, m) = await chamar('POST', '/api/membros', dados: {
      'nome': nome, 'status': 'membro', 'consentimentoEm': '2026-11-01', ...extras,
    });
    expect(st, 201, reason: '$m');
    return Map<String, dynamic>.from(m as Map);
  }

  Future<List> recados() async => (await chamar('GET', '/api/recados')).$2 as List;
  Iterable<dynamic> casamentos(List lista) => lista.where((r) => r['id'] == 'auto-casamentos');

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('diako_casamentos');
    final config = Config.lerJson('{"senhaAdmin":"senha-teste"}', pastaBase: tmp.path);
    store = Store(config.pastaDados);
    await store.carregar();
    final cfg = await Configuracoes.carregar(config, urlDetectada: 'http://igreja.test');
    handler = Servidor(
      store: store,
      auth: Auth(conferirSenha: cfg.conferirSenha, pastaDados: config.pastaDados),
      holyrics: HolyricsDireto(host: 'h', porta: 1, token: 't', cliente: MockClient((_) async => http.Response('{}', 200))),
      cartazes: Cartazes(config.pastaCartazes),
      backup: Backup(pastaDados: config.pastaDados, configuracoes: cfg.publicas),
      pastaWeb: tmp.path, urlOracao: cfg.urlOracao, cartazesNoHolyrics: false,
      historico: Historico(config.pastaDados), cfg: cfg, relogio: () => DateTime(2026, 11, 18, 10),
    ).handler;
    token = '';
    token = (await chamar('POST', '/api/login', publico: true, dados: {'senha': 'senha-teste'})).$2['token'] as String;
  });
  tearDown(() async { await store.fechar(); await tmp.delete(recursive: true); });

  test('guarda casamento externo e gera recado semanal só com autorização', () async {
    final ana = await criar('Ana Souza', {'conjugeNome': 'Bruno Lima', 'dataCasamento': '18/11/2016'});
    expect(ana['dataCasamento'], '2016-11-18');
    expect(ana['conjugeNome'], 'Bruno Lima');
    expect(casamentos(await recados()), isEmpty);
    final (st, autorizado) = await chamar('PUT', '/api/membros/${ana['id']}', dados: {'casamentoAutorizado': true,
      'casamentoConsentimento': {'em': 'inventado', 'por': 'inventado'}});
    expect(st, 200);
    expect(autorizado['casamentoConsentimento']['em'], startsWith('2026-11-18'));
    expect(autorizado['casamentoConsentimento']['por'], isNot('inventado'));
    final auto = casamentos(await recados()).single;
    expect(auto['titulo'], 'Aniversários de casamento da semana');
    expect(auto['texto'], contains('Ana Souza e Bruno Lima (18/11) · 10 anos'));
    expect(auto['auto'], true);
    expect((await chamar('GET', '/api/resumo-semanal')).$2['texto'], contains('Aniversários de casamento da semana'));
    final (_, mural) = await chamar('GET', '/api/public/mural');
    expect(mural.toString(), contains('Aniversários de casamento da semana'));
    expect((await chamar('PUT', '/api/recados/auto-casamentos', dados: {'titulo': 'editado'})).$1, 400);
    await chamar('POST', '/api/membros/${ana['id']}/lgpd/revogar');
    expect(casamentos(await recados()), isEmpty);
  });

  test('sincroniza data e autorização sem duplicar o casal e revoga pelos dois lados', () async {
    final bruno = await criar('Bruno Lima');
    final ana = await criar('Ana Souza', {'conjugeId': bruno['id'], 'dataCasamento': '2016-11-18', 'casamentoAutorizado': true});
    final parceiro = store.buscar('membros', bruno['id'])!;
    expect(parceiro['dataCasamento'], '2016-11-18');
    expect(parceiro['casamentoAutorizado'], true);
    expect(casamentos(await recados()).single['texto'], contains('10 anos'));
    await chamar('PUT', '/api/membros/${bruno['id']}', dados: {'casamentoAutorizado': false});
    expect(store.buscar('membros', ana['id'])!['casamentoAutorizado'], isNot(true));
    expect(casamentos(await recados()), isEmpty);
    await chamar('PUT', '/api/membros/${ana['id']}', dados: {'casamentoAutorizado': true});
    await chamar('PUT', '/api/membros/${bruno['id']}', dados: {'estadoCivil': 'Divorciado(a)'});
    expect(casamentos(await recados()), isEmpty);
  });

  test('não divulga sem LGPD do outro cônjuge nem visitantes ou fora da semana', () async {
    final bruno = await criar('Bruno Lima', {'consentimentoEm': null});
    await criar('Ana Souza', {'conjugeId': bruno['id'], 'dataCasamento': '2016-11-18', 'casamentoAutorizado': true});
    await criar('Visitante', {'status': 'visitante', 'conjugeNome': 'Parceiro', 'dataCasamento': '2010-11-18', 'casamentoAutorizado': true});
    await criar('Fora da semana', {'conjugeNome': 'Parceiro', 'dataCasamento': '2010-11-22', 'casamentoAutorizado': true});
    expect(casamentos(await recados()), isEmpty);
  });

  test('trocar cônjuge limpa autorização e data nos vínculos desfeitos', () async {
    final bruno = await criar('Bruno Lima');
    final ana = await criar('Ana Souza', {'conjugeId': bruno['id'], 'dataCasamento': '2016-11-18', 'casamentoAutorizado': true});
    final carlos = await criar('Carlos');
    await chamar('PUT', '/api/membros/${ana['id']}', dados: {'conjugeId': carlos['id']});
    expect(store.buscar('membros', bruno['id'])!['dataCasamento'], isNull);
    expect(store.buscar('membros', ana['id'])!['casamentoAutorizado'], isNot(true));
    expect(store.buscar('membros', carlos['id'])!['dataCasamento'], isNull);
    expect(casamentos(await recados()), isEmpty);
  });

  test('recusa datas inválidas, futuras e autorização sem casal completo', () async {
    for (final data in ['2020-02-31', 'amanhã', '2030-11-18', 123]) {
      expect((await chamar('POST', '/api/membros', dados: {'nome': 'Ana', 'dataCasamento': data})).$1, 400);
    }
    expect((await chamar('POST', '/api/membros', dados: {'nome': 'Ana', 'casamentoAutorizado': true})).$1, 400);
    expect((await chamar('POST', '/api/membros', dados: {'nome': 'Ana', 'casamentoAutorizado': 'sim'})).$1, 400);
  });

  test('cadastro público guarda casamento pendente e secretaria aprova antes de divulgar', () async {
    final (st, envio) = await chamar('POST', '/api/public/cadastro', publico: true, dados: {
      'nome': 'Ana Souza', 'aniversario': '1990-05-01', 'email': 'ana@exemplo.com', 'autorizo': true,
      'conjugeNome': 'Bruno Lima', 'dataCasamento': '2016-11-18', 'casamentoAutorizado': true,
    });
    expect(st, 201);
    expect(store.buscar('solicitacoesMembros', envio['id'])!['dados']['dataCasamento'], '2016-11-18');
    expect(casamentos(await recados()), isEmpty);
    final (aprovou, _) = await chamar('POST', '/api/solicitacoes-membros/${envio['id']}/aprovar', dados: {'status': 'membro'});
    expect(aprovou, 200);
    expect(casamentos(await recados()).single['texto'], contains('Bruno Lima'));
    final (invalido, _) = await chamar('POST', '/api/public/cadastro', publico: true, dados: {
      'nome': 'Outra Pessoa', 'aniversario': '1990-05-01', 'email': 'outra@exemplo.com', 'autorizo': true,
      'dataCasamento': '2030-11-18',
    });
    expect(invalido, 400);
  });

  test('aceite público de outro casal não autoriza dados antigos mantidos na revisão', () async {
    final ana = await criar('Ana Souza', {'conjugeNome': 'Carlos Lima', 'dataCasamento': '2010-05-01'});
    final (_, envio) = await chamar('POST', '/api/public/cadastro', publico: true, dados: {
      'nome': 'Ana Souza', 'aniversario': '1990-05-01', 'email': 'ana@exemplo.com', 'autorizo': true,
      'conjugeNome': 'Bruno Lima', 'dataCasamento': '2016-11-18', 'casamentoAutorizado': true,
    });
    final (st, _) = await chamar('POST', '/api/solicitacoes-membros/${envio['id']}/aprovar',
        dados: {'status': 'membro', 'membroId': ana['id']});
    expect(st, 200);
    final salvo = store.buscar('membros', ana['id'])!;
    expect(salvo['conjugeNome'], 'Carlos Lima');
    expect(salvo['casamentoAutorizado'], isNot(true), reason: 'O aceite enviado era para Bruno, não Carlos.');
  });

  test('recepção não transfere aceites anteriores ao criar outro vínculo de casal', () async {
    final ana = await criar('Ana Souza', {'telefone': '11999990001', 'conjugeNome': 'Carlos Lima',
      'dataCasamento': '2016-11-18', 'casamentoAutorizado': true});
    final bruno = await criar('Bruno Lima', {'telefone': '11999990002', 'conjugeNome': 'Daniela Souza',
      'dataCasamento': '2016-11-18', 'casamentoAutorizado': true});
    final (st, resposta) = await chamar('POST', '/api/public/visitante', publico: true, dados: {'autorizo': true, 'mencionar': false, 'pessoas': [
      {'nome': 'Ana Souza', 'telefone': '11999990001', 'autorizo': true},
      {'nome': 'Bruno Lima', 'telefone': '11999990002', 'parentesco': 'conjuge', 'autorizo': true},
    ]});
    expect(st, 201, reason: '$resposta');
    expect(store.buscar('membros', ana['id'])!['conjugeId'], isNull,
        reason: 'A recepção não deve substituir um casamento que já estava identificado pelo nome.');
    expect(store.buscar('membros', ana['id'])!['conjugeNome'], 'Carlos Lima');
    expect(store.buscar('membros', bruno['id'])!['conjugeNome'], 'Daniela Souza');
    expect(store.buscar('membros', ana['id'])!['dataCasamento'], '2016-11-18');
    expect(casamentos(await recados()).single['texto'], isNot(contains('Ana Souza e Bruno Lima')));
  });

  test('vincular ficha sem casamento preserva data e aceite já registrados para o mesmo casal', () async {
    final ana = await criar('Ana Souza', {'conjugeNome': 'Bruno Lima', 'dataCasamento': '2016-11-18', 'casamentoAutorizado': true});
    final bruno = await criar('Bruno Lima', {'conjugeId': ana['id'], 'dataCasamento': null, 'casamentoAutorizado': false});
    expect(bruno['dataCasamento'], '2016-11-18');
    expect(bruno['casamentoAutorizado'], true);
    expect(store.buscar('membros', ana['id'])!['dataCasamento'], '2016-11-18');
    expect(casamentos(await recados()).length, 1);
  });

  test('aprovar cônjuge sem data não apaga casamento que já estava na outra ficha', () async {
    final ana = await criar('Ana Souza', {'conjugeNome': 'Bruno Lima', 'dataCasamento': '2016-11-18', 'casamentoAutorizado': true});
    final (_, envio) = await chamar('POST', '/api/public/cadastro', publico: true, dados: {
      'nome': 'Bruno Lima', 'aniversario': '1990-01-01', 'email': 'bruno@exemplo.com', 'autorizo': true,
      'familiares': [{'nome': 'Ana Souza', 'parentesco': 'conjuge'}],
    });
    final (st, _) = await chamar('POST', '/api/solicitacoes-membros/${envio['id']}/aprovar', dados: {
      'status': 'membro', 'familia': [{'membroId': ana['id'], 'parentesco': 'conjuge'}],
    });
    expect(st, 200);
    expect(store.buscar('membros', ana['id'])!['dataCasamento'], '2016-11-18');
    expect(store.buscar('membros', ana['id'])!['casamentoAutorizado'], true);
    expect(casamentos(await recados()).length, 1);
  });

  test('corpo completo do painel não carrega data antiga ao remover ou trocar cônjuge', () async {
    for (final trocar in [false, true]) {
      final bruno = await criar('Bruno Lima');
      final ana = await criar('Ana Souza', {'conjugeId': bruno['id'], 'dataCasamento': '2016-11-18', 'casamentoAutorizado': true});
      final carlos = trocar ? await criar('Carlos Lima') : null;
      final (st, _) = await chamar('PUT', '/api/membros/${ana['id']}', dados: {
        'conjugeId': carlos?['id'], 'conjugeNome': null, 'dataCasamento': '2016-11-18', 'casamentoAutorizado': false,
      });
      expect(st, 200);
      expect(store.buscar('membros', ana['id'])!['dataCasamento'], isNull);
      expect(store.buscar('membros', bruno['id'])!['dataCasamento'], isNull);
      if (carlos != null) expect(store.buscar('membros', carlos['id'])!['dataCasamento'], isNull);
    }
  });

  test('converter nome externo para o cadastro do mesmo cônjuge preserva a data confirmada', () async {
    final ana = await criar('Ana Souza', {'conjugeNome': 'Bruno Lima', 'dataCasamento': '2016-11-18', 'casamentoAutorizado': true});
    final bruno = await criar('Bruno Lima');
    final (st, salvo) = await chamar('PUT', '/api/membros/${ana['id']}', dados: {
      'conjugeId': bruno['id'], 'conjugeNome': null, 'dataCasamento': '2016-11-18', 'casamentoAutorizado': true,
    });
    expect(st, 200, reason: '$salvo');
    expect(salvo['dataCasamento'], '2016-11-18');
    expect(store.buscar('membros', bruno['id'])!['dataCasamento'], '2016-11-18');
    expect(casamentos(await recados()).length, 1);
  });
}
