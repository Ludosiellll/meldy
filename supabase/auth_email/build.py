"""Meldy's Supabase Auth emails: templates, subjects and mail settings, kept in the repository.

The owner keeps the Supabase access token in the repository secret SUPABASE_ACCESS_TOKEN (2026-10-07). The job
.github/workflows/supabase-auth-email.yml runs this file when deploy/supabase-auth.md changes and sets the project's
Auth emails through the Management API (PATCH /v1/projects/{ref}/config/auth). It prints only public fields — never
the SMTP account, user or password.

    python supabase/auth_email/build.py preview OUT_DIR   # every email with sample values, for a look
    python supabase/auth_email/build.py apply             # needs SUPABASE_ACCESS_TOKEN (PROJECT_REF optional)

Links stay the Supabase variables the old templates used ({{ .ConfirmationURL }}), so sign-up, password reset and
sign-in links behave as before. Colours and the pill button follow the app (frontend/src/index.css tokens).
"""

from __future__ import annotations

import html
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from string import Template

PROJECT_REF_DEFAULT = "daunnytubqbzafjnpfnw"
API = "https://api.supabase.com/v1/projects/{ref}/config/auth"
SITE = "https://ludosiel-studyforge.hf.space"

# The sender name students see, and the hourly cap on Auth emails: with custom SMTP Supabase starts at 30 an hour,
# too few when a whole group signs up after a link in its chat.
SETTINGS: dict[str, object] = {
    "smtp_sender_name": "Meldy",
    "rate_limit_email_sent": 100,
}
# Redirects after a link in an email may go to any page of the site (the group link /join/<code> among them).
# The job only adds this entry when it is missing; it never removes or rewrites the existing ones.
ALLOW_LIST_ENTRY = f"{SITE}/**"

FONT = "'Onest', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
COLOURS = {
    "font": FONT,
    "ink": "#0b121c",
    "muted": "#4b515b",
    "faint": "#6b717b",
    "line": "#e3e3dd",
    "canvas": "#f3f3f0",
    "surface": "#ffffff",
    "accent": "#2869dd",
    "link": "#1f5bc6",
}

LAYOUT = Template("""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>$title</title>
</head>
<body style="margin:0;padding:0;background:$canvas;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">$preheader</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:$canvas;">
<tr><td align="center" style="padding:32px 12px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
<tr><td style="padding:0 12px 18px;font-family:$font;font-size:21px;font-weight:700;letter-spacing:-0.03em;color:$ink;">Meldy</td></tr>
<tr><td style="background:$surface;border:1px solid $line;border-radius:32px;padding:36px 32px 34px;font-family:$font;">
<h1 style="margin:0 0 12px;font-family:$font;font-size:26px;line-height:1.2;font-weight:700;letter-spacing:-0.02em;color:$ink;">$heading</h1>
$body$action</td></tr>
<tr><td style="padding:18px 12px 0;font-family:$font;font-size:13px;line-height:1.55;color:$faint;">$footer</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
""")

PARAGRAPH = Template(
    '<p style="margin:0;font-family:$font;font-size:16px;line-height:1.55;color:$muted;">$text</p>\n'
)

BUTTON = Template("""<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;">
<tr><td style="border-radius:999px;background:$accent;">
<a href="$href" style="display:inline-block;padding:8px 8px 8px 24px;font-family:$font;font-size:16px;line-height:30px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">$label&nbsp;&nbsp;<span style="display:inline-block;width:30px;height:30px;border-radius:15px;background:#ffffff;color:$accent;text-align:center;line-height:30px;font-size:16px;font-weight:700;vertical-align:top;">&rarr;</span></a>
</td></tr>
</table>
<p style="margin:22px 0 0;font-family:$font;font-size:13px;line-height:1.55;color:$faint;">Кнопка не&nbsp;нажимается? Откройте ссылку в&nbsp;браузере:<br><a href="$href" style="color:$link;word-break:break-all;">$href</a></p>
""")

