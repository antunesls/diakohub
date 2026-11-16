import 'dart:io';

import 'package:diako_server/atas.dart';
import 'package:diako_server/ministerios.dart';
import 'package:diako_server/store.dart';
import 'package:test/test.dart';

void main() {
  late Directory tmp;
  late Store store;
  late Ministerios ministerios;

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('diako_ministerios');
    store = Store(tmp.path);
    await store.carregar();
    ministerios = Ministerios(store);
  });
  tearDown(() async {
    await store.fechar();
    await tmp.delete(recursive: true);
  });

  test('na subida: cria os fixos e liga as atas antigas ao ministério certo', () async {
    await store.salvarVarios('atas', [
      {'id': 'a1', 'tipo': 'conselho', 'data': '2026-01-10', 'status': 'aprovada'},
      {'id': 'a2', 'tipo': 'ministerio', 'ministerio': 'Jovens', 'data': '2026-02-10', 'status': 'rascunho'},
      {'id': 'a3', 'tipo': 'ministerio', 'ministerio': 'JOVENS ', 'data': '2026-03-10', 'status': 'rascunho'},
      {'id': 'a4', 'tipo': 'outra', 'data': '2026-04-10', 'status': 'rascunho'},
    ]);
    await store.salvarVarios('membros', [
      {'id': 'm1', 'nome': 'Ana', 'ministerios': ['Jovens', 'Dança']},
    ]);
    // Antes da migração (ex.: backup antigo restaurado): a de ministério nunca fica aberta a todos.
    expect(AcessoAtas.donoDa(store.buscar('atas', 'a2')!), '?');
    expect(AcessoAtas.donoDa(store.buscar('atas', 'a1')!), 'conselho');
    expect(const AcessoAtas().ve(store.buscar('atas', 'a2')!), isFalse);

    await ministerios.garantirPadroes();
    final nomes = [for (final m in ministerios.listar()) m['nome']];
    expect(nomes, ['Assembleia', 'Conselho', 'Diretoria', 'Jovens'], reason: 'fixos primeiro; "JOVENS " é o mesmo');
    final jovens = ministerios.porNome('jovens')!['id'];
    expect(store.buscar('atas', 'a1')!['ministerioId'], 'conselho');
    expect(store.buscar('atas', 'a2')!['ministerioId'], jovens);
    expect(store.buscar('atas', 'a3')!['ministerioId'], jovens);
    expect(store.buscar('atas', 'a4')!['ministerioId'], '', reason: '"Outra" sem ministério: para todos com acesso às atas');
    expect(ministerios.doMembro('m1'), {jovens});
    expect(ministerios.semCadastro(), {'Dança': 1}, reason: 'nome solto no cadastro de membro não vira ministério sozinho');

    // Rodar de novo não duplica nem mexe no que já foi ligado.
    await ministerios.garantirPadroes();
    expect(ministerios.listar(), hasLength(4));
  });

  test('excluir tira o nome das pessoas; renomear troca nas pessoas', () async {
    final danca = await ministerios.criar({'nome': 'Dança'});
    await store.salvar('membros', {'id': 'm1', 'nome': 'Ana', 'ministerios': ['danca', 'Louvor']});
    await ministerios.editar(danca['id'] as String, {'nome': 'Dança e Artes'});
    expect(store.buscar('membros', 'm1')!['ministerios'], ['Dança e Artes', 'Louvor']);
    await ministerios.excluir(danca['id'] as String);
    expect(store.buscar('membros', 'm1')!['ministerios'], ['Louvor']);
    await expectLater(ministerios.criar({'nome': 'A, B'}), throwsFormatException);
  });
}
