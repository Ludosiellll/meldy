import { supabase } from '../lib/supabase';
import { format, subDays } from 'date-fns';

export async function loadDemoData(userId: string) {
  try {
    // 1. Create a dummy material
    const { data: matData, error: matErr } = await supabase.from('materials').insert([{
      user_id: userId,
      title: 'Демо: Законы Экологии Коммонера',
      subject: 'Экология',
      original_text: '...',
      extracted_concepts: [],
      status: 'completed'
    }]).select('id').single();

    if (matErr) throw matErr;
    const materialId = matData.id;

    // 2. Create flashcards
    const cards = [
      { material_id: materialId, question: 'Первый закон экологии', answer: 'Всё связано со всем' },
      { material_id: materialId, question: 'Второй закон', answer: 'Всё должно куда-то деваться' },
      { material_id: materialId, question: 'Третий закон', answer: 'Природа знает лучше' },
      { material_id: materialId, question: 'Четвертый закон', answer: 'Ничто не даётся даром' }
    ];
    await supabase.from('flashcards').insert(cards);

    // 3. Create exam sessions (for chart)
    const exams = Array.from({ length: 6 }).map((_, i) => ({
      user_id: userId,
      material_id: materialId,
      status: 'completed',
      score: 40 + i * 10,
      completed_at: new Date().toISOString()
    }));
    await supabase.from('exam_sessions').insert(exams);

    // 4. Create mistakes
    const mistakes = [
      {
        user_id: userId,
        material_id: materialId,
        question: 'Объясните второй закон Барри Коммонера.',
        correct_answer: 'Полное игнорирование поставленного вопроса о проблеме отходов.',
        student_answer: 'Он про природу',
        topic: 'Экология',
        is_resolved: false
      }
    ];
    await supabase.from('mistake_diary').insert(mistakes);

    // 5. Create study sessions for heatmap
    const sessions = [];
    for (let i = 0; i < 30; i++) {
      // Simulate learning over the last 30 days
      const d = subDays(new Date(), i);
      const reviews = Math.floor(Math.random() * 20);
      if (reviews > 0) {
        sessions.push({
          user_id: userId,
          date: format(d, 'yyyy-MM-dd'),
          cards_reviewed: reviews,
          minutes_studied: Math.floor(reviews * 1.5)
        });
      }
    }
    await supabase.from('study_sessions').insert(sessions);

    return true;
  } catch (e) {
    console.error('Demo data error:', e);
    return false;
  }
}
