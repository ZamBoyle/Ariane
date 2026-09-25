### Ariane — español.
### Una primera traducción, que merece la revisión de un hablante nativo.
###
### Formato: Project Fluent (https://projectfluent.org). Véase en.ftl, la
### referencia: los mismos mensajes, las mismas { $variables }.

language-name = Español

## Teclas, tal como aparecen en los teclados de este idioma

key-ctrl = Ctrl
key-alt = Alt
key-esc = Esc

## El marco de la ventana

splash-hide = No mostrar esta pantalla al iniciar
splash-continue = Continuar
sidebar =
    .aria-label = Carpetas y conversaciones
home-button = Ariane
    .title = Volver al inicio (Esc)
settings-button =
    .title = Ajustes: dónde encontrar cada asistente
    .aria-label = Abrir los ajustes
refresh-button =
    .title = Reindexar (Ctrl+R)
    .aria-label = Reindexar las conversaciones
folder-filter =
    .placeholder = Filtrar carpetas…
    .aria-label = Filtrar carpetas y conversaciones
agent-filter =
    .aria-label = Asistentes mostrados
agents-show-all = Mostrar todos
    .title = Volver a mostrar todos los asistentes
tree =
    .aria-label = Árbol de conversaciones
tree-loading = Cargando…
outline =
    .aria-label = Tus mensajes en esta conversación

## La página de inicio

welcome-title = Tus conversaciones anteriores
welcome-lead = Elige una carpeta a la izquierda, o busca directamente en la barra de abajo.
welcome-key-search = buscar
welcome-key-find = en la conversación
welcome-key-own = tus mensajes
welcome-key-reindex = reindexar
welcome-key-home = inicio

## La lista de carpetas

tree-no-data = No se encontró ninguna carpeta de Claude Code en { $dir }.
tree-no-match = Ninguna carpeta coincide.
tree-empty = No hay conversaciones.
folder-purged-note = (transcripciones eliminadas — solo prompts)
folder-approximate-note = (ruta aproximada — reconstruida a partir del nombre de la carpeta)
session-untitled = Sin título
session-badge-saved = guardada
    .title = El archivo original ya no existe: Ariane conserva la única copia
session-badge-prompts = prompts
    .title = Transcripción eliminada: solo quedan tus prompts
session-summary = { $when } · { $count ->
        [one] { $count } mensaje
       *[other] { $count } mensajes
    }

session-models = { $model } +{ $more }
session-tokens = ↑ { $sent } · ↓ { $received }
    .title =
        Enviados: { $sentExact } tokens nuevos en los prompts
        Recibidos: { $receivedExact } tokens
session-tokens-cached = ↑ { $sent } · ↓ { $received } · caché { $cached }
    .title =
        Enviados: { $sentExact } tokens nuevos en los prompts
        Recibidos: { $receivedExact } tokens
        Releídos de la caché: { $cachedExact } tokens, el contexto reenviado en cada turno
session-tokens-subagents = { $count ->
    [one] Además, su subagente: { $sent } enviados, al menos { $received } recibidos, { $cached } releídos de la caché
   *[other] Además, sus { $count } subagentes: { $sent } enviados, al menos { $received } recibidos, { $cached } releídos de la caché
}

## El pie de la columna, y la indexación

stats = { $folders ->
        [one] { $folders } carpeta
       *[other] { $folders } carpetas
    } · { $sessions ->
        [one] { $sessions } conversación
       *[other] { $sessions } conversaciones
    } · { $messages ->
        [one] { $messages } mensaje
       *[other] { $messages } mensajes
    }
stats-indexing = indexando { $done }…
stats-indexing-agent = { $agent } · indexando { $done }…
refresh-done = Indexación terminada — { $details }.
refresh-up-to-date = El índice ya está al día.
refresh-read = { $n ->
        [one] { $n } transcripción leída
       *[other] { $n } transcripciones leídas
    }
refresh-orphans = { $n ->
        [one] { $n } recuperada del historial
       *[other] { $n } recuperadas del historial
    }
refresh-saved = { $n ->
        [one] { $n } conversación guardada
       *[other] { $n } conversaciones guardadas
    }
refresh-restored = { $n ->
        [one] { $n } conversación restaurada
       *[other] { $n } conversaciones restauradas
    }
refresh-errors = { $n ->
        [one] { $n } error
       *[other] { $n } errores
    }
auto-saved = { $n ->
        [one] Ariane guardó { $n } conversación cuyo archivo original desapareció.
       *[other] Ariane guardó { $n } conversaciones cuyos archivos originales desaparecieron.
    }

