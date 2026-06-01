import { Material } from '../types';
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { 
  Search, BookOpen, Trash2, Plus, Headphones, Globe, Lock, EyeOff, Eye,
  Folder, FolderPlus, Check, CheckSquare, Square, BarChart3, ChevronDown, ChevronUp,
  BookOpenCheck, Code2, Brain, TrendingUp, Star, Award, Flame, X, Sparkles, FolderOpen,
  ArrowRight, ShieldCheck, ChevronRight, ChevronLeft, Volume2, Play, Pause, RefreshCw, Grab
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useAuth } from '../hooks/useAuth';
import { useConfirm } from '../contexts/ConfirmContext';
import { getMaterials, deleteMaterial, updateMaterialVisibility } from '../api/materials';
import { getAssignedMaterials, joinGroup } from '../api/groups';
import { CustomSelect } from '../components/CustomSelect';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { playTTS, stopTTS, pauseTTS, resumeTTS, getTTSPlaybackRate, setTTSPlaybackRate } from '../utils/tts';

interface Folder {
  id: string;
  name: string;
  color: string;
  icon: string;
}

const colorSchemes: Record<string, { bg: string; text: string; border: string; activeBg: string; activeBorder: string; dot: string; hoverRing: string }> = {
  indigo: {
    bg: 'bg-indigo-50 dark:bg-indigo-950/30',
    text: 'text-indigo-600 dark:text-indigo-400',
    border: 'border-indigo-100 dark:border-indigo-900/30',
    activeBg: 'bg-indigo-600 text-white',
    activeBorder: 'border-indigo-600',
    dot: '#4f46e5',
    hoverRing: 'ring-indigo-500/30 dark:ring-indigo-500/20'
  },
  rose: {
    bg: 'bg-rose-50 dark:bg-rose-950/30',
    text: 'text-rose-600 dark:text-rose-400',
    border: 'border-rose-100 dark:border-rose-900/30',
    activeBg: 'bg-rose-600 text-white',
    activeBorder: 'border-rose-600',
    dot: '#e11d48',
    hoverRing: 'ring-rose-500/30 dark:ring-rose-500/20'
  },
  amber: {
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    text: 'text-amber-600 dark:text-amber-400',
    border: 'border-amber-100 dark:border-amber-900/30',
    activeBg: 'bg-amber-600 text-white',
    activeBorder: 'border-amber-600',
    dot: '#d97706',
    hoverRing: 'ring-amber-500/30 dark:ring-amber-500/20'
  },
  emerald: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    text: 'text-emerald-600 dark:text-emerald-400',
    border: 'border-emerald-100 dark:border-emerald-900/30',
    activeBg: 'bg-emerald-600 text-white',
    activeBorder: 'border-emerald-600',
    dot: '#059669',
    hoverRing: 'ring-emerald-500/30 dark:ring-emerald-500/20'
  },
  sky: {
    bg: 'bg-sky-50 dark:bg-sky-950/30',
    text: 'text-sky-600 dark:text-sky-400',
    border: 'border-sky-100 dark:border-sky-900/30',
    activeBg: 'bg-sky-600 text-white',
    activeBorder: 'border-sky-600',
    dot: '#0284c7',
    hoverRing: 'ring-sky-500/30 dark:ring-sky-500/20'
  },
  violet: {
    bg: 'bg-violet-50 dark:bg-violet-950/30',
    text: 'text-violet-600 dark:text-violet-400',
    border: 'border-violet-100 dark:border-violet-900/30',
    activeBg: 'bg-violet-600 text-white',
    activeBorder: 'border-violet-600',
    dot: '#7c3aed',
    hoverRing: 'ring-violet-500/30 dark:ring-violet-500/20'
  },
  orange: {
    bg: 'bg-orange-50 dark:bg-orange-950/30',
    text: 'text-orange-600 dark:text-orange-400',
    border: 'border-orange-100 dark:border-orange-900/30',
    activeBg: 'bg-orange-600 text-white',
    activeBorder: 'border-orange-600',
    dot: '#ea580c',
    hoverRing: 'ring-orange-500/30 dark:ring-orange-500/20'
  },
  teal: {
    bg: 'bg-teal-50 dark:bg-teal-950/30',
    text: 'text-teal-600 dark:text-teal-400',
    border: 'border-teal-100 dark:border-teal-900/30',
    activeBg: 'bg-teal-600 text-white',
    activeBorder: 'border-teal-600',
    dot: '#0d9488',
    hoverRing: 'ring-teal-500/30 dark:ring-teal-500/20'
  }
};

const iconMap: Record<string, any> = {
  Folder, BookOpen, Code2, Brain, TrendingUp, Star, Award, Flame, Sparkles
};

const defaultFolders: Folder[] = [
  { id: 'folder_1', name: 'Гуманитарные науки', color: 'rose', icon: 'Brain' },
  { id: 'folder_2', name: 'Технические науки', color: 'indigo', icon: 'Code2' },
  { id: 'folder_3', name: 'Избранное', color: 'amber', icon: 'Star' }
];

