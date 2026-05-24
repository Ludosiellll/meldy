import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Network, BookOpen, AlertCircle, CheckCircle2,
  Plus, Minus, Maximize2, ChevronRight, Zap, Info, HelpCircle
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';

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

// Простые цвета для предметов
const SUBJECT_COLORS = [
  '#4F46E5', '#06B6D4', '#10B981', '#F59E0B', 
  '#EF4444', '#EC4899', '#8B5CF6', '#14B8A6'
];

export default function KnowledgeMap() {
  const { user } = useAuth();
  const navigate = useNavigate();

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
  
  // Перетаскивание
  const draggingNodeId = useRef<string | null>(null);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const panStartPos = useRef({ x: 0, y: 0 });

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

  // Парсер терминов из секции "📚 Термины и определения" конспекта
  const extractTerms = (summaryJson: any) => {
    const content = summaryJson?.content || summaryJson?.raw || '';
    if (!content) return [];

    const sections = content.split(/(?=^## )/gm);
    const termsSection = sections.find((s: string) => 
      s.includes('Термины') || s.includes('Терминология') || s.includes('📚')
    );
    if (!termsSection) return [];

    const terms: { term: string; definition: string }[] = [];
    const lineRegex = /(?:\d+\.|\*|-)\s+\*\*([^*]+)\*\*\s*(?:—|-|–)\s*(.+)/g;
    let match;
    while ((match = lineRegex.exec(termsSection)) !== null) {
      terms.push({
        term: match[1].trim(),
        definition: match[2].trim()
      });
    }
    return terms;
  };

  // 2. Генерация графа
  useEffect(() => {
    if (loading || materials.length === 0) return;

    const width = 800;
    const height = 550;

    const tempNodes: GraphNode[] = [];
    const tempLinks: GraphLink[] = [];

    // Карта для объединения одинаковых терминов
    const conceptMap: Record<string, {
      term: string;
      definition: string;
      materials: { id: string; title: string }[];
      status: 'weak' | 'strong' | 'neutral';
    }> = {};

    // Предметные цвета лекций
    const subjectColorMap: Record<string, string> = {};
    let colorIdx = 0;

    // Сначала создаем узлы материалов (лекций)
    materials.forEach((mat, idx) => {
      const angle = (idx / materials.length) * Math.PI * 2;
      const radiusDist = 220;
      
      const subject = mat.subject || 'Общее';
      if (!subjectColorMap[subject]) {
        subjectColorMap[subject] = SUBJECT_COLORS[colorIdx % SUBJECT_COLORS.length];
        colorIdx++;
      }

      tempNodes.push({
        id: mat.id,
        label: mat.title,
        type: 'material',
        x: width / 2 + Math.cos(angle) * radiusDist + (Math.random() - 0.5) * 10,
        y: height / 2 + Math.sin(angle) * radiusDist + (Math.random() - 0.5) * 10,
        vx: 0,
        vy: 0,
        radius: 20,
        status: 'neutral',
        color: subjectColorMap[subject],
        details: mat
      });

      // Извлекаем термины
      const terms = extractTerms(mat.summary_json);
      terms.forEach(t => {
        const key = t.term.toLowerCase();
        
        // Проверяем наличие ошибок по этому термину
        // Сверяем с Дневником ошибок
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
          conceptMap[key].materials.push({ id: mat.id, title: mat.title });
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

    // Добавляем узлы концептов на граф
    Object.entries(conceptMap).forEach(([key, value], idx) => {
      // Размещаем концепты вокруг центра
      const count = Object.keys(conceptMap).length;
      const angle = (idx / count) * Math.PI * 2;
      const dist = 80 + Math.random() * 50;

      tempNodes.push({
        id: key,
        label: value.term,
        type: 'concept',
        x: width / 2 + Math.cos(angle) * dist,
        y: height / 2 + Math.sin(angle) * dist,
        vx: 0,
        vy: 0,
        radius: 12,
        status: value.status,
        color: value.status === 'weak' ? '#EF4444' : value.status === 'strong' ? '#10B981' : '#6366F1',
        definition: value.definition,
        materials: value.materials
      });

      // Создаем связи между лекцией и концептом
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

  // 3. Симуляция физики (Force-directed layout)
  useEffect(() => {
    if (nodes.length === 0) return;

    const width = 800;
    const height = 550;

    const tick = () => {
      const currentNodes = [...nodesRef.current];
      const currentLinks = linksRef.current;

      // 1. Сила отталкивания (Repulsion / Charge)
      for (let i = 0; i < currentNodes.length; i++) {
        const nodeA = currentNodes[i];
        for (let j = i + 1; j < currentNodes.length; j++) {
          const nodeB = currentNodes[j];
          const dx = nodeB.x - nodeA.x;
          const dy = nodeB.y - nodeA.y;
          const distSq = dx * dx + dy * dy + 0.1;
          const dist = Math.sqrt(distSq);
          
          // Минимальное комфортное расстояние
          const minDist = nodeA.type === 'material' && nodeB.type === 'material' 
            ? 280 
            : (nodeA.type === 'material' || nodeB.type === 'material' ? 180 : 130);

          if (dist < minDist) {
            const force = (minDist - dist) * 0.28; // Более сильное отталкивание
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

      // 2. Сила притяжения связей (Link Force)
      for (const link of currentLinks) {
        const source = currentNodes.find(n => n.id === link.source);
        const target = currentNodes.find(n => n.id === link.target);
        if (source && target) {
          const dx = target.x - source.x;
          const dy = target.y - source.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
          
          const desiredDist = source.type === 'material' && target.type === 'material' ? 260 : 130;
          const force = (dist - desiredDist) * 0.03; // Мягче притягивание
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

      // 3. Сила гравитации к центру и обновление координат
      const centerX = width / 2;
      const centerY = height / 2;
      
      currentNodes.forEach(node => {
        if (node.fx !== undefined && node.fx !== null && node.fy !== undefined && node.fy !== null) {
          node.x = node.fx;
          node.y = node.fy;
          node.vx = 0;
          node.vy = 0;
        } else {
          // Сила тяжести к центру экрана (меньше, чтобы дать разойтись)
          node.vx += (centerX - node.x) * 0.0015;
          node.vy += (centerY - node.y) * 0.0015;

          // Трение
          node.vx *= 0.82;
          node.vy *= 0.82;

          node.x += node.vx;
          node.y += node.vy;

          // Ограничиваем границы
          node.x = Math.max(40, Math.min(width - 40, node.x));
          node.y = Math.max(40, Math.min(height - 40, node.y));
        }
      });

      // Перезаписываем стейт для рендера
      setNodes([...currentNodes]);
      requestRef.current = requestAnimationFrame(tick);
    };

    requestRef.current = requestAnimationFrame(tick);

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [loading]);

  // 3.5. Зумирование колесиком мыши (smooth scroll zoom)
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

  // 4. События мыши (Drag & Drop и Pan)
  const handleMouseDown = (e: React.MouseEvent, node?: GraphNode) => {
    e.preventDefault();
    if (!svgRef.current) return;

    if (node) {
      // Клик по узлу — запускаем Drag
      draggingNodeId.current = node.id;
      const rect = svgRef.current.getBoundingClientRect();
      
      // Преобразуем координаты мыши с учётом zoom/pan
      const clickX = (e.clientX - rect.left - panX) / scale;
      const clickY = (e.clientY - rect.top - panY) / scale;
      
      dragStartPos.current = { x: clickX, y: clickY };
      
      // Закрепляем узел в точке
      const matchedNode = nodesRef.current.find(n => n.id === node.id);
      if (matchedNode) {
        matchedNode.fx = matchedNode.x;
        matchedNode.fy = matchedNode.y;
      }
    } else {
      // Клик по фону — запускаем Pan
      isPanning.current = true;
      panStartPos.current = { x: e.clientX - panX, y: e.clientY - panY };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!svgRef.current) return;

    if (draggingNodeId.current) {
      const rect = svgRef.current.getBoundingClientRect();
      const clickX = (e.clientX - rect.left - panX) / scale;
      const clickY = (e.clientY - rect.top - panY) / scale;

      const matchedNode = nodesRef.current.find(n => n.id === draggingNodeId.current);
      if (matchedNode) {
        matchedNode.fx = clickX;
        matchedNode.fy = clickY;
      }
    } else if (isPanning.current) {
      setPanX(e.clientX - panStartPos.current.x);
      setPanY(e.clientY - panStartPos.current.y);
    }
  };

  const handleMouseUp = (e: React.MouseEvent, node?: GraphNode) => {
    if (draggingNodeId.current) {
      const matchedNode = nodesRef.current.find(n => n.id === draggingNodeId.current);
      if (matchedNode) {
        // Отпускаем узел (снимаем фиксацию fx/fy)
        matchedNode.fx = null;
        matchedNode.fy = null;
      }
      
      // Если узел почти не переместился, считаем это кликом выбора
      if (node) {
        setSelectedNode(node);
      }
      draggingNodeId.current = null;
    }
    isPanning.current = false;
  };

  // Зумирование кнопками
  const zoomIn = () => setScale(s => Math.min(2.5, s + 0.15));
  const zoomOut = () => setScale(s => Math.max(0.4, s - 0.15));
  const resetZoom = () => {
    setScale(1);
    setPanX(0);
    setPanY(0);
  };

  // Метрики
  const graphStats = useMemo(() => {
    const conceptCount = nodes.filter(n => n.type === 'concept').length;
    const materialsCount = nodes.filter(n => n.type === 'material').length;
    const weakCount = nodes.filter(n => n.type === 'concept' && n.status === 'weak').length;
    const strongCount = nodes.filter(n => n.type === 'concept' && n.status === 'strong').length;
    return { conceptCount, materialsCount, weakCount, strongCount };
  }, [nodes]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Заголовок */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
          <Network className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Интерактивная карта знаний</h1>
          <p className="text-xs text-slate-500">Визуализация понятий лекций и междисциплинарных связей</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-40">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : materials.length === 0 ? (
        <div className="card p-12 text-center max-w-md mx-auto space-y-4">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto">
            <BookOpen className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="font-bold text-slate-700">Библиотека пуста</h3>
          <p className="text-sm text-slate-400">
            Загрузите конспекты лекций в разделе «Анализ материалов», чтобы AI извлёк термины и построил карту знаний.
          </p>
          <button
            onClick={() => navigate('/analyze')}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition"
          >
            Загрузить материалы
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          
          {/* График и интерактивная область (3 колонки) */}
          <div className="lg:col-span-3 flex flex-col space-y-4">
            
            {/* Панель управления картой (Светлая тема с темным текстом для читаемости) */}
            <div className="card p-3.5 flex flex-wrap gap-4 items-center justify-between bg-white border-slate-200 shadow-sm">
              <div className="flex items-center gap-4 text-xs text-slate-600 font-bold">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block shadow-sm" /> 
                  Слабое место (ошибка)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block shadow-sm" /> 
                  Успешно пройдено
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block shadow-sm" /> 
                  Изучено
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={zoomOut}
                  className="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-600 hover:text-slate-900 transition border border-slate-200"
                  title="Отдалить"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="text-[11px] font-black text-slate-700 w-12 text-center">
                  {Math.round(scale * 100)}%
                </span>
                <button
                  onClick={zoomIn}
                  className="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-600 hover:text-slate-900 transition border border-slate-200"
                  title="Приблизить"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={resetZoom}
                  className="ml-2 px-3 py-2 bg-slate-900 hover:bg-slate-800 rounded-xl text-xs font-black text-white hover:text-white transition shadow-sm"
                >
                  Сбросить
                </button>
              </div>
            </div>

            {/* Контейнер SVG */}
            <div className="relative bg-slate-950 rounded-3xl overflow-hidden border border-slate-800 shadow-xl select-none min-h-[550px]">
              
              {/* Фоновая сетка */}
              <div 
                className="absolute inset-0 opacity-[0.03] pointer-events-none"
                style={{
                  backgroundImage: `radial-gradient(circle, white 1px, transparent 1px)`,
                  backgroundSize: '24px 24px',
                  transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
                  transformOrigin: 'top left'
                }}
              />

              <svg
                ref={svgRef}
                className="w-full h-[550px] cursor-grab active:cursor-grabbing"
                onMouseDown={(e) => handleMouseDown(e)}
                onMouseMove={handleMouseMove}
                onMouseUp={(e) => handleMouseUp(e)}
                onMouseLeave={(e) => handleMouseUp(e)}
                onDoubleClick={resetZoom}
              >
                <g transform={`translate(${panX}, ${panY}) scale(${scale})`}>
                  
                  {/* Рендеринг связей (линии) */}
                  {links.map((link, idx) => {
                    const sourceNode = nodes.find(n => n.id === link.source);
                    const targetNode = nodes.find(n => n.id === link.target);
                    if (!sourceNode || !targetNode) return null;

                    const isHighlight = selectedNode?.id === sourceNode.id || selectedNode?.id === targetNode.id;

                    // Определение видимости при поиске
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
                        stroke={isHighlight ? '#818CF8' : '#312E81'}
                        strokeOpacity={(isHighlight ? 0.95 : 0.45) * searchOpacity}
                        strokeWidth={isHighlight ? 2.5 : 1.5}
                        strokeDasharray={targetNode.type === 'concept' ? '4,4' : undefined}
                        className="transition-all duration-300"
                      />
                    );
                  })}

                  {/* Рендеринг узлов (круги) */}
                  {nodes.map((node) => {
                    const isSelected = selectedNode?.id === node.id;
                    const isMaterial = node.type === 'material';
                    
                    // Определение видимости при поиске
                    const activeSearch = searchQuery.trim().toLowerCase();
                    const isSearchResult = activeSearch && node.label.toLowerCase().includes(activeSearch);
                    const searchOpacity = !activeSearch || isSearchResult ? 1 : 0.15;

                    // Чередование подписей (сверху / снизу) для уменьшения наложений
                    const isLabelBelow = isMaterial || (node.label.charCodeAt(0) % 2 === 0);
                    const labelY = isLabelBelow ? (node.radius + 15) : (-node.radius - 8);

                    return (
                      <g
                        key={node.id}
                        transform={`translate(${node.x}, ${node.y})`}
                        className="cursor-pointer group"
                        onMouseDown={(e) => handleMouseDown(e, node)}
                        onMouseUp={(e) => handleMouseUp(e, node)}
                        style={{ opacity: searchOpacity }}
                      >
                        {/* Дополнительный вращающийся неоновый ободок для найденного по поиску узла */}
                        {isSearchResult && (
                          <circle
                            r={node.radius + 8}
                            fill="none"
                            stroke="#F59E0B"
                            strokeWidth={2}
                            strokeDasharray="5,3"
                            className="animate-spin"
                            style={{ transformOrigin: '0 0', animationDuration: '6s' }}
                          />
                        )}

                        {/* Мягкое свечение (аура) для лекций */}
                        {isMaterial && (
                          <circle
                            r={node.radius + 12}
                            fill={node.color}
                            opacity={isSelected ? 0.25 : 0.08}
                            className="transition-all duration-300 group-hover:opacity-20"
                          />
                        )}

                        {/* Эффект свечения для концептов с ошибками или выбранных */}
                        {(!isMaterial && (node.status === 'weak' || isSelected)) && (
                          <circle
                            r={node.radius + 8}
                            fill={node.color}
                            opacity={isSelected ? 0.3 : 0.15}
                            className={node.status === 'weak' ? 'animate-pulse' : ''}
                          />
                        )}

                        {/* Внешний круг (граница) */}
                        <circle
                          r={node.radius}
                          fill={isMaterial ? '#0F172A' : node.color}
                          stroke={isMaterial ? node.color : '#0F172A'}
                          strokeWidth={isMaterial ? 4 : 2}
                          className="transition-all duration-200 group-hover:scale-110 shadow-lg"
                        />

                        {/* Иконка внутри узла лекции */}
                        {isMaterial && (
                          <path
                            d="M -5,-6 L 1,-6 L 5,-2 L 5,6 L -5,6 Z M 1,-6 L 1,-2 L 5,-2"
                            fill="none"
                            stroke="white"
                            strokeWidth={1.5}
                            transform="scale(0.8)"
                          />
                        )}

                        {/* Подпись узла с аурой/обводкой для 100% читаемости на тёмном фоне */}
                        {/* 1. Обводка текста */}
                        <text
                          y={labelY}
                          textAnchor="middle"
                          stroke="#020617"
                          strokeWidth="3.5"
                          strokeLinejoin="round"
                          className="text-[10px] font-bold select-none pointer-events-none opacity-90"
                        >
                          {node.label.length > 22 ? `${node.label.slice(0, 20)}...` : node.label}
                        </text>
                        {/* 2. Основной text */}
                        <text
                          y={labelY}
                          textAnchor="middle"
                          fill={isSelected ? '#FFFFFF' : isMaterial ? '#F1F5F9' : '#94A3B8'}
                          className="text-[10px] font-bold select-none pointer-events-none transition-colors"
                        >
                          {node.label.length > 22 ? `${node.label.slice(0, 20)}...` : node.label}
                        </text>
                      </g>
                    );
                  })}
                </g>
              </svg>

              {/* Хинт по использованию */}
              <div className="absolute bottom-4 left-4 p-3 bg-slate-900/90 backdrop-blur border border-slate-800 rounded-xl text-[10px] text-slate-400 max-w-xs space-y-1.5 pointer-events-none">
                <p className="font-bold text-slate-200 flex items-center gap-1">
                  <Info className="w-3 h-3 text-indigo-400" /> Подсказка по навигации
                </p>
                <p>• Прокрутка мыши: Увеличение / Уменьшение масштаба.</p>
                <p>• Зажмите левую кнопку на пустом месте для перемещения.</p>
                <p>• Двойной клик на фоне сбросит масштаб и центрирует граф.</p>
              </div>
            </div>
          </div>

          {/* Информационная боковая панель (1 колонка) */}
          <div className="lg:col-span-1 space-y-6">
            
            {/* Поиск по карте */}
            <div className="card p-4 space-y-3">
              <h3 className="font-bold text-slate-900 text-sm">Поиск по карте</h3>
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Введите термин или лекцию..."
                  className="w-full pl-8 pr-8 py-2.5 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 font-semibold"
                />
                <span className="absolute left-2.5 top-2.5 text-[10px]">🔍</span>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 text-sm font-bold"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            {/* Статистика карты */}
            <div className="card p-5 space-y-4">
              <h3 className="font-bold text-slate-900 text-sm border-b border-slate-100 pb-2">Статистика знаний</h3>
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                  <p className="text-lg font-black text-slate-800">{graphStats.materialsCount}</p>
                  <p className="text-[10px] text-slate-400">Лекций</p>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                  <p className="text-lg font-black text-slate-800">{graphStats.conceptCount}</p>
                  <p className="text-[10px] text-slate-400">Понятий</p>
                </div>
                <div className="bg-rose-50 p-2.5 rounded-xl border border-rose-100 col-span-2">
                  <p className="text-lg font-black text-rose-600">{graphStats.weakCount}</p>
                  <p className="text-[10px] text-slate-500">Слабых тем (требуют повторения)</p>
                </div>
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
                  className="card p-5 border-l-4 space-y-4"
                  style={{ borderLeftColor: selectedNode.color }}
                >
                  {selectedNode.type === 'material' ? (
                    // ДЕТАЛИ ЛЕКЦИИ
                    <>
                      <div>
                        <span className="text-[9px] uppercase font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                          Лекция
                        </span>
                        <h4 className="font-bold text-slate-900 mt-2 leading-snug">{selectedNode.label}</h4>
                        {selectedNode.details?.subject && (
                          <span className="text-xs text-indigo-600 font-semibold mt-1 block">
                            Предмет: {selectedNode.details.subject}
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-slate-500 space-y-1">
                        <p>Добавлена: {new Date(selectedNode.details?.created_at).toLocaleDateString('ru-RU')}</p>
                      </div>

                      <div className="space-y-2 pt-2">
                        <button
                          onClick={() => navigate(`/library/${selectedNode.id}`)}
                          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition flex items-center justify-center gap-1.5"
                        >
                          <BookOpen className="w-3.5 h-3.5" /> Изучать лекцию
                        </button>
                        <button
                          onClick={() => navigate('/exam')}
                          className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition flex items-center justify-center gap-1.5"
                        >
                          <Zap className="w-3.5 h-3.5 text-amber-500" /> Проверить знания
                        </button>
                      </div>
                    </>
                  ) : (
                    // ДЕТАЛИ КОНЦЕПТА
                    <>
                      <div>
                        <div className="flex justify-between items-center">
                          <span className="text-[9px] uppercase font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                            Понятие
                          </span>
                          {selectedNode.status === 'weak' ? (
                            <span className="flex items-center gap-1 text-[10px] text-rose-500 font-bold">
                              <AlertCircle className="w-3 h-3" /> Ошибка
                            </span>
                          ) : selectedNode.status === 'strong' ? (
                            <span className="flex items-center gap-1 text-[10px] text-emerald-500 font-bold">
                              <CheckCircle2 className="w-3 h-3" /> Усвоено
                            </span>
                          ) : null}
                        </div>
                        <h4 className="font-bold text-slate-900 mt-2 leading-snug">{selectedNode.label}</h4>
                      </div>

                      {selectedNode.definition && (
                        <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl space-y-1.5">
                          <span className="text-[9px] uppercase font-black tracking-widest text-slate-400 block">Определение</span>
                          <p className="text-xs text-slate-600 leading-relaxed">{selectedNode.definition}</p>
                        </div>
                      )}

                      {selectedNode.materials && selectedNode.materials.length > 0 && (
                        <div className="space-y-2">
                          <span className="text-[10px] font-bold text-slate-400 block">Встречается в лекциях:</span>
                          <div className="space-y-1.5">
                            {selectedNode.materials.map(m => (
                              <button
                                key={m.id}
                                onClick={() => navigate(`/library/${m.id}`)}
                                className="w-full text-left p-2 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-700 flex justify-between items-center transition border border-slate-100"
                              >
                                <span className="truncate pr-2">{m.title}</span>
                                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {selectedNode.status === 'weak' && (
                        <button
                          onClick={() => navigate('/mistakes')}
                          className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs transition flex items-center justify-center gap-1.5 shadow-lg shadow-rose-100"
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
                  className="card p-6 text-center text-slate-400 italic text-xs space-y-2 py-10"
                >
                  <HelpCircle className="w-6 h-6 mx-auto text-slate-300" />
                  <p>Нажмите на любой элемент графа, чтобы просмотреть его описание, связи и статус освоения.</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
