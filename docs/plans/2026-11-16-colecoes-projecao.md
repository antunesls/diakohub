# Coleções de projeção — plano de implementação

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Objetivo:** disponibilizar Luz e presença, Águas tranquilas e Aliança como artes individuais, com logo oficial, para TV 16:9 e projetor 4:3.

**Arquitetura:** biblioteca estática em `server/web/temas.html`, com composição em canvas e fundos próprios sem texto. Reutiliza autenticação e APIs existentes de cartazes e artes de QR, sem cadastrar conteúdo automaticamente nem substituir configurações sem confirmação. O servidor preserva fundos 4:3 e continua normalizando outros formatos para 16:9.

**Tecnologias:** JavaScript sem dependências novas, Canvas 2D, Dart, package:image, testes node:test e dart test.

## Mapa de contexto

| Arquivo | Responsabilidade / alteração |
|---|---|
| `server/web/temas.js` | Catálogo, geometria por formato e composição reutilizável. |
| `server/web/temas-pagina.js` | Prévia, edição, download, envio para Cartazes e aplicação de QR autenticada. |
| `server/web/temas.html`, `server/web/temas.css` | Biblioteca acessível e responsiva. |
| `server/web/temas/*.png` | Três fundos originais gerados sem texto nem logo; logo aplicado pelo canvas. |
| `server/web/painel.html` | Link em Cartazes; preservar alterações preexistentes. |
| `server/web/admin.html` | Link na área de QR; preservar alterações preexistentes. |
| `server/lib/artes_qr.dart` | Normalização/carregamento também em 1440×1080. |
| `server/web/arte-qr.js` | Reabrir e apresentar arte 4:3 sem distorção. |
| `server/lib/app.dart`, `server/lib/configuracoes.dart` | Envio opcional de geometria/layout junto do PNG, em uma operação; clientes existentes continuam compatíveis. |
| `server/test/temas_test.js` | Catálogo, formatos, áreas seguras, nomes e conteúdo. |
| `server/test/arte_qr_test.js` | Geometria 4:3 compatível com servidor. |
| `server/test/artes_qr_test.dart` | Normalização, persistência e leitura real de QR em 4:3. |

**Dependências:** `comum.js` (api/token/DOM), `/logo-claro.png` (logo oficial), POST `/api/cartazes`, PUT `/api/admin/configuracoes`, POST `/api/admin/arte-qr`, GET `/api/eu`. Galeria permanece exclusiva para fotos públicas. Não há migração de banco, dependências novas ou alteração das permissões do servidor.

## Etapas e verificações

1. Escrever e executar testes inicialmente falhos para catálogo de três coleções, formatos 1920×1080/1440×1080, layouts seguros e normalização 4:3.
   - `node --test server/test/temas_test.js server/test/arte_qr_test.js`
   - Em `server`: `dart test test/artes_qr_test.dart`
2. Implementar composição: boas-vindas, avisos, agenda, oração, visitantes, ofertas, versículo, fundo de louvor e QR de oração/mensagens/PIX. Textos editáveis; fundo de louvor sem letras fixas.
3. Implementar página com três seletores de coleção, seletor de formato, aplicação, textos e logo. Exportar PNG individual e enviar para Cartazes mediante ação explícita. Para QR, fundo sem código; aplicar somente com confirmação e APIs já protegidas.
4. Preservar 4:3 no servidor e ao reabrir o editor administrativo. Manter comportamento legado para demais proporções e padrão sem arte.
5. Adicionar links, documentação e validar testes JavaScript, testes Dart focados, análise estática e prévia no navegador, quando disponível.

## Limites explícitos

- Fundos para Holyrics são PNG para importação manual como fundo de tema; não inventar API de criação de temas nativos.
- A biblioteca não publica nenhuma arte ou QR automaticamente. Download é local; envio exige sessão/permissão e ação do usuário.
- QR real somente pelo servidor; não exportar código demonstrativo como funcional.
- Alterações preexistentes de outros trabalhos não devem ser revertidas, formatadas em massa nem incluídas em commits.

## Resultado e verificações

- ✅ Três fundos próprios em PNG, sem texto ou logo gerado; logo oficial aplicado pelo canvas.
- ✅ Onze aplicações × três coleções × dois formatos = 66 combinações renderizadas no Chrome sem falha.
- ✅ Exportação PNG conferida no navegador em 1920×1080 e 1440×1080; celular de 390 px sem rolagem horizontal.
- ✅ Adição a Cartazes com permissão, confirmação e API existente; nenhum cadastro automático.
- ✅ Fundos QR sem código na exportação; servidor compõe QR real, com teste de decodificação em 4:3.
- ✅ Fundo e geometria do QR enviados juntos, sem rollback parcial do navegador caso a resposta se perca. Revisão independente confirmou a correção.
- ✅ Compatibilidade: editor administrativo reabre artes 4:3; fotos JPG do modo automático mantêm 16:9.
- ✅ Verificação final focada: 70 testes JavaScript; 59 testes Dart (admin, artes QR, agente); análise Dart dos arquivos envolvidos sem problemas. A suíte completa de 310 testes Dart passou antes do ajuste final de envio atômico.
- 🔄 Temas nativos do Holyrics continuam configurados no próprio Holyrics: a biblioteca entrega PNG de fundo para importação manual.
- 🔄 Galeria pública de fotos e aparência automática do mural permanecem no fluxo atual; artes em 16:9 entram por Cartazes mediante ação explícita.
- ✅ Deploy autorizado e realizado em 16/11/2026: produção 1.43.0 → 1.44.0, commit `eb5cf87` da branch isolada `deploy/colecoes-1.44.0`, sem incluir alterações locais de outros trabalhos. Pacote validado com 110 testes do núcleo, 303 do servidor e 66 JavaScript. Serviço ativo e página/imagens públicas conferidas em HTTPS; API protegida continua retornando 401 sem login. Backup `/root/antes-1.44.0-20261116095842.tgz`. Não foram aplicadas artes aos QR ativos nem publicados cartazes durante a verificação.
