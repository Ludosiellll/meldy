import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getTeacherGroups, createGroup, getGroupAssignments, createAssignment, Group, GroupMember, Assignment, toggleAssignmentCompletion, getStudentCompletions, getGroupCompletions } from '../api/groups';
import { getMaterials } from '../api/materials';
import { Material } from '../types';
import { Users, Plus, Key, Calendar, BookOpen, AlertCircle, TrendingUp, Award, Trophy, Medal, Crown, ShieldAlert, GraduationCap, Check, Backpack, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { CustomSelect } from '../components/CustomSelect';
import { supabase } from '../lib/supabase';
import QRCode from 'react-qr-code';

// Функция получения участников группы с подсчетом недельного XP
async function getGroupMembersWithWeeklyXP(groupId: string): Promise<GroupMember[]> {
  const { data: membersData, error: memErr } = await supabase
    .from('group_members')
    .select('*')
    .eq('group_id', groupId);
  if (memErr || !membersData) return [];

  const studentIds = membersData.map(m => m.student_id);
  if (studentIds.length === 0) return [];

  // Загружаем профили
  const { data: profiles } = await supabase.from('profiles').select('id, full_name, avatar_url, total_reviews').in('id', studentIds);
  // Загружаем общий XP
  const { data: xps } = await supabase.from('user_xp').select('user_id, total_xp').in('user_id', studentIds);

  // Вычисляем недельный XP на основе активности за последние 7 дней
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const oneWeekAgoStr = oneWeekAgo.toISOString().split('T')[0];

  // 1. Учебные сессии
  const { data: weeklySessions } = await supabase
    .from('study_sessions')
    .select('user_id, cards_reviewed, materials_added')
    .gte('date', oneWeekAgoStr)
    .in('user_id', studentIds);

  // 2. Сданные экзамены
  const { data: weeklyExams } = await supabase
    .from('exam_sessions')
    .select('user_id, score')
    .eq('status', 'completed')
    .gte('completed_at', oneWeekAgo.toISOString())
    .in('user_id', studentIds);

  const profileMap = new Map((profiles || []).map(p => [p.id, p]));
  const xpMap = new Map((xps || []).map(x => [x.user_id, x.total_xp]));
  
  // Карта недельного XP
  const weeklyScoreMap = new Map<string, number>();
  studentIds.forEach(id => weeklyScoreMap.set(id, 0));

  // Карточка повторена = 2 XP, материал загружен = 50 XP
  (weeklySessions || []).forEach(s => {
    const current = weeklyScoreMap.get(s.user_id) || 0;
    const cardsXp = (s.cards_reviewed || 0) * 2;
    const matsXp = (s.materials_added || 0) * 50;
    weeklyScoreMap.set(s.user_id, current + cardsXp + matsXp);
  });

  // Экзамен сдан = 100 XP
  (weeklyExams || []).forEach(e => {
    const current = weeklyScoreMap.get(e.user_id) || 0;
    weeklyScoreMap.set(e.user_id, current + 100);
  });

  return membersData.map(m => {
    const p = profileMap.get(m.student_id);
    return {
      ...m,
      student_name: p?.full_name || 'Студент',
      student_avatar: p?.avatar_url,
      total_reviews: p?.total_reviews || 0,
      total_xp: xpMap.get(m.student_id) || 0,
      weekly_xp: (m as any).weekly_xp = weeklyScoreMap.get(m.student_id) || 0
    };
  });
}

export default function TeacherDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  // Роль пользователя
  const [role, setRole] = useState<'student' | 'teacher' | null>(null);
  const [teacherName, setTeacherName] = useState('Загрузка...');

  // Группы
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [completedAssignments, setCompletedAssignments] = useState<string[]>([]);
  const [groupCompletions, setGroupCompletions] = useState<any[]>([]);
  
  // Создание класса
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  
  // Назначение материала
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState('');
  const [deadline, setDeadline] = useState('');

  // QR код
  const [showQRModal, setShowQRModal] = useState(false);

  // Настройка лидерборда
  const [leaderboardTab, setLeaderboardTab] = useState<'all-time' | 'weekly'>('all-time');
  const [loading, setLoading] = useState(true);

  // Определение роли и подписка на изменения
  useEffect(() => {
    if (!user) return;
    const fetchRole = () => {
      supabase.from('profiles').select('role').eq('id', user.id).single()
        .then(({ data }) => {
          if (data) setRole(data.role as 'student' | 'teacher');
        });
    };
    fetchRole();
    window.addEventListener('profile_updated', fetchRole);
    return () => {
      window.removeEventListener('profile_updated', fetchRole);
    };
  }, [user?.id]);

  const handleToggleRole = async () => {
    if (!user) return;
    const newRole = role === 'teacher' ? 'student' : 'teacher';
    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', user.id);
    if (!error) {
      setRole(newRole);
      window.dispatchEvent(new Event('profile_updated'));
    }
  };

  // Загрузка групп для преподавателя
  const loadTeacherGroups = async () => {
    if (!user) return;
    const cacheKey = `teacher_groups_${user.id}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const data = JSON.parse(cached);
        setGroups(data);
        if (data.length > 0 && !selectedGroupId) setSelectedGroupId(data[0].id);
        setLoading(false);
      } catch (e) {}
    } else {
      setLoading(true);
    }
    
    const data = await getTeacherGroups(user.id);
    setGroups(data);
    localStorage.setItem(cacheKey, JSON.stringify(data));
    if (data.length > 0) {
      setSelectedGroupId(prev => prev ? (data.some(g => g.id === prev) ? prev : data[0].id) : data[0].id);
    }
    setLoading(false);
  };

  // Загрузка групп для студента
  const loadStudentGroups = async () => {
    if (!user) return;
    const cacheKey = `student_groups_${user.id}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const data = JSON.parse(cached);
        setGroups(data);
        if (data.length > 0 && !selectedGroupId) setSelectedGroupId(data[0].id);
        setLoading(false);
      } catch (e) {}
    } else {
      setLoading(true);
    }
    
    const { data: memberships } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('student_id', user.id);
      
    if (!memberships || memberships.length === 0) {
      setGroups([]);
      localStorage.setItem(cacheKey, '[]');
      setLoading(false);
      return;
    }
    
    const groupIds = memberships.map(m => m.group_id);
    const { data: groupsData } = await supabase
      .from('groups')
      .select('*')
      .in('id', groupIds);
      
    setGroups(groupsData || []);
    localStorage.setItem(cacheKey, JSON.stringify(groupsData || []));
    if (groupsData && groupsData.length > 0) {
      setSelectedGroupId(prev => prev ? (groupsData.some(g => g.id === prev) ? prev : groupsData[0].id) : groupsData[0].id);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!user || role === null) return;
    if (role === 'teacher') {
      loadTeacherGroups();
    } else {
      loadStudentGroups();
    }
    getMaterials(user.id).then((data: any) => setMaterials(data as Material[]));
  }, [user?.id, role]);

  // Загрузка деталей выбранной группы
  useEffect(() => {
    if (selectedGroupId && user) {
      const cacheMembers = localStorage.getItem(`group_members_${selectedGroupId}`);
      if (cacheMembers) { try { setMembers(JSON.parse(cacheMembers)); } catch(e) {} }
      getGroupMembersWithWeeklyXP(selectedGroupId).then(data => {
        setMembers(data);
        localStorage.setItem(`group_members_${selectedGroupId}`, JSON.stringify(data));
      });

      const cacheAssignments = localStorage.getItem(`group_assignments_${selectedGroupId}`);
      if (cacheAssignments) { try { setAssignments(JSON.parse(cacheAssignments)); } catch(e) {} }
      getGroupAssignments(selectedGroupId).then(data => {
        setAssignments(data);
        localStorage.setItem(`group_assignments_${selectedGroupId}`, JSON.stringify(data));
      });
      
      if (role === 'student') {
        const cacheCompletions = localStorage.getItem(`student_completions_${user.id}`);
        if (cacheCompletions) { try { setCompletedAssignments(JSON.parse(cacheCompletions)); } catch(e) {} }
        getStudentCompletions(user.id).then(data => {
          setCompletedAssignments(data);
          localStorage.setItem(`student_completions_${user.id}`, JSON.stringify(data));
        });
        
        const group = groups.find(g => g.id === selectedGroupId);
        if (group) {
          supabase.from('profiles').select('full_name').eq('id', group.teacher_id).maybeSingle()
            .then(({ data }) => {
              setTeacherName(data?.full_name || 'Неизвестный преподаватель');
            });
        }
      } else if (role === 'teacher') {
        const cacheGroupCompletions = localStorage.getItem(`group_completions_${selectedGroupId}`);
        if (cacheGroupCompletions) { try { setGroupCompletions(JSON.parse(cacheGroupCompletions)); } catch(e) {} }
        getGroupCompletions(selectedGroupId).then(data => {
          setGroupCompletions(data);
          localStorage.setItem(`group_completions_${selectedGroupId}`, JSON.stringify(data));
        });
      }
    }
  }, [selectedGroupId, role, groups, user?.id]);

  const handleCreateGroup = async () => {
    if (!newGroupName.trim() || !user) return;
    const g = await createGroup(newGroupName, user.id);
    if (g) {
      setGroups([g, ...groups]);
      setSelectedGroupId(g.id);
      setShowCreateGroup(false);
      setNewGroupName('');
    }
  };

  const handleAssign = async () => {
    if (!selectedGroupId || !selectedMaterial) return;
    const ok = await createAssignment(selectedGroupId, selectedMaterial, deadline || undefined);
    if (ok) {
      getGroupAssignments(selectedGroupId).then(setAssignments);
      if (role === 'teacher') {
        getGroupCompletions(selectedGroupId).then(setGroupCompletions);
      }
      setShowAssignModal(false);
      setSelectedMaterial('');
      setDeadline('');
    }
  };

  const handleToggleCompletion = async (assignmentId: string) => {
    if (!user || !selectedGroupId) return;
    const isCurrentlyCompleted = completedAssignments.includes(assignmentId);
    const ok = await toggleAssignmentCompletion(assignmentId, user.id, !isCurrentlyCompleted);
    if (ok) {
      setCompletedAssignments(prev => 
        isCurrentlyCompleted 
          ? prev.filter(id => id !== assignmentId)
          : [...prev, assignmentId]
      );
      // Перезагружаем сдачи группы, чтобы преподаватель видел обновления в реальном времени
      getGroupCompletions(selectedGroupId).then(setGroupCompletions);
    }
  };

  const selectedGroup = groups.find(g => g.id === selectedGroupId);

  // Сортировка участников для лидерборда
  const sortedMembers = [...members].sort((a, b) => {
    const valA = leaderboardTab === 'all-time' ? (a.total_xp || 0) : ((a as any).weekly_xp || 0);
    const valB = leaderboardTab === 'all-time' ? (b.total_xp || 0) : ((b as any).weekly_xp || 0);
    return valB - valA;
  });

  // Топ-3 для пьедестала
  const podium = [
    sortedMembers[1], // 2 место (слева)
    sortedMembers[0], // 1 место (центр)
    sortedMembers[2], // 3 место (справа)
  ];

  const restRankings = sortedMembers.slice(3);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto min-h-[85vh]">
      {/* Role Switcher Widget */}
      <div className="mb-6 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm tour-step-role-toggle">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 shadow-md ${role === 'teacher' ? 'bg-emerald-600' : 'bg-indigo-600'}`}>
            {role === 'teacher' ? <Users className="w-5 h-5" /> : <GraduationCap className="w-5 h-5" />}
          </div>
          <div>
            <h4 className="font-extrabold text-slate-800 dark:text-slate-200 text-sm">
              {role === 'teacher' ? <span className="flex items-center gap-1.5">Режим: Преподаватель <GraduationCap className="w-4 h-4 text-indigo-500" /></span> : <span className="flex items-center gap-1.5">Режим: Студент <Backpack className="w-4 h-4 text-rose-500" /></span>}
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xl mt-0.5 leading-relaxed">
              {role === 'teacher' 
                ? 'Вы управляете классами, приглашаете учеников и выдаете им домашние задания. Хотите учиться сами и решать тесты? Переключитесь в режим студента.'
                : 'Вы видите домашние задания и дедлайны от преподавателя, а также соревнуетесь в лидерборде. Хотите сами преподавать и создавать свои группы? Переключитесь в режим преподавателя!'}
            </p>
          </div>
        </div>
        <button 
          onClick={handleToggleRole}
          className={`px-4 py-2 text-white font-bold text-xs rounded-xl shadow-md dark:shadow-none transition shrink-0 ${role === 'teacher' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
        >
          {role === 'teacher' ? <span className="flex items-center gap-1.5 justify-center">В режим Студента <Backpack className="w-4 h-4" /></span> : <span className="flex items-center gap-1.5 justify-center">В режим Преподавателя <GraduationCap className="w-4 h-4" /></span>}
        </button>
      </div>

      {/* HEADER */}
      <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">
            {role === 'teacher' ? 'Мои учебные классы' : 'Мой учебный класс'}
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">
            {role === 'teacher' 
              ? 'Управляйте группами, создавайте задания и просматривайте статистику учеников.' 
              : 'Ваше учебное пространство, дедлайны от преподавателя и рейтинг одногруппников.'}
          </p>
        </div>
        
        {role === 'teacher' && (
          <button 
            onClick={() => setShowCreateGroup(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition shadow-sm dark:shadow-none"
          >
            <Plus className="w-5 h-5" />
            Создать класс
          </button>
        )}
      </div>

      {/* CREATE GROUP PANEL */}
      {showCreateGroup && role === 'teacher' && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 mb-8 flex items-end gap-4">
          <div className="flex-1">
            <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Название новой группы</label>
            <input autoFocus value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="Например: ПИ-22 (Алгебра)" className="w-full px-4 py-2 bg-white dark:bg-slate-850 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <button onClick={handleCreateGroup} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition h-[42px]">Создать</button>
          <button onClick={() => setShowCreateGroup(false)} className="px-6 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold transition h-[42px]">Отмена</button>
        </motion.div>
      )}

      {/* LOADING */}
      {(loading || role === null) && (
        <div className="text-center py-20">
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500 font-medium">Загрузка информации о группах...</p>
        </div>
      )}

      {/* EMPTY GROUPS STATE */}
      {!(loading || role === null) && groups.length === 0 && (
        <div className="space-y-6">
          <div className="text-center py-16 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 border-dashed">
            <Users className="w-16 h-16 text-slate-300 dark:text-slate-700 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
              {role === 'teacher' ? 'У вас пока нет групп' : 'Вы пока не вступили в группу'}
            </h2>
            <p className="text-slate-500 dark:text-slate-400 mt-2 max-w-sm mx-auto text-sm leading-relaxed">
              {role === 'teacher' 
                ? 'Создайте свой первый класс, чтобы пригласить студентов по коду приглашения.' 
                : 'Вам нужно вступить в группу вашего преподавателя по пятизначному коду приглашения.'}
            </p>
            {role === 'student' && (
              <button
                onClick={() => navigate('/library')}
                className="mt-6 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition shadow-md shadow-indigo-200 dark:shadow-none"
              >
                Вступить в класс
              </button>
            )}
          </div>

          {/* Step by step guide card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
            <h3 className="font-extrabold text-slate-800 dark:text-slate-100 text-base mb-4">
              Как устроена работа с классами? 🧭
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {role === 'teacher' ? (
                <>
                  <div className="space-y-2">
                    <span className="w-7 h-7 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 rounded-full flex items-center justify-center font-bold text-xs">1</span>
                    <h4 className="font-bold text-slate-700 dark:text-slate-300 text-sm">Создайте класс</h4>
                    <p className="text-slate-500 dark:text-slate-400 text-xs leading-relaxed">Нажмите кнопку «Создать класс» в правом верхнем углу этой страницы и введите его название.</p>
                  </div>
                  <div className="space-y-2">
                    <span className="w-7 h-7 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 rounded-full flex items-center justify-center font-bold text-xs">2</span>
                    <h4 className="font-bold text-slate-700 dark:text-slate-300 text-sm">Передайте код</h4>
                    <p className="text-slate-500 dark:text-slate-400 text-xs leading-relaxed">Скопируйте уникальный пятизначный код класса из карточки группы и отправьте его своим ученикам.</p>
                  </div>
                  <div className="space-y-2">
                    <span className="w-7 h-7 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 rounded-full flex items-center justify-center font-bold text-xs">3</span>
                    <h4 className="font-bold text-slate-700 dark:text-slate-300 text-sm">Назначьте лекцию</h4>
                    <p className="text-slate-500 dark:text-slate-400 text-xs leading-relaxed">Нажмите «Назначить задание», выберите лекцию из своей библиотеки и укажите дату сдачи (дедлайн).</p>
                  </div>
                  <div className="space-y-2">
                    <span className="w-7 h-7 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 rounded-full flex items-center justify-center font-bold text-xs">4</span>
                    <h4 className="font-bold text-slate-700 dark:text-slate-300 text-sm">Следите за топом</h4>
                    <p className="text-slate-500 dark:text-slate-400 text-xs leading-relaxed">В лидерборде вы увидите активность студентов за 7 дней и всё время (XP за карточки и экзамены).</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <span className="w-7 h-7 bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 rounded-full flex items-center justify-center font-bold text-xs">1</span>
                    <h4 className="font-bold text-slate-700 dark:text-slate-300 text-sm">Получите код</h4>
                    <p className="text-slate-500 dark:text-slate-400 text-xs leading-relaxed">Попросите у своего преподавателя уникальный 5-значный код для вступления в его группу.</p>
                  </div>
                  <div className="space-y-2">
                    <span className="w-7 h-7 bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 rounded-full flex items-center justify-center font-bold text-xs">2</span>
                    <h4 className="font-bold text-slate-700 dark:text-slate-300 text-sm">Вступите в класс</h4>
                    <p className="text-slate-500 dark:text-slate-400 text-xs leading-relaxed">Перейдите в «Библиотеку» и в правом верхнем углу нажмите кнопку «Ввести код класса».</p>
                  </div>
                  <div className="space-y-2">
                    <span className="w-7 h-7 bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 rounded-full flex items-center justify-center font-bold text-xs">3</span>
                    <h4 className="font-bold text-slate-700 dark:text-slate-300 text-sm">Делайте задания</h4>
                    <p className="text-slate-500 dark:text-slate-400 text-xs leading-relaxed">Изучайте назначенные преподавателем конспекты, чтобы успешно уложиться в дедлайны.</p>
                  </div>
                  <div className="space-y-2">
                    <span className="w-7 h-7 bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 rounded-full flex items-center justify-center font-bold text-xs">4</span>
                    <h4 className="font-bold text-slate-700 dark:text-slate-300 text-sm">Участвуйте в рейтинге</h4>
                    <p className="text-slate-500 dark:text-slate-400 text-xs leading-relaxed">Решайте тесты и заучивайте карточки, накапливайте еженедельный XP и занимайте топ-3 пьедестала!</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MAIN CONTAINER */}
      {!loading && groups.length > 0 && (
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar */}
          <div className="lg:w-1/4 shrink-0">
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden sticky top-4">
              <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40">
                <h2 className="font-bold text-slate-700 dark:text-slate-400 uppercase tracking-wider text-xs">Список классов</h2>
              </div>
              <div className="p-2 space-y-1 max-h-[60vh] overflow-y-auto">
                {groups.map(g => (
                  <button
                    key={g.id}
                    onClick={() => setSelectedGroupId(g.id)}
                    className={`w-full text-left px-4 py-3 rounded-xl transition ${selectedGroupId === g.id ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 font-bold' : 'hover:bg-slate-50 dark:hover:bg-slate-800/35 text-slate-700 dark:text-slate-300 font-medium'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate mr-2">{g.name}</span>
                      <Users className={`w-4 h-4 shrink-0 ${selectedGroupId === g.id ? 'text-indigo-400' : 'text-slate-300 dark:text-slate-600'}`} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Main Panel */}
          {selectedGroup && (
            <div className="lg:w-3/4 flex-1 space-y-6">
              {/* Group Header Card */}
              <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{selectedGroup.name}</h2>
                  
                  <div className="flex flex-wrap items-center gap-4 mt-2 text-slate-500 dark:text-slate-400 text-sm">
                    {role === 'student' && (
                      <div className="flex items-center gap-1">
                        <Users className="w-4 h-4 text-slate-400 dark:text-slate-650" />
                        <span>Преподаватель: <span className="font-semibold text-slate-700 dark:text-slate-300">{teacherName}</span></span>
                      </div>
                    )}
                    
                    <div className="flex items-center gap-2">
                      <Key className="w-4 h-4 text-slate-400 dark:text-slate-650" />
                      <span>Код приглашения:</span>
                      <span className="font-mono bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/50 px-2 py-0.5 rounded font-bold text-base select-all">
                        {selectedGroup.invite_code}
                      </span>
                    </div>
                    
                    {role === 'teacher' && (
                      <button 
                        onClick={() => setShowQRModal(true)}
                        className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-355 text-sm font-bold ml-2 underline"
                      >
                        Показать QR-код
                      </button>
                    )}
                  </div>
                </div>
                
                {role === 'teacher' && (
                  <button 
                    onClick={() => setShowAssignModal(true)}
                    className="px-5 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition shrink-0"
                  >
                    Назначить задание
                  </button>
                )}
              </div>

              {/* QR CODE MODAL */}
              {showQRModal && role === 'teacher' && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                  <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white dark:bg-slate-900 rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl border dark:border-slate-800">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">Пригласить в класс</h3>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">Попросите учеников отсканировать этот QR-код или ввести код вручную в Библиотеке.</p>
                    
                    <div className="bg-white dark:bg-slate-950 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 inline-block mb-6 shadow-sm">
                      <QRCode 
                        value={`${window.location.origin}/library?join=${selectedGroup.invite_code}`} 
                        size={200}
                      />
                    </div>
                    
                    <div className="bg-indigo-50 dark:bg-indigo-950/40 rounded-xl p-3 mb-6">
                      <span className="text-xs text-indigo-400 font-bold uppercase tracking-wider mb-1 block">Код класса</span>
                      <span className="text-2xl font-black font-mono text-indigo-700 dark:text-indigo-400 tracking-widest">{selectedGroup.invite_code}</span>
                    </div>
                    
                    <button onClick={() => setShowQRModal(false)} className="w-full py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl transition">
                      Закрыть
                    </button>
                  </motion.div>
                </div>
              )}

              {/* ASSIGN MATERIAL MODAL */}
              {showAssignModal && role === 'teacher' && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-indigo-100 dark:border-slate-850 shadow-lg shadow-indigo-100/50 dark:shadow-none">
                  <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-4">Назначить материал</h3>
                  <div className="space-y-4 relative z-20">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Выберите материал из вашей библиотеки</label>
                      <CustomSelect 
                        value={selectedMaterial} 
                        onChange={val => setSelectedMaterial(val)} 
                        className="px-4 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-850 text-slate-900 dark:text-slate-100 rounded-xl focus:ring-2 focus:ring-indigo-500 shadow-inner"
                        options={[
                          { value: '', label: '-- Выберите материал --' },
                          ...materials.map(m => ({ value: m.id, label: m.title }))
                        ]}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Дедлайн (опционально)</label>
                      <input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} className="w-full px-4 py-2 bg-white dark:bg-slate-850 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>
                    <div className="flex gap-2 justify-end pt-2">
                      <button onClick={() => setShowAssignModal(false)} className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-350 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700">Отмена</button>
                      <button onClick={handleAssign} disabled={!selectedMaterial} className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50">Назначить</button>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* EMPTY STATE FOR NEW GROUP */}
              {assignments.length === 0 && members.length === 0 && (
                <div className="bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 border-dashed rounded-3xl p-10 text-center flex flex-col items-center gap-4">
                  <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-950/40 text-indigo-500 dark:text-indigo-400 rounded-full flex items-center justify-center">
                    <Users className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Класс готов к работе! 🎉</h3>
                    <p className="text-slate-500 dark:text-slate-400 text-sm max-w-md mx-auto mt-2 leading-relaxed">
                      Теперь пригласите учеников. Скопируйте код приглашения <span className="font-mono bg-white dark:bg-slate-900 px-2 py-0.5 rounded shadow-sm text-indigo-600 dark:text-indigo-400 font-bold">{selectedGroup.invite_code}</span> и отправьте им.
                    </p>
                  </div>
                  {role === 'teacher' && (
                    <button 
                      onClick={() => setShowAssignModal(true)}
                      className="mt-2 px-6 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition shadow-md shadow-indigo-200 dark:shadow-none flex items-center gap-2"
                    >
                      <Plus className="w-5 h-5" /> Назначить первое задание
                    </button>
                  )}
                </div>
              )}

              {/* Assignments List */}
              {assignments.length > 0 && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
                  <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2 bg-slate-50 dark:bg-slate-950/40">
                    <BookOpen className="w-5 h-5 text-indigo-500" />
                    <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">Назначенные задания ({assignments.length})</h3>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {assignments.map(a => {
                      const isDone = completedAssignments.includes(a.id);
                      const isOverdue = a.deadline && new Date(a.deadline) < new Date();
                      const completionsCount = groupCompletions.filter(c => c.assignment_id === a.id).length;
                      const totalStudents = members.length;

                      return (
                        <div key={a.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-850/50 transition-colors">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-slate-800 dark:text-slate-200">{a.material?.title || 'Удаленный материал'}</span>
                              {role === 'student' ? (
                                isDone ? (
                                  <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold rounded-md uppercase tracking-wider">
                                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">Выполнено <CheckCircle2 className="w-3.5 h-3.5" /></span>
                                  </span>
                                ) : isOverdue ? (
                                  <span className="px-2 py-0.5 bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 text-[10px] font-bold rounded-md uppercase tracking-wider">
                                    Просрочено ⏰
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400 text-[10px] font-bold rounded-md uppercase tracking-wider">
                                    В процессе ⏳
                                  </span>
                                )
                              ) : (
                                <span className="px-2 py-0.5 bg-indigo-55 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 text-[10px] font-bold rounded-md uppercase tracking-wider">
                                  Сдали: {completionsCount} из {totalStudents}
                                </span>
                              )}
                            </div>
                            {a.deadline && (
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-500 mt-1">
                                <Calendar className="w-3.5 h-3.5" />
                                Дедлайн: {format(new Date(a.deadline), 'd MMMM, HH:mm', { locale: ru })}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 self-end sm:self-center">
                            {role === 'student' && a.material && (
                              <>
                                <button
                                  onClick={() => handleToggleCompletion(a.id)}
                                  className={`px-3 py-1.5 font-bold rounded-lg text-xs transition border ${
                                    isDone 
                                      ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900 border-emerald-200 dark:border-emerald-900/50' 
                                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-350 hover:bg-slate-200 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700'
                                  }`}
                                >
                                  {isDone ? 'Выполнено' : 'Выполнить'}
                                </button>
                                <button
                                  onClick={() => navigate(`/library/${a.material_id}`)}
                                  className="px-3.5 py-1.5 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white font-bold rounded-lg text-xs transition"
                                >
                                  Изучить →
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Teacher-only Assignment completions matrix */}
              {role === 'teacher' && assignments.length > 0 && (
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm p-6 space-y-4">
                  <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
                    <Check className="w-5 h-5 text-emerald-500" />
                    <h3 className="font-extrabold text-slate-800 dark:text-slate-100 text-base">Контроль выполнения заданий 🧭</h3>
                  </div>
                  
                  {members.length === 0 ? (
                    <p className="text-slate-400 text-xs italic">Нет студентов в классе для отображения прогресса.</p>
                  ) : (
                    <div className="overflow-x-auto custom-scrollbar rounded-xl border border-slate-100 dark:border-slate-800">
                      <table className="w-full text-left text-xs min-w-[500px]">
                        <thead>
                          <tr className="bg-slate-50 dark:bg-slate-950/40 text-slate-500 dark:text-slate-400 uppercase tracking-wider font-bold">
                            <th className="p-3 sticky left-0 bg-slate-50 dark:bg-slate-950 z-10 shadow-[1px_0_0_rgba(255,255,255,0.05)]">Студент</th>
                            {assignments.map(a => (
                              <th key={a.id} className="p-3 font-bold truncate max-w-[120px]" title={a.material?.title}>
                                {a.material?.title || 'Удаленный'}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {members.map(m => (
                            <tr key={m.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/30 transition-colors group">
                              <td className="p-3 font-bold text-slate-700 dark:text-slate-300 sticky left-0 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-850 z-10 shadow-[1px_0_0_rgba(255,255,255,0.05)] transition-colors">
                                {m.student_name}
                              </td>
                              {assignments.map(a => {
                                const completion = groupCompletions.find(c => c.assignment_id === a.id && c.student_id === m.student_id);
                                const isOverdue = a.deadline && new Date(a.deadline) < new Date();
                                
                                return (
                                  <td key={a.id} className="p-3">
                                    {completion ? (
                                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold">
                                        <Check className="w-3.5 h-3.5" /> Выполнено
                                      </span>
                                    ) : isOverdue ? (
                                      <span className="flex items-center gap-1 text-rose-500 dark:text-rose-400 font-semibold">
                                        ❌ Просрочено
                                      </span>
                                    ) : (
                                      <span className="flex items-center gap-1 text-slate-400 dark:text-slate-500">
                                        ⏳ В процессе
                                      </span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* LEADERBOARD / STUDENTS PERFORMANCE */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm p-6 space-y-6">
                
                {/* Section header & Toggles */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-amber-500" />
                    <h3 className="font-extrabold text-slate-800 dark:text-slate-100 text-lg">Рейтинг участников класса ({members.length})</h3>
                  </div>
                  
                  {/* Weekly / All-time toggle */}
                  <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl w-full sm:w-auto">
                    <button
                      onClick={() => setLeaderboardTab('all-time')}
                      className={`flex-1 sm:flex-initial px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        leaderboardTab === 'all-time'
                          ? 'bg-slate-900 dark:bg-slate-950 text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      За все время
                    </button>
                    <button
                      onClick={() => setLeaderboardTab('weekly')}
                      className={`flex-1 sm:flex-initial px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        leaderboardTab === 'weekly'
                          ? 'bg-slate-900 dark:bg-slate-950 text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      За 7 дней
                    </button>
                  </div>
                </div>

                {members.length === 0 ? (
                  <p className="text-center text-slate-500 dark:text-slate-400 py-10">
                    Пока никто не присоединился к этой группе.
                  </p>
                ) : (
                  <div className="space-y-8">
                    
                    {/* PODIUM (TOP-3 STUDENTS) */}
                    {sortedMembers.length > 0 && (
                      <div className="flex items-end justify-center gap-2 md:gap-6 pt-12 pb-4 overflow-x-auto min-w-[280px]">
                        
                        {/* 2nd place */}
                        {podium[0] && (
                          <div className="flex flex-col items-center">
                            <div className="relative mb-3 flex flex-col items-center">
                              {podium[0].student_avatar ? (
                                <img src={podium[0].student_avatar} alt="avatar" className="w-14 h-14 rounded-full border-2 border-slate-300 dark:border-slate-700 shadow-md" />
                              ) : (
                                <div className="w-14 h-14 rounded-full bg-slate-200 dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-700 flex items-center justify-center text-slate-500 font-bold text-sm shadow-md">
                                  {podium[0].student_name?.[0]}
                                </div>
                              )}
                              <span className="absolute -top-3 bg-slate-300 text-slate-800 p-0.5 rounded-full shadow border border-white dark:border-slate-850 text-xs font-black">
                                <Medal className="w-3.5 h-3.5 text-slate-600" />
                              </span>
                            </div>
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-350 max-w-[90px] truncate text-center mb-1">{podium[0].student_name}</span>
                            <div className="w-20 md:w-24 bg-slate-100/80 dark:bg-slate-850 border-t-2 border-slate-300 dark:border-slate-700 rounded-t-xl h-24 flex flex-col items-center justify-center shadow-sm">
                              <span className="font-mono text-xs font-black text-slate-600 dark:text-slate-400">2 место</span>
                              <span className="text-[10px] font-black text-indigo-500 dark:text-indigo-400 mt-1">
                                {leaderboardTab === 'all-time' ? podium[0].total_xp : (podium[0] as any).weekly_xp} XP
                              </span>
                            </div>
                          </div>
                        )}

                        {/* 1st place */}
                        {podium[1] && (
                          <div className="flex flex-col items-center scale-110 -translate-y-2 z-10">
                            <div className="relative mb-3 flex flex-col items-center">
                              {podium[1].student_avatar ? (
                                <img src={podium[1].student_avatar} alt="avatar" className="w-16 h-16 rounded-full border-4 border-amber-400 shadow-lg" />
                              ) : (
                                <div className="w-16 h-16 rounded-full bg-amber-50 dark:bg-amber-950/40 border-4 border-amber-400 dark:border-amber-700 flex items-center justify-center text-amber-700 dark:text-amber-450 font-black text-base shadow-lg">
                                  {podium[1].student_name?.[0]}
                                </div>
                              )}
                              <span className="absolute -top-3.5 bg-amber-400 text-amber-950 p-0.5 rounded-full shadow border-2 border-white dark:border-slate-850 animate-bounce">
                                <Crown className="w-4 h-4 fill-amber-300" />
                              </span>
                            </div>
                            <span className="text-xs font-black text-slate-800 dark:text-slate-200 max-w-[100px] truncate text-center mb-1">{podium[1].student_name}</span>
                            <div className="w-24 md:w-28 bg-gradient-to-t from-amber-50 to-amber-100/50 dark:bg-amber-950/40 border-t-4 border-amber-400 dark:border-amber-600 rounded-t-2xl h-32 flex flex-col items-center justify-center shadow-md">
                              <span className="font-mono text-xs font-black text-amber-800 dark:text-amber-400">1 место</span>
                              <span className="text-xs font-black text-indigo-600 dark:text-indigo-400 mt-1">
                                {leaderboardTab === 'all-time' ? podium[1].total_xp : (podium[1] as any).weekly_xp} XP
                              </span>
                            </div>
                          </div>
                        )}

                        {/* 3rd place */}
                        {podium[2] && (
                          <div className="flex flex-col items-center">
                            <div className="relative mb-3 flex flex-col items-center">
                              {podium[2].student_avatar ? (
                                <img src={podium[2].student_avatar} alt="avatar" className="w-12 h-12 rounded-full border-2 border-amber-600 shadow-md" />
                              ) : (
                                <div className="w-12 h-12 rounded-full bg-slate-200 dark:bg-slate-800 border-2 border-amber-600 flex items-center justify-center text-slate-500 dark:text-slate-400 font-bold text-xs shadow-md">
                                  {podium[2].student_name?.[0]}
                                </div>
                              )}
                              <span className="absolute -top-3 bg-amber-700 text-white p-0.5 rounded-full shadow border border-white text-xs font-black">
                                <Award className="w-3.5 h-3.5 text-amber-200" />
                              </span>
                            </div>
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 max-w-[80px] truncate text-center mb-1">{podium[2].student_name}</span>
                            <div className="w-18 md:w-20 bg-amber-50/20 dark:bg-amber-950/20 border-t-2 border-amber-600 rounded-t-xl h-20 flex flex-col items-center justify-center shadow-sm">
                              <span className="font-mono text-[10px] font-black text-amber-800 dark:text-amber-500">3 место</span>
                              <span className="text-[10px] font-black text-indigo-500 dark:text-indigo-400 mt-1">
                                {leaderboardTab === 'all-time' ? podium[2].total_xp : (podium[2] as any).weekly_xp} XP
                              </span>
                            </div>
                          </div>
                        )}

                      </div>
                    )}

                    {/* REST OF THE RANKINGS LIST */}
                    {restRankings.length > 0 && (
                      <div className="overflow-x-auto custom-scrollbar border border-slate-100 dark:border-slate-800 rounded-2xl">
                        <table className="w-full text-left text-xs min-w-[400px]">
                          <thead>
                            <tr className="bg-slate-50 dark:bg-slate-950/40 text-slate-500 dark:text-slate-400 uppercase tracking-wider font-bold">
                              <th className="p-4 w-12 text-center">Ранг</th>
                              <th className="p-4">Студент</th>
                              <th className="p-4 text-right">Опыт в этой группе (XP)</th>
                              <th className="p-4 text-right">Повторений</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {restRankings.map((m, index) => {
                              const rank = index + 4;
                              const score = leaderboardTab === 'all-time' ? m.total_xp : (m as any).weekly_xp;
                              return (
                                <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-850/50 transition-colors">
                                  <td className="p-4 font-mono font-bold text-slate-400 dark:text-slate-500 text-center">{rank}</td>
                                  <td className="p-4">
                                    <div className="flex items-center gap-3">
                                      {m.student_avatar ? (
                                        <img src={m.student_avatar} alt="avatar" className="w-8 h-8 rounded-full" />
                                      ) : (
                                        <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-550 font-bold text-xs">
                                          {m.student_name?.[0] || '?'}
                                        </div>
                                      )}
                                      <span className="font-bold text-slate-800 dark:text-slate-200">{m.student_name}</span>
                                    </div>
                                  </td>
                                  <td className="p-4 text-right font-mono text-indigo-600 dark:text-indigo-400 font-bold">{score} XP</td>
                                  <td className="p-4 text-right text-slate-600 dark:text-slate-400 font-medium">{m.total_reviews || 0}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
