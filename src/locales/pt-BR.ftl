### Ariane — português do Brasil.
### Uma primeira tradução, que merece a revisão de um falante nativo.
###
### Formato: Project Fluent (https://projectfluent.org). Veja en.ftl, a
### referência: as mesmas mensagens, as mesmas { $variables }.

language-name = Português (Brasil)

## Teclas, como aparecem impressas nos teclados deste idioma

key-ctrl = Ctrl
key-alt = Alt
key-esc = Esc

## A moldura da janela

splash-hide = Não mostrar esta tela ao iniciar
splash-continue = Continuar
sidebar =
    .aria-label = Pastas e conversas
home-button = Ariane
    .title = Voltar à página inicial (Esc)
settings-button =
    .title = Configurações: onde encontrar cada assistente
    .aria-label = Abrir as configurações
refresh-button =
    .title = Reindexar (Ctrl+R)
    .aria-label = Reindexar as conversas
folder-filter =
    .placeholder = Filtrar pastas…
    .aria-label = Filtrar pastas e conversas
agent-filter =
    .aria-label = Assistentes exibidos
agents-show-all = Mostrar todos
    .title = Exibir todos os assistentes novamente
tree =
    .aria-label = Árvore de conversas
tree-loading = Carregando…
outline =
    .aria-label = Suas mensagens nesta conversa

## A página inicial

welcome-title = Suas conversas anteriores
welcome-lead = Escolha uma pasta à esquerda ou pesquise direto na barra abaixo.
welcome-key-search = pesquisar
welcome-key-find = na conversa
welcome-key-own = suas mensagens
welcome-key-reindex = reindexar
welcome-key-home = início

## A lista de pastas

tree-no-data = Nenhuma pasta do Claude Code encontrada em { $dir }.
tree-no-match = Nenhuma pasta corresponde.
tree-empty = Nenhuma conversa.
folder-purged-note = (transcrições apagadas — só os prompts)
folder-approximate-note = (caminho aproximado — reconstruído a partir do nome da pasta)
session-untitled = Sem título
session-badge-saved = salva
    .title = O arquivo original sumiu: Ariane guarda a única cópia
session-badge-prompts = prompts
    .title = Transcrição apagada: só restam os seus prompts
session-summary = { $when } · { $count ->
        [one] { $count } mensagem
       *[other] { $count } mensagens
    }

session-tokens = ↑ { $sent } · ↓ { $received }
    .title =
        Enviados: { $sentExact } tokens novos nos prompts
        Recebidos: { $receivedExact } tokens
session-tokens-cached = ↑ { $sent } · ↓ { $received } · cache { $cached }
    .title =
        Enviados: { $sentExact } tokens novos nos prompts
        Recebidos: { $receivedExact } tokens
        Relidos do cache: { $cachedExact } tokens, o contexto reenviado a cada turno

## O rodapé da coluna, e a indexação

stats = { $folders ->
        [one] { $folders } pasta
       *[other] { $folders } pastas
    } · { $sessions ->
        [one] { $sessions } conversa
       *[other] { $sessions } conversas
    } · { $messages ->
        [one] { $messages } mensagem
       *[other] { $messages } mensagens
    }
stats-indexing = indexando { $done }…
stats-indexing-agent = { $agent } · indexando { $done }…
refresh-done = Indexação concluída — { $details }.
refresh-up-to-date = Índice já atualizado.
refresh-read = { $n ->
        [one] { $n } transcrição lida
       *[other] { $n } transcrições lidas
    }
refresh-orphans = { $n ->
        [one] { $n } recuperada do histórico
       *[other] { $n } recuperadas do histórico
    }
refresh-saved = { $n ->
        [one] { $n } conversa salva
       *[other] { $n } conversas salvas
    }
refresh-restored = { $n ->
        [one] { $n } conversa restaurada
       *[other] { $n } conversas restauradas
    }
refresh-errors = { $n ->
        [one] { $n } erro
       *[other] { $n } erros
    }
auto-saved = { $n ->
        [one] Ariane salvou { $n } conversa cujo arquivo original desapareceu.
       *[other] Ariane salvou { $n } conversas cujos arquivos originais desapareceram.
    }

## Uma conversa aberta

convo-empty = Esta conversa não tem nenhuma mensagem que possa ser exibida.
convo-not-found = Conversa não encontrada.
convo-message-count = { $n ->
        [one] { $n } mensagem
       *[other] { $n } mensagens
    }
convo-part = Parte { $n } de { $total }
    .title = Esta conversa foi compactada: ela continua em outra transcrição
convo-part-previous =
    .title = Parte anterior
    .aria-label = Ir para a parte anterior
convo-part-next =
    .title = Próxima parte
    .aria-label = Ir para a próxima parte
convo-purged = transcrição apagada
convo-saved = salva por Ariane: o arquivo original sumiu
speaker-you = Você
order-button =
    .title = Inverter a ordem das mensagens
