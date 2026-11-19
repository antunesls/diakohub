import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:diako_core/diako_core.dart';
import 'package:path/path.dart' as p;

import 'cartazes.dart';
import 'anexos_casa.dart';
import 'fotos_membros.dart';
import 'lgpd.dart';
import 'artes_qr.dart';
import 'fundos_tv.dart';
import 'galeria.dart';
import 'qr_oracao.dart';
import 'materiais.dart';
import 'repertorio.dart';
import 'store.dart';

/// Formato dos arquivos de backup (manifest.json).
const versaoBackup = 2;

/// Coleções com pessoas e vínculos que precisam ser validadas juntas na restauração.
const _colecoesMinisterio = [
  'casaisContatos', 'casaisEnvios', 'materiais', 'tiposMaterial', 'encontros', 'inscricoes', 'tarefasEncontros',
];

/// Backups em .zip: dados, histórico, cartazes, fotos da galeria do site, fundos das TVs, artes dos QR e configurações públicas
/// (sem senha nem chaves).
/// Diário no horário configurado, sob demanda pelo painel e antes de cada restauração.
class Backup {
  Backup({
    required this.pastaDados,
    String pastaDestino = '',
    String? pastaCartazes,
    String Function()? horario,
    int Function()? manter,
    Map<String, dynamic> Function()? configuracoes,
    DateTime Function()? relogio,
  })  : pastaDestino = pastaDestino.isEmpty ? p.join(pastaDados, 'backups') : pastaDestino,
        pastaCartazes = pastaCartazes ?? p.join(pastaDados, 'cartazes'),
        _horario = horario ?? (() => '03:00'),
        _manter = manter ?? (() => 30),
        _configuracoes = configuracoes ?? (() => const {}),
        _agora = relogio ?? DateTime.now;

  final String pastaDados;
  final String pastaDestino;
  final String pastaCartazes;
  final String Function() _horario;
  final int Function() _manter;
  final Map<String, dynamic> Function() _configuracoes;
  final DateTime Function() _agora;

  /// Depois de gravar um backup (no modo agente, pede a cópia ao PC da igreja).
  void Function(File arquivo)? aoGravar;

  /// Quando o backup automático falha (no máximo uma vez por dia): aviso por e-mail.
  Future<void> Function(DateTime quando)? aoFalhar;

  /// Depois de uma falha do backup automático, espera isto antes de tentar de novo.
  static const intervaloNovaTentativa = Duration(minutes: 60);

  Timer? _timer;
  DateTime? _ultimaFalha;
  String? _avisoFalhaNoDia;
  Future<void> _filaEstado = Future.value();
  File get _estado => File(p.join(pastaDados, 'backup.json'));

  /// Sempre ativo: sem "pastaBackup" no config.json, usa data/backups.
  bool get configurado => true;
  String get horario => _horario();

  static final _nomeValido = RegExp(r'^diako-backup-\d{4}-\d{2}-\d{2}[A-Za-z0-9-]*\.zip$');

  /// Nome no formato dos arquivos de backup (também usado pelo agente).
  static bool nomeValido(String nome) => nome == p.basename(nome) && _nomeValido.hasMatch(nome);

  /// data/backup.json: {ultimo, falha?: {em}, copiaPc?: {em, nome}}.
  Future<Map<String, dynamic>> _lerEstado() async {
    try {
      if (!await _estado.exists()) return {};
      return Map<String, dynamic>.from(jsonDecode(await _estado.readAsString()) as Map);
    } catch (_) {
      return {};
    }
  }

  /// Mescla [mudancas] no backup.json, uma gravação por vez.
  Future<void> _gravarEstado(Map<String, dynamic> mudancas) {
    final r = _filaEstado.then((_) async {
      await _estado.parent.create(recursive: true);
      await _estado.writeAsString(jsonEncode({...await _lerEstado(), ...mudancas}));
    });
    _filaEstado = r.then((_) {}, onError: (_) {});
    return r;
  }

  Future<DateTime?> ultimo() async => (await estado()).ultimo;

  Future<({DateTime? ultimo, DateTime? falha, DateTime? copiaPcEm, String? copiaPcNome})> estado() async {
    await _filaEstado;
    final j = await _lerEstado();
    DateTime? data(Object? v) => DateTime.tryParse(v is String ? v : '');
    final copia = j['copiaPc'] is Map ? j['copiaPc'] as Map : const {};
    return (
      ultimo: data(j['ultimo']),
      falha: j['falha'] is Map ? data((j['falha'] as Map)['em']) : null,
      copiaPcEm: data(copia['em']),
      copiaPcNome: copia['nome'] as String?,
    );
  }

  /// O agente avisou que o backup [nome] já está no PC da igreja.
  Future<void> registrarCopiaPc(String nome) {
    if (!nomeValido(nome)) return Future.value();
    return _gravarEstado({'copiaPc': {'em': _agora().toIso8601String(), 'nome': nome}});
  }

