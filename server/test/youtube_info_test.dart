import 'dart:convert';

import 'package:diako_server/youtube_info.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

void main() {
  (String, String) separar(String titulo, String canal) {
    final i = separarTituloYoutube(titulo, canal);
    return (i.titulo, i.cantor);
  }

  test('"Artista - Música" com penduricalhos do vídeo', () {
    expect(separar('Aline Barros - Ressuscita-me (Ao Vivo)', 'Aline Barros'), ('Ressuscita-me', 'Aline Barros'));
    expect(separar('Fernandinho | Uma Nova História [Clipe Oficial]', 'Fernandinho Oficial'), ('Uma Nova História', 'Fernandinho'));
    expect(separar('Gabriela Rocha - Lugar Secreto (Ao Vivo em São Paulo) #gospel', 'Gabriela Rocha'), ('Lugar Secreto', 'Gabriela Rocha'));
  });

  test('canal decide o lado quando o título vem "Música - Artista"', () {
    expect(separar('Bondade de Deus - Isaias Saad', 'Isaias Saad'), ('Bondade de Deus', 'Isaias Saad'));
    expect(separar('Me Atraiu | Gabriela Rocha | Clipe Oficial', 'Gabriela Rocha'), ('Me Atraiu', 'Gabriela Rocha'));
    expect(separar('Bondade de Deus - Isaías Saad (Official Music Video)', 'ISAIAS SAAD'), ('Bondade de Deus', 'Isaías Saad'));
  });

  test('canal do YouTube Music e de gravadora', () {
    expect(separar('Santo Pra Sempre', 'Gabriel Guedes - Topic'), ('Santo Pra Sempre', 'Gabriel Guedes'));
    expect(separar('Ressuscita-me (Ao Vivo)', 'MK Music'), ('Ressuscita-me', ''), reason: 'gravadora não vira cantor');
    expect(separar('Aline Barros - Ressuscita-me', 'MK Music'), ('Ressuscita-me', 'Aline Barros'));
  });

  test('convidado sai do título e vai para o cantor; parêntese que é da música fica', () {
    expect(separar('Morada - É Tudo Sobre Você (feat. Gabriela Rocha) [Ao Vivo]', 'Morada'),
        ('É Tudo Sobre Você', 'Morada feat. Gabriela Rocha'));
    expect(separar('Diante do Trono - Aclame ao Senhor (Salmo 100)', 'Diante do Trono'), ('Aclame ao Senhor (Salmo 100)', 'Diante do Trono'));
  });

  test('oEmbed: lê título e canal; vídeo privado ou fora do ar volta null', () async {
    late Uri pedido;
    final ok = MockClient((req) async {
      pedido = req.url;
      return http.Response.bytes(utf8.encode(jsonEncode({'title': 'Aline Barros - Ressuscita-me (Ao Vivo)', 'author_name': 'Aline Barros'})), 200);
    });
    final info = await buscarInfoYoutube('AbCdEfGhIjK', cliente: ok);
    expect(pedido.host, 'www.youtube.com');
    expect(pedido.path, '/oembed');
    expect(pedido.queryParameters['url'], 'https://www.youtube.com/watch?v=AbCdEfGhIjK');
    expect(info!.toJson(), {'titulo': 'Ressuscita-me', 'cantor': 'Aline Barros',
      'tituloVideo': 'Aline Barros - Ressuscita-me (Ao Vivo)', 'canal': 'Aline Barros'});
    expect(await buscarInfoYoutube('AbCdEfGhIjK', cliente: MockClient((_) async => http.Response('Unauthorized', 401))), isNull);
    expect(await buscarInfoYoutube('AbCdEfGhIjK', cliente: MockClient((_) async => throw http.ClientException('sem rede'))), isNull);
  });
}
