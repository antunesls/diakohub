# Casais e Família — Plano de implementação

**Objetivo:** consulta mensal dos casamentos a partir dos membros e devocionais públicos com compartilhamento e assinaturas por tema.

**Arquitetura:** módulo de rotas de devocionais em Dart/Shelf, integrado à autorização existente. Coleções JSON geridas por Store e incluídas no backup. Interface integrada ao painel existente e página pública de leitura/assinatura. Não altera nem duplica cadastros de pessoas.

## Mapa de contexto

| Arquivo | Responsabilidade |
|---|---|
| `server/lib/devocionais.dart` | CRUD, publicação, assinatura confirmada, prévia e envio manual individualizado e idempotente |
| `server/lib/email_devocionais.dart` | Mensagens SMTP de confirmação e conteúdo, texto/HTML escapados |
| `server/lib/casais.dart` | Consulta mensal e contatos limitados, sem documentos nem campos privados |
| `server/lib/app.dart` | Integrar rotas e dependências, mantendo mudanças anteriores de casamento |
| `server/lib/permissoes.dart` | Permissões casais/devocionais e perfil líder |
| `server/lib/store.dart` | Coleções devocionais, assinaturas e recibos de envio |
| `server/web/casais.js`, `server/web/devocional.html` | Gestão interna e leitura/assinatura pública |
| `server/web/painel.html`, `server/web/painel.js`, `server/web/menu-lateral.js` | Navegação e carregamento da área |

## Tarefas e critérios

1. Escrever e executar testes inicialmente falhando para perfil restrito e consulta mensal (ano, fevereiro, vínculo externo, casal único, sem LGPD pública exigida para consulta interna).
2. Implementar perfil `liderCasais`, permissões `casais` e `devocionais` (esta implica aquela); sem permissão `membros`. Administrador/pastor gerenciam devocionais; secretaria consulta casais.
3. Escrever e executar testes inicialmente falhando do módulo de devocionais: rascunho privado, publicação autorizada, validação, edição e retirada do ar, campos públicos mínimos, compartilhamento.
4. Implementar rotas e armazenamento. Conteúdo estruturado: título, autor, data, tema casais/família, referência, reflexão, aplicação e oração. Sem controles do culto. Reaproveitar importação de texto/Word da Palavra.
5. Testar antes de implementar assinaturas: temas, consentimento específico, tokens aleatórios guardados por hash, prazo, confirmação explícita, cancelamento, respostas públicas não enumeráveis e limite de taxa. Associar e-mail confirmado ao membro existente quando possível, sem criar membros.
6. Testar antes de implementar envio: prévia, confirmação explícita, destinatários membros selecionados e/ou assinantes confirmados do tema, deduplicação por e-mail, cancelamento, envios simultâneos/repetidos, falhas SMTP e retomada sem repetir destinatários já enviados. Publicar não envia e-mail.
7. Testar e implementar interface: consulta mês/ano, editor, prévia segura, publicação e envio separados, WhatsApp texto/link, seleção de membros e assinantes. Página pública responsiva com formulário de inscrição, confirmação e cancelamento sem segredos em query string.
8. Revisão independente de segurança e requisitos; executar Dart analyze, suítes Dart/JS, sintaxe JS, compilação do servidor e diff check. Documentar limites e resultado real.

## Resultado

- Consulta mensal em `/api/casais` e aba **Casais e Família**; perfil próprio de líder, sem permissão `membros`.
- Devocionais com rascunho, publicação, retirada do ar, importação de texto/Word e página pública `/devocional`.
- Envio manual por e-mail com prévia, deduplicação, recibos persistentes, estado incerto sem reenvio automático e aviso quando o SMTP não está configurado.
- Assinatura pública com duplo opt-in, temas casais/família, cancelamento por link e supressão de envios avulsos após cancelamento.
- Links de cancelamento antigos continuam válidos por até 24 envios; a lista é limitada porque o JSON é regravado a cada envio.
- Um perfil por conta foi mantido: o suporte a vários perfis que surgiu durante a implementação foi removido por estar fora do pedido.

## Segurança e preservação

- Não tocar nos arquivos Android não rastreados nem descartar alterações anteriores de casamento.
- Não enviar mensagens reais durante testes; transporte injetável.
- Não publicar em produção nem criar contas reais.
- E-mails individuais, sem revelar lista. Autorização de casamento/LGPD não equivale a assinatura; inscrição exige aceite específico.
- Links públicos expõem apenas devocionais publicados. Rascunhos, assinantes e membros permanecem protegidos.
- Tokens em fragmentos e enviados por POST; não confirmar/cancelar em GET (robôs de e-mail).
- Não prometer entrega exatamente uma vez pelo SMTP: registrar reserva persistente antes do envio e manter estado incerto para reconciliação, evitando reenvio automático após interrupção.