  /// Conteúdo do backup em memória (para baixar direto pelo painel).
  Future<Uint8List> gerarZip({DateTime? agora}) async {
    final quando = agora ?? _agora();
    final arquivo = Archive();
    for (final nome in [for (final c in Store.colecoes) '$c.json', 'historico.jsonl', 'auditoria.jsonl']) {
      final f = File(p.join(pastaDados, nome));
      if (await f.exists()) arquivo.add(ArchiveFile.bytes('data/$nome', await f.readAsBytes()));
    }
    final dirCartazes = Directory(pastaCartazes);
    if (await dirCartazes.exists()) {
      await for (final e in dirCartazes.list()) {
        final nome = p.basename(e.path);
        // O QR é refeito pelo servidor a partir do endereço público.
        if (e is File && !ehArquivoDeQr(nome) && Cartazes.nomeValido(nome)) {
          arquivo.add(ArchiveFile.bytes('cartazes/$nome', await e.readAsBytes()));
        }
      }
    }
    final dirGaleria = Directory(Galeria(pastaDados).pasta);
    if (await dirGaleria.exists()) {
      await for (final e in dirGaleria.list()) {
        final nome = p.basename(e.path);
        if (e is File && Galeria.nomeValido(nome)) arquivo.add(ArchiveFile.bytes('galeria/$nome', await e.readAsBytes()));
      }
    }
    final dirFundos = Directory(FundosTv(pastaDados).pasta);
    if (await dirFundos.exists()) {
      await for (final e in dirFundos.list()) {
        final nome = p.basename(e.path);
        if (e is File && FundosTv.nomeValido(nome)) arquivo.add(ArchiveFile.bytes('fundos-tv/$nome', await e.readAsBytes()));
      }
    }
    final dirArtes = Directory(ArtesQr(pastaDados).pasta);
    if (await dirArtes.exists()) {
      await for (final e in dirArtes.list()) {
        final nome = p.basename(e.path);
        if (e is File && ArtesQr.nomeValido(nome)) arquivo.add(ArchiveFile.bytes('artes-qr/$nome', await e.readAsBytes()));
      }
    }
    final dirFotosMembros = Directory(FotosMembros(pastaDados).pasta);
    if (await dirFotosMembros.exists()) {
      await for (final e in dirFotosMembros.list()) {
        final nome = p.basename(e.path);
        if (e is File && FotosMembros.nomeValido(nome)) {
          arquivo.add(ArchiveFile.bytes('fotos-membros/$nome', await e.readAsBytes()));
        }
      }
    }
    final dirAnexosCasa = Directory(AnexosCasa(pastaDados).pasta);
    if (await dirAnexosCasa.exists()) {
      await for (final e in dirAnexosCasa.list()) {
        final nome = p.basename(e.path);
        if (e is File && AnexosCasa.nomeValido(nome)) {
          arquivo.add(ArchiveFile.bytes('anexos-casa/$nome', await e.readAsBytes()));
        }
      }
    }
    final dirAnexosAtas = Directory(AnexosCasa.atas(pastaDados).pasta);
    if (await dirAnexosAtas.exists()) {
      await for (final e in dirAnexosAtas.list()) {
        final nome = p.basename(e.path);
        if (e is File && AnexosCasa.nomeValido(nome)) {
          arquivo.add(ArchiveFile.bytes('anexos-atas/$nome', await e.readAsBytes()));
        }
      }
    }
    // Termos da LGPD assinados: são a prova da autorização, precisam ir junto.
    final dirTermos = Directory(TermosAssinados(pastaDados).pasta);
    if (await dirTermos.exists()) {
      await for (final e in dirTermos.list()) {
        final nome = p.basename(e.path);
        if (e is File && TermosAssinados.nomeValido(nome)) {
          arquivo.add(ArchiveFile.bytes('termos-lgpd/$nome', await e.readAsBytes()));
        }
      }
    }
    arquivo.add(ArchiveFile.string('configuracoes.json', const JsonEncoder.withIndent('  ').convert(_configuracoes())));
    arquivo.add(ArchiveFile.string('manifest.json',
        jsonEncode({'app': 'diako_news', 'versao': versaoBackup, 'criadoEm': quando.toIso8601String()})));
    return ZipEncoder().encodeBytes(arquivo);
  }

  /// Gera e grava o zip na pasta de backups. [sufixo] identifica backups manuais e de segurança.
  Future<File> executar({DateTime? agora, String? sufixo}) async {
    final quando = agora ?? _agora();
    final bytes = await gerarZip(agora: quando);
    await Directory(pastaDestino).create(recursive: true);
    final complemento = sufixo == null ? '' : '-${_hora(quando)}${sufixo.isEmpty ? '' : '-$sufixo'}';
    final destino = File(p.join(pastaDestino, 'diako-backup-${_data(quando)}$complemento.zip'));
    final tmp = File('${destino.path}.tmp');
    await tmp.writeAsBytes(bytes, flush: true);
    if (await destino.exists()) await destino.delete();
    await tmp.rename(destino.path);

    await _rotacionar();
    await _gravarEstado({'ultimo': quando.toIso8601String()});
    aoGravar?.call(destino);
    return destino;
  }

  /// Backups existentes, do mais novo para o mais antigo.
  Future<List<({String nome, int tamanho, DateTime criado})>> listar() async {
    final dir = Directory(pastaDestino);
    if (!await dir.exists()) return [];
    final lista = <({String nome, int tamanho, DateTime criado})>[];
    await for (final e in dir.list()) {
      final nome = p.basename(e.path);
      if (e is! File || !_nomeValido.hasMatch(nome)) continue;
      final s = await e.stat();
      lista.add((nome: nome, tamanho: s.size, criado: s.modified));
    }
    // O nome começa com a data (e a hora, nos manuais): ordenar pelo nome é mais confiável que pela data do arquivo.
    lista.sort((a, b) => b.nome.compareTo(a.nome));
    return lista;
  }

