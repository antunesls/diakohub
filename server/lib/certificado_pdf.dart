import 'dart:io';
import 'dart:typed_data';

import 'package:path/path.dart' as p;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import 'escala_pdf.dart' show textoLatin1;

// Modelo "A · Clássico" aprovado: papel creme, moldura verde e dourada com cantos
// ornamentados, "BATISMO" em serifa grande e o nome em letra caligráfica.
final _verde = PdfColor.fromHex('1F5F5B');
final _dourado = PdfColor.fromHex('B08D3C');
final _douradoEscuro = PdfColor.fromHex('6B5A2E');
final _papel = PdfColor.fromHex('FBF8F1');
final _tinta = PdfColor.fromHex('2B2A26');
final _cinza = PdfColor.fromHex('5A5850');
const _versiculo =
    '“Portanto, se alguém está em Cristo, é nova criatura; as coisas antigas já passaram; '
    'eis que se fizeram novas.”';
const _referencia = '2 Coríntios 5:17';
const _larguraNome = 540.0;
const _tamanhoNome = 46.0;

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

/// As fontes do certificado (licença OFL, em web/fontes-certificado). Sem elas o PDF
/// sai com as fontes padrão do PDF (Times) e o texto reduzido a Latin-1.
class FontesCertificado {
  FontesCertificado({
    required this.titulo,
    required this.tituloForte,
    required this.texto,
    required this.textoItalico,
    required this.textoForte,
    required this.caligrafia,
  });

  final pw.Font titulo, tituloForte, texto, textoItalico, textoForte, caligrafia;

  static const arquivos = [
    'CormorantGaramond-SemiBold.ttf',
    'CormorantGaramond-Bold.ttf',
    'EBGaramond-Regular.ttf',
    'EBGaramond-Italic.ttf',
    'EBGaramond-Bold.ttf',
    'GreatVibes-Regular.ttf',
  ];

  /// Lê as fontes da pasta; null se faltar alguma (o PDF continua saindo).
  static FontesCertificado? carregar(String pasta) {
    final bytes = <ByteData>[];
    for (final nome in arquivos) {
      final f = File(p.join(pasta, nome));
      if (!f.existsSync()) return null;
      bytes.add(ByteData.sublistView(f.readAsBytesSync()));
    }
    final fontes = [for (final b in bytes) pw.Font.ttf(b)];
    return FontesCertificado(
      titulo: fontes[0],
      tituloForte: fontes[1],
      texto: fontes[2],
      textoItalico: fontes[3],
      textoForte: fontes[4],
      caligrafia: fontes[5],
    );
  }
}

/// Canto ornamentado (o mesmo desenho do modelo aprovado), espelhado conforme o canto.
String _svgCanto({required bool espelharX, required bool espelharY}) {
  final sx = espelharX ? -1 : 1, sy = espelharY ? -1 : 1;
  final tx = espelharX ? 64 : 0, ty = espelharY ? 64 : 0;
  const cor = '#B08D3C';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
      '<g transform="translate($tx $ty) scale($sx $sy)" fill="none" stroke="$cor" stroke-width="1.4">'
      '<path d="M4 40 C4 18 18 4 40 4"/><path d="M10 40 C10 22 22 10 40 10"/>'
      '<path d="M16 28 C22 26 26 22 28 16"/>'
      '<circle cx="40" cy="4" r="2.2" fill="$cor"/><circle cx="4" cy="40" r="2.2" fill="$cor"/>'
      '</g></svg>';
}