## Una conversación abierta

convo-empty = Esta conversación no contiene ningún mensaje que se pueda mostrar.
convo-not-found = Conversación no encontrada.
convo-id =
    .title = El identificador de esta conversación: el que usa su asistente para reanudarla
convo-tokens = ↑ { $sent } enviados · ↓ { $received } recibidos
    .title =
        Enviados: { $sentExact } tokens nuevos en los prompts
        Recibidos: { $receivedExact } tokens
convo-tokens-cached = ↑ { $sent } enviados · ↓ { $received } recibidos · { $cached } releídos de la caché
    .title =
        Enviados: { $sentExact } tokens nuevos en los prompts
        Recibidos: { $receivedExact } tokens
        Releídos de la caché: { $cachedExact } tokens, el contexto reenviado en cada turno
convo-branch =
    .title = Rama de git
convo-span =
    .title =
        Primer mensaje: { $start }
        Último mensaje: { $end }
convo-duration =
    .title = Tiempo del primer mensaje al último
convo-message-count = { $n ->
        [one] { $n } mensaje
       *[other] { $n } mensajes
    }
convo-part = Parte { $n } de { $total }
    .title = Esta conversación continúa en otra transcripción: compactada, reanudada o duplicada
convo-part-previous =
    .title = Parte anterior
    .aria-label = Ir a la parte anterior
convo-part-next =
    .title = Parte siguiente
    .aria-label = Ir a la parte siguiente
convo-copied = { $count ->
    [one] Esta conversación empezó copiando un mensaje de «{ $title }»: se lee allí y no se repite aquí.
   *[other] Esta conversación empezó copiando { $count } mensajes de «{ $title }»: se leen allí y no se repiten aquí.
}
convo-copied-open = Abrir el original
convo-subagent = Subagente lanzado desde «{ $title }»
convo-subagent-open = Abrir la conversación que lo lanzó
convo-subagents = { $count ->
    [one] Un subagente lanzado desde esta conversación
   *[other] { $count } subagentes lanzados desde esta conversación
}
subagent-received = ↓ al menos { $received }
usage-floor = La transcripción de un subagente no siempre guarda su último recuento: estas cifras son un mínimo.
convo-purged = transcripción eliminada
convo-saved = guardada por Ariane: el archivo original ya no existe
speaker-you = Tú
order-button =
    .title = Invertir el orden de los mensajes
order-newest = Más recientes arriba
order-oldest = Más antiguos arriba
export-button = Exportar
    .title = Guardar esta conversación en un archivo
export-markdown = Markdown (.md)
export-pdf = PDF (.pdf)
copy-command-button = Copiar
    .title = Copiar el comando para reanudar
open-folder-button = Abrir la carpeta
    .title = Abrir esta carpeta en el gestor de archivos
folder-gone = Esta carpeta ya no existe en el disco.
forget-button = Olvidar
    .title = Borrar definitivamente la copia que Ariane guarda de esta conversación
forget-confirm = ¿Olvidar definitivamente?
forget-done = Conversación olvidada: Ariane ya no guarda nada de ella.
export-preparing-pdf = Preparando el PDF…
export-done = Exportado: { $path }
message-copy = Copiar este mensaje
message-copied = Mensaje copiado

## Dentro de un mensaje

part-thinking = Razonamiento
part-tool = Herramienta
part-result = Resultado
part-error = error
part-pasted = Pegado
part-pasted-lines = { $n ->
        [one] { $n } línea
       *[other] { $n } líneas
    }
part-image = Imagen
part-document = Documento
part-empty = (vacío)
tool-run-calls = { $n ->
        [one] { $n } llamada a herramienta
       *[other] { $n } llamadas a herramientas
    }
tool-run-results = { $n ->
        [one] { $n } resultado
       *[other] { $n } resultados
    }
tool-run-attachments = { $n ->
        [one] { $n } adjunto
       *[other] { $n } adjuntos
    }
tool-errors = { $n ->
        [one] { $n } error
       *[other] { $n } errores
    }
tool-summary-named = { $summary }: { $names }
tool-summary-errors = { $summary } — { $errors }

## Avisos: habla la herramienta o el entorno, no la persona ni el asistente

notice-away-summary = Resumen de la sesión
notice-compact-boundary = Conversación compactada
notice-failure = Fallo
notice-cancelled = Solicitud cancelada
notice-subagent = Subagente
notice-generic = Aviso

