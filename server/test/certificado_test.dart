import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:diako_server/app.dart';
import 'package:diako_server/auth.dart';
import 'package:diako_server/backup.dart';
import 'package:diako_server/cartazes.dart';
import 'package:diako_server/certificado_pdf.dart';
import 'package:diako_server/config.dart';
import 'package:diako_server/configuracoes.dart';
import 'package:diako_server/historico.dart';
import 'package:diako_server/holyrics.dart';
import 'package:diako_server/store.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:image/image.dart' as img;
import 'package:path/path.dart' as p;
import 'package:shelf/shelf.dart';
import 'package:test/test.dart';

Uint8List png(int largura, int altura) => img.encodePng(img.Image(width: largura, height: altura));

void main() {
  group('PDF do certificado', () {
    test('gera uma página com logo, assinatura e carimbo', () async {
      final Uint8List pdf = await gerarCertificadoBatismoPdf(
        nome: 'Ana Paula Souça',
        dataBatismo: '2019-08-11',
        sexo: 'F',
        igreja: 'Igreja Diakonia Tulipas',
        emissao: DateTime(2026, 11, 16),
        pastor: 'Pr. Marcos',
        cargo: 'Pastor Presidente',
        local: 'São Paulo',
        logo: png(12, 12),
        assinatura: png(60, 20),
        carimbo: png(40, 40),
      );
      expect(latin1.decode(pdf.take(5).toList()), '%PDF-');
      expect(pdf.length, greaterThan(1500));
    });

    test('gera também sem nenhuma imagem (linha para assinar à mão)', () async {
      final Uint8List pdf = await gerarCertificadoBatismoPdf(
        nome: 'Caio Torres',
        dataBatismo: '2026-01-31',
        igreja: 'Igreja Diakonia Tulipas',
        emissao: DateTime(2026, 11, 16),
      );
      expect(latin1.decode(pdf.take(5).toList()), '%PDF-');
      expect(pdf.length, greaterThan(800));
    });

    test('modelo clássico com as fontes embutidas (acentos e aspas sem trocar por ?)', () async {
      final fontes = FontesCertificado.carregar('web/fontes-certificado');
      expect(fontes, isNotNull, reason: 'web/fontes-certificado precisa ter as 6 fontes');
      final Uint8List pdf = await gerarCertificadoBatismoPdf(
        nome: 'Ana Beatriz Conceição de Albuquerque Figueiredo Nascimento', // longo: encolhe
        dataBatismo: '2025-03-09',
        sexo: 'F',
        igreja: 'Igreja Diakonia Tulipas',
        emissao: DateTime(2026, 11, 16),
        pastor: 'Pr. Marcos',
        cargo: 'Pastor',
        local: 'Jundiaí',
        fontes: fontes,
      );
      expect(latin1.decode(pdf.take(5).toList()), '%PDF-');
      expect(pdf.length, greaterThan(20000)); // as fontes vão dentro do arquivo
    });

    test('pasta sem as fontes: carregar devolve null e o PDF sai com as fontes padrão', () {
      expect(FontesCertificado.carregar(p.join(Directory.systemTemp.path, 'nao-existe-fontes')), isNull);
    });

    test('sem data de batismo válida não gera', () async {
      await expectLater(
          gerarCertificadoBatismoPdf(nome: 'Ana', dataBatismo: '', igreja: 'Igreja', emissao: DateTime(2026)),
          throwsArgumentError);
    });

    test('data por extenso', () {
      expect(dataPorExtenso('2019-08-11'), '11 de agosto de 2019');
      expect(dataPorExtenso('2026-02-01'), '1 de fevereiro de 2026');
      expect(dataPorExtenso('31/02/2026'), '');
      expect(dataPorExtenso(null), '');
    });
  });

  group('API do certificado', () {
    late Directory tmp;
    late Store store;
    late Handler handler;
    late String token;
    late String pastaDados;

    setUp(() async {
      tmp = await Directory.systemTemp.createTemp('diako_certificado');
      final config = Config.lerJson('{"senhaAdmin":"senha-teste"}', pastaBase: tmp.path);
      pastaDados = config.pastaDados;
      store = Store(config.pastaDados);
      await store.carregar();
      final cfg = await Configuracoes.carregar(config, urlDetectada: 'http://192.168.0.10:8080');
      final auth = Auth(conferirSenha: cfg.conferirSenha, pastaDados: config.pastaDados);
      final backup = Backup(pastaDados: config.pastaDados, configuracoes: cfg.publicas);
      final web = Directory(p.join(tmp.path, 'web'))..createSync();
      handler = Servidor(
        store: store,
        auth: auth,
        holyrics:
            HolyricsDireto(host: 'h', porta: 1, token: 't', cliente: MockClient((_) async => http.Response('{}', 200))),
        cartazes: Cartazes(config.pastaCartazes),
        backup: backup,
        pastaWeb: web.path,
        urlOracao: cfg.urlOracao,
        cartazesNoHolyrics: false,
        historico: Historico(config.pastaDados),
        cfg: cfg,
      ).handler;
      final r =
          await handler(Request('POST', Uri.parse('http://x/api/login'), body: jsonEncode({'senha': 'senha-teste'})));
      token = (jsonDecode(await r.readAsString()) as Map)['token'] as String;
    });

    tearDown(() async {
      await store.fechar();
      await tmp.delete(recursive: true);
    });

    Future<(int, dynamic)> chamar(String metodo, String caminho,
        {Object? json, List<int>? bytes, bool login = true}) async {
      final r = await handler(Request(metodo, Uri.parse('http://x$caminho'),
          headers: {
            if (login) 'authorization': 'Bearer $token',
            if (json != null) 'content-type': 'application/json',
          },
          body: bytes ?? (json == null ? null : jsonEncode(json))));
      final corpo = await r.read().expand((b) => b).toList();
      final texto = utf8.decode(corpo, allowMalformed: true);
      return (r.statusCode, texto.startsWith('{') || texto.startsWith('[') ? jsonDecode(texto) : corpo);
    }

    test('config começa sem pastor e sem imagens; salvar exige login', () async {
      final r = await chamar('GET', '/api/certificado/config');
      expect(r.$1, 200);
      expect(r.$2, {'pastor': '', 'cargo': 'Pastor', 'assinatura': false, 'carimbo': false});
      expect((await chamar('GET', '/api/certificado/config', login: false)).$1, 401);
    });

    test('salva quem assina e o cargo', () async {
      final r = await chamar('PUT', '/api/certificado/config', json: {'pastor': 'Pr. Marcos', 'cargo': 'Pastor Presidente'});
      expect(r.$1, 200);
      expect((r.$2 as Map)['pastor'], 'Pr. Marcos');
      expect((await chamar('GET', '/api/certificado/config')).$2['cargo'], 'Pastor Presidente');
      // Campo comprido demais é recusado (a validação é a mesma do /admin).
      expect((await chamar('PUT', '/api/certificado/config', json: {'pastor': 'x' * 81})).$1, 400);
      // Campo desconhecido não passa.
      expect((await chamar('PUT', '/api/certificado/config', json: {'nomeIgreja': 'Outra'})).$1, 400);
    });

    test('envia, entrega e remove a assinatura e o carimbo (PNG transparente preservado)', () async {
      expect((await chamar('POST', '/api/certificado/assinatura', bytes: utf8.encode('não é imagem'))).$1, 400);
      expect((await chamar('POST', '/api/certificado/assinatura', bytes: png(80, 30))).$1, 201);
      expect((await chamar('POST', '/api/certificado/carimbo', bytes: png(64, 64))).$1, 201);

      final config = (await chamar('GET', '/api/certificado/config')).$2 as Map;
      expect(config['assinatura'], isTrue);
      expect(config['carimbo'], isTrue);

      final imagem = await chamar('GET', '/api/certificado/assinatura');
      expect(imagem.$1, 200);
      expect((imagem.$2 as List<int>).take(4), [0x89, 0x50, 0x4E, 0x47]); // assinatura PNG

      // Enviar de novo troca o arquivo (só um fica na pasta).
      expect((await chamar('POST', '/api/certificado/assinatura', bytes: png(90, 30))).$1, 201);
      final arquivos = Directory(p.join(pastaDados, 'imagens-certificado')).listSync();
      expect(arquivos.whereType<File>().length, 2); // assinatura + carimbo

      expect((await chamar('DELETE', '/api/certificado/carimbo')).$1, 200);
      expect((await chamar('DELETE', '/api/certificado/carimbo')).$1, 404); // já removido
      expect((await chamar('GET', '/api/certificado/carimbo')).$1, 404);
      expect((await chamar('GET', '/api/certificado/config')).$2['carimbo'], isFalse);
    });

    test('gera o PDF do batizado e recusa ficha sem data', () async {
      await store.salvar('membros', {
        'id': 'b1',
        'nome': 'Ana Paula Souça',
        'status': 'membro',
        'dataBatismo': '2019-08-11',
        'sexo': 'F',
      });
      await store.salvar('membros', {'id': 'b2', 'nome': 'Jorge Souça', 'status': 'membro'});
      await chamar('POST', '/api/certificado/assinatura', bytes: png(80, 30));

      final pdf = await chamar('GET', '/api/membros/b1/certificado-batismo?assinatura=1');
      expect(pdf.$1, 200);
      expect(latin1.decode((pdf.$2 as List<int>).take(5).toList()), '%PDF-');

      // Sem a query, o PDF sai sem a imagem da assinatura.
      expect((await chamar('GET', '/api/membros/b1/certificado-batismo')).$1, 200);
      expect((await chamar('GET', '/api/membros/b2/certificado-batismo')).$1, 422);
      expect((await chamar('GET', '/api/membros/inexistente/certificado-batismo')).$1, 404);
    });
  });
}
