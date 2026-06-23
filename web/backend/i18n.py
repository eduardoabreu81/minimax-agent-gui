"""Backend i18n — tiny key→string lookup, no gettext.

The MiniMax Studio frontend uses react-i18next with the user's selected
language. The backend needs to render some user-visible strings too:

- Default preset names / descriptions (i18n keys, frontend resolves)
- Error messages from the agent-context API
- Default content for scaffold files (presets seeded by the wizard)
- Names of the four context files (SOUL.md, IDENTITY.md, USER.md, MEMORY.md)
  used in banner messages

We don't ship .mo files — a flat dict per language keeps it simple and
easy to audit. New strings: add to both dicts.

Adding a language: append a new dict, add to SUPPORTED, ship the
parallel entries. No fallback dance — missing key raises KeyError so
we catch it in dev.
"""
from __future__ import annotations

from typing import Callable

# Supported languages. The project ships in English (public audience
# is English-first), with pt-BR as a fully-translated option. The
# default is overridden by `app.language` in config/config.yaml —
# the install flow is where the user picks their preferred language
# and writes it there.
SUPPORTED = ("en-US", "pt-BR")
DEFAULT_LANG = "en-US"


# --- Presets (SOUL.md content templates) ---
# Each preset is a tuple of (name_key, desc_key, body_key).
# The "body" is the actual markdown content written to SOUL.md.
PRESETS = {
    "concise": {
        "name": "preset.concise.name",
        "desc": "preset.concise.desc",
        "body": "preset.concise.body",
    },
    "friendly": {
        "name": "preset.friendly.name",
        "desc": "preset.friendly.desc",
        "body": "preset.friendly.body",
    },
    "mentor": {
        "name": "preset.mentor.name",
        "desc": "preset.mentor.desc",
        "body": "preset.mentor.body",
    },
    "expert": {
        "name": "preset.expert.name",
        "desc": "preset.expert.desc",
        "body": "preset.expert.body",
    },
    "creative": {
        "name": "preset.creative.name",
        "desc": "preset.creative.desc",
        "body": "preset.creative.body",
    },
}


# --- Roles (IDENTITY.md) ---
# Each non-custom role carries a "body" key (i18n key) that resolves
# to the markdown content the wizard writes to IDENTITY.md. The
# "custom" role has no body — the user defines it inline.
ROLES = {
    "eng": {
        "name": "role.eng.name",
        "desc": "role.eng.desc",
        "body": "role.eng.body",
    },
    "reviewer": {
        "name": "role.reviewer.name",
        "desc": "role.reviewer.desc",
        "body": "role.reviewer.body",
    },
    "pm": {
        "name": "role.pm.name",
        "desc": "role.pm.desc",
        "body": "role.pm.body",
    },
    "custom": {
        "name": "role.custom.name",
        "desc": "role.custom.desc",
        # no body — the user writes the role description inline
    },
}


# --- Tech levels (USER.md) ---
LEVELS = {
    "beginner": "level.beginner",
    "mid": "level.mid",
    "senior": "level.senior",
}


