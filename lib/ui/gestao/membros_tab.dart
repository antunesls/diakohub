import 'package:diako_core/diako_core.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app_scope.dart';
import 'gestao_page.dart';

/// Consulta do cadastro de membros: busca, ficha e contato (ligar/WhatsApp).
/// Documentos (CPF, RG) não aparecem no tablet; a edição continua no painel web.
class MembrosTab extends StatelessWidget {
  const MembrosTab({super.key});

  @override
  Widget build(BuildContext context) {
    final api = AppScope.of(context).api;
    return CarregarDoServidor<List<Membro>>(
      carregar: () async => [
        for (final j in await api.listar('membros')) Membro.fromJson(j),
      ]..sort((a, b) => a.nome.toLowerCase().compareTo(b.nome.toLowerCase())),
      construir: (context, membros, recarregar) => _Membros(membros: membros, recarregar: recarregar),
    );
  }
}

class _Membros extends StatefulWidget {
  const _Membros({required this.membros, required this.recarregar});

  final List<Membro> membros;
  final Future<void> Function() recarregar;

  @override
  State<_Membros> createState() => _MembrosState();
}

enum _Filtro { ativos, visitantes, todos }

class _MembrosState extends State<_Membros> {
  final _busca = TextEditingController();
  _Filtro _filtro = _Filtro.ativos;
  String? _selecionadoId;

  @override
  void dispose() {
    _busca.dispose();
    super.dispose();
  }

  static String _semAcento(String s) {
    const de = 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ';
    const para = 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC';
    final b = StringBuffer();
    for (final c in s.split('')) {
      final i = de.indexOf(c);
      b.write(i >= 0 ? para[i] : c);
    }
    return b.toString().toLowerCase();
  }

  @override
  Widget build(BuildContext context) {
    final termo = _semAcento(_busca.text.trim());
    final digitos = _busca.text.replaceAll(RegExp(r'\D'), '');
    final lista = widget.membros.where((m) {
      final noFiltro = switch (_filtro) {
        _Filtro.ativos => m.status.ativo,
        _Filtro.visitantes => m.status == StatusMembro.visitante,
        _Filtro.todos => true,
      };
      if (!noFiltro) return false;
      if (termo.isEmpty) return true;
      return _semAcento(m.nome).contains(termo) ||
          m.ministerios.any((x) => _semAcento(x).contains(termo)) ||
          (digitos.length >= 4 && '${m.telefone ?? ''} ${m.whatsapp ?? ''}'.contains(digitos));
    }).toList();
    final selecionado = widget.membros.where((m) => m.id == _selecionadoId).firstOrNull;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          width: 400,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: TextField(
                  controller: _busca,
                  decoration: const InputDecoration(
                    prefixIcon: Icon(Icons.search),
                    hintText: 'Nome, ministério ou telefone',
                    border: OutlineInputBorder(),
                    isDense: true,
                  ),
                  onChanged: (_) => setState(() {}),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Wrap(spacing: 8, children: [
                  for (final (f, rotulo) in [
                    (_Filtro.ativos, 'Membros e congregados'),
                    (_Filtro.visitantes, 'Visitantes'),
                    (_Filtro.todos, 'Todos'),
                  ])
                    ChoiceChip(label: Text(rotulo), selected: _filtro == f, onSelected: (_) => setState(() => _filtro = f)),
                ]),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
                child: Text('${lista.length} ${lista.length == 1 ? 'pessoa' : 'pessoas'}',
                    style: TextStyle(color: Theme.of(context).colorScheme.outline)),
              ),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: widget.recarregar,
                  child: lista.isEmpty
                      ? ListView(children: const [Padding(padding: EdgeInsets.all(24), child: Text('Ninguém encontrado.'))])
                      : ListView.builder(
                          itemCount: lista.length,
                          itemBuilder: (context, i) {
                            final m = lista[i];
                            return ListTile(
                              selected: m.id == _selecionadoId,
                              leading: _Foto(membro: m, tamanho: 40),
                              title: Text(m.nome),
                              subtitle: Text([m.status.nome, ...m.ministerios].join(' · '),
                                  maxLines: 1, overflow: TextOverflow.ellipsis),
                              onTap: () => setState(() => _selecionadoId = m.id),
                            );
                          },
                        ),
                ),
              ),
            ],
          ),
        ),
        const VerticalDivider(width: 1),
        Expanded(
          child: selecionado == null
              ? const Center(child: Text('Escolha uma pessoa para ver a ficha.'))
              : FichaMembro(key: ValueKey(selecionado.id), membro: selecionado, todos: widget.membros,
                  onAbrir: (id) => setState(() => _selecionadoId = id)),
        ),
      ],
    );
  }
}

class _Foto extends StatelessWidget {
  const _Foto({required this.membro, required this.tamanho});

  final Membro membro;
  final double tamanho;

  @override
  Widget build(BuildContext context) {
    final api = AppScope.of(context).api;
    final iniciais = membro.nome.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).take(2).map((p) => p[0]).join();
    final semFoto = CircleAvatar(radius: tamanho / 2, child: Text(iniciais.toUpperCase()));
    if ((membro.foto ?? '').isEmpty) return semFoto;
    return ClipOval(
      child: Image.network(
        '${api.base}/api/membros/${Uri.encodeComponent(membro.id)}/foto-miniatura',
        headers: api.autorizacao,
        width: tamanho,
        height: tamanho,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => semFoto,
      ),
    );
  }
}

/// Ficha de consulta. [onAbrir] leva à ficha de um familiar.
class FichaMembro extends StatelessWidget {
  const FichaMembro({super.key, required this.membro, required this.todos, required this.onAbrir});

