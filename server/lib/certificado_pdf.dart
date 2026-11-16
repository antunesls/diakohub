import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import 'escala_pdf.dart' show textoLatin1;

// Mesmas cores dos PDFs de ata e escala (identidade do site).
final _verde = PdfColor.fromHex('1F5F5B');
final _verdeEscuro = PdfColor.fromHex('172C29');
final _cinza = PdfColor.fromHex('52615E');
final _borda = PdfColor.fromHex('BBC9C6');

const _meses = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/// "1990-05-12" → "12 de maio de 1990" (vazio se a data não for válida).
String dataPorExtenso(String? iso) {
  final d = DateTime.tryParse(iso ?? '');
  if (d == null) return '';
  return '${d.day} de ${_meses[d.month - 1]} de ${d.year}';
}

/// PDF do certificado de batismo em A4 paisagem, uma página: moldura dupla, cabeçalho
/// com logo e nome da igreja, nome da pessoa em destaque e o bloco de assinatura — com
/// a assinatura salva, o carimbo, os dois ou só a linha para assinar à mão.
Future<Uint8List> gerarCertificadoBatismoPdf({
  required String nome,
  required String dataBatismo,
  required String igreja,
  required DateTime emissao,
  String? sexo, // 'M' | 'F' | null
  String pastor = '',
  String cargo = '',
  String? local,
  Uint8List? logo,
  Uint8List? assinatura,
  Uint8List? carimbo,
}) async {
  String t(String? v) => textoLatin1((v ?? '').trim());
  final extenso = dataPorExtenso(dataBatismo);
  if (extenso.isEmpty) throw ArgumentError('Data de batismo inválida.');
  final batizado = sexo == 'F' ? 'batizada' : sexo == 'M' ? 'batizado' : 'batizado(a)';
  final imgLogo = logo == null ? null : pw.MemoryImage(logo);
  final imgAssinatura = assinatura == null ? null : pw.MemoryImage(assinatura);
  final imgCarimbo = carimbo == null ? null : pw.MemoryImage(carimbo);

  final conteudo = pw.Column(
    crossAxisAlignment: pw.CrossAxisAlignment.center,
    mainAxisAlignment: pw.MainAxisAlignment.center,
    children: [
      if (imgLogo != null) ...[
        pw.Image(imgLogo, width: 54, height: 54, fit: pw.BoxFit.contain),
        pw.SizedBox(height: 10),
      ],
      pw.Text(t(igreja).toUpperCase(),
          style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold, color: _verde, letterSpacing: 2)),
      pw.Container(width: 220, height: .8, color: _borda, margin: const pw.EdgeInsets.only(top: 8, bottom: 22)),
      pw.Text('CERTIFICADO DE BATISMO',
          style: pw.TextStyle(fontSize: 26, fontWeight: pw.FontWeight.bold, color: _verdeEscuro, letterSpacing: 4)),
      pw.SizedBox(height: 26),
      pw.Text('Certificamos que', style: pw.TextStyle(fontSize: 13, color: _cinza, fontStyle: pw.FontStyle.italic)),
      pw.SizedBox(height: 10),
      pw.Text(t(nome), style: const pw.TextStyle(fontSize: 24, fontWeight: pw.FontWeight.bold)),
      pw.Container(width: 320, height: .8, color: _borda, margin: const pw.EdgeInsets.symmetric(vertical: 12)),
      pw.SizedBox(
        width: 460,
        child: pw.Paragraph(
          text: 'professou publicamente a sua fé em Jesus Cristo e foi $batizado em águas '
              'nesta igreja, no dia ${t(extenso)}.',
          textAlign: pw.TextAlign.center,
          style: const pw.TextStyle(fontSize: 13, lineSpacing: 3),
        ),
      ),
      pw.SizedBox(height: 24),
      pw.Text(
        [if (t(local).isNotEmpty) t(local), t(_extenso(emissao))].join(', ') + '.',
        style: pw.TextStyle(fontSize: 11.5, color: _cinza),
      ),
      pw.SizedBox(height: 34),
      pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.center,
        crossAxisAlignment: pw.CrossAxisAlignment.end,
        children: [
          pw.Column(children: [
            pw.SizedBox(
              width: 210,
              height: 44,
              child: imgAssinatura == null
                  ? null
                  : pw.Center(child: pw.Image(imgAssinatura, height: 44, fit: pw.BoxFit.contain)),
            ),
            pw.Container(width: 210, height: .9, color: _verdeEscuro),
            pw.SizedBox(height: 5),
            if (t(pastor).isNotEmpty) pw.Text(t(pastor), style: const pw.TextStyle(fontSize: 11)),
            if (t(cargo).isNotEmpty)
              pw.Text(t(cargo), style: pw.TextStyle(fontSize: 9, color: _cinza)),
          ]),
          if (imgCarimbo != null) ...[
            pw.SizedBox(width: 18),
            pw.Image(imgCarimbo, height: 78, fit: pw.BoxFit.contain),
          ],
        ],
      ),
    ],
  );

  final doc = pw.Document(title: 'Certificado de batismo', author: t(igreja));
  doc.addPage(pw.Page(
    pageFormat: PdfPageFormat.a4.landscape,
    margin: const pw.EdgeInsets.all(20),
    build: (ctx) => pw.Container(
      alignment: pw.Alignment.center,
      decoration: pw.BoxDecoration(border: pw.Border.all(color: _verde, width: 2.5)),
      padding: const pw.EdgeInsets.all(7),
      child: pw.Container(
        alignment: pw.Alignment.center,
        decoration: pw.BoxDecoration(border: pw.Border.all(color: _borda, width: 1)),
        padding: const pw.EdgeInsets.fromLTRB(56, 30, 56, 28),
        child: conteudo,
      ),
    ),
  ));
  return doc.save();
}

String _extenso(DateTime d) => '${d.day} de ${_meses[d.month - 1]} de ${d.year}';
