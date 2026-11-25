import 'dart:convert';
import 'dart:typed_data';

import 'package:diako_core/diako_core.dart';
import 'package:image/image.dart' as img;
import 'package:qr/qr.dart';

// Página inicial pública (/): PIX, horários dos cultos, links e convite de calendário.

/// "Copia e cola" do PIX estático (BR Code do Banco Central), sem valor definido.
/// [nome] e [cidade] vão sem acento e em maiúsculas (limites de 25 e 15 caracteres do padrão).
String payloadPix({required String chave, required String nome, required String cidade}) {
  String campo(String id, String valor) => '$id${valor.length.toString().padLeft(2, '0')}$valor';
  final conta = campo('00', 'br.gov.bcb.pix') + campo('01', chave.trim());
  final semCrc = campo('00', '01') +
      campo('26', conta) +
      campo('52', '0000') +
      campo('53', '986') +
      campo('58', 'BR') +
      campo('59', _textoPix(nome, 25)) +
      campo('60', _textoPix(cidade, 15)) +
      campo('62', campo('05', '***')) +
      '6304';
  return semCrc + crc16Pix(semCrc);
}

/// Chave como o Pix exige: CNPJ, CPF e telefone só com dígitos (o telefone com +).
/// E-mail e chave aleatória ficam como foram digitados.
String normalizarChavePix(String chave) {
  final t = chave.trim();
  if (t.contains('@') || !RegExp(r'^[+\d][\d\s.()/-]*$').hasMatch(t)) return t;
  final digitos = t.replaceAll(RegExp(r'\D'), '');
  return t.startsWith('+') ? '+$digitos' : digitos;
}

/// Chave para mostrar na página: CNPJ como 12.345.678/0001-99 e CPF como 123.456.789-09.
String formatarChavePix(String chave) {
  final m14 = RegExp(r'^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$').firstMatch(chave);
  if (m14 != null) return '${m14[1]}.${m14[2]}.${m14[3]}/${m14[4]}-${m14[5]}';
  final m11 = RegExp(r'^(\d{3})(\d{3})(\d{3})(\d{2})$').firstMatch(chave);
  if (m11 != null) return '${m11[1]}.${m11[2]}.${m11[3]}-${m11[4]}';
  return chave;
}

