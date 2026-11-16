import 'dart:io';

import 'package:diako_core/diako_core.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../app_scope.dart';
import '../../sync/server_api.dart';
import 'assinatura_pad.dart';
import 'gestao_page.dart' show dataBr;

/// Diálogo que gera o certificado de batismo: escolhe a assinatura salva e/ou o carimbo
/// da igreja (desenhados ou enviados uma única vez — ficam salvos no servidor), quem
/// assina, e compartilha o PDF pronto (imprimir, salvar, WhatsApp…).
class CertificadoDialog extends StatefulWidget {
  const CertificadoDialog({super.key, required this.membro});

  final Membro membro;

  static Future<void> abrir(BuildContext context, Membro membro) =>
      showDialog(context: context, builder: (_) => CertificadoDialog(membro: membro));

  @override
  State<CertificadoDialog> createState() => _CertificadoDialogState();
}

class _CertificadoDialogState extends State<CertificadoDialog> {
  final _pastor = TextEditingController();
  final _cargo = TextEditingController();
  var _temAssinatura = false, _temCarimbo = false;
  var _usaAssinatura = false, _usaCarimbo = false;
  var _carregando = true, _gerando = false, _enviando = false;
  var _versao = 0; // troca a URL das prévias quando a imagem é trocada
  String? _erro;
  var _carregado = false;