  /// Arquivo de backup pelo nome, recusando qualquer coisa fora da pasta.
  File? arquivo(String nome) {
    if (nome != p.basename(nome) || !_nomeValido.hasMatch(nome)) return null;
    final f = File(p.join(pastaDestino, nome));
    return f.existsSync() ? f : null;
  }

  Future<bool> excluir(String nome) async {
    final f = arquivo(nome);
    if (f == null) return false;
    await f.delete();
    return true;
  }

  /// Apaga os backups mais antigos, mantendo a quantidade configurada.
  Future<void> _rotacionar() async {
    final lista = await listar();
    for (final velho in lista.skip(_manter())) {
      await File(p.join(pastaDestino, velho.nome)).delete();
    }
  }

  /// Verifica a cada minuto se chegou o horário e se o backup de hoje ainda não foi feito.
  void agendar() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(minutes: 1), (_) => verificar());
  }

  /// Faz o backup do dia se já passou do horário. Depois de uma falha, registra em
  /// backup.json, avisa ([aoFalhar], uma vez por dia) e espera [intervaloNovaTentativa].
  Future<void> verificar() async {
    final agora = _agora();
    if (_hhmm(agora).compareTo(horario) < 0) return;
    final u = await ultimo();
    if (u != null && _data(u) == _data(agora)) return;
    final falhou = _ultimaFalha;
    if (falhou != null && agora.difference(falhou) < intervaloNovaTentativa) return;
    try {
      final f = await executar(agora: agora);
      _ultimaFalha = null;
      stdout.writeln('Backup gravado em ${f.path}');
    } catch (e) {
      _ultimaFalha = agora;
      stderr.writeln('Falha no backup: $e');
      try {
        await _gravarEstado({'falha': {'em': agora.toIso8601String()}});
      } catch (_) {}
      if (_avisoFalhaNoDia != _data(agora)) {
        _avisoFalhaNoDia = _data(agora);
        try {
          await aoFalhar?.call(agora);
        } catch (e) {
          stderr.writeln('Falha ao avisar a falha do backup: ${e.runtimeType}');
        }
      }
    }
  }

  void parar() => _timer?.cancel();

  static String _data(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  static String _hhmm(DateTime d) => '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  static String _hora(DateTime d) => _hhmm(d).replaceAll(':', '') + d.second.toString().padLeft(2, '0');
}

/// Avisos sobre o backup para o painel e o /admin (vazio quando está tudo bem).
/// [copiaPc] é a última cópia confirmada pelo agente no PC da igreja (só no modo agente);
/// [copiaPcLigada] diz se a senha do backup, que liga essa cópia, foi definida.
List<String> alertasBackup({
  required DateTime? ultimo,
  required DateTime? falha,
  DateTime? copiaPc,
  bool modoAgente = false,
  bool copiaPcLigada = true,
  required DateTime agora,
}) {
  String dataHora(DateTime d) => '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')} às '
      '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  final alertas = <String>[];
  if (falha != null && (ultimo == null || falha.isAfter(ultimo))) {
    alertas.add('O backup automático falhou em ${dataHora(falha)}. Use "Gravar backup no servidor" para tentar de novo '
        'e, se continuar, veja o registro do servidor.');
  } else if (ultimo != null && agora.difference(ultimo) > const Duration(days: 2)) {
    alertas.add('O último backup foi em ${dataHora(ultimo)}, há ${agora.difference(ultimo).inDays} dias.');
  }
  if (modoAgente && !copiaPcLigada) {
    alertas.add('A cópia do backup no PC da igreja está desligada. Defina a senha do backup em /admin › '
        'Backup e restauração para ligar.');
  } else if (modoAgente && ultimo != null) {
    if (copiaPc == null) {
      if (agora.difference(ultimo) > const Duration(days: 1)) {
        alertas.add('Ainda não há cópia do backup no PC da igreja. Confira se o agente está conectado e atualizado.');
      }
    } else if (agora.difference(copiaPc) > const Duration(days: 3)) {
      alertas.add('A última cópia do backup no PC da igreja foi em ${dataHora(copiaPc)}. Confira se o agente está conectado.');
    }
  }
  return alertas;
}

/// O que foi restaurado.
class ResumoRestauracao {
  final colecoes = <String, int>{};
  int cartazes = 0;
  int fotosGaleria = 0;
  int fotosMembros = 0;
  int termosLgpd = 0;
  bool historico = false;
  bool auditoria = false;
  bool configuracoes = false;
  String? backupSeguranca;

  Map<String, dynamic> toJson() => {
        'colecoes': colecoes,
        'cartazes': cartazes,
        'fotosGaleria': fotosGaleria,
        'fotosMembros': fotosMembros,
        'termosLgpd': termosLgpd,
        'historico': historico,
        'auditoria': auditoria,
        'configuracoes': configuracoes,
        'backupSeguranca': backupSeguranca,
      };
}

/// Restaura um backup .zip: valida tudo antes, faz um backup de segurança e só então substitui.
class Restauracao {
  Restauracao({
    required this.store,
    required this.backup,
    required this.pastaDados,
    required this.pastaCartazes,
    this.aplicarConfiguracoes,
  });

  final Store store;
  final Backup backup;
  final String pastaDados;
  final String pastaCartazes;