  final Membro membro;
  final List<Membro> todos;
  final void Function(String id) onAbrir;

  static String _telefone(String d) => d.length == 11
      ? '(${d.substring(0, 2)}) ${d.substring(2, 7)}-${d.substring(7)}'
      : d.length == 10
          ? '(${d.substring(0, 2)}) ${d.substring(2, 6)}-${d.substring(6)}'
          : d;

  static Future<void> _abrir(BuildContext context, Uri uri) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) throw Exception();
    } catch (_) {
      messenger.showSnackBar(const SnackBar(content: Text('Nenhum aplicativo no tablet abre esse contato.')));
    }
  }

  String? _aniversario() {
    if (membro.dia == null || membro.mes == null) return null;
    final dm = '${membro.dia.toString().padLeft(2, '0')}/${membro.mes.toString().padLeft(2, '0')}';
    if (membro.ano == null) return dm;
    final hoje = DateTime.now();
    var idade = hoje.year - membro.ano!;
    if (hoje.month < membro.mes! || (hoje.month == membro.mes! && hoje.day < membro.dia!)) idade--;
    return '$dm/${membro.ano} ($idade anos)';
  }

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final m = membro;
    final porId = {for (final x in todos) x.id: x};
    final conjuge = m.conjugeId == null ? null : porId[m.conjugeId];
    final pais = [for (final id in m.paisIds) if (porId[id] != null) porId[id]!];
    final filhos = todos.where((x) => x.paisIds.contains(m.id)).toList();
    final endereco = [
      [m.rua, m.numero].where((s) => (s ?? '').isNotEmpty).join(', '),
      m.complemento,
      m.bairro,
      [m.cidade, m.estado].where((s) => (s ?? '').isNotEmpty).join('/'),
    ].where((s) => (s ?? '').isNotEmpty).join(' · ');
    final whatsapp = (m.whatsapp ?? '').replaceAll(RegExp(r'\D'), '');
    final telefone = (m.telefone ?? '').replaceAll(RegExp(r'\D'), '');

    Widget linha(String rotulo, String? valor) => (valor ?? '').trim().isEmpty
        ? const SizedBox.shrink()
        : Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              SizedBox(width: 150, child: Text(rotulo, style: TextStyle(color: tema.colorScheme.outline))),
              Expanded(child: SelectableText(valor!.trim())),
            ]),
          );
    Widget pessoa(Membro p, String papel) => ActionChip(
          avatar: const Icon(Icons.person_outline, size: 18),
          label: Text('$papel: ${p.nome}'),
          onPressed: () => onAbrir(p.id),
        );

    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Row(children: [
          _Foto(membro: m, tamanho: 88),
          const SizedBox(width: 20),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(m.nome, style: tema.textTheme.headlineSmall),
              const SizedBox(height: 4),
              Text([m.status.nome, if ((m.funcao ?? '').isNotEmpty) m.funcao!].join(' · '),
                  style: TextStyle(color: tema.colorScheme.primary, fontWeight: FontWeight.w600)),
              if (m.ministerios.isNotEmpty) Text(m.ministerios.join(', ')),
            ]),
          ),
        ]),
        const SizedBox(height: 16),
        Wrap(spacing: 8, runSpacing: 8, children: [
          if (whatsapp.isNotEmpty)
            FilledButton.icon(
              icon: const Icon(Icons.chat_outlined),
              label: Text('WhatsApp ${_telefone(whatsapp)}'),
              onPressed: () => _abrir(context,
                  Uri.parse('https://wa.me/${whatsapp.length <= 11 ? '55$whatsapp' : whatsapp}')),
            ),
          if (telefone.isNotEmpty)
            OutlinedButton.icon(
              icon: const Icon(Icons.call_outlined),
              label: Text('Ligar ${_telefone(telefone)}'),
              onPressed: () => _abrir(context, Uri(scheme: 'tel', path: telefone)),
            ),
          if (telefone.isEmpty && whatsapp.isNotEmpty)
            OutlinedButton.icon(
              icon: const Icon(Icons.call_outlined),
              label: const Text('Ligar'),
              onPressed: () => _abrir(context, Uri(scheme: 'tel', path: whatsapp)),
            ),
        ]),
        const Divider(height: 32),
        linha('Aniversário', _aniversario()),
        linha('E-mail', m.email),
        linha('Endereço', endereco),
        linha('Chegou à igreja', dataBr(m.dataChegada)),
        linha('Batismo', dataBr(m.dataBatismo)),
        linha('Membresia', dataBr(m.dataMembresia)),
        linha('Estado civil', m.estadoCivil),
        if (conjuge != null || pais.isNotEmpty || filhos.isNotEmpty) ...[
          const SizedBox(height: 12),
          Text('Família', style: tema.textTheme.titleMedium),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: [
            if (conjuge != null) pessoa(conjuge, 'Cônjuge'),
            for (final p in pais) pessoa(p, 'Pai/Mãe'),
            for (final f in filhos) pessoa(f, 'Filho(a)'),
          ]),
        ],
        if ((m.observacoes ?? '').trim().isNotEmpty) ...[
          const SizedBox(height: 16),
          Text('Observações', style: tema.textTheme.titleMedium),
          const SizedBox(height: 4),
          SelectableText(m.observacoes!.trim()),
        ],
        const SizedBox(height: 24),
        Text('Para alterar a ficha, use o painel web (Membros).', style: TextStyle(color: tema.colorScheme.outline)),
      ],
    );
  }
}
