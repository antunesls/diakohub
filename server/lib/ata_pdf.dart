import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import 'atas.dart';
import 'escala_pdf.dart' show textoLatin1;

// Mesmas cores do PDF da escala (identidade do site).
final _verde = PdfColor.fromHex('1F5F5B');
final _verdeEscuro = PdfColor.fromHex('172C29');
final _cinza = PdfColor.fromHex('52615E');
final _borda = PdfColor.fromHex('BBC9C6');
final _fundo = PdfColor.fromHex('E4EFED');

String _dataBr(String? iso) {
  if (iso == null || iso.length < 10) return '';
  return '${iso.substring(8, 10)}/${iso.substring(5, 7)}/${iso.substring(0, 4)}';
}

/// PDF da ata em A4 retrato: cabeçalho da igreja, dados da reunião, presença, pauta,
/// encaminhamentos, retificações e linhas de assinatura.
Future<Uint8List> gerarAtaPdf(Map<String, dynamic> ata, {required String igreja, Uint8List? logo}) async {
  String t(Object? v) => textoLatin1((v as String? ?? '').trim());
  final nomeIgreja = t(igreja);
  final titulo = textoLatin1(Atas.titulo(ata));
  final imagem = logo == null ? null : pw.MemoryImage(logo);
  final presentes = (ata['presentes'] as List? ?? const []).cast<Map>();
  final ausentes = (ata['ausentes'] as List? ?? const []).cast<Map>();
  final pauta = (ata['pauta'] as List? ?? const []).cast<Map>();
  final encaminhamentos = (ata['encaminhamentos'] as List? ?? const []).cast<Map>();
  final retificacoes = (ata['retificacoes'] as List? ?? const []).cast<Map>();
  final horario = [t(ata['horaInicio']), t(ata['horaFim'])].where((h) => h.isNotEmpty).join(' às ');
  final situacao = switch (ata['status']) {
    'aprovada' => 'Aprovada em ${_dataBr(ata['aprovadaEm'] as String?)}',
    'finalizada' => Atas.formal(ata) ? 'Aguardando aprovação' : 'Finalizada',
    _ => 'RASCUNHO',
  };

  pw.Widget secao(String nome) => pw.Padding(
        padding: const pw.EdgeInsets.only(top: 14, bottom: 6),
        child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
          pw.Text(nome.toUpperCase(),
              style: pw.TextStyle(fontSize: 10, fontWeight: pw.FontWeight.bold, color: _verde, letterSpacing: 1)),
          pw.Divider(color: _borda, thickness: .6, height: 6),
        ]),
      );
  // Paragraph (e não Text) para um texto longo poder continuar na página seguinte.
  pw.Widget paragrafo(String texto, {double tamanho = 10.5}) => pw.Paragraph(
      text: texto, margin: const pw.EdgeInsets.only(bottom: 4), style: pw.TextStyle(fontSize: tamanho, lineSpacing: 2));
  String pessoa(Map p) => [t(p['nome']), if (t(p['justificativa']).isNotEmpty) '(${t(p['justificativa'])})'].join(' ');

  final dados = <(String, String)>[
    ('Data', _dataBr(ata['data'] as String?)),
    if (horario.isNotEmpty) ('Horário', horario),
    if (t(ata['local']).isNotEmpty) ('Local', t(ata['local'])),
    if (t(ata['ministerio']).isNotEmpty) ('Ministério', t(ata['ministerio'])),
    if (t(ata['presidente']).isNotEmpty) ('Presidência', t(ata['presidente'])),
    if (t(ata['secretario']).isNotEmpty) ('Secretaria', t(ata['secretario'])),
    ('Situação', situacao),
  ];

  final doc = pw.Document(title: titulo, author: nomeIgreja);
  doc.addPage(pw.MultiPage(
    pageFormat: PdfPageFormat.a4,
    margin: const pw.EdgeInsets.fromLTRB(48, 42, 48, 36),
    header: (ctx) => ctx.pageNumber == 1
        ? pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
            pw.Row(children: [
              if (imagem != null) pw.Image(imagem, width: 50, height: 50, fit: pw.BoxFit.contain),
              if (imagem != null) pw.SizedBox(width: 14),
              pw.Expanded(
                child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
                  pw.Text(nomeIgreja.toUpperCase(),
                      style: pw.TextStyle(fontSize: 9, fontWeight: pw.FontWeight.bold, color: _verde)),
                  pw.Text(titulo, style: pw.TextStyle(fontSize: 18, fontWeight: pw.FontWeight.bold, color: _verdeEscuro)),
                ]),
              ),
            ]),
            pw.Divider(color: _verde, thickness: 1.6, height: 18),
          ])
        : pw.Column(children: [
            pw.Text('$nomeIgreja · $titulo', style: pw.TextStyle(fontSize: 9, color: _cinza)),
            pw.Divider(color: _borda, thickness: .6, height: 10),
          ]),
    footer: (ctx) => pw.Row(children: [
      pw.Expanded(child: pw.Text(ata['sigilosa'] == true ? 'Documento sigiloso' : nomeIgreja,
          style: pw.TextStyle(fontSize: 8.5, color: _cinza))),
      pw.Text('Página ${ctx.pageNumber} de ${ctx.pagesCount}', style: pw.TextStyle(fontSize: 8.5, color: _cinza)),
    ]),
    build: (ctx) => [
      pw.Container(
        padding: const pw.EdgeInsets.all(10),
        color: _fundo,
        child: pw.Table(columnWidths: const {0: pw.FixedColumnWidth(90), 1: pw.FlexColumnWidth()}, children: [
          for (final (rotulo, valor) in dados)
            pw.TableRow(children: [
              pw.Padding(padding: const pw.EdgeInsets.symmetric(vertical: 2),
                  child: pw.Text(rotulo, style: pw.TextStyle(fontSize: 9.5, fontWeight: pw.FontWeight.bold, color: _verdeEscuro))),
              pw.Padding(padding: const pw.EdgeInsets.symmetric(vertical: 2), child: pw.Text(valor, style: const pw.TextStyle(fontSize: 10))),
            ]),
        ]),
      ),
      if (presentes.isNotEmpty || ausentes.isNotEmpty) secao('Presença'),
      if (presentes.isNotEmpty) paragrafo('Presentes (${presentes.length}): ${presentes.map(pessoa).join('; ')}.'),
      if (ausentes.isNotEmpty) paragrafo('Ausentes (${ausentes.length}): ${ausentes.map(pessoa).join('; ')}.'),
      if (pauta.isNotEmpty) secao('Pauta e deliberações'),
      for (final (i, item) in pauta.indexed) ...[
        pw.Padding(padding: const pw.EdgeInsets.only(top: 6, bottom: 3),
            child: pw.Text('${i + 1}. ${t(item['titulo'])}',
                style: pw.TextStyle(fontSize: 11, fontWeight: pw.FontWeight.bold, color: _verdeEscuro))),
        for (final linha in t(item['discussao']).split('\n')) if (linha.trim().isNotEmpty) paragrafo(linha),
        if (t(item['deliberacao']).isNotEmpty)
          pw.Container(
            margin: const pw.EdgeInsets.only(top: 2, bottom: 4),
            padding: const pw.EdgeInsets.fromLTRB(8, 4, 4, 4),
            decoration: pw.BoxDecoration(border: pw.Border(left: pw.BorderSide(color: _verde, width: 2.5))),
            child: pw.Text('Deliberação: ${t(item['deliberacao'])}',
                style: pw.TextStyle(fontSize: 10.5, fontWeight: pw.FontWeight.bold)),
          ),
      ],
      if (encaminhamentos.isNotEmpty) secao('Encaminhamentos'),
      if (encaminhamentos.isNotEmpty)
        pw.Table(
          border: pw.TableBorder.all(color: _borda, width: .6),
          columnWidths: const {1: pw.FixedColumnWidth(110), 2: pw.FixedColumnWidth(62), 3: pw.FixedColumnWidth(58)},
          children: [
            pw.TableRow(decoration: pw.BoxDecoration(color: _fundo), children: [
              for (final c in ['O que', 'Responsável', 'Prazo', 'Situação'])
                pw.Padding(padding: const pw.EdgeInsets.all(4),
                    child: pw.Text(c, style: pw.TextStyle(fontSize: 9, fontWeight: pw.FontWeight.bold))),
            ]),
            for (final e in encaminhamentos)
              pw.TableRow(children: [
                for (final c in [t(e['descricao']), t(e['responsavel']), _dataBr(e['prazo'] as String?),
                  e['concluido'] == true ? 'Concluído' : 'Pendente'])
                  pw.Padding(padding: const pw.EdgeInsets.all(4), child: pw.Text(c, style: const pw.TextStyle(fontSize: 9.5))),
              ]),
          ],
        ),
      if (t(ata['observacoes']).isNotEmpty) secao('Observações'),
      for (final linha in t(ata['observacoes']).split('\n')) if (linha.trim().isNotEmpty) paragrafo(linha),
      if (retificacoes.isNotEmpty) secao('Retificações'),
      for (final r in retificacoes)
        paragrafo('${_dataBr(r['em'] as String?)} (${t(r['por'])}): ${t(r['texto'])}'),
      pw.SizedBox(height: 42),
      pw.Row(mainAxisAlignment: pw.MainAxisAlignment.spaceAround, children: [
        for (final (cargo, nome) in [('Presidência', t(ata['presidente'])), ('Secretaria', t(ata['secretario']))])
          pw.Column(children: [
            pw.Container(width: 190, height: .8, color: _verdeEscuro),
            pw.SizedBox(height: 4),
            pw.Text(nome.isEmpty ? cargo : nome, style: const pw.TextStyle(fontSize: 10)),
            if (nome.isNotEmpty) pw.Text(cargo, style: pw.TextStyle(fontSize: 8.5, color: _cinza)),
          ]),
      ]),
    ],
  ));
  return doc.save();
}
