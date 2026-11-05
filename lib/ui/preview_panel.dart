import 'package:diako_core/diako_core.dart';
import 'package:flutter/material.dart';

import '../app_scope.dart';
import '../data/blur_cartaz.dart';
import '../data/cartaz_composto.dart';
import '../data/cores.dart';
import 'previa_fundo.dart';
import '../sync/server_api.dart';

/// Prévia do recado com cartaz, como vai ao telão: com desfoque, o cartaz com título e texto
/// por cima; sem desfoque (Desligado), só o cartaz, como a projeção. Se o cartaz não carregar,
/// mostra o caminho.
class _FotoDoCartaz extends StatelessWidget {
  const _FotoDoCartaz({required this.recado});

  final Recado recado;

  @override
  Widget build(BuildContext context) {
    final scope = AppScope.of(context);
    final caminho = recado.imagemHolyrics!.trim();
    final nivel = scope.settings.blurCartaz;
    return FutureBuilder<List<Cartaz>>(
      future: scope.api.cartazes(),
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white54));
        }
        final cartaz = snap.data?.where((c) => c.holyrics == caminho).firstOrNull;
        if (cartaz == null) {
          return Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.image_outlined, size: 48, color: Colors.white70),
              const SizedBox(height: 8),
              Text(caminho, style: const TextStyle(color: Colors.white70)),
            ],
          );
        }
        if (nivel == NivelBlur.desligado) {
          return Image.network(
            cartaz.url,
            fit: BoxFit.contain,
            errorBuilder: (_, __, ___) => const Icon(Icons.broken_image_outlined, size: 48, color: Colors.white70),
          );
        }
        return CartazComTexto(
          url: cartaz.url,
          titulo: recado.titulo,
          texto: recado.texto,
          nivel: nivel,
          negrito: scope.settings.negritoTitulo,
        );
      },
    );
  }
}

class PreviewPanel extends StatelessWidget {
  const PreviewPanel({super.key, required this.recado, required this.selecionados});

  final Recado? recado;
  final List<Recado> selecionados;

  Future<void> _projetar(BuildContext context, Recado r) {
    final scope = AppScope.of(context);
    return executar(context, () async {
      if (r.ehImagem) {
        final nivel = scope.settings.blurCartaz;
        final caminho = nivel == NivelBlur.desligado
            ? r.imagemHolyrics!.trim()
            : await _cartazComTexto(scope, r, nivel);
        await scope.client.mostrarImagem(caminho);
      } else {
        await scope.client.projetarTexto(
          montarSlide(r, negritoTitulo: scope.settings.negritoTitulo),
          tema: scope.settings.tema,
        );
      }
      scope.status.atualizar();
    }, sucesso: 'Projetando "${r.titulo}"');
  }

  /// Monta o cartaz do recado desfocado, com o título e o texto por cima, e o envia ao Holyrics.
  /// Retorna o caminho da imagem nova.
  Future<String> _cartazComTexto(AppScope scope, Recado r, NivelBlur nivel) => cartazComTextoNoServidor(
        api: scope.api,
        caminho: r.imagemHolyrics!.trim(),
        titulo: r.titulo,
        texto: r.texto,
        nivel: nivel,
        negritoTitulo: scope.settings.negritoTitulo,
      );

  Future<void> _projetarSequencia(BuildContext context) {
    final scope = AppScope.of(context);
    final s = scope.settings;
    // A apresentação rápida do Holyrics só aceita texto; imagens ficam de fora.
    final textos = selecionados.where((r) => !r.ehImagem).toList();
    final ignorados = selecionados.length - textos.length;
    if (textos.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('A sequência só aceita recados de texto. Projete imagens individualmente.')),
      );
      return Future.value();
    }
    return executar(context, () async {
      await scope.client.projetarSequencia(
        [for (final r in textos) montarSlide(r, negritoTitulo: s.negritoTitulo)],
        tema: s.tema,
        segundos: s.segundosPorSlide,
        repetir: s.repetirSequencia,
      );
      scope.status.atualizar();
    },
        sucesso: 'Sequência com ${textos.length} recado(s)'
            '${ignorados > 0 ? ' ($ignorados imagem(ns) ignorada(s))' : ''}');
  }

  @override
  Widget build(BuildContext context) {
    final r = recado;
    final esquema = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('PRÉ-VISUALIZAÇÃO', style: Theme.of(context).textTheme.labelLarge?.copyWith(color: esquema.outline)),
        const SizedBox(height: 8),
        AspectRatio(
          aspectRatio: 16 / 9,
          child: Container(
            decoration: BoxDecoration(
              color: Colors.black,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: r?.categoria.cor ?? esquema.outlineVariant, width: 2),
            ),
            padding: const EdgeInsets.all(16),
            alignment: Alignment.center,
            child: r == null
                ? Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Opacity(
                        opacity: 0.35,
                        child: Image.asset('assets/logo/simbolo_claro.png', height: 80, excludeFromSemantics: true),
                      ),
                      const SizedBox(height: 12),
                      Text('Toque em um recado', style: TextStyle(color: esquema.outline)),
                    ],
                  )
                : r.ehImagem
                    ? _FotoDoCartaz(recado: r)
                    : FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(r.titulo,
                                textAlign: TextAlign.center,
                                style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.bold)),
                            if (r.texto.trim().isNotEmpty) ...[
                              const SizedBox(height: 8),
                              ConstrainedBox(
                                constraints: const BoxConstraints(maxWidth: 520),
                                child: Text(r.texto.trim(),
                                    textAlign: TextAlign.center,
                                    style: const TextStyle(color: Colors.white, fontSize: 20)),
                              ),
                            ],
                          ],
                        ),
                      ),
          ),
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 56,
          child: FilledButton.icon(
            onPressed: r == null ? null : () => _projetar(context, r),
            icon: const Icon(Icons.play_arrow, size: 32),
            label: const Text('PROJETAR', style: TextStyle(fontSize: 20)),
          ),
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 48,
          child: FilledButton.tonalIcon(
            onPressed: selecionados.isEmpty ? null : () => _projetarSequencia(context),
            icon: const Icon(Icons.slideshow),
            label: Text('Sequência dos selecionados (${selecionados.length})'),
          ),
        ),
      ],
    );
  }
}
