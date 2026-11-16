import 'dart:io';
import 'dart:isolate';
import 'dart:math';
import 'dart:typed_data';

import 'package:image/image.dart' as img;
import 'package:path/path.dart' as p;

import 'cartazes.dart';

/// Assinatura e carimbo dos certificados, gravados em data/imagens-certificado/ como PNG
/// (a transparência da assinatura desenhada no tablet é preservada). O nome do arquivo de
/// cada um fica nas configurações (certAssinatura/certCarimbo). Nunca são públicas: o
/// servidor só entrega atrás de login (Permissao.membros).
class ImagensCertificado {
  ImagensCertificado(String pastaDados) : pasta = p.join(pastaDados, 'imagens-certificado');

  final String pasta;

  static const tamanhoMaximo = 10 * 1024 * 1024;
  static const larguraMaxima = 1200;

  /// Acima disso a imagem nem é aberta (memória do servidor).
  static const pixelsMaximos = 40 * 1000 * 1000;

  /// Nomes gerados pelo servidor: "<hex>.png".
  static bool nomeValido(String nome) => RegExp(r'^[0-9a-f]{20}\.png$').hasMatch(nome);

  File? arquivo(String nome) => nomeValido(nome) ? File(p.join(pasta, nome)) : null;

  /// Processa e grava a imagem (PNG, no máximo [larguraMaxima] px de largura) e retorna
  /// o nome do arquivo. Lança [FormatException] com a mensagem para o usuário.
  Future<String> salvar(Uint8List bytes) async {
    if (bytes.isEmpty) throw const FormatException('Arquivo vazio.');
    if (bytes.length > tamanhoMaximo) throw const FormatException('Imagem maior que 10 MB.');
    if (Cartazes.tipoImagem(bytes) == null) throw const FormatException('Envie uma imagem JPG ou PNG.');
    final png = await Isolate.run(() => processarImagemCertificado(bytes));
    await Directory(pasta).create(recursive: true);
    final rng = Random.secure();
    final base = List.generate(10, (_) => rng.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
    final arquivo = '$base.png';
    await File(p.join(pasta, arquivo)).writeAsBytes(png, flush: true);
    return arquivo;
  }

  Future<void> excluir(String? nome) async {
    if (nome == null || nome.isEmpty) return;
    final f = arquivo(nome);
    if (f != null && await f.exists()) await f.delete();
  }
}

/// Deixa a imagem em pé, reduz para a largura máxima e regrava em PNG, mantendo a
/// transparência (assinatura do tablet, carimbo com fundo transparente).
/// Roda em isolate: tem que ficar fora da classe para capturar corretamente.
Uint8List processarImagemCertificado(Uint8List bytes) {
  final decoder = img.findDecoderForData(bytes);
  final info = decoder?.startDecode(bytes);
  if (decoder == null || info == null) throw const FormatException('Não foi possível ler a imagem.');
  if (info.width * info.height > ImagensCertificado.pixelsMaximos) {
    throw const FormatException('Imagem com resolução alta demais. Reduza o tamanho e envie de novo.');
  }
  var imagem = decoder.decode(bytes);
  if (imagem == null) throw const FormatException('Não foi possível ler a imagem.');
  imagem = img.bakeOrientation(imagem);
  if (imagem.width > ImagensCertificado.larguraMaxima) {
    imagem = img.copyResize(imagem,
        width: ImagensCertificado.larguraMaxima, interpolation: img.Interpolation.average);
  }
  return img.encodePng(imagem);
}
