import 'package:flutter/material.dart';

import '../../app_scope.dart';
import 'gestao_page.dart';

const _tipos = {
  'conselho': 'Conselho',
  'diretoria': 'Diretoria',
  'assembleia': 'Assembleia',
  'ministerio': 'Ministério / equipe',
  'outra': 'Outra reunião',
};
const _formais = {'conselho', 'diretoria', 'assembleia'};

/// Mesmo título do servidor (Atas.titulo): "Ata nº 3/2026 — Conselho" ou o título informado.
String tituloAta(Map<String, dynamic> a) {
  final tipo = _tipos[a['tipo']] ?? 'Reunião';
  final nome = (a['titulo'] as String? ?? '').trim();
  if (a['numero'] is int) return 'Ata nº ${a['numero']}/${a['ano']} — $tipo${nome.isEmpty ? '' : ': $nome'}';
  return nome.isEmpty ? 'Reunião — $tipo' : nome;
}

String situacaoAta(Map<String, dynamic> a) => switch (a['status']) {
      'aprovada' => 'Aprovada em ${dataBr(a['aprovadaEm'] as String?)}',
      'finalizada' => _formais.contains(a['tipo']) ? 'Aguardando aprovação' : 'Finalizada',
      _ => 'Rascunho',
    };

/// Leitura das atas e acompanhamento dos encaminhamentos. Escrever, finalizar, aprovar,
/// PDF e e-mail continuam no painel web. Sigilosas só chegam se o perfil puder vê-las.
class AtasTab extends StatelessWidget {
  const AtasTab({super.key});

  @override
  Widget build(BuildContext context) {
    final api = AppScope.of(context).api;
    return CarregarDoServidor<List<Map<String, dynamic>>>(
      carregar: () => api.listar('atas'),
      construir: (context, atas, recarregar) => _Atas(atas: atas, recarregar: recarregar),
    );
  }
}

class _Atas extends StatefulWidget {
  const _Atas({required this.atas, required this.recarregar});

  final List<Map<String, dynamic>> atas;
  final Future<void> Function() recarregar;

  @override
  State<_Atas> createState() => _AtasState();
}

class _AtasState extends State<_Atas> {
  bool _pendentes = false;
  String _status = '';
  String? _selecionadaId;

  Future<void> _marcar(Map<String, dynamic> ata, Map e, bool concluido) async {
    final ok = await executar(
      context,
      () => AppScope.of(context).api.pedir('PUT',
          '/api/atas/${Uri.encodeComponent(ata['id'] as String)}/encaminhamentos/${Uri.encodeComponent(e['id'] as String)}',
          json: {'concluido': concluido}),
      sucesso: concluido ? 'Encaminhamento concluído.' : 'Encaminhamento reaberto.',
    );
    if (ok) await widget.recarregar();
  }

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final hoje = hojeIso();
    final pendentes = [
      for (final a in widget.atas)
        if (a['status'] != 'rascunho')
          for (final e in (a['encaminhamentos'] as List? ?? const []).cast<Map>())
            if (e['concluido'] != true) (ata: a, e: e),
    ]..sort((x, y) {
        final px = x.e['prazo'] as String? ?? '', py = y.e['prazo'] as String? ?? '';
        if (px.isEmpty != py.isEmpty) return px.isEmpty ? 1 : -1;
        return px.compareTo(py);
      });
    final vencidos = pendentes.where((p) => (p.e['prazo'] as String? ?? '').isNotEmpty && (p.e['prazo'] as String).compareTo(hoje) < 0).length;

