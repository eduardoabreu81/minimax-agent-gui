# Code Agent

The Code Agent (the **Code** panel) is an autonomous coding workspace. Unlike
Chat, it can read and write files and run commands in a real workspace to
carry out multi-step engineering tasks.

## How it works

Describe what you want — a feature, a fix, a refactor — and the agent plans,
edits files, and runs commands to get there. Its progress streams live, with
a todo list showing the steps it's working through.

## The terminal

An integrated terminal shows the commands the agent runs and their output.
This runs against the real backend, so it reflects actual execution rather
than a simulation.

## Model & thinking

Like Chat, the Code Agent uses the model and extended-thinking setting from
the status bar. `MiniMax-M3` with thinking enabled is the strongest option
for complex tasks.

## Tips

- Be specific about the outcome you want and any constraints.
- Review the agent's plan and diffs as they stream in.
- Keep tasks focused — smaller, well-scoped requests run more reliably.