# --- String tables ---
_STRINGS: dict[str, dict[str, str]] = {
    "pt-BR": {
        # Files
        "file.soul": "Personalidade",
        "file.identity": "Papel atual",
        "file.user": "Seu perfil",
        "file.memory": "Memória do projeto",
        "file.daily": "Registros do dia",

        # Char limit labels
        "limit.char": "caracteres",
        "limit.percent": "{pct}% usado",

        # Banner
        "banner.incomplete": "Contexto do agente incompleto",
        "banner.missing_file": "{file} ausente — o agente tem conhecimento limitado sobre você.",
        "banner.set_up_now": "Configurar agora",
        "banner.open_settings": "Abrir Settings",
        "banner.dismiss": "Descartar",

        # Wizard
        "wizard.title": "Vamos configurar seu MiniMax Studio",
        "wizard.subtitle": "4 passos rápidos. Você pode pular e configurar depois.",
        "wizard.step.about": "Sobre você",
        "wizard.step.personality": "Personalidade",
        "wizard.step.identity": "Papel",
        "wizard.step.review": "Revisar",
        "wizard.skip": "Pular",
        "wizard.back": "Voltar",
        "wizard.next": "Próximo",
        "wizard.create": "Criar arquivos",
        "wizard.about_name": "Como você quer ser chamado?",
        "wizard.about_name_ph": "ex.: Eduardo",
        "wizard.about_tz": "Fuso horário",
        "wizard.about_level": "Nível técnico",
        "wizard.personality_q": "Como você quer que eu soe?",
        "wizard.identity_q": "Qual meu papel padrão neste workspace?",
        "wizard.review_q": "Confirme os arquivos que serão criados",
        "wizard.review_create": "Criar {n} arquivos",

        # Settings cards
        "settings.context.title": "Contexto do agente",
        "settings.context.subtitle": "5 arquivos definem como o agente se comporta neste workspace.",
        "settings.personality.title": "Personalidade",
        "settings.personality.badge": "Somente você · slot #1",
        "settings.personality.preset": "Preset",
        "settings.personality.reset": "Restaurar padrão",
        "settings.personality.custom_ph": "Personalidade customizada…",
        "settings.identity.title": "Papel",
        "settings.identity.badge": "Somente você",
        "settings.identity.quick_switch": "Trocar papel",
        "settings.identity.custom_ph": "Descrição do papel customizado…",
        "settings.memory.title": "Memória do projeto",
        "settings.memory.badge": "Você + agente",
        "settings.memory.view": "Ver",
        "settings.memory.edit": "Editar",
        "settings.memory.revert": "Restaurar template",
        "settings.daily.title": "Registros diários",
        "settings.daily.badge": "Agente anexa automaticamente",
        "settings.daily.empty": "Nenhum registro ainda.",
        "settings.daily.today": "Hoje",
        "settings.daily.yesterday": "Ontem",
        "settings.daily.turns": "{n} turnos",

        # Memory viewer
        "memory.viewer_title": "Memória do agente",
        "memory.usage_header": "MEMORY (anotações do agente) · {pct}% — {used}/{limit} {unit}",
        "memory.empty": "Vazio. O agente vai popular conforme você trabalha.",
        "memory.append_only": "Append-only · atualizado pelo agente",

        # Daily viewer
        "daily.viewer_title": "Registros de {date}",
        "daily.append_only": "Append-only · gerado pelo agente a cada turno",
        "daily.thinking_prefix": "thinking:",

        # Misc
        "graceful_degradation": "Qualquer combinação de arquivos vazios funciona — o agente degrada com elegância e o banner avisa quando algo essencial está faltando.",
        "common.save": "Salvar",
        "common.cancel": "Cancelar",
        "common.delete": "Excluir",

        # Presets (SOUL)
        "preset.concise.name": "Conciso",
        "preset.concise.desc": "Direto ao ponto, mínima prosa",
        "preset.concise.body": "# Personalidade\n\nVocê é um engenheiro sênior pragmático e direto. Vai direto ao ponto, sem floreios. Prefere mostrar código a descrever em prosa.\n\n## Estilo\n- Seja direto sem ser frio\n- Substância > formalidade\n- Discorda quando algo é má ideia, com razão\n- Admita incerteza com clareza\n- Mantenha explicações compactas a menos que profundidade seja útil\n\n## O que evitar\n- Bajulação\n- Linguagem de hype\n- Repetir o framing do usuário se estiver errado\n- Super-explicar o óbvio",
        "preset.friendly.name": "Amigável",
        "preset.friendly.desc": "Caloroso e encorajador",
        "preset.friendly.body": "# Personalidade\n\nVocê é um parceiro de código caloroso e gentil. Comemora os acertos, explica com paciência e mantém o astral leve.\n\n## Estilo\n- Acolhedor mas direto\n- Use exemplos concretos\n- Reconheça esforço antes de corrigir\n- Pergunte de volta quando algo não está claro\n\n## O que evitar\n- Sarcasmo\n- Respostas monossilábicas\n- Culpar o usuário pelo bug",
        "preset.mentor.name": "Mentor",
        "preset.mentor.desc": "Ensina o porquê no caminho",
        "preset.mentor.body": "# Personalidade\n\nVocê é um mentor paciente. Sempre explica o raciocínio por trás das decisões e aponta o que vale estudar a seguir.\n\n## Estilo\n- Explique o porquê antes do como\n- Aponte padrões e armadilhas comuns\n- Sugira leituras / aprofundamento quando útil\n- Trate erros como oportunidades de aprendizado\n\n## O que evitar\n- Respostas mágicas sem explicação\n- Pular etapas como se fossem óbvias",
        "preset.expert.name": "Especialista",
        "preset.expert.desc": "Técnico denso, vai fundo",
        "preset.expert.body": "# Personalidade\n\nVocê é um especialista técnico que vai fundo. Cita trade-offs, aponta nuances, e assume o usuário tem base técnica.\n\n## Estilo\n- Densidade alta, sem enrolação\n- Cita trade-offs e edge cases explicitamente\n- Usa jargão técnico sem traduzir\n- Referencia docs e RFCs quando relevante\n\n## O que evitar\n- Explicar conceitos básicos\n- Hedging excessivo",
        "preset.creative.name": "Criativo",
        "preset.creative.desc": "Brainstorm, opções, ângulos inesperados",
        "preset.creative.body": "# Personalidade\n\nVocê é um parceiro criativo. Gera opções, explora ângulos inesperados, e ajuda o usuário a ver além do óbvio.\n\n## Estilo\n- Proponha 2-3 alternativas antes de recomendar\n- Use analogias e metáforas\n- Questione o framing do problema antes de resolver\n- Celebre ideias não-convencionais\n\n## O que evitar\n- Resposta única sem explorar\n- Conservadorismo prematuro",

        # Roles (IDENTITY)
        "role.eng.name": "Engineering partner",
        "role.eng.desc": "Focado em escrever e manter código",
        "role.eng.body": "Você é o engineering partner do usuário. Seu trabalho é escrever, refatorar e debugar código junto com ele. Vies para ação: quando o usuário descreve um problema, proponha mudanças concretas de código, não análise abstrata.\n\n## Estilo\n- Código antes de prosa\n- Aponte a causa raiz antes de tentar fixes\n- Sugira testes quando relevante\n- Trade-offs explícitos quando há mais de uma abordagem",
        "role.reviewer.name": "Code reviewer",
        "role.reviewer.desc": "Lê código, identifica problemas, sugere melhorias",
        "role.reviewer.body": "Você é um code reviewer. Leia o código que o usuário compartilha, identifique problemas, sugira melhorias. Foque em correção, legibilidade e performance. Seja direto sobre os problemas mas respeitoso com o autor.\n\n## Estilo\n- Severidade explícita (nit / suggestion / blocker)\n- Justifique cada sugestão com o porquê\n- Reconheça o que está bom antes de corrigir",
        "role.pm.name": "Project manager",
        "role.pm.desc": "Organiza tarefas, acompanha progresso, gerencia escopo",
        "role.pm.body": "Você é um project manager. Ajude o usuário a organizar tarefas, acompanhar progresso, gerenciar escopo. Decomponha trabalho em chunks, identifique bloqueios, surface riscos cedo. Vies para clareza em vez de completude.\n\n## Estilo\n- Próxima ação concreta primeiro\n- Riscos e dependências visíveis\n- Escopo negociável, prazo firme",
        "role.custom.name": "Customizado",
        "role.custom.desc": "Você define o papel",

        # Levels (USER)
        "level.beginner": "Iniciante",
        "level.mid": "Intermediário",
        "level.senior": "Avançado",
    },
    "en-US": {
        # Files
        "file.soul": "Personality",
        "file.identity": "Current role",
        "file.user": "Your profile",
        "file.memory": "Project memory",
        "file.daily": "Daily logs",

        # Char limit labels
        "limit.char": "characters",
        "limit.percent": "{pct}% used",

        # Banner
        "banner.incomplete": "Agent context is incomplete",
        "banner.missing_file": "{file} missing — the agent has limited knowledge about you.",
        "banner.set_up_now": "Set up now",
        "banner.open_settings": "Open Settings",
        "banner.dismiss": "Dismiss",

        # Wizard
        "wizard.title": "Let's set up your MiniMax Studio",
        "wizard.subtitle": "4 quick steps. You can skip and configure later.",
        "wizard.step.about": "About you",
        "wizard.step.personality": "Personality",
        "wizard.step.identity": "Role",
        "wizard.step.review": "Review",
        "wizard.skip": "Skip",
        "wizard.back": "Back",
        "wizard.next": "Next",
        "wizard.create": "Create files",
        "wizard.about_name": "What should I call you?",
        "wizard.about_name_ph": "e.g., Eduardo",
        "wizard.about_tz": "Timezone",
        "wizard.about_level": "Technical level",
        "wizard.personality_q": "How should I sound?",
        "wizard.identity_q": "What's my default role in this workspace?",
        "wizard.review_q": "Confirm the files that will be created",
        "wizard.review_create": "Create {n} files",

        # Settings cards
        "settings.context.title": "Agent context",
        "settings.context.subtitle": "5 files define how the agent behaves in this workspace.",
        "settings.personality.title": "Personality",
        "settings.personality.badge": "User only · slot #1",
        "settings.personality.preset": "Preset",
        "settings.personality.reset": "Reset to default",
        "settings.personality.custom_ph": "Custom personality…",
        "settings.identity.title": "Role",
        "settings.identity.badge": "User only",
        "settings.identity.quick_switch": "Quick switch",
        "settings.identity.custom_ph": "Custom role description…",
        "settings.memory.title": "Project memory",
        "settings.memory.badge": "You + agent",
        "settings.memory.view": "View",
        "settings.memory.edit": "Edit",
        "settings.memory.revert": "Revert to template",
        "settings.daily.title": "Daily logs",
        "settings.daily.badge": "Agent auto-appends",
        "settings.daily.empty": "No logs yet.",
        "settings.daily.today": "Today",
        "settings.daily.yesterday": "Yesterday",
        "settings.daily.turns": "{n} turns",

        # Memory viewer
        "memory.viewer_title": "Agent memory",
        "memory.usage_header": "MEMORY (agent notes) · {pct}% — {used}/{limit} {unit}",
        "memory.empty": "Empty. The agent will populate as you work.",
        "memory.append_only": "Append-only · updated by the agent",

        # Daily viewer
        "daily.viewer_title": "Logs for {date}",
        "daily.append_only": "Append-only · generated by the agent each turn",
        "daily.thinking_prefix": "thinking:",

        # Misc
        "graceful_degradation": "Any combination of empty files works — the agent degrades gracefully and the banner warns when something essential is missing.",
        "common.save": "Save",
        "common.cancel": "Cancel",
        "common.delete": "Delete",

        # Presets (SOUL)
        "preset.concise.name": "Concise",
        "preset.concise.desc": "Direct, minimal prose",
        "preset.concise.body": "# Personality\n\nYou are a pragmatic senior engineer. Direct, no fluff. Prefer showing code over describing in prose.\n\n## Style\n- Direct without being cold\n- Substance > formality\n- Push back on bad ideas with reasoning\n- Admit uncertainty plainly\n- Keep explanations compact unless depth is useful\n\n## What to avoid\n- Sycophancy\n- Hype language\n- Repeating the user's framing if it's wrong\n- Over-explaining the obvious",
        "preset.friendly.name": "Friendly",
        "preset.friendly.desc": "Warm and encouraging",
        "preset.friendly.body": "# Personality\n\nYou are a warm, kind code partner. Celebrate wins, explain patiently, keep the vibe light.\n\n## Style\n- Welcoming but direct\n- Use concrete examples\n- Acknowledge effort before correcting\n- Ask back when something is unclear\n\n## What to avoid\n- Sarcasm\n- Monosyllabic replies\n- Blaming the user for the bug",
        "preset.mentor.name": "Mentor",
        "preset.mentor.desc": "Teaches the why along the way",
        "preset.mentor.body": "# Personality\n\nYou are a patient mentor. Always explain the reasoning behind decisions and point to what to study next.\n\n## Style\n- Explain the why before the how\n- Point out common patterns and pitfalls\n- Suggest further reading / depth when useful\n- Treat errors as learning opportunities\n\n## What to avoid\n- Magic answers with no explanation\n- Skipping steps as if they were obvious",
        "preset.expert.name": "Expert",
        "preset.expert.desc": "Dense technical, goes deep",
        "preset.expert.body": "# Personality\n\nYou are a technical expert who goes deep. Cite trade-offs, surface nuances, assume the user has technical baseline.\n\n## Style\n- High density, no fluff\n- Cite trade-offs and edge cases explicitly\n- Use jargon without translating\n- Reference docs and RFCs when relevant\n\n## What to avoid\n- Explaining basics\n- Excessive hedging",
        "preset.creative.name": "Creative",
        "preset.creative.desc": "Brainstorm, options, unexpected angles",
        "preset.creative.body": "# Personality\n\nYou are a creative partner. Generate options, explore unexpected angles, help the user see beyond the obvious.\n\n## Style\n- Propose 2-3 alternatives before recommending\n- Use analogies and metaphors\n- Question the problem framing before solving\n- Celebrate unconventional ideas\n\n## What to avoid\n- Single answer without exploration\n- Premature conservatism",

        # Roles (IDENTITY)
        "role.eng.name": "Engineering partner",
        "role.eng.desc": "Focused on writing and maintaining code",
        "role.eng.body": "You are the user's engineering partner. Your job is to write, refactor, and debug code with the user. Bias toward action: when the user describes a problem, propose concrete code changes, not abstract analysis.\n\n## Style\n- Code over prose\n- Surface the root cause before attempting fixes\n- Suggest tests when relevant\n- Explicit trade-offs when more than one approach works",
        "role.reviewer.name": "Code reviewer",
        "role.reviewer.desc": "Reads code, identifies issues, suggests improvements",
        "role.reviewer.body": "You are a code reviewer. Read the code the user shares, identify issues, suggest improvements. Focus on correctness, readability, and performance. Be direct about problems but respectful of the author.\n\n## Style\n- Explicit severity (nit / suggestion / blocker)\n- Justify each suggestion with the why\n- Acknowledge what's good before correcting",
        "role.pm.name": "Project manager",
        "role.pm.desc": "Organizes tasks, tracks progress, manages scope",
        "role.pm.body": "You are a project manager. Help the user organize tasks, track progress, manage scope. Break down work into chunks, identify blockers, surface risks early. Bias toward clarity over completeness.\n\n## Style\n- Concrete next action first\n- Visible risks and dependencies\n- Scope is negotiable, deadline is firm",
        "role.custom.name": "Custom",
        "role.custom.desc": "You define the role",

        # Levels (USER)
        "level.beginner": "Beginner",
        "level.mid": "Mid-level",
        "level.senior": "Senior",
    },
}


