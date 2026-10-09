"""Экзамен на всю сессию по ссылке группы: устные предметы — копиями через устный путь (заглушка, её заполняет пакет C).

Пакет C пишет здесь POST /api/containers/{id}/oral-sync: для каждого устного предмета контейнера, у которого у
участника ещё нет копии (container_oral_codes), — уже готовая копия (container_bind_copy, «bound») или новая через
exam_share_bundle → snapshot_from_bundle → plan_copy → exam_share_join → container_bind_copy («copied»); устная
часть автора не готова — «not_ready» (место не занимается), MS002/MS003 — «closed», остальное — «failed».
Токен участника, без сервисного ключа; из exam_shares.py только импорт, сам файл не меняется. Форма ответа —
OralSyncResponse во frontend/src/types/container.ts, пример — contracts/container/oral_sync.json; спецификация —
meldy-notes 10_Project/Exam_Container_Spec_2026-10-09.md §9 и Concept_3_Architecture.md §4.

Пока маршрутов нет: пакет E0 только подключил router в main.py (полные пути — через prefix).
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/api/containers")
