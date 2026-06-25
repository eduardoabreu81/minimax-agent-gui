# Agente de Código

O Agente de Código (painel **Código**) é um ambiente de programação autônomo.
Diferente do Chat, ele pode ler e escrever arquivos e rodar comandos em um
workspace real para executar tarefas de engenharia de várias etapas.

## Como funciona

Descreva o que você quer — um recurso, uma correção, uma refatoração — e o
agente planeja, edita arquivos e roda comandos para chegar lá. O progresso é
transmitido ao vivo, com uma lista de tarefas mostrando as etapas em
andamento.

## O terminal

Um terminal integrado mostra os comandos que o agente roda e suas saídas. Ele
roda contra o backend real, então reflete a execução de verdade, não uma
simulação.

## Modelo e raciocínio

Como o Chat, o Agente de Código usa o modelo e a configuração de raciocínio
estendido da barra de status. `MiniMax-M3` com raciocínio ativado é a opção
mais forte para tarefas complexas.

## Dicas

- Seja específico sobre o resultado desejado e quaisquer restrições.
- Revise o plano e os diffs do agente conforme eles aparecem.
- Mantenha as tarefas focadas — pedidos menores e bem delimitados rodam de
  forma mais confiável.
