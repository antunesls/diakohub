import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

/// Área para desenhar a assinatura com o dedo ou com caneta, que sai como PNG de fundo
/// transparente já aparado nas bordas — pronto para o servidor guardar e reaproveitar
/// nos próximos certificados.
class AssinaturaPad extends StatefulWidget {
  const AssinaturaPad({super.key});

  /// Abre o pad em um diálogo e devolve o PNG assinado, ou null se cancelado/limpo.
  static Future<Uint8List?> abrir(BuildContext context) =>
      showDialog(context: context, builder: (_) => const _DialogoAssinatura());

  @override
  State<AssinaturaPad> createState() => AssinaturaPadState();
}

class AssinaturaPadState extends State<AssinaturaPad> {
  final tracos = <List<Offset>>[];
  bool get vazia => tracos.isEmpty;

  void desfazer() => setState(tracos.removeLast);

  void limpar() => setState(tracos.clear);

  /// PNG da assinatura (null se nada foi desenhado).
  Future<Uint8List?> exportar() async {
    if (tracos.isEmpty) return null;
    var minX = double.infinity, minY = double.infinity, maxX = 0.0, maxY = 0.0;
    for (final traco in tracos) {
      for (final o in traco) {
        if (o.dx < minX) minX = o.dx;
        if (o.dy < minY) minY = o.dy;
        if (o.dx > maxX) maxX = o.dx;
        if (o.dy > maxY) maxY = o.dy;
      }
    }
    const folga = 10.0, escala = 3.0; // 3x: traço nítido no PDF impresso
    final largura = (maxX - minX + folga * 2) * escala, altura = (maxY - minY + folga * 2) * escala;
    if (largura < 1 || altura < 1) return null;
    final gravador = ui.PictureRecorder();
    final canvas = Canvas(gravador);
    canvas.scale(escala);
    canvas.translate(-(minX - folga), -(minY - folga));
    pintarAssinatura(canvas, tracos);
    final imagem = await gravador.endRecording().toImage(largura.round(), altura.round());
    final dados = await imagem.toByteData(format: ui.ImageByteFormat.png);
    return dados?.buffer.asUint8List();
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, restricoes) {
      final tamanho = restricoes.biggest;
      Offset dentro(Offset o) => Offset(o.dx.clamp(0, tamanho.width), o.dy.clamp(0, tamanho.height));
      return GestureDetector(
        behavior: HitTestBehavior.opaque,
        onPanStart: (d) => setState(() => tracos.add([dentro(d.localPosition)])),
        onPanUpdate: (d) => setState(() => tracos.last.add(dentro(d.localPosition))),
        child: CustomPaint(painter: _PintorAssinatura(tracos), size: Size.infinite),
      );
    });
  }
}

/// Desenha os traços (mesmo código na tela e na exportação do PNG).
void pintarAssinatura(Canvas canvas, List<List<Offset>> tracos) {
  final tinta = Paint()
    ..color = const Color(0xFF172C29)
    ..strokeCap = StrokeCap.round
    ..strokeJoin = StrokeJoin.round
    ..style = PaintingStyle.stroke
    ..strokeWidth = 3;
  final ponto = Paint()..color = const Color(0xFF172C29);
  for (final traco in tracos) {
    if (traco.isEmpty) continue;
    if (traco.length == 1) {
      canvas.drawCircle(traco.single, 1.6, ponto);
      continue;
    }
    final caminho = Path()..moveTo(traco.first.dx, traco.first.dy);
    for (var i = 1; i < traco.length - 1; i++) {
      final meio = Offset((traco[i].dx + traco[i + 1].dx) / 2, (traco[i].dy + traco[i + 1].dy) / 2);
      caminho.quadraticBezierTo(traco[i].dx, traco[i].dy, meio.dx, meio.dy);
    }
    caminho.lineTo(traco.last.dx, traco.last.dy);
    canvas.drawPath(caminho, tinta);
  }
}

class _PintorAssinatura extends CustomPainter {
  _PintorAssinatura(this.tracos);

  final List<List<Offset>> tracos;

  @override
  void paint(Canvas canvas, Size size) => pintarAssinatura(canvas, tracos);

  @override
  bool shouldRepaint(_PintorAssinatura anterior) => true;
}

class _DialogoAssinatura extends StatefulWidget {
  const _DialogoAssinatura();

  @override
  State<_DialogoAssinatura> createState() => _DialogoAssinaturaState();
}

class _DialogoAssinaturaState extends State<_DialogoAssinatura> {
  final _chave = GlobalKey<AssinaturaPadState>();
  var _desenhando = false;

  void _refletir() =>
      setState(() => _desenhando = !(_chave.currentState?.vazia ?? true));

  Future<void> _salvar() async {
    final png = await _chave.currentState?.exportar();
    if (png != null && mounted) Navigator.pop(context, png);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Desenhar assinatura'),
      content: SizedBox(
        width: 520,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Assine abaixo com o dedo ou com a caneta. Ela fica salva no servidor para os próximos certificados.',
              style: TextStyle(color: Theme.of(context).colorScheme.outline),
            ),
            const SizedBox(height: 12),
            Listener(onPointerDown: (_) => _refletir(), child: _area()),
            const SizedBox(height: 8),
            Row(children: [
              TextButton.icon(
                icon: const Icon(Icons.undo),
                label: const Text('Desfazer'),
                onPressed: () {
                  _chave.currentState?.desfazer();
                  _refletir();
                },
              ),
              TextButton.icon(
                icon: const Icon(Icons.delete_outline),
                label: const Text('Limpar'),
                onPressed: () {
                  _chave.currentState?.limpar();
                  _refletir();
                },
              ),
            ]),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')),
        FilledButton.icon(
          icon: const Icon(Icons.check),
          label: const Text('Salvar assinatura'),
          onPressed: _desenhando ? _salvar : null,
        ),
      ],
    );
  }

  Widget _area() {
    // Pontilhado na base: onde a assinatura "assenta" (não sai no PNG exportado).
    Widget base = CustomPaint(
      painter: _LinhaBase(),
      size: Size.infinite,
      child: AssinaturaPad(key: _chave),
    );
    return Container(
      height: 260,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: ClipRRect(borderRadius: BorderRadius.circular(12), child: base),
    );
  }
}

/// Linha pontilhada na base da área de assinatura (só visual).
class _LinhaBase extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final tinta = Paint()
      ..color = Colors.black26
      ..strokeWidth = 1;
    const margem = 24.0;
    for (var x = margem; x < size.width - margem; x += 12) {
      canvas.drawLine(Offset(x, size.height - 36), Offset(x + 6, size.height - 36), tinta);
    }
  }

  @override
  bool shouldRepaint(_LinhaBase anterior) => false;
}
