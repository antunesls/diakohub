import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// Título e cantor sugeridos a partir de um vídeo do YouTube (a pessoa confere antes de salvar).
class InfoYoutube {
  const InfoYoutube({required this.titulo, required this.cantor, required this.tituloVideo, required this.canal});

  /// Sugestões já limpas ("Ressuscita-me", "Aline Barros"); podem vir vazias quando não dá para saber.
  final String titulo, cantor;

  /// Como o YouTube mostra, para a pessoa comparar.
  final String tituloVideo, canal;

  Map<String, dynamic> toJson() => {'titulo': titulo, 'cantor': cantor, 'tituloVideo': tituloVideo, 'canal': canal};
}

/// Lê título e canal pelo oEmbed público do YouTube (sem chave). null se o vídeo não existe,
/// é privado ou o YouTube não respondeu.
Future<InfoYoutube?> buscarInfoYoutube(String idVideo, {http.Client? cliente}) async {
  final uri = Uri.https('www.youtube.com', '/oembed', {'url': 'https://www.youtube.com/watch?v=$idVideo', 'format': 'json'});
  final c = cliente ?? http.Client();
  try {
    final r = await c.get(uri).timeout(const Duration(seconds: 8));
    if (r.statusCode != 200) return null;
    final j = jsonDecode(utf8.decode(r.bodyBytes));
    if (j is! Map) return null;
    final titulo = (j['title'] as Object?)?.toString() ?? '';
    final canal = (j['author_name'] as Object?)?.toString() ?? '';
    if (titulo.trim().isEmpty) return null;
    return separarTituloYoutube(titulo, canal);
  } on Exception {
    return null; // sem internet, tempo esgotado ou resposta estranha: a pessoa preenche à mão
  } finally {
    if (cliente == null) c.close();
  }
}

// Penduricalhos de título de vídeo que não fazem parte do nome da música.
final _ruido = RegExp(
    r'\b(ao vivo|live|clipe|videoclipe|v[íi]deo ?clipe|oficial|official|music video|video|v[íi]deo|lyrics?|letra|'
    r'legendad[oa]|playback|[áa]udio|visualizer|hd|4k|ac[úu]stic[oa]|acoustic|remaster(izad[oa])?|cover|'
    r'vers[ãa]o|version|full|completo|com letra|karaok[eê]|instrumental)\b',
    caseSensitive: false);

// Canais que costumam ser de gravadora ou compilação, não do artista.
final _canalGravadora = RegExp(
    r'\b(music|m[úu]sica|records|gravadora|produ[çc][õo]es|som livre|channel|canal|louvores|hinos|playbacks?|'
    r'karaok[eê]|cifras?|letras|lyrics|tv|gospel|worship)\b',
    caseSensitive: false);

final _feat = RegExp(r'\s*[\(\[]?\s*\b(?:feat\.?|ft\.?|part\.?|participa[çc][ãa]o(?: especial)?(?: de)?)\s+([^\)\]\|]+)[\)\]]?',
    caseSensitive: false);

String _espacos(String s) => s.replaceAll(RegExp(r'\s+'), ' ').trim();

/// Só ruído, como "Ao Vivo", "Clipe Oficial" ou "Official Music Video".
bool _soRuido(String s) => _espacos(s.replaceAll(_ruido, ' ').replaceAll(RegExp(r'[^\p{L}\p{N}]', unicode: true), ' ')).isEmpty;

String _semAcento(String s) {
  const de = 'áàâãäéèêëíìîïóòôõöúùûüçñ', para = 'aaaaaeeeeiiiiooooouuuucn';
  final b = StringBuffer();
  for (final ch in s.toLowerCase().split('')) {
    final i = de.indexOf(ch);
    b.write(i >= 0 ? para[i] : ch);
  }
  return b.toString().replaceAll(RegExp(r'[^a-z0-9]'), '');
}

/// Separa "Aline Barros - Ressuscita-me (Ao Vivo)" em título e cantor, usando o canal para
/// decidir qual lado é o artista. Regras simples: erra às vezes, e a pessoa corrige na ficha.
InfoYoutube separarTituloYoutube(String tituloVideo, String canal) {
  final original = _espacos(tituloVideo);
  final canalLimpo = _espacos(canal
      .replaceAll(RegExp(r'\s*-\s*topic$', caseSensitive: false), '')
      .replaceAll(RegExp(r'vevo$', caseSensitive: false), '')
      .replaceAll(RegExp(r'\s*[\(\[]?\b(oficial|official)\b[\)\]]?\s*$', caseSensitive: false), ''));
  final canalEhArtista = canalLimpo.isNotEmpty && !_canalGravadora.hasMatch(canalLimpo);

  var t = original
      .replaceAll(RegExp(r'#[\p{L}\p{N}_]+', unicode: true), ' ') // hashtags
      .replaceAll(RegExp(r'[“”"]'), '');
  // Convidados: saem do título e vão para o cantor.
  final convidados = <String>[];
  t = t.replaceAllMapped(_feat, (m) {
    final nome = _espacos(m[1]!);
    if (nome.isNotEmpty && !_soRuido(nome)) convidados.add(nome);
    return ' ';
  });
  // "(Ao Vivo em SP)", "[Clipe Oficial]"...: sai o parêntese que fala do vídeo; "(Salmo 23)" fica.
  t = t.replaceAllMapped(RegExp(r'[\(\[\{]([^\)\]\}]*)[\)\]\}]'), (m) => _ruido.hasMatch(m[1]!) ? ' ' : m[0]!);

  final partes = [
    for (final parte in t.split(RegExp(r'\s+[-–—|•]\s+|\s*\|\s*|\s+//\s+')))
      if (_espacos(parte).isNotEmpty && !_soRuido(parte)) _espacos(parte),
  ];

  var titulo = '', cantor = '';
  if (partes.length >= 2) {
    final chaveCanal = _semAcento(canalLimpo);
    int? lado;
    if (chaveCanal.length >= 3) {
      for (var i = 0; i < partes.length && lado == null; i++) {
        final chave = _semAcento(partes[i]);
        if (chave.isNotEmpty && (chave == chaveCanal || chave.contains(chaveCanal) || chaveCanal.contains(chave))) lado = i;
      }
    }
    lado ??= 0; // o mais comum é "Artista - Música"
    cantor = partes[lado];
    titulo = [for (var i = 0; i < partes.length; i++) if (i != lado) partes[i]].first;
  } else if (partes.length == 1) {
    titulo = partes.single;
    if (canalEhArtista) cantor = canalLimpo;
  }
  if (convidados.isNotEmpty && cantor.isNotEmpty) cantor = '$cantor feat. ${convidados.join(', ')}';

  String limpar(String s) => _espacos(s.replaceAll(RegExp(r'^[\s\-–—|:,.]+|[\s\-–—|:,]+$'), ''));
  return InfoYoutube(titulo: limpar(titulo), cantor: limpar(cantor), tituloVideo: original, canal: _espacos(canal));
}
