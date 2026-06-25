# Chat

El panel Chat es una conversación con los modelos expertos de MiniMax. Úsalo
para preguntas, redacción, análisis y todo lo que no necesite tocar tu sistema
de archivos.

## Enviar un mensaje

Escribe en el compositor de abajo y pulsa `Enter` para enviar (`Shift + Enter`
inserta un salto de línea). El modelo transmite su respuesta token a token.

## Funciones del compositor

- **Comandos de barra**: escribe `/` al inicio del compositor para abrir el
  menú de comandos.
- **Referencias con @**: escribe `@` para adjuntar contexto (archivos u otras
  referencias) a tu mensaje como chips.
- **Adjuntos**: añade archivos para que el modelo los lea junto con tu prompt.

## Modelo y razonamiento

El modelo activo y el interruptor de razonamiento extendido están en la barra
de estado, al pie de la ventana, y se comparten con el Agente de Código:
cambiarlos aquí afecta al siguiente mensaje en cualquiera de los paneles.

## Empezar de cero

Usa la paleta de comandos (`Ctrl/Cmd + K`) y elige **Nuevo chat** para limpiar
la conversación y empezar de nuevo.
