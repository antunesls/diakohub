# DiakoHub

Plataforma da Igreja Diakonia Tulipas. Junta num só lugar o **site da igreja**, o **painel da equipe**, o **telão** (Holyrics), o **tablet do pastor**, as **TVs** da recepção, o cadastro de **membros e visitantes**, as **escalas e o repertório do louvor**, os **encontros e inscrições**, os **devocionais** e a preparação da **Palavra**.

```
 Celular (membro/visitante) ─▶ /  /oracao  /mensagens  /visitante  /cadastro
                               /devocional  /inscricao/…  /minha-escala ──────────┐
 Navegador (equipe) ────────▶ /painel  /admin  /acessos  /recepcao ───────────────┤
 TVs da igreja ─────────────▶ /mural  (mural de informações e TV de boas-vindas) ─┤
 Tablet do pastor (app) ───────────────────────────────────────────────────────────┤
                                                                                   ▼
                                     Servidor DiakoHub: dados, cartazes, histórico, backup
                                     (no PC do Holyrics, ou na internet + agente no PC)
                                                                                   │
                                                                                   ▼
                                                                    Holyrics (telão e palco)
```

**Sumário:** [Quem usa o quê](#quem-usa-o-quê) · [Endereços](#endereços) · [Site público](#site-público) · [Painel da equipe](#painel-da-equipe-painel) · [Tablet do pastor](#tablet-do-pastor-app-android) · [TVs](#tvs-da-igreja) · [Perfis de acesso](#perfis-de-acesso) · [Privacidade e LGPD](#privacidade-e-lgpd) · [Instalação](#instalação) · [Desenvolvimento](#desenvolvimento) · [Publicar uma versão](#publicar-uma-versão-github-releases) · [Nomes técnicos](#nomes-técnicos)

## Quem usa o quê

| Quem | Onde | Para quê |
|---|---|---|
| Membros e visitantes | Celular, sem login | Pedir oração, mandar mensagem, cadastrar-se, ler devocionais, inscrever-se em encontros |
| Integrantes das escalas | `/minha-escala`, com login | Ver os próprios cultos e músicas, escolher músicas (ministro) e avisar indisponibilidades |
| Equipe da igreja | `/painel`, com login | Cuidar de pessoas, cultos, comunicação e operação, conforme o perfil |
| Pastor (ou operador do telão) | Tablet com o app | Projetar no telão durante o culto, seguir o roteiro e ler a Palavra |
| Recepção | `/recepcao`, no celular | Cadastrar visitantes na porta |
| TVs da igreja | `/mural` | Mural de informações e boas-vindas aos visitantes |
| Administração | `/admin` e `/acessos` | Configurações, usuários, perfis e backup |

## Endereços

| Endereço | Para quem |
|---|---|
| `/` | Página inicial pública da igreja |
| `/oracao`, `/mensagens`, `/visitante` | Formulários públicos de oração, mensagens e cadastro de visitante |
| `/cadastro` | Ficha de membro preenchida pela própria pessoa (link compartilhável) |
| `/autorizar` | Autorização individual de uso dos dados (LGPD) |
| `/devocional` | Devocionais publicados, por trilha, e assinatura por e-mail |
| `/inscricao/<código>` | Inscrição pública em um encontro (link gerado no painel) |
| `/minha-escala` | Integrantes das escalas (com login) |
| `/painel` | Equipe (com login) |
| `/admin` | Administração (com login) |
| `/acessos` | Usuários e perfis (com login) |
| `/recepcao` | Obreiro da recepção (com login) |
| `/mural` | TVs da igreja (exige `?chave=`; TV de boas-vindas: `&tela=boas-vindas`) |
| `/ajuda/usuarios`, `/ajuda/visitantes`, `/ajuda/atas`, `/ajuda/agenda-google`, `/ajuda/rede-local` | Guias passo a passo no próprio site |

## Site público

- **Página inicial (`/`):** avisos da semana e aviso urgente, próximos eventos do Google Agenda, horários dos cultos, endereço com "Como chegar", PIX com QR, redes sociais, carrossel de fotos e o devocional mais recente. Tudo se configura em `/admin`; o que não tem conteúdo não aparece.
- **Pedidos de oração (`/oracao`):** quem pede escolhe se o pedido pode ir para o telão. Pedidos particulares nunca são projetados nem aparecem no mural.
- **Caixa de mensagens (`/mensagens`):** dúvidas, sugestões e críticas, anônimas ou com contato. A equipe recebe aviso por e-mail, sem o conteúdo.
- **Cadastro de visitante (`/visitante`):** o visitante se cadastra pelo QR da recepção e já autoriza o uso dos dados.
- **Cadastro de membros (`/cadastro`):** a pessoa preenche a própria ficha, com foto opcional e familiares por nome. Só entra no cadastro depois que a secretaria revisa e aprova.
- **Devocionais (`/devocional`):** destaque da semana, lista por trilha e assinatura por e-mail. Devocionais de uma série mostram as partes em ordem. Detalhes em [Devocionais](#devocionais).
- **Inscrição em encontro (`/inscricao/<código>`):** nome, WhatsApp, e-mail opcional, acompanhantes e aceite de uso dos dados. Detalhes em [Inscrições pelo link](#inscrições-pelo-link).
- **Minha escala (`/minha-escala`):** cada integrante entra com usuário e senha e vê só os próprios cultos, com as músicas, o tom, a primeira nota e o link do YouTube. O ministro escolhe as músicas numa tela própria, com "Você tocou recentemente" e "Mais tocadas". Todos podem avisar indisponibilidades.

## Painel da equipe (`/painel`)

O menu é organizado por área, e cada pessoa vê só o que os seus perfis permitem. O painel atualiza sozinho ("ao vivo") quando outra pessoa muda algo, sem descartar uma edição aberta.

| Área | Páginas |
|---|---|
| Início | Visão geral |
| Acompanhamento | Motivos de oração, Mensagens, Membros, Casais e Família, Encontros e inscrições, Ministérios |
| Cultos | Escalas, Repertório, Roteiros, Palavras |
| Comunicação | Agenda, Recados, Cartazes, Galeria, Devocionais, Resumo da semana |
| Operação | Gestão da Casa, Atas de reunião, Histórico, Auditoria, Status, Acessos às escalas, Usuários e acessos, Administração |

### Acompanhamento

#### Motivos de oração e Mensagens
- **Motivos de oração:** os pedidos do site chegam para aprovação. Atendidos ganham data e testemunho, e as orações respondidas podem ser projetadas.
- **Mensagens:** caixa privada com as situações *Nova*, *Em análise* e *Resolvida*.

#### Membros e visitantes
- **Ficha em abas** (*Pessoal*, *Contato*, *Igreja*, *Família*): foto, CEP com preenchimento automático, ministérios, importação e exportação em CSV e impressão.
- **Solicitações de cadastro:** vêm de `/cadastro`. A secretaria escolhe Congregado ou Membro, pode aproveitar uma ficha existente ou rejeitar. Pedidos rejeitados ficam guardados até exclusão manual.
- **Visitantes:** ficam na mesma lista, com a situação *Visitante*. Não entram em aniversariantes, escalas nem na contagem de ativos até virarem *Congregado* ou *Membro*. Há três formas de cadastrar: QR da recepção, obreiro pelo celular em `/recepcao` ou secretaria pelo painel. A ficha guarda quem veio junto, os interesses e o acompanhamento, com mensagem pronta de WhatsApp. Guia em `/ajuda/visitantes`.
- **Aniversários de casamento:** a data vai em **Membros › Família**, escolhendo o cônjuge ou escrevendo o nome quando ele não tem cadastro. Data e autorização são compartilhadas entre os cônjuges vinculados. Com autorização específica do casal, um recado automático mostra nomes, data e anos de casamento na semana (domingo a sábado) no mural, no telão e no resumo do WhatsApp, sem repetir casais vinculados. Trocar o cônjuge ou a data exige nova autorização.

#### Casais e Família
- **Aniversários do mês:** escolha de mês e ano, com casal, data e anos de casamento. Usa só os vínculos do cadastro de Membros, sem um segundo cadastro de pessoas. Casamentos de 29/02 aparecem em 28/02 nos anos não bissextos. Consultar aqui é diferente de autorizar a divulgação no mural e no telão.
- **Parabéns e contatos:** mensagem editável para copiar ou abrir no WhatsApp; por e-mail, com prévia e confirmação do envio individual. Abrir o WhatsApp, copiar ou o SMTP aceitar o e-mail **não** marca o casal como parabenizado: o contato é registrado explicitamente, com data e responsável. Um registro errado pode ser anulado sem apagar a autoria. O mesmo aniversário não é registrado duas vezes, e trocar cônjuge ou data não transfere o histórico.
- **E-mail de parabéns:** usa o SMTP da Administração e o contato e consentimento atuais do membro (não os assinantes de devocionais). Recibos persistentes evitam envios repetidos; se o resultado ficar incerto, não há repetição automática.
- **Acesso:** `casais` permite consultar; `casaisGerenciar` também registra contatos e envia parabéns. Nenhuma das duas dá acesso a CPF, endereço, observações ou à ficha completa.
- **Limites:** não registre aconselhamento conjugal, informações íntimas, documentos, saúde ou dados financeiros. Não há pagamentos nem envios automáticos de WhatsApp ou de parabéns.

#### Encontros e inscrições
Encontros de qualquer ministério: culto, conferência, retiro, acampamento, jantar, palestra, treinamento, encontro de famílias ou outro tipo. Tem a permissão própria `encontros`, que cobre encontros, inscrições, materiais e roteiros.

- **Encontro:** ministério responsável (ou "Igreja toda"), título, tipo, local, início e fim, descrição, limite opcional de vagas e situação (rascunho, aberto, encerrado ou cancelado). Cancelar bloqueia novas inscrições, presenças e mudanças de roteiro, preservando o histórico. **Excluir** (só a Administração) apaga o encontro com inscrições e tarefas e fica na Auditoria; serve para cadastros de teste ou feitos por engano. A lista filtra por ministério.
- **Página do encontro:** "Ver encontro" abre o encontro no lugar da lista (**‹ Encontros** volta). No topo ficam os números (vagas, lista de espera, inscrições pelo link e tarefas pendentes), **+ Inscrever pessoas** e o menu **Mais** (editar, cancelar, excluir). As abas são:
  - **Inscritos:** busca por nome, WhatsApp ou e-mail, sem precisar de acento; filtros Confirmadas, Lista de espera, Pelo link, Sem cadastro e Canceladas; **Detalhes** abre contato, resposta, pessoas e ações na própria linha.
  - **Check-in:** confirmados em ordem alfabética, com busca. Um toque marca a chegada (confirmando a participação, se faltava); outro desfaz. Com o painel ao vivo, dois tablets podem fazer check-in juntos sem perder a busca.
  - **Divulgar:** link, QR e convite pronto para o WhatsApp (sem dados de inscritos).
  - **Tarefas:** descrição, prazo, situação e responsável com a permissão `encontros`; **Concluir** e **Reabrir** com um clique. Prazos vencidos continuam visíveis.
  - **Roteiro:** materiais escolhidos para o encontro.
- **Inscrições internas:** individuais ou familiares, sem exigir que sejam casais. Cada pessoa é escolhida e confirmada, inclusive crianças e acompanhantes. Acompanhantes sem ficha existem só dentro da inscrição e nunca criam cadastros. Todos ocupam vaga, e a última vaga nunca é entregue duas vezes.

##### Inscrições pelo link
- **Ativar inscrições pelo link** gera `/inscricao/<código>`, com QR quadrado (cartaz e WhatsApp) e versão para o telão. Dá para definir data limite e uma pergunta opcional, gerar um novo link (o antigo para de funcionar) ou desativar.
- A página pública não mostra inscritos e não consulta o cadastro de membros. A inscrição vale na hora enquanto houver vagas; sem vagas, entra na **lista de espera** (que não ocupa vaga) e a equipe usa **Confirmar vaga**.
- Quem informa e-mail recebe a confirmação com um link privado para cancelar (só o hash fica salvo) e é avisado quando sai da espera. Um WhatsApp só pode ter uma inscrição ativa por encontro.
- A equipe vê WhatsApp, e-mail e resposta e pode **vincular ao cadastro** quem for membro.
- Proteções: campo invisível contra robôs, 5 envios por IP a cada 10 minutos e página fora dos buscadores. O link só aceita inscrições com o encontro **Aberto**, até a data limite e antes do início.

##### Materiais e roteiros
- **Biblioteca:** aba própria dentro de Encontros, para todos os ministérios. Cada material tem ministério (ou **Geral**), tipo, público, duração, objetivo, referências, preparação, passos e perguntas. Busca e filtros por ministério, tipo e público; a cópia leva só o conteúdo, sem contatos nem participantes.
- **Tipos de material:** cadastráveis (Dinâmica, Estudo bíblico, Oração, Quebra-gelo, Palestra, Louvor e Outro vêm de início). Renomear vale para todos os materiais; um tipo em uso não pode ser excluído e sempre fica ao menos um.
- **Montar roteiro:** escolhe e ordena até 20 materiais, mostrando primeiro os gerais e os do ministério do encontro. Salvar guarda uma cópia da versão atual de cada material; mudar a biblioteca depois não muda o roteiro.

#### Ministérios
Cada ministério tem as suas pessoas, e uma pessoa pode estar em vários. Conselho, Diretoria e Assembleia também são ministérios (os das atas) e não aparecem como responsáveis de encontros. Um ministério com encontros ou materiais não pode ser excluído; mude o ministério deles antes.

### Cultos

#### Escalas
- **Escalas pastoral e do louvor:** cultos do mês gerados pelos horários cadastrados, sugestão de pessoas por ministério, avisos de conflito e de indisponibilidade e texto pronto para o WhatsApp.
- **Cultos sem escala:** em `/admin › Página inicial › Participação nas escalas`, marque Pastoral e Louvor por horário. Desmarcar não tira o culto do site e vale para hoje e datas futuras, sem apagar pessoas ou músicas; o histórico passado é preservado. Depois de reativar um horário, gere os cultos do mês novamente.
- **Músicas da escala:** a escolha abre uma tabela ordenável (música, tom, BPM, última vez e vezes em 12 meses), com filtros de tom e andamento, prévia da música ao lado e teclado ↑↓ e Enter. "Última vez" e "12 meses" contam só cultos que já aconteceram.
- **Primeira nota:** cadastrada no repertório no Tom Diakonia; a escala mostra a nota já transposta para o tom do culto (painel, Minha escala, WhatsApp e PDF).
- **Indisponibilidades:** quem administra escalas vê todos os avisos ativos, com integrante, conta que enviou, data, período e motivo, e pode cancelar.
- **PDF da escala:** *quadro mensal* (A4 paisagem) ou *cartões por culto* (A4 retrato), com logo e cabeçalho da igreja.
- Instruções em [`server/LEIA-ME.md`](server/LEIA-ME.md#escalas-pastoral-e-do-louvor).

#### Repertório
- **Planilha:** no topo, quantas músicas OK estão sem vídeo, sem tom, sem primeira nota e sem BPM; clicar filtra. A tabela ordena por qualquer coluna, inclusive última vez na escala e vezes em 12 meses.
- **Busca:** título, cantor e compositor, sem diferenciar acentos, com palavras fora de ordem e tolerando pequenos erros. Filtro por situação.
- **Edição na linha:** tom, primeira nota, BPM e link do YouTube gravam na hora, só o campo mudado, e ficam na Auditoria. **+ YouTube** aceita o link mesmo sem "https://".
- **Vídeo em destaque:** **▶ Ouvir** toca a versão de referência num player no rodapé, sem sair da lista. O player usa o modo de privacidade do YouTube (youtube-nocookie) e só carrega no clique; a capa na ficha é neutra, sem imagem do YouTube. Link que não é do YouTube aparece como "outro link".
- **Ficha da música:** **Editar** e **+ Música** abrem a ficha em página: versão de referência no topo, "Qual música" (avisa música repetida enquanto se digita o título), "Como a Diakonia toca" (tom, BPM, tom original, primeira nota em botões, observações) e, recolhido, ano, pedido, anotações antigas do tom e biografias. Ao lado ficam a situação, a prévia de como a música aparece no seletor da escala e o uso na escala.
- **Completar cadastro:** percorre uma a uma as músicas OK sem vídeo, tom ou primeira nota, com tom e nota em botões grandes e o vídeo ao lado; grava só o que mudou.
- **Situação:** **OK** deixa a música disponível para novas escalas; **Em análise** e **Inativo** não. O tom usa 12 maiores, 12 menores e "Não definido".
- **Importação da planilha:** CSV exportado do Google Sheets. Músicas já cadastradas não são alteradas, exceto para ganhar o link do vídeo quando ainda não têm um.

#### Roteiros
A ordem dos momentos que o tablet segue no **Modo Culto**: um modelo por tipo de culto, mais um padrão. Cada modelo define a ordem, os tempos e momentos livres (apresentação de crianças, batismo). Veja [Modo Culto](#tablet-do-pastor-app-android).

#### Palavras
- **Preparação:** colar o texto ou importar Word, PDF, TXT ou um documento do Google Docs (compartilhado com a conta de serviço do Google da agenda). Cada parágrafo vira um trecho e linhas com `#` viram tópicos.
- **Versículos:** o painel acha os versículos citados ("Jo 3.16", "1 Coríntios 13:4-7") e o pastor confirma, ajusta ou ignora cada um. Cada salvamento guarda a versão anterior.
- **Tempo:** vai no próprio tópico (`# A mesa preparada (10 min)`). Durante a leitura, o tablet mostra o tempo no tópico e se a pregação está adiantada ou atrasada, só para o pastor.
- **Frases de destaque:** marcadas com `**dois asteriscos**` (botão **Destacar frase**), viram botões no tablet que projetam a frase no telão, entre aspas.
- **Ensaiar:** percorre a Palavra em tela cheia, sem projetar nada, mede o tempo de cada tópico e compara previsto e ensaio; o tempo do ensaio pode ser guardado.
- **Lista:** busca por título, texto ou versículo citado (como "Jo 3") e filtro por série. **Resumo para o WhatsApp** monta título, tópicos, versículos e frases para copiar.
- **Perfil Pregador:** cada pregador cuida só das próprias Palavras. A Palavra **pronta** com a data do culto desce para o tablet e fica salva nele.

### Comunicação

- **Agenda:** eventos do Google Agenda, que aparecem no site, no mural, no tablet e no resumo da semana. Configuração em `/admin` e passo a passo em `/ajuda/agenda-google` e no [LEIA-ME do servidor](server/LEIA-ME.md#agenda-do-google).
- **Recados:** categorias (Aviso, Evento, Aniversário), fixos no topo, validade e ordenação. O recado **Aniversariantes da semana** é gerado sozinho, só com quem autorizou o uso dos dados.
- **Cartazes:** imagens para o telão e o mural.
- **Galeria:** fotos do carrossel da página inicial; a primeira é a capa.
- **Resumo da semana:** texto para o WhatsApp com recados válidos, aniversariantes, motivos públicos e orações respondidas dos últimos 7 dias. Pedidos particulares nunca entram. Revise e edite antes de enviar.

#### Devocionais
- **Conteúdo:** título, autoria, data, uma ou mais **trilhas** (Casais, Família, Jovens…), série e parte, referência bíblica, reflexão, aplicação e oração. Importa texto e Word como a Palavra. A lista tem busca e filtros, e a aba **Calendário** mostra o mês com publicados, rascunhos e agendados.
- **Publicação:** rascunho, publicação e retirada do ar. O editor tem o painel "Publicação" ao lado, com situação, agendamento, trilhas, a contagem de assinantes e um botão principal que muda conforme a escolha ("Publicar e enviar a N", "Agendar e enviar"). Há "Enviar um teste para mim", recibo e histórico dos envios.
- **Agendamento:** o devocional entra no ar sozinho no horário marcado e só envia e-mail se o envio estiver marcado.
- **Trilhas:** configuradas em **Administração › Trilhas de devocionais**, com ordem, descrição, ativação e contagem de devocionais e assinantes. Trilha em uso é desativada em vez de excluída.
- **Assinaturas:** qualquer leitor informa o e-mail e escolhe as trilhas. Exige autorização específica e confirmação por link; cancelar também é pelo link, sem login. Os links exigem uma ação na página e não são acionados por robôs que só abrem o endereço.
- **Envio por e-mail:** pelo SMTP da Administração, para assinantes confirmados das trilhas ou membros com contato e consentimento. Cada pessoa recebe a sua mensagem, sem ver a lista; repetidos, já enviados e cancelados são ignorados. O painel mostra quantos assinantes há por trilha, sem revelar e-mails.
- **Segurança dos envios:** recibos persistentes evitam repetição em pedidos simultâneos e reinícios. Se o SMTP for interrompido no meio, o resultado fica incerto e esses destinatários não são reenviados automaticamente.
- **Compartilhar:** texto formatado para WhatsApp, link público (rascunhos ficam privados) e QR da página `/devocional`, com arte personalizável.

### Operação

#### Gestão da Casa
- **Pendências:** tarefas por local, prioridade, prazo e responsável, com andamento, conclusão, histórico, fotos e comprovantes privados.
- **Compras planejadas:** quantidade e valor previsto, sem controle de estoque nem aprovação de compras.
- **Manutenção preventiva:** rotinas a cada tantos dias, semanas, meses ou anos. A próxima tarefa é criada ao concluir a atual, contando da data programada ou da execução, conforme a rotina. Dá para pausar e retomar.
- **Acesso:** perfil *Gestão da Casa* (também para administração, pastor e secretaria). Pessoas de fora podem ser responsáveis por tarefas sem ganhar acesso. Prazos vencidos aparecem no menu.

#### Atas de reunião
- **Livro de atas:** Conselho, Diretoria e Assembleia recebem número por tipo e ano ao serem finalizadas (rascunho apagado não deixa buraco). Reuniões de ministério ou equipe são registradas sem número nem aprovação.
- **Fluxo:** rascunho → finalizada → aprovada. Aprovada, a ata fica travada; correções entram como retificação, sem alterar o texto original.
- **Conteúdo:** presentes e ausentes (do cadastro ou nome livre), pauta com discussão e deliberação, encaminhamentos com responsável e prazo, observações e anexos privados (fotos e PDF, incluídos no backup).
- **Encaminhamentos pendentes** de todas as atas numa lista só; os vencidos aparecem no menu.
- **PDF e e-mail:** PDF com o logo e linhas de assinatura; envio pelo SMTP aos presentes com e-mail e a outros endereços, em cópia oculta.
- **Acesso:** permissão *Atas* para administração, pastor e secretaria. As atas de um ministério só aparecem para quem participa dele. Atas **sigilosas** só para pastor e administração. Guia em `/ajuda/atas`.

#### Histórico, Auditoria e Status
- **Histórico:** o que foi projetado pelo tablet e pelo painel, os mais recentes primeiro.
- **Auditoria:** registro de quem alterou o quê (só a Administração vê).
- **Status:** conexão com o Holyrics, agente do PC da igreja e QR codes.

#### Acessos e administração
- **Acessos às escalas:** a Secretaria cria contas para integrantes do louvor e vincula pastores que já têm usuário. Há um QR que abre só o login da Minha escala.
- **Usuários e acessos (`/acessos`):** cada pessoa entra no painel e no tablet com o próprio usuário e senha (guardada só como hash) e pode ter **vários perfis**, somando o que cada um permite. Perfis são editáveis e a mudança vale na hora; o Administrador é travado, para ninguém perder o acesso. Guia em `/ajuda/usuarios`.
- **Administração (`/admin`):** nome da igreja, página inicial, Holyrics, padrões de projeção, chave do mural, agenda do Google, e-mail (SMTP), termo da LGPD, trilhas de devocionais e DiakoPlayer.
- **Backup diário** em `.zip` com dados, cartazes, fotos, anexos e termos (sem senhas nem chaves), restauração pelo `/admin` e, com o servidor na internet, cópia **cifrada** no PC da igreja. Falhas geram alerta no painel e por e-mail.

## Tablet do pastor (app Android)

Opera o telão durante o culto e funciona com a última cópia salva se a internet cair.

- **Coluna do palco:** sempre à direita, em qualquer seção. Mostra a conexão com o Holyrics, o que está no ar, a prévia do recado tocado, anterior, parar e próximo em botões grandes, tela vazia (F9), tela preta (F10), a contagem e as frases prontas do palco. As seções ficam num trilho à esquerda, com o número de pendências.
- **Recados:** projetar com um toque ou passar a **Sequência** dos selecionados sozinha. Expirados vão para uma aba própria.
- **Cartazes:** escolher uma imagem já enviada ou **enviar uma foto do tablet**, que vai direto para o Holyrics.
- **Motivos de oração:** pedidos do site chegam em **Aguardando**, com aviso na hora; o pastor aprova ou recusa. Pedidos particulares (cadeado) nunca vão para o telão. **Projetar motivos** mostra vários por slide, e há um botão para **projetar o QR** do formulário.
- **Orações respondidas:** com data e testemunho (editável); um botão projeta as dos últimos 30 dias.
- **Caixa de mensagens:** mensagens privadas como **Nova**, **Em análise** e **Resolvida**, e o QR de `/mensagens` para projetar.
- **Visitantes:** pendências de boas-vindas, com um toque para projetar "Sejam bem-vindos!".
- **Agenda:** próximos eventos por dia; o pastor projeta um evento ou o transforma em recado. O próximo evento aparece também no topo de Recados.
- **Escala e repertório:** quem serve no culto de hoje (pastoral e louvor) e as músicas escolhidas. Sem culto hoje, mostra o próximo em até 7 dias.
- **Modo Culto:** segunda tela para o horário do culto (botão no trilho, ou o aviso que aparece a partir de 1 h antes do culto da escala). Segue o roteiro do dia: contagem até a hora do culto, boas-vindas aos visitantes, louvor (músicas, tons e escalados, com tela vazia no telão), recados um por vez, dízimos e ofertas (com o QR do PIX quando a chave está configurada), Santa Ceia (quando a escala marca), motivos de oração, Palavra (tela preta, cronômetro da pregação e avisos ao palco), oração final e encerramento com os QR codes e o próximo evento. **Avançar** projeta o próximo passo; pedidos e visitantes que chegam aparecem num canto. O ponto do roteiro fica salvo se o app fechar. Para sair, segure **Sair** (pede o PIN, se houver).
- **Palavra:** **Próximo trecho** passa o texto para a TV do palco, um toque no versículo o projeta no telão e as frases de destaque viram botões. O tempo por tópico aparece só para o pastor.
- **Contagem regressiva** no telão e no palco, além de mensagem no painel de comunicação.
- **Sincronização ao vivo** com o servidor. Sem conexão, mostra a última cópia salva e bloqueia a edição.
- **Rede da igreja:** com o servidor na internet, o tablet pode ser **pareado** com o PC da igreja para falar direto com o Holyrics pelo Wi-Fi. Guia em `/ajuda/rede-local`.

## TVs da igreja
- **Mural de informações (`/mural?chave=…`):** recados, cartazes, aniversariantes, motivos públicos, orações respondidas, agenda e os QR codes. Atualiza sozinho.
- **TV de boas-vindas (`/mural?chave=…&tela=boas-vindas`):** mostra o nome dos visitantes assim que são cadastrados.

## Perfis de acesso

Cada pessoa pode ter vários perfis e pode tudo o que qualquer um deles permite. Os perfis abaixo vêm de fábrica e podem ser ajustados em `/acessos`.

| Perfil | O que faz |
|---|---|
| Administrador | Tudo, inclusive configurações, backup e usuários. |
| Pastor | Todo o conteúdo, inclusive pedidos particulares. Sem configurações técnicas. |
| Secretaria | Recados, agenda, mensagens, membros e visitantes, aniversariantes, encontros e inscrições, atas e acessos às escalas. |
| Mídia | Cartazes, galeria do site, recados e projeção no telão. |
| Telão (tablet) | Operar o telão no culto: recados, pedidos públicos, boas-vindas e projeção. |
| Recepção | Cadastra visitantes pelo celular (`/recepcao`) e vê os do dia. Nada mais. |
| Gestão da Casa | Pendências, compras planejadas e manutenções preventivas. |
| Líder de Casais e Família | Contatos e parabéns de Casais e Família; encontros, inscrições, materiais e roteiros de qualquer ministério; devocionais. Sem acesso às fichas completas. |
| Comissão do Louvor | Monta a escala e as músicas do louvor; vê a escala pastoral e a agenda. |
| Ministro | Escolhe as músicas dos cultos em que ministra e consulta a própria escala. |
| Pregador | Prepara as próprias Palavras no painel e consulta a própria escala. |
| Louvor | Consulta só a própria escala e as músicas dos cultos em que serve. |
| Integrante | Consulta a própria escala e avisa indisponibilidades. |
| DiakoPlayer | Conta do PC do som: o [DiakoPlayer](https://github.com/antunesls/DiakoPlayer) lê as escalas e o repertório para montar a fila do louvor. Não entra no painel. O endereço do controle vai em `/admin › DiakoPlayer` e faz aparecer o botão "Abrir no DiakoPlayer" nas músicas da escala. |

As permissões são verificadas no servidor; o menu só esconde o que a pessoa não pode usar. A tabela completa fica em `/ajuda/usuarios`.

## Privacidade e LGPD
- **Autorização com prova:** link individual (`/autorizar`), termo assinado anexado ou QR, com revogação e termo versionado. Aniversariantes só aparecem para quem autorizou.
- **Autorizações separadas:** a autorização de uso dos dados, a divulgação do aniversário de casamento, o consentimento de contato e a assinatura de devocionais são independentes; uma não substitui a outra.
- **Pedidos particulares** nunca vão para o telão, o mural ou o resumo do WhatsApp.
- **O que não registrar:** saúde, documentos, data de nascimento em inscrições, aconselhamento ou observações íntimas.
- **Excluir um membro** limpa contatos, recibos e vínculos operacionais dele, inclusive acompanhantes sob sua responsabilidade, sem apagar inscrições de outras pessoas.
- **Assinantes externos** de devocionais guardam só e-mail e consentimento, sem virar ficha.
- **Sem pagamentos:** a plataforma não cobra inscrições nem recebe dinheiro.

## Instalação

### Onde roda
- **No PC do Holyrics:** tudo num computador só, acessível na rede da igreja. Instalação em [`server/LEIA-ME.md`](server/LEIA-ME.md); no fim, ele mostra o **endereço** (ex.: `http://192.168.0.10:8080`) e você define a **senha**.
- **Na internet (VPS ou LXC):** o servidor fica num domínio próprio e um **agente** no PC da igreja liga o servidor ao Holyrics. O tablet fala direto com o agente no Wi-Fi da igreja e continua funcionando se a internet cair. Instalação em [`docs/HOSPEDAGEM.md`](docs/HOSPEDAGEM.md).

O jeito mais simples é baixar o pacote pronto em [Releases](https://github.com/antunesls/diakohub/releases) (veja [Publicar uma versão](#publicar-uma-versão-github-releases)).

### App do tablet
1. **Ferramentas (uma vez, no seu PC):** instale o [Flutter](https://docs.flutter.dev/get-started/install/windows/mobile) e o Android Studio e rode `flutter doctor` até ficar tudo verde. No tablet, ative as *Opções do desenvolvedor* e a *Depuração USB*.
2. **Gerar e instalar**, na pasta do projeto:
   ```
   flutter create --org br.diako --platforms android .
   flutter pub get
   dart run flutter_launcher_icons   # ícone do app a partir do logo
   flutter test
   flutter run            # com o tablet conectado por USB
   flutter build apk      # gera build/app/outputs/flutter-apk/app-release.apk
   ```
   O `flutter create .` cria só o que falta na pasta `android/` e mantém o `lib/` e o `AndroidManifest.xml` existentes (o manifesto libera o acesso à rede local). Para instalar sem cabo, envie o `app-release.apk` para o tablet (WhatsApp, Drive) ou baixe o `DiakoHub-*.apk` da última release direto nele.
3. **Primeiro uso:** abra **Configurações** (engrenagem), digite o endereço do servidor e a senha e toque em **Entrar**. Se aparecer `<b>` em volta do título no telão, desligue **Título em negrito**.

## Desenvolvimento
Requisitos: Dart 3.5+ e Flutter (para o app).

```
cd packages/diako_core && dart test          # modelos e regras compartilhados
cd server && dart analyze && dart test       # servidor e agente
cd server && node --test test/*.js           # telas do painel e do site
flutter analyze && flutter test              # app do tablet
```

Para rodar tudo no seu PC com um Holyrics simulado: `powershell -ExecutionPolicy Bypass -File .\tool\rodar_local.ps1`. Mais detalhes em [Para desenvolvedores](server/LEIA-ME.md#para-desenvolvedores). Para diagnosticar a conexão com um Holyrics real: `tool\diagnosticar_holyrics.ps1`.

### Estrutura do repositório

| Pasta | O que é |
|---|---|
| `server/` | Servidor (Dart + shelf): API, site, painel, mural, PDF, backup e o agente do PC da igreja (`bin/diako_agente.dart`). |
| `server/web/` | Páginas do site e do painel (HTML, CSS e JavaScript, sem framework). |
| `server/test/` | Testes do servidor (Dart) e das telas (Node, com DOM simulado). |
| `lib/` | App Android (Flutter) do tablet do pastor. |
| `packages/diako_core/` | Modelos e regras usados pelo app e pelo servidor (recados, motivos, slides, aniversariantes, escalas, repertório, visitantes e roteiros). |
| `docs/` | Hospedagem, propostas e planos de funcionalidades. |
| `tool/` | Scripts: rodar localmente com Holyrics simulado, diagnóstico do Holyrics, chave de assinatura do APK. |

### Estrutura do app
```
lib/
  sync/server_api.dart            REST do servidor (login, recados, motivos, cartazes, Holyrics)
  sync/repo_sincronizado.dart     lista do servidor com cópia local para uso sem conexão
  sync/tempo_real.dart            WebSocket: recarrega quando algo muda no servidor
  holyrics/holyrics_client.dart   comandos do Holyrics (pelo agente na rede local ou pelo servidor)
  data/                           repositórios de recados e motivos, configurações
  ui/                             telas
```

## Publicar uma versão (GitHub Releases)
O GitHub Actions faz tudo. A cada push roda o workflow **CI** (testes do servidor, do pacote compartilhado e do app, mais um APK de teste). Ao enviar uma tag, roda o workflow **Release**:
```
git tag v1.0.0
git push origin v1.0.0
```
Em alguns minutos aparece em **Releases** uma versão com:
- `DiakoServer-1.0.0.zip`: o servidor para o PC do Holyrics (instalar com `instalar.ps1`).
- `DiakoServer-linux-x64-1.0.0.tar.gz`: o servidor para VPS ou LXC (veja [`docs/HOSPEDAGEM.md`](docs/HOSPEDAGEM.md)).
- `DiakoHub-1.0.0.apk`: o app para baixar e instalar no tablet.

**Assinatura do APK (fazer uma vez):** para que cada versão nova instale por cima da anterior, o APK precisa ser assinado sempre com a mesma chave.
1. Rode `powershell -ExecutionPolicy Bypass -File .\tool\gerar_keystore.ps1` (precisa do Android Studio ou de um JDK).
2. Cadastre os 4 secrets que ele mostra em **Settings › Secrets and variables › Actions**.
3. Guarde o arquivo `.jks` e a senha em lugar seguro. Se perder, o app terá de ser desinstalado e instalado de novo.

Sem os secrets, a release sai assinada com uma chave temporária. Funciona, mas cada atualização exige desinstalar o app antes.

## Nomes técnicos
O sistema se chamava **DiakoNews**. Alguns nomes internos continuam assim para não exigir reinstalação: o serviço `diako-news` e a pasta `/opt/diako-news` no servidor, a pasta `C:\DiakoNews` e as tarefas do Windows no PC da igreja, a pasta de mídia `DiakoNews/` no Holyrics e os pacotes `diako_core` e `diako_server`.