  /// Aplica as configurações públicas do backup (quando o usuário pede).
  final Future<void> Function(Map<String, dynamic>)? aplicarConfiguracoes;

  static const tamanhoMaximo = 500 * 1024 * 1024;

  Future<ResumoRestauracao> restaurar(List<int> zip, {bool configuracoes = false}) async {
    final Archive arquivo;
    try {
      arquivo = ZipDecoder().decodeBytes(zip);
    } catch (_) {
      throw const FormatException('O arquivo não é um backup do DiakoHub (.zip).');
    }
    if (arquivo.files.fold<int>(0, (t, f) => t + f.size) > tamanhoMaximo) {
      throw const FormatException('Backup grande demais.');
    }

    // 1. Valida tudo antes de mexer em qualquer coisa.
    final colecoes = <String, List<Map<String, dynamic>>>{};
    for (final nome in Store.colecoes) {
      final f = arquivo.findFile('data/$nome.json');
      if (f == null) continue;
      try {
        final lista = [for (final e in jsonDecode(utf8.decode(f.content)) as List) Map<String, dynamic>.from(e as Map)];
        for (final doc in lista) {
          switch (nome) {
            case 'recados':
              Recado.fromJson(doc);
            case 'motivos':
              Motivo.fromJson(doc);
            case 'membros':
              Membro.fromJson(doc);
              final foto = (doc['foto'] as String?)?.trim();
              if (foto != null && foto.isNotEmpty && !FotosMembros.nomeValido(foto)) {
                throw const FormatException('Foto de membro inválida.');
              }
              final termo = (doc['termoAssinado'] as String?)?.trim();
              if (termo != null && termo.isNotEmpty && !TermosAssinados.nomeValido(termo)) {
                throw const FormatException('Termo assinado inválido.');
              }
            case 'mensagens':
              final mensagem = Mensagem.fromJson(doc);
              if (!Mensagem.tipos.contains(mensagem.tipo) || !Mensagem.statusValidos.contains(mensagem.status)) {
                throw const FormatException('Mensagem inválida.');
              }
            case 'galeria':
              if (doc['id'] is! String ||
                  !Galeria.nomeValido(doc['arquivo'] as String? ?? '') ||
                  !Galeria.nomeValido(doc['miniatura'] as String? ?? '')) {
                throw const FormatException('Foto da galeria inválida.');
              }
            case 'visitas':
              Visita.fromJson(doc);
            case 'escalas':
              CultoEscala.fromJson(doc);
            case 'indisponibilidades':
              Indisponibilidade.fromJson(doc);
            case 'linksEscala':
              if (doc['id'] is! String || doc['hash'] is! String) throw const FormatException('Link de escala inválido.');
            case 'repertorio':
              if (RepertorioMusica.fromJson(doc).id.isEmpty) throw const FormatException('Música sem id.');
            case 'gestaoCasa':
              if (doc['id'] is! String || !{'tarefa', 'rotina'}.contains(doc['registro']) ||
                  (doc['anexos'] is List && (doc['anexos'] as List).any((a) => a is! String || !AnexosCasa.nomeValido(a)))) {
                throw const FormatException('Registro da Gestão da Casa inválido.');
              }
            case 'atas':
              if (doc['id'] is! String || doc['tipo'] is! String || doc['data'] is! String ||
                  !{'rascunho', 'finalizada', 'aprovada'}.contains(doc['status']) ||
                  (doc['anexos'] is List && (doc['anexos'] as List).any((a) => a is! String || !AnexosCasa.nomeValido(a)))) {
                throw const FormatException('Ata inválida.');
              }
            case 'ministerios':
              if (doc['id'] is! String || doc['nome'] is! String || (doc['nome'] as String).trim().isEmpty) {
                throw const FormatException('Ministério inválido.');
              }
          }
        }
        colecoes[nome] = lista;
      } catch (_) {
        throw FormatException('Backup com dados inválidos em data/$nome.json.');
      }
    }
    if (colecoes.isEmpty) throw const FormatException('O arquivo não contém dados do DiakoHub.');
    // Uma cópia anterior à criação destes módulos não possui esses arquivos.
    // Ao restaurar o cadastro inteiro, não deixar dados posteriores apontando
    // para membros que já não existem no snapshot restaurado.
    if (colecoes.containsKey('membros')) {
      for (final nome in _colecoesMinisterio) {
        colecoes.putIfAbsent(nome, () => <Map<String, dynamic>>[]);
      }
    }
    _validarMinisterio(colecoes);

    final cartazes = <String, List<int>>{};
    var temPastaCartazes = false;
    for (final f in arquivo.files) {
      if (!f.isFile || !f.name.startsWith('cartazes/')) continue;
      temPastaCartazes = true;
      final nome = f.name.substring('cartazes/'.length);
        if (Cartazes.nomeValido(nome) && !ehArquivoDeQr(nome)) cartazes[nome] = f.content;
    }
    final fotos = <String, List<int>>{};
    var temPastaGaleria = false;
    for (final f in arquivo.files) {
      if (!f.isFile || !f.name.startsWith('galeria/')) continue;
      temPastaGaleria = true;
      final nome = f.name.substring('galeria/'.length);
      if (Galeria.nomeValido(nome)) fotos[nome] = f.content;
    }
    final fundos = <String, List<int>>{};
    var temPastaFundos = false;
    for (final f in arquivo.files) {
      if (!f.isFile || !f.name.startsWith('fundos-tv/')) continue;
      temPastaFundos = true;
      final nome = f.name.substring('fundos-tv/'.length);
      if (FundosTv.nomeValido(nome)) fundos[nome] = f.content;
    }
    final artes = <String, List<int>>{};
    var temPastaArtes = false;
    for (final f in arquivo.files) {
      if (!f.isFile || !f.name.startsWith('artes-qr/')) continue;
      temPastaArtes = true;
      final nome = f.name.substring('artes-qr/'.length);
      if (ArtesQr.nomeValido(nome)) artes[nome] = f.content;
    }
    final fotosDosMembros = <String, List<int>>{};
    var temPastaFotosMembros = false;
    for (final f in arquivo.files) {
      if (!f.isFile || !f.name.startsWith('fotos-membros/')) continue;
      temPastaFotosMembros = true;
      final nome = f.name.substring('fotos-membros/'.length);
      if (FotosMembros.nomeValido(nome)) fotosDosMembros[nome] = f.content;
    }
    final termos = <String, List<int>>{};
    var temPastaTermos = false;
    for (final f in arquivo.files) {
      if (!f.isFile || !f.name.startsWith('termos-lgpd/')) continue;
      temPastaTermos = true;
      final nome = f.name.substring('termos-lgpd/'.length);
      if (TermosAssinados.nomeValido(nome)) termos[nome] = f.content;
    }
    final anexosCasa = <String, List<int>>{};
    var temPastaAnexosCasa = false;
    for (final f in arquivo.files) {
      if (!f.isFile || !f.name.startsWith('anexos-casa/')) continue;
      temPastaAnexosCasa = true;
      final nome = f.name.substring('anexos-casa/'.length);
      if (AnexosCasa.nomeValido(nome)) anexosCasa[nome] = f.content;
    }
    final anexosAtas = <String, List<int>>{};
    var temPastaAnexosAtas = false;
    for (final f in arquivo.files) {
      if (!f.isFile || !f.name.startsWith('anexos-atas/')) continue;
      temPastaAnexosAtas = true;
      final nome = f.name.substring('anexos-atas/'.length);
      if (AnexosCasa.nomeValido(nome)) anexosAtas[nome] = f.content;
    }
    final historico = arquivo.findFile('data/historico.jsonl');
    final auditoria = arquivo.findFile('data/auditoria.jsonl');
    Map<String, dynamic>? cfg;
    final cfgArquivo = arquivo.findFile('configuracoes.json');
    if (configuracoes && cfgArquivo != null) {
      try {
        cfg = Map<String, dynamic>.from(jsonDecode(utf8.decode(cfgArquivo.content)) as Map);
      } catch (_) {
        throw const FormatException('configuracoes.json inválido no backup.');
      }
    }

    // 2. Backup de segurança do estado atual.
    final resumo = ResumoRestauracao();
    resumo.backupSeguranca = p.basename((await backup.executar(sufixo: 'antes-restauracao')).path);

    // 3. Substitui.
    for (final e in colecoes.entries) {
      await store.substituir(e.key, e.value);
      resumo.colecoes[e.key] = e.value.length;
    }
    if (historico != null) {
      await File(p.join(pastaDados, 'historico.jsonl')).writeAsBytes(historico.content, flush: true);
      resumo.historico = true;
      store.avisar('historico');
    }
    if (auditoria != null) {
      await File(p.join(pastaDados, 'auditoria.jsonl')).writeAsBytes(auditoria.content, flush: true);
      resumo.auditoria = true;
      store.avisar('auditoria');
    }
    // Backups antigos (sem a pasta cartazes/) mantêm os cartazes atuais.
    if (temPastaCartazes) {
      final dir = Directory(pastaCartazes);
      await dir.create(recursive: true);
      await for (final e in dir.list()) {
        final nome = p.basename(e.path);
        if (e is File && nome != arquivoQr && Cartazes.nomeValido(nome)) await e.delete();
      }
      for (final c in cartazes.entries) {
        await File(p.join(pastaCartazes, c.key)).writeAsBytes(c.value, flush: true);
      }
      resumo.cartazes = cartazes.length;
      store.avisar('cartazes');
    }
    // Idem para as fotos da galeria do site (backups de antes dela mantêm as atuais).
    if (temPastaGaleria) {
      final dir = Directory(Galeria(pastaDados).pasta);
      await dir.create(recursive: true);
      await for (final e in dir.list()) {
        if (e is File && Galeria.nomeValido(p.basename(e.path))) await e.delete();
      }
      for (final f in fotos.entries) {
        await File(p.join(dir.path, f.key)).writeAsBytes(f.value, flush: true);
      }
      resumo.fotosGaleria = fotos.keys.where((k) => !k.endsWith('-m.jpg')).length;
      store.avisar('galeria');
    }
    // Fundos das TVs (backups de antes deles mantêm os atuais).
    if (temPastaFundos) {
      final dir = Directory(FundosTv(pastaDados).pasta);
      await dir.create(recursive: true);
      await for (final e in dir.list()) {
        if (e is File && FundosTv.nomeValido(p.basename(e.path))) await e.delete();
      }
      for (final f in fundos.entries) {
        await File(p.join(dir.path, f.key)).writeAsBytes(f.value, flush: true);
      }
    }
    // Artes dos QR projetados (idem; o QR é refeito depois, junto com as configurações).
    if (temPastaArtes) {
      final dir = Directory(ArtesQr(pastaDados).pasta);
      await dir.create(recursive: true);
      await for (final e in dir.list()) {
        if (e is File && ArtesQr.nomeValido(p.basename(e.path))) await e.delete();
      }
      for (final f in artes.entries) {
        await File(p.join(dir.path, f.key)).writeAsBytes(f.value, flush: true);
      }
    }
    // Idem para as fotos do cadastro de membros (backups de antes mantêm as atuais).
    if (temPastaFotosMembros) {
      final dir = Directory(FotosMembros(pastaDados).pasta);
      await dir.create(recursive: true);
      await for (final e in dir.list()) {
        if (e is File && FotosMembros.nomeValido(p.basename(e.path))) await e.delete();
      }
      for (final f in fotosDosMembros.entries) {
        await File(p.join(dir.path, f.key)).writeAsBytes(f.value, flush: true);
      }
      resumo.fotosMembros = fotosDosMembros.keys.where((k) => !k.endsWith('-m.jpg')).length;
    }
    // Termos da LGPD assinados (backups de antes deles mantêm os atuais).
    if (temPastaTermos) {
      final dir = Directory(TermosAssinados(pastaDados).pasta);
      await dir.create(recursive: true);
      await for (final e in dir.list()) {
        if (e is File && TermosAssinados.nomeValido(p.basename(e.path))) await e.delete();
      }
      for (final f in termos.entries) {
        await File(p.join(dir.path, f.key)).writeAsBytes(f.value, flush: true);
      }
      resumo.termosLgpd = termos.length;
    }
    if (temPastaAnexosCasa) {
      final dir = Directory(AnexosCasa(pastaDados).pasta);
      await dir.create(recursive: true);
      await for (final e in dir.list()) {
        if (e is File && AnexosCasa.nomeValido(p.basename(e.path))) await e.delete();
      }
      for (final a in anexosCasa.entries) {
        await File(p.join(dir.path, a.key)).writeAsBytes(a.value, flush: true);
      }
    }
    // Anexos das atas (backups de antes delas mantêm os atuais).
    if (temPastaAnexosAtas) {
      final dir = Directory(AnexosCasa.atas(pastaDados).pasta);
      await dir.create(recursive: true);
      await for (final e in dir.list()) {
        if (e is File && AnexosCasa.nomeValido(p.basename(e.path))) await e.delete();
      }
      for (final a in anexosAtas.entries) {
        await File(p.join(dir.path, a.key)).writeAsBytes(a.value, flush: true);
      }
    }
    if (cfg != null && aplicarConfiguracoes != null) {
      await aplicarConfiguracoes!(cfg);
      resumo.configuracoes = true;
    }
    return resumo;
  }

