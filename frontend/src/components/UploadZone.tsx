import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { Upload, FileText, X, Zap, Youtube, Video, FileAudio, Layers, CheckCircle2, FileVideo, Music, Camera, Loader2, Link } from 'lucide-react';
import SettingsPanel from './SettingsPanel';
import { AnalysisSettings } from '../types';
import { hasBadWords } from '../utils/moderation';
import { compressImage } from '../lib/imageCompression';

interface Props {
  settings: AnalysisSettings;
  onSettingsChange: (s: AnalysisSettings) => void;
  onUpload: (f: File | null, url?: string) => void;
  onDemo: () => void;
}

export default function UploadZone({ settings, onSettingsChange, onUpload, onDemo }: Props) {
  const [tab, setTab] = useState<'docs' | 'media' | 'url'>('docs');
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [sizeError, setSizeError] = useState('');
  const [isCompressing, setIsCompressing] = useState(false);

  const MAX_SIZE = 50 * 1024 * 1024; // 50MB

  const validateAndSet = async (f: File) => {
    let finalFile = f;
    if (!f.name.includes('.') && f.size > 0 && f.type.startsWith('image/')) {
      finalFile = new File([f], f.name + '.jpg', { type: f.type });
    }

    if (finalFile.type.startsWith('image/')) {
      setIsCompressing(true);
      try {
        finalFile = await compressImage(finalFile);
      } catch (e) {
        console.error('Ошибка сжатия:', e);
      }
      setIsCompressing(false);
    }

    if (finalFile.size > MAX_SIZE) {
      setSizeError(`Файл слишком большой (${(finalFile.size / 1024 / 1024).toFixed(1)} МБ). Максимум — 50 МБ.`);
      setFile(null);
    } else if (hasBadWords(finalFile.name)) {
      setSizeError('Название файла содержит недопустимые слова. Пожалуйста, переименуйте файл.');
      setFile(null);
    } else {
      setSizeError('');
      setFile(finalFile);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const d = e.dataTransfer.files[0];
    if (d) validateAndSet(d);
  }, []);

  const handleStart = () => { 
    if (tab === 'url') {
      if (url.trim()) onUpload(null, url.trim());
    } else {
      if (file) onUpload(file); 
    }
  };

  const isReady = tab === 'url' ? (!!url.trim() && url.includes('.')) : !!file;

  return (
    <div className="py-10 space-y-8">
      {/* Hero */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 dark:text-slate-100 mb-3 leading-tight">
          Превратите любую лекцию<br />в готовый учебный материал
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-lg mb-8">
          Три AI-агента параллельно создают конспект, карточки и тест — за 15 секунд
        </p>
        <div className="flex flex-wrap justify-center gap-6">
          <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
            <FileText className="w-5 h-5 text-indigo-500" />
            <span className="text-sm font-medium">Структурированный конспект</span>
          </div>
          <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
            <Layers className="w-5 h-5 text-amber-500" />
            <span className="text-sm font-medium">Карточки для запоминания</span>
          </div>
          <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <span className="text-sm font-medium">Проверочный тест</span>
          </div>
        </div>
      </motion.div>

      {/* Tabs */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
         <div className="flex bg-slate-100 dark:bg-slate-900/50 p-1.5 rounded-2xl max-w-lg mx-auto">
            <button
              onClick={() => { setTab('docs'); setFile(null); }}
              className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition whitespace-nowrap ${tab === 'docs' ? 'bg-white dark:bg-slate-800 text-brand-600 dark:text-brand-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
            >
              📄 Документы
            </button>
            <button
              onClick={() => { setTab('media'); setFile(null); }}
              className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition whitespace-nowrap ${tab === 'media' ? 'bg-white dark:bg-slate-800 text-brand-600 dark:text-brand-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
            >
              ▶️ Видео / Аудио
            </button>
            <button
              onClick={() => { setTab('url'); setFile(null); }}
              className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition whitespace-nowrap ${tab === 'url' ? 'bg-white dark:bg-slate-800 text-brand-600 dark:text-brand-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
            >
              🔗 Ссылка
            </button>
         </div>
      </motion.div>

      {/* Шаг 1: Загрузка файла */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="w-7 h-7 rounded-full bg-brand-600 dark:bg-brand-500 text-white text-sm flex items-center justify-center font-bold">1</span>
          <span className="font-medium text-slate-800 dark:text-slate-200">
            {tab === 'docs' ? 'Выберите файл' : tab === 'media' ? 'Загрузите файл' : 'Укажите веб-ссылку'}
          </span>
        </div>

        {tab === 'url' ? (
          <div className="card p-8 md:p-12 text-center transition border border-slate-200 dark:border-slate-700 hover:border-brand-300 dark:hover:border-brand-500 bg-white dark:bg-slate-900/60 shadow-lg rounded-2xl relative overflow-hidden">
            {/* Ambient Background Glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 bg-brand-500/10 dark:bg-brand-400/5 blur-3xl rounded-full pointer-events-none" />

            <div className="w-16 h-16 rounded-2xl bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center mx-auto mb-6 relative">
              <Link className="w-7 h-7 text-brand-500 dark:text-brand-400 animate-pulse" />
            </div>

            <h3 className="text-slate-800 dark:text-slate-200 font-bold text-xl mb-2">
              Анализ веб-страницы по ссылке
            </h3>
            <p className="text-slate-400 dark:text-slate-500 text-sm max-w-md mx-auto mb-6">
              Вставьте ссылку на любую статью, новость, главу учебника или Википедию. ИИ автоматически извлечет чистый текст без рекламы и навигации.
            </p>

            <div className="max-w-lg mx-auto relative group">
              <div className="absolute inset-0 bg-gradient-to-r from-brand-500 to-indigo-500 rounded-xl blur opacity-25 group-focus-within:opacity-40 transition duration-300 pointer-events-none" />
              <div className="relative flex items-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden transition-all duration-300 group-focus-within:border-brand-500 shadow-sm">
                <input
                  type="url"
                  placeholder="https://ru.wikipedia.org/wiki/..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full px-4 py-3.5 bg-transparent text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none text-sm md:text-base font-medium"
                />
                {url && (
                  <button 
                    onClick={() => setUrl('')}
                    className="p-1.5 mr-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Quick Presets */}
            <div className="mt-6 flex flex-wrap justify-center items-center gap-3">
              <span className="text-xs text-slate-400 dark:text-slate-500">Примеры:</span>
              <button 
                onClick={() => setUrl('https://ru.wikipedia.org/wiki/Законы_Ньютона')}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 hover:border-brand-300 dark:hover:border-brand-500 transition font-medium"
              >
                Ньютон (Вики)
              </button>
              <button 
                onClick={() => setUrl('https://ru.wikipedia.org/wiki/Фотосинтез')}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 hover:border-brand-300 dark:hover:border-brand-500 transition font-medium"
              >
                Фотосинтез
              </button>
            </div>
          </div>
        ) : !file ? (
          <>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => document.getElementById('fi')?.click()}
              className={'card p-14 text-center cursor-pointer transition border-2 border-dashed ' +
                (dragOver ? 'border-brand-400 bg-brand-50 dark:bg-brand-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-brand-300 dark:hover:border-brand-500 hover:bg-slate-50 dark:hover:bg-slate-800')}
            >
              <div className="w-16 h-16 rounded-2xl bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center mx-auto mb-4">
                {tab === 'docs' ? <Upload className="w-7 h-7 text-brand-500 dark:text-brand-400" /> : <Video className="w-7 h-7 text-brand-500 dark:text-brand-400" />}
              </div>
              <p className="text-slate-800 dark:text-slate-200 font-semibold text-lg mb-1">Перетащите файл сюда</p>
              <p className="text-slate-400 dark:text-slate-500">или нажмите для выбора</p>
              <p className="text-slate-300 dark:text-slate-600 text-sm mt-3">
                {tab === 'docs' ? 'Поддерживаются PDF, DOCX, TXT, MD, JPG, PNG — до 50 МБ' : 'Поддерживаются MP4, MP3, WAV — до 50 МБ'}
              </p>
            </div>
            
            {tab === 'docs' && (
              <div className="mt-3 flex justify-center sm:hidden">
                <button
                  onClick={() => document.getElementById('camera-input')?.click()}
                  className="flex w-full items-center justify-center gap-2 px-4 py-3 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-400 rounded-xl text-sm font-bold transition border border-indigo-100 dark:border-indigo-800"
                >
                  <Camera className="w-5 h-5 text-indigo-500 dark:text-indigo-400" /> Сфотографировать конспект
                </button>
                <input id="camera-input" type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { if (e.target.files?.[0]) { validateAndSet(e.target.files[0]); e.target.value = ''; } }} />
              </div>
            )}
          </>
        ) : file ? (
          <div className="card p-5 flex items-center gap-4">
            {tab === 'docs' ? <FileText className="w-10 h-10 text-brand-500 shrink-0" /> : <FileAudio className="w-10 h-10 text-brand-500 shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="text-slate-900 dark:text-slate-100 font-medium truncate text-lg">{file.name}</p>
              <p className="text-slate-400 dark:text-slate-500 text-sm">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
            <button onClick={() => setFile(null)}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition">
              <X className="w-5 h-5" />
            </button>
          </div>
        ) : null}

        <input id="fi" type="file" className="hidden" 
          accept={tab === 'docs' ? ".pdf,.docx,.txt,.md,.doc,.jpg,.jpeg,.png" : ".mp4,.mp3,.wav,.mpeg,.m4a"}
          onChange={e => { if (e.target.files?.[0]) { validateAndSet(e.target.files[0]); e.target.value = ''; } }} />
        
        {sizeError && (
          <p className="mt-3 text-center text-sm text-rose-600">{sizeError}</p>
        )}
        
        {tab === 'docs' && (
          <div className="mt-3 text-center">
            <button onClick={onDemo}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:bg-slate-600 transition font-medium">
              ▶ Демо без файла
            </button>
          </div>
        )}
      </motion.div>

      {/* Шаг 2: Настройки */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="w-7 h-7 rounded-full bg-brand-600 dark:bg-brand-500 text-white text-sm flex items-center justify-center font-bold">2</span>
          <span className="font-medium text-slate-800 dark:text-slate-200">Настройте параметры</span>
        </div>
        <div className="card p-6">
          <SettingsPanel settings={settings} onChange={onSettingsChange} />
        </div>
      </motion.div>

      {/* Кнопка запуска */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
        <button
          onClick={handleStart}
          disabled={!isReady}
          className={'w-full h-14 rounded-xl font-semibold flex items-center justify-center gap-2 transition text-base ' +
            (isReady
              ? 'bg-brand-600 hover:bg-brand-700 text-white cursor-pointer shadow-sm hover:shadow-md active:scale-[1.01]'
              : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed')}
        >
          <Zap className="w-5 h-5" />
          {isReady ? 'Запустить анализ' : tab === 'url' ? 'Введите ссылку на страницу' : 'Сначала выберите файл'}
        </button>
      </motion.div>
    </div>
  );
}

