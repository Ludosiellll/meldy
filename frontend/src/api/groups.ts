import { supabase } from '../lib/supabase';
import { Material } from '../types';

export interface Group {
  id: string;
  name: string;
  teacher_id: string;
  invite_code: string;
  created_at: string;
}

export interface GroupMember {
  id: string;
  group_id: string;
  student_id: string;
  joined_at: string;
  student_name?: string;
  student_avatar?: string;
  total_xp?: number;
  total_reviews?: number;
}

export interface Assignment {
  id: string;
  group_id: string;
  material_id: string;
  deadline?: string;
  created_at: string;
  material?: Material;
}

// Generate random code e.g. MTH-4X9
export function generateInviteCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const a = Array.from({length: 3}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const b = Array.from({length: 3}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${a}-${b}`;
}

export async function createGroup(name: string, teacherId: string): Promise<Group | null> {
  const { data, error } = await supabase.from('groups').insert({
    name,
    teacher_id: teacherId,
    invite_code: generateInviteCode()
  }).select('*').single();
  
  if (error) { console.error('createGroup', error); return null; }
  return data;
}

export async function getTeacherGroups(teacherId: string): Promise<Group[]> {
  const { data, error } = await supabase.from('groups').select('*').eq('teacher_id', teacherId).order('created_at', { ascending: false });
  if (error) { console.error('getTeacherGroups', error); return []; }
  return data;
}

export async function getGroupMembers(groupId: string): Promise<GroupMember[]> {
  const { data, error } = await supabase.from('group_members').select('*').eq('group_id', groupId);
  if (error || !data) return [];

  const studentIds = data.map(m => m.student_id);
  
  // Fetch profiles for names/avatars
  const { data: profiles } = await supabase.from('profiles').select('id, full_name, avatar_url, total_reviews').in('id', studentIds);
  // Fetch XP
  const { data: xps } = await supabase.from('user_xp').select('user_id, total_xp').in('user_id', studentIds);
  
  const profileMap = new Map((profiles || []).map(p => [p.id, p]));
  const xpMap = new Map((xps || []).map(x => [x.user_id, x.total_xp]));

  return data.map(m => {
    const p = profileMap.get(m.student_id);
    return {
      ...m,
      student_name: p?.full_name,
      student_avatar: p?.avatar_url,
      total_reviews: p?.total_reviews,
      total_xp: xpMap.get(m.student_id) || 0
    };
  });
}

export async function joinGroup(studentId: string, inviteCode: string): Promise<boolean> {
  // 1. Find group by code
  const { data: group, error: grpErr } = await supabase.from('groups').select('id').eq('invite_code', inviteCode.toUpperCase()).single();
  if (grpErr || !group) return false;

  // 2. Insert membership
  const { error } = await supabase.from('group_members').insert({
    group_id: group.id,
    student_id: studentId
  });

  if (error && error.code !== '23505') { // Ignore unique constraint violation
    console.error('joinGroup', error);
    return false;
  }
  return true;
}

export async function createAssignment(groupId: string, materialId: string, deadline?: string): Promise<boolean> {
  const { error } = await supabase.from('assignments').insert({
    group_id: groupId,
    material_id: materialId,
    deadline: deadline || null
  });
  if (error) console.error('createAssignment', error);
  return !error;
}

export async function getGroupAssignments(groupId: string): Promise<Assignment[]> {
  const { data, error } = await supabase.from('assignments').select('*, material:materials(*)').eq('group_id', groupId).order('created_at', { ascending: false });
  if (error) { console.error('getGroupAssignments', error); return []; }
  return data;
}

// Get materials assigned to a student
export async function getAssignedMaterials(studentId: string): Promise<Material[]> {
  // Find groups
  const { data: memberships } = await supabase.from('group_members').select('group_id').eq('student_id', studentId);
  if (!memberships || memberships.length === 0) return [];
  
  const groupIds = memberships.map(m => m.group_id);
  
  // Find assignments
  const { data: assignments } = await supabase.from('assignments').select('*, material:materials(*)').in('group_id', groupIds);
  if (!assignments) return [];

  // Return materials, map deadline
  return assignments.map(a => {
    const mat = a.material as any;
    if (mat) {
      mat.assigned_deadline = a.deadline;
      mat.is_assigned = true;
    }
    return mat;
  }).filter(Boolean);
}

export interface AssignmentCompletion {
  id: string;
  assignment_id: string;
  student_id: string;
  completed_at: string;
}

export async function toggleAssignmentCompletion(assignmentId: string, studentId: string, markCompleted: boolean): Promise<boolean> {
  if (markCompleted) {
    const { error } = await supabase.from('assignment_completions').insert({
      assignment_id: assignmentId,
      student_id: studentId
    });
    if (error && error.code !== '23505') { // Ignore unique constraint violation
      console.error('toggleAssignmentCompletion', error);
      return false;
    }
  } else {
    const { error } = await supabase.from('assignment_completions').delete().eq('assignment_id', assignmentId).eq('student_id', studentId);
    if (error) {
      console.error('toggleAssignmentCompletion', error);
      return false;
    }
  }
  return true;
}

export async function getStudentCompletions(studentId: string): Promise<string[]> {
  const { data, error } = await supabase.from('assignment_completions').select('assignment_id').eq('student_id', studentId);
  if (error || !data) return [];
  return data.map(c => c.assignment_id);
}

export async function getGroupCompletions(groupId: string): Promise<any[]> {
  const { data: assignments } = await supabase.from('assignments').select('id').eq('group_id', groupId);
  if (!assignments || assignments.length === 0) return [];
  const assignmentIds = assignments.map(a => a.id);
  
  const { data, error } = await supabase.from('assignment_completions').select('*').in('assignment_id', assignmentIds);
  if (error || !data) return [];
  return data;
}