  // A restauração confere o contrato persistido, não as permissões atuais de
  // contas (que não fazem parte do ZIP), nem o vínculo conjugal atual: histórico
  // pode legitimamente anteceder uma alteração no cadastro.
  void _validarMinisterio(Map<String, List<Map<String, dynamic>>> colecoes) {
    List<Map<String, dynamic>> documentos(String nome) => colecoes[nome] ?? store.listar(nome);
    bool texto(Object? v) => v is String && v.trim().isNotEmpty;
    void exigir(bool valido) {
      if (!valido) throw const FormatException('Backup com dados inválidos de Casais, Encontros ou Materiais.');
    }
    void data(Object? v, {bool dia = false}) {
      exigir(v is String);
      final s = v as String;
      exigir(RegExp(dia ? r'^\d{4}-\d{2}-\d{2}$' :
          r'^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?)?$').hasMatch(s));
      final d = DateTime.tryParse(s.substring(0, 10));
      exigir(d != null && d.year >= 1900 && d.year <= 2200 &&
          d.toIso8601String().substring(0, 10) == s.substring(0, 10) && DateTime.tryParse(s) != null);
      if (s.length > 10) {
        exigir(int.parse(s.substring(11, 13)) <= 23 && int.parse(s.substring(14, 16)) <= 59);
        if (s.length > 16 && s[16] == ':') exigir(int.parse(s.substring(17, 19)) <= 59);
      }
    }
    void campos(Map d, Set<String> permitidos) => exigir(d.keys.every(permitidos.contains));
    void limite(Object? v, int tamanho, {bool obrigatorio = false}) =>
        exigir(v is String && v.length <= tamanho && (!obrigatorio || texto(v)));
    void inteiro(Object? v, int min, int max) => exigir(v is int && v >= min && v <= max);
    const camposAutoria = {'id', 'criadoEm', 'usuarioId', 'usuarioNome', 'alteradoEm', 'alteradoPor',
      'atualizadoEm', 'atualizadoPor', 'canceladoEm', 'canceladoPor', 'arquivadoEm', 'arquivadoPor'};
    void autoria(Map d) {
      exigir(texto(d['usuarioId']) && texto(d['usuarioNome']));
      data(d['criadoEm']);
      for (final campo in ['alteradoEm', 'atualizadoEm', 'canceladoEm', 'arquivadoEm']) {
        if (d[campo] != null) data(d[campo]);
      }
      for (final campo in ['alteradoPor', 'atualizadoPor', 'canceladoPor', 'arquivadoPor']) {
        if (d[campo] != null) exigir(texto(d[campo]));
      }
      for (final prefixo in ['cancelado', 'arquivado']) {
        exigir((d['${prefixo}Em'] == null) == (d['${prefixo}Por'] == null));
      }
    }
    const camposConteudo = {'titulo', 'publico', 'objetivo', 'duracaoMinutos', 'referenciasBiblicas', 'preparacao', 'passos', 'perguntas'};
    void conteudo(Map d) {
      limite(d['titulo'], 20000, obrigatorio: true);
      exigir(Materiais.publicos.containsKey(d['publico']));
      if (d['tipoNome'] != null) limite(d['tipoNome'], 60, obrigatorio: true);
      inteiro(d['duracaoMinutos'], 1, 480);
      var total = (d['titulo'] as String).length;
      for (final campo in ['objetivo', 'referenciasBiblicas', 'preparacao', 'passos', 'perguntas']) {
        if (d[campo] == null && !d.containsKey(campo)) continue;
        limite(d[campo], 20000);
        total += (d[campo] as String).length;
      }
      exigir(total <= 20000);
    }
    for (final nome in _colecoesMinisterio) {
      final ids = <String>{};
      for (final d in colecoes[nome] ?? <Map<String, dynamic>>[]) {
        exigir(texto(d['id']));
        exigir(ids.add(d['id'] as String));
      }
    }
    final membros = documentos('membros').map((d) => d['id']).whereType<String>().toSet();
    final encontros = documentos('encontros').map((d) => d['id']).whereType<String>().toSet();
    final materiais = {for (final d in documentos('materiais')) d['id']: d};
    final ministerios = documentos('ministerios').map((d) => d['id']).whereType<String>().toSet();
    final tipos = documentos('tiposMaterial').map((d) => d['id']).whereType<String>().toSet();
    for (final d in colecoes['tiposMaterial'] ?? <Map<String, dynamic>>[]) {
      campos(d, {...camposAutoria, 'nome'});
      autoria(d);
      limite(d['nome'], 60, obrigatorio: true);
    }
    for (final d in colecoes['casaisContatos'] ?? <Map<String, dynamic>>[]) {
      exigir(d.keys.every({'id', 'membrosIds', 'casalChave', 'tipo', 'ocorrencia',
        'realizadoEm', 'registradoEm', 'usuarioId', 'usuarioNome', 'anuladoEm', 'anuladoPor'}.contains));
      exigir(texto(d['id']) && texto(d['casalChave']) && texto(d['usuarioId']) && texto(d['usuarioNome']));
      exigir({'parabenizado', 'convite_enviado', 'contato_realizado'}.contains(d['tipo']));
      final ids = d['membrosIds'];
      exigir(ids is List && ids.isNotEmpty && ids.length <= 2 && ids.toSet().length == ids.length &&
          ids.every((id) => texto(id) && membros.contains(id)));
      data(d['realizadoEm'], dia: true);
      data(d['registradoEm']);
      if (d['tipo'] == 'parabenizado') {
        data(d['ocorrencia'], dia: true);
      } else {
        exigir(!d.containsKey('ocorrencia'));
      }
      if (d['anuladoEm'] != null || d['anuladoPor'] != null) {
        data(d['anuladoEm']);
        exigir(texto(d['anuladoPor']));
      }
    }
    for (final d in colecoes['materiais'] ?? <Map<String, dynamic>>[]) {
      campos(d, {...camposConteudo, ...camposAutoria, 'versao', 'arquivado', 'ministerioId', 'tipoId'});
      autoria(d);
      conteudo(d);
      inteiro(d['versao'], 1, 0x7fffffff);
      exigir(d['arquivado'] is bool);
      exigir(d['ministerioId'] == null || ministerios.contains(d['ministerioId']));
      exigir(d['tipoId'] == null || tipos.contains(d['tipoId']));
    }
    for (final d in colecoes['encontros'] ?? <Map<String, dynamic>>[]) {
      campos(d, {...camposAutoria, 'titulo', 'tipo', 'inicio', 'fim', 'local', 'descricao', 'capacidade', 'estado', 'roteiro', 'ministerioId'});
      autoria(d);
      exigir(d['ministerioId'] == null || ministerios.contains(d['ministerioId']));
      limite(d['titulo'], 160, obrigatorio: true);
      exigir({'culto', 'conferencia', 'retiro', 'acampamento', 'jantar', 'palestra', 'treinamento',
        'encontro_familias', 'outro'}.contains(d['tipo']));
      exigir({'rascunho', 'aberto', 'encerrado', 'cancelado'}.contains(d['estado']));
      data(d['inicio']);
      data(d['fim']);
      exigir(DateTime.parse(d['fim']).isAfter(DateTime.parse(d['inicio'])));
      if (d['capacidade'] != null) inteiro(d['capacidade'], 1, 100000);
      for (final campo in ['local', 'descricao']) {
        if (d[campo] != null) limite(d[campo], campo == 'local' ? 300 : 3000);
      }
      if (d.containsKey('roteiro')) {
        final roteiro = d['roteiro'];
        exigir(roteiro is List && roteiro.length <= 20);
        final usados = <String>{};
        for (final item in roteiro as List) {
          exigir(item is Map);
          final r = item as Map;
          campos(r, {'materialId', 'versao', 'conteudoSnapshot'});
          exigir(texto(r['materialId']) && materiais.containsKey(r['materialId']));
          exigir(usados.add(r['materialId'] as String));
          inteiro(r['versao'], 1, 0x7fffffff);
          final versaoAtual = materiais[r['materialId']]!['versao'];
          exigir(versaoAtual is int && r['versao'] <= versaoAtual);
          exigir(r['conteudoSnapshot'] is Map);
          final snapshot = r['conteudoSnapshot'] as Map;
          campos(snapshot, {...camposConteudo, 'tipoNome'});
          conteudo(snapshot);
        }
      }
    }
    final ocupacaoPorEncontro = <String, int>{};
    final membrosPorEncontro = <String, Set<String>>{};
    for (final d in colecoes['inscricoes'] ?? <Map<String, dynamic>>[]) {
      campos(d, {...camposAutoria, 'encontroId', 'responsavelMembroId', 'participantes', 'estado'});
      autoria(d);
      exigir(encontros.contains(d['encontroId']) && membros.contains(d['responsavelMembroId']));
      exigir({'confirmada', 'cancelada'}.contains(d['estado']));
      final participantes = d['participantes'];
      exigir(participantes is List && participantes.isNotEmpty && participantes.length <= 100);
      final ids = <String>{};
      final membrosInscritos = <String>{};
      for (final item in participantes as List) {
        exigir(item is Map);
        final pessoa = item as Map;
        campos(pessoa, {'id', 'membroId', 'nomeAcompanhante', 'crianca', 'confirmado',
          'presenteEm', 'presencaPor', 'presencaPorNome', 'presencaAlteradaEm', 'presencaAlteradaPor'});
        exigir(texto(pessoa['id']));
        exigir(ids.add(pessoa['id'] as String));
        exigir((pessoa['membroId'] != null) != (pessoa['nomeAcompanhante'] != null));
        if (pessoa['membroId'] != null) {
          exigir(texto(pessoa['membroId']) && membros.contains(pessoa['membroId']));
          exigir(membrosInscritos.add(pessoa['membroId'] as String));
          if (d['estado'] == 'confirmada') {
            exigir(membrosPorEncontro.putIfAbsent(d['encontroId'] as String, () => <String>{})
                .add(pessoa['membroId'] as String));
          }
        } else {
          limite(pessoa['nomeAcompanhante'], 160, obrigatorio: true);
        }
        exigir(pessoa['crianca'] is bool && pessoa['confirmado'] is bool);
        if (pessoa['presenteEm'] != null || pessoa['presencaPor'] != null) {
          data(pessoa['presenteEm']);
          exigir(texto(pessoa['presencaPor']) && pessoa['confirmado'] == true);
        }
        if (pessoa['presencaPorNome'] != null) exigir(texto(pessoa['presencaPorNome']));
        if (pessoa['presencaAlteradaEm'] != null || pessoa['presencaAlteradaPor'] != null) {
          data(pessoa['presencaAlteradaEm']);
          exigir(texto(pessoa['presencaAlteradaPor']));
        }
      }
      if (d['estado'] == 'confirmada') {
        final id = d['encontroId'] as String;
        ocupacaoPorEncontro[id] = (ocupacaoPorEncontro[id] ?? 0) + participantes.length;
      }
    }
    for (final encontro in documentos('encontros')) {
      if (encontro['capacidade'] is int) {
        exigir((ocupacaoPorEncontro[encontro['id']] ?? 0) <= encontro['capacidade']);
      }
    }
    for (final d in colecoes['tarefasEncontros'] ?? <Map<String, dynamic>>[]) {
      campos(d, {...camposAutoria, 'encontroId', 'descricao', 'responsavelUsuarioId', 'prazo', 'estado'});
      autoria(d);
      exigir(encontros.contains(d['encontroId']));
      limite(d['descricao'], 1000, obrigatorio: true);
      exigir({'pendente', 'concluida', 'cancelada'}.contains(d['estado']));
      if (d['responsavelUsuarioId'] != null) exigir(texto(d['responsavelUsuarioId']));
      if (d['prazo'] != null) data(d['prazo'], dia: true);
    }
    for (final d in colecoes['casaisEnvios'] ?? <Map<String, dynamic>>[]) {
      campos(d, {'id', 'finalidade', 'membrosIds', 'casalChave', 'ocorrencia', 'destinatarioHash',
        'destinatarioMembroId', 'estado', 'registradoEm', 'finalizadoEm', 'usuarioId', 'usuarioNome'});
      exigir(d['finalidade'] == 'parabens' && {'reservado', 'aceito_smtp', 'incerto', 'nao_enviado'}.contains(d['estado']));
      exigir(texto(d['usuarioId']) && texto(d['usuarioNome']) && texto(d['casalChave']));
      exigir(d['destinatarioHash'] is String && RegExp(r'^[a-f0-9]{64}$').hasMatch(d['destinatarioHash']));
      final ids = d['membrosIds'];
      exigir(ids is List && ids.isNotEmpty && ids.length <= 2 && ids.toSet().length == ids.length &&
          ids.every((id) => texto(id) && membros.contains(id)));
      exigir(texto(d['destinatarioMembroId']) && membros.contains(d['destinatarioMembroId']) &&
          (ids as List).contains(d['destinatarioMembroId']));
      data(d['ocorrencia'], dia: true);
      data(d['registradoEm']);
      if (d['finalizadoEm'] != null) data(d['finalizadoEm']);
    }
  }
}