order-newest = Mais recentes no topo
order-oldest = Mais antigas no topo
export-button = Exportar
    .title = Salvar esta conversa em um arquivo
export-markdown = Markdown (.md)
export-pdf = PDF (.pdf)
copy-command-button = Copiar
    .title = Copiar o comando para retomar
open-folder-button = Abrir a pasta
folder-gone = Esta pasta não existe mais no disco.
forget-button = Esquecer
    .title = Apagar definitivamente a cópia que Ariane guarda desta conversa
forget-confirm = Esquecer definitivamente?
forget-done = Conversa esquecida: Ariane não guarda mais nada dela.
export-preparing-pdf = Preparando o PDF…
export-done = Exportado: { $path }
message-copy = Copiar esta mensagem
message-copied = Mensagem copiada

## Dentro de uma mensagem

part-thinking = Raciocínio
part-tool = Ferramenta
part-result = Resultado
part-error = erro
part-pasted = Colado
part-pasted-lines = { $n ->
        [one] { $n } linha
       *[other] { $n } linhas
    }
part-image = Imagem
part-document = Documento
part-empty = (vazio)
tool-run-calls = { $n ->
        [one] { $n } chamada de ferramenta
       *[other] { $n } chamadas de ferramentas
    }
tool-run-results = { $n ->
        [one] { $n } resultado
       *[other] { $n } resultados
    }
tool-run-attachments = { $n ->
        [one] { $n } anexo
       *[other] { $n } anexos
    }
tool-errors = { $n ->
        [one] { $n } erro
       *[other] { $n } erros
    }
tool-summary-named = { $summary }: { $names }
tool-summary-errors = { $summary } — { $errors }

## Avisos: quem fala é a ferramenta ou o ambiente, não a pessoa nem o assistente

notice-away-summary = Resumo da sessão
notice-compact-boundary = Conversa compactada
notice-failure = Falha
notice-cancelled = Solicitação cancelada
notice-subagent = Subagente
notice-generic = Aviso

## Pesquisar na conversa aberta

find-input =
    .placeholder = Pesquisar nesta conversa…
    .aria-label = Pesquisar nesta conversa
find-count =
    .title = A mensagem encontrada, entre todas as que contêm este texto
find-none = nenhuma
find-previous =
    .title = Anterior (Shift+Enter)
    .aria-label = Ocorrência anterior
find-next =
    .title = Próxima (Enter)
    .aria-label = Próxima ocorrência
find-close =
    .title = Fechar (Esc)
    .aria-label = Fechar a pesquisa

## Retomar uma conversa no próprio terminal

resume-button = Retomar
resume-button-latest = Retomar (última)
resume-opens = Abre um terminal: { $command }
resume-note-latest-only = O Gemini só consegue retomar por índice ou por “latest”, não por id.
resume-note-unsupported = O VS Code não permite reabrir uma conversa; só a pasta dela pode ser aberta.
resume-opened = Terminal aberto ({ $terminal }).
resume-opened-settings-ignored = Terminal aberto ({ $terminal }), sem seguir as configurações: { $problem }
resume-no-terminal = Nenhum terminal encontrado.
resume-folder-missing = A pasta desta conversa não existe mais.
resume-command-not-found = Ariane não encontra “{ $command }” neste computador.
resume-setting-not-absolute = Configurações: o caminho de “{ $command }” deve ser absoluto ({ $path }).
resume-setting-unusable = Configurações: { $path } não é um programa.
resume-interpreter-not-found = “{ $command }” precisa de “{ $interpreter }”, que não foi encontrado.
resume-failed = Não foi possível abrir um terminal ({ $reason }).
resume-failed-copied = { $reason } Comando copiado.
command-copied = Comando copiado.
open-settings-action = Abrir as configurações

## A barra de pesquisa

results =
    .aria-label = Resultados da pesquisa
search-input =
    .placeholder = Pesquisar nas suas conversas…
    .aria-label = Pesquisar nas conversas
scope-select =
    .aria-label = Escopo da pesquisa
    .title = Onde pesquisar
scope-all = Em todo lugar
scope-folder = Pasta: { $name }
scope-folder-current = Pasta: atual
scope-session = Esta conversa
period-select =
    .aria-label = Período da pesquisa
    .title = Quando
period-all = Qualquer data
period-7d = Últimos 7 dias
period-30d = Últimos 30 dias
period-year = Este ano
results-count = { $n ->
        [one] { $n } resultado
       *[other] { $n } resultados
    }
results-none = Nenhum resultado.
results-none-7d = Nenhum resultado nos últimos 7 dias.
results-none-30d = Nenhum resultado nos últimos 30 dias.
results-none-year = Nenhum resultado este ano.

## A janela de configurações

settings-title = Configurações
settings-lead = Onde encontrar o comando de cada assistente, para “Retomar”. Deixe um caminho vazio para que Ariane o procure sozinha.
settings-language = Idioma
settings-language-auto = Automático — { $language }
settings-language-select =
    .aria-label = Idioma do app
