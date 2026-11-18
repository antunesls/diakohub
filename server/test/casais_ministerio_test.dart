import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:diako_server/auth.dart';
import 'package:diako_server/casais_ministerio.dart';
import 'package:diako_server/email_casais.dart';
import 'package:diako_server/permissoes.dart';
import 'package:diako_server/store.dart';
import 'package:test/test.dart';

void main() {
  test('gestão de casais implica consulta, sem liberar fichas completas', () {
    final gestao = Permissao.porNome('casaisGerenciar');
    expect(gestao, isNotNull);
    final efetivas = Permissao.completar({gestao!});
    expect(efetivas, contains(Permissao.casais));
    expect(efetivas, isNot(contains(Permissao.membros)));
    for (final perfil in [
      Perfil.liderCasais,
      Perfil.pastor,
      Perfil.administrador
    ]) {
      expect(perfil.pode(gestao), isTrue);
    }
    expect(Perfil.secretaria.pode(gestao), isFalse);
    expect(Perfil.liderCasais.pode(Permissao.membros), isFalse);
  });

  test('rotas de leitura consultam; escrita, prévia e envio exigem gestão', () {
    for (final metodo in ['GET', 'HEAD']) {
      expect(permissaoDaRota(metodo, 'api/casais/contatos'), Permissao.casais);
    }
    for (final rota in [
      'contatos',
      'contatos/x/anular',
      'parabens/previa',
      'parabens/email'
    ]) {
      expect(
          permissaoDaRota('POST', 'api/casais/$rota').name, 'casaisGerenciar');
    }
    expect(permissaoDaRota('GET', 'api/casais-outro'), Permissao.admin);
  });

  group('histórico operacional', () {
    late Directory pasta;
    late Store store;
    late MinisterioCasais ministerio;
    final lider = Conta(
        id: 'l', nome: 'Líder', login: 'lider', perfil: Perfil.liderCasais);
    final consulta = Conta(
        id: 's',
        nome: 'Consulta',
        login: 'consulta',
        perfil: Perfil(
            id: 'consulta', nome: 'Consulta', permissoes: {Permissao.casais}));
    final semAcesso =
        Conta(id: 'x', nome: 'Outro', login: 'outro', perfil: Perfil.midia);
    Map<String, dynamic> corpo({String tipo = 'parabenizado'}) => {
          'membrosIds': ['b', 'a'],
          'dataCasamento': '2016-11-18',
          'tipo': tipo,
          if (tipo == 'parabenizado') 'ocorrencia': '2026-11-18',
          'realizadoEm': '2026-11-18',
        };
    setUp(() async {
      pasta = await Directory.systemTemp.createTemp('diako_ministerio_casais_');
      store = Store(pasta.path);
      await store.carregar();
      await store.salvarVarios('membros', [
        {
          'id': 'a',
          'nome': 'Ana',
          'status': 'membro',
          'conjugeId': 'b',
          'dataCasamento': '2016-11-18',
          'cpf': 'privado'
        },
        {
          'id': 'b',
          'nome': 'Bruno',
          'status': 'membro',
          'conjugeId': 'a',
          'dataCasamento': '2016-11-18'
        },
        {
          'id': 'c',
          'nome': 'Carla',
          'status': 'membro',
          'conjugeNome': 'Davi',
          'dataCasamento': '2020-02-29'
        },
      ]);
      ministerio =
          MinisterioCasais(store, agora: () => DateTime(2026, 11, 18, 12));
    });
    tearDown(() async {
      await store.fechar();
      await pasta.delete(recursive: true);
    });

    Map<String, dynamic> pedido() => {
          'membrosIds': ['a', 'b'],
          'dataCasamento': '2016-11-18',
          'ocorrencia': '2026-11-18',
          'destinatarioMembroId': 'a'
        };
    Future<void> habilitarEmail() => store.salvar('membros', {
          ...store.buscar('membros', 'a')!,
          'email': 'ana@example.test',
          'consentimentoEm': '2026-01-01'
        });

    test('nova autorização válida não é bloqueada pela revogação histórica', () async {
      await habilitarEmail();
      await store.salvar('membros', {...store.buscar('membros', 'a')!,
        'consentimentoRevogado': {'em': '2026-02-01T10:00:00', 'via': 'painel'},
        'consentimentoEm': '2026-03-01'});
      final previa = ministerio.previaParabens(pedido(), conta: lider);
      expect(previa['destinatario'], 'ana@example.test');
    });

    test('prévia exige gestão e consentimento mas não divulgação pública',
        () async {
      await habilitarEmail();
      final dynamic modulo = MinisterioCasais(store);
      expect(() => modulo.previaParabens(pedido(), conta: consulta),
          throwsStateError);
      final p = modulo.previaParabens(pedido(), conta: lider) as Map;
      expect(p['texto'], contains('10 anos'));
      expect(p['previaId'], isNotEmpty);
      expect(store.listar('casaisContatos'), isEmpty);
      await store.salvar('membros',
          {...store.buscar('membros', 'a')!, 'consentimentoEm': null});
      expect(() => modulo.previaParabens(pedido(), conta: lider),
          throwsFormatException);
    });

    for (final excluir in [false, true]) {
      test(
          'revalida entre reserva e início SMTP: ${excluir ? 'exclusão' : 'revogação'}',
          () async {
        await habilitarEmail();
        var enfileirou = false, envios = 0;
        late Store concorrente;
        concorrente = Store(pasta.path, gravar: (caminho, conteudo) async {
          await Store.gravarArquivo(caminho, conteudo);
          if (!enfileirou && caminho.endsWith('casaisEnvios.json')) {
            enfileirou = true;
            unawaited(concorrente.serializarCasais(() async {
              if (excluir) {
                await concorrente.excluir('membros', 'a');
                final recibo = concorrente.listar('casaisEnvios').single;
                await concorrente.excluir(
                    'casaisEnvios', recibo['id'] as String);
              } else {
                await concorrente.salvar('membros', {
                  ...concorrente.buscar('membros', 'a')!,
                  'consentimentoEm': null
                });
              }
            }));
          }
        });
        await concorrente.carregar();
        try {
          final modulo = MinisterioCasais(concorrente, enviar: (_) async {
            envios++;
          });
          final p = modulo.previaParabens(pedido(), conta: lider);
          final r = await modulo.enviarParabens(
              {...pedido(), 'previaId': p['previaId'], 'confirmar': true},
              conta: lider);
          expect(envios, 0);
          expect(r['estado'], 'nao_enviado');
          expect(concorrente.listar('casaisEnvios'),
              excluir ? isEmpty : hasLength(1));
          if (!excluir)
            expect(concorrente.listar('casaisEnvios').single['estado'],
                'nao_enviado');
        } finally {
          await concorrente.fechar();
        }
      });
    }

    test('confirmação vincula conteúdo, revalida contato e reserva antes SMTP',
        () async {
      await habilitarEmail();
      final enviados = <EmailCasais>[];
      final modulo = MinisterioCasais(store, enviar: (email) async {
        expect(store.listar('casaisEnvios').single['estado'], 'reservado');
        enviados.add(email);
      });
      final p = modulo.previaParabens(pedido(), conta: lider);
      await expectLater(
          modulo.enviarParabens({...pedido(), 'previaId': p['previaId']},
              conta: lider),
          throwsFormatException);
      await expectLater(
          modulo.enviarParabens({
            ...pedido(),
            'previaId': p['previaId'],
            'confirmar': true,
            'texto': 'Outro'
          }, conta: lider),
          throwsFormatException);
      final corpoEnvio = {
        ...pedido(),
        'previaId': p['previaId'],
        'confirmar': true
      };
      await modulo.enviarParabens(corpoEnvio, conta: lider);
      expect(enviados, hasLength(1));
      expect(store.listar('casaisContatos'), isEmpty);
      final nova = modulo.previaParabens(pedido(), conta: lider);
      await expectLater(
          modulo.enviarParabens({...corpoEnvio, 'previaId': nova['previaId']},
              conta: lider),
          throwsStateError);
      expect(enviados, hasLength(1));
    });

    test('revogação ou mudança de e-mail após prévia impede envio', () async {
      await habilitarEmail();
      final modulo =
          MinisterioCasais(store, enviar: (_) async => fail('Não enviar'));
      final p = modulo.previaParabens(pedido(), conta: lider);
      await store.salvar('membros',
          {...store.buscar('membros', 'a')!, 'email': 'outra@example.test'});
      await expectLater(
          modulo.enviarParabens(
              {...pedido(), 'previaId': p['previaId'], 'confirmar': true},
              conta: lider),
          throwsFormatException);
      await store.salvar('membros',
          {...store.buscar('membros', 'a')!, 'consentimentoEm': null});
      await expectLater(
          modulo.enviarParabens(
              {...pedido(), 'previaId': p['previaId'], 'confirmar': true},
              conta: lider),
          throwsFormatException);
    });

    test('falha ambígua persiste bloqueio após reinício sem expor erro SMTP',
        () async {
      await habilitarEmail();
      final modulo = MinisterioCasais(store,
          enviar: (_) async => throw Exception('segredo SMTP'));
      final p = modulo.previaParabens(pedido(), conta: lider);
      final r = await modulo.enviarParabens(
          {...pedido(), 'previaId': p['previaId'], 'confirmar': true},
          conta: lider);
      expect(r['estado'], 'incerto');
      expect(jsonEncode(r), isNot(contains('segredo')));
      final recarregado = Store(pasta.path);
      await recarregado.carregar();
      try {
        final outro = MinisterioCasais(recarregado,
            enviar: (_) async => fail('Não repetir'));
        final nova = outro.previaParabens(pedido(), conta: lider);
        await expectLater(
            outro.enviarParabens(
                {...pedido(), 'previaId': nova['previaId'], 'confirmar': true},
                conta: lider),
            throwsStateError);
      } finally {
        await recarregado.fechar();
      }
    });

    test(
        'consulta enriquecida preserva campos e não transfere histórico anulado',
        () async {
      final doc = await ministerio.registrarContato(corpo(), conta: lider);
      final casal = (ministerio.consultar(
              mes: 11, ano: 2026, conta: consulta)['casais'] as List)
          .single as Map;
      expect(casal['casalChave'], doc['casalChave']);
      expect((casal['parabenizado'] as Map)['usuarioNome'], 'Líder');
      expect(casal['contatosHistory'], hasLength(1));
      await ministerio.anularContato(doc['id'] as String, conta: lider);
      final atualizado = (ministerio.consultar(
              mes: 11, ano: 2026, conta: consulta)['casais'] as List)
          .single as Map;
      expect(atualizado['parabenizado'], isNull);
      expect(atualizado['contatosHistory'], hasLength(1));
      expect(() => ministerio.consultar(mes: 11, ano: 2026, conta: semAcesso),
          throwsStateError);
    });

    test('prévia expira, pertence ao autor e valida tipos estritamente',
        () async {
      await habilitarEmail();
      var agora = DateTime(2026, 11, 18, 12);
      final modulo = MinisterioCasais(store,
          agora: () => agora, enviar: (_) async => fail('Não enviar'));
      final p = modulo.previaParabens(pedido(), conta: lider);
      final outro = Conta(
          id: 'outro',
          nome: 'Outro',
          login: 'outro',
          perfil: Perfil.liderCasais);
      await expectLater(
          modulo.enviarParabens(
              {...pedido(), 'previaId': p['previaId'], 'confirmar': true},
              conta: outro),
          throwsFormatException);
      for (final alteracao in [
        {'texto': null},
        {'texto': 7},
        {'texto': ''},
        {'texto': 'x' * 10001},
        {'ocorrencia': '2026-11-17'},
        {'destinatarioMembroId': 'c'},
        {'usuarioId': 'forjado'}
      ]) {
        expect(
            () => modulo
                .previaParabens({...pedido(), ...alteracao}, conta: lider),
            throwsFormatException);
      }
      agora = agora.add(const Duration(minutes: 16));
      await expectLater(
          modulo.enviarParabens(
              {...pedido(), 'previaId': p['previaId'], 'confirmar': true},
              conta: lider),
          throwsFormatException);
    });

    test('duas instâncias compartilham reserva e SMTP não bloqueia limpeza',
        () async {
      await habilitarEmail();
      final iniciou = Completer<void>(), terminar = Completer<void>();
      var envios = 0;
      Future<void> transporte(EmailCasais _) async {
        envios++;
        iniciou.complete();
        await terminar.future;
      }

      final a = MinisterioCasais(store, enviar: transporte),
          b = MinisterioCasais(store, enviar: transporte);
      final pa = a.previaParabens(pedido(), conta: lider),
          pb = b.previaParabens(pedido(), conta: lider);
      final envio = a.enviarParabens(
          {...pedido(), 'previaId': pa['previaId'], 'confirmar': true},
          conta: lider);
      await iniciou.future;
      await expectLater(
          b.enviarParabens(
              {...pedido(), 'previaId': pb['previaId'], 'confirmar': true},
              conta: lider),
          throwsStateError);
      await store.serializarCasais(() async {
        final recibo = store.listar('casaisEnvios').single;
        expect(recibo['membrosIds'], ['a', 'b']);
        expect(recibo['destinatarioMembroId'], 'a');
        await store.excluir('casaisEnvios', recibo['id'] as String);
      }).timeout(const Duration(seconds: 2));
      terminar.complete();
      await envio;
      expect(envios, 1);
      expect(store.listar('casaisEnvios'), isEmpty);
    });

    test(
        'falha de disco na reserva não envia; falha no resultado mantém reserva',
        () async {
      await habilitarEmail();
      var gravacoes = 0, falharNa = 1, envios = 0;
      final falho = Store(pasta.path, gravar: (caminho, conteudo) async {
        if (caminho.endsWith('casaisEnvios.json') && ++gravacoes == falharNa)
          throw const FileSystemException('disco');
        await Store.gravarArquivo(caminho, conteudo);
      });
      await falho.carregar();
      try {
        final modulo = MinisterioCasais(falho, enviar: (_) async {
          envios++;
        });
        final p = modulo.previaParabens(pedido(), conta: lider);
        final enviar = {
          ...pedido(),
          'previaId': p['previaId'],
          'confirmar': true
        };
        await expectLater(modulo.enviarParabens(enviar, conta: lider),
            throwsA(isA<FileSystemException>()));
        expect(envios, 0);
        expect(falho.listar('casaisEnvios'), isEmpty);
        falharNa = 3;
        final r = await modulo.enviarParabens(enviar, conta: lider);
        expect(envios, 1);
        expect(r['estado'], 'incerto');
        expect(falho.listar('casaisEnvios').single['estado'], 'reservado');
      } finally {
        await falho.fechar();
      }
    });

    test('registra autoria autenticada e não modifica nem copia fichas',
        () async {
      final antes = jsonEncode(store.listar('membros'));
      final doc = await ministerio.registrarContato(corpo(), conta: lider);
      expect(doc['usuarioId'], 'l');
      expect(doc['usuarioNome'], 'Líder');
      expect(doc['membrosIds'], ['a', 'b']);
      expect(doc['registradoEm'], '2026-11-18T12:00:00.000');
      expect(doc['casalChave'], isNotEmpty);
      expect(jsonEncode(doc), isNot(contains('privado')));
      expect(jsonEncode(store.listar('membros')), antes);
      expect(ministerio.listarContatos(mes: 11, ano: 2026, conta: consulta),
          hasLength(1));
      expect(ministerio.listarContatos(mes: 10, ano: 2026, conta: consulta),
          isEmpty);
    });

    test('consulta não escreve e usuário de outra área não lê', () async {
      await expectLater(ministerio.registrarContato(corpo(), conta: consulta),
          throwsStateError);
      expect(
          () => ministerio.listarContatos(mes: 11, ano: 2026, conta: semAcesso),
          throwsStateError);
      expect(store.listar('casaisContatos'), isEmpty);
    });

    test('não duplica aniversário em chamadas concorrentes e após reinício',
        () async {
      final resultados = await Future.wait(List.generate(
          3, (_) => ministerio.registrarContato(corpo(), conta: lider)));
      expect(resultados.map((d) => d['id']).toSet(), hasLength(1));
      final recarregado = Store(pasta.path);
      await recarregado.carregar();
      try {
        final outro = MinisterioCasais(recarregado,
            agora: () => DateTime(2026, 11, 18, 12));
        final repetido = await outro.registrarContato(corpo(), conta: lider);
        expect(repetido['id'], resultados.first['id']);
        expect(recarregado.listar('casaisContatos'), hasLength(1));
      } finally {
        await recarregado.fechar();
      }
    });

    test('anulação preserva autoria e permite corrigir o registro', () async {
      final doc = await ministerio.registrarContato(corpo(), conta: lider);
      await expectLater(
          ministerio.anularContato(doc['id'] as String, conta: consulta),
          throwsStateError);
      final anulado =
          await ministerio.anularContato(doc['id'] as String, conta: lider);
      expect(anulado['anuladoPor'], 'l');
      expect(anulado['anuladoEm'], isNotNull);
      expect(anulado['usuarioId'], 'l');
      final novo = await ministerio.registrarContato(corpo(), conta: lider);
      expect(novo['id'], isNot(doc['id']));
      expect(store.listar('casaisContatos'), hasLength(2));
    });

    test(
        'nome externo e 29/02 usam identidade própria e aniversário normalizado',
        () async {
      final externo = {
        'membrosIds': ['c'],
        'conjugeNome': 'Davi',
        'dataCasamento': '2020-02-29',
        'tipo': 'parabenizado',
        'ocorrencia': '2026-02-28',
        'realizadoEm': '2026-02-28'
      };
      final doc = await ministerio.registrarContato(externo, conta: lider);
      expect(doc['membrosIds'], ['c']);
      await store.salvar('membros',
          {...store.buscar('membros', 'c')!, 'conjugeNome': 'Daniel'});
      await expectLater(ministerio.registrarContato(externo, conta: lider),
          throwsFormatException);
      final novo = await ministerio.registrarContato(
          {...externo, 'conjugeNome': 'Daniel'},
          conta: lider);
      expect(novo['casalChave'], isNot(doc['casalChave']));
    });

    test('mudança de data ou vínculo invalida cartão antigo', () async {
      await store.salvar('membros',
          {...store.buscar('membros', 'a')!, 'dataCasamento': '2017-11-18'});
      await expectLater(ministerio.registrarContato(corpo(), conta: lider),
          throwsFormatException);
      expect(store.listar('casaisContatos'), isEmpty);
    });

    test('troca de parceiro não transfere a marcação do aniversário', () async {
      final primeiro = await ministerio.registrarContato(corpo(), conta: lider);
      await store.salvarVarios('membros', [
        {...store.buscar('membros', 'a')!, 'conjugeId': 'd'},
        {
          'id': 'd',
          'nome': 'Daniel',
          'status': 'membro',
          'conjugeId': 'a',
          'dataCasamento': '2016-11-18'
        },
      ]);
      await expectLater(ministerio.registrarContato(corpo(), conta: lider),
          throwsFormatException);
      final segundo = await ministerio.registrarContato({
        ...corpo(),
        'membrosIds': ['a', 'd']
      }, conta: lider);
      expect(segundo['casalChave'], isNot(primeiro['casalChave']));
      expect(segundo['id'], isNot(primeiro['id']));
    });

    test('retornos não permitem alterar o histórico persistido por referência',
        () async {
      final doc = await ministerio.registrarContato(corpo(), conta: lider);
      (doc['membrosIds'] as List).clear();
      doc['usuarioId'] = 'forjado';
      final lista =
          ministerio.listarContatos(mes: 11, ano: 2026, conta: consulta);
      expect(lista.single['membrosIds'], ['a', 'b']);
      expect(lista.single['usuarioId'], 'l');
      (lista.single['membrosIds'] as List).clear();
      expect(store.listar('casaisContatos').single['membrosIds'], ['a', 'b']);
    });

    test('soma de perfis autoriza gestão sem conceder cadastro de membros',
        () async {
      final conta = Conta(
          id: 'multi',
          nome: 'Equipe',
          login: 'equipe',
          perfil:
              Perfil.combinado([Perfil.comissaoLouvor, Perfil.liderCasais]));
      final doc = await ministerio.registrarContato(corpo(), conta: conta);
      expect(doc['usuarioId'], 'multi');
      expect(conta.pode(Permissao.membros), isFalse);
    });

    test('convite e contato não exigem ocorrência de aniversário', () async {
      for (final tipo in ['convite_enviado', 'contato_realizado']) {
        final doc =
            await ministerio.registrarContato(corpo(tipo: tipo), conta: lider);
        expect(doc['tipo'], tipo);
        expect(doc.containsKey('ocorrencia'), isFalse);
      }
    });

    test(
        'rejeita dados íntimos, autoria forjada, datas e ocorrências inválidas',
        () async {
      for (final alteracao in [
        {'observacoes': 'íntimo'},
        {'usuarioId': 'admin'},
        {'casalChave': 'forjada'},
        {'tipo': 'aconselhamento'},
        {'realizadoEm': '2026-02-30'},
        {'realizadoEm': '2026-11-19'},
        {'ocorrencia': '2026-11-17'},
        {
          'membrosIds': ['a', 'a']
        },
      ]) {
        await expectLater(
            ministerio
                .registrarContato({...corpo(), ...alteracao}, conta: lider),
            throwsFormatException);
      }
      expect(
          () => ministerio.listarContatos(mes: 13, ano: 2026, conta: consulta),
          throwsFormatException);
      expect(store.listar('casaisContatos'), isEmpty);
    });

    test('falha de disco não publica registro e não trava a próxima operação',
        () async {
      var falhar = true;
      final falho = Store(pasta.path, gravar: (caminho, conteudo) async {
        if (falhar) throw const FileSystemException('disco cheio');
        await Store.gravarArquivo(caminho, conteudo);
      });
      await falho.carregar();
      try {
        final modulo =
            MinisterioCasais(falho, agora: () => DateTime(2026, 11, 18, 12));
        await expectLater(modulo.registrarContato(corpo(), conta: lider),
            throwsA(isA<FileSystemException>()));
        expect(falho.listar('casaisContatos'), isEmpty);
        falhar = false;
        await modulo.registrarContato(corpo(), conta: lider);
        expect(falho.listar('casaisContatos'), hasLength(1));
      } finally {
        await falho.fechar();
      }
    });
  });
}
