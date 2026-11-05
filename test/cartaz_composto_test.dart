import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:diako_news/data/blur_cartaz.dart';
import 'package:diako_news/data/cartaz_composto.dart';

/// Um PNG pequeno e colorido, para servir de cartaz nos testes.
Future<Uint8List> _cartazDeTeste() async {
  final gravador = ui.PictureRecorder();
  final tela = ui.Canvas(gravador);
  tela.drawRect(const ui.Rect.fromLTWH(0, 0, 40, 30), ui.Paint()..color = const Color(0xFF3366CC));
  final imagem = await gravador.endRecording().toImage(40, 30);
  return (await imagem.toByteData(format: ui.ImageByteFormat.png))!.buffer.asUint8List();
}

void main() {
  test('nível de desfoque: desligado não desfoca e os níveis crescem', () {
    expect(NivelBlur.desligado.sigma, 0);
    expect(NivelBlur.leve.sigma, lessThan(NivelBlur.medio.sigma));
    expect(NivelBlur.medio.sigma, lessThan(NivelBlur.forte.sigma));
  });

  test('nível salvo volta como nível; valor desconhecido vira desligado', () {
    expect(nivelBlurDe('medio'), NivelBlur.medio);
    expect(nivelBlurDe('nao-existe'), NivelBlur.desligado);
    expect(nivelBlurDe(null), NivelBlur.desligado);
  });

  testWidgets('monta o slide em PNG 1920x1080 com o cartaz desfocado e o texto', (tester) async {
    await tester.runAsync(() async {
      final png = await montarCartazComTexto(
        cartaz: await _cartazDeTeste(),
        titulo: 'Culto de domingo',
        texto: 'Venham todos',
        nivel: NivelBlur.forte,
      );
      // Assinatura de PNG.
      expect(png.sublist(0, 4), [0x89, 0x50, 0x4E, 0x47]);
      final codec = await ui.instantiateImageCodec(png);
      final imagem = (await codec.getNextFrame()).image;
      expect(imagem.width, 1920);
      expect(imagem.height, 1080);
    });
  });

  testWidgets('sem texto também monta o slide', (tester) async {
    await tester.runAsync(() async {
      final png = await montarCartazComTexto(
        cartaz: await _cartazDeTeste(),
        titulo: 'Só o título',
        texto: '   ',
        nivel: NivelBlur.leve,
      );
      expect(png.sublist(0, 4), [0x89, 0x50, 0x4E, 0x47]);
    });
  });
}
