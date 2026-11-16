import 'store.dart';

/// Cadastro de ministérios (coleção "ministerios"): cada um tem N pessoas, e uma pessoa pode estar
/// em vários. O vínculo fica no próprio membro (`ministerios`, lista de nomes), como sempre foi: as
/// escalas e a importação continuam lendo os nomes. Aqui o nome vira cadastro (renomear leva junto,
/// excluir tira das pessoas) e as atas de cada ministério ficam só para quem é dele.
///
/// Conselho, Diretoria e Assembleia são ministérios fixos (não podem ser excluídos): as atas formais
/// desses tipos pertencem a eles.
class Ministerios {
  Ministerios(this.store, {DateTime Function()? agora}) : _agora = agora ?? DateTime.now;

  final Store store;
  final DateTime Function() _agora;

  static const colecao = 'ministerios';

  /// Ministérios fixos, com o id igual ao tipo de ata formal correspondente.
  static const fixos = {'conselho': 'Conselho', 'diretoria': 'Diretoria', 'assembleia': 'Assembleia'};

  static const maximo = 80;

  /// "Música / Louvor " -> "musica / louvor": compara nomes sem acento, caixa ou espaços extras.
  static String chave(String nome) {
    const de = 'áàâãäéèêëíìîïóòôõöúùûüç', para = 'aaaaaeeeeiiiiooooouuuuc';
    final s = nome.trim().toLowerCase().replaceAll(RegExp(r'\s+'), ' ');
    return s.split('').map((c) => de.contains(c) ? para[de.indexOf(c)] : c).join();
  }

  List<Map<String, dynamic>> listar() =>
      [...store.listar(colecao)]..sort((a, b) {
          final fa = fixos.containsKey(a['id']) ? 0 : 1, fb = fixos.containsKey(b['id']) ? 0 : 1;
          if (fa != fb) return fa - fb;
          return chave(a['nome'] as String).compareTo(chave(b['nome'] as String));
        });

  Map<String, dynamic>? buscar(String id) => store.buscar(colecao, id);

  Map<String, dynamic>? porNome(String nome) {
    final k = chave(nome);
    if (k.isEmpty) return null;
    return store.listar(colecao).where((m) => chave(m['nome'] as String) == k).firstOrNull;
  }

  /// A pessoa ([membro], documento da coleção membros) está no ministério [ministerio]?
  static bool participa(Map<String, dynamic> membro, Map<String, dynamic> ministerio) {
    final k = chave(ministerio['nome'] as String);
    return (membro['ministerios'] as List? ?? const []).any((x) => x is String && chave(x) == k);
  }

  /// Ids dos ministérios de que o membro [membroId] participa (vazio se não houver membro).
  Set<String> doMembro(String? membroId) {
    final membro = membroId == null ? null : store.buscar('membros', membroId);
    if (membro == null) return const {};
    return {for (final m in store.listar(colecao)) if (participa(membro, m)) m['id'] as String};
  }

  /// Pessoas do ministério (id, nome), em ordem alfabética.
  List<Map<String, dynamic>> pessoas(String id) {
    final m = buscar(id);
    if (m == null) return const [];
    return [
      for (final p in store.listar('membros'))
        if (participa(p, m)) {'id': p['id'], 'nome': p['nome']},
    ]..sort((a, b) => chave('${a['nome']}').compareTo(chave('${b['nome']}')));
  }

  int quantas(Map<String, dynamic> ministerio) =>
      store.listar('membros').where((p) => participa(p, ministerio)).length;

  /// Nomes de ministério escritos nos cadastros de membros que ainda não estão no cadastro de
  /// ministérios (ex.: vindos da importação ou do cadastro pelo link), com quantas pessoas cada.
  Map<String, int> semCadastro() {
    final conhecidos = {for (final m in store.listar(colecao)) chave(m['nome'] as String)};
    final contagem = <String, int>{};
    final escrita = <String, String>{};
    for (final p in store.listar('membros')) {
      for (final x in (p['ministerios'] as List? ?? const []).whereType<String>()) {
        final k = chave(x);
        if (k.isEmpty || conhecidos.contains(k)) continue;
        escrita.putIfAbsent(k, () => x.trim());
        contagem[k] = (contagem[k] ?? 0) + 1;
      }
    }
    return {for (final e in contagem.entries) escrita[e.key]!: e.value};
  }

  // ---------- Alterações ----------

  static String _nome(Object? v) {
    if (v is! String || v.trim().isEmpty) throw const FormatException('Dê um nome ao ministério.');
    final n = v.trim().replaceAll(RegExp(r'\s+'), ' ');
    if (n.length > 60) throw const FormatException('Nome do ministério muito longo (até 60 letras).');
    if (n.contains(',') || n.contains('|')) throw const FormatException('O nome não pode ter vírgula nem barra vertical.');
    return n;
  }

  static String _descricao(Object? v) {
    if (v != null && v is! String) throw const FormatException('Descrição inválida.');
    final d = (v as String? ?? '').trim();
    if (d.length > 300) throw const FormatException('Descrição muito longa (até 300 letras).');
    return d;
  }

  Future<Map<String, dynamic>> criar(Map<String, dynamic> corpo) async {
    if (store.listar(colecao).length >= maximo) throw const FormatException('Limite de $maximo ministérios atingido.');
    final nome = _nome(corpo['nome']);
    if (porNome(nome) != null) throw const FormatException('Já existe um ministério com esse nome.');
    final doc = {'id': novoId(), 'nome': nome, 'descricao': _descricao(corpo['descricao']), 'criadoEm': _agora().toIso8601String()};
    await store.salvar(colecao, doc);
    return doc;
  }

