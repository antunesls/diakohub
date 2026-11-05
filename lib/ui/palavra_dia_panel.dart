import 'package:diako_core/diako_core.dart';
import 'package:flutter/material.dart';

import '../app_scope.dart';
import '../sync/server_api.dart';
import 'dia_formato.dart';

/// Uma Palavra pronta na lista (sem o texto).
class _Resumo {
  const _Resumo(
      {required this.id,
      required this.titulo,
      required this.data,
      required this.serie,
      required this.autorNome});

  final String id;
  final String titulo;
  final String data;
  final String serie;
  final String autorNome;

  factory _Resumo.de(Map<String, dynamic> j) => _Resumo(
        id: j['id'] as String? ?? '',
        titulo: j['titulo'] as String? ?? '',
        data: j['data'] as String? ?? '',
        serie: j['serie'] as String? ?? '',
        autorNome: j['autorNome'] as String? ?? '',
      );
}

enum _Modo { dia, nome }

/// Seção "Palavra": consulta as Palavras prontas, por dia ou por nome (título, série, texto).
/// Só leitura: não mexe na Palavra que o tablet está usando no culto.
class PalavraDiaPanel extends StatefulWidget {
  const PalavraDiaPanel({super.key});

  @override
  State<PalavraDiaPanel> createState() => _PalavraDiaPanelState();
}

class _PalavraDiaPanelState extends State<PalavraDiaPanel> {
  late ServerApi _api;
  bool _iniciado = false;

  _Modo _modo = _Modo.dia;
  DateTime _dia = DateTime.now();
  final _busca = TextEditingController();

