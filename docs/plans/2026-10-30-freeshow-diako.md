# FreeShow Diako: projeção compatível com o DiakoHub

Data: 2026-10-30

Fork: `~/projetos/FreeShow_Diakonia` (`git@github.com:antunesls/FreeShow_Diakonia.git`), base FreeShow 1.6.8-beta.2.

## Objetivo

Usar o fork do FreeShow (**FreeShow Diako**) como software de projeção da igreja, com tudo o que o DiakoHub já faz hoje com o Holyrics: recados, boas-vindas, sequências, versículos, imagens, contagens, tela vazia/preta, mensagens e contagem na TV do palco, temas e o ensaio do monitor. O Holyrics continua suportado: cada igreja escolhe qual usa.

## Decisão principal: o fork fala "Holyrics"

O DiakoHub já conversa com o projetor por uma única porta: `PonteHolyrics.chamar(acao, corpoJson)` (`server/lib/holyrics.dart`). As outras partes dependem dela: servidor, agente, tablet pela rede local, histórico e monitor. Todas usam os mesmos nomes de ação e o mesmo formato de resposta (`{"status":"ok","data":...}` / `{"status":"error","error":"..."}`).

Por isso **o fork implementa um servidor HTTP compatível com o subconjunto da API Server do Holyrics que o DiakoHub usa** (`POST /api/<Acao>?token=...`). A tradução para o FreeShow fica toda dentro do fork, que é nosso.

- O DiakoHub não ganha um segundo caminho: `HolyricsDireto`, `HolyricsViaAgente`, agente, API local do tablet e histórico funcionam sem mudança.
- O Holyrics continua funcionando exatamente como hoje, sem risco de regressão.
- A alternativa seria um adaptador no DiakoHub falando a API nativa do FreeShow (socket.io/REST na 5505/5506). Ela foi descartada por três motivos. A API nativa é *fire-and-forget*: só as ações `get_*` respondem, então o DiakoHub não saberia se a projeção deu certo, e o histórico depende disso. Ela também não tem apresentação rápida de texto livre nem mensagem estilizada no palco. E o adaptador duplicaria a lógica no servidor, no agente e no tablet.

As ações do contrato são as que estão em `acoesPermitidas`:

| Ação (contrato) | Fase | Usado em | Implementação no FreeShow Diako |
|---|---|---|---|
| `GetCPInfo` | 1 | teste de conexão, monitor | `status ok` + `data: {software: "freeshow-diako", versao, recursos: [...]}` |
| `GetCurrentPresentation` | 1 | tablet, ensaio | Lê a saída ativa → `{id, type, name, slide_number, total_slides, slide_type}`. `type = "quick_presentation"` quando o show ativo foi criado pelo DiakoHub |
| `ShowQuickPresentation` | 1 | recados, sequência, boas-vindas, gratidão, ensaio | Show salvo na categoria "DiakoHub" (`text` ou `slides[]`), template = `theme.name`, avanço automático (`automatic.seconds`/`repeat`) e `duration` por slide. Aceita `<b>` e o prefixo `<styled>` |
| `ActionNext` / `ActionPrevious` | 1 | tablet | `OutputHelper.advanceOutputs` |
| `ActionNext/PreviousQuickPresentation` | 1 | tablet, ensaio | Igual, mas só se o show ativo é um do DiakoHub; senão, erro |
| `CloseCurrentPresentation` | 1 | tablet | `clear_slide` + `clear_background` (deixa overlays e áudio) |
| `SetF9` (tela vazia) / `SetF10` (tela preta) | 1 | tablet, Modo Culto | Liga/desliga um estado guardado pelo fork. F9 limpa o texto e mostra o fundo padrão; F10 escurece a saída. Ao desligar, restaura o que estava |
| `ShowImage` | 2 | cartazes, QR | `file` relativo à "pasta de imagens do DiakoHub" configurada no fork → mídia de fundo, limpando o texto |
| `ShowVerse` | 2 | Palavra (Modo Culto) | `ids` LLCCCVVV → `"LL.CCC.VVV,VVV"` → `startScripture` (já aceita referência numérica), na Bíblia padrão configurada |
| `GetThemes` | 2 | escolha de tema (painel, monitor) | Lista os templates do FreeShow `{id, name}` |
| `GetThumbnail` (`type: theme`) | 2 | miniaturas dos temas | Miniatura do template em base64 (≤ 90 KB). Opcional: sem ela o DiakoHub já mostra só o nome |
| `SetTextCP` | 3 | mensagem/leitura no palco | Item de palco novo, "Mensagem DiakoHub", que respeita `custom_theme` (alinhamento, negrito, cor, sombra) e `show` |
| `StartCountdownCP` / `StopCountdownCP` | 3 | contagem no palco | Timer fixo "DiakoHub palco" (`edit_timer` + start/stop), exibido no layout de palco, amarelo a partir de `yellow_starts_at` |
| `ShowCountdown` | 3 | "O culto começa em" | Show com item de timer (duração `MM:SS` ou hora exata `HH:MM`) + `text_before`, no template pedido |

Erros também seguem o formato do Holyrics, inclusive `"invalid token"`, que o app já traduz.