def t(key: str, lang: str = DEFAULT_LANG, **fmt) -> str:
    """Look up a translation. Raises KeyError on missing key (caught in dev).

    `fmt` is format-string interpolation: t('banner.missing_file', file='USER.md').
    """
    table = _STRINGS.get(lang)
    if table is None:
        raise KeyError(f"Unknown language: {lang}. Supported: {SUPPORTED}")
    text = table.get(key)
    if text is None:
        raise KeyError(
            f"Missing i18n key {key!r} in language {lang!r}. "
            f"Add it to web/backend/i18n.py."
        )
    return text.format(**fmt) if fmt else text


def lang_or_default(lang: str | None) -> str:
    """Normalize lang string ('en-us', 'EN_US', 'en-US' all → 'en-US')."""
    if not lang:
        return DEFAULT_LANG
    normalized = lang.strip().replace("_", "-")
    # Handle case-insensitive match
    for supported in SUPPORTED:
        if supported.lower() == normalized.lower():
            return supported
    return DEFAULT_LANG


def preset_label(preset_id: str, lang: str = DEFAULT_LANG, *, field: str = "name") -> str:
    """Look up a preset's user-visible field by id ('concise', 'friendly', ...).

    Returns the i18n string. Raises KeyError on unknown preset.
    """
    spec = PRESETS.get(preset_id)
    if spec is None:
        raise KeyError(f"Unknown preset: {preset_id}. Known: {list(PRESETS)}")
    return t(spec[field], lang)


def role_label(role_id: str, lang: str = DEFAULT_LANG, *, field: str = "name") -> str:
    spec = ROLES.get(role_id)
    if spec is None:
        raise KeyError(f"Unknown role: {role_id}. Known: {list(ROLES)}")
    return t(spec[field], lang)


def role_body(role_id: str, lang: str = DEFAULT_LANG) -> str | None:
    """Return the role's IDENTITY.md body, or None if the role is
    'custom' (no canonical body — the user supplies it inline).
    """
    spec = ROLES.get(role_id)
    if spec is None:
        raise KeyError(f"Unknown role: {role_id}. Known: {list(ROLES)}")
    body_key = spec.get("body")
    if body_key is None:
        return None
    return t(body_key, lang)


def level_label(level_id: str, lang: str = DEFAULT_LANG) -> str:
    key = LEVELS.get(level_id)
    if key is None:
        raise KeyError(f"Unknown level: {level_id}. Known: {list(LEVELS)}")
    return t(key, lang)