  /// Palavras da lista: as do dia escolhido (modo dia) ou as encontradas pela busca (modo nome).
  List<_Resumo> _lista = const [];
  PalavraDoCulto? _palavra;
  String _idAberta = '';
  bool _carregandoLista = false;
  bool _carregandoTexto = false;
  String? _erro;
  int _pedidoLista = 0;
  int _pedidoTexto = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_iniciado) {
      _iniciado = true;
      _api = AppScope.of(context).api;
      _carregarDia();
    }
  }

  @override
  void dispose() {
    _busca.dispose();
    super.dispose();
  }

  /// Modo dia: as Palavras prontas da data e a que o servidor indica (ou a escolhida, [id]).
  Future<void> _carregarDia({String id = ''}) async {
    final dia = diaIso(_dia);
    await _listar(data: dia);
    await _abrir(dia, id: id);
  }

  Future<void> _listar({String busca = '', String data = ''}) async {
    final pedido = ++_pedidoLista;
    setState(() {
      _carregandoLista = true;
      _erro = null;
    });
    try {
      final j = await _api.palavrasProntas(busca: busca, data: data);
      if (!mounted || pedido != _pedidoLista) return;
      setState(() {
        _lista = [
          for (final p in j['palavras'] as List? ?? const [])
            _Resumo.de(Map<String, dynamic>.from(p as Map))
        ];
        _carregandoLista = false;
      });
    } on ErroAmigavel catch (e) {
      if (!mounted || pedido != _pedidoLista) return;
      setState(() {
        _erro = e.message;
        _carregandoLista = false;
      });
    }
  }

  Future<void> _abrir(String data, {String id = ''}) async {
    final pedido = ++_pedidoTexto;
    setState(() {
      _carregandoTexto = true;
      _erro = null;
    });
    try {
      final j = await _api.palavraDeHoje(data: data, id: id);
      final p = j['palavra'];
      if (!mounted || pedido != _pedidoTexto) return;
      setState(() {
        _palavra = p is Map
            ? PalavraDoCulto.fromJson(Map<String, dynamic>.from(p))
            : null;
        _idAberta = _palavra?.id ?? '';
        _carregandoTexto = false;
      });
    } on ErroAmigavel catch (e) {
      if (!mounted || pedido != _pedidoTexto) return;
      setState(() {
        _erro = e.message;
        _carregandoTexto = false;
      });
    }
  }

  void _mudarModo(_Modo modo) {
    if (modo == _modo) return;
    setState(() => _modo = modo);
    if (modo == _Modo.dia) {
      _carregarDia();
    } else {
      _listar(busca: _busca.text);
    }
  }

  Future<void> _escolherDia() async {
    final agora = DateTime.now();
    final escolhido = await showDatePicker(
      context: context,
      initialDate: _dia,
      firstDate: DateTime(agora.year - 3),
      lastDate: DateTime(agora.year + 2),
      helpText: 'Palavra de qual dia?',
      confirmText: 'Ver',
      cancelText: 'Cancelar',
    );
    if (escolhido == null || !mounted) return;
    _dia = escolhido;
    await _carregarDia();
  }

  void _voltarParaHoje() {
    _dia = DateTime.now();
    _carregarDia();
  }

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final hoje = diaIso(DateTime.now()) == diaIso(_dia);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 16, 24, 0),
          child: SegmentedButton<_Modo>(
            segments: const [
              ButtonSegment(
                  value: _Modo.dia,
                  label: Text('Por dia'),
                  icon: Icon(Icons.calendar_today)),
              ButtonSegment(
                  value: _Modo.nome,
                  label: Text('Por nome'),
                  icon: Icon(Icons.search)),
            ],
            selected: {_modo},
            onSelectionChanged: (s) => _mudarModo(s.first),
          ),
        ),
        if (_modo == _Modo.dia)
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 12, 24, 0),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Palavras de ${hoje ? 'hoje, ' : ''}${dataCurta(_dia)}',
                    style: tema.textTheme.titleLarge,
                  ),
                ),
                if (!hoje)
                  TextButton(
                      onPressed: _voltarParaHoje,
                      child: const Text('Voltar para hoje')),
                const SizedBox(width: 8),
                FilledButton.tonalIcon(
                  onPressed: _escolherDia,
                  icon: const Icon(Icons.calendar_month),
                  label: const Text('Escolher dia'),
                ),
              ],
            ),
          )
        else
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 12, 24, 0),
            child: TextField(
              controller: _busca,
              decoration: const InputDecoration(
                hintText: 'Buscar pelo título, pela série ou pelo texto',
                prefixIcon: Icon(Icons.search),
                border: OutlineInputBorder(),
              ),
              onChanged: (t) => _listar(busca: t),
            ),
          ),
        Expanded(
          child: _modo == _Modo.dia
              ? _painelDoDia(context)
              : Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    SizedBox(width: 340, child: _listaWidget(context)),
                    const VerticalDivider(width: 1),
                    Expanded(child: _corpo(context)),
                  ],
                ),
        ),
      ],
    );
  }

  /// Modo dia: chips das Palavras do dia (se houver mais de uma) e o texto da escolhida.
  Widget _painelDoDia(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_lista.length > 1)
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 12, 24, 0),
            child: Wrap(
              spacing: 8,
              children: [
                for (final r in _lista)
                  ChoiceChip(
                    label: Text(r.titulo),
                    selected: _idAberta == r.id,
                    onSelected: (_) => _abrir(diaIso(_dia), id: r.id),
                  ),
              ],
            ),
          ),
        Expanded(child: _corpo(context)),
      ],
    );
  }

  /// Modo nome: lista das Palavras encontradas; toque abre o texto ao lado.
  Widget _listaWidget(BuildContext context) {
    final cor = Theme.of(context).colorScheme;
    if (_carregandoLista && _lista.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_lista.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            _busca.text.isEmpty
                ? 'Nenhuma Palavra pronta ainda.'
                : 'Nenhuma Palavra encontrada para "${_busca.text}".',
            textAlign: TextAlign.center,
            style: TextStyle(color: cor.onSurfaceVariant),
          ),
        ),
      );
    }
    return ListView(
      children: [
        for (final r in _lista)
          ListTile(
            selected: r.id == _idAberta,
            title: Text(r.titulo, maxLines: 2, overflow: TextOverflow.ellipsis),
            subtitle: Text(
              [dataBr(r.data), r.serie, r.autorNome]
                  .where((s) => s.isNotEmpty)
                  .join(' · '),
            ),
            onTap: () => _abrir(r.data, id: r.id),
          ),
      ],
    );
  }

  Widget _corpo(BuildContext context) {
    if (_carregandoTexto) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_erro != null) return _mensagem(context, _erro!);
    final p = _palavra;
    if (p == null) {
      return _mensagem(
        context,
        _modo == _Modo.dia
            ? 'Nenhuma Palavra pronta em ${dataCurta(_dia)}.'
            : 'Escolha uma Palavra na lista.',
      );
    }
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Text(p.titulo, style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 4),
        Text(
          [if (p.autorNome.isNotEmpty) p.autorNome, '${p.minutos} min']
              .join(' · '),
          style:
              TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: 20),
        for (final (i, t) in p.trechos.indexed) ...[
          if (t.topico.isNotEmpty &&
              (i == 0 || p.trechos[i - 1].topico != t.topico))
            Padding(
              padding: const EdgeInsets.only(top: 12, bottom: 8),
              child: Text(t.topico.toUpperCase(),
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      letterSpacing: .8,
                      color: Theme.of(context).colorScheme.primary)),
            ),
          Padding(
            padding: const EdgeInsets.only(bottom: 14),
            child: Text(t.texto,
                style: const TextStyle(fontSize: 18, height: 1.45)),
          ),
          if (t.referencias.any((r) => r.ref != null))
            Padding(
              padding: const EdgeInsets.only(bottom: 14),
              child: Text(
                t.referencias
                    .where((r) => r.ref != null)
                    .map((r) => r.ref!.abreviada)
                    .join(', '),
                style: TextStyle(
                    fontSize: 14,
                    color: Theme.of(context).colorScheme.onSurfaceVariant),
              ),
            ),
        ],
      ],
    );
  }

  Widget _mensagem(BuildContext context, String texto) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Text(texto,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium),
        ),
      );
}