CODE = Template(
    '<p style="margin:18px 0 0;font-family:$font;font-size:34px;line-height:1.2;font-weight:700;'
    'letter-spacing:0.18em;color:$ink;">$code</p>\n'
)

NBSP = " "
REPLY = f"Если это были не{NBSP}вы, ответьте на{NBSP}это письмо{NBSP}— поможем вернуть доступ."

# key → Management API names mailer_subjects_<key> and mailer_templates_<key>_content. The six Auth emails come
# first; the security notices after them are sent only when switched on in the project, which this file never does.
EMAILS: dict[str, dict[str, str]] = {
    "confirmation": {
        "subject": "Подтвердите почту для Meldy",
        "preheader": "Остался один шаг: подтвердите почту, и можно тянуть первый билет.",
        "heading": "Подтвердите почту",
        "text": f"Вы зарегистрировались в Meldy с адресом {{{{ .Email }}}}. Нажмите кнопку{NBSP}— почта "
                "подтвердится, и Meldy откроется уже со входом.",
        "button": "Подтвердить почту",
        "href": "{{ .ConfirmationURL }}",
        "footer": f"Если вы не регистрировались в Meldy, просто удалите это письмо: без подтверждения аккаунт "
                  f"не{NBSP}заработает.",
    },
    "recovery": {
        "subject": "Сброс пароля в Meldy",
        "preheader": "Ссылка, чтобы задать новый пароль.",
        "heading": "Новый пароль",
        "text": "Вы попросили сбросить пароль в Meldy для адреса {{ .Email }}. Нажмите кнопку и задайте новый.",
        "button": "Задать новый пароль",
        "href": "{{ .ConfirmationURL }}",
        "footer": "Если вы не просили сбросить пароль, ничего не делайте: старый пароль продолжит работать.",
    },
    "magic_link": {
        "subject": "Вход в Meldy",
        "preheader": "Ссылка для входа без пароля.",
        "heading": "Вход в Meldy",
        "text": "Нажмите кнопку, чтобы войти в Meldy с адресом {{ .Email }}. Ссылка сработает один раз.",
        "button": "Войти",
        "href": "{{ .ConfirmationURL }}",
        "footer": "Если вы не пытались войти, просто удалите это письмо.",
    },
    "email_change": {
        "subject": "Подтвердите новую почту для Meldy",
        "preheader": "Подтвердите новый адрес аккаунта.",
        "heading": "Новая почта",
        "text": "Вы меняете почту аккаунта Meldy: {{ .Email }} → {{ .NewEmail }}. Нажмите кнопку, чтобы "
                "подтвердить новый адрес.",
        "button": "Подтвердить новую почту",
        "href": "{{ .ConfirmationURL }}",
        "footer": "Если вы ничего не меняли, просто удалите это письмо: адрес останется прежним.",
    },
    "invite": {
        "subject": "Вас пригласили в Meldy",
        "preheader": "Подготовка к устному экзамену по билетам вашего курса.",
        "heading": "Вас пригласили в Meldy",
        "text": "Meldy спрашивает по билетам вашего экзамена, как преподаватель, и стирает из шпаргалки то, "
                "что вы уже называете сами. Нажмите кнопку, чтобы принять приглашение и создать аккаунт.",
        "button": "Принять приглашение",
        "href": "{{ .ConfirmationURL }}",
        "footer": "Если вы не ждали приглашения, просто удалите это письмо.",
    },
    "reauthentication": {
        "subject": "Код подтверждения Meldy: {{ .Token }}",
        "preheader": "Код, чтобы подтвердить действие в аккаунте.",
        "heading": "Код подтверждения",
        "text": "Введите этот код в Meldy, чтобы подтвердить действие:",
        "code": "{{ .Token }}",
        "footer": "Если вы ничего не подтверждали, просто удалите это письмо.",
    },
    "password_changed_notification": {
        "subject": "Пароль в Meldy изменён",
        "preheader": "Пароль от аккаунта только что изменили.",
        "heading": "Пароль изменён",
        "text": "Пароль от аккаунта Meldy с адресом {{ .Email }} только что изменили.",
        "footer": f"Если это были не{NBSP}вы, сразу сбросьте пароль через «Забыли пароль?» на странице входа "
                  f"и ответьте на{NBSP}это письмо.",
    },
    "email_changed_notification": {
        "subject": "Почта аккаунта Meldy изменена",
        "preheader": "Адрес почты аккаунта изменили.",
        "heading": "Почта изменена",
        "text": "Почту аккаунта Meldy изменили: {{ .OldEmail }} → {{ .Email }}.",
        "footer": REPLY,
    },
    "phone_changed_notification": {
        "subject": "Телефон в аккаунте Meldy изменён",
        "preheader": "Номер телефона в аккаунте изменили.",
        "heading": "Телефон изменён",
        "text": "Номер телефона в аккаунте Meldy с адресом {{ .Email }} изменили: {{ .OldPhone }} → {{ .Phone }}.",
        "footer": REPLY,
    },
    "mfa_factor_enrolled_notification": {
        "subject": "В аккаунт Meldy добавлен способ подтверждения входа",
        "preheader": "Добавлен способ подтверждения входа.",
        "heading": "Добавлен способ подтверждения входа",
        "text": "В аккаунт Meldy с адресом {{ .Email }} добавили способ подтверждения входа: {{ .FactorType }}.",
        "footer": REPLY,
    },
    "mfa_factor_unenrolled_notification": {
        "subject": "Из аккаунта Meldy удалён способ подтверждения входа",
        "preheader": "Удалён способ подтверждения входа.",
        "heading": "Удалён способ подтверждения входа",
        "text": "Из аккаунта Meldy с адресом {{ .Email }} удалили способ подтверждения входа: {{ .FactorType }}.",
        "footer": REPLY,
    },
    "identity_linked_notification": {
        "subject": "К аккаунту Meldy привязан способ входа",
        "preheader": "Привязан новый способ входа.",
        "heading": "Привязан способ входа",
        "text": "К аккаунту Meldy с адресом {{ .Email }} привязали вход через {{ .Provider }}.",
        "footer": REPLY,
    },
    "identity_unlinked_notification": {
        "subject": "От аккаунта Meldy отвязан способ входа",
        "preheader": "Отвязан способ входа.",
        "heading": "Отвязан способ входа",
        "text": "От аккаунта Meldy с адресом {{ .Email }} отвязали вход через {{ .Provider }}.",
        "footer": REPLY,
    },
}