## Buscar en la conversación abierta

find-input =
    .placeholder = Buscar en esta conversación…
    .aria-label = Buscar en esta conversación
find-count =
    .title = El mensaje encontrado, de entre todos los que contienen este texto
find-none = ninguno
find-previous =
    .title = Anterior (Mayús+Entrar)
    .aria-label = Coincidencia anterior
find-next =
    .title = Siguiente (Entrar)
    .aria-label = Coincidencia siguiente
find-close =
    .title = Cerrar (Esc)
    .aria-label = Cerrar la búsqueda

## Reanudar una conversación en su propio terminal

resume-button = Reanudar
resume-button-latest = Reanudar (última)
resume-opens = Abre un terminal: { $command }
resume-note-latest-only = Gemini solo puede reanudar por índice o «latest», no por id.
resume-note-unsupported = VS Code no permite volver a abrir una conversación; solo se puede abrir su carpeta.
resume-opened = Terminal abierto ({ $terminal }).
resume-opened-settings-ignored = Terminal abierto ({ $terminal }), sin seguir los ajustes: { $problem }
resume-no-terminal = No se encontró ningún terminal.
resume-folder-missing = La carpeta de esta conversación ya no existe.
resume-command-not-found = Ariane no encuentra «{ $command }» en este equipo.
resume-setting-not-absolute = Ajustes: la ruta de «{ $command }» debe ser absoluta ({ $path }).
resume-setting-unusable = Ajustes: { $path } no es un programa.
resume-interpreter-not-found = «{ $command }» necesita «{ $interpreter }», que no se encuentra.
resume-failed = No se pudo abrir un terminal ({ $reason }).
resume-failed-copied = { $reason } Comando copiado.
command-copied = Comando copiado.
open-settings-action = Abrir los ajustes

## La barra de búsqueda

results =
    .aria-label = Resultados de la búsqueda
search-input =
    .placeholder = Buscar en tus conversaciones…
    .aria-label = Buscar en las conversaciones
scope-select =
    .aria-label = Ámbito de la búsqueda
    .title = Dónde buscar
scope-all = En todas partes
scope-folder = Carpeta: { $name }
scope-folder-current = Carpeta: actual
scope-session = Esta conversación
period-select =
    .aria-label = Periodo de búsqueda
    .title = Cuándo
period-all = Cualquier fecha
period-7d = Últimos 7 días
period-30d = Últimos 30 días
period-year = Este año
results-count = { $n ->
        [one] { $n } resultado
       *[other] { $n } resultados
    }
results-none = Sin resultados.
results-none-7d = Sin resultados en los últimos 7 días.
results-none-30d = Sin resultados en los últimos 30 días.
results-none-year = Sin resultados este año.

## La ventana de ajustes

settings-title = Ajustes
settings-lead = Dónde encontrar el comando de cada asistente, para «Reanudar». Deja una ruta vacía para que Ariane la busque por sí misma.
settings-language = Idioma
settings-language-auto = Automático — { $language }
settings-language-select =
    .aria-label = Idioma de la aplicación
settings-theme = Tema
settings-theme-select =
    .aria-label = Tema de color de la aplicación
settings-theme-auto = Sistema
settings-theme-light = Claro
settings-theme-dark = Oscuro
settings-updates = Actualizaciones
settings-updates-select =
    .aria-label = Si Ariane puede preguntar si existe una versión más reciente
settings-updates-never = No preguntar nunca
settings-updates-startup = Al iniciar
settings-text-size = Tamaño del texto
settings-text-size-select =
    .aria-label = Tamaño del texto en toda la aplicación
settings-update-now = Comprobar ahora
update-now-checking = Comprobando…
update-now-current = Ariane { $version } está al día.
update-now-failed = GitHub no ha respondido: inténtelo más tarde.
update-available = Ariane { $version } está disponible.
update-open = Ver la versión
update-close =
    .aria-label = Descartar
settings-add = Añadir un asistente
settings-add-menu =
    .aria-label = Asistentes que se pueden añadir
settings-open-json = Abrir el archivo JSON
settings-cancel = Cancelar
settings-save = Guardar
settings-sessions = { $n ->
        [0] ninguna conversación
        [one] { $n } conversación
       *[other] { $n } conversaciones
    }
settings-detected = Encontrado: { $path }
settings-not-detected = La búsqueda automática no lo encuentra.
settings-path-label = Ruta que se usará
settings-path-input =
    .placeholder = Vacío: Ariane lo busca por sí misma
    .aria-label = Ruta que se usará para { $agent }