/// PDF do certificado de batismo em A4 paisagem, uma página, no modelo clássico:
/// logo, "CERTIFICADO DE BATISMO", o nome em caligrafia, o texto com a data, o
/// versículo e o rodapé com local e data, a assinatura (salva ou a linha para
/// assinar à mão) e o carimbo, quando houver.
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
  FontesCertificado? fontes,
}) async {
  // Com as fontes embutidas o texto vai como está; sem elas, só Latin-1 cabe.
  String t(String? v) => fontes != null ? (v ?? '').trim() : textoLatin1((v ?? '').trim());
  final extenso = dataPorExtenso(dataBatismo);
  if (extenso.isEmpty) throw ArgumentError('Data de batismo inválida.');
  final batizado = sexo == 'F' ? 'batizada' : sexo == 'M' ? 'batizado' : 'batizado(a)';
  final imgLogo = logo == null ? null : pw.MemoryImage(logo);
  final imgAssinatura = assinatura == null ? null : pw.MemoryImage(assinatura);
  final imgCarimbo = carimbo == null ? null : pw.MemoryImage(carimbo);

  final titulo = fontes?.titulo ?? pw.Font.timesBold();
  final tituloForte = fontes?.tituloForte ?? pw.Font.timesBold();
  final texto = fontes?.texto ?? pw.Font.times();
  final italico = fontes?.textoItalico ?? pw.Font.timesItalic();
  final forte = fontes?.textoForte ?? pw.Font.timesBold();
  final caligrafia = fontes?.caligrafia ?? pw.Font.timesBoldItalic();

  pw.Widget linhaDourada(double largura) => pw.Container(width: largura, height: .75, color: _dourado);

  // Nomes compridos encolhem para caber numa linha (largura medida na própria fonte).
  final nomeTexto = t(nome);
  final doc = pw.Document(title: 'Certificado de batismo', author: t(igreja));
  final larguraNome = caligrafia.getFont(pw.Context(document: doc.document)).stringMetrics(nomeTexto).advanceWidth *
      _tamanhoNome;
  final tamanhoNome =
      larguraNome > _larguraNome ? _tamanhoNome * _larguraNome / larguraNome : _tamanhoNome;

  final conteudo = pw.Column(
    crossAxisAlignment: pw.CrossAxisAlignment.center,
    children: [
      if (imgLogo != null) pw.Image(imgLogo, height: 40, fit: pw.BoxFit.contain),
      pw.SizedBox(height: 19),
      pw.Row(mainAxisAlignment: pw.MainAxisAlignment.center, children: [
        linhaDourada(52),
        pw.SizedBox(width: 10),
        pw.Text('CERTIFICADO DE',
            style: pw.TextStyle(font: titulo, fontSize: 11.5, letterSpacing: 4.5, color: _douradoEscuro)),
        pw.SizedBox(width: 10),
        linhaDourada(52),
      ]),
      pw.SizedBox(height: 2),
      pw.Text('BATISMO', style: pw.TextStyle(font: tituloForte, fontSize: 48, letterSpacing: 7.5, color: _verde)),
      pw.SizedBox(height: 18),
      pw.Text('Certificamos que', style: pw.TextStyle(font: italico, fontSize: 14, color: _cinza)),
      pw.SizedBox(height: 2),
      pw.SizedBox(
        height: _tamanhoNome * 1.25,
        child: pw.Center(
          child: pw.Text(nomeTexto, style: pw.TextStyle(font: caligrafia, fontSize: tamanhoNome, color: _tinta)),
        ),
      ),
      linhaDourada(360),
      pw.SizedBox(height: 14),
      // Quebra de linha fixa: a data fica inteira na segunda linha.
      pw.Text('professou publicamente a sua fé em Jesus Cristo e foi $batizado em águas',
          style: pw.TextStyle(font: texto, fontSize: 14, color: _tinta)),
      pw.SizedBox(height: 5),
      pw.RichText(
        text: pw.TextSpan(
          style: pw.TextStyle(font: texto, fontSize: 14, color: _tinta),
          children: [
            const pw.TextSpan(text: 'nesta igreja, no dia '),
            pw.TextSpan(text: t(extenso), style: pw.TextStyle(font: forte)),
            const pw.TextSpan(text: '.'),
          ],
        ),
      ),
      pw.SizedBox(height: 14),
      pw.SizedBox(
        width: 470,
        child: pw.Text(t(_versiculo),
            textAlign: pw.TextAlign.center,
            style: pw.TextStyle(font: italico, fontSize: 11, color: _douradoEscuro, lineSpacing: 2)),
      ),
      pw.SizedBox(height: 2),
      pw.Text(t(_referencia), style: pw.TextStyle(font: italico, fontSize: 10.5, color: _douradoEscuro)),
      pw.Spacer(),
      pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
        crossAxisAlignment: pw.CrossAxisAlignment.end,
        children: [
          pw.SizedBox(
            width: 175,
            child: pw.Text(
              [if (t(local).isNotEmpty) t(local), t(_extenso(emissao))].join(', ') + '.',
              style: pw.TextStyle(font: texto, fontSize: 11, color: _cinza),
            ),
          ),
          pw.SizedBox(
            width: 215,
            child: pw.Column(children: [
              pw.SizedBox(
                height: 38,
                child: imgAssinatura == null
                    ? null
                    : pw.Center(child: pw.Image(imgAssinatura, height: 38, fit: pw.BoxFit.contain)),
              ),
              pw.Container(height: .75, color: _tinta),
              pw.SizedBox(height: 4),
              if (t(pastor).isNotEmpty) pw.Text(t(pastor), style: pw.TextStyle(font: texto, fontSize: 12)),
              if (t(cargo).isNotEmpty)
                pw.Text(t(cargo).toUpperCase(),
                    style: pw.TextStyle(font: texto, fontSize: 9.5, color: _cinza, letterSpacing: .8)),
            ]),
          ),
          pw.SizedBox(
            width: 175,
            child: pw.Align(
              alignment: pw.Alignment.bottomRight,
              child: imgCarimbo == null ? pw.SizedBox() : pw.Image(imgCarimbo, height: 80, fit: pw.BoxFit.contain),
            ),
          ),
        ],
      ),
    ],
  );

  pw.Widget canto(bool direita, bool baixo) => pw.Positioned(
        left: direita ? null : 7,
        right: direita ? 7 : null,
        top: baixo ? null : 7,
        bottom: baixo ? 7 : null,
        child: pw.SvgImage(svg: _svgCanto(espelharX: direita, espelharY: baixo), width: 48, height: 48),
      );

  doc.addPage(pw.Page(
    pageFormat: PdfPageFormat.a4.landscape,
    margin: pw.EdgeInsets.zero,
    build: (ctx) => pw.Container(
      color: _papel,
      padding: const pw.EdgeInsets.all(19.5),
      child: pw.Container(
        decoration: pw.BoxDecoration(border: pw.Border.all(color: _verde, width: 2.25)),
        padding: const pw.EdgeInsets.all(6),
        child: pw.Container(
          decoration: pw.BoxDecoration(border: pw.Border.all(color: _dourado, width: .75)),
          child: pw.Stack(children: [
            canto(false, false),
            canto(true, false),
            canto(false, true),
            canto(true, true),
            pw.Padding(padding: const pw.EdgeInsets.fromLTRB(68, 30, 68, 25), child: conteudo),
          ]),
        ),
      ),
    ),
  ));
  return doc.save();
}

String _extenso(DateTime d) => '${d.day} de ${_meses[d.month - 1]} de ${d.year}';
