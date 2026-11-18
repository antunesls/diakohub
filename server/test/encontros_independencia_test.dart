import 'package:diako_server/encontros.dart';
import 'package:diako_server/permissoes.dart';
import 'package:test/test.dart';

void main() {
  test('permissão de encontros é independente de casais', () {
    final encontros = Permissao.porNome('encontros')!;
    for (final perfil in [Perfil.liderCasais, Perfil.secretaria, Perfil.pastor, Perfil.administrador]) {
      expect(perfil.pode(encontros), isTrue, reason: perfil.nome);
    }
    expect(Perfil.midia.pode(encontros), isFalse);
    expect(Permissao.completar({encontros}), isNot(contains(Permissao.casais)));
    expect(Permissao.completar({Permissao.casaisGerenciar}), isNot(contains(encontros)));
  });

  test('rotas de encontros e inscrições não passam por casais', () {
    for (final rota in ['api/encontros', 'api/encontros/x', 'api/encontros/x/inscricoes', 'api/inscricoes/x/cancelar']) {
      expect(permissaoDaRota('GET', rota), Permissao.encontros, reason: rota);
    }
    expect(permissaoDaRota('POST', 'api/encontros'), Permissao.encontros);
    expect(permissaoDaRota('POST', 'api/inscricoes/x/cancelar'), Permissao.encontros);
    expect(permissaoDaRota('GET', 'api/casais'), Permissao.casais);
    expect(permissaoDaRota('POST', 'api/casais/contatos'), Permissao.casaisGerenciar);
  });

  test('domínio de encontros não depende do módulo de casais', () {
    expect(Encontros, isNotNull);
  });
}