  /// Renomear leva o nome novo para as pessoas do ministério e para as atas dele.
  Future<Map<String, dynamic>> editar(String id, Map<String, dynamic> corpo) async {
    final atual = buscar(id);
    if (atual == null) throw ArgumentError('Ministério não encontrado.');
    final nome = corpo.containsKey('nome') ? _nome(corpo['nome']) : atual['nome'] as String;
    if (fixos.containsKey(id) && nome != atual['nome']) throw const FormatException('Os ministérios fixos não podem ser renomeados.');
    final outro = porNome(nome);
    if (outro != null && outro['id'] != id) throw const FormatException('Já existe um ministério com esse nome.');
    final doc = {
      ...atual,
      'nome': nome,
      if (corpo.containsKey('descricao')) 'descricao': _descricao(corpo['descricao']),
    };
    if (nome != atual['nome']) {
      await _trocarNasPessoas(atual, (lista) => [for (final x in lista) chave(x) == chave(atual['nome'] as String) ? nome : x]);
      await store.salvarVarios('atas', [
        for (final a in store.listar('atas'))
          if (a['ministerioId'] == id) {...a, 'ministerio': nome},
      ]);
    }
    await store.salvar(colecao, doc);
    return doc;
  }

  /// Exclui o ministério e tira o nome dele das pessoas. Com atas, não exclui (elas perderiam o dono).
  Future<void> excluir(String id) async {
    final atual = buscar(id);
    if (atual == null) throw ArgumentError('Ministério não encontrado.');
    if (fixos.containsKey(id)) throw const FormatException('Conselho, Diretoria e Assembleia não podem ser excluídos.');
    final atas = store.listar('atas').where((a) => a['ministerioId'] == id).length;
    if (atas > 0) {
      throw FormatException('O ministério tem $atas ${atas == 1 ? 'ata' : 'atas'}: não pode ser excluído.');
    }
    await _trocarNasPessoas(atual, (lista) => [for (final x in lista) if (chave(x) != chave(atual['nome'] as String)) x]);
    await store.excluir(colecao, id);
  }

  /// Põe ([entrar]) ou tira as pessoas [membroIds] do ministério. Devolve a lista atualizada.
  Future<List<Map<String, dynamic>>> vincular(String id, List<String> membroIds, {required bool entrar}) async {
    final m = buscar(id);
    if (m == null) throw ArgumentError('Ministério não encontrado.');
    if (membroIds.length > 300) throw const FormatException('Pessoas demais de uma vez.');
    final nome = m['nome'] as String;
    final alterados = <Map<String, dynamic>>[];
    for (final membroId in membroIds) {
      final p = store.buscar('membros', membroId);
      if (p == null) throw FormatException('Pessoa não encontrada: $membroId.');
      final lista = [for (final x in (p['ministerios'] as List? ?? const []).whereType<String>()) x];
      final ja = lista.any((x) => chave(x) == chave(nome));
      if (entrar && !ja) {
        if (lista.length >= 12) throw FormatException('${p['nome']} já está em 12 ministérios (o máximo).');
        alterados.add({...p, 'ministerios': [...lista, nome]});
      } else if (!entrar && ja) {
        alterados.add({...p, 'ministerios': [for (final x in lista) if (chave(x) != chave(nome)) x]});
      }
    }
    if (alterados.isNotEmpty) await store.salvarVarios('membros', alterados);
    return pessoas(id);
  }

  Future<void> _trocarNasPessoas(Map<String, dynamic> ministerio, List<String> Function(List<String>) trocar) async {
    final alterados = <Map<String, dynamic>>[];
    for (final p in store.listar('membros')) {
      if (!participa(p, ministerio)) continue;
      final lista = [for (final x in (p['ministerios'] as List? ?? const []).whereType<String>()) x];
      alterados.add({...p, 'ministerios': trocar(lista)});
    }
    if (alterados.isNotEmpty) await store.salvarVarios('membros', alterados);
  }

  /// Na subida do servidor: cria Conselho, Diretoria e Assembleia, cadastra os nomes de ministério
  /// que já aparecem nas atas, e liga cada ata ao seu ministério (as formais pelo tipo; as de
  /// ministério pelo nome escrito). Os nomes soltos nos cadastros de membros não viram ministério
  /// sozinhos: aparecem em "Sem cadastro" para a secretaria decidir.
  Future<void> garantirPadroes() async {
    final agora = _agora().toIso8601String();
    final novos = <Map<String, dynamic>>[
      for (final e in fixos.entries)
        if (buscar(e.key) == null) {'id': e.key, 'nome': e.value, 'descricao': '', 'criadoEm': agora},
    ];
    if (novos.isNotEmpty) await store.salvarVarios(colecao, novos);
    final atas = <Map<String, dynamic>>[];
    for (final a in store.listar('atas')) {
      if (a.containsKey('ministerioId')) continue;
      final tipo = a['tipo'] as String? ?? '';
      String id = '';
      if (fixos.containsKey(tipo)) {
        id = tipo;
      } else if (tipo == 'ministerio' && (a['ministerio'] as String? ?? '').trim().isNotEmpty) {
        id = (porNome(a['ministerio'] as String) ?? await criar({'nome': a['ministerio']}))['id'] as String;
      }
      atas.add({...a, 'ministerioId': id, if (id.isNotEmpty) 'ministerio': buscar(id)!['nome']});
    }
    if (atas.isNotEmpty) await store.salvarVarios('atas', atas);
  }
}