## Decisões (2026-10-30)

- **Porta 8092** para o servidor compatível do FreeShow Diako, para poder conviver com o Holyrics (8091) no mesmo PC durante a transição.
- **Bíblia de domínio público** (Almeida), distribuída junto com o fork como arquivo local.
- **TV do palco por saída de vídeo do PC** do projetor, não por navegador.
- **Slides do DiakoHub ficam salvos** na categoria "DiakoHub" do FreeShow, com limpeza automática dos antigos.

## Regras para as quatro fases

- **Fork:** o código novo vai em pastas próprias (`src/electron/diako/`, `src/frontend/diako/`). Nos arquivos do FreeShow entram só ganchos de poucas linhas, marcados com `// DIAKO`. O trabalho é feito no branch `diako`, e cada versão nova do FreeShow é trazida por merge da tag do upstream (estimativa: 0,5 a 1 dia por mês).
- **DiakoHub:** o Holyrics continua sendo o padrão. Nenhuma chave de configuração existente muda de nome (`holyrics.host/porta/token`, `pastaImagensHolyrics`), então quem já está instalado não precisa migrar nada.
- Cada fase termina com um teste na igreja antes da seguinte começar.

**Esforço total estimado:** 15 a 25 dias de trabalho, ou 4 a 6 semanas de calendário com os testes na igreja. A estimativa foi feita antes de compilar o fork e fica mais confiável depois da prova de conceito da Fase 1.

## Fase 1: base e textos no telão (6 a 9 dias)

Ao fim desta fase, recados, sequência, boas-vindas, gratidão, navegação, tela vazia/preta e o ensaio do monitor funcionam com o FreeShow Diako.

**Preparação (0,5 dia)**
1. Rodar o fork como está (`npm install` e `npm start`, Node ≥ 22.12) e confirmar o build nesta máquina.
2. Criar o branch `diako` no fork.

**DiakoHub: contrato**
3. `docs/contrato-projecao.md`: as ações da tabela acima, com exemplos de pedido e resposta e o que cada uma deve fazer.
4. `server/test/contrato/*.json`: *fixtures* de pedido/resposta, usados pelos testes do DiakoHub (contra `tool/fake_holyrics.dart`) e pelo teste de contrato do fork.

**Fork: prova de conceito (1 a 2 dias).** Fazer primeiro só `GetCPInfo` e `ShowQuickPresentation`, com o ensaio do monitor do agente projetando no FreeShow. Depois disso, revisar a estimativa.

**Fork: servidor compatível**
5. `src/electron/diako/servidor.ts`: express na porta **8092** (configurável). Token por `?token=` com comparação em tempo constante e corpo limitado a 256 KB. Escuta em `0.0.0.0` porque o agente e o tablet ficam na mesma rede.
6. Ponte main ↔ frontend com resposta obrigatória: toda ação leva um `returnId` e espera até 5 s pelo resultado (`ok`/`erro`). É diferente do `receivedData` do upstream, que só espera nas ações `get_*`.
7. `src/frontend/diako/acoes.ts`: tabela `ação → função`, reaproveitando funções de `apiHelper.ts` (`startShowSync`, `advanceOutputs`, `clearSlide` etc.).
8. Implementar as ações da Fase 1 da tabela: `GetCPInfo` (com `software` e `recursos`), `GetCurrentPresentation`, `ShowQuickPresentation`, as quatro navegações, `CloseCurrentPresentation`, `SetF9` e `SetF10`.
9. Os shows criados pelo DiakoHub ficam salvos na categoria visível "DiakoHub", com nome "DiakoHub · <tipo> · <data hora>". Os com mais de 30 dias são apagados ao abrir o app (prazo configurável; 0 = nunca).
10. Tela **Configurações → Conexões → DiakoHub**: ligar/desligar, porta, token (botão "Gerar") e template padrão. Textos em pt-BR (e en) no sistema de idiomas do FreeShow.

**DiakoHub: detecção e textos**
11. `PonteHolyrics` ganha `software()`, lido do `GetCPInfo`: `holyrics` se o campo `software` não vier, `freeshow-diako` se vier. O valor fica em cache e é renovado na verificação de 30 s do agente. O servidor expõe isso no status que o app e o painel já leem, e o agente envia o valor junto ao estado.
12. Trocar "Holyrics" fixo por "o projetor" ou pelo nome detectado nas mensagens de erro (`holyrics.dart`, `holyrics_client.dart`, `agente.dart`, `monitor.dart`), em `status_controller.dart`, `settings_page.dart`, `admin.html/js` e `painel.js`.
13. No admin, o seletor "Software de projeção" (Holyrics / FreeShow Diako) só muda a porta sugerida (8091/8092) e os textos de ajuda. A conexão é a mesma.
14. `fake_holyrics.dart` (hoje `[porta] [token]`) ganha um terceiro argumento `freeshow`, que faz ele responder o `GetCPInfo` com `software` e `recursos`. Testes da detecção e uma regressão garantindo que, com o Holyrics, nada muda.

**Teste na igreja:** recados, boas-vindas, sequência, navegação, tela vazia/preta e ensaio do monitor.

