import { supabase } from '../lib/supabase';

export async function getMaterials(userId: string) {
  const { data, error } = await supabase
    .from('materials')
    .select('id, title, subject, created_at, flashcards_json, quiz_json, original_text, summary_json, missions_json')
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

export async function updateMaterialTitle(id: string, title: string) {
  const { error } = await supabase.from('materials').update({ title }).eq('id', id);
  if (error) console.error('updateMaterialTitle error:', error);
}

/**
 * Меняет видимость материала и сообщает о неудаче: ошибка запроса или запись,
 * которая не изменила ни одной строки (материал чужой), — исключение. Тогда
 * страница не показывает «открыт по ссылке» и не копирует мёртвую ссылку.
 */
export async function setMaterialVisibility(id: string, isPublic: boolean): Promise<void> {
  const { data, error } = await supabase.from('materials').update({ is_public: isPublic }).eq('id', id).select('id');
  if (error) throw error;
  if (Array.isArray(data) && data.length === 0) throw new Error('Материал не изменён: нет прав на запись');
}