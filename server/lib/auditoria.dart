import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

/// Trilha de auditoria das alterações do culto: quem mexeu em escalas, repertório,
/// músicas escolhidas, roteiros e indisponibilidades. Uma linha JSON por evento em
/// data/auditoria.jsonl — o arquivo só cresce (nada daqui é apagado ou reescrito pelo
/// servidor), entra no backup e é consultado na aba Auditoria do painel pela administração.
class Auditoria {
  Auditoria(String pastaDados, {DateTime Function()? relogio})
      : arquivo = File(p.join(pastaDados, 'auditoria.jsonl')),
        _agora = relogio ?? DateTime.now;

  final File arquivo;
  final DateTime Function() _agora;
  Future<void> _fila = Future.value();

  /// Tipos de evento (a listagem só aceita estes como filtro).
  static const tipos = ['escala', 'musicas', 'repertorio', 'roteiro', 'indisponibilidade'];

  /// Registra o evento. [usuario] e [perfil] identificam a conta responsável pela
  /// alteração. A gravação é serializada e melhor-esforço: uma falha aqui nunca
  /// derruba a operação que originou o registro, e a fila segue para os próximos.
  Future<void> registrar({
    required String tipo,
    required String acao,
    required String alvo,
    String detalhe = '',
    String usuario = '',
    String perfil = '',
  }) {
    if (!tipos.contains(tipo)) throw ArgumentError('Tipo de auditoria desconhecido: $tipo');
    final linha = jsonEncode({
      'quando': _agora().toIso8601String(),
      'usuario': usuario,
      if (perfil.isNotEmpty) 'perfil': perfil,
      'tipo': tipo,
      'acao': acao,
      'alvo': alvo,
      if (detalhe.isNotEmpty) 'detalhe': detalhe,
    });
    final escrita =
        _fila.then((_) => arquivo.writeAsString('$linha\n', mode: FileMode.append, flush: true));
    // A fila se recupera de falhas para não perder os eventos seguintes; quem aguarda
    // o retorno também não recebe o erro (a auditoria não pode derrubar a operação).
    _fila = escrita.then((_) {}, onError: (_) {});
    return _fila;
  }

  /// Eventos mais recentes primeiro, opcionalmente só de um [tipo].
  Future<List<Map<String, dynamic>>> listar({String? tipo, int limite = 300}) async {
    await _fila;
    if (!await arquivo.exists()) return [];
    final eventos = <Map<String, dynamic>>[];
    for (final l in (await arquivo.readAsLines()).reversed) {
      if (eventos.length >= limite) break;
      try {
        final e = Map<String, dynamic>.from(jsonDecode(l) as Map);
        if (tipo == null || tipo.isEmpty || e['tipo'] == tipo) eventos.add(e);
      } catch (_) {
        // Linha incompleta (ex: queda de energia): ignora.
      }
    }
    return eventos;
  }

  // ---------- Comparações que viram os detalhes legíveis ----------

  /// "Violão: João, Maria → Maria, Ana" (null quando nada mudou).
  static String? diffFuncao(String funcao, List<String> antes, List<String> depois) {
    if (_mesmaLista(antes, depois)) return null;
    return '$funcao: ${antes.isEmpty ? 'ninguém' : antes.join(', ')}'
        ' → ${depois.isEmpty ? 'ninguém' : depois.join(', ')}';
  }

  /// Mudanças na lista de músicas do culto: "+Título", "-Título" e "tom de Título: Em → G"
  /// (null quando nada mudou; só trocar a ordem também vale mudança).
  static String? diffMusicas(List<Map<String, dynamic>> antes, List<Map<String, dynamic>> depois) {
    String chave(Map m) => '${m['repertorioId'] ?? ''}|${m['titulo']}';
    String tomDe(Map m) => m['tom'] is String && (m['tom'] as String).isNotEmpty ? m['tom'] as String : '—';
    final deAntes = {for (final m in antes) chave(m): m};
    final deDepois = {for (final m in depois) chave(m): m};
    final mudancas = <String>[];
    for (final m in depois) {
      final antiga = deAntes[chave(m)];
      if (antiga == null) {
        mudancas.add('+${m['titulo']}');
      } else if (antiga['tom'] != m['tom']) {
        mudancas.add('tom de ${m['titulo']}: ${tomDe(antiga)} → ${tomDe(m)}');
      }
    }
    for (final m in antes) {
      if (!deDepois.containsKey(chave(m))) mudancas.add('-${m['titulo']}');
    }
    if (mudancas.isNotEmpty) return mudancas.join(' · ');
    if (!_mesmaLista([for (final m in antes) chave(m)], [for (final m in depois) chave(m)])) {
      return 'ordem das músicas alterada';
    }
    return null;
  }

  /// Campos do repertório que mudaram ("tom Diakonia: Em → G"), null quando nada mudou.
  /// "ativo" fica de fora porque acompanha o status (é derivado dele).
  static String? diffRepertorio(Map<String, dynamic> antes, Map<String, dynamic> depois) {
    const campos = {
      'titulo': 'título', 'cantor': 'cantor', 'compositor': 'compositor', 'ano': 'ano',
      'referencia': 'link', 'solicitadoPor': 'solicitado por', 'observacoes': 'observações',
      'status': 'status', 'tomOriginal': 'tom original', 'tomDiakonia': 'tom Diakonia',
      'tomSelecionado': 'tom selecionado', 'bpm': 'bpm',
      'biografiaCantor': 'biografia do cantor', 'biografiaCompositor': 'biografia do compositor',
    };
    String valor(Object? v) {
      final t = (v == null ? '' : '$v').replaceAll('\n', ' ').trim();
      if (t.isEmpty) return '—';
      return t.length <= 60 ? t : '${t.substring(0, 57)}…';
    }

    final mudancas = [
      for (final e in campos.entries)
        if (antes[e.key] != depois[e.key]) '${e.value}: ${valor(antes[e.key])} → ${valor(depois[e.key])}',
    ];
    return mudancas.isEmpty ? null : mudancas.join(' · ');
  }

  static bool _mesmaLista(List<String> a, List<String> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }
}