settings-theme = Tema
settings-theme-select =
    .aria-label = Tema de cores do aplicativo
settings-theme-auto = Sistema
settings-theme-light = Claro
settings-theme-dark = Escuro
settings-updates = Atualizações
settings-updates-select =
    .aria-label = Se o Ariane pode perguntar se existe uma versão mais recente
settings-updates-never = Nunca perguntar
settings-updates-startup = Ao iniciar
update-available = Ariane { $version } está disponível.
update-open = Ver a versão
update-close =
    .aria-label = Dispensar
settings-add = Adicionar assistente
settings-add-menu =
    .aria-label = Assistentes para adicionar
settings-open-json = Abrir o arquivo JSON
settings-cancel = Cancelar
settings-save = Salvar
settings-sessions = { $n ->
        [0] nenhuma conversa
        [one] { $n } conversa
       *[other] { $n } conversas
    }
settings-detected = Encontrado: { $path }
settings-not-detected = A busca automática não o encontra.
settings-path-label = Caminho a usar
settings-path-input =
    .placeholder = Vazio: Ariane procura sozinha
    .aria-label = Caminho a usar para { $agent }
settings-browse = Procurar…
    .aria-label = Procurar o programa de { $agent }
settings-check-pending = Verificando…
settings-check-chosen = Usado como está: { $path }
settings-check-detected = Ariane vai usar: { $path }
settings-check-not-found = Não encontrado neste computador: informe o caminho.
settings-check-not-absolute = O caminho deve ser absoluto.
settings-check-unusable = { $path } não é um programa.
settings-check-interpreter = Encontrado, mas precisa de “{ $interpreter }”, que não foi encontrado.
settings-check-refused = Caminho recusado: { $detail }.
settings-unreadable = Não é possível ler o arquivo de configurações ({ $error }). Ariane não vai reescrevê-lo: abra-o para corrigi-lo.
settings-saved = Configurações salvas.
settings-opened = Configurações abertas no seu editor.
settings-opened-at = Configurações: { $path }
settings-opened-unreadable = Configurações abertas, mas não é possível lê-las: { $error }

## Estrelas e notas: as marcas que você mesmo põe em uma conversa

mark-favorite = Marcar como favorita
mark-favorite-on = Nos favoritos — clique para remover
mark-message = Marcar esta mensagem como favorita
mark-message-on = Nos favoritos — clique para remover
mark-note = Nota
    .title = Escrever uma nota sobre esta conversa
mark-note-input =
    .placeholder = Por que esta importa…
    .aria-label = Nota sobre esta conversa
mark-note-saved = Nota salva
favorites-view = Favoritos
    .title = Todas as conversas que você marcou como favoritas
favorites-conversations = Conversas
favorites-messages = Mensagens
favorites-quote = “{ $text }”
favorites-empty = Ainda não há favoritos. A estrela, no topo de uma conversa, guarda ela aqui.
error-marks-unreadable = Não é possível ler o arquivo de favoritos e notas, então nada foi gravado: { $error }

## O próprio arquivo de configurações: escrito no início do settings.json, para quem o abrir

settings-file-intro = Onde Ariane encontra o comando de cada assistente, para “Retomar”.
settings-file-detected = “detected”: o que Ariane encontrou sozinha. Atualizado sempre que este arquivo é aberto.
settings-file-command = “command”: deixe vazio para que Ariane procure; coloque um caminho absoluto para impor esse caminho.
settings-file-example = Exemplo, para o codex: { $example }
settings-file-paths = ~ representa a sua pasta pessoal.
settings-file-paths-windows = Escreva os caminhos com barras normais /. %APPDATA% e ~ são reconhecidos.
settings-file-language = “language”: “auto” para seguir o sistema, ou um código de idioma como “pt-BR” ou “en”.
settings-file-theme = “theme”: “auto” para seguir o sistema, ou “light” ou “dark”.

## Erros que o app informa

error-forget-not-saved = Só uma conversa salva por Ariane pode ser esquecida: as outras ficam nos arquivos do seu assistente.
error-message-not-found = Mensagem não encontrada.
error-resume-impossible = Esta conversa não pode ser retomada ({ $reason }).
error-settings-unreadable = Não é possível ler as configurações, então nada foi gravado: { $error }
browse-title = Onde está { $agent }?

## Exportações: uma conversa gravada em um arquivo Markdown ou impressa em PDF

export-dialog-title = Exportar a conversa
export-file-name = conversa
export-field = { $label }: { $value }
export-field-assistant = Assistente
export-field-folder = Pasta
export-field-branch = Branch
export-field-period = Período
export-field-messages = Mensagens
export-period = de { $from } a { $to }
export-order-newest = da mais recente para a mais antiga
export-order-oldest = da mais antiga para a mais recente
export-messages = { $count }, { $order }
export-saved = Salva por Ariane: o arquivo original sumiu.
export-footer = Exportado com Ariane.
export-footer-at = Exportado com Ariane em { $date }.