/// CRC16-CCITT (polinômio 0x1021, valor inicial 0xFFFF), em 4 dígitos hexadecimais maiúsculos.
String crc16Pix(String texto) {
  var crc = 0xFFFF;
  for (final b in texto.codeUnits) {
    crc ^= b << 8;
    for (var i = 0; i < 8; i++) {
      crc = (crc & 0x8000) != 0 ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toRadixString(16).toUpperCase().padLeft(4, '0');
}

String _textoPix(String s, int max) {
  const de = 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ';
  const para = 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn';
  final b = StringBuffer();
  for (final c in s.trim().split('')) {
    final i = de.indexOf(c);
    final t = i >= 0 ? para[i] : c;
    if (RegExp(r'[A-Za-z0-9 ]').hasMatch(t)) b.write(t);
  }
  final r = b.toString().toUpperCase().replaceAll(RegExp(r'\s+'), ' ').trim();
  return r.length > max ? r.substring(0, max) : r;
}

/// PNG quadrado (fundo branco) com o QR do PIX.
Uint8List gerarPngQrQuadrado(String conteudo, {int tamanho = 600}) {
  final qr = QrImage(QrCode.fromData(data: conteudo, errorCorrectLevel: QrErrorCorrectLevel.M));
  const margem = 4;
  final total = qr.moduleCount + margem * 2;
  final escala = (tamanho / total).floor();
  final lado = total * escala;
  final imagem = img.Image(width: lado, height: lado);
  img.fill(imagem, color: img.ColorRgb8(255, 255, 255));
  final preto = img.ColorRgb8(0, 0, 0);
  for (var linha = 0; linha < qr.moduleCount; linha++) {
    for (var coluna = 0; coluna < qr.moduleCount; coluna++) {
      if (!qr.isDark(linha, coluna)) continue;
      final x = (coluna + margem) * escala, y = (linha + margem) * escala;
      img.fillRect(imagem, x1: x, y1: y, x2: x + escala - 1, y2: y + escala - 1, color: preto);
    }
  }
  return img.encodePng(imagem);
}

/// "Domingo — 19h" (uma linha por culto; separador —, –, |, " - " ou " -- ") vira {dia, hora}.
/// Sem separador, a linha inteira vai em "dia".
List<Map<String, String>> lerCultos(String texto) => [
      for (final linha in texto.split('\n').map((l) => l.trim()).where((l) => l.isNotEmpty))
        () {
          final m = RegExp(r'^(.*?)\s*(?:—|–|\||\s--?\s)\s*(.+)$').firstMatch(linha);
          return m == null ? {'dia': linha, 'hora': ''} : {'dia': m.group(1)!.trim(), 'hora': m.group(2)!.trim()};
        }(),
    ];

/// Abre o endereço no Google Maps (no celular, abre o app de mapas).
String linkMapa(String endereco) =>
    'https://www.google.com/maps/search/?api=1&query=${Uri.encodeQueryComponent(endereco)}';

/// Link de conversa no WhatsApp (números brasileiros sem DDI ganham o 55).
String linkWhatsapp(String digitos) => 'https://wa.me/${digitos.length <= 11 ? '55$digitos' : digitos}';

String _dd(int n) => n.toString().padLeft(2, '0');
String _dataCompacta(DateTime d) => '${d.year}${_dd(d.month)}${_dd(d.day)}';
String _utcCompacta(DateTime u) => '${_dataCompacta(u)}T${_dd(u.hour)}${_dd(u.minute)}${_dd(u.second)}Z';

/// Horário da igreja (Brasília, como os eventos chegam da agenda) em UTC, no formato do calendário.
/// O Brasil não tem horário de verão desde 2019.
String _utcDeBrasilia(DateTime d) =>
    _utcCompacta(DateTime.utc(d.year, d.month, d.day, d.hour, d.minute, d.second).add(const Duration(hours: 3)));

/// Fim usado no calendário: evento sem duração (ou com fim antes do início) fica com 1 hora.
DateTime _fimDoEvento(Evento e) => e.fim.isAfter(e.inicio) ? e.fim : e.inicio.add(const Duration(hours: 1));

/// Link "adicionar evento" do Google Agenda, já preenchido. No Android é o caminho que funciona:
/// o app do Google Agenda não abre arquivos .ics.
String linkGoogleAgenda(Evento e, {required String igreja}) {
  final datas = e.diaInteiro
      ? '${_dataCompacta(e.inicio)}/${_dataCompacta(e.fim.isAfter(e.inicio) ? e.fim : e.inicio.add(const Duration(days: 1)))}'
      : '${_utcDeBrasilia(e.inicio)}/${_utcDeBrasilia(_fimDoEvento(e))}';
  return Uri.https('calendar.google.com', '/calendar/render', {
    'action': 'TEMPLATE',
    'text': e.titulo,
    'dates': datas,
    'details': [e.descricao, igreja].where((t) => t.isNotEmpty).join('\n\n'),
    if (e.local.isNotEmpty) 'location': e.local,
  }).toString();
}

String _escIcs(String s) =>
    s.replaceAll(r'\', r'\\').replaceAll(';', r'\;').replaceAll(',', r'\,').replaceAll(RegExp(r'\r?\n'), r'\n');

/// Um VEVENT. O UID é estável (vem do id do evento, por ocorrência), então numa assinatura o
/// calendário atualiza o mesmo evento em vez de duplicar.
List<String> _vevento(Evento e, {required String igreja, required String dtstamp}) => [
      'BEGIN:VEVENT',
      'UID:${e.id.replaceAll(RegExp(r'[^A-Za-z0-9._@-]'), '_')}@diakonews',
      'DTSTAMP:$dtstamp',
      if (e.diaInteiro) ...[
        'DTSTART;VALUE=DATE:${_dataCompacta(e.inicio)}',
        'DTEND;VALUE=DATE:${_dataCompacta(e.fim.isAfter(e.inicio) ? e.fim : e.inicio.add(const Duration(days: 1)))}',
      ] else ...[
        'DTSTART:${_utcDeBrasilia(e.inicio)}',
        'DTEND:${_utcDeBrasilia(_fimDoEvento(e))}',
      ],
      'SUMMARY:${_escIcs(e.titulo)}',
      if (e.local.isNotEmpty) 'LOCATION:${_escIcs(e.local)}',
      'DESCRIPTION:${_escIcs([e.descricao, igreja].where((t) => t.isNotEmpty).join('\n\n'))}',
      'END:VEVENT',
    ];

/// Linhas de no máximo 75 bytes, continuadas com espaço (RFC 5545 §3.1), sem partir um caractere.
String _dobrarIcs(List<String> linhas) {
  final saida = StringBuffer();
  for (final linha in linhas) {
    var bytes = 0;
    var limite = 75;
    for (final rune in linha.runes) {
      final tamanho = utf8.encode(String.fromCharCode(rune)).length;
      if (bytes + tamanho > limite) {
        saida.write('\r\n ');
        bytes = 1;
        limite = 75;
      }
      saida.writeCharCode(rune);
      bytes += tamanho;
    }
    saida.write('\r\n');
  }
  return saida.toString();
}

List<String> _cabecalhoIcs() =>
    ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DiakoNews//Agenda//PT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];

/// Convite de calendário (.ics) de um evento, para o botão "+ Agenda" do site (iPhone, Outlook,
/// computador). [agora] é o instante da geração (DTSTAMP).
String icsDoEvento(Evento e, {required String igreja, required DateTime agora}) => _dobrarIcs([
      ..._cabecalhoIcs(),
      ..._vevento(e, igreja: igreja, dtstamp: _utcCompacta(agora.toUtc())),
      'END:VCALENDAR',
    ]);

/// Agenda inteira para assinar no celular (/agenda.ics): o calendário volta a buscar este endereço
/// sozinho, então eventos novos, mudanças e cancelamentos chegam sem a pessoa fazer nada.
/// REFRESH-INTERVAL e X-PUBLISHED-TTL pedem para atualizar a cada 4 horas (o Google decide o próprio ritmo).
String icsDaAgenda(List<Evento> eventos, {required String igreja, required DateTime agora}) {
  final dtstamp = _utcCompacta(agora.toUtc());
  return _dobrarIcs([
    ..._cabecalhoIcs(),
    'X-WR-CALNAME:${_escIcs('Agenda — $igreja')}',
    'X-WR-CALDESC:${_escIcs('Eventos publicados no site da $igreja.')}',
    'X-WR-TIMEZONE:America/Sao_Paulo',
    'REFRESH-INTERVAL;VALUE=DURATION:PT4H',
    'X-PUBLISHED-TTL:PT4H',
    for (final e in eventos) ..._vevento(e, igreja: igreja, dtstamp: dtstamp),
    'END:VCALENDAR',
  ]);
}

/// Endereços para assinar a agenda: o https (copiar, Outlook), o webcal (abre "Assinar calendário"
/// no iPhone e no Mac) e o do Google Agenda, que já recebe o webcal para adicionar.
Map<String, String> enderecosAssinatura(String urlBase) {
  final https = '${urlBase.replaceFirst(RegExp(r'/+$'), '')}/agenda.ics';
  final webcal = https.replaceFirst(RegExp(r'^https?://'), 'webcal://');
  return {
    'ics': https,
    'webcal': webcal,
    'google': Uri.https('calendar.google.com', '/calendar/r', {'cid': webcal}).toString(),
  };
}