  @override
  void dispose() {
    _pastor.dispose();
    _cargo.dispose();
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_carregado) {
      _carregado = true;
      _carregar();
    }
  }

  Future<void> _carregar() async {
    final api = AppScope.of(context).api;
    try {
      final c = await api.certificadoConfig();
      if (!mounted) return;
      setState(() {
        _pastor.text = (c['pastor'] as String? ?? '').trim();
        _cargo.text = (c['cargo'] as String? ?? 'Pastor').trim();
        _temAssinatura = c['assinatura'] == true;
        _temCarimbo = c['carimbo'] == true;
        _usaAssinatura = _temAssinatura;
        _usaCarimbo = _temCarimbo;
        _carregando = false;
        _erro = null;
      });
    } on ErroAmigavel catch (e) {
      if (mounted) {
        setState(() {
          _erro = e.message;
          _carregando = false;
        });
      }
    }
  }

  Future<void> _desenhar() async {
    final png = await AssinaturaPad.abrir(context);
    if (png == null) return;
    await _enviar('assinatura', png);
  }

  Future<void> _daGaleria(String tipo) async {
    final foto = await ImagePicker()
        .pickImage(source: ImageSource.gallery, maxWidth: 1600, maxHeight: 1600, imageQuality: 90);
    if (foto == null) return;
    await _enviar(tipo, await foto.readAsBytes());
  }

  Future<void> _enviar(String tipo, List<int> bytes) async {
    final api = AppScope.of(context).api;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _enviando = true);
    try {
      await api.enviarImagemCertificado(tipo, bytes);
      if (!mounted) return;
      setState(() {
        _versao++;
        if (tipo == 'assinatura') {
          _temAssinatura = true;
          _usaAssinatura = true;
        } else {
          _temCarimbo = true;
          _usaCarimbo = true;
        }
      });
      messenger.showSnackBar(const SnackBar(content: Text('Imagem salva no servidor.'), duration: Duration(seconds: 2)));
    } on ErroAmigavel catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message), backgroundColor: Colors.red.shade700));
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  Future<void> _remover(String tipo) async {
    final api = AppScope.of(context).api;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _enviando = true);
    try {
      await api.removerImagemCertificado(tipo);
      if (!mounted) return;
      setState(() {
        _versao++;
        if (tipo == 'assinatura') {
          _temAssinatura = false;
          _usaAssinatura = false;
        } else {
          _temCarimbo = false;
          _usaCarimbo = false;
        }
      });
    } on ErroAmigavel catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message), backgroundColor: Colors.red.shade700));
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  Future<void> _gerar() async {
    final api = AppScope.of(context).api;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _gerando = true);
    final pastor = _pastor.text.trim();
    final cargo = _cargo.text.trim();
    try {
      // Deixa o ministro/cargo salvos para os próximos certificados (falha não impede o PDF).
      try {
        await api.salvarCertificadoConfig(pastor, cargo.isEmpty ? 'Pastor' : cargo);
      } on ErroAmigavel {
        // segue sem salvar
      }
      final pdf = await api.certificadoBatismo(widget.membro.id,
          assinatura: _usaAssinatura, carimbo: _usaCarimbo, pastor: pastor, cargo: cargo);
      final slug = widget.membro.nome
          .toLowerCase()
          .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
          .replaceAll(RegExp(r'^-+|-+$'), '');
      final pasta = await getTemporaryDirectory();
      final arquivo = File('${pasta.path}/certificado-batismo-${slug.isEmpty ? 'membro' : slug}.pdf');
      await arquivo.writeAsBytes(pdf, flush: true);
      await Share.shareXFiles([XFile(arquivo.path, mimeType: 'application/pdf')],
          subject: 'Certificado de batismo — ${widget.membro.nome}');
    } on ErroAmigavel catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message), backgroundColor: Colors.red.shade700));
    } catch (_) {
      messenger.showSnackBar(
          SnackBar(content: const Text('Não foi possível compartilhar o PDF.'), backgroundColor: Colors.red.shade700));
    } finally {
      if (mounted) setState(() => _gerando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    return AlertDialog(
      title: const Text('Certificado de batismo'),
      content: SizedBox(
        width: 560,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              _resumo(tema),
              if (_carregando)
                const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()))
              else if (_erro != null)
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(children: [
                    Text(_erro!, textAlign: TextAlign.center, style: TextStyle(color: tema.colorScheme.error)),
                    const SizedBox(height: 8),
                    FilledButton(onPressed: _carregar, child: const Text('Tentar de novo')),
                  ]),
                )
              else ...[
                _blocoAssinatura(tema),
                const SizedBox(height: 12),
                _blocoCarimbo(tema),
                const SizedBox(height: 16),
                TextField(
                  controller: _pastor,
                  decoration: const InputDecoration(
                    labelText: 'Quem assina (ministro)',
                    hintText: 'Ex.: Pr. Marcos',
                    border: OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _cargo,
                  decoration: const InputDecoration(
                    labelText: 'Cargo',
                    hintText: 'Pastor',
                    border: OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(onPressed: _gerando ? null : () => Navigator.pop(context), child: const Text('Fechar')),
        FilledButton.icon(
          icon: _gerando
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.picture_as_pdf_outlined),
          label: Text(_gerando ? 'Gerando…' : 'Gerar PDF'),
          onPressed: (!_carregando && _erro == null && !_gerando) ? _gerar : null,
        ),
      ],
    );
  }

  Widget _resumo(ThemeData tema) {
    final m = widget.membro;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: tema.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(m.nome, style: tema.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
        const SizedBox(height: 2),
        Text('Batismo: ${dataBr(m.dataBatismo)}', style: TextStyle(color: tema.colorScheme.outline)),
      ]),
    );
  }

  Widget _previa(ThemeData tema, String tipo) {
    final api = AppScope.of(context).api;
    return Container(
      height: 64,
      width: 170,
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: tema.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(8),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Image.network(
          '${api.base}/api/certificado/$tipo?v=$_versao',
          headers: api.autorizacao,
          fit: BoxFit.contain,
          errorBuilder: (_, __, ___) =>
              Icon(Icons.image_not_supported_outlined, color: tema.colorScheme.outline),
        ),
      ),
    );
  }

  Widget _blocoAssinatura(ThemeData tema) => _blocoImagem(
        tema,
        titulo: 'Assinatura salva',
        tipo: 'assinatura',
        marcado: _usaAssinatura,
        existe: _temAssinatura,
        aoMudar: (v) => setState(() => _usaAssinatura = v),
        dica: 'Desenhe na tela ou envie a foto/scan de uma assinatura — ela fica salva para os próximos certificados.',
        desenhar: _desenhar,
      );

  Widget _blocoCarimbo(ThemeData tema) => _blocoImagem(
        tema,
        titulo: 'Carimbo da igreja',
        tipo: 'carimbo',
        marcado: _usaCarimbo,
        existe: _temCarimbo,
        aoMudar: (v) => setState(() => _usaCarimbo = v),
        dica: 'Envie a imagem do carimbo (de preferência PNG com fundo transparente); ela também fica salva.',
      );

  Widget _blocoImagem(
    ThemeData tema, {
    required String titulo,
    required String tipo,
    required bool marcado,
    required bool existe,
    required void Function(bool) aoMudar,
    required String dica,
    Future<void> Function()? desenhar,
  }) {
    return Container(
      padding: const EdgeInsets.fromLTRB(4, 0, 8, 8),
      decoration: BoxDecoration(
        border: Border.all(color: tema.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        CheckboxListTile(
          value: marcado,
          onChanged: existe && !_enviando ? (v) => aoMudar(v ?? false) : null,
          controlAffinity: ListTileControlAffinity.leading,
          contentPadding: const EdgeInsets.symmetric(horizontal: 8),
          title: Text(titulo, style: const TextStyle(fontWeight: FontWeight.w600)),
          subtitle: Text(existe ? 'Usar a imagem salva no certificado' : 'Nenhuma imagem salva ainda'),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Text(dica, style: TextStyle(fontSize: 12, color: tema.colorScheme.outline)),
        ),
        if (_enviando) const Padding(padding: EdgeInsets.only(top: 8), child: LinearProgressIndicator(minHeight: 3)),
        const SizedBox(height: 8),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (existe) _previa(tema, tipo),
              if (desenhar != null)
                OutlinedButton.icon(
                  icon: const Icon(Icons.draw_outlined),
                  label: const Text('Desenhar'),
                  onPressed: !_enviando ? desenhar : null,
                ),
              OutlinedButton.icon(
                icon: const Icon(Icons.photo_library_outlined),
                label: Text(existe ? 'Trocar imagem' : 'Enviar imagem'),
                onPressed: !_enviando ? () => _daGaleria(tipo) : null,
              ),
              if (existe)
                IconButton(
                  tooltip: 'Remover imagem salva',
                  icon: const Icon(Icons.delete_outline),
                  onPressed: !_enviando ? () => _remover(tipo) : null,
                ),
            ],
          ),
        ),
      ]),
    );
  }
}
