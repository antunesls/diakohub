import 'dart:io';

import 'package:diako_server/gestao_casa.dart';
import 'package:diako_server/store.dart';
import 'package:test/test.dart';

void main() {
  late Directory tmp;
  late Store store;
  late GestaoCasa casa;

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('diako_casa');
    store = Store(tmp.path);
    await store.carregar();
    casa = GestaoCasa(store, agora: () => DateTime(2026, 11, 20));
  });
  tearDown(() async { await store.fechar(); await tmp.delete(recursive: true); });

  test('pendência tem local, prazo e responsável; conclusão exige data e executor', () async {
    final tarefa = await casa.criarTarefa({'tipo': 'pendencia', 'titulo': 'Trocar lâmpada',
      'local': 'Salão', 'prazo': '2026-11-19', 'prioridade': 'alta', 'responsavel': 'João'}, por: 'Secretaria');
    expect(tarefa['estado'], 'aberta');
    expect(casa.listar()['tarefas'], hasLength(1));
    expect(() => casa.concluir(tarefa['id'] as String, {'data': '2026-11-20'}, por: 'Secretaria'), throwsFormatException);
    final feito = await casa.concluir(tarefa['id'] as String,
      {'data': '2026-11-20', 'executor': 'João', 'valor': 24.90, 'observacao': 'LED'}, por: 'Secretaria');
    expect(feito['estado'], 'concluida');
    expect((feito['historico'] as List).last['acao'], 'concluida');
    expect(feito['valor'], 24.90);
  });

  test('compra mensal no calendário conserva dia 5 após concluir atrasada e não duplica', () async {
    final rotina = await casa.criarRotina({'tipo': 'compra', 'titulo': 'Café', 'local': 'Cozinha',
      'prazo': '2026-11-05', 'intervalo': 1, 'unidade': 'mes', 'regraData': 'calendario',
      'quantidade': '3 pacotes'}, por: 'Secretaria');
    final primeira = (casa.listar()['tarefas'] as List).single as Map;
    expect(primeira['rotinaId'], rotina['id']);
    await casa.concluir(primeira['id'] as String, {'data': '2026-11-20', 'executor': 'Maria'}, por: 'Secretaria');
    final tarefas = casa.listar()['tarefas'] as List;
    expect(tarefas, hasLength(2));
    expect((tarefas.last as Map)['prazo'], '2026-12-05');
    expect(() => casa.concluir(primeira['id'] as String, {'data': '2026-11-20', 'executor': 'Maria'}, por: 'Secretaria'),
      throwsStateError);
    expect(casa.listar()['tarefas'], hasLength(2));
  });

  test('rotina por execução conta da conclusão; alterar modelo não reescreve histórico', () async {
    final rotina = await casa.criarRotina({'tipo': 'preventiva', 'titulo': 'Revisar ar-condicionado',
      'local': 'Salão', 'prazo': '2026-11-05', 'intervalo': 1, 'unidade': 'mes',
      'regraData': 'execucao'}, por: 'Secretaria');
    final primeira = (casa.listar()['tarefas'] as List).single as Map;
    await casa.concluir(primeira['id'] as String, {'data': '2026-11-20', 'executor': 'Técnico'}, por: 'Secretaria');
    expect(((casa.listar()['tarefas'] as List).last as Map)['prazo'], '2026-12-20');
    await casa.editarRotina(rotina['id'] as String, {'intervalo': 2}, por: 'Secretaria');
    expect((casa.listar()['tarefas'] as List).first, containsPair('prazo', '2026-11-05'));
    final segunda = (casa.listar()['tarefas'] as List).last as Map;
    await casa.concluir(segunda['id'] as String, {'data': '2026-12-21', 'executor': 'Técnico'}, por: 'Secretaria');
    expect(((casa.listar()['tarefas'] as List).last as Map)['prazo'], '2027-02-21');
  });

  test('datas de fim de mês respeitam dia original quando o mês é curto', () async {
    final rotina = await casa.criarRotina({'tipo': 'preventiva', 'titulo': 'Verificação',
      'prazo': '2026-01-31', 'intervalo': 1, 'unidade': 'mes', 'regraData': 'calendario'}, por: 'Secretaria');
    final primeira = (casa.listar()['tarefas'] as List).single as Map;
    await casa.concluir(primeira['id'] as String, {'data': '2026-02-02', 'executor': 'Equipe'}, por: 'Secretaria');
    final fevereiro = (casa.listar()['tarefas'] as List).last as Map;
    expect(fevereiro['prazo'], '2026-02-28');
    await casa.concluir(fevereiro['id'] as String, {'data': '2026-03-01', 'executor': 'Equipe'}, por: 'Secretaria');
    expect(((casa.listar()['tarefas'] as List).last as Map)['prazo'], '2026-03-31');
    expect(rotina['id'], isNotNull);
  });

  test('rotina pausada não gera ocorrência; ao reativar volta a ter tarefa aberta', () async {
    final rotina = await casa.criarRotina({'tipo': 'compra', 'titulo': 'Café',
      'prazo': '2026-11-05', 'intervalo': 1, 'unidade': 'mes', 'regraData': 'calendario'}, por: 'Equipe');
    await casa.editarRotina(rotina['id'] as String, {'ativa': false}, por: 'Equipe');
    final id = ((casa.listar()['tarefas'] as List).single as Map)['id'] as String;
    await casa.concluir(id, {'data': '2026-11-20', 'executor': 'Equipe'}, por: 'Equipe');
    expect(casa.listar()['tarefas'], hasLength(1));
    await casa.editarRotina(rotina['id'] as String, {'ativa': true}, por: 'Equipe');
    final tarefas = casa.listar()['tarefas'] as List;
    expect(tarefas, hasLength(2));
    expect((tarefas.last as Map)['prazo'], '2026-12-05');
  });
}
