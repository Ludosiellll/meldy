"""The Supabase Auth emails in supabase/auth_email/build.py: variables, links and wording."""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path

import pytest

BUILD = Path(__file__).resolve().parents[2] / "supabase" / "auth_email" / "build.py"
spec = importlib.util.spec_from_file_location("auth_email_build", BUILD)
build = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(build)

VARIABLE = re.compile(r"\{\{\s*\.(\w+)\s*\}\}")

# Variables Supabase fills in each email (docs: guides/auth/auth-email-templates). Email, Token, TokenHash,
# SiteURL, RedirectTo, Data and ConfirmationURL are common; the rest exist only in one template family.
COMMON = {"Email", "Token", "TokenHash", "SiteURL", "RedirectTo", "Data", "ConfirmationURL"}
ONLY_IN = {
    "NewEmail": {"email_change"},
    "OldEmail": {"email_changed_notification"},
    "Phone": {"phone_changed_notification"},
    "OldPhone": {"phone_changed_notification"},
    "Provider": {"identity_linked_notification", "identity_unlinked_notification"},
    "FactorType": {"mfa_factor_enrolled_notification", "mfa_factor_unenrolled_notification"},
}
LINKED = {"confirmation", "recovery", "magic_link", "email_change", "invite"}


@pytest.mark.parametrize("key", list(build.EMAILS))
def test_every_variable_exists_in_that_email(key):
    email = build.EMAILS[key]
    used = set(VARIABLE.findall(build.render(key))) | set(VARIABLE.findall(email["subject"]))
    for name in used:
        assert name in COMMON or key in ONLY_IN.get(name, set()), f"{key}: {{{{ .{name} }}}} is not filled there"


@pytest.mark.parametrize("key", sorted(LINKED))
def test_link_emails_keep_the_confirmation_link(key):
    page = build.render(key)
    assert page.count('href="{{ .ConfirmationURL }}"') == 2  # the button and the plain link under it


def test_code_email_shows_the_code():
    assert "{{ .Token }}" in build.render("reauthentication")
    assert "{{ .Token }}" in build.EMAILS["reauthentication"]["subject"]


@pytest.mark.parametrize("key", list(build.EMAILS))
def test_no_external_resources_or_old_brand(key):
    page = build.render(key)
    assert "<script" not in page.lower()
    assert "<img" not in page.lower()
    without_variables = VARIABLE.sub("", page)
    assert "http://" not in without_variables and "https://" not in without_variables
    for word in ("StudyForge", "AI-ассистент", "идеальной учебы", "$"):
        assert word not in page, f"{key}: {word!r}"
    assert page.count("{{") == page.count("}}")


@pytest.mark.parametrize("key", list(build.EMAILS))
def test_subjects_are_short_and_name_meldy(key):
    subject = build.EMAILS[key]["subject"]
    assert 0 < len(subject) <= 80
    assert "Meldy" in subject


def test_payload_has_a_subject_and_a_template_for_every_email():
    payload = build.template_payload()
    assert len(payload) == 2 * len(build.EMAILS)
    for key in build.EMAILS:
        assert payload[f"mailer_subjects_{key}"] == build.EMAILS[key]["subject"]
        assert payload[f"mailer_templates_{key}_content"].startswith("<!doctype html>")


def test_settings_change_only_the_sender_name_and_the_hourly_cap():
    assert build.SETTINGS == {"smtp_sender_name": "Meldy", "rate_limit_email_sent": 100}


@pytest.mark.parametrize(
    ("current", "expected"),
    [
        (None, "https://ludosiel-studyforge.hf.space/**"),
        ("", "https://ludosiel-studyforge.hf.space/**"),
        ("https://ludosiel-studyforge.hf.space/auth/callback",
         "https://ludosiel-studyforge.hf.space/auth/callback,https://ludosiel-studyforge.hf.space/**"),
        ("http://localhost:5173/**, https://ludosiel-studyforge.hf.space/**", None),
    ],
)
def test_allow_list_entry_is_only_added(current, expected):
    assert build.with_allow_entry(current) == expected


def test_preview_fills_the_samples(tmp_path):
    paths = build.preview(tmp_path)
    assert len(paths) == len(build.EMAILS)
    page = (tmp_path / "confirmation.html").read_text(encoding="utf-8")
    assert "{{" not in page and "student@example.com" in page and "Тема: Подтвердите почту для Meldy" in page