export default function Library() {
  const { user } = useAuth();
  const { confirm } = useConfirm();
  const navigate = useNavigate();
  const [materials, setMaterials] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const [showJoinModal, setShowJoinModal] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [classNickname, setClassNickname] = useState('');
  const [joinError, setJoinError] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  // Folder states
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>(''); // "" means all
  const [folderAssignments, setFolderAssignments] = useState<Record<string, string>>({}); // { materialId: folderId }
  const [peekMaterial, setPeekMaterial] = useState<any | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isMultiSelectActive, setIsMultiSelectActive] = useState(false);
  const [showStats, setShowStats] = useState(false);
  
  // Drag & Drop visual states
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [draggedOverFolderId, setDraggedOverFolderId] = useState<string | null>(null);

  // Folder Creation Modal States
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState('indigo');
  const [newFolderIcon, setNewFolderIcon] = useState('Folder');

  // Single card folder dropdown control
  const [activeFolderDropdownId, setActiveFolderDropdownId] = useState<string | null>(null);

  // Batch actions folder selection dropdown
  const [showBatchFolderSelect, setShowBatchFolderSelect] = useState(false);

  // Quick peek drawer states
  const [drawerTab, setDrawerTab] = useState<'conspectus' | 'podcast' | 'flashcards'>('conspectus');
  const [peekSpeakingIndex, setPeekSpeakingIndex] = useState<number>(-1);
  const [peekIsPlaying, setPeekIsPlaying] = useState<boolean>(false);
  const [, setPeekPlaybackRate] = useState<number>(1.0);
  const [cardIndex, setCardIndex] = useState<number>(0);
  const [isFlipped, setIsFlipped] = useState<boolean>(false);

  // Handle ?join=CODE parameter
  useEffect(() => {
    const joinCode = searchParams.get('join');
    if (joinCode) {
      setInviteCode(joinCode);
      setShowJoinModal(true);
      setSearchParams({});
    }
  }, [searchParams, setSearchParams]);

  // Load Main Data
  const loadData = async () => {
    if (!user) return;
    
    const cached = localStorage.getItem(`library_cache_${user.id}`);
    if (cached) {
      try {
        setMaterials(JSON.parse(cached));
        setLoading(false);
      } catch (e) {}
    } else {
      setLoading(true);
    }
    
    try {
      const [myMats, assignedMats] = await Promise.all([
        getMaterials(user.id),
        getAssignedMaterials(user.id)
      ]);
      const all = [...myMats, ...assignedMats];
      const unique = Array.from(new Map(all.map(m => [m.id, m])).values());
      
      const hidden = JSON.parse(localStorage.getItem(`hidden_assignments_${user.id}`) || '[]');
      const visible = unique.filter(m => !hidden.includes(m.id));
      
      setMaterials(visible);
      localStorage.setItem(`library_cache_${user.id}`, JSON.stringify(visible));
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [user?.id]);

  // Load Folders Data (Always loading immediately with default fallback to avoid blank sections)
  useEffect(() => {
    const userId = user?.id || 'default_user';
    const storedFolders = localStorage.getItem(`library_folders_${userId}`);
    if (storedFolders) {
      try {
        setFolders(JSON.parse(storedFolders));
      } catch (e) {
        setFolders(defaultFolders);
      }
    } else {
      setFolders(defaultFolders);
      localStorage.setItem(`library_folders_${userId}`, JSON.stringify(defaultFolders));
    }

    const storedAssignments = localStorage.getItem(`library_folder_assignments_${userId}`);
    if (storedAssignments) {
      try {
        setFolderAssignments(JSON.parse(storedAssignments));
      } catch (e) {}
    }
  }, [user?.id]);

  // Reset tab to conspectus on changing material
  useEffect(() => {
    setDrawerTab('conspectus');
  }, [peekMaterial?.id]);

  // Auto clean quick-peek audio synthesis when drawer changes/unmounts
  useEffect(() => {
    return () => {
      stopTTS();
    };
  }, [peekMaterial]);

  const subjects = [...new Set(materials.map(m => m.subject).filter(Boolean))];

  // Filtering materials by subject, search bar AND selected folder
  const filtered = materials.filter(m => {
    const matchSearch = m.title.toLowerCase().includes(search.toLowerCase());
    const matchSubject = !subjectFilter || m.subject === subjectFilter;
    const matchFolder = !selectedFolderId || folderAssignments[m.id] === selectedFolderId;
    return matchSearch && matchSubject && matchFolder;
  });

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!(await confirm({ title: 'Удаление', message: 'Удалить этот материал навсегда?', type: 'danger' }))) return;
    await deleteMaterial(id);
    setMaterials(prev => prev.filter(m => m.id !== id));
    
    // Clean assignment
    if (folderAssignments[id]) {
      const copy = { ...folderAssignments };
      delete copy[id];
      setFolderAssignments(copy);
      const userId = user?.id || 'default_user';
      localStorage.setItem(`library_folder_assignments_${userId}`, JSON.stringify(copy));
    }
  };

  const handleHideAssignment = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!user) return;
    const hidden = JSON.parse(localStorage.getItem(`hidden_assignments_${user.id}`) || '[]');
    hidden.push(id);
    localStorage.setItem(`hidden_assignments_${user.id}`, JSON.stringify(hidden));
    
    const newMaterials = materials.filter(m => m.id !== id);
    setMaterials(newMaterials);
    localStorage.setItem(`library_cache_${user.id}`, JSON.stringify(newMaterials));
    toast.success('Задание скрыто из библиотеки');
  };

  const handleTogglePublic = async (e: React.MouseEvent, material: any) => {
    e.stopPropagation();
    const newStatus = !material.is_public;
    await updateMaterialVisibility(material.id, newStatus);
    setMaterials(prev => prev.map(m => m.id === material.id ? { ...m, is_public: newStatus } : m));
  };

  const handleJoinGroup = async () => {
    if (!user || !inviteCode.trim() || !classNickname.trim()) return;
    setJoinError('');
    const ok = await joinGroup(user.id, inviteCode.trim(), classNickname.trim());
    if (ok) {
      setShowJoinModal(false);
      setInviteCode('');
      setClassNickname('');
      loadData();
      toast.success('Успешно присоединились к классу!');
      navigate('/teacher');
    } else {
      setJoinError('Неверный код или вы уже состоите в группе.');
    }
  };

  // Folder actions
  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    const userId = user?.id || 'default_user';
    const newFolder: Folder = {
      id: 'folder_' + Date.now(),
      name: newFolderName.trim(),
      color: newFolderColor,
      icon: newFolderIcon
    };
    const updated = [...folders, newFolder];
    setFolders(updated);
    localStorage.setItem(`library_folders_${userId}`, JSON.stringify(updated));
    toast.success('Папка создана!');
    setNewFolderName('');
    setShowCreateFolderModal(false);
  };

  const assignMaterialToFolder = (materialId: string, folderId: string) => {
    const newAssignments = { ...folderAssignments };
    if (folderId) {
      newAssignments[materialId] = folderId;
    } else {
      delete newAssignments[materialId];
    }
    setFolderAssignments(newAssignments);
    const userId = user?.id || 'default_user';
    localStorage.setItem(`library_folder_assignments_${userId}`, JSON.stringify(newAssignments));

    const mat = materials.find(m => m.id === materialId);
    const folder = folders.find(f => f.id === folderId);
    if (folder && mat) {
      toast.success(`Материал «${mat.title}» перенесен в папку «${folder.name}»!`);
    } else {
      toast.success('Материал убран из папки');
    }
  };

  // Native HTML5 Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, cardId: string) => {
    setDraggingCardId(cardId);
    e.dataTransfer.setData('text/plain', cardId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggingCardId(null);
    setDraggedOverFolderId(null);
  };

  const handleDragEnter = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    setDraggedOverFolderId(folderId);
  };

  const handleDragLeave = () => {
    setDraggedOverFolderId(null);
  };

  const handleDrop = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    const cardId = e.dataTransfer.getData('text/plain') || draggingCardId;
    if (cardId) {
      assignMaterialToFolder(cardId, folderId);
    }
    setDraggedOverFolderId(null);
    setDraggingCardId(null);
  };

  // Multiple selection handlers
  const toggleSelectId = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!(await confirm({ 
      title: 'Массовое удаление', 
      message: `Вы действительно хотите навсегда удалить выбранные материалы (${selectedIds.length} шт.)?`, 
      type: 'danger' 
    }))) return;

    try {
      await Promise.all(selectedIds.map(id => deleteMaterial(id)));
      setMaterials(prev => prev.filter(m => !selectedIds.includes(m.id)));
      
      // Clear folder assignments
      const copy = { ...folderAssignments };
      selectedIds.forEach(id => delete copy[id]);
      setFolderAssignments(copy);
      const userId = user?.id || 'default_user';
      localStorage.setItem(`library_folder_assignments_${userId}`, JSON.stringify(copy));

      toast.success('Выбранные материалы удалены!');
      setSelectedIds([]);
      setIsMultiSelectActive(false);
    } catch (e) {
      toast.error('Произошла ошибка при массовом удалении');
    }
  };

  const handleBatchPublish = async () => {
    if (selectedIds.length === 0) return;
    try {
      await Promise.all(selectedIds.map(id => updateMaterialVisibility(id, true)));
      setMaterials(prev => prev.map(m => selectedIds.includes(m.id) ? { ...m, is_public: true } : m));
      toast.success('Выбранные материалы успешно опубликованы!');
      setSelectedIds([]);
      setIsMultiSelectActive(false);
    } catch (e) {
      toast.error('Ошибка при публикации');
    }
  };

  const handleBatchMoveToFolder = (folderId: string) => {
    if (selectedIds.length === 0) return;
    const newAssignments = { ...folderAssignments };
    
    selectedIds.forEach(id => {
      if (folderId) {
        newAssignments[id] = folderId;
      } else {
        delete newAssignments[id];
      }
    });

    setFolderAssignments(newAssignments);
    const userId = user?.id || 'default_user';
    localStorage.setItem(`library_folder_assignments_${userId}`, JSON.stringify(newAssignments));
    toast.success(folderId ? 'Материалы перемещены в папку!' : 'Материалы убран из папок!');
    setSelectedIds([]);
    setIsMultiSelectActive(false);
    setShowBatchFolderSelect(false);
  };

  // Quick peek drawer player controllers
  const playPeekPodcast = () => {
    const lines = peekMaterial?.summary_json?.podcast || [];
    if (lines.length === 0) return;

    if (peekIsPlaying) {
      pauseTTS();
      setPeekIsPlaying(false);
      return;
    }

    const nextIdx = peekSpeakingIndex === -1 || peekSpeakingIndex >= lines.length ? 0 : peekSpeakingIndex;
    
    const speakNextLine = (idx: number) => {
      if (idx >= lines.length) {
        stopTTS();
        setPeekIsPlaying(false);
        setPeekSpeakingIndex(-1);
        return;
      }

      setPeekSpeakingIndex(idx);
      const line = lines[idx];
      const voice = line.speaker === 'Макс' ? 'male' : 'female';

      playTTS(
        line.text,
        voice,
        () => {
          speakNextLine(idx + 1);
        },
        (err) => {
          console.error(err);
          setPeekIsPlaying(false);
          setPeekSpeakingIndex(-1);
        }
      );
    };

    setPeekIsPlaying(true);
    speakNextLine(nextIdx);
  };

  const stopPeekPodcast = () => {
    stopTTS();
    setPeekIsPlaying(false);
    setPeekSpeakingIndex(-1);
  };

  const playFromLine = (idx: number) => {
    stopTTS();
    setPeekSpeakingIndex(idx);
    const lines = peekMaterial?.summary_json?.podcast || [];
    
    const speakNextLine = (currentIdx: number) => {
      if (currentIdx >= lines.length) {
        stopTTS();
        setPeekIsPlaying(false);
        setPeekSpeakingIndex(-1);
        return;
      }

      setPeekSpeakingIndex(currentIdx);
      const line = lines[currentIdx];
      const voice = line.speaker === 'Макс' ? 'male' : 'female';

      playTTS(
        line.text,
        voice,
        () => {
          speakNextLine(currentIdx + 1);
        },
        (err) => {
          console.error(err);
          setPeekIsPlaying(false);
          setPeekSpeakingIndex(-1);
        }
      );
    };

    setPeekIsPlaying(true);
    speakNextLine(idx);
  };

  // Metrics computing reactively
  const totalCards = materials.reduce((acc, m) => acc + (m.flashcards_json?.flashcards?.length || 0), 0);
  const totalPodcasts = materials.filter(m => m.summary_json?.podcast?.length > 0).length;
  const avgGrade = localStorage.getItem('avg_exam_score') || '84';
  const folderMaterialsCount = (folderId: string) => {
    return materials.filter(m => folderAssignments[m.id] === folderId).length;
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
            <BookOpen className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            Библиотека знаний
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium">Управляйте лекциями, создавайте папки и изучайте конспекты</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setShowStats(!showStats)}
            className={`flex items-center gap-2 px-4 py-2 border rounded-xl text-sm font-bold transition-all ${
              showStats 
                ? 'bg-indigo-550 border-indigo-200 text-indigo-600 dark:bg-indigo-950/20 dark:border-indigo-900 dark:text-indigo-400' 
                : 'bg-white border-slate-200 text-slate-700 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            Статистика
            {showStats ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          
          <button
            onClick={() => setShowJoinModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-sm font-bold transition"
          >
            Ввести код класса
          </button>
          
          <button
            onClick={() => navigate('/analyze')}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold transition shadow-md hover:shadow-indigo-500/10 active:translate-y-0.5"
          >
            <Plus className="w-4 h-4" />
            Новый анализ
          </button>
        </div>
      </div>

      {/* Joint Group Modal */}
      {showJoinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-sm shadow-2xl border border-slate-200 dark:border-slate-800">
            <h3 className="font-bold text-xl text-slate-900 dark:text-slate-100 mb-2">Присоединиться к группе</h3>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">Введите код класса и ваши настоящие имя и фамилию (для преподавателя).</p>
            <input 
              autoFocus
              value={inviteCode} 
              onChange={e => setInviteCode(e.target.value.toUpperCase())}
              placeholder="Код: A7B-9X2" 
              className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl mb-3 font-mono text-center text-xl uppercase tracking-widest focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900 dark:text-slate-100" 
            />
            <input 
              value={classNickname} 
              onChange={e => setClassNickname(e.target.value)}
              placeholder="Ваши Имя и Фамилия" 
              className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl mb-2 text-center text-lg focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900 dark:text-slate-100" 
            />
            {joinError && <p className="text-rose-500 text-sm mb-4 text-center">{joinError}</p>}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowJoinModal(false)} className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition">Отмена</button>
              <button onClick={handleJoinGroup} disabled={!inviteCode.trim() || !classNickname.trim()} className="flex-1 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition">Вступить</button>
            </div>
          </div>
        </div>
      )}

      {/* Smart Insights Collapsible Dashboard */}
      <AnimatePresence>
        {showStats && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-5 bg-gradient-to-r from-indigo-500/5 to-purple-500/5 dark:from-indigo-950/10 dark:to-purple-950/10 rounded-2xl border border-indigo-100/50 dark:border-slate-800/80">
              
              <div className="p-4 bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-4">
                <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 rounded-lg flex items-center justify-center">
                  <BookOpen className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-2xl font-black text-slate-800 dark:text-slate-100">{materials.length}</p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">Материалы</p>
                </div>
              </div>

              <div className="p-4 bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-4">
                <div className="w-10 h-10 bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 rounded-lg flex items-center justify-center">
                  <Brain className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <p className="text-2xl font-black text-slate-800 dark:text-slate-100">{totalCards}</p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">Умные карточки</p>
                </div>
              </div>

              <div className="p-4 bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-4">
                <div className="w-10 h-10 bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400 rounded-lg flex items-center justify-center">
                  <Headphones className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-2xl font-black text-slate-800 dark:text-slate-100">{totalPodcasts}</p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">AI Подкасты</p>
                </div>
              </div>

              <div className="p-4 bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-4">
                <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 rounded-lg flex items-center justify-center">
                  <Award className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-2xl font-black text-slate-800 dark:text-slate-100">{avgGrade}%</p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">Успеваемость</p>
                </div>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Folders and Collections bar */}
      <div className="space-y-3 bg-slate-50/50 dark:bg-slate-900/10 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-widest flex items-center gap-1.5">
              <FolderOpen className="w-4 h-4 text-indigo-500 animate-bounce" />
              Папки и разделы
            </h3>
            <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold hidden md:inline ml-2 bg-indigo-50 dark:bg-indigo-950/30 px-2.5 py-0.5 rounded-full">
              💡 Перетащите карточку лекции на нужную папку для группировки!
            </span>
          </div>
          <button 
            onClick={() => setShowCreateFolderModal(true)}
            className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-850 font-black transition"
          >
            <FolderPlus className="w-3.5 h-3.5 animate-pulse" />
            Создать папку
          </button>
        </div>

        {/* Horizontal folders scroll panel */}
        <div className="flex overflow-x-auto whitespace-nowrap scrollbar-none pb-2 gap-2.5 scroll-smooth -mx-4 px-4 md:mx-0 md:px-0">
          
          {/* Virtual "All folders" target */}
          <button
            onDragOver={(e) => e.preventDefault()}
            onDragEnter={(e) => handleDragEnter(e, 'all')}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, '')}
            onClick={() => setSelectedFolderId('')}
            className={`px-4 py-2.5 rounded-xl border-2 text-xs font-black transition-all flex items-center gap-2 relative ${
              selectedFolderId === ''
                ? 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-600/10'
                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            } ${
              draggedOverFolderId === 'all'
                ? 'scale-105 ring-4 ring-offset-2 dark:ring-offset-slate-900 ring-indigo-500 border-indigo-500 shadow-lg'
                : draggingCardId !== null
                  ? 'border-dashed border-indigo-400 dark:border-indigo-600 animate-pulse'
                  : ''
            }`}
          >
            <BookOpen className="w-4 h-4" />
            Все материалы
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-extrabold ${selectedFolderId === '' ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
              {materials.length}
            </span>
          </button>

          {folders.map(f => {
            const scheme = colorSchemes[f.color] || colorSchemes.indigo;
            const FolderIcon = iconMap[f.icon] || Folder;
            const active = selectedFolderId === f.id;
            const isDraggedOver = draggedOverFolderId === f.id;
            const isAnyCardDragging = draggingCardId !== null;
            const count = folderMaterialsCount(f.id);

            return (
              <button
                key={f.id}
                onDragOver={(e) => e.preventDefault()}
                onDragEnter={(e) => handleDragEnter(e, f.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, f.id)}
                onClick={() => setSelectedFolderId(f.id)}
                className={`px-4 py-2.5 rounded-xl border-2 text-xs font-black transition-all flex items-center gap-2 relative ${
                  active
                    ? `${scheme.activeBg} ${scheme.activeBorder} shadow-md`
                    : `bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-800`
                } ${
                  isDraggedOver 
                    ? `scale-105 ring-4 ring-offset-2 dark:ring-offset-slate-900 ${scheme.hoverRing} ${scheme.activeBorder} shadow-lg`
                    : isAnyCardDragging
                      ? `border-dashed ${scheme.activeBorder} animate-pulse`
                      : ''
                }`}
              >
                <FolderIcon className={`w-4 h-4 ${active ? 'text-white' : scheme.text}`} />
                {f.name}
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-extrabold ${active ? 'bg-white/20 text-white' : `${scheme.bg} ${scheme.text}`}`}>
                  {count}
                </span>
              </button>
            );
          })}

          <button
            onClick={() => setShowCreateFolderModal(true)}
            className="px-4 py-2.5 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-800 text-slate-400 hover:text-slate-600 hover:border-slate-400 dark:hover:border-slate-700 transition flex items-center gap-1.5 text-xs font-bold"
          >
            <Plus className="w-4 h-4" />
            Добавить папку
          </button>
        </div>
      </div>

      {/* Filters & Actions bar */}
      <div className="flex flex-col sm:flex-row gap-3 relative z-20 items-stretch sm:items-center">
        <div className="relative flex-grow">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по названию..."
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition text-slate-900 dark:text-slate-100"
          />
        </div>

        {/* Constraining wrapper container to ensure selection dropdown matches desktop layout size */}
        {subjects.length > 0 && (
          <div className="w-full sm:w-56 shrink-0">
            <CustomSelect
              value={subjectFilter}
              onChange={val => setSubjectFilter(val)}
              options={[
                { value: '', label: 'Все предметы' },
                ...subjects.map(s => ({ value: s, label: s }))
              ]}
              className="px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 shadow-sm"
            />
          </div>
        )}

        <button
          onClick={() => {
            setIsMultiSelectActive(!isMultiSelectActive);
            setSelectedIds([]);
          }}
          className={`px-4 py-2.5 rounded-xl border text-sm font-bold transition flex items-center justify-center gap-2 ${
            isMultiSelectActive 
              ? 'bg-indigo-600 border-indigo-600 text-white' 
              : 'bg-white border-slate-200 text-slate-700 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          {isMultiSelectActive ? (
            <>
              <Check className="w-4 h-4" />
              Готово
            </>
          ) : (
            <>
              <CheckSquare className="w-4 h-4" />
              Пакетный выбор
            </>
          )}
        </button>
      </div>

      {/* Loading Skeleton */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 animate-pulse">
              <div className="flex gap-2 mb-3">
                <div className="h-4 w-24 bg-slate-200 dark:bg-slate-800 rounded"></div>
                <div className="h-4 w-16 bg-slate-200 dark:bg-slate-800 rounded"></div>
              </div>
              <div className="h-6 w-3/4 bg-slate-200 dark:bg-slate-800 rounded mb-4"></div>
              <div className="flex gap-3 mb-6">
                <div className="h-4 w-10 bg-slate-200 dark:bg-slate-800 rounded"></div>
                <div className="h-4 w-10 bg-slate-200 dark:bg-slate-800 rounded"></div>
                <div className="h-4 w-16 bg-slate-200 dark:bg-slate-800 rounded ml-auto"></div>
              </div>
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800/60 flex justify-between">
                <div className="h-3 w-20 bg-slate-200 dark:bg-slate-800 rounded"></div>
                <div className="h-3 w-16 bg-slate-200 dark:bg-slate-800 rounded"></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && materials.length === 0 && (
        <div className="text-center py-20 bg-slate-50/50 dark:bg-slate-900/20 rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-800 p-8">
          <BookOpen className="w-16 h-16 text-slate-300 dark:text-slate-650 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-slate-700 dark:text-slate-300 mb-2">Библиотека пуста</h2>
          <p className="text-slate-400 dark:text-slate-500 text-sm mb-6 max-w-sm mx-auto">Загрузите или проанализируйте первую лекцию, чтобы начать обучение</p>
          <button
            onClick={() => navigate('/analyze')}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold transition shadow-md"
          >
            Загрузить материал →
          </button>
        </div>
      )}

      {/* Materials Grid */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(m => {
            const fcCount = m.flashcards_json?.flashcards?.length || 0;
            const qCount = m.quiz_json?.quiz?.length || 0;
            const hasPodcast = m.summary_json?.podcast?.length > 0;
            const isSelected = selectedIds.includes(m.id);
            const isAssigned = (m as any).is_assigned;
            
            return (
              <div
                key={m.id}
                draggable={!isMultiSelectActive}
                onDragStart={(e) => handleDragStart(e, m.id)}
                onDragEnd={handleDragEnd}
                onClick={() => {
                  if (isMultiSelectActive) {
                    toggleSelectId(m.id);
                  } else {
                    navigate('/library/' + m.id);
                  }
                }}
                className={`card p-5 cursor-pointer relative transition-all group overflow-visible border-2 rounded-2xl flex flex-col justify-between ${
                  isSelected 
                    ? 'border-indigo-600 dark:border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/15 shadow-md scale-[0.99]' 
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:shadow-md hover:scale-[1.01]'
                } ${draggingCardId === m.id ? 'opacity-50 scale-95 border-dashed border-indigo-400' : ''}`}
              >
                {/* Drag handle helper icon visible on card hover */}
                {!isMultiSelectActive && (
                  <div className="absolute top-4 right-12 z-10 opacity-0 group-hover:opacity-100 transition p-1 bg-slate-50 dark:bg-slate-800 rounded-lg text-slate-400 dark:text-slate-500 cursor-grab" title="Потяните для переноса в папку">
                    <Grab className="w-3.5 h-3.5" />
                  </div>
                )}

                {/* Checkbox overlay when multi-select mode is active */}
                {isMultiSelectActive && (
                  <div 
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelectId(m.id);
                    }}
                    className="absolute top-4 left-4 z-10 p-0.5 bg-white dark:bg-slate-900 rounded-lg shadow-sm"
                  >
                    {isSelected ? (
                      <CheckSquare className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    ) : (
                      <Square className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                    )}
                  </div>
                )}

                {/* Main Card Content */}
                <div className={`space-y-3 ${isMultiSelectActive ? 'pl-8' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {isAssigned && (
                          <span className="inline-block px-2 py-0.5 bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-amber-400 text-[10px] font-bold rounded uppercase tracking-wider">
                            Преподаватель
                          </span>
                        )}
                        {m.subject && (
                          <span className="inline-block px-2 py-0.5 bg-indigo-100 dark:bg-indigo-950/30 text-indigo-750 dark:text-indigo-400 text-[10px] font-bold rounded uppercase tracking-wider truncate max-w-[140px]">
                            {m.subject}
                          </span>
                        )}
                        {!isAssigned && (
                          <button
                            onClick={e => handleTogglePublic(e, m)}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider transition ${
                              m.is_public
                                ? 'bg-emerald-150 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 border border-slate-200 dark:border-slate-700'
                            }`}
                            title={m.is_public ? 'Опубликовано' : 'Сделать общедоступным'}
                          >
                            {m.is_public ? <Globe className="w-3 h-3 text-emerald-600" /> : <Lock className="w-3 h-3 text-slate-400" />}
                            {m.is_public ? 'Сеть' : 'Поделиться'}
                          </button>
                        )}
                      </div>
                      
                      <h3 className="font-extrabold text-slate-900 dark:text-slate-100 leading-snug line-clamp-2 break-words hover:text-indigo-600 transition">
                        {m.title}
                      </h3>
                    </div>

                    {/* Actions toolbar */}
                    <div className="flex items-center gap-1 shrink-0 relative z-30">
                      {/* Folder assignment dropdown trigger */}
                      {!isMultiSelectActive && !isAssigned && (
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveFolderDropdownId(activeFolderDropdownId === m.id ? null : m.id);
                            }}
                            className={`p-1.5 rounded-lg border transition ${
                              folderAssignments[m.id]
                                ? 'bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-850'
                                : 'bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-700 hover:text-indigo-600'
                            }`}
                            title="Положить в папку"
                          >
                            <Folder className="w-3.5 h-3.5" />
                          </button>
                          
                          {activeFolderDropdownId === m.id && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.95, y: -8 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.95, y: -8 }}
                              transition={{ duration: 0.12 }}
                              className="absolute right-0 mt-2 z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-2 w-52 flex flex-col gap-1 text-slate-800 dark:text-slate-100"
                            >
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  assignMaterialToFolder(m.id, '');
                                  setActiveFolderDropdownId(null);
                                }}
                                className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap transition-colors"
                              >
                                Без папки (убрать)
                              </button>
                              <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />
                              {folders.map(f => (
                                <button
                                  key={f.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    assignMaterialToFolder(m.id, f.id);
                                    setActiveFolderDropdownId(null);
                                  }}
                                  className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded-xl text-xs font-semibold flex items-center gap-2.5 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white transition-colors"
                                >
                                  <div 
                                    className="w-2.5 h-2.5 rounded-full shrink-0" 
                                    style={{ backgroundColor: colorSchemes[f.color]?.dot || '#4f46e5' }} 
                                  />
                                  <span>{f.name}</span>
                                </button>
                              ))}
                            </motion.div>
                          )}
                        </div>
                      )}

                      {/* Quick peek trigger */}
                      {!isMultiSelectActive && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPeekMaterial(m);
                          }}
                          className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-lg transition"
                          title="Быстрый просмотр"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      )}

                      {!isMultiSelectActive && !isAssigned && (
                        <button
                          onClick={e => handleDelete(e, m.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition opacity-0 group-hover:opacity-100"
                          title="Удалить"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}

                      {!isMultiSelectActive && isAssigned && (
                        <button
                          onClick={e => handleHideAssignment(e, m.id)}
                          className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition opacity-0 group-hover:opacity-100"
                          title="Скрыть"
                        >
                          <EyeOff className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Substats */}
                <div className={`flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 my-4 ${isMultiSelectActive ? 'pl-8' : ''}`}>
                  <span title="Конспект">📝</span>
                  <span title="Умные карточки">🃏 {fcCount}</span>
                  <span title="Вопросы">❓ {qCount}</span>
                  {hasPodcast && (
                    <span className="ml-auto flex items-center gap-1 text-[10px] text-indigo-600 dark:text-indigo-400 font-black bg-indigo-50 dark:bg-indigo-950/30 px-2 py-0.5 rounded-full">
                      <Headphones className="w-3 h-3" /> 
                      Подкаст
                    </span>
                  )}
                </div>

                {/* Footer and Date */}
                <div className={`flex items-center justify-between mt-auto pt-2.5 border-t border-slate-150 dark:border-slate-800/60 ${isMultiSelectActive ? 'pl-8' : ''}`}>
                  <div className="flex flex-col">
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold">
                      {format(new Date(m.created_at), 'dd.MM.yyyy, HH:mm', { locale: ru })}
                    </p>
                    {(m as any).assigned_deadline && (
                      <p className="text-[10px] font-black text-rose-500 mt-0.5">
                        Дедлайн: {format(new Date((m as any).assigned_deadline), 'dd.MM, HH:mm', { locale: ru })}
                      </p>
                    )}
                  </div>
                  
                  {hasPodcast && !isMultiSelectActive && (
                    <button
                      onClick={e => { 
                        e.stopPropagation(); 
                        setPeekMaterial(m);
                        setDrawerTab('podcast');
                      }}
                      className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-850 dark:hover:text-indigo-300 font-bold transition font-black"
                    >
                      <Headphones className="w-3.5 h-3.5" /> 
                      Слушать →
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty filter results */}
      {!loading && materials.length > 0 && filtered.length === 0 && (
        <div className="text-center py-16 bg-slate-50/50 dark:bg-slate-900/10 rounded-2xl border border-slate-200 dark:border-slate-800 animate-scale-up">
          <FolderOpen className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3 animate-pulse" />
          <p className="text-sm text-slate-500 dark:text-slate-400 font-bold">В этой папке пока пусто</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Перетащите сюда материалы мышкой или выберите другой раздел</p>
        </div>
      )}

      {/* Floating Multi-select Batch Actions Panel */}
      <AnimatePresence>
        {isMultiSelectActive && selectedIds.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="fixed bottom-6 left-4 right-4 md:left-1/2 md:right-auto md:-translate-x-1/2 z-40 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md shadow-2xl border border-slate-200 dark:border-slate-800 px-6 py-4 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4 w-[calc(100%-2rem)] md:w-auto md:min-w-[680px]"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-indigo-600 text-white rounded-lg flex items-center justify-center font-extrabold text-sm shadow-md animate-pulse">
                {selectedIds.length}
              </div>
              <div className="text-left">
                <p className="text-xs font-black text-slate-800 dark:text-slate-100">Выбрано материалов</p>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold">Примените пакетные действия</p>
              </div>
            </div>

            <div className="flex flex-wrap justify-center items-center gap-2 w-full md:w-auto relative">
              {/* Move to folder trigger */}
              <div className="relative">
                <button
                  onClick={() => setShowBatchFolderSelect(!showBatchFolderSelect)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 rounded-xl text-xs font-black transition border border-indigo-100 dark:border-indigo-900/35"
                >
                  <Folder className="w-3.5 h-3.5" />
                  <span>В папку</span>
                  <ChevronDown className="w-3 h-3" />
                </button>
                
                {showBatchFolderSelect && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 8 }}
                    transition={{ duration: 0.12 }}
                    className="absolute bottom-full mb-2 left-0 z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-2 min-w-[200px] flex flex-col gap-1 max-h-48 overflow-y-auto custom-scrollbar"
                  >
                    <button
                      onClick={() => handleBatchMoveToFolder('')}
                      className="w-full text-left px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded-lg text-xs font-bold text-slate-500 dark:text-slate-400 transition-colors"
                    >
                      Без папки (убрать)
                    </button>
                    <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />
                    {folders.map(f => (
                      <button
                        key={f.id}
                        onClick={() => handleBatchMoveToFolder(f.id)}
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded-lg text-xs font-semibold flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white transition-colors"
                      >
                        <div 
                          className="w-2.5 h-2.5 rounded-full shrink-0" 
                          style={{ backgroundColor: colorSchemes[f.color]?.dot || '#4f46e5' }} 
                        />
                        <span>{f.name}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </div>

              {/* Publish */}
              <button
                onClick={handleBatchPublish}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 rounded-xl text-xs font-black transition border border-emerald-100 dark:border-indigo-900/35"
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Опубликовать</span>
              </button>

              {/* Delete */}
              <button
                onClick={handleBatchDelete}
                className="flex items-center gap-1.5 px-3 py-2 bg-rose-50 dark:bg-rose-955/30 text-rose-600 dark:text-rose-400 hover:bg-rose-100 rounded-xl text-xs font-black transition border border-rose-100 dark:border-rose-900/35"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Удалить</span>
              </button>

              <div className="w-px h-6 bg-slate-200 dark:bg-slate-800 mx-1 hidden md:block" />

              {/* Cancel */}
              <button
                onClick={() => {
                  setSelectedIds([]);
                  setShowBatchFolderSelect(false);
                  setIsMultiSelectActive(false);
                }}
                className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-xl text-xs font-bold transition"
              >
                Отмена
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Folder Creation Modal */}
      {showCreateFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-md shadow-2xl border border-slate-200 dark:border-slate-800 animate-scale-up">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-extrabold text-xl text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <FolderPlus className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                Создать новую папку
              </h3>
              <button 
                onClick={() => setShowCreateFolderModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Название папки</label>
                <input 
                  autoFocus
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  placeholder="Напр. Математика, Программирование"
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900 dark:text-slate-100 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Цвет подложки</label>
                <div className="grid grid-cols-4 gap-2">
                  {Object.keys(colorSchemes).map(col => {
                    const scheme = colorSchemes[col];
                    return (
                      <button
                        key={col}
                        onClick={() => setNewFolderColor(col)}
                        className={`flex items-center justify-center p-3 rounded-xl border-2 transition ${
                          newFolderColor === col 
                            ? 'border-indigo-600 dark:border-indigo-500 ring-2 ring-indigo-500/20' 
                            : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800'
                        } ${scheme.bg}`}
                      >
                        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: scheme.dot }} />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Иконка папки</label>
                <div className="grid grid-cols-5 gap-2">
                  {Object.keys(iconMap).map(ic => {
                    const IconComp = iconMap[ic];
                    return (
                      <button
                        key={ic}
                        onClick={() => setNewFolderIcon(ic)}
                        className={`flex items-center justify-center p-3 rounded-xl border-2 transition ${
                          newFolderIcon === ic 
                            ? 'bg-indigo-50 dark:bg-indigo-950/20 border-indigo-600 dark:border-indigo-500 text-indigo-600 dark:text-indigo-400' 
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        <IconComp className="w-5 h-5" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button 
                onClick={() => setShowCreateFolderModal(false)} 
                className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition"
              >
                Отмена
              </button>
              <button 
                onClick={handleCreateFolder} 
                disabled={!newFolderName.trim()} 
                className="flex-1 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition"
              >
                Создать
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Premium Side-Drawer / Bottom-Sheet (Quick Peek) */}
      <AnimatePresence>
        {peekMaterial && (() => {
          const drawerCards = peekMaterial.flashcards_json?.flashcards || peekMaterial.summary_json?.flashcards?.flashcards || [];
          const hasPodcast = peekMaterial.summary_json?.podcast && peekMaterial.summary_json.podcast.length > 0;
          const hasCards = drawerCards.length > 0;

          return (
            <>
              <style>{`
                .perspective-1000 {
                  perspective: 1000px;
                }
                .transform-style-3d {
                  transform-style: preserve-3d;
                }
                .backface-hidden {
                  backface-visibility: hidden;
                  -webkit-backface-visibility: hidden;
                }
                .rotate-y-180 {
                  transform: rotateY(180deg);
                }
              `}</style>

              {/* Backdrop */}
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-xs"
                onClick={() => {
                  stopTTS();
                  setPeekMaterial(null);
                }}
              />

              {/* Drawer */}
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 220 }}
                className="fixed bottom-0 right-0 z-50 w-full md:w-[480px] h-[85vh] md:h-full bg-white dark:bg-slate-900 shadow-2xl border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800 rounded-t-3xl md:rounded-t-none flex flex-col overflow-hidden text-slate-800 dark:text-slate-100"
              >
                {/* Drawer Header */}
                <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <span className="inline-block px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 text-[10px] font-black rounded uppercase tracking-wider mb-1">
                      {peekMaterial.subject || 'Без предмета'}
                    </span>
                    <h3 className="font-extrabold text-base leading-snug truncate text-slate-900 dark:text-slate-100" title={peekMaterial.title}>
                      {peekMaterial.title}
                    </h3>
                  </div>
                  <button
                    onClick={() => {
                      stopTTS();
                      setPeekMaterial(null);
                    }}
                    className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition shrink-0"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Slider / Sheet Tabs - ONLY render tabs when their content is actually present */}
                {(hasPodcast || hasCards) && (
                  <div className="flex bg-slate-50 dark:bg-slate-900/60 p-1 border-b border-slate-200 dark:border-slate-800">
                    <button
                      onClick={() => setDrawerTab('conspectus')}
                      className={`flex-1 py-2 text-center text-xs font-black transition-all ${
                        drawerTab === 'conspectus'
                          ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 rounded-lg shadow-xs'
                          : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                      }`}
                    >
                      📝 Конспект
                    </button>
                    {hasPodcast && (
                      <button
                        onClick={() => {
                          setDrawerTab('podcast');
                          setPeekSpeakingIndex(-1);
                        }}
                        className={`flex-1 py-2 text-center text-xs font-black transition-all ${
                          drawerTab === 'podcast'
                            ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 rounded-lg shadow-xs'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                      >
                        🎙️ Подкаст
                      </button>
                    )}
                    {hasCards && (
                      <button
                        onClick={() => {
                          setDrawerTab('flashcards');
                          setCardIndex(0);
                          setIsFlipped(false);
                        }}
                        className={`flex-1 py-2 text-center text-xs font-black transition-all ${
                          drawerTab === 'flashcards'
                            ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 rounded-lg shadow-xs'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                      >
                        🃏 Карточки
                      </button>
                    )}
                  </div>
                )}

                {/* Drawer Content Area */}
                <div className="flex-1 overflow-hidden flex flex-col bg-slate-50/30 dark:bg-slate-900/30">
                  
                  {/* 1. CONSPECTUS TAB */}
                  {drawerTab === 'conspectus' && (
                    <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
                      <div className="flex items-center gap-2 p-3 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100/60 dark:border-indigo-900/35 rounded-xl">
                        <BookOpenCheck className="w-5 h-5 text-indigo-500" />
                        <span className="text-xs font-black text-indigo-600 dark:text-indigo-400">Быстрый обзор материала</span>
                      </div>

                      {peekMaterial.summary_json?.cheatsheet ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed text-slate-700 dark:text-slate-300 font-semibold font-sans">
                          <ReactMarkdown>{peekMaterial.summary_json.cheatsheet}</ReactMarkdown>
                        </div>
                      ) : peekMaterial.summary_json?.content ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed text-slate-700 dark:text-slate-300 font-semibold font-sans">
                          <ReactMarkdown>
                            {peekMaterial.summary_json.content.slice(0, 1000) + (peekMaterial.summary_json.content.length > 1000 ? '...' : '')}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400 dark:text-slate-500 italic">Сводка или шпаргалка не создана для этого файла.</p>
                      )}

                      {peekMaterial.summary_json?.terms && peekMaterial.summary_json.terms.length > 0 && (
                        <div className="space-y-3 pt-3 border-t border-slate-200/60 dark:border-slate-800">
                          <h4 className="font-extrabold text-sm text-slate-900 dark:text-slate-100">📚 Ключевые термины ({peekMaterial.summary_json.terms.length})</h4>
                          <div className="space-y-2">
                            {peekMaterial.summary_json.terms.slice(0, 10).map((t: any, idx: number) => (
                              <div key={idx} className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
                                <span className="block text-xs font-black text-indigo-600 dark:text-indigo-400">{t.term}</span>
                                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 font-semibold leading-relaxed">{t.definition}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 2. AI PODCAST TAB */}
                  {drawerTab === 'podcast' && (
                    <div className="flex-grow overflow-y-auto p-4 space-y-4 custom-scrollbar">
                      {peekMaterial.summary_json?.podcast && peekMaterial.summary_json.podcast.length > 0 && (
                        <div className="space-y-3">
                          
                          {/* Audio widget player */}
                          <div className="bg-indigo-600 dark:bg-indigo-750 text-white rounded-2xl p-4 flex items-center justify-between shadow-lg">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                                <Headphones className="w-5 h-5 text-white" />
                              </div>
                              <div>
                                <h4 className="font-extrabold text-xs">AI Подкаст</h4>
                                <p className="text-[10px] text-indigo-200">Объяснение на простых примерах</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  const current = getTTSPlaybackRate();
                                  const next = current === 1.0 ? 1.25 : current === 1.25 ? 1.5 : current === 1.5 ? 2.0 : 1.0;
                                  setTTSPlaybackRate(next);
                                  setPeekPlaybackRate(next);
                                }}
                                className="px-2 py-1.5 bg-indigo-900/40 rounded-lg text-[10px] font-black text-indigo-200 hover:text-white"
                              >
                                {getTTSPlaybackRate()}x
                              </button>
                              <button
                                onClick={playPeekPodcast}
                                className="p-2.5 bg-white text-indigo-600 rounded-full hover:scale-105 active:scale-95 transition"
                              >
                                {peekIsPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                              </button>
                              {peekSpeakingIndex !== -1 && (
                                <button
                                  onClick={stopPeekPodcast}
                                  className="p-2.5 bg-indigo-900/40 text-indigo-200 rounded-full hover:scale-105 transition"
                                >
                                  <Square className="w-4 h-4 fill-current" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Speech bubbles dialogue */}
                          <div className="space-y-3 pt-2">
                            {peekMaterial.summary_json.podcast.map((line: any, idx: number) => {
                              const isMax = line.speaker === 'Макс';
                              const isSpeaking = peekSpeakingIndex === idx;
                              return (
                                <div 
                                  key={idx} 
                                  onClick={() => playFromLine(idx)}
                                  className={`flex ${isMax ? 'justify-start' : 'justify-end'} cursor-pointer`}
                                >
                                  <div className={`p-3 rounded-2xl shadow-xs border max-w-[85%] transition-all ${
                                    isSpeaking 
                                      ? 'border-indigo-500 ring-4 ring-indigo-500/15 scale-[1.01]' 
                                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-350 dark:hover:border-slate-700'
                                  } ${isMax ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-bl-none' : 'bg-indigo-50 dark:bg-indigo-950/20 text-slate-800 dark:text-slate-100 rounded-br-none'}`}>
                                    <div className="flex items-center justify-between mb-1 opacity-80">
                                      <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">{line.speaker}</span>
                                      {isSpeaking && <Volume2 className="w-3.5 h-3.5 text-indigo-500 animate-pulse" />}
                                    </div>
                                    <p className="text-[11px] leading-relaxed font-semibold">{line.text}</p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 3. SMART FLASHCARDS TAB */}
                  {drawerTab === 'flashcards' && (
                    <div className="flex-1 overflow-y-auto p-5 flex flex-col justify-between">
                      {(() => {
                        if (drawerCards.length === 0) return null;
                        const currentCard = drawerCards[cardIndex];

                        return (
                          <div className="flex-grow flex flex-col justify-between space-y-6">
                            {/* Top metadata counter */}
                            <div className="flex justify-between items-center text-xs font-bold text-slate-500 dark:text-slate-400">
                              <span>Повторение карточек</span>
                              <span className="px-2.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-full font-black">
                                {cardIndex + 1} из {drawerCards.length}
                              </span>
                            </div>

                            {/* Flip Card Container */}
                            <div 
                              onClick={() => setIsFlipped(!isFlipped)}
                              className="w-full h-64 cursor-pointer select-none perspective-1000 relative"
                            >
                              <div className={`w-full h-full duration-500 transform-style-3d relative transition-transform ${isFlipped ? 'rotate-y-180' : ''}`}>
                                
                                {/* Front Question Face */}
                                <div className="absolute inset-0 backface-hidden bg-gradient-to-br from-indigo-50/50 to-white dark:from-indigo-950/15 dark:to-slate-900 border-2 border-indigo-100 dark:border-indigo-900/30 rounded-2xl p-6 flex flex-col justify-between shadow-md">
                                  <div className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">Вопрос</div>
                                  <div className="flex-grow flex items-center justify-center text-center">
                                    <h3 className="font-extrabold text-sm text-slate-800 dark:text-slate-150 line-clamp-4 leading-snug">
                                      {currentCard.question}
                                    </h3>
                                  </div>
                                  <div className="text-[10px] text-slate-450 dark:text-slate-500 text-center font-bold">Нажмите, чтобы перевернуть 🔄</div>
                                </div>

                                {/* Back Answer Face */}
                                <div className="absolute inset-0 backface-hidden rotate-y-180 bg-white dark:bg-slate-900 border-2 border-indigo-500/25 rounded-2xl p-6 flex flex-col justify-between shadow-lg">
                                  <div className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Ответ</div>
                                  <div className="flex-grow flex items-center justify-center text-center overflow-y-auto custom-scrollbar">
                                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200 leading-relaxed">
                                      {currentCard.answer}
                                    </p>
                                  </div>
                                  <div className="text-[10px] text-slate-450 dark:text-slate-500 text-center font-bold">Нажмите, чтобы перевернуть 🔄</div>
                                </div>

                              </div>
                            </div>

                            {/* Control arrows and CTA */}
                            <div className="flex items-center justify-between gap-3 pt-2">
                              <button
                                disabled={cardIndex === 0}
                                onClick={() => {
                                  setIsFlipped(false);
                                  setCardIndex(cardIndex - 1);
                                }}
                                className="p-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl disabled:opacity-40 transition text-slate-600 dark:text-slate-350 shrink-0 animate-scale-up"
                              >
                                <ChevronLeft className="w-5 h-5" />
                              </button>

                              <div className="flex-1 flex gap-2">
                                <button
                                  onClick={() => {
                                    toast.success('Запомнил!');
                                    setIsFlipped(false);
                                    if (cardIndex < drawerCards.length - 1) {
                                      setCardIndex(cardIndex + 1);
                                    }
                                  }}
                                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black transition active:scale-95 shadow-sm"
                                >
                                  Знаю 👍
                                </button>
                                  <button
                                    onClick={() => {
                                      toast.success('Повторим позже');
                                      setIsFlipped(false);
                                      if (cardIndex < drawerCards.length - 1) {
                                        setCardIndex(cardIndex + 1);
                                      }
                                    }}
                                    className="flex-1 py-3 bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/30 rounded-xl text-xs font-black hover:bg-indigo-100 transition"
                                  >
                                    Повторить 🔁
                                  </button>
                                </div>

                                <button
                                  disabled={cardIndex === drawerCards.length - 1}
                                  onClick={() => {
                                    setIsFlipped(false);
                                    setCardIndex(cardIndex + 1);
                                  }}
                                  className="p-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl disabled:opacity-40 transition text-slate-600 dark:text-slate-350 shrink-0"
                                >
                                  <ChevronRight className="w-5 h-5" />
                                </button>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                </div>

                {/* Drawer Footer Navigation button */}
                <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <button
                    onClick={() => {
                      stopTTS();
                      navigate('/library/' + peekMaterial.id);
                    }}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-black transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/15"
                  >
                    Открыть полностью
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            </>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}