    final topo = Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: SegmentedButton<bool>(
        segments: [
          ButtonSegment(value: false, icon: const Icon(Icons.description_outlined), label: Text('Atas (${widget.atas.length})')),
          ButtonSegment(
            value: true,
            icon: Badge(isLabelVisible: vencidos > 0, label: Text('$vencidos'), child: const Icon(Icons.task_alt)),
            label: Text('Encaminhamentos pendentes (${pendentes.length})'),
          ),
        ],
        selected: {_pendentes},
        onSelectionChanged: (s) => setState(() => _pendentes = s.first),
      ),
    );

    if (_pendentes) {
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        topo,
        Expanded(
          child: RefreshIndicator(
            onRefresh: widget.recarregar,
            child: pendentes.isEmpty
                ? ListView(children: const [Padding(padding: EdgeInsets.all(24), child: Text('Nenhum encaminhamento pendente.'))])
                : ListView.builder(
                    padding: const EdgeInsets.all(8),
                    itemCount: pendentes.length,
                    itemBuilder: (context, i) {
                      final p = pendentes[i];
                      final prazo = p.e['prazo'] as String? ?? '';
                      final venceu = prazo.isNotEmpty && prazo.compareTo(hoje) < 0;
                      return Card(
                        child: CheckboxListTile(
                          value: false,
                          onChanged: (_) => _marcar(p.ata, p.e, true),
                          title: Text(p.e['descricao'] as String, style: const TextStyle(fontWeight: FontWeight.w600)),
                          subtitle: Text([
                            (p.e['responsavel'] as String? ?? '').isEmpty ? 'sem responsável' : p.e['responsavel'],
                            prazo.isEmpty ? 'sem prazo' : '${venceu ? 'venceu' : 'prazo'} ${dataBr(prazo)}',
                            tituloAta(p.ata),
                          ].join(' · '),
                              style: venceu ? TextStyle(color: tema.colorScheme.error) : null),
                          secondary: IconButton(
                            tooltip: 'Ver ata',
                            icon: const Icon(Icons.open_in_new),
                            onPressed: () => setState(() {
                              _pendentes = false;
                              _selecionadaId = p.ata['id'] as String;
                            }),
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ),
      ]);
    }

    final lista = widget.atas.where((a) => _status.isEmpty || a['status'] == _status).toList();
    final selecionada = widget.atas.where((a) => a['id'] == _selecionadaId).firstOrNull;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      topo,
      Expanded(
        child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          SizedBox(
            width: 420,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Wrap(spacing: 8, children: [
                  for (final (s, rotulo) in [('', 'Todas'), ('rascunho', 'Rascunhos'), ('finalizada', 'Finalizadas'), ('aprovada', 'Aprovadas')])
                    ChoiceChip(label: Text(rotulo), selected: _status == s, onSelected: (_) => setState(() => _status = s)),
                ]),
              ),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: widget.recarregar,
                  child: lista.isEmpty
                      ? ListView(children: const [Padding(padding: EdgeInsets.all(24), child: Text('Nenhuma ata neste filtro.'))])
                      : ListView.builder(
                          itemCount: lista.length,
                          itemBuilder: (context, i) {
                            final a = lista[i];
                            return ListTile(
                              selected: a['id'] == _selecionadaId,
                              leading: Icon(a['sigilosa'] == true ? Icons.lock_outline : Icons.description_outlined),
                              title: Text(tituloAta(a), maxLines: 2, overflow: TextOverflow.ellipsis),
                              subtitle: Text('${dataBr(a['data'] as String?)} · ${situacaoAta(a)}'
                                  '${a['sigilosa'] == true ? ' · sigilosa' : ''}'),
                              onTap: () => setState(() => _selecionadaId = a['id'] as String),
                            );
                          },
                        ),
                ),
              ),
            ]),
          ),
          const VerticalDivider(width: 1),
          Expanded(
            child: selecionada == null
                ? const Center(child: Text('Escolha uma ata para ler.'))
                : _LeituraAta(key: ValueKey(selecionada['id']), ata: selecionada, onMarcar: _marcar),
          ),
        ]),
      ),
    ]);
  }
}

class _LeituraAta extends StatelessWidget {
  const _LeituraAta({super.key, required this.ata, required this.onMarcar});

  final Map<String, dynamic> ata;
  final Future<void> Function(Map<String, dynamic> ata, Map e, bool concluido) onMarcar;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final a = ata;
    String t(Object? v) => (v as String? ?? '').trim();
    final presentes = (a['presentes'] as List? ?? const []).cast<Map>();
    final ausentes = (a['ausentes'] as List? ?? const []).cast<Map>();
    final pauta = (a['pauta'] as List? ?? const []).cast<Map>();
    final encaminhamentos = (a['encaminhamentos'] as List? ?? const []).cast<Map>();
    final retificacoes = (a['retificacoes'] as List? ?? const []).cast<Map>();
    final horario = [t(a['horaInicio']), t(a['horaFim'])].where((h) => h.isNotEmpty).join(' às ');

