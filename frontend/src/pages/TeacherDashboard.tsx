import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { getTeacherGroups, createGroup, getGroupMembers, getGroupAssignments, createAssignment, Group, GroupMember, Assignment } from '../api/groups';
import { getMaterials } from '../api/materials';
import { Material } from '../types';
import { Users, Plus, Key, Calendar, BookOpen, AlertCircle, TrendingUp, Search } from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

export default function TeacherDashboard() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState('');
  const [deadline, setDeadline] = useState('');

  const loadGroups = async () => {
    if (!user) return;
    const data = await getTeacherGroups(user.id);
    setGroups(data);
    if (data.length > 0 && !selectedGroupId) {
      setSelectedGroupId(data[0].id);
    }
  };

  useEffect(() => {
    loadGroups();
    if (user) {
      getMaterials(user.id).then(setMaterials);
    }
  }, [user]);

  useEffect(() => {
    if (selectedGroupId) {
      getGroupMembers(selectedGroupId).then(setMembers);
      getGroupAssignments(selectedGroupId).then(setAssignments);
    }
  }, [selectedGroupId]);

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

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto min-h-[85vh]">
      <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900">Мои классы</h1>
          <p className="text-slate-500 mt-1">Управляйте группами, назначайте материалы и следите за прогрессом.</p>
        </div>
        <button 
          onClick={() => setShowCreateGroup(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition shadow-sm"
        >
          <Plus className="w-5 h-5" />
          Создать класс
        </button>
      </div>

      {showCreateGroup && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 mb-8 flex items-end gap-4">
          <div className="flex-1">
            <label className="block text-sm font-bold text-slate-700 mb-2">Название новой группы</label>
            <input autoFocus value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="Например: ПИ-22 (Алгебра)" className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <button onClick={handleCreateGroup} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition h-[42px]">Создать</button>
          <button onClick={() => setShowCreateGroup(false)} className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold transition h-[42px]">Отмена</button>
        </motion.div>
      )}

      {groups.length === 0 && !showCreateGroup && (
        <div className="text-center py-20 bg-white rounded-3xl border border-slate-200 border-dashed">
          <Users className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-800">У вас пока нет групп</h2>
          <p className="text-slate-500 mt-2">Создайте свой первый класс, чтобы пригласить студентов.</p>
        </div>
      )}

      {groups.length > 0 && (
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar */}
          <div className="lg:w-1/3 shrink-0">
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
                      <span>{g.name}</span>
                      <Users className={`w-4 h-4 ${selectedGroupId === g.id ? 'text-indigo-400' : 'text-slate-300'}`} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Main Panel */}
          {selectedGroup && (
            <div className="lg:w-2/3 flex-1 space-y-6">
              {/* Group Header */}
              <div className="bg-white rounded-3xl p-6 border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">{selectedGroup.name}</h2>
                  <div className="flex items-center gap-2 mt-2 text-slate-500">
                    <Key className="w-4 h-4" />
                    <span>Код приглашения:</span>
                    <span className="font-mono bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-bold text-lg select-all">{selectedGroup.invite_code}</span>
                  </div>
                </div>
                <button 
                  onClick={() => setShowAssignModal(true)}
                  className="px-5 py-2 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition"
                >
                  Назначить задание
                </button>
              </div>

              {showAssignModal && (
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
                <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden">
                  <div className="p-5 border-b border-slate-100 flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-indigo-500" />
                    <h3 className="font-bold text-slate-900">Назначенные задания ({assignments.length})</h3>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {assignments.map(a => (
                      <div key={a.id} className="p-4 flex items-center justify-between">
                        <div>
                          <div className="font-bold text-slate-800">{a.material?.title || 'Удаленный материал'}</div>
                          {a.deadline && (
                            <div className="flex items-center gap-1.5 text-xs font-medium text-rose-500 mt-1">
                              <Calendar className="w-3.5 h-3.5" />
                              Дедлайн: {format(new Date(a.deadline), 'd MMMM, HH:mm', { locale: ru })}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Students Table */}
              <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-emerald-500" />
                  <h3 className="font-bold text-slate-900">Успеваемость студентов ({members.length})</h3>
                </div>
                {members.length === 0 ? (
                  <div className="p-8 text-center text-slate-500">
                    Пока никто не присоединился к этой группе.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                          <th className="p-4 font-bold">Студент</th>
                          <th className="p-4 font-bold">Опыт (XP)</th>
                          <th className="p-4 font-bold">Повторений</th>
                          <th className="p-4 font-bold">Вступил</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {members.map(m => (
                          <tr key={m.id} className="hover:bg-slate-50 transition">
                            <td className="p-4">
                              <div className="flex items-center gap-3">
                                {m.student_avatar ? (
                                  <img src={m.student_avatar} alt="avatar" className="w-8 h-8 rounded-full" />
                                ) : (
                                  <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-bold text-xs">
                                    {m.student_name?.[0] || '?'}
                                  </div>
                                )}
                                <span className="font-bold text-slate-800">{m.student_name || 'Студент'}</span>
                              </div>
                            </td>
                            <td className="p-4 font-mono text-indigo-600 font-bold">{m.total_xp}</td>
                            <td className="p-4 text-slate-600 font-medium">{m.total_reviews || 0}</td>
                            <td className="p-4 text-slate-400 text-sm">{format(new Date(m.joined_at), 'd MMM yyyy', { locale: ru })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