def _text(value: str) -> str:
    """HTML-escape copy; Go template actions such as {{ .Email }} have no characters html.escape changes."""
    return html.escape(value, quote=False)


def render(key: str) -> str:
    """The full HTML of one email; the Go template variables stay for Supabase to fill."""
    email = EMAILS[key]
    body = PARAGRAPH.substitute(COLOURS, text=_text(email["text"]))
    if "href" in email:
        action = BUTTON.substitute(COLOURS, href=email["href"], label=_text(email["button"]))
    elif "code" in email:
        action = CODE.substitute(COLOURS, code=email["code"])
    else:
        action = ""
    return LAYOUT.substitute(
        COLOURS,
        title=_text(email["heading"]),
        preheader=_text(email["preheader"]),
        heading=_text(email["heading"]),
        body=body,
        action=action,
        footer=_text(email["footer"]),
    )


def template_payload() -> dict[str, str]:
    """Management API fields for every subject and template."""
    payload: dict[str, str] = {}
    for key, email in EMAILS.items():
        payload[f"mailer_subjects_{key}"] = email["subject"]
        payload[f"mailer_templates_{key}_content"] = render(key)
    return payload


def with_allow_entry(current: str | None) -> str | None:
    """The redirect allow list with ALLOW_LIST_ENTRY appended, or None when it is already there."""
    entries = [part.strip() for part in (current or "").split(",") if part.strip()]
    if ALLOW_LIST_ENTRY in entries:
        return None
    return ",".join([*entries, ALLOW_LIST_ENTRY])


