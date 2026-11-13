import 'package:flutter/material.dart';

import '../../app_scope.dart';
import 'gestao_page.dart';

typedef _Casa = ({List<Map<String, dynamic>> tarefas, List<String> responsaveis});

const _tipos = {'pendencia': 'Pendência', 'compra': 'Compra planejada', 'preventiva': 'Manutenção preventiva'};
const _estados = {'aberta': 'A fazer', 'emAndamento': 'Em andamento', 'concluida': 'Concluída', 'cancelada': 'Cancelada'};

bool _ativa(Map<String, dynamic> t) => t['estado'] != 'concluida' && t['estado'] != 'cancelada';

/// Gestão da Casa no tablet: prazos, concluir tarefa e registrar pendência nova.
/// Rotinas, edição e anexos continuam no painel web.
class CasaTab extends StatelessWidget {
  const CasaTab({super.key});

  @override
  Widget build(BuildContext context) {
    final api = AppScope.of(context).api;
    return CarregarDoServidor<_Casa>(
      carregar: () async {
        final r = await Future.wait([api.pedir('GET', '/api/casa'), api.pedir('GET', '/api/casa/responsaveis')]);
        return (
          tarefas: [for (final t in ((r[0] as Map)['tarefas'] as List)) Map<String, dynamic>.from(t as Map)],
          responsaveis: [for (final n in r[1] as List) '$n'],
        );
      },
      construir: (context, casa, recarregar) => _CasaLista(casa: casa, recarregar: recarregar),
    );
  }
}

class _CasaLista extends StatefulWidget {
  const _CasaLista({required this.casa, required this.recarregar});

  final _Casa casa;
  final Future<void> Function() recarregar;

  @override
  State<_CasaLista> createState() => _CasaListaState();
}

class _CasaListaState extends State<_CasaLista> {
  bool _concluidas = false;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final hoje = hojeIso();
    final semana = hojeIso(DateTime.now().add(const Duration(days: 7)));
    final ativas = widget.casa.tarefas.where(_ativa).toList();
    final atrasadas = ativas.where((t) => (t['prazo'] as String).compareTo(hoje) < 0).length;
    final proximas = ativas.where((t) {
      final p = t['prazo'] as String;
      return p.compareTo(hoje) >= 0 && p.compareTo(semana) <= 0;
    }).length;
    final lista = (_concluidas
        ? widget.casa.tarefas.where((t) => !_ativa(t)).toList()
        : ativas)
      ..sort((a, b) => _concluidas
          ? (b['concluidaEm'] as String? ?? '').compareTo(a['concluidaEm'] as String? ?? '')
          : (a['prazo'] as String).compareTo(b['prazo'] as String));

    Widget resumo(String texto, {bool alerta = false}) => Chip(
          label: Text(texto),
          backgroundColor: alerta ? tema.colorScheme.errorContainer : null,
          labelStyle: alerta ? TextStyle(color: tema.colorScheme.onErrorContainer, fontWeight: FontWeight.w600) : null,
        );

