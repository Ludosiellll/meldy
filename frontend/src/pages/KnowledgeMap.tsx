import { SummaryInfo, Term } from '../types';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Network, BookOpen, AlertCircle, CheckCircle2,
  Plus, Minus, ChevronRight, Zap, Info, HelpCircle
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { useTheme } from '../contexts/ThemeProvider';

interface GraphNode {
  id: string;
  label: string;
  type: 'material' | 'concept';
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  status: 'weak' | 'strong' | 'neutral';
  color: string;
  definition?: string;
  materials?: { id: string; title: string }[];
  details?: any;
  fx?: number | null;
  fy?: number | null;
}

interface GraphLink {
  source: string;
  target: string;
}

// Obsidian-style palette
const SUBJECT_COLORS = [
  '#a78bfa', // Purple / Violet
  '#38bdf8', // Cyan / Sky
  '#f472b6', // Pink
  '#fb923c', // Orange
  '#fb7185', // Rose
  '#2dd4bf', // Teal
  '#c084fc', // Fuchsia
  '#60a5fa'  // Blue
];

export default function KnowledgeMap() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const [loading, setLoading] = useState(true);
  const [materials, setMaterials] = useState<any[]>([]);
  const [mistakes, setMistakes] = useState<any[]>([]);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Карта (zoom/pan)
  const [scale, setScale] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  // Физика графа
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  
  const requestRef = useRef<number | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const linksRef = useRef<GraphLink[]>([]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  
  // Перетаскивание и зум
  const draggingNodeId = useRef<string | null>(null);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const panStartPos = useRef({ x: 0, y: 0 });
  
  // Pinch zoom (щипок)
  const initialPinchDistance = useRef<number | null>(null);
  const initialPinchScale = useRef<number>(1);

  // 1. Загрузка данных
  useEffect(() => {
    if (!user?.id) return;
    Promise.all([
      supabase.from('materials').select('*').eq('user_id', user.id),
      supabase.from('mistake_diary').select('*').eq('user_id', user.id)
    ]).then(([matsRes, mistakesRes]) => {
      setMaterials(matsRes.data || []);
      setMistakes(mistakesRes.data || []);
      setLoading(false);
    }).catch(console.error);
  }, [user?.id]);

  // Парсер терминов из конспекта
  const extractTerms = (rawSummary: any) => {
    let summaryJson = rawSummary;
    if (typeof rawSummary === 'string') {
      try { summaryJson = JSON.parse(rawSummary); } catch (e) {}
    }

    const terms: { term: string; definition: string }[] = [];

    // Приоритет 1: Использование структурированных терминов от ИИ
    if (summaryJson?.terms && Array.isArray(summaryJson.terms)) {
      summaryJson.terms.forEach((t: any) => {
        if (t.term && t.definition) {
          let def = String(t.definition).trim();
          if (def.length > 150) {
             const dotIndex = def.indexOf('.');
             if (dotIndex > 10) def = def.substring(0, dotIndex + 1);
          }
          terms.push({ term: String(t.term).trim(), definition: def });
        }
      });
    }

    if (terms.length > 0) return terms;

    const content = summaryJson?.content || summaryJson?.raw || '';
    if (!content) return [];
    
    // Попытка 1: Ищем специализированную секцию терминов (стандартный формат)
    const sections = content.split(/(?=^## )/gm);
    const termsSection = sections.find((s: string) => 
      s.includes('Термины') || s.includes('Терминология') || s.includes('📚')
    );

    const lineRegex = /(?:\d+\.|\*|-)\s+\*\*([^*]+)\*\*\s*(?:—|-|–|:)\s*(.+)/g;
    
    if (termsSection) {
      let match;
      while ((match = lineRegex.exec(termsSection)) !== null) {
        terms.push({
          term: match[1].trim(),
          definition: match[2].trim()
        });
      }
    }
    
    // Попытка 2: Если терминов не найдено (или секции нет), ищем любые выделенные термины по всему тексту
    if (terms.length === 0) {
      const globalRegex = /\*\*([^*]+)\*\*\s*(?:—|-|–|:)\s*([^\n]+)/g;
      let match;
      while ((match = globalRegex.exec(content)) !== null) {
        const term = match[1].trim();
        let definition = match[2].trim();
        
        if (term.length > 0 && term.length <= 45 && definition.length > 5) {
          if (definition.length > 150) {
             const dotIndex = definition.indexOf('.');
             if (dotIndex > 10) definition = definition.substring(0, dotIndex + 1);
          }
          terms.push({ term, definition });
        }
      }
    }

    return terms;
  };

  // 2. Генерация графа
  useEffect(() => {
    if (loading || materials.length === 0) return;

    const width = 1600;
    const height = 1000;

    const tempNodes: GraphNode[] = [];
    const tempLinks: GraphLink[] = [];

    const conceptMap: Record<string, {
      term: string;
      definition: string;
      materials: { id: string; title: string }[];
      status: 'weak' | 'strong' | 'neutral';
    }> = {};

    const subjectColorMap: Record<string, string> = {};
    let colorIdx = 0;

    // Дедупликация материалов (лекций) с одинаковыми названиями
    // Предотвращает ситуацию, когда загруженные дубликаты стягивают концепты в центр между собой
    const uniqueMaterials = materials.reduce((acc: any[], current) => {
      if (!acc.some(item => item.title.trim().toLowerCase() === current.title.trim().toLowerCase())) {
        acc.push(current);
      }
      return acc;
    }, []);

    const numMats = uniqueMaterials.length;
    uniqueMaterials.forEach((mat, idx) => {
      const subject = mat.subject || 'Общее';
      if (!subjectColorMap[subject]) {
        subjectColorMap[subject] = SUBJECT_COLORS[colorIdx % SUBJECT_COLORS.length];
        colorIdx++;
      }

      // Распределяем лекции равномерно по широкому эллипсу, чтобы избежать слипания в линию
      const angle = (idx / Math.max(1, numMats)) * Math.PI * 2 + (Math.random() - 0.5) * 0.15;
      const radiusX = 420 + (Math.random() - 0.5) * 80;
      const radiusY = 280 + (Math.random() - 0.5) * 60;
      const initX = width / 2 + Math.cos(angle) * radiusX;
      const initY = height / 2 + Math.sin(angle) * radiusY;

      tempNodes.push({
        id: mat.id,
        label: mat.title,
        type: 'material',
        x: initX,
        y: initY,
        vx: 0,
        vy: 0,
        radius: 36, // Звезда больше
        status: 'neutral',
        color: subjectColorMap[subject],
        details: mat
      });

      const terms = extractTerms(mat.summary_json);
      terms.forEach((t: Term) => {
        const key = t.term.toLowerCase();
        
        const termMistakes = mistakes.filter(m => {
          const topicMatch = m.topic && m.topic.toLowerCase().includes(key);
          const questionMatch = m.question && m.question.toLowerCase().includes(key);
          return topicMatch || questionMatch;
        });

        let status: 'weak' | 'strong' | 'neutral' = 'neutral';
        if (termMistakes.length > 0) {
          status = termMistakes.some(m => !m.is_resolved) ? 'weak' : 'strong';
        }

        if (conceptMap[key]) {
          // Prevent duplicates
          if (!conceptMap[key].materials.find(m => m.id === mat.id)) {
            conceptMap[key].materials.push({ id: mat.id, title: mat.title });
          }
          if (status === 'weak') conceptMap[key].status = 'weak';
          else if (status === 'strong' && conceptMap[key].status !== 'weak') {
            conceptMap[key].status = 'strong';
          }
        } else {
          conceptMap[key] = {
            term: t.term,
            definition: t.definition,
            materials: [{ id: mat.id, title: mat.title }],
            status
          };
        }
      });
    });

    const conceptKeys = Object.keys(conceptMap);
    conceptKeys.forEach((key, idx) => {
      const value = conceptMap[key];
      const linksCount = value.materials.length;

      // Инициализируем планету на случайном угле по орбите ее первой лекции (звезды)
      // Это предотвращает слипание планет в одну кучу и сразу задает круговую структуру
      let startX = width / 2;
      let startY = height / 2;
      if (value.materials.length > 0) {
        const firstMat = tempNodes.find(n => n.id === value.materials[0].id);
        if (firstMat) {
          const termAngle = Math.random() * Math.PI * 2;
          const termDist = 90 + Math.random() * 30;
          startX = firstMat.x + Math.cos(termAngle) * termDist;
          startY = firstMat.y + Math.sin(termAngle) * termDist;
        }
      }

      tempNodes.push({
        id: key,
        label: value.term,
        type: 'concept',
        x: startX,
        y: startY,
        vx: 0,
        vy: 0,
        radius: 10 + linksCount * 2.5, // Динамический размер планеты
        status: value.status,
        color: value.status === 'weak' ? '#ef4444' : value.status === 'strong' ? '#22c55e' : '#818cf8',
        definition: value.definition,
        materials: value.materials
      });

      value.materials.forEach(mat => {
        tempLinks.push({
          source: mat.id,
          target: key
        });
      });
    });

    nodesRef.current = tempNodes;
    linksRef.current = tempLinks;
    setNodes(tempNodes);
    setLinks(tempLinks);
  }, [loading, materials, mistakes]);

  // 3. Симуляция физики (Галактическая модель)
  useEffect(() => {
    if (nodes.length === 0) return;

    const width = 1600;
    const height = 1000;

    const tick = () => {
      const currentNodes = [...nodesRef.current];
      const currentLinks = linksRef.current;

      // 1. Силы отталкивания
      for (let i = 0; i < currentNodes.length; i++) {
        const nodeA = currentNodes[i];
        for (let j = i + 1; j < currentNodes.length; j++) {
          const nodeB = currentNodes[j];
          const dx = nodeB.x - nodeA.x;
          const dy = nodeB.y - nodeA.y;
          const distSq = dx * dx + dy * dy + 0.1;
          const dist = Math.sqrt(distSq);
          
          let minDist = 120;
          let strength = 0.5;

          if (nodeA.type === 'material' && nodeB.type === 'material') {
            minDist = 480; // Звезды далеко друг от друга, чтобы их орбиты (планеты) не слипались
            strength = 0.7;
          } else if (nodeA.type === 'concept' && nodeB.type === 'concept') {
            // Планеты сильно расталкиваются, чтобы равномерно распределиться по орбите и не перекрывать тексты
            minDist = nodeA.radius + nodeB.radius + 65; 
            strength = 0.6;
          } else {
            // Звезда и планета (родная или чужая) - держим дистанцию чуть меньше желаемой орбиты (85)
            minDist = nodeA.radius + nodeB.radius + 60;
            strength = 0.55;
          }

          if (dist < minDist) {
            const force = (minDist - dist) * strength;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            
            if (nodeA.fx === undefined || nodeA.fx === null) {
              nodeA.vx -= fx;
              nodeA.vy -= fy;
            }
            if (nodeB.fx === undefined || nodeB.fx === null) {
              nodeB.vx += fx;
              nodeB.vy += fy;
            }
          }
        }
      }

      // 2. Сила притяжения связей (Орбиты)
      for (const link of currentLinks) {
        const source = currentNodes.find(n => n.id === link.source);
        const target = currentNodes.find(n => n.id === link.target);
        if (source && target) {
          const dx = target.x - source.x;
          const dy = target.y - source.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
          
          // Орбита достаточно широкая, чтобы тексты не перекрывали саму звезду
          const desiredDist = source.radius + target.radius + 90; 
          const force = (dist - desiredDist) * 0.15; // Мощно удерживаем на орбите
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          if (source.fx === undefined || source.fx === null) {
            source.vx += fx;
            source.vy += fy;
          }
          if (target.fx === undefined || target.fx === null) {
            target.vx -= fx;
            target.vy -= fy;
          }
        }
      }

      // 3. Формирование органичного кластера
      const centerX = width / 2;
      const centerY = height / 2;

      currentNodes.forEach(node => {
        if (node.fx !== undefined && node.fx !== null && node.fy !== undefined && node.fy !== null) {
          node.x = node.fx;
          node.y = node.fy;
          node.vx = 0;
          node.vy = 0;
        } else {
          // Мягко стягиваем к центру только звезды (лекции), чтобы острова не разлетались.
          // Концепты (планеты) следуют исключительно за своими лекциями (звездами) благодаря связям,
          // это исключает их стягивание в одну общую кучу или линию.
          if (node.type === 'material') {
            const gravity = 0.001;
            node.vx += (centerX - node.x) * gravity;
            node.vy += (centerY - node.y) * gravity;
          }

          node.vx *= 0.85; // Трение значительно ниже (0.85 вместо 0.65), чтобы узлы могли плавно скользить в оптимальные позиции
          node.vy *= 0.85;

          node.x += node.vx;
          node.y += node.vy;

          // Жесткие границы, чтобы ничего не улетало за пределы
          node.x = Math.max(50, Math.min(width - 50, node.x));
          node.y = Math.max(50, Math.min(height - 50, node.y));
        }
      });

      // Синхронизируем nodesRef для следующего кадра
      nodesRef.current = currentNodes;
      setNodes([...currentNodes]);
      requestRef.current = requestAnimationFrame(tick);
    };

    requestRef.current = requestAnimationFrame(tick);

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [loading]);

  // Zoom wheel
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomIntensity = 0.06;
      const zoomFactor = e.deltaY < 0 ? 1 + zoomIntensity : 1 - zoomIntensity;
      setScale(s => Math.max(0.4, Math.min(2.5, s * zoomFactor)));
    };

    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      svg.removeEventListener('wheel', handleWheel);
    };
  }, [loading]);

  // Drag & Pan
  const getMouseCoords = (clientX: number, clientY: number) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const pt = svgRef.current.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    return pt.matrixTransform(ctm.inverse());
  };

  const handlePointerDown = (clientX: number, clientY: number, node?: GraphNode) => {
    if (!svgRef.current) return;

    if (node) {
      const coords = getMouseCoords(clientX, clientY);
      draggingNodeId.current = node.id;
      const clickX = (coords.x - panX) / scale;
      const clickY = (coords.y - panY) / scale;
      dragStartPos.current = { x: clickX, y: clickY };
      
      const matchedNode = nodesRef.current.find(n => n.id === node.id);
      if (matchedNode) {
        matchedNode.fx = matchedNode.x;
        matchedNode.fy = matchedNode.y;
      }
    } else {
      isPanning.current = true;
      panStartPos.current = { x: clientX - panX, y: clientY - panY };
      setSelectedNode(null);
    }
  };

  const handlePointerMove = (clientX: number, clientY: number) => {
    if (!svgRef.current) return;

    if (draggingNodeId.current) {
      const coords = getMouseCoords(clientX, clientY);
      const clickX = (coords.x - panX) / scale;
      const clickY = (coords.y - panY) / scale;

      const matchedNode = nodesRef.current.find(n => n.id === draggingNodeId.current);
      if (matchedNode) {
        matchedNode.fx = clickX;
        matchedNode.fy = clickY;
      }
    } else if (isPanning.current) {
      setPanX(clientX - panStartPos.current.x);
      setPanY(clientY - panStartPos.current.y);
    }
  };

  const handlePointerUp = (node?: GraphNode) => {
    if (draggingNodeId.current) {
      const matchedNode = nodesRef.current.find(n => n.id === draggingNodeId.current);
      if (matchedNode) {
        matchedNode.fx = null;
        matchedNode.fy = null;
      }
      if (node) {
        setSelectedNode(node);
      }
      draggingNodeId.current = null;
    }
    isPanning.current = false;
  };

  const handleMouseDown = (e: React.MouseEvent, node?: GraphNode) => {
    e.preventDefault();
    handlePointerDown(e.clientX, e.clientY, node);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    handlePointerMove(e.clientX, e.clientY);
  };

  const handleMouseUp = (e: React.MouseEvent, node?: GraphNode) => {
    handlePointerUp(node);
  };

  const handleTouchStart = (e: React.TouchEvent, node?: GraphNode) => {
    if (e.touches.length === 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const dist = Math.hypot(touch1.clientX - touch2.clientX, touch1.clientY - touch2.clientY);
      initialPinchDistance.current = dist;
      initialPinchScale.current = scale;
      isPanning.current = false;
      return;
    }
    initialPinchDistance.current = null;
    handlePointerDown(e.touches[0].clientX, e.touches[0].clientY, node);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && initialPinchDistance.current !== null) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const dist = Math.hypot(touch1.clientX - touch2.clientX, touch1.clientY - touch2.clientY);
      const zoomFactor = dist / initialPinchDistance.current;
      setScale(Math.max(0.4, Math.min(2.5, initialPinchScale.current * zoomFactor)));
      return;
    }
    handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
  };

  const handleTouchEnd = (e: React.TouchEvent, node?: GraphNode) => {
    if (e.touches.length < 2) {
      initialPinchDistance.current = null;
    }
    handlePointerUp(node);
  };

  const zoomIn = () => setScale(s => Math.min(2.5, s + 0.15));
  const zoomOut = () => setScale(s => Math.max(0.4, s - 0.15));
  const resetZoom = () => {
    setScale(1);
    setPanX(0);
    setPanY(0);
  };

  // Stats
  const graphStats = useMemo(() => {
    const conceptCount = nodes.filter(n => n.type === 'concept').length;
    const materialsCount = nodes.filter(n => n.type === 'material').length;
    const weakCount = nodes.filter(n => n.type === 'concept' && n.status === 'weak').length;
    const strongCount = nodes.filter(n => n.type === 'concept' && n.status === 'strong').length;
    return { conceptCount, materialsCount, weakCount, strongCount };
  }, [nodes]);

  return (
    <div className="p-3 md:p-6 max-w-7xl mx-auto space-y-4 md:space-y-6 min-h-screen text-slate-900 dark:text-slate-100">
      {/* Заголовок */}
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-950/50 rounded-xl flex items-center justify-center border border-indigo-500/20">
            <Network className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Интерактивная карта знаний</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Граф понятий лекций и междисциплинарных связей в стиле Obsidian</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-40">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : materials.length === 0 ? (
        <div className="p-12 text-center max-w-md mx-auto space-y-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
          <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-950/40 rounded-full flex items-center justify-center mx-auto border border-indigo-100 dark:border-indigo-900/50">
            <BookOpen className="w-8 h-8 text-indigo-500" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-slate-100">Библиотека пуста</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Загрузите конспекты лекций в разделе «Анализ материалов», чтобы AI извлёк термины и построил карту знаний.
          </p>
          <button
            onClick={() => navigate('/analyze')}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition shadow-lg shadow-indigo-500/10 dark:shadow-none"
          >
            Загрузить материалы
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 md:gap-6">
          
          {/* График и интерактивная область (3 колонки) */}
          <div className="lg:col-span-3 flex flex-col space-y-4">
            
            {/* Панель управления картой */}
            <div className="p-4 flex flex-wrap gap-4 items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
              <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400 font-semibold">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#ef4444] inline-block shadow-[0_0_8px_rgba(239,68,68,0.5)]" /> 
                  Слабое место (ошибка)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#22c55e] inline-block shadow-[0_0_8px_rgba(34,197,94,0.5)]" /> 
                  Успешно пройдено
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#818cf8] inline-block shadow-[0_0_8px_rgba(129,140,248,0.5)]" /> 
                  Изучено
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={zoomOut}
                  className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition border border-slate-300 dark:border-slate-750"
                  title="Отдалить"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="text-[11px] font-black text-slate-700 dark:text-slate-300 w-12 text-center">
                  {Math.round(scale * 100)}%
                </span>
                <button
                  onClick={zoomIn}
                  className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition border border-slate-300 dark:border-slate-750"
                  title="Приблизить"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={resetZoom}
                  className="ml-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-xl text-xs font-bold text-white transition shadow-lg shadow-indigo-600/10 dark:shadow-none"
                >
                  Сбросить
                </button>
              </div>
            </div>

            <div className="relative bg-white dark:bg-slate-900 rounded-3xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm select-none min-h-[60vh] md:min-h-[550px]">
              
              <svg
                ref={svgRef}
                viewBox="0 0 1600 1000"
                preserveAspectRatio="xMidYMid meet"
                className="w-full h-[60vh] md:h-[550px] cursor-grab active:cursor-grabbing touch-none"
                onMouseDown={(e) => handleMouseDown(e)}
                onMouseMove={handleMouseMove}
                onMouseUp={(e) => handleMouseUp(e)}
                onMouseLeave={(e) => handleMouseUp(e)}
                onTouchStart={(e) => handleTouchStart(e)}
                onTouchMove={handleTouchMove}
                onTouchEnd={(e) => handleTouchEnd(e)}
                onTouchCancel={(e) => handleTouchEnd(e)}
                onDoubleClick={resetZoom}
              >
                <defs>
                  <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
                    <circle cx="1" cy="1" r="1" fill={isDark ? '#475569' : '#cbd5e1'} />
                  </pattern>
                  <filter id="glow-purple" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                  <filter id="glow-rose" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                  <filter id="glow-emerald" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                <g transform={`translate(${panX}, ${panY}) scale(${scale})`}>
                  
                  {/* Фоновая сетка внутри SVG */}
                  <rect x="-4000" y="-4000" width="8000" height="8000" fill="url(#grid)" className="opacity-40 dark:opacity-20" />
                  
                  {/* Рендеринг связей (линии) */}
                  {links.map((link, idx) => {
                    const sourceNode = nodes.find(n => n.id === link.source);
                    const targetNode = nodes.find(n => n.id === link.target);
                    if (!sourceNode || !targetNode) return null;

                    const isHighlight = selectedNode?.id === sourceNode.id || selectedNode?.id === targetNode.id;

                    const activeSearch = searchQuery.trim().toLowerCase();
                    let searchOpacity = 1;
                    if (activeSearch) {
                      const sourceMatch = sourceNode.label.toLowerCase().includes(activeSearch);
                      const targetMatch = targetNode.label.toLowerCase().includes(activeSearch);
                      searchOpacity = (sourceMatch || targetMatch) ? 0.8 : 0.08;
                    }

                    return (
                      <line
                        key={`link-${idx}`}
                        x1={sourceNode.x}
                        y1={sourceNode.y}
                        x2={targetNode.x}
                        y2={targetNode.y}
                        stroke={isHighlight ? '#6366f1' : isDark ? '#334155' : '#cbd5e1'}
                        strokeOpacity={(isHighlight ? 0.9 : 0.4) * searchOpacity}
                        strokeWidth={isHighlight ? 2 : 1}
                        strokeDasharray={targetNode.type === 'concept' ? '3,3' : undefined}
                        className="transition-all duration-300"
                      />
                    );
                  })}

                  {/* Рендеринг узлов (круги) */}
                  {nodes.map((node) => {
                    const isSelected = selectedNode?.id === node.id;
                    const isLinkedToSelected = selectedNode && links.some(l => 
                       (l.source === selectedNode.id && l.target === node.id) || 
                       (l.target === selectedNode.id && l.source === node.id)
                    );
                    const isHighlightNode = !selectedNode || isSelected || isLinkedToSelected;

                    const isMaterial = node.type === 'material';
                    
                    const activeSearch = searchQuery.trim().toLowerCase();
                    const isSearchResult = activeSearch && node.label.toLowerCase().includes(activeSearch);
                    
                    // Учитываем поиск и выделение
                    let searchOpacity = 1;
                    if (activeSearch && !isSearchResult) searchOpacity = 0.15;
                    else if (selectedNode && !isHighlightNode) searchOpacity = 0.15;

                    const isLabelBelow = isMaterial || (node.label.charCodeAt(0) % 2 === 0);
                    const labelY = isLabelBelow ? (node.radius + 22) : (-node.radius - 14);

                    // Выбираем glow-фильтр в зависимости от статуса и типа
                    let filterUrl = '';
                    if (isMaterial) {
                      filterUrl = 'url(#glow-purple)';
                    } else if (node.status === 'weak') {
                      filterUrl = 'url(#glow-rose)';
                    } else if (node.status === 'strong') {
                      filterUrl = 'url(#glow-emerald)';
                    }

                    return (
                      <g
                        key={node.id}
                        transform={`translate(${node.x}, ${node.y})`}
                        className="cursor-pointer group transition-opacity duration-300"
                        onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, node); }}
                        onMouseUp={(e) => { e.stopPropagation(); handleMouseUp(e, node); }}
                        onTouchStart={(e) => { e.stopPropagation(); handleTouchStart(e, node); }}
                        onTouchEnd={(e) => { e.stopPropagation(); handleTouchEnd(e, node); }}
                        style={{ opacity: searchOpacity }}
                      >
                        {/* Дополнительный вращающийся неоновый ободок для найденного по поиску узла */}
                        {isSearchResult && (
                          <circle
                            r={node.radius + 8}
                            fill="none"
                            stroke="#fb923c"
                            strokeWidth={1.5}
                            strokeDasharray="4,2"
                            className="animate-spin"
                            style={{ transformOrigin: '0 0', animationDuration: '8s' }}
                          />
                        )}

                        {/* Свечение / Аура Obsidian */}
                        {filterUrl && (
                          <circle
                            r={node.radius}
                            fill={isMaterial ? '#7c3aed' : node.color}
                            filter={filterUrl}
                            opacity={isSelected ? 0.6 : 0.3}
                            className="transition-all duration-300 group-hover:opacity-65"
                          />
                        )}

                        {/* Внутреннее тело узла */}
                        <circle
                          r={node.radius}
                          fill={isMaterial ? (isDark ? '#1e293b' : '#ffffff') : node.color}
                          stroke={isMaterial ? '#6366f1' : (isDark ? '#0f172a' : '#ffffff')}
                          strokeWidth={isMaterial ? 3.5 : 1.5}
                          className="transition-all duration-200 group-hover:scale-105"
                          style={{
                            filter: isSelected ? 'brightness(1.2) contrast(1.1)' : 'none'
                          }}
                        />

                        {/* Иконка внутри узла лекции */}
                        {isMaterial && (
                          <path
                            d="M -5,-6 L 1,-6 L 5,-2 L 5,6 L -5,6 Z M 1,-6 L 1,-2 L 5,-2"
                            fill="none"
                            stroke="#a78bfa"
                            strokeWidth={1.5}
                            transform="scale(0.8)"
                          />
                        )}

                        {/* Подпись узла с тенью для высокой читаемости на темном фоне */}
                        <text
                          y={labelY}
                          textAnchor="middle"
                          fill={isDark 
                            ? (isSelected ? '#f8fafc' : isMaterial ? '#e2e8f0' : '#94a3b8') 
                            : (isSelected ? '#1e293b' : isMaterial ? '#334155' : '#64748b')}
                          className="text-[10px] font-bold select-none pointer-events-none transition-colors"
                          style={{
                            textShadow: isDark 
                              ? '0px 1px 2px #0f172a, 0px 0px 4px #0f172a' 
                              : '0px 1px 2px #ffffff, 0px 0px 4px #ffffff'
                          }}
                        >
                          {node.label.length > 20 ? `${node.label.slice(0, 18)}...` : node.label}
                        </text>
                      </g>
                    );
                  })}
                </g>
              </svg>

              {/* Хинт по использованию */}
              <div className="absolute bottom-4 left-4 z-10 group">
                <div className="md:hidden w-10 h-10 bg-white/90 dark:bg-slate-900/90 backdrop-blur border border-slate-200 dark:border-slate-800 rounded-full flex items-center justify-center text-slate-500 dark:text-slate-400 shadow-sm cursor-pointer">
                  <Info className="w-5 h-5 text-indigo-400" />
                </div>
                <div className="hidden group-hover:block md:block absolute md:static bottom-full left-0 mb-2 md:mb-0 p-3.5 bg-white/90 dark:bg-slate-900/90 backdrop-blur border border-slate-200 dark:border-slate-800 rounded-xl text-[10px] text-slate-500 dark:text-slate-400 w-48 md:w-auto md:max-w-xs space-y-1.5 shadow-xl md:shadow-none pointer-events-none">
                  <p className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                    <Info className="hidden md:block w-3.5 h-3.5 text-indigo-400" /> Навигация по графу
                  </p>
                  <div className="hidden md:block space-y-1.5">
                    <p>• Колесико мыши: Масштаб</p>
                    <p>• Перетаскивание: Перемещение</p>
                    <p>• Клик по узлу: Информация</p>
                    <p>• Двойной клик: Сброс зума</p>
                  </div>
                  <div className="md:hidden space-y-1.5">
                    <p>• Щипок (2 пальца): Масштаб</p>
                    <p>• Свайп: Перемещение</p>
                    <p>• Нажатие: Информация</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Информационная боковая панель (1 колонка) */}
          <div className="lg:col-span-1 space-y-6">
            
            {/* Поиск по карте */}
            <div className="p-4 space-y-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">Поиск по карте</h3>
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Найти понятие или лекцию..."
                  className="w-full pl-8 pr-8 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs outline-none text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-semibold"
                />
                <span className="absolute left-2.5 top-2.5 text-[10px] text-slate-500">🔍</span>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-2 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-250 text-sm font-bold"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            {/* Статистика карты */}
            <div className="p-5 space-y-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm border-b border-slate-200 dark:border-slate-800 pb-2">Статистика знаний</h3>
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="bg-slate-50 dark:bg-slate-850 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800">
                  <p className="text-lg font-black text-slate-900 dark:text-slate-200">{graphStats.materialsCount}</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Лекций</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-850 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800">
                  <p className="text-lg font-black text-slate-900 dark:text-slate-200">{graphStats.conceptCount}</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Понятий</p>
                </div>
                {graphStats.weakCount > 0 ? (
                  <div className="bg-red-950/20 p-2.5 rounded-xl border border-red-500/20 col-span-2">
                    <p className="text-lg font-black text-red-400">{graphStats.weakCount}</p>
                    <p className="text-[10px] text-red-300">Слабых тем (требуют повторения)</p>
                  </div>
                ) : (
                  <div className="bg-emerald-950/20 p-2.5 rounded-xl border border-emerald-500/20 col-span-2">
                    <p className="text-sm font-bold text-emerald-400">Все понятия усвоены! 🎉</p>
                  </div>
                )}
              </div>
            </div>

            {/* Карточка деталей выбранного узла */}
            <AnimatePresence mode="wait">
              {selectedNode ? (
                <motion.div
                  key={selectedNode.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 border-l-4 rounded-2xl space-y-4 shadow-sm"
                  style={{ borderLeftColor: selectedNode.color }}
                >
                  {selectedNode.type === 'material' ? (
                    // ДЕТАЛИ ЛЕКЦИИ
                    <>
                      <div>
                        <span className="text-[9px] uppercase font-black px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                          Лекция
                        </span>
                        <h4 className="font-bold text-slate-900 dark:text-slate-100 mt-2 leading-snug line-clamp-3 break-words">{selectedNode.label}</h4>
                        {selectedNode.details?.subject && (
                          <span className="text-xs text-indigo-400 font-semibold mt-1 block">
                            Предмет: {selectedNode.details.subject}
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
                        <p>Добавлена: {new Date(selectedNode.details?.created_at).toLocaleDateString('ru-RU')}</p>
                      </div>

                      <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                        <button
                          onClick={() => navigate(`/library/${selectedNode.id}`)}
                          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/10 dark:shadow-none"
                        >
                          <BookOpen className="w-3.5 h-3.5" /> Изучать лекцию
                        </button>
                        <button
                          onClick={() => navigate('/exam')}
                          className="w-full py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold rounded-xl text-xs transition border border-slate-300 dark:border-slate-700 flex items-center justify-center gap-1.5"
                        >
                          <Zap className="w-3.5 h-3.5 text-amber-400" /> Проверить знания
                        </button>
                      </div>
                    </>
                  ) : (
                    // ДЕТАЛИ КОНЦЕПТА
                    <>
                      <div>
                        <div className="flex justify-between items-center">
                          <span className="text-[9px] uppercase font-black px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                            Понятие
                          </span>
                          {selectedNode.status === 'weak' ? (
                            <span className="flex items-center gap-1 text-[10px] text-red-400 font-bold">
                              <AlertCircle className="w-3 h-3 animate-pulse" /> Ошибка
                            </span>
                          ) : selectedNode.status === 'strong' ? (
                            <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-bold">
                              <CheckCircle2 className="w-3 h-3" /> Усвоено
                            </span>
                          ) : null}
                        </div>
                        <h4 className="font-bold text-slate-900 dark:text-slate-100 mt-2 leading-snug line-clamp-3 break-words">{selectedNode.label}</h4>
                      </div>

                      {selectedNode.definition && (
                        <div className="p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1.5">
                          <span className="text-[9px] uppercase font-black tracking-widest text-slate-500 dark:text-slate-400 block">Определение</span>
                          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{selectedNode.definition}</p>
                        </div>
                      )}

                      {selectedNode.materials && selectedNode.materials.length > 0 && (
                        <div className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-3">
                          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block">Встречается в лекциях:</span>
                          <div className="space-y-1.5">
                            {selectedNode.materials.map(m => (
                              <button
                                key={m.id}
                                onClick={() => navigate(`/library/${m.id}`)}
                                className="w-full text-left p-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 flex justify-between items-center transition border border-slate-200 dark:border-slate-800"
                              >
                                <span className="truncate pr-2">{m.title}</span>
                                <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {selectedNode.status === 'weak' && (
                        <button
                          onClick={() => navigate('/mistakes')}
                          className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs transition flex items-center justify-center gap-1.5 shadow-lg shadow-red-600/15 dark:shadow-none"
                        >
                          <Zap className="w-3.5 h-3.5" /> Исправить в практике
                        </button>
                      )}
                    </>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="p-6 text-center text-slate-400 italic text-xs space-y-2 py-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm"
                >
                  <HelpCircle className="w-6 h-6 mx-auto text-slate-500 dark:text-slate-400" />
                  <p className="text-slate-500 dark:text-slate-400">Нажмите на любой элемент графа, чтобы просмотреть его описание, связи и статус освоения.</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
