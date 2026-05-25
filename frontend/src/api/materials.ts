import { supabase } from '../lib/supabase';

export async function getMaterials(userId: string) {
  const { data, error } = await supabase
    .from('materials')
    .select('id, title, subject, created_at, flashcards_json, quiz_json, original_text, summary_json')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getMaterialById(id: string) {
  const { data, error } = await supabase
    .from('materials')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function deleteMaterial(id: string) {
  const { error } = await supabase.from('materials').delete().eq('id', id);
  if (error) throw error;
}

export async function updateMaterialSubject(id: string, subject: string) {
  const { error } = await supabase.from('materials').update({ subject }).eq('id', id);
  if (error) console.error('updateMaterialSubject error:', error);
}

export async function updateMaterialVisibility(id: string, is_public: boolean) {
  const { error } = await supabase.from('materials').update({ is_public }).eq('id', id);
  if (error) console.error('updateMaterialVisibility error:', error);
}