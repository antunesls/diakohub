# Coleções para TV e telão

Abra **Painel → Cartazes → Coleções para TV e telão**, ou `/temas.html` no endereço do servidor. A Administração também tem um atalho na área de artes dos QR codes.

## Coleções e formatos

- **Luz e presença:** azul profundo e arcos dourados.
- **Águas tranquilas:** verde-petróleo, água e formas suaves.
- **Aliança:** vinho profundo e círculos em cobre.

Cada coleção oferece 11 aplicações: boas-vindas, aviso, agenda, oração, visitantes, ofertas, versículo/Palavra, fundo de louvor e fundos para os QR de oração, mensagens e PIX. São **66 combinações** com os formatos:

| Destino | Proporção | PNG |
|---|---|---|
| TV | 16:9 | 1920 × 1080 |
| Projetor | 4:3 | 1440 × 1080 |

O fundo é decorativo e se adapta à tela. Logo e textos são compostos separadamente nas coordenadas de cada formato, sem esticar letras nem o logo. O logo oficial claro vem de `server/web/logo-claro.png`. Os três fundos sem texto estão em `server/web/temas/`.

## Preparar uma arte

1. Escolha coleção, destino e tipo de arte.
2. Substitua os textos de exemplo; nenhum horário ou evento é inventado pela biblioteca.
3. Confira a prévia. Textos longos diminuem até caber; se não couberem, encurte-os.
4. Baixe o PNG individual ou, com a permissão **Cartazes**, use **Adicionar a Cartazes** e confirme. A biblioteca reutiliza o envio de imagens existente e não altera a galeria de fotos do site.

**Baixar sem texto** mantém apenas o fundo e o logo, se marcado. No **Fundo de louvor**, nunca há letras fixas: baixe o PNG e importe-o manualmente como fundo de um tema no Holyrics. A criação/configuração de temas nativos, fontes das letras e margens no Holyrics continua sendo feita no próprio programa.

## QR codes reais

- A área branca da prévia é somente uma indicação de posição, não um QR code.
- O PNG baixado é um **fundo sem código**, não deve ser usado como QR funcional.
- Para usar o código real, entre com a permissão **Administração**, selecione a aplicação de QR e clique em **Aplicar ao QR do telão**. A confirmação identifica coleção e formato.
- O servidor usa os endereços já configurados de oração/mensagens e os dados reais de PIX. Para PIX, chave, nome e cidade precisam estar preenchidos.
- Cada tipo de QR mantém **uma arte ativa**, não uma arte para cada dispositivo ao mesmo tempo. A aplicação substitui a anterior; o editor administrativo continua oferecendo **Voltar ao padrão**.
- A TV/mural continua com seu fluxo de QR público existente. A biblioteca não muda a aparência das TVs automaticamente. Cartazes exportados em 16:9 podem ser usados pelo fluxo de recados/cartazes já existente.

Os fundos 4:3 enviados são preservados em 1440 × 1080 pelo servidor. Imagens de outras proporções continuam normalizadas para 1920 × 1080. O QR real preserva módulos inteiros e margem branca e é composto depois da arte, sem depender da geração de imagens.

A biblioteca envia imagem, posição, tamanho e layout juntos na operação de envio já existente. Se a resposta se perder, ela orienta conferir a Administração e não restaura isoladamente uma geometria antiga. Fotos do editor automático mantêm o formato legado 16:9.

## Segurança e publicação

Prévia e download local funcionam sem login; não há dados privados na biblioteca. As ações de servidor exigem sessão e as permissões existentes. Nada é publicado, aplicado ou projetado automaticamente ao abrir a página. Nenhuma API de criação automática de tema nativo do Holyrics foi adicionada.

Para disponibilizar a biblioteca em outra instalação, publique a pasta `server/web` completa, incluindo `temas/`, e atualize/reinicie o servidor com o suporte a QR 4:3. Teste o contraste e a leitura no equipamento físico antes do culto.
