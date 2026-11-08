# Investigation Board — extensão para Owlbear Rodeo

Versão 0.4.2. Quadro de investigação compartilhado, com navegação por câmera, documentos, anotações e conexões.

## Novidades da versão 0.4.2

- Texto das anotações com renderização mais nítida, fonte maior e peso reforçado.
- Notificações reposicionadas abaixo das barras de ferramentas.

- Tipografia manuscrita Kalam nas anotações, inspirada na referência visual enviada.
- Removidos os pinos das anotações.
- Texturas de papel mais detalhadas no papiro e nos post-its.
- Melhorias de legibilidade, suavização e tamanho do texto das anotações.

## Novidades da versão 0.4.0

- Até três quadros independentes por sala, com título, criação por jogadores e exclusão reservada ao mestre.
- Conexões existentes podem ter cor e estilo substituídos sem desconectar os cartões.
- Jogadores podem remover conexões e usar desfazer/refazer nas próprias alterações locais.
- Correção da aplicação das cores SVG das conexões.
- Seis aparências de anotação: papiro, caderno pautado e post-its rosa, amarelo, laranja e azul.
- Controles de anotação aparecem ao passar o mouse (e permanecem acessíveis em telas touch).
- Documentos e anotações são limitados aos limites do quadro; migração automática do formato 0.3.x.

## Novidades da versão 0.3.2

- Removidas categorias, controles de categoria e filtro por categoria. A barra de pesquisa continua disponível.
- Anotações agora são texto puro, sem título ou categoria.
- Anotações podem ser redimensionadas pelos botões − e ＋, com largura entre 220 e 650 px e texto proporcional.
- Documentos respeitam a proporção original da imagem e têm largura inicial entre 320 e 420 px para manter os controles utilizáveis.
- Corrigida a captura de ponteiro no modo de conexão: o viewport não captura mais o clique iniciado sobre um cartão, permitindo selecionar os dois pontos da conexão.
- Removida a mensagem inicial que ensinava os controles; a extensão não exibe tutorial de uso.
- Documentos novos passam a abrir com largura de 320 a 420 px; documentos antigos são ampliados uma única vez na migração para a versão 0.3.2.
- Anotações passam a usar texto maior e largura inicial de 300 px, com ampliação proporcional.
- Quadro reduzido para 2400 × 1500 px, em formato horizontal.
- Camada SVG de conexões fica acima dos cartões no modo de exclusão, e o viewport deixa de capturar o ponteiro sobre a linha selecionada.

## Recursos mantidos

- Zoom com scroll do mouse/trackpad, pinça de dois dedos e botões na tela.
- Navegação pelo quadro arrastando uma área vazia; arrastar cartões continua movendo cartões.
- Layout adaptável a computador, tablet e celular.
- Conexões com cor e estilo configuráveis.
- Bloqueio/desbloqueio individual de cartões.
- Histórico local de desfazer/refazer (até 60 alterações por sessão/cliente); é reiniciado quando chegam alterações remotas para evitar desfazer por cima de trabalho de outro participante.
- Exportação e importação de uma investigação em JSON.
- Cópia local automática por sala para recuperação no mesmo navegador.
- Sincronização por item e compatibilidade de leitura com dados da versão 0.2.x e 0.3.0.

## Controles

- **Scroll / roda do mouse:** aproximar e afastar o quadro no ponto do cursor.
- **Pinça com dois dedos:** zoom em celular/tablet.
- **Arrastar uma área vazia:** mover a câmera do quadro.
- **Arrastar um cartão:** mover o cartão.
- **＋ / − / ⟲:** zoom e redefinição da visualização.
- **＋ / − na anotação:** aumentar ou diminuir a largura e o tamanho do texto.
- **🔒 / 🔓:** bloquear ou desbloquear um cartão.
- **Desfazer / Refazer:** reverter alterações feitas nesta sessão local.
- **Exportar / Importar:** criar ou restaurar uma cópia JSON.

## Armazenamento e sincronização: limitações importantes

O Owlbear documenta um limite total de 16 KB para os metadados da sala. A extensão interrompe a gravação da própria estrutura quando ela passa de aproximadamente 13,5 KB, para deixar margem ao restante dos metadados. Isso inclui URLs de imagens e demais dados dos cartões.

A versão 0.3.0 **não remove esse limite**. Para armazenar investigações muito grandes será necessário integrar um backend/serviço externo com autenticação e regras de acesso. Exportar JSON e a cópia local por sala ajudam na recuperação, mas não aumentam o armazenamento compartilhado.

A sincronização agora mescla alterações por item e resolve conflitos simples pela data/hora de atualização, usando o identificador do cliente como desempate. Isso reduz a chance de uma edição independente apagar outra, mas não equivale a um banco de dados transacional: duas alterações simultâneas no mesmo cartão ainda precisam de uma regra de conflito mais sofisticada.

O histórico de desfazer/refazer é local ao navegador/cliente. Ao desfazer, a versão restaurada é compartilhada com a sala; o histórico em si não é sincronizado entre participantes.

Os controles de exclusão são ocultados para jogadores e o código verifica o papel antes de executar a ação. Como a extensão usa metadados compartilhados da sala, isso é uma proteção de interface e lógica no cliente, não uma barreira de segurança de servidor contra um cliente modificado. Para permissões fortes seria necessário um backend que valide cada operação.

## Requisitos e desenvolvimento

- Node.js 18 ou superior.
- Sala do Owlbear Rodeo para testes de integração.
- Hospedagem HTTPS para publicar a extensão.

```bash
npm install
npm run dev
```

O Vite normalmente disponibiliza `http://localhost:5173/manifest.json`. Adicione esse endereço no gerenciador de extensões do Owlbear para testar.

Para gerar os arquivos de publicação:

```bash
npm run build
```

Publique o conteúdo da pasta `dist/` em um host estático HTTPS.

## Estrutura

- `public/manifest.json`: manifesto do Owlbear.
- `public/icon.svg`: ícone.
- `index.html`: janela de abertura.
- `board.html`: interface do quadro.
- `src/launcher.js`: abertura do modal.
- `src/board.js`: cartões, câmera, conexões, histórico, armazenamento e sincronização.
- `src/style.css`: aparência e adaptação responsiva.

## Testes ainda necessários

A sintaxe JavaScript foi verificada estaticamente. A integração final precisa ser testada dentro do Owlbear em navegador desktop e em dispositivos móveis reais, especialmente: seletor de imagens Notes, permissões de mestre/jogador, sincronização com dois clientes, gesto de pinça, rolagem do trackpad e limites de metadados.


## Versão 0.4.3

- Barra de ferramentas responsiva para Android e telas estreitas.
- Botão de saída fixo e sempre visível, fora da faixa de rolagem dos controles.
- Controles reorganizados em duas colunas com alvos de toque maiores.