SAMPLE = {
    "{{ .ConfirmationURL }}": f"https://{PROJECT_REF_DEFAULT}.supabase.co/auth/v1/verify?token=…&type=signup"
                              f"&redirect_to={SITE}/dashboard",
    "{{ .Email }}": "student@example.com",
    "{{ .NewEmail }}": "new.address@example.com",
    "{{ .OldEmail }}": "old.address@example.com",
    "{{ .Token }}": "482913",
    "{{ .Phone }}": "+375 29 000-00-00",
    "{{ .OldPhone }}": "+375 33 000-00-00",
    "{{ .FactorType }}": "приложение-аутентификатор",
    "{{ .Provider }}": "Google",
}


def preview(out_dir: Path) -> list[Path]:
    """Every email with sample values and its subject in a dark strip on top, for a look in a browser."""
    out_dir.mkdir(parents=True, exist_ok=True)
    body_tag = f'<body style="margin:0;padding:0;background:{COLOURS["canvas"]};">'
    written = []
    for key, email in EMAILS.items():
        page, subject = render(key), email["subject"]
        for variable, value in SAMPLE.items():
            page = page.replace(variable, html.escape(value))
            subject = subject.replace(variable, value)
        strip = (f'<div style="font:13px/1.4 monospace;padding:8px 12px;background:#222;color:#eee;">'
                 f"Тема: {html.escape(subject)}</div>")
        path = out_dir / f"{key}.html"
        path.write_text(page.replace(body_tag, body_tag + strip, 1), encoding="utf-8")
        written.append(path)
    return written


# The only fields the job prints: no SMTP host account, user or password.
PRINTABLE = ("site_url", "uri_allow_list", "mailer_autoconfirm", "rate_limit_email_sent", "smtp_sender_name",
             "external_google_enabled")


def _call(method: str, url: str, token: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "meldy-auth-email/1",
    })
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode() or "{}")
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:400]
        raise RuntimeError(f"{method} config/auth: HTTP {error.code} {detail}") from None


def _shown(config: dict) -> str:
    return json.dumps({key: config.get(key) for key in PRINTABLE}, ensure_ascii=False)


def apply() -> None:
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if not token:
        raise SystemExit("::error::Repository secret SUPABASE_ACCESS_TOKEN is not set")
    url = API.format(ref=os.environ.get("PROJECT_REF", "").strip() or PROJECT_REF_DEFAULT)

    before = _call("GET", url, token)
    print("Before:", _shown(before))
    switched_on = sorted(key for key, value in before.items()
                         if key.startswith("mailer_notifications_") and key.endswith("_enabled") and value)
    print("Security notices switched on:", switched_on or "none")

    templates = template_payload()
    changes: dict[str, object] = {**templates, "rate_limit_email_sent": SETTINGS["rate_limit_email_sent"]}
    allow_list = with_allow_entry(before.get("uri_allow_list"))
    if allow_list is not None:
        changes["uri_allow_list"] = allow_list
    _call("PATCH", url, token, changes)
    # The sender name in its own call, so that a refusal of an SMTP field cannot hold back the templates.
    try:
        _call("PATCH", url, token, {"smtp_sender_name": SETTINGS["smtp_sender_name"]})
    except RuntimeError as error:
        print(f"::warning::sender name not changed: {error}")

    after = _call("GET", url, token)
    print("After:", _shown(after))
    wanted = {**changes, **SETTINGS}
    differ = sorted(key for key, value in wanted.items() if after.get(key) != value)
    stored = len([key for key in templates if key not in differ])
    print(f"Subjects and templates stored: {stored}/{len(templates)}")
    if differ:
        raise SystemExit(f"::error::not stored as sent: {differ}")
    print("Every Auth email field matches the repository.")


def main(argv: list[str]) -> None:
    if len(argv) >= 2 and argv[1] == "preview":
        for path in preview(Path(argv[2] if len(argv) > 2 else "auth-email-preview")):
            print(path)
    elif len(argv) >= 2 and argv[1] == "apply":
        apply()
    else:
        raise SystemExit("usage: build.py preview OUT_DIR | apply")


if __name__ == "__main__":
    main(sys.argv)
