import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/painting.dart';

import 'blur_cartaz.dart';

const _largura = 1920.0;
const _altura = 1080.0;

/// Monta o slide de um recado sobre o cartaz, no tamanho do telão (1920x1080):
/// o cartaz em tela cheia, desfocado conforme [nivel], escurecido, com título e texto por cima.
/// Retorna um PNG.
Future<Uint8List> montarCartazComTexto({
  required Uint8List cartaz,
  required String titulo,
  required String texto,
  required NivelBlur nivel,
  bool negritoTitulo = false,
}) async {
  final fundo = (await (await ui.instantiateImageCodec(cartaz)).getNextFrame()).image;
  final recorder = ui.PictureRecorder();
  final canvas = ui.Canvas(recorder, const ui.Rect.fromLTWH(0, 0, _largura, _altura));

  // Cobre a tela inteira. A margem extra (fora da tela) evita bordas transparentes no desfoque.
  final origem = ui.Rect.fromLTWH(0, 0, fundo.width.toDouble(), fundo.height.toDouble());
  final escala = math.max(_largura / origem.width, _altura / origem.height);
  final cobre = ui.Rect.fromCenter(
    center: const ui.Offset(_largura / 2, _altura / 2),
    width: origem.width * escala,
    height: origem.height * escala,
  ).inflate(nivel.sigma * 3);
  final paint = ui.Paint();
  if (nivel.sigma > 0) {
    paint.imageFilter = ui.ImageFilter.blur(sigmaX: nivel.sigma, sigmaY: nivel.sigma);
  }
  canvas.drawImageRect(fundo, origem, cobre, paint);
  canvas.drawRect(
    const ui.Rect.fromLTWH(0, 0, _largura, _altura),
    ui.Paint()..color = const Color(0x80000000),
  );

  const branco = Color(0xFFFFFFFF);
  final tituloTexto = TextPainter(
    text: TextSpan(
      text: titulo,
      style: TextStyle(color: branco, fontSize: 96, fontWeight: negritoTitulo ? FontWeight.bold : FontWeight.normal),
    ),
    textAlign: TextAlign.center,
    textDirection: TextDirection.ltr,
  )..layout(maxWidth: 1600);
  final corpo = texto.trim();
  final corpoTexto = corpo.isEmpty
      ? null
      : (TextPainter(
          text: TextSpan(text: corpo, style: const TextStyle(color: branco, fontSize: 56)),
          textAlign: TextAlign.center,
          textDirection: TextDirection.ltr,
        )..layout(maxWidth: 1600));

  final altura = tituloTexto.height + (corpoTexto == null ? 0 : 48 + corpoTexto.height);
  var y = (_altura - altura) / 2;
  tituloTexto.paint(canvas, ui.Offset((_largura - tituloTexto.width) / 2, y));
  if (corpoTexto != null) {
    y += tituloTexto.height + 48;
    corpoTexto.paint(canvas, ui.Offset((_largura - corpoTexto.width) / 2, y));
  }

  final imagem = await recorder.endRecording().toImage(_largura.toInt(), _altura.toInt());
  final png = await imagem.toByteData(format: ui.ImageByteFormat.png);
  return png!.buffer.asUint8List();
}
