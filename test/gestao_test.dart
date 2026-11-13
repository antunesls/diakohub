import 'dart:io';

import 'package:diako_news/ui/gestao/gestao_page.dart';
import 'package:diako_news/ui/home_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'apoio/app_falso.dart';

/// Área de Gestão (membros, casa, atas) no tamanho do Galaxy Tab A9+ deitado, sobre o servidor falso.
void main() {
  late Directory pasta;
  setUp(() async => pasta = await Directory.systemTemp.createTemp('diako_gestao'));
  tearDown(() async {
    try {
      await pasta.delete(recursive: true);
    } on FileSystemException {
      // Windows às vezes segura o cache; é pasta temporária.
    }
  });

  /// Deixa as respostas do servidor falso (IO de verdade) chegarem e redesenha.
  Future<void> esperar(WidgetTester tester, [int rodadas = 8]) async {
    for (var i = 0; i < rodadas; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
      await tester.pump();
    }
  }

  Future<ServidorFalso> abrir(WidgetTester tester, Widget home) async {
    tester.view.physicalSize = const Size(1920, 1200);
    tester.view.devicePixelRatio = 1.5;
    addTearDown(tester.view.reset);
    final servidor = ServidorFalso(DateTime.now());
    final app = await tester.runAsync(() => montarApp(servidor, pasta, home));
    await tester.pumpWidget(app!);
    await esperar(tester);
    return servidor;
  }

  testWidgets('botão Gestão no trilho abre a área separada com as três abas', (tester) async {
    await abrir(tester, const HomePage());
    await tester.tap(find.byKey(const Key('abrir-gestao')));
    await tester.pumpAndSettle();
    await esperar(tester);
    expect(find.text('Gestão pastoral'), findsOneWidget);
    expect(find.text('Membros'), findsWidgets);
    expect(find.text('Gestão da Casa'), findsOneWidget);
    expect(find.text('Atas'), findsOneWidget);
    // Fora do operacional: sem a coluna do palco nem a chave de projeção.
    expect(find.byKey(const Key('chave-projecao')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('membros: lista os ativos, ficha com WhatsApp e família, sem CPF e sem cópia no tablet', (tester) async {
    await abrir(tester, const GestaoPage());
    expect(find.text('Ana Paula Souza'), findsOneWidget);
    expect(find.text('Caio Torres'), findsNothing); // visitante fica no outro filtro
    await tester.tap(find.text('Ana Paula Souza'));
    await tester.pumpAndSettle();
    expect(find.textContaining('WhatsApp (11) 98765-4321'), findsOneWidget);
    expect(find.text('Cônjuge: Jorge Souza'), findsOneWidget);
    expect(find.textContaining('123456789'), findsNothing);
    await tester.tap(find.text('Cônjuge: Jorge Souza'));
    await tester.pumpAndSettle();
    expect(find.text('Jorge Souza'), findsWidgets);
    await tester.tap(find.text('Visitantes'));
    await tester.pumpAndSettle();
    expect(find.text('Caio Torres'), findsOneWidget);
    final arquivos = pasta.listSync().map((f) => f.uri.pathSegments.last.toLowerCase());
    expect(arquivos.where((p) => p.contains('membro') || p.contains('casa') || p.contains('ata')), isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets('casa: mostra atrasadas e conclui tarefa pelo tablet', (tester) async {
    final servidor = await abrir(tester, const GestaoPage());
    await tester.tap(find.text('Gestão da Casa'));
    await tester.pumpAndSettle();
    await esperar(tester);
    expect(find.text('1 atrasadas'), findsOneWidget);
    expect(find.text('Trocar lâmpada do salão'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Concluir').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Registrar conclusão'));
    await tester.pump();
    await esperar(tester);
    expect(servidor.gestao, contains('POST /api/casa/tarefas/t1/concluir'));
    expect(servidor.corposGestao.last['executor'], 'Sérgio');
    expect(tester.takeException(), isNull);
  });

  testWidgets('atas: lê a ata e conclui encaminhamento pendente', (tester) async {
    final servidor = await abrir(tester, const GestaoPage());
    await tester.tap(find.text('Atas'));
    await tester.pumpAndSettle();
    await esperar(tester);
    final titulo = find.textContaining('Ata nº 4/');
    expect(titulo, findsOneWidget);
    await tester.tap(titulo);
    await tester.pumpAndSettle();
    expect(find.text('Deliberação: Aprovado o orçamento B.'), findsOneWidget);
    await tester.tap(find.textContaining('Encaminhamentos pendentes'));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(Checkbox).first);
    await tester.pump();
    await esperar(tester);
    expect(servidor.gestao, contains('PUT /api/atas/a1/encaminhamentos/e1'));
    expect(servidor.corposGestao.last['concluido'], isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('fecha sozinha depois do tempo parado e volta para a tela anterior', (tester) async {
    await abrir(tester, Builder(
      builder: (context) => Scaffold(
        body: Center(
          child: FilledButton(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => const GestaoPage(inatividade: Duration(seconds: 2)))),
            child: const Text('Entrar'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('Entrar'));
    await tester.pumpAndSettle();
    await esperar(tester);
    expect(find.text('Gestão pastoral'), findsOneWidget);
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();
    expect(find.text('Gestão pastoral'), findsNothing);
    expect(find.text('Entrar'), findsOneWidget);
  });
}