settings-browse = Examinar…
    .aria-label = Buscar el programa de { $agent }
settings-check-pending = Comprobando…
settings-check-chosen = Se usa tal cual: { $path }
settings-check-detected = Ariane usará: { $path }
settings-check-not-found = No se encuentra en este equipo: indica su ruta.
settings-check-not-absolute = La ruta debe ser absoluta.
settings-check-unusable = { $path } no es un programa.
settings-check-interpreter = Encontrado, pero necesita «{ $interpreter }», que no se encuentra.
settings-check-refused = Ruta rechazada: { $detail }.
settings-unreadable = No se puede leer el archivo de ajustes ({ $error }). Ariane no lo reescribirá: ábrelo para corregirlo.
settings-saved = Ajustes guardados.
settings-opened = Ajustes abiertos en tu editor.
settings-opened-at = Ajustes: { $path }
settings-opened-unreadable = Ajustes abiertos, pero no se pueden leer: { $error }

## Estrellas y notas: las marcas que pones tú en una conversación

mark-favorite = Marcar como favorita
mark-favorite-on = En favoritos — haz clic para quitarla
mark-message = Marcar este mensaje como favorito
mark-message-on = En favoritos — haz clic para quitarlo
mark-note = Nota
    .title = Escribir una nota sobre esta conversación
mark-note-input =
    .placeholder = Por qué esta importa…
    .aria-label = Nota sobre esta conversación
mark-note-saved = Nota guardada
favorites-view = Favoritos
    .title = Todas las conversaciones que has marcado como favoritas
favorites-conversations = Conversaciones
favorites-messages = Mensajes
favorites-quote = «{ $text }»
favorites-empty = Todavía no hay favoritos. La estrella, arriba de una conversación, la guarda aquí.
error-marks-unreadable = No se puede leer el archivo de favoritos y notas, así que no se escribió nada: { $error }

## El propio archivo de ajustes: escrito al principio de settings.json, para quien lo abra

settings-file-intro = Dónde encuentra Ariane el comando de cada asistente, para «Reanudar».
settings-file-detected = «detected»: lo que Ariane encontró por sí misma. Se actualiza cada vez que se abre este archivo.
settings-file-command = «command»: déjalo vacío para que Ariane lo busque; pon una ruta absoluta para imponer esa.
settings-file-example = Ejemplo, para codex: { $example }
settings-file-paths = ~ representa tu carpeta personal.
settings-file-paths-windows = Escribe las rutas con barras normales /. Se entienden %APPDATA% y ~.
settings-file-language = «language»: «auto» para seguir el sistema, o un código de idioma como «es» o «en».
settings-file-theme = «theme»: «auto» para seguir al sistema, o «light» o «dark».

## Errores que señala la aplicación

error-forget-not-saved = Solo se puede olvidar una conversación guardada por Ariane: las demás viven en los archivos de su asistente.
error-message-not-found = Mensaje no encontrado.
error-resume-impossible = Esta conversación no se puede reanudar ({ $reason }).
error-settings-unreadable = No se pueden leer los ajustes, así que no se escribió nada: { $error }
browse-title = ¿Dónde está { $agent }?

## Exportaciones: una conversación escrita en un archivo Markdown o impresa en PDF

export-dialog-title = Exportar la conversación
export-file-name = conversación
export-field = { $label }: { $value }
export-field-assistant = Asistente
export-field-folder = Carpeta
export-field-branch = Rama
export-field-period = Periodo
export-field-messages = Mensajes
export-period = del { $from } al { $to }
export-order-newest = de más reciente a más antiguo
export-order-oldest = de más antiguo a más reciente
export-messages = { $count }, { $order }
export-saved = Guardada por Ariane: el archivo original ya no existe.
export-footer = Exportado desde Ariane.
export-footer-at = Exportado desde Ariane el { $date }.

## Statistics

stats-button =
    .title = Estadísticas
    .aria-label = Mostrar las estadísticas
stats-footer-title = Mostrar las estadísticas
stats-title = Estadísticas
stats-loading = Contando…
stats-period = { $period } · { $sessions ->
        [one] { $sessions } conversación
       *[other] { $sessions } conversaciones
    } · { $folders ->
        [one] { $folders } carpeta
       *[other] { $folders } carpetas
    }
stats-hidden = { $count ->
        [one] { $count } asistente oculto en la barra lateral no se cuenta.
       *[other] { $count } asistentes ocultos en la barra lateral no se cuentan.
    }
