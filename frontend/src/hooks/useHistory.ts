import { useState } from 'react';
import { HistoryItem } from '../types';

const STORAGE_KEY = 'studyforge_history';
const MAX_ITEMS = 10;

export function useHistory() {
  const load = (): HistoryItem[] => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  };

  const [items, setItems] = useState<HistoryItem[]>(load);

  const add = (item: HistoryItem) => {
    setItems(prev => {
      const next = [item, ...prev].slice(0, MAX_ITEMS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const remove = (id: string) => {
    setItems(prev => {
      const next = prev.filter(i => i.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const clear = () => {
    setItems([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  return { items, add, remove, clear };
}
