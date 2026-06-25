# Agente de Código

El Agente de Código (panel **Código**) es un espacio de programación autónomo.
A diferencia del Chat, puede leer y escribir archivos y ejecutar comandos en un
espacio de trabajo real para llevar a cabo tareas de ingeniería de varios
pasos.

## Cómo funciona

Describe lo que quieres —una función, una corrección, una refactorización— y el
agente planifica, edita archivos y ejecuta comandos para lograrlo. Su progreso
se transmite en vivo, con una lista de tareas que muestra los pasos en los que
trabaja.

## El terminal

Un terminal integrado muestra los comandos que ejecuta el agente y su salida.
Se ejecuta contra el backend real, así que refleja la ejecución real y no una
simulación.

## Modelo y razonamiento

Como el Chat, el Agente de Código usa el modelo y la configuración de
razonamiento extendido de la barra de estado. `MiniMax-M3` con el razonamiento
activado es la opción más potente para tareas complejas.

## Consejos

- Sé específico sobre el resultado que quieres y cualquier restricción.
- Revisa el plan y los diffs del agente conforme aparecen.
- Mantén las tareas enfocadas: las solicitudes más pequeñas y bien delimitadas
  se ejecutan de forma más fiable.
