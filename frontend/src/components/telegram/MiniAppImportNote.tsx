import { useLocation } from 'react-router-dom';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { openOutside } from '../../lib/telegram/miniApp';
import './miniApp.css';

/** What the import page says inside Telegram (App.tsx ImportRoute). */
export const IMPORT_NOTE = {
  title: 'Загружать файлы удобнее на сайте',
  text: 'Откройте Meldy в браузере: там можно выбрать файлы с вопросами и билетами. Новый экзамен сразу появится и здесь.',
  button: 'Открыть сайт в браузере',
} as const;

/**
 * /exams/import inside Telegram (meldy-notes 10_Project/Telegram_Mini_App_Spec_2026-10-10.md §5): files are added on
 * the site. The button opens the same page in the browser (Telegram's openLink), with the address's query
 * (?from=c:<id> of «Добавить предмет»); the Mini App stays open.
 */
export default function MiniAppImportNote() {
  useDocumentTitle('Новый экзамен');
  const { search } = useLocation();
  return (
    <div className="sf-page tg-note">
      <h1 className="tg-note-h">{IMPORT_NOTE.title}</h1>
      <p className="tg-note-p">{IMPORT_NOTE.text}</p>
      <button type="button" className="sf-primary tg-note-go" onClick={() => openOutside(`${window.location.origin}/exams/import${search}`)}>
        {IMPORT_NOTE.button}
      </button>
    </div>
  );
}
