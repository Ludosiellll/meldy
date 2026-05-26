import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getTeacherGroups, createGroup, getGroupAssignments, createAssignment, Group, GroupMember, Assignment } from '../api/groups';
import { getMaterials } from '../api/materials';
import { Material } from '../types';
import { Users, Plus, Key, Calendar, BookOpen, AlertCircle, TrendingUp, Award, Trophy, Medal, Crown, ShieldAlert, GraduationCap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { supabase } from '../lib/supabase';

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
  const [role, setRole] = useState<'student' | 'teacher'>('student');
  const [teacherName, setTeacherName] = useState('Загрузка...');

  // Группы
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  
  // Создание класса
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  
  // Назначение материала
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState('');
  const [deadline, setDeadline] = useState('');

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
  }, [user]);

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
    setLoading(true);
    const data = await getTeacherGroups(user.id);
    setGroups(data);
    if (data.length > 0 && !selectedGroupId) {
      setSelectedGroupId(data[0].id);
    }
    setLoading(false);
  };

  // Загрузка групп для студента
  const loadStudentGroups = async () => {
    if (!user) return;
    setLoading(true);
    const { data: memberships } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('student_id', user.id);
      
    if (!memberships || memberships.length === 0) {
      setGroups([]);
      setLoading(false);
      return;
    }
    
    const groupIds = memberships.map(m => m.group_id);
    const { data: groupsData } = await supabase
      .from('groups')
      .select('*')
      .in('id', groupIds);
      
    setGroups(groupsData || []);
    if (groupsData && groupsData.length > 0 && !selectedGroupId) {
      setSelectedGroupId(groupsData[0].id);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    if (role === 'teacher') {
      loadTeacherGroups();
    } else {
      loadStudentGroups();
    }
    getMaterials(user.id).then((data: any) => setMaterials(data as Material[]));
  }, [user, role]);

  // Загрузка деталей выбранной группы
  useEffect(() => {
    if (selectedGroupId) {
      getGroupMembersWithWeeklyXP(selectedGroupId).then(setMembers);
      getGroupAssignments(selectedGroupId).then(setAssignments);
      
      const group = groups.find(g => g.id === selectedGroupId);
      if (group && role === 'student') {
        supabase.from('profiles').select('full_name').eq('id', group.teacher_id).maybeSingle()
          .then(({ data }) => {
            setTeacherName(data?.full_name || 'Неизвестный преподаватель');
          });
      }
    }
  }, [selectedGroupId, role, groups]);

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
      setShowAssignModal(false);
      setSelectedMaterial('');
      setDeadline('');
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
  ].filter(Boolean);

  const restRankings = sortedMembers.slice(3);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto min-h-[85vh]">
      {/* Role Switcher Widget */}
      <div className="mb-6 p-4 bg-white border border-slate-200 rounded-3xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm tour-step-role-toggle">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 shadow-md ${role === 'teacher' ? 'bg-emerald-600' : 'bg-indigo-600'}`}>
            {role === 'teacher' ? <Users className="w-5 h-5" /> : <GraduationCap className="w-5 h-5" />}
          </div>
          <div>
            <h4 className="font-extrabold text-slate-800 text-sm">
              {role === 'teacher' ? 'Режим: Преподаватель 🎓' : 'Режим: Студент 🎒'}
            </h4>
            <p className="text-xs text-slate-500 max-w-xl mt-0.5 leading-relaxed">
              {role === 'teacher' 
                ? 'Вы управляете классами, приглашаете учеников и выдаете им домашние задания. Хотите учиться сами и решать тесты? Переключитесь в режим студента.'
                : 'Вы видите домашние задания и дедлайны от преподавателя, а также соревнуетесь в лидерборде. Хотите сами преподавать и создавать свои группы? Переключитесь в режим преподавателя!'}
            </p>
          </div>
        </div>
        <button 
          onClick={handleToggleRole}
          className={`px-4 py-2 text-white font-bold text-xs rounded-xl shadow-md transition shrink-0 ${role === 'teacher' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'}`}
        >
          {role === 'teacher' ? 'В режим Студента 🎒' : 'В режим Преподавателя 🎓'}
        </button>
      </div>

      {/* HEADER */}
      <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
            {role === 'teacher' ? 'Мои учебные классы' : 'Мой учебный класс'}
          </h1>
          <p className="text-slate-500 mt-1">
            {role === 'teacher' 
              ? 'Управляйте группами, создавайте задания и просматривайте статистику учеников.' 
              : 'Ваше учебное пространство, дедлайны от преподавателя и рейтинг одногруппников.'}
          </p>
        </div>
        
        {role === 'teacher' && (
          <button 
            onClick={() => setShowCreateGroup(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition shadow-sm"
          >
            <Plus className="w-5 h-5" />
            Создать класс
          </button>
        )}
      </div>

      {/* CREATE GROUP PANEL */}
      {showCreateGroup && role === 'teacher' && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 mb-8 flex items-end gap-4">
          <div className="flex-1">
            <label className="block text-sm font-bold text-slate-700 mb-2">Название новой группы</label>
            <input autoFocus value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="Например: ПИ-22 (Алгебра)" className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <button onClick={handleCreateGroup} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition h-[42px]">Создать</button>
          <button onClick={() => setShowCreateGroup(false)} className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold transition h-[42px]">Отмена</button>
        </motion.div>
      )}

      {/* LOADING */}
      {loading && (
        <div className="text-center py-20">
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500 font-medium">Загрузка информации о группах...</p>
        </div>
      )}

      {/* EMPTY GROUPS STATE */}
      {!loading && groups.length === 0 && (
        <div className="space-y-6">
          <div className="text-center py-16 bg-white rounded-3xl border border-slate-200 border-dashed">
            <Users className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-slate-800">
              {role === 'teacher' ? 'У вас пока нет групп' : 'Вы пока не вступили в группу'}
            </h2>
            <p className="text-slate-500 mt-2 max-w-sm mx-auto text-sm leading-relaxed">
              {role === 'teacher' 
                ? 'Создайте свой первый класс, чтобы пригласить студентов по коду приглашения.' 
                : 'Вам нужно вступить в группу вашего преподавателя по пятизначному коду приглашения.'}
            </p>
            {role === 'student' && (
              <button
                onClick={() => navigate('/library')}
                className="mt-6 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition shadow-md shadow-indigo-200"
              >
                Вступить в класс
              </button>
            )}
          </div>

          {/* Step by step guide card */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
            <h3 className="font-extrabold text-slate-800 text-base mb-4">
              Как устроена работа с классами? 🧭
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {role === 'teacher' ? (
                <>
                  <div className="space-y-2">
                    <span className="w-7 h-7 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center font-bold text-xs">1</span>
                    <h4 className="font-bold text-slate-700 text-sm">Создайте класс</h4>
                    <p className="text-slate-500 text-xs leading-relaxed">Нажмите кнопку «Создать класс» в правом верхнем углу этой страницы и введите его название.</p>
                  </div>
                  <div className="space-y-2">
                    <span className="w-7 h-7 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center font-bold text-xs">2</span>
                    <h4 className="font-bold text-slate-700 text-sm">Передайте код</h4>
                    <p className="text-slate-500 text-xs leading-relaxed">Скопируйте уникальный пятизначный код класса из карточки группы и отправьте его своим ученикам.</p>
                  </div>
                  <div className="space-y-2">
                    <span className="w-7 h-7 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center font-bold text-xs">3</span>
                    <h4 className="font-bold text-slate-700 text-sm">Назначьте лекцию</h4>
                    <p className="text-slate-500 text-xs leading-relaxed">Нажмите «Назначить задание», выберите лекцию из своей библиотеки и укажите дату сдачи (дедлайн).</p>
                  </div>
                  <div className="space-y-2">
                    <span className="w-7 h-7 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center font-bold text-xs">4</span>
                    <h4 className="font-bold text-slate-700 text-sm">Следите за топом</h4>
                    <p className="text-slate-500 text-xs leading-relaxed">В лидерборде вы увидите активность студентов за 7 дней и всё время (XP за карточки и экзамены).</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <span className="w-7 h-7 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center font-bold text-xs">1</span>
                    <h4 className="font-bold text-slate-700 text-sm">Получите код</h4>
                    <p className="text-slate-500 text-xs leading-relaxed">Попросите у своего преподавателя уникальный 5-значный код для вступления в его группу.</p>
                  </div>
                  <div className="space-y-2">
                    <span className="w-7 h-7 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center font-bold text-xs">2</span>
                    <h4 className="font-bold text-slate-700 text-sm">Вступите в класс</h4>
                    <p className="text-slate-500 text-xs leading-relaxed">Перейдите в «Библиотеку» и в правом верхнем углу нажмите кнопку «Ввести код класса».</p>
                  </div>
                  <div className="space-y-2">
                    <span className="w-7 h-7 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center font-bold text-xs">3</span>
                    <h4 className="font-bold text-slate-700 text-sm">Делайте задания</h4>
                    <p className="text-slate-500 text-xs leading-relaxed">Изучайте назначенные преподавателем конспекты, чтобы успешно уложиться в дедлайны.</p>
                  </div>
                  <div className="space-y-2">
                    <span className="w-7 h-7 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center font-bold text-xs">4</span>
                    <h4 className="font-bold text-slate-700 text-sm">Участвуйте в рейтинге</h4>
                    <p className="text-slate-500 text-xs leading-relaxed">Решайте тесты и заучивайте карточки, накапливайте еженедельный XP и занимайте топ-3 пьедестала!</p>
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
            <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden sticky top-4">
              <div className="p-4 border-b border-slate-100 bg-slate-50">
                <h2 className="font-bold text-slate-700 uppercase tracking-wider text-xs">Список классов</h2>
              </div>
              <div className="p-2 space-y-1 max-h-[60vh] overflow-y-auto">
                {groups.map(g => (
                  <button
                    key={g.id}
                    onClick={() => setSelectedGroupId(g.id)}
                    className={`w-full text-left px-4 py-3 rounded-xl transition ${selectedGroupId === g.id ? 'bg-indigo-50 text-indigo-700 font-bold' : 'hover:bg-slate-50 text-slate-700 font-medium'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate mr-2">{g.name}</span>
                      <Users className={`w-4 h-4 shrink-0 ${selectedGroupId === g.id ? 'text-indigo-400' : 'text-slate-300'}`} />
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
              <div className="bg-white rounded-3xl p-6 border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">{selectedGroup.name}</h2>
                  
                  <div className="flex flex-wrap items-center gap-4 mt-2 text-slate-500 text-sm">
                    {role === 'student' && (
                      <div className="flex items-center gap-1">
                        <Users className="w-4 h-4 text-slate-400" />
                        <span>Преподаватель: <span className="font-semibold text-slate-700">{teacherName}</span></span>
                      </div>
                    )}
                    
                    <div className="flex items-center gap-2">
                      <Key className="w-4 h-4 text-slate-400" />
                      <span>Код приглашения:</span>
                      <span className="font-mono bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-bold text-base select-all">
                        {selectedGroup.invite_code}
                      </span>
                    </div>
                  </div>
                </div>
                
                {role === 'teacher' && (
                  <button 
                    onClick={() => setShowAssignModal(true)}
                    className="px-5 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition"
                  >
                    Назначить задание
                  </button>
                )}
              </div>

              {/* ASSIGN MATERIAL MODAL */}
              {showAssignModal && role === 'teacher' && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl p-6 border border-indigo-100 shadow-lg shadow-indigo-100/50">
                  <h3 className="font-bold text-slate-900 mb-4">Назначить материал группе</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Выберите материал из вашей библиотеки</label>
                      <select value={selectedMaterial} onChange={e => setSelectedMaterial(e.target.value)} className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none">
                        <option value="">-- Выберите материал --</option>
                        {materials.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Дедлайн (опционально)</label>
                      <input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>
                    <div className="flex gap-2 justify-end pt-2">
                      <button onClick={() => setShowAssignModal(false)} className="px-4 py-2 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200">Отмена</button>
                      <button onClick={handleAssign} disabled={!selectedMaterial} className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50">Назначить</button>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Assignments List */}
              {assignments.length > 0 && (
                <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
                  <div className="p-4 border-b border-slate-100 flex items-center gap-2 bg-slate-50">
                    <BookOpen className="w-5 h-5 text-indigo-500" />
                    <h3 className="font-bold text-slate-800 text-sm">Назначенные задания ({assignments.length})</h3>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {assignments.map(a => (
                      <div key={a.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                        <div>
                          <div className="font-bold text-slate-800">{a.material?.title || 'Удаленный материал'}</div>
                          {a.deadline && (
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-500 mt-1">
                              <Calendar className="w-3.5 h-3.5" />
                              Дедлайн: {format(new Date(a.deadline), 'd MMMM, HH:mm', { locale: ru })}
                            </div>
                          )}
                        </div>
                        {role === 'student' && a.material && (
                          <button
                            onClick={() => navigate(`/library/${a.material_id}`)}
                            className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg text-xs transition"
                          >
                            Изучить →
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* LEADERBOARD / STUDENTS PERFORMANCE */}
              <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm p-6 space-y-6">
                
                {/* Section header & Toggles */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-amber-500" />
                    <h3 className="font-extrabold text-slate-800 text-lg">Рейтинг участников класса ({members.length})</h3>
                  </div>
                  
                  {/* Weekly / All-time toggle */}
                  <div className="flex bg-slate-100 p-1 rounded-xl w-full sm:w-auto">
                    <button
                      onClick={() => setLeaderboardTab('all-time')}
                      className={`flex-1 sm:flex-initial px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        leaderboardTab === 'all-time'
                          ? 'bg-slate-900 text-white shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      За все время
                    </button>
                    <button
                      onClick={() => setLeaderboardTab('weekly')}
                      className={`flex-1 sm:flex-initial px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        leaderboardTab === 'weekly'
                          ? 'bg-slate-900 text-white shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      За 7 дней
                    </button>
                  </div>
                </div>

                {members.length === 0 ? (
                  <p className="text-center text-slate-500 py-10">
                    Пока никто не присоединился к этой группе.
                  </p>
                ) : (
                  <div className="space-y-8">
                    
                    {/* PODIUM (TOP-3 STUDENTS) */}
                    {podium.length > 0 && (
                      <div className="flex items-end justify-center gap-2 md:gap-6 pt-12 pb-4 overflow-x-auto min-w-[280px]">
                        
                        {/* 2nd place */}
                        {podium[0] && (
                          <div className="flex flex-col items-center">
                            <div className="relative mb-3 flex flex-col items-center">
                              {podium[0].student_avatar ? (
                                <img src={podium[0].student_avatar} alt="avatar" className="w-14 h-14 rounded-full border-2 border-slate-300 shadow-md" />
                              ) : (
                                <div className="w-14 h-14 rounded-full bg-slate-200 border-2 border-slate-300 flex items-center justify-center text-slate-500 font-bold text-sm shadow-md">
                                  {podium[0].student_name?.[0]}
                                </div>
                              )}
                              <span className="absolute -top-3 bg-slate-300 text-slate-800 p-0.5 rounded-full shadow border border-white text-xs font-black">
                                <Medal className="w-3.5 h-3.5 text-slate-600" />
                              </span>
                            </div>
                            <span className="text-xs font-bold text-slate-700 max-w-[90px] truncate text-center mb-1">{podium[0].student_name}</span>
                            <div className="w-20 md:w-24 bg-slate-100/80 border-t-2 border-slate-300 rounded-t-xl h-24 flex flex-col items-center justify-center shadow-sm">
                              <span className="font-mono text-xs font-black text-slate-600">2 место</span>
                              <span className="text-[10px] font-black text-indigo-500 mt-1">
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
                                <div className="w-16 h-16 rounded-full bg-amber-50 border-4 border-amber-400 flex items-center justify-center text-amber-700 font-black text-base shadow-lg">
                                  {podium[1].student_name?.[0]}
                                </div>
                              )}
                              <span className="absolute -top-3.5 bg-amber-400 text-white p-0.5 rounded-full shadow border-2 border-white animate-bounce">
                                <Crown className="w-4 h-4 fill-amber-300" />
                              </span>
                            </div>
                            <span className="text-xs font-black text-slate-800 max-w-[100px] truncate text-center mb-1">{podium[1].student_name}</span>
                            <div className="w-24 md:w-28 bg-gradient-to-t from-amber-50 to-amber-100/50 border-t-4 border-amber-400 rounded-t-2xl h-32 flex flex-col items-center justify-center shadow-md">
                              <span className="font-mono text-xs font-black text-amber-700">1 место</span>
                              <span className="text-xs font-black text-indigo-600 mt-1">
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
                                <div className="w-12 h-12 rounded-full bg-slate-200 border-2 border-amber-600 flex items-center justify-center text-slate-500 font-bold text-xs shadow-md">
                                  {podium[2].student_name?.[0]}
                                </div>
                              )}
                              <span className="absolute -top-3 bg-amber-700 text-white p-0.5 rounded-full shadow border border-white text-xs font-black">
                                <Award className="w-3.5 h-3.5 text-amber-200" />
                              </span>
                            </div>
                            <span className="text-xs font-bold text-slate-700 max-w-[80px] truncate text-center mb-1">{podium[2].student_name}</span>
                            <div className="w-18 md:w-20 bg-amber-50/20 border-t-2 border-amber-600 rounded-t-xl h-20 flex flex-col items-center justify-center shadow-sm">
                              <span className="font-mono text-[10px] font-black text-amber-800">3 место</span>
                              <span className="text-[10px] font-black text-indigo-500 mt-1">
                                {leaderboardTab === 'all-time' ? podium[2].total_xp : (podium[2] as any).weekly_xp} XP
                              </span>
                            </div>
                          </div>
                        )}

                      </div>
                    )}

                    {/* REST OF THE RANKINGS LIST */}
                    {restRankings.length > 0 && (
                      <div className="overflow-hidden border border-slate-100 rounded-2xl">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider font-bold">
                              <th className="p-4 w-12 text-center">Ранг</th>
                              <th className="p-4">Студент</th>
                              <th className="p-4 text-right">Опыт в этой группе (XP)</th>
                              <th className="p-4 text-right">Повторений</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {restRankings.map((m, index) => {
                              const rank = index + 4;
                              const score = leaderboardTab === 'all-time' ? m.total_xp : (m as any).weekly_xp;
                              return (
                                <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                                  <td className="p-4 font-mono font-bold text-slate-400 text-center">{rank}</td>
                                  <td className="p-4">
                                    <div className="flex items-center gap-3">
                                      {m.student_avatar ? (
                                        <img src={m.student_avatar} alt="avatar" className="w-8 h-8 rounded-full" />
                                      ) : (
                                        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-bold text-xs">
                                          {m.student_name?.[0] || '?'}
                                        </div>
                                      )}
                                      <span className="font-bold text-slate-800">{m.student_name}</span>
                                    </div>
                                  </td>
                                  <td className="p-4 text-right font-mono text-indigo-600 font-bold">{score} XP</td>
                                  <td className="p-4 text-right text-slate-600 font-medium">{m.total_reviews || 0}</td>
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