    Widget secao(String nome) => Padding(
          padding: const EdgeInsets.only(top: 20, bottom: 6),
          child: Text(nome.toUpperCase(),
              style: TextStyle(color: tema.colorScheme.primary, fontWeight: FontWeight.w700, letterSpacing: 1, fontSize: 13)),
        );
    Widget dado(String rotulo, String valor) => valor.isEmpty
        ? const SizedBox.shrink()
        : Padding(
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              SizedBox(width: 120, child: Text(rotulo, style: TextStyle(color: tema.colorScheme.outline))),
              Expanded(child: Text(valor)),
            ]),
          );

    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Text(tituloAta(a), style: tema.textTheme.headlineSmall),
        const SizedBox(height: 4),
        Text('${situacaoAta(a)}${a['sigilosa'] == true ? ' · Sigilosa' : ''}',
            style: TextStyle(color: tema.colorScheme.primary, fontWeight: FontWeight.w600)),
        const SizedBox(height: 12),
        dado('Data', [dataBr(a['data'] as String?), horario].where((s) => s.isNotEmpty).join(', ')),
        dado('Local', t(a['local'])),
        dado('Ministério', t(a['ministerio'])),
        dado('Presidência', t(a['presidente'])),
        dado('Secretaria', t(a['secretario'])),
        if (presentes.isNotEmpty || ausentes.isNotEmpty) secao('Presença'),
        if (presentes.isNotEmpty) Text('Presentes (${presentes.length}): ${presentes.map((p) => p['nome']).join(', ')}'),
        if (ausentes.isNotEmpty)
          Text('Ausentes (${ausentes.length}): ${ausentes.map((p) => t(p['justificativa']).isEmpty ? p['nome'] : '${p['nome']} (${p['justificativa']})').join(', ')}'),
        if (pauta.isNotEmpty) secao('Pauta e deliberações'),
        for (final (i, item) in pauta.indexed) ...[
          Padding(
            padding: const EdgeInsets.only(top: 8, bottom: 4),
            child: Text('${i + 1}. ${t(item['titulo'])}', style: tema.textTheme.titleMedium),
          ),
          if (t(item['discussao']).isNotEmpty) SelectableText(t(item['discussao'])),
          if (t(item['deliberacao']).isNotEmpty)
            Container(
              margin: const EdgeInsets.only(top: 6),
              padding: const EdgeInsets.fromLTRB(12, 6, 8, 6),
              decoration: BoxDecoration(border: Border(left: BorderSide(color: tema.colorScheme.primary, width: 3))),
              child: Text('Deliberação: ${t(item['deliberacao'])}', style: const TextStyle(fontWeight: FontWeight.w600)),
            ),
        ],
        if (encaminhamentos.isNotEmpty) secao('Encaminhamentos'),
        for (final e in encaminhamentos)
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: e['concluido'] == true,
            // Num rascunho os encaminhamentos ainda podem mudar: o servidor só acompanha os finalizados.
            onChanged: a['status'] == 'rascunho' ? null : (v) => onMarcar(a, e, v ?? false),
            title: Text(t(e['descricao'])),
            subtitle: Text([
              if (t(e['responsavel']).isNotEmpty) t(e['responsavel']),
              if (t(e['prazo']).isNotEmpty) 'até ${dataBr(e['prazo'] as String?)}',
              if (e['concluido'] == true) 'concluído em ${dataBr(e['concluidoEm'] as String?)}',
            ].join(' · ')),
          ),
        if (t(a['observacoes']).isNotEmpty) ...[secao('Observações'), SelectableText(t(a['observacoes']))],
        if (retificacoes.isNotEmpty) ...[
          secao('Retificações'),
          for (final r in retificacoes) Text('${dataBr(r['em'] as String?)} (${r['por']}): ${r['texto']}'),
        ],
        if ((a['anexos'] as List? ?? const []).isNotEmpty) ...[
          const SizedBox(height: 16),
          Text('${(a['anexos'] as List).length} anexo(s): abra pelo painel web.', style: TextStyle(color: tema.colorScheme.outline)),
        ],
        const SizedBox(height: 24),
        Text('Escrever, finalizar, aprovar, gerar PDF e enviar por e-mail: painel web › Atas de reunião.',
            style: TextStyle(color: tema.colorScheme.outline)),
      ],
    );
  }
}