## Fase 2: imagens, versículos e temas (3 a 4 dias)

**Fork**
1. `ShowImage`: caminho relativo à "pasta de imagens do DiakoHub", configurada na tela de conexão. Recusar `..` e caminho absoluto. A mídia vai para o fundo e o texto é limpo.
2. `ShowVerse`: converter LLCCCVVV → `"LL.CCC.VVV,VVV"` (formato que o `startScripture` já aceita), agrupando versículos do mesmo capítulo.
3. Bíblia Almeida de **domínio público** como arquivo local (sem chave, sem internet), instalada e marcada como padrão na primeira execução. Antes, confirmar a origem e o domínio público do texto escolhido. Se a Bíblia padrão sumir, retornar um erro claro ("Configure a Bíblia padrão no FreeShow Diako").
4. `GetThemes` (lista dos templates `{id, name}`) e `GetThumbnail` (`type: theme`, base64 ≤ 90 KB).
5. Tela de conexão: campos de pasta de imagens e Bíblia padrão.

**DiakoHub**
6. O rótulo "Pasta de imagens do Holyrics" passa a "Pasta de imagens do projetor". O FreeShow Diako aponta para a mesma pasta, e a subpasta `Diako` não muda.
7. Recursos que faltam: se uma ação não estiver em `recursos` do `GetCPInfo`, o app e o painel escondem o botão em vez de mostrar erro. Com o Holyrics, considera-se que tudo existe, como hoje. Incluir testes.

**Teste na igreja:** cartazes, QR, versículo da Palavra (também ainda pendente no Holyrics, ver `docs/modo-culto.html`) e escolha de tema.

## Fase 3: TV do palco e contagens (3 a 5 dias)

**Fork**
1. Item de palco "Mensagem DiakoHub" (`src/frontend/diako/palco/`) que respeita `custom_theme` (alinhamento, negrito, cor, sombra) e `show`.
2. Layout de palco "DiakoHub" criado na primeira execução, com mensagem, slide atual, próximo slide e timer.
3. A TV do palco é uma **saída de vídeo do PC do projetor** (HDMI extra), configurada como saída de palco do FreeShow com o layout "DiakoHub". Na primeira execução, se houver uma tela sobrando, o fork sugere essa saída.
4. `SetTextCP` sobre o item de mensagem.
5. `StartCountdownCP` / `StopCountdownCP`: timer fixo "DiakoHub palco" (`edit_timer` + start/stop), amarelo a partir de `yellow_starts_at`, parando no zero.
6. `ShowCountdown` no telão: show com item de timer (duração `MM:SS` ou hora exata `HH:MM`) + `text_before`, no template pedido.

**DiakoHub**
7. Ajustes que aparecerem no teste. Nenhuma mudança de código prevista, porque as chamadas já existem em `holyrics_client.dart`.

**Teste na igreja:** mensagem e leitura no palco, contagem no palco e "O culto começa em" no telão.

## Fase 4: distribuição e documentação (3 a 5 dias)

**Fork**
1. `config/building/electron-builder.yaml`: `productName: FreeShow Diako`, `appId` próprio e pasta de dados própria. Assim convive com um FreeShow original instalado.
2. Desligar o auto-update do upstream e publicar instaladores no GitHub Releases do fork (workflow próprio, Windows primeiro). Sem certificado de assinatura, o Windows mostra o aviso do SmartScreen.
3. README do fork com créditos ao FreeShow/ChurchApps e GPL-3.0 mantida, já que o fork é distribuído.
4. Testes: unidade (vitest) para a conversão LLCCCVVV, o parser de `slides`/`automatic` e o token. Mais um teste de contrato que roda os *fixtures* do DiakoHub contra o servidor do fork.

**DiakoHub**
5. Página `/ajuda/freeshow-diako` (`server/web/ajuda-freeshow.html`), no padrão das outras páginas de ajuda: instalar, ligar a conexão DiakoHub, gerar o token, apontar a pasta de imagens, Bíblia, e ligar e escolher a TV do palco.
6. `server/LEIA-ME.md`, `README.md` e `agente.example.json`: mencionar o FreeShow Diako e a porta 8092.
7. `tool/diagnosticar_holyrics.ps1` passa a aceitar a porta e mostra o software detectado.
8. Release do DiakoHub e deploy no LXC.

**Teste na igreja:** roteiro do Modo Culto inteiro com o FreeShow Diako instalado pelo instalador, e depois de novo com o Holyrics.

## Fora deste plano

- Letras de músicas: continuam com o operador no FreeShow, como hoje no Holyrics. O DiakoHub não importa nem projeta letras.
- Enviar contribuições ao FreeShow original (o ganho de resposta confirmada nas ações seria uma boa PR, mas fica para depois).

## Verificação (em toda fase)

- Fork: `npm run test:unit` e o teste de contrato verdes (a partir da Fase 4, `npm test` completo).
- DiakoHub: `dart test` (servidor) e `flutter test` (app) verdes, com o Holyrics e com o `fake_holyrics` no modo `freeshow`.
- Na igreja: o teste listado no fim da fase, com o FreeShow Diako e, para regressão, com o Holyrics.