    return Stack(children: [
      Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
            resumo('$atrasadas atrasadas', alerta: atrasadas > 0),
            resumo('$proximas nos próximos 7 dias'),
            resumo('${ativas.length} a fazer'),
            const SizedBox(width: 16),
            ChoiceChip(label: const Text('A fazer'), selected: !_concluidas, onSelected: (_) => setState(() => _concluidas = false)),
            ChoiceChip(label: const Text('Concluídas e canceladas'), selected: _concluidas,
                onSelected: (_) => setState(() => _concluidas = true)),
          ]),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: widget.recarregar,
            child: lista.isEmpty
                ? ListView(children: [
                    Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(_concluidas ? 'Nada concluído ainda.' : 'Nenhuma tarefa a fazer.'),
                    ),
                  ])
                : ListView.builder(
                    padding: const EdgeInsets.fromLTRB(8, 8, 8, 96),
                    itemCount: lista.length,
                    itemBuilder: (context, i) {
                      final t = lista[i];
                      final atrasada = _ativa(t) && (t['prazo'] as String).compareTo(hoje) < 0;
                      return Card(
                        child: ListTile(
                          leading: Icon(
                            t['tipo'] == 'compra'
                                ? Icons.shopping_cart_outlined
                                : t['tipo'] == 'preventiva'
                                    ? Icons.event_repeat_outlined
                                    : Icons.build_outlined,
                            color: atrasada ? tema.colorScheme.error : null,
                          ),
                          title: Text(t['titulo'] as String, style: const TextStyle(fontWeight: FontWeight.w600)),
                          subtitle: Text([
                            _ativa(t)
                                ? '${atrasada ? 'Atrasada' : 'Prazo'} ${dataBr(t['prazo'] as String?)}'
                                : '${_estados[t['estado']]} ${dataBr(t['concluidaEm'] as String?)}',
                            _tipos[t['tipo']] ?? '',
                            if ((t['local'] as String? ?? '').isNotEmpty) t['local'],
                            (t['responsavel'] as String? ?? '').isEmpty ? 'sem responsável' : t['responsavel'],
                            if (t['prioridade'] == 'alta') 'prioridade alta',
                          ].join(' · ')),
                          trailing: _ativa(t)
                              ? FilledButton.tonal(onPressed: () => _concluir(t), child: const Text('Concluir'))
                              : null,
                          onTap: () => _detalhes(t),
                        ),
                      );
                    },
                  ),
          ),
        ),
      ]),
      Positioned(
        right: 16,
        bottom: 16,
        child: FloatingActionButton.extended(
          onPressed: _nova,
          icon: const Icon(Icons.add),
          label: const Text('Nova pendência'),
        ),
      ),
    ]);
  }

  Future<void> _detalhes(Map<String, dynamic> t) => showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(t['titulo'] as String),
          content: SizedBox(
            width: 520,
            child: SingleChildScrollView(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                Text('${_tipos[t['tipo']]} · ${_estados[t['estado']]} · prazo ${dataBr(t['prazo'] as String?)}'),
                if ((t['quantidade'] as String? ?? '').isNotEmpty) Text('Quantidade: ${t['quantidade']}'),
                if (t['valorEstimado'] != null) Text('Valor estimado: R\$ ${(t['valorEstimado'] as num).toStringAsFixed(2)}'),
                if ((t['detalhes'] as String? ?? '').isNotEmpty) ...[const SizedBox(height: 8), Text(t['detalhes'] as String)],
                if (t['estado'] == 'concluida') ...[
                  const SizedBox(height: 8),
                  Text('Concluída em ${dataBr(t['concluidaEm'] as String?)} por ${t['executor']}'
                      '${t['valor'] != null ? ' · R\$ ${(t['valor'] as num).toStringAsFixed(2)}' : ''}'),
                  if ((t['observacao'] as String? ?? '').isNotEmpty) Text(t['observacao'] as String),
                ],
                if ((t['anexos'] as List? ?? const []).isNotEmpty)
                  Text('${(t['anexos'] as List).length} anexo(s): veja no painel web.'),
                const SizedBox(height: 12),
                const Text('Histórico', style: TextStyle(fontWeight: FontWeight.w600)),
                for (final h in (t['historico'] as List? ?? const []).cast<Map>())
                  Text('${dataBr(h['em'] as String?)} — ${h['acao']} por ${h['por']}'),
              ]),
            ),
          ),
          actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Fechar'))],
        ),
      );

  Future<void> _concluir(Map<String, dynamic> t) async {
    final executor = TextEditingController(text: t['responsavel'] as String? ?? '');
    final valor = TextEditingController();
    final obs = TextEditingController();
    var data = DateTime.now();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: Text('Concluir: ${t['titulo']}'),
          content: SizedBox(
            width: 480,
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Data da execução'),
                subtitle: Text(dataBr(hojeIso(data))),
                trailing: const Icon(Icons.calendar_today_outlined),
                onTap: () async {
                  final d = await showDatePicker(
                      context: ctx, initialDate: data, firstDate: DateTime(2020), lastDate: DateTime.now());
                  if (d != null) set(() => data = d);
                },
              ),
              TextField(
                controller: executor,
                decoration: InputDecoration(
                  labelText: 'Quem executou?',
                  suffixIcon: PopupMenuButton<String>(
                    icon: const Icon(Icons.arrow_drop_down),
                    onSelected: (n) => executor.text = n,
                    itemBuilder: (_) => [for (final n in widget.casa.responsaveis) PopupMenuItem(value: n, child: Text(n))],
                  ),
                ),
              ),
              TextField(
                controller: valor,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Valor gasto (R\$, opcional)'),
              ),
              TextField(controller: obs, maxLines: 3, decoration: const InputDecoration(labelText: 'O que foi feito? (opcional)')),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Registrar conclusão')),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    // "1.234,56" ou "31,90" (vírgula decimal) e também "31.90".
    final bruto = valor.text.trim();
    final v = double.tryParse(bruto.contains(',') ? bruto.replaceAll('.', '').replaceAll(',', '.') : bruto);
    final feito = await executar(
      context,
      () => AppScope.of(context).api.pedir('POST', '/api/casa/tarefas/${Uri.encodeComponent(t['id'] as String)}/concluir', json: {
        'data': hojeIso(data),
        'executor': executor.text.trim(),
        if (v != null) 'valor': v,
        'observacao': obs.text.trim(),
      }),
      sucesso: 'Tarefa concluída.',
    );
    if (feito) await widget.recarregar();
  }

  Future<void> _nova() async {
    final titulo = TextEditingController();
    final local = TextEditingController();
    final responsavel = TextEditingController();
    final detalhes = TextEditingController();
    var prazo = DateTime.now().add(const Duration(days: 7));
    var prioridade = 'normal';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: const Text('Nova pendência'),
          content: SizedBox(
            width: 520,
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                TextField(controller: titulo, autofocus: true, decoration: const InputDecoration(labelText: 'O que precisa ser feito?')),
                TextField(controller: local, decoration: const InputDecoration(labelText: 'Local')),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Prazo'),
                  subtitle: Text(dataBr(hojeIso(prazo))),
                  trailing: const Icon(Icons.calendar_today_outlined),
                  onTap: () async {
                    final d = await showDatePicker(
                        context: ctx, initialDate: prazo, firstDate: DateTime(2020), lastDate: DateTime(2100));
                    if (d != null) set(() => prazo = d);
                  },
                ),
                DropdownButtonFormField<String>(
                  initialValue: prioridade,
                  decoration: const InputDecoration(labelText: 'Prioridade'),
                  items: const [
                    DropdownMenuItem(value: 'normal', child: Text('Normal')),
                    DropdownMenuItem(value: 'alta', child: Text('Alta')),
                    DropdownMenuItem(value: 'baixa', child: Text('Baixa')),
                  ],
                  onChanged: (v) => set(() => prioridade = v ?? 'normal'),
                ),
                TextField(
                  controller: responsavel,
                  decoration: InputDecoration(
                    labelText: 'Responsável (opcional)',
                    suffixIcon: PopupMenuButton<String>(
                      icon: const Icon(Icons.arrow_drop_down),
                      onSelected: (n) => responsavel.text = n,
                      itemBuilder: (_) => [for (final n in widget.casa.responsaveis) PopupMenuItem(value: n, child: Text(n))],
                    ),
                  ),
                ),
                TextField(controller: detalhes, maxLines: 3, decoration: const InputDecoration(labelText: 'Detalhes (opcional)')),
              ]),
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Criar')),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    final feito = await executar(
      context,
      () => AppScope.of(context).api.pedir('POST', '/api/casa/tarefas', json: {
        'tipo': 'pendencia',
        'titulo': titulo.text.trim(),
        'local': local.text.trim(),
        'prazo': hojeIso(prazo),
        'prioridade': prioridade,
        'responsavel': responsavel.text.trim(),
        'detalhes': detalhes.text.trim(),
      }),
      sucesso: 'Pendência criada.',
    );
    if (feito) await widget.recarregar();
  }
}
