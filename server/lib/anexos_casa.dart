import 'dart:io';
import 'dart:isolate';
import 'dart:math';
import 'dart:typed_data';

import 'package:path/path.dart' as p;

import 'cartazes.dart';
import 'galeria.dart' show processarFoto;
import 'lgpd.dart' show TermosAssinados;

/// Fotos e comprovantes da Gestão da Casa. Só a API autenticada entrega arquivos.
class AnexosCasa {
  AnexosCasa(String pastaDados) : pasta = p.join(pastaDados, 'anexos-casa');

  final String pasta;
  static const tamanhoMaximo = 15 * 1024 * 1024;

  static bool nomeValido(String nome) => RegExp(r'^[a-f0-9]{20}\.(jpg|pdf)$').hasMatch(nome);
  File? arquivo(String nome) => nomeValido(nome) ? File(p.join(pasta, nome)) : null;

  Future<String> salvar(Uint8List bytes) async {
    if (bytes.isEmpty || bytes.length > tamanhoMaximo) throw const FormatException('Arquivo vazio ou maior que 15 MB.');
    final bool pdf = TermosAssinados.ehPdf(bytes);
    if (!pdf && Cartazes.tipoImagem(bytes) == null) throw const FormatException('Envie uma foto JPG, PNG ou PDF.');
    final conteudo = pdf ? bytes : await Isolate.run(() => processarFoto(bytes, larguraMaxima: 1600, larguraMiniatura: 320).foto);
    final aleatorio = Random.secure();
    final nome = '${List.generate(10, (_) => aleatorio.nextInt(256).toRadixString(16).padLeft(2, '0')).join()}.${pdf ? 'pdf' : 'jpg'}';
    await Directory(pasta).create(recursive: true);
    await File(p.join(pasta, nome)).writeAsBytes(conteudo, flush: true);
    return nome;
  }

  Future<void> excluir(String nome) async {
    final f = arquivo(nome);
    if (f != null && await f.exists()) await f.delete();
  }
}