stats-empty = No se escribió nada en este periodo.
stats-who = Quién escribió
stats-you = Escritos por ti
stats-replies = Respuestas de los asistentes
stats-tools = Salidas de herramientas
stats-notices = Avisos del sistema
stats-share = { $share } de lo que se muestra
stats-records = La barra lateral cuenta { $records } registros: { $empty } no contienen nada que mostrar.
stats-masked = De ellos, { $masked } son razonamientos que Claude ya solo guarda cifrados: solo queda una firma.
stats-tokens = Tokens
stats-sent = ↑ Enviados
    .title = Nuevos en los prompts: la entrada fresca y lo que se escribió en la caché
stats-received = ↓ Recibidos
    .title = Lo que escribieron los asistentes, razonamiento incluido
stats-cache = Releídos de la caché
    .title = El contexto reenviado en cada turno — aparte, nunca sumado al resto
stats-exact = { $value } tokens
stats-coverage = Medidos en { $measured } de { $total } conversaciones.
stats-uncovered = { $agents } no { $count ->
        [one] registra
       *[other] registran
    } tokens que Ariane sepa leer.
stats-subagents = { $count ->
    [one] Un subagente envió además { $sent } tokens, recibió al menos { $received } y releyó { $cached } de la caché. No se cuenta arriba: la transcripción de un subagente no siempre guarda su último recuento.
   *[other] { $count } subagentes enviaron además { $sent } tokens, recibieron al menos { $received } y releyeron { $cached } de la caché. No se cuentan arriba: la transcripción de un subagente no siempre guarda su último recuento.
}
stats-months = Mes a mes
stats-measure-you = Tus mensajes
stats-measure-replies = Respuestas
stats-measure-received = Tokens recibidos
stats-months-table = Ver como tabla
stats-col-month = Mes
stats-undated = { $count ->
        [one] { $count } mensaje no tiene fecha y no figura en el gráfico.
       *[other] { $count } mensajes no tienen fecha y no figuran en el gráfico.
    }
stats-chart = { $measure }, mes a mes
stats-bar = { $month }: { $value }
stats-by-agent = Por asistente
stats-by-model = Por modelo
stats-by-folder = Carpetas más activas
stats-col-assistant = Asistente
stats-col-conversations = Conversaciones
stats-col-you = Tú
stats-col-replies = Respuestas
stats-col-received = ↓ Recibidos
stats-col-model = Modelo
stats-col-folder = Carpeta
stats-col-messages = Mensajes
stats-others = { $count ->
        [one] { $count } modelo más
       *[other] { $count } modelos más
    }
stats-not-measured = no registrado
stats-folder-note = Tus mensajes y las respuestas; las salidas de herramientas no cuentan.
stats-quotas = Límites de uso
stats-quota-window = { $minutes ->
        [300] Ventana de 5 horas
        [10080] Semana
       *[other] Ventana de { $hours } horas
    }
stats-quota-refused = Alcanzado
stats-quota-resets = se reinicia el { $date }
stats-quota-reset-since = reiniciado desde el { $date }
stats-quota-read = Leído el { $date }
stats-quota-plan = plan «{ $plan }»
stats-quota-limit = límite «{ $limit }»
stats-quota-credits = quedan { $balance } créditos
stats-quota-no-credits = sin créditos
stats-quota-unlimited = créditos ilimitados
stats-quota-reached = { $minutes ->
        [300] Límite de 5 horas alcanzado
        [10080] Límite semanal alcanzado
       *[other] Límite de { $hours } horas alcanzado
    } { $count ->
        [one] una vez
       *[other] { $count } veces
    }, la última el { $date }.
stats-quota-history = { $minutes ->
        [300] Las ventanas de 5 horas leídas, cada una en su valor más alto
        [10080] Las semanas leídas, cada una en su valor más alto
       *[other] Las ventanas de { $hours } horas leídas, cada una en su valor más alto
    }
stats-quota-ending = Ventana que termina el { $date }
stats-quota-col-end = Fin de la ventana
stats-quota-col-used = Lectura más alta
stats-quota-note = Un porcentaje es una lectura, no un recuento: cada ventana muestra la más alta, con la fecha en que se leyó. Ariane no consulta ningún servidor; lee lo que escribieron los asistentes: Codex en cada respuesta; Claude en la última lectura que guardó, en el historial de Claude Desktop si está instalado y en cada solicitud que sus límites rechazaron.
