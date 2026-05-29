import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { Upload, FileText, X, Zap, Youtube, Video, FileAudio, Layers, CheckCircle2, FileVideo, Music, Camera, Loader2 } from 'lucide-react';
import SettingsPanel from './SettingsPanel';
import { AnalysisSettings } from '../types';
import { hasBadWords } from '../utils/moderation';
import { compressImage } from '../lib/imageCompression';

interface Props {
  settings: AnalysisSettings;
  onSettingsChange: (s: AnalysisSettings) => void;
  onUpload: (f: File | null, youtubeUrl?: string) => void;
  onDemo: () => void;
}

export default function UploadZone({ settings, onSettingsChange, onUpload, onDemo }: Props) {
  const [tab, setTab] = useState<'docs' | 'media'>('docs');
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState('');
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
      setYoutubeUrl('');
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const d = e.dataTransfer.files[0];
    if (d) validateAndSet(d);
  }, []);

  const handleStart = () => { 
    if (tab === 'docs' && file) onUpload(file); 
    if (tab === 'media' && (file || youtubeUrl.trim())) onUpload(file, youtubeUrl.trim() || undefined);
  };

  const isReady = tab === 'docs' ? !!file : (!!file || !!youtubeUrl.trim());

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
         <div className="flex bg-slate-100 dark:bg-slate-900/50 p-1.5 rounded-2xl max-w-sm mx-auto">
            <button
              onClick={() => { setTab('docs'); setFile(null); setYoutubeUrl(''); }}
              className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition ${tab === 'docs' ? 'bg-white dark:bg-slate-800 text-brand-600 dark:text-brand-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
            >
              📄 Документы
            </button>
            <button
              onClick={() => { setTab('media'); setFile(null); setYoutubeUrl(''); }}
              className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition ${tab === 'media' ? 'bg-white dark:bg-slate-800 text-brand-600 dark:text-brand-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
            >
              ▶️ Видео / Аудио
            </button>
         </div>
      </motion.div>

      {/* Шаг 1: Загрузка файла */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="w-7 h-7 rounded-full bg-brand-600 dark:bg-brand-500 text-white text-sm flex items-center justify-center font-bold">1</span>
          <span className="font-medium text-slate-800 dark:text-slate-200">
            {tab === 'docs' ? 'Выберите файл' : 'Вставьте ссылку или загрузите файл'}
          </span>
        </div>

        {tab === 'media' && !file && (
            <div className="mb-4">
                <div className="flex items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm focus-within:ring-2 focus-within:ring-brand-500 transition">
                    <div className="pl-4 text-slate-400"><Youtube className="w-5 h-5"/></div>
                    <input 
                        type="text" 
                        placeholder="Ссылка на YouTube..." 
                        value={youtubeUrl}
                        onChange={e => setYoutubeUrl(e.target.value)}
                        className="w-full py-3 px-3 outline-none text-slate-700 dark:text-slate-200 bg-transparent text-sm placeholder:text-slate-400 dark:placeholder:text-slate-600"
                    />
                    {youtubeUrl && (
                        <button onClick={() => setYoutubeUrl('')} className="pr-4 text-slate-400 hover:text-rose-500 transition">
                            <X className="w-5 h-5"/>
                        </button>
                    )}
                </div>
                {!youtubeUrl && <div className="text-center text-slate-400 dark:text-slate-600 my-4 text-sm font-medium">ИЛИ</div>}
            </div>
        )}

        {(!file && (!youtubeUrl || tab === 'docs')) ? (
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
                <input id="camera-input" type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { if (e.target.files?.[0]) validateAndSet(e.target.files[0]); }} />
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
          onChange={e => { if (e.target.files?.[0]) validateAndSet(e.target.files[0]); }} />
        
        {sizeError && (
          <p className="mt-3 text-center text-sm text-rose-600">{sizeError}</p>
        )}
        
        {tab === 'docs' && (
          <div className="mt-3 text-center">
            <button onClick={onDemo}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600 transition font-medium">
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
          {isReady ? 'Запустить анализ' : 'Сначала выберите файл или вставьте ссылку'}
        </button>
      </motion.div>
    </div>
  );
}
