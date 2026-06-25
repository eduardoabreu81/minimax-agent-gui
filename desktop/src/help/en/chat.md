# Chat

The Chat panel is a conversation with MiniMax expert models. Use it for
questions, drafting, analysis, and anything that doesn't need to touch your
filesystem.

## Sending a message

Type in the composer at the bottom and press `Enter` to send (`Shift + Enter`
inserts a newline). The model streams its reply token by token.

## Composer features

- **Slash commands** — type `/` at the start of the composer to open the
  command menu.
- **@-references** — type `@` to attach context (files or other references)
  to your message as chips.
- **Attachments** — add files for the model to read alongside your prompt.

## Model & thinking

The active model and the extended-thinking toggle live in the status bar at
the bottom of the window and are shared with the Code Agent — switching here
affects the next message in either panel.

## Starting fresh

Use the command palette (`Ctrl/Cmd + K`) and choose **New chat** to clear the
conversation and start over.
