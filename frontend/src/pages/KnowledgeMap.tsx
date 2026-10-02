import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle, ArrowUpRight, BookOpen, Check, CheckCircle2, ChevronRight,
  FileText, Focus, Network, RotateCcw, Search, X, ZoomIn, ZoomOut
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { useTheme } from '../contexts/ThemeProvider';

type KnowledgeStatus = 'weak' | 'strong' | 'neutral';
type GraphFilter = 'all' | 'shared' | 'weak';
type ViewMode = 'map' | 'list';

interface MaterialRecord {
  id: string;
  title: string;
  subject?: string | null;
  created_at?: string | null;
  summary_json?: unknown;
  [key: string]: unknown;
}

interface GraphNode {
  id: string;
  label: string;
  type: 'material' | 'concept';
  x: number;
  y: number;
  radius: number;
  labelWidth: number;
  status: KnowledgeStatus;
  color: string;
  definition?: string;
  materials?: { id: string; title: string }[];
  details?: MaterialRecord;
}

interface GraphLink {
  source: string;
  target: string;
}

interface ParsedTerm {
  term: string;
  definition: string;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  viewBox: string;
}

const SUBJECT_COLORS = ['#607d75', '#8a6d52', '#5c7590', '#806b8a', '#8a6058', '#6f7e51'];
const STATUS_COLORS: Record<KnowledgeStatus, string> = {
  weak: '#b65342',
  strong: '#4f8065',
  neutral: '#557a96'
};

function normalizeTerm(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function extractTerms(rawSummary: unknown): ParsedTerm[] {
  let summary: any = rawSummary;
  if (typeof summary === 'string') {
    try { summary = JSON.parse(summary); } catch { /* older rows may store Markdown directly */ }
  }

  const structured = Array.isArray(summary?.terms) ? summary.terms : [];
  const terms: ParsedTerm[] = structured
    .filter((item: any) => item?.term && item?.definition)
    .map((item: any) => ({ term: String(item.term).trim(), definition: String(item.definition).trim() }));
  if (terms.length) return dedupeTerms(terms);

  const content = typeof summary === 'string' ? summary : summary?.content || summary?.raw || '';
  if (typeof content !== 'string' || !content.trim()) return [];

  const sections = content.split(/(?=^##\s)/gm);
  const termsSection = sections.find(section => /термин|терминология|глоссар/i.test(section));
  const headingPattern = /(?:^|\n)\s*(?:\d+\.|[-*])\s+\*\*([^*]+)\*\*\s*(?:—|–|-|:)\s*([^\n]+)/g;
  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(termsSection || '')) !== null) {
    terms.push({ term: match[1].trim(), definition: match[2].trim() });
  }

  if (!terms.length) {
    const inlinePattern = /\*\*([^*]+)\*\*\s*(?:—|–|-|:)\s*([^\n]+)/g;
    while ((match = inlinePattern.exec(content)) !== null) {
      const term = match[1].trim();
      const definition = match[2].trim();
      if (term.length <= 48 && definition.length > 5) terms.push({ term, definition });
    }
  }

  return dedupeTerms(terms);
}

function dedupeTerms(terms: ParsedTerm[]) {
  const seen = new Set<string>();
  return terms.filter(({ term, definition }) => {
    const key = normalizeTerm(term);
    if (!key || key.length < 2 || !definition || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1).trimEnd()}…` : value;
}

function titleLines(value: string): [string, string] {
  const words = value.trim().split(/\s+/);
  let first = '';
  let second = '';
  for (const word of words) {
    if (!first || `${first} ${word}`.length <= 19) first = `${first} ${word}`.trim();
    else if (!second || `${second} ${word}`.length <= 19) second = `${second} ${word}`.trim();
    else {
      second = truncate(`${second} ${word}`, 19);
      break;
    }
  }
  if (!second && value.length > first.length) second = truncate(value.slice(first.length).trim(), 19);
  return [first || 'Без названия', second];
}

function formatDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function pluralCount(value: number, forms: [string, string, string]) {
  const mod100 = Math.abs(value) % 100;
  const mod10 = mod100 % 10;
  const form = mod100 > 10 && mod100 < 20 ? forms[2] : mod10 === 1 ? forms[0] : mod10 >= 2 && mod10 <= 4 ? forms[1] : forms[2];
  return `${value} ${form}`;
}

function buildGraph(materials: MaterialRecord[], mistakes: any[]): GraphData {
  const center = { x: 820, y: 620 };
  const materialCount = materials.length;
  const groupedMaterials = [...materials].sort((a, b) =>
    String(a.subject || 'Общее').localeCompare(String(b.subject || 'Общее'), 'ru') ||
    String(a.title || '').localeCompare(String(b.title || ''), 'ru') ||
    String(a.id).localeCompare(String(b.id))
  );
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(materialCount * 1.7))));
  const rows = Math.ceil(materialCount / columns);
  const columnStep = 360;
  const rowStep = 310;
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const materialPositions = new Map<string, { x: number; y: number }>();
  const subjectColor = (subject: string) => SUBJECT_COLORS[hashString(subject) % SUBJECT_COLORS.length];

  groupedMaterials.forEach((material, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const itemsInRow = Math.min(columns, materialCount - row * columns);
    const x = center.x + (column - (itemsInRow - 1) / 2) * columnStep;
    const y = center.y + (row - (rows - 1) / 2) * rowStep;
    const subject = String(material.subject || 'Общее').trim() || 'Общее';
    materialPositions.set(material.id, { x, y });
    nodes.push({
      id: material.id,
      label: String(material.title || 'Без названия'),
      type: 'material',
      x,
      y,
      radius: 98,
      labelWidth: 190,
      status: 'neutral',
      color: subjectColor(subject),
      details: material
    });
  });

  const conceptMap = new Map<string, {
    term: string;
    definition: string;
    materials: { id: string; title: string }[];
    status: KnowledgeStatus;
  }>();

  for (const material of materials) {
    for (const parsed of extractTerms(material.summary_json)) {
      const key = normalizeTerm(parsed.term);
      if (!key) continue;
      const matchingMistakes = mistakes.filter((mistake: any) => {
        const topic = normalizeTerm(String(mistake.topic || ''));
        const question = normalizeTerm(String(mistake.question || ''));
        return topic.includes(key) || question.includes(key);
      });
      const status: KnowledgeStatus = matchingMistakes.some((mistake: any) => mistake.is_resolved !== true)
        ? 'weak'
        : matchingMistakes.length ? 'strong' : 'neutral';
      const existing = conceptMap.get(key);
      const materialRef = { id: material.id, title: String(material.title || 'Без названия') };
      if (existing) {
        if (!existing.materials.some(item => item.id === material.id)) existing.materials.push(materialRef);
        if (status === 'weak') existing.status = 'weak';
        else if (status === 'strong' && existing.status === 'neutral') existing.status = 'strong';
        if (parsed.definition.length > existing.definition.length) existing.definition = parsed.definition;
      } else {
        conceptMap.set(key, { term: parsed.term, definition: parsed.definition, materials: [materialRef], status });
      }
    }
  }

  const concepts = [...conceptMap.entries()].sort(([keyA], [keyB]) => keyA.localeCompare(keyB, 'ru'));
  const conceptsByMaterial = new Map<string, string[]>();
  for (const [key, value] of concepts) {
    for (const material of value.materials) {
      const list = conceptsByMaterial.get(material.id) || [];
      list.push(key);
      conceptsByMaterial.set(material.id, list);
    }
  }
  const sharedConcepts = concepts.filter(([, value]) => value.materials.length > 1);
  const sharedIndex = new Map(sharedConcepts.map(([key], index) => [key, index]));
  const conceptPositions = new Map<string, { x: number; y: number }>();

  for (const [key, value] of concepts) {
    const linkedPositions = value.materials
      .map(material => materialPositions.get(material.id))
      .filter((position): position is { x: number; y: number } => Boolean(position));
    if (!linkedPositions.length) continue;

    let x: number;
    let y: number;
    if (linkedPositions.length > 1) {
      const centroid = linkedPositions.reduce((sum, position) => ({ x: sum.x + position.x / linkedPositions.length, y: sum.y + position.y / linkedPositions.length }), { x: 0, y: 0 });
      const index = sharedIndex.get(key) || 0;
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / Math.max(1, sharedConcepts.length);
      const bridgeOffset = 62 + Math.floor(index / 10) * 34;
      x = centroid.x + Math.cos(angle) * bridgeOffset;
      y = centroid.y + Math.sin(angle) * bridgeOffset;
    } else {
      const materialId = value.materials[0].id;
      const position = linkedPositions[0];
      const siblings = conceptsByMaterial.get(materialId) || [key];
      const index = siblings.indexOf(key);
      const angle = -Math.PI / 2 + index * 2.399963229728653;
      const ring = 154 + Math.floor(index / 10) * 76;
      x = position.x + Math.cos(angle) * ring;
      y = position.y + Math.sin(angle) * ring;
    }
    conceptPositions.set(key, { x, y });
  }

  const conceptEntries = concepts.filter(([key]) => conceptPositions.has(key));
  // Keep topic labels legible without moving source materials: only concepts relax around their true links.
  for (let pass = 0; pass < 90; pass++) {
    let changed = false;
    for (let index = 0; index < conceptEntries.length; index++) {
      const [keyA, valueA] = conceptEntries[index];
      const a = conceptPositions.get(keyA)!;
      const halfA = Math.min(104, Math.max(28, valueA.term.length * 3.2));
      for (let other = index + 1; other < conceptEntries.length; other++) {
        const [keyB, valueB] = conceptEntries[other];
        const b = conceptPositions.get(keyB)!;
        const halfB = Math.min(104, Math.max(28, valueB.term.length * 3.2));
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minDistance = halfA + halfB + 28;
        const distance = Math.hypot(dx, dy) || 0.01;
        if (distance < minDistance) {
          const shift = Math.min(14, (minDistance - distance) * 0.28);
          const nx = (dx / distance) * shift;
          const ny = (dy / distance) * shift;
          a.x -= nx; a.y -= ny;
          b.x += nx; b.y += ny;
          changed = true;
        }
      }
      for (const material of nodes) {
        if (material.type !== 'material') continue;
        const dx = a.x - material.x;
        const dy = a.y - material.y;
        const distance = Math.hypot(dx, dy) || 0.01;
        const minDistance = material.radius + Math.max(46, halfA) + 14;
        if (distance < minDistance) {
          const shift = Math.min(18, (minDistance - distance) * 0.38);
          a.x += (dx / distance) * shift;
          a.y += (dy / distance) * shift;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  for (const [key, value] of concepts) {
    const position = conceptPositions.get(key);
    if (!position) continue;
    nodes.push({
      id: `concept:${key}`,
      label: value.term,
      type: 'concept',
      x: position.x,
      y: position.y,
      radius: 12 + Math.min(5, Math.max(0, value.materials.length - 1) * 2),
      labelWidth: Math.min(208, Math.max(56, value.term.length * 7)),
      status: value.status,
      color: STATUS_COLORS[value.status],
      definition: value.definition,
      materials: value.materials
    });
    for (const material of value.materials) links.push({ source: material.id, target: `concept:${key}` });
  }

  const margin = 80;
  if (!nodes.length) return { nodes, links, viewBox: '0 0 900 620' };
  const minX = Math.min(...nodes.map(node => node.x - (node.type === 'material' ? node.radius : node.labelWidth / 2) - margin));
  const maxX = Math.max(...nodes.map(node => node.x + (node.type === 'material' ? node.radius : node.labelWidth / 2) + margin));
  const minY = Math.min(...nodes.map(node => node.y - (node.type === 'material' ? 40 : node.radius + 28) - margin));
  const maxY = Math.max(...nodes.map(node => node.y + (node.type === 'material' ? 40 : node.radius + 34) + margin));
  const width = Math.max(720, maxX - minX);
  const height = Math.max(520, maxY - minY);
  const viewBox = `${(minX + maxX - width) / 2} ${(minY + maxY - height) / 2} ${width} ${height}`;

  return { nodes, links, viewBox };
}

function statusLabel(status: KnowledgeStatus) {
  if (status === 'weak') return 'Нужна практика';
  if (status === 'strong') return 'Ошибка исправлена';
  return 'Нет отметок';
}

function fitViewBox(nodes: GraphNode[], aspectRatio: number) {
  if (!nodes.length || !Number.isFinite(aspectRatio) || aspectRatio <= 0) return '0 0 900 620';
  const margin = 64;
  const bounds = nodes.reduce((box, node) => {
    const halfWidth = node.type === 'material' ? node.radius : node.labelWidth / 2;
    const halfHeight = node.type === 'material' ? 42 : node.radius + 34;
    return {
      minX: Math.min(box.minX, node.x - halfWidth),
      maxX: Math.max(box.maxX, node.x + halfWidth),
      minY: Math.min(box.minY, node.y - halfHeight),
      maxY: Math.max(box.maxY, node.y + halfHeight)
    };
  }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  let width = Math.max(420, bounds.maxX - bounds.minX + margin * 2);
  let height = Math.max(300, bounds.maxY - bounds.minY + margin * 2);
  if (width / height > aspectRatio) height = width / aspectRatio;
  else width = height * aspectRatio;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return `${centerX - width / 2} ${centerY - height / 2} ${width} ${height}`;
}

// Ctrl + wheel and trackpad pinch (browsers report it as a wheel event with ctrlKey): zoom follows
// deltaY smoothly, while a ~100px mouse-wheel notch is capped at a single ~22% step.
function wheelZoomFactor(event: WheelEvent) {
  const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 800 : event.deltaY;
  return Math.exp(-Math.max(-20, Math.min(20, pixels)) * 0.01);
}

function compactFocusLayout(nodes: GraphNode[]) {
  const materials = nodes.filter(node => node.type === 'material').sort((a, b) => a.y - b.y || a.x - b.x);
  const concepts = nodes.filter(node => node.type === 'concept');
  if (!materials.length || !concepts.length) return nodes;

  const materialY = new Map(materials.map((node, index) => [node.id, (index - (materials.length - 1) / 2) * 220]));
  const positionedMaterials = materials.map(node => ({ ...node, x: 280, y: materialY.get(node.id)! }));
  const orderedConcepts = concepts.map(node => {
    const linkedY = (node.materials || []).map(material => materialY.get(material.id)).filter((y): y is number => y !== undefined);
    return { node, y: linkedY.length ? linkedY.reduce((sum, value) => sum + value, 0) / linkedY.length : node.y };
  }).sort((a, b) => a.y - b.y || a.node.label.localeCompare(b.node.label, 'ru'));

  let previousY = -Infinity;
  const placedConcepts = orderedConcepts.map(({ node, y }) => {
    const nextY = Math.max(y, previousY + 106);
    previousY = nextY;
    return { node, y: nextY };
  });
  const offset = placedConcepts.length
    ? (placedConcepts[0].y + placedConcepts[placedConcepts.length - 1].y) / 2
    : 0;
  const positionedConcepts = placedConcepts.map(({ node, y }) => ({ ...node, x: 520, y: y - offset }));
  const positions = new Map([...positionedMaterials, ...positionedConcepts].map(node => [node.id, node]));
  return nodes.map(node => positions.get(node.id) || node);
}

export default function KnowledgeMap() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [materials, setMaterials] = useState<MaterialRecord[]>([]);
  const [mistakes, setMistakes] = useState<any[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<GraphFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>(() => window.innerWidth < 640 ? 'list' : 'map');
  const [scale, setScale] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(960);
  const gestureRef = useRef({ mode: 'idle' as 'idle' | 'pan' | 'pinch', lastX: 0, lastY: 0, startDistance: 0, startScale: 1, anchorX: 0, anchorY: 0 });
  const pointerMapRef = useRef(new Map<number, { x: number; y: number }>());
  const viewRef = useRef({ scale: 1, panX: 0, panY: 0 });
  // Frame pinned by the user's first zoom, pan or zoom-button gesture.
  const [pinnedFrame, setPinnedFrame] = useState<{ viewBox: string; compactKey: string | null } | null>(null);
  const wheelHandlerRef = useRef<(event: WheelEvent) => void>(() => {});
  const wheelCleanupRef = useRef<(() => void) | null>(null);

  const surfaceClass = 'rounded-2xl border border-[var(--sf-line)] bg-[var(--sf-surface)]';

  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    Promise.all([
      supabase.from('materials').select('*').eq('user_id', user.id),
      supabase.from('mistake_diary').select('*').eq('user_id', user.id)
    ]).then(([materialsResult, mistakesResult]) => {
      if (materialsResult.error) throw materialsResult.error;
      if (mistakesResult.error) throw mistakesResult.error;
      if (cancelled) return;
      setMaterials((materialsResult.data || []) as MaterialRecord[]);
      setMistakes(mistakesResult.data || []);
    }).catch(error => {
      console.error('Knowledge map data load failed:', error);
      if (!cancelled) setLoadError(true);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [user?.id, reloadKey]);

  const graph = useMemo(() => buildGraph(materials, mistakes), [materials, mistakes]);
  const { nodes, links, viewBox } = graph;
  const nodeById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) || null : null;
  const conceptNodes = nodes.filter(node => node.type === 'concept');
  const materialNodes = nodes.filter(node => node.type === 'material');
  const graphStats = {
    concepts: conceptNodes.length,
    materials: materialNodes.length,
    shared: conceptNodes.filter(node => (node.materials?.length || 0) > 1).length,
    weak: conceptNodes.filter(node => node.status === 'weak').length
  };
  const commonTopics = [...conceptNodes]
    .filter(node => (node.materials?.length || 0) > 1)
    .sort((a, b) => (b.materials?.length || 0) - (a.materials?.length || 0) || a.label.localeCompare(b.label, 'ru'))
    .slice(0, 5);
  const weakTopics = conceptNodes.filter(node => node.status === 'weak').sort((a, b) => (b.materials?.length || 0) - (a.materials?.length || 0)).slice(0, 5);
  const [, , viewWidth, viewHeight] = viewBox.split(' ').map(Number);
  const mapCanvasHeight = Math.round(Math.min(820, Math.max(440, canvasWidth * viewHeight / viewWidth)));

  useEffect(() => {
    const element = canvasRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const nextWidth = entries[0]?.contentRect.width;
      if (nextWidth) setCanvasWidth(nextWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewMode]);

  const filterIds = useMemo(() => {
    if (activeFilter === 'all') return new Set(nodes.map(node => node.id));
    const conceptIds = new Set(conceptNodes
      .filter(node => activeFilter === 'shared' ? (node.materials?.length || 0) > 1 : node.status === 'weak')
      .map(node => node.id));
    const visible = new Set(conceptIds);
    links.forEach(link => {
      if (conceptIds.has(link.target)) visible.add(link.source);
    });
    return visible;
  }, [activeFilter, conceptNodes, links, nodes]);
  const visibleNodes = nodes.filter(node => filterIds.has(node.id));
  const visibleLinks = links.filter(link => filterIds.has(link.source) && filterIds.has(link.target));
  const neighborMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of links) {
      if (!map.has(link.source)) map.set(link.source, new Set());
      if (!map.has(link.target)) map.set(link.target, new Set());
      map.get(link.source)!.add(link.target);
      map.get(link.target)!.add(link.source);
    }
    return map;
  }, [links]);
  const normalizedSearch = normalizeTerm(searchQuery);
  const searchMatches = visibleNodes.filter(node => normalizeTerm(node.label).includes(normalizedSearch));
  const selectedNeighbors = selectedNodeId ? neighborMap.get(selectedNodeId) || new Set<string>() : new Set<string>();
  const expandFocus = (nodeId: string) => {
    const focused = new Set<string>([nodeId]);
    const direct = neighborMap.get(nodeId) || new Set<string>();
    direct.forEach(id => focused.add(id));
    if (nodeById.get(nodeId)?.type === 'material') {
      direct.forEach(conceptId => {
        (neighborMap.get(conceptId) || new Set<string>()).forEach(connectedId => focused.add(connectedId));
      });
    }
    return focused;
  };
  const searchFocusIds = new Set(searchMatches.flatMap(node => [...expandFocus(node.id)].filter(id => filterIds.has(id))));
  const selectedFocusIds = selectedNodeId ? expandFocus(selectedNodeId) : new Set<string>();
  const conceptConnections = selectedNode?.type === 'material'
    ? [...selectedNeighbors].map(id => nodeById.get(id)).filter((node): node is GraphNode => Boolean(node && node.type === 'concept'))
    : [];
  const focusForFit = selectedNodeId
    ? selectedFocusIds
    : normalizedSearch && searchMatches.length
      ? searchFocusIds
      : filterIds;
  const nodesForFit = nodes.filter(node => focusForFit.has(node.id));
  const compactCandidate = canvasWidth < 640 && Boolean(selectedNodeId || normalizedSearch || activeFilter !== 'all') && nodesForFit.length <= 12;
  const compactKey = compactCandidate ? nodesForFit.map(node => node.id).sort().join('|') : null;
  // Until the user moves the map, the frame fits the current selection, filter or search. After a gesture
  // the frame stays pinned, so focus changes keep the chosen zoom. The compact mobile layout is built for one
  // focus set, so its pinned frame lasts only until that focus changes.
  const pinActive = pinnedFrame !== null && (pinnedFrame.compactKey === null || pinnedFrame.compactKey === compactKey);
  const compactMobileFocus = pinActive ? pinnedFrame.compactKey !== null : compactCandidate;
  const displayNodes = compactMobileFocus ? compactFocusLayout(nodesForFit) : nodes;
  const displayNodeById = new Map(displayNodes.map(node => [node.id, node]));
  const fittedViewBox = fitViewBox(compactMobileFocus ? displayNodes : nodesForFit.length ? nodesForFit : visibleNodes, canvasWidth / Math.max(440, mapCanvasHeight));
  const displayViewBox = pinActive ? pinnedFrame.viewBox : fittedViewBox;
  const view = pinActive ? { scale, panX, panY } : { scale: 1, panX: 0, panY: 0 };

  const updateView = (next: { scale: number; panX: number; panY: number }) => {
    viewRef.current = next;
    setScale(next.scale);
    setPanX(next.panX);
    setPanY(next.panY);
  };

  const moveView = (next: { scale: number; panX: number; panY: number }) => {
    if (!pinActive) setPinnedFrame({ viewBox: displayViewBox, compactKey: compactMobileFocus ? compactKey : null });
    updateView(next);
  };

  const svgPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: clientX, y: clientY };
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const matrix = svg.getScreenCTM();
    return matrix ? point.matrixTransform(matrix.inverse()) : { x: clientX, y: clientY };
  };

  const zoomAt = (nextScale: number, anchor: { x: number; y: number }) => {
    const current = viewRef.current;
    const bounded = Math.min(2.6, Math.max(0.55, nextScale));
    const ratio = bounded / current.scale;
    moveView({
      scale: bounded,
      panX: anchor.x - (anchor.x - current.panX) * ratio,
      panY: anchor.y - (anchor.y - current.panY) * ratio
    });
  };

  const zoomFromControl = (factor: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const bounds = svg.getBoundingClientRect();
    zoomAt(viewRef.current.scale * factor, svgPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2));
  };

  const resetView = () => {
    setPinnedFrame(null);
    updateView({ scale: 1, panX: 0, panY: 0 });
  };
  const resetMap = () => {
    setActiveFilter('all');
    setSearchQuery('');
    setSelectedNodeId(null);
    resetView();
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if ((event.target as Element).closest('[data-map-node="true"]')) return;
    const point = svgPoint(event.clientX, event.clientY);
    pointerMapRef.current.set(event.pointerId, point);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointerMapRef.current.size === 1) {
      gestureRef.current = { ...gestureRef.current, mode: 'pan', lastX: point.x, lastY: point.y };
    } else if (pointerMapRef.current.size >= 2) {
      const points = [...pointerMapRef.current.values()];
      const centerPoint = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      const current = viewRef.current;
      gestureRef.current = {
        mode: 'pinch',
        lastX: centerPoint.x,
        lastY: centerPoint.y,
        startDistance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
        startScale: current.scale,
        anchorX: (centerPoint.x - current.panX) / current.scale,
        anchorY: (centerPoint.y - current.panY) / current.scale
      };
    }
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!pointerMapRef.current.has(event.pointerId)) return;
    const point = svgPoint(event.clientX, event.clientY);
    pointerMapRef.current.set(event.pointerId, point);
    const current = viewRef.current;
    if (pointerMapRef.current.size >= 2) {
      const points = [...pointerMapRef.current.values()];
      const centerPoint = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const gesture = gestureRef.current;
      const nextScale = Math.min(2.6, Math.max(0.55, gesture.startScale * (distance / Math.max(1, gesture.startDistance))));
      moveView({ scale: nextScale, panX: centerPoint.x - gesture.anchorX * nextScale, panY: centerPoint.y - gesture.anchorY * nextScale });
      return;
    }
    if (gestureRef.current.mode === 'pan') {
      const dx = point.x - gestureRef.current.lastX;
      const dy = point.y - gestureRef.current.lastY;
      gestureRef.current.lastX = point.x;
      gestureRef.current.lastY = point.y;
      moveView({ ...current, panX: current.panX + dx, panY: current.panY + dy });
    }
  };

  const onPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    pointerMapRef.current.delete(event.pointerId);
    gestureRef.current.mode = pointerMapRef.current.size ? 'pan' : 'idle';
  };

  const onWheel = (event: WheelEvent) => {
    // A plain wheel scrolls the page; only Ctrl + wheel and trackpad pinch zoom the map.
    if (!event.ctrlKey) return;
    event.preventDefault();
    zoomAt(viewRef.current.scale * wheelZoomFactor(event), svgPoint(event.clientX, event.clientY));
  };

  useLayoutEffect(() => {
    wheelHandlerRef.current = onWheel;
  });

  // React registers wheel listeners as passive, so preventDefault in onWheel is ignored.
  // A native non-passive listener keeps the browser from zooming the page while the map zooms.
  const attachSvg = useCallback((svg: SVGSVGElement | null) => {
    wheelCleanupRef.current?.();
    wheelCleanupRef.current = null;
    svgRef.current = svg;
    if (!svg) return;
    const listener = (event: WheelEvent) => wheelHandlerRef.current(event);
    svg.addEventListener('wheel', listener, { passive: false });
    wheelCleanupRef.current = () => svg.removeEventListener('wheel', listener);
  }, []);

  // A pinned compact frame is stale once its focus changes: return to the fitted frame.
  useEffect(() => {
    if (pinnedFrame && !pinActive) resetView();
  }, [pinnedFrame, pinActive]);

  // When a pinned frame shows none of the newly selected, filtered or found nodes,
  // pan to the first of them without changing the zoom.
  useEffect(() => {
    if (!pinActive || compactMobileFocus) return;
    const targetIds = selectedNodeId ? [selectedNodeId] : normalizedSearch ? searchMatches.map(node => node.id) : [...filterIds];
    const targets = targetIds.map(id => nodeById.get(id)).filter((node): node is GraphNode => Boolean(node));
    if (!targets.length) return;
    const [x, y, width, height] = displayViewBox.split(' ').map(Number);
    const current = viewRef.current;
    const inFrame = (node: GraphNode) => {
      const screenX = current.panX + current.scale * node.x;
      const screenY = current.panY + current.scale * node.y;
      return screenX >= x && screenX <= x + width && screenY >= y && screenY <= y + height;
    };
    if (targets.some(inFrame)) return;
    updateView({
      ...current,
      panX: x + width / 2 - current.scale * targets[0].x,
      panY: y + height / 2 - current.scale * targets[0].y
    });
  }, [selectedNodeId, normalizedSearch, activeFilter]);

  const selectNode = (node: GraphNode) => setSelectedNodeId(node.id);
  const noResults = Boolean(normalizedSearch) && searchMatches.length === 0;

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1500px] space-y-5 px-4 py-5 text-[var(--sf-ink)] sm:px-6 lg:space-y-6 lg:px-8">
      <header className="flex flex-col gap-4 border-b border-[var(--sf-line)] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--sf-accent)]">
            <Network className="h-4 w-4" /> Связи между материалами
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Карта знаний</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-[var(--sf-muted)]">
            Общие понятия показывают, где пересекаются ваши конспекты. Нажмите на узел, чтобы перейти от карты к материалу или теме.
          </p>
        </div>
        {!loading && !loadError && materials.length > 0 && (
          <p className="shrink-0 text-sm text-[var(--sf-muted)]">
            <span className="font-medium text-[var(--sf-ink)]">{pluralCount(graphStats.materials, ['материал', 'материала', 'материалов'])}</span>
            <span className="mx-2 text-[var(--sf-line)]">/</span>
            <span className="font-medium text-[var(--sf-ink)]">{pluralCount(graphStats.concepts, ['понятие', 'понятия', 'понятий'])}</span>
            <span className="mx-2 text-[var(--sf-line)]">/</span>
            <span className="font-medium text-[var(--sf-ink)]">{pluralCount(graphStats.shared, ['общая тема', 'общие темы', 'общих тем'])}</span>
          </p>
        )}
      </header>

      {loading ? (
        <div className={`${surfaceClass} flex min-h-[420px] items-center justify-center`} aria-label="Загрузка карты">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--sf-accent)] border-r-transparent" />
        </div>
      ) : loadError ? (
        <section className={`${surfaceClass} mx-auto max-w-xl px-6 py-12 text-center`}>
          <AlertCircle className="mx-auto h-8 w-8 text-[#b65342]" />
          <h2 className="mt-3 text-lg font-semibold">Не удалось загрузить карту</h2>
          <p className="mt-2 text-sm text-[var(--sf-muted)]">Материалы не изменены. Проверьте подключение и повторите попытку.</p>
          <button onClick={() => setReloadKey(key => key + 1)} className="mt-5 rounded-full bg-[var(--sf-accent)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--sf-accent-hover)]">
            Повторить
          </button>
        </section>
      ) : materials.length === 0 ? (
        <section className={`${surfaceClass} mx-auto max-w-xl px-6 py-12 text-center`}>
          <BookOpen className="mx-auto h-9 w-9 text-[var(--sf-accent)]" />
          <h2 className="mt-3 text-lg font-semibold">Пока нет материалов</h2>
          <p className="mt-2 text-sm text-[var(--sf-muted)]">Загрузите конспект — карта покажет его понятия и связи с другими материалами.</p>
          <button onClick={() => navigate('/analyze')} className="mt-5 inline-flex items-center gap-2 rounded-full bg-[var(--sf-accent)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--sf-accent-hover)]">
            Добавить материал <ArrowUpRight className="h-4 w-4" />
          </button>
        </section>
      ) : (
        <>
          <section className={`${surfaceClass} flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4`} aria-label="Управление картой">
            <div className="flex gap-1 overflow-x-auto pb-1 sm:pb-0" role="group" aria-label="Фильтр карты">
              {([
                ['all', 'Вся карта', nodes.length],
                ['shared', 'Общие темы', graphStats.shared],
                ['weak', 'Нужно повторить', graphStats.weak]
              ] as const).map(([value, label, count]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={activeFilter === value}
                  onClick={() => { setActiveFilter(value); setSelectedNodeId(null); }}
                  className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-medium transition ${activeFilter === value ? 'bg-[var(--sf-accent)] text-white' : 'text-[var(--sf-muted)] hover:bg-[var(--sf-surface-soft)] hover:text-[var(--sf-ink)]'}`}
                >
                  {label}<span className={`text-xs ${activeFilter === value ? 'text-white/80' : 'text-[var(--sf-muted)]'}`}>{count}</span>
                </button>
              ))}
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <label className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--sf-muted)]" />
                <input
                  value={searchQuery}
                  onChange={event => setSearchQuery(event.target.value)}
                  placeholder="Найти материал или тему"
                  aria-label="Найти материал или тему"
                  className="h-10 w-full rounded-full border border-[var(--sf-line)] bg-[var(--sf-canvas)] pl-9 pr-9 text-sm text-[var(--sf-ink)] outline-none placeholder:text-[var(--sf-muted)] focus:border-[var(--sf-accent)]"
                />
                {searchQuery && <button type="button" onClick={() => setSearchQuery('')} aria-label="Очистить поиск" className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-[var(--sf-muted)] hover:bg-[var(--sf-surface-soft)]"><X className="h-4 w-4" /></button>}
              </label>
              <div className="flex shrink-0 rounded-full border border-[var(--sf-line)] p-0.5" role="group" aria-label="Вид карты">
                <button type="button" onClick={() => setViewMode('map')} aria-pressed={viewMode === 'map'} aria-label="Показать граф" className={`grid h-9 w-9 place-items-center rounded-full ${viewMode === 'map' ? 'bg-[var(--sf-surface-soft)] text-[var(--sf-ink)]' : 'text-[var(--sf-muted)]'}`}><Network className="h-4 w-4" /></button>
                <button type="button" onClick={() => setViewMode('list')} aria-pressed={viewMode === 'list'} aria-label="Показать списком" className={`grid h-9 w-9 place-items-center rounded-full ${viewMode === 'list' ? 'bg-[var(--sf-surface-soft)] text-[var(--sf-ink)]' : 'text-[var(--sf-muted)]'}`}><FileText className="h-4 w-4" /></button>
              </div>
            </div>
          </section>

          {noResults && <p role="status" className="rounded-xl border border-[var(--sf-line)] px-4 py-3 text-sm text-[var(--sf-muted)]">Ничего не найдено. Попробуйте изменить запрос.</p>}
          {activeFilter === 'shared' && graphStats.shared === 0 && <p role="status" className="rounded-xl border border-[var(--sf-line)] px-4 py-3 text-sm text-[var(--sf-muted)]">Пока нет понятий, которые встречаются в нескольких материалах.</p>}
          {activeFilter === 'weak' && graphStats.weak === 0 && <p role="status" className="rounded-xl border border-[var(--sf-line)] px-4 py-3 text-sm text-[var(--sf-muted)]">В дневнике ошибок пока нет тем для повторения.</p>}

          <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-5">
            <section className={`${surfaceClass} min-w-0 overflow-hidden`} aria-label="Граф знаний">
              {viewMode === 'map' ? (
                <div ref={canvasRef} className="relative overflow-hidden bg-[var(--sf-workbench)]">
                  <svg
                    ref={attachSvg}
                    viewBox={displayViewBox}
                    preserveAspectRatio="xMidYMid meet"
                    style={{ height: mapCanvasHeight }}
                    className="block min-h-[440px] w-full touch-pan-y select-none"
                    role="img"
                    aria-label="Карта связей между материалами и понятиями. Узлы доступны с клавиатуры."
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                  >
                    <g transform={`translate(${view.panX}, ${view.panY}) scale(${view.scale})`}>
                      {visibleLinks.map((link, index) => {
                        const source = displayNodeById.get(link.source);
                        const target = displayNodeById.get(link.target);
                        if (!source || !target) return null;
                        const selectedLink = selectedNodeId === source.id || selectedNodeId === target.id;
                        const searchLink = !normalizedSearch || searchFocusIds.has(source.id) && searchFocusIds.has(target.id);
                        const related = !selectedNodeId || selectedFocusIds.has(source.id) && selectedFocusIds.has(target.id);
                        const status = target.status;
                        const color = selectedLink ? (isDark ? '#77b5e7' : '#0868b2') : STATUS_COLORS[status];
                        const dx = target.x - source.x;
                        const dy = target.y - source.y;
                        const distance = Math.hypot(dx, dy) || 1;
                        const edgeRatio = Math.min(96 / Math.max(Math.abs(dx), 0.01), 31 / Math.max(Math.abs(dy), 0.01));
                        const x1 = source.x + dx * edgeRatio;
                        const y1 = source.y + dy * edgeRatio;
                        const x2 = target.x - (dx / distance) * target.radius;
                        const y2 = target.y - (dy / distance) * target.radius;
                        return <line key={`${link.source}-${link.target}-${index}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={selectedLink ? 2.1 : 1.35} strokeOpacity={searchLink && related ? (selectedLink ? 0.9 : 0.36) : 0.055} strokeLinecap="round" className="transition-[stroke-opacity,stroke-width] duration-200" />;
                      })}

                      {visibleNodes.map(node => {
                        const displayNode = displayNodeById.get(node.id) || node;
                        const isSelected = selectedNodeId === node.id;
                        const isConnected = selectedFocusIds.has(node.id);
                        const isSearchMatch = Boolean(normalizedSearch) && normalizeTerm(node.label).includes(normalizedSearch);
                        const inSearchContext = !normalizedSearch || searchFocusIds.has(node.id);
                        const inSelectedContext = !selectedNodeId || isSelected || isConnected;
                        const opacity = inSearchContext && inSelectedContext ? 1 : 0.14;
                        const color = node.type === 'material' ? node.color : STATUS_COLORS[node.status];
                        return (
                          <g
                            key={node.id}
                            data-map-node="true"
                            transform={`translate(${displayNode.x} ${displayNode.y})`}
                            role="button"
                            tabIndex={0}
                            aria-pressed={isSelected}
                            aria-label={`${node.type === 'material' ? 'Материал' : `Понятие, ${statusLabel(node.status)}`}: ${node.label}`}
                            onClick={() => selectNode(node)}
                            onKeyDown={event => {
                              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(node); }
                            }}
                            style={{ opacity, cursor: 'pointer' }}
                            className="transition-opacity duration-200 focus:outline-none"
                          >
                            <title>{node.label}</title>
                            {node.type === 'material' ? (
                              <>
                                <rect x={-96} y={-31} width={192} height={62} rx={14} fill={isSelected ? (isDark ? '#293a49' : '#e8f2fb') : (isDark ? '#302f2c' : '#ffffff')} stroke={isSelected ? (isDark ? '#77b5e7' : '#0868b2') : (isDark ? '#55514a' : '#d8d5cf')} strokeWidth={isSelected ? 2 : 1.2} />
                                <rect x={-96} y={-20} width={3} height={40} rx={1.5} fill={node.color} />
                                <path d="M -79 -10 h10 l5 5 v16 h-15 z M -69 -10 v6 h5 M -76 2 h9 M -76 7 h9" fill="none" stroke={isDark ? '#d0cec8' : '#555650'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
                                <circle cx={82} cy={-17} r={4} fill={node.color} />
                                <text x={-57} y={-2} textAnchor="start" fill={isDark ? '#f2f0ec' : '#20201e'} fontSize="11.5" fontWeight="600" className="pointer-events-none">
                                  <tspan x={-57}>{titleLines(node.label)[0]}</tspan>
                                  {titleLines(node.label)[1] && <tspan x={-57} dy="14" fill={isDark ? '#b0ada6' : '#696862'} fontSize="10.5" fontWeight="400">{titleLines(node.label)[1]}</tspan>}
                                </text>
                              </>
                            ) : (
                              <>
                                <circle r={node.radius + (isSelected || isSearchMatch ? 5 : 0)} fill="none" stroke={isSelected || isSearchMatch ? (isDark ? '#77b5e7' : '#0868b2') : color} strokeOpacity={isSelected || isSearchMatch ? 0.62 : 0.18} strokeWidth={1.4} />
                                <circle r={node.radius} fill={isDark ? '#302f2c' : '#ffffff'} stroke={color} strokeWidth={2.2} />
                                {node.status !== 'neutral' && <text x="0" y="4" textAnchor="middle" fill={color} fontSize="11" fontWeight="700" className="pointer-events-none">{node.status === 'weak' ? '!' : '✓'}</text>}
                                <text y={node.radius + 17} textAnchor="middle" fill={isDark ? '#e2dfd8' : '#3f403c'} fontSize="10.5" fontWeight={isSelected || isSearchMatch ? '700' : '500'} className="pointer-events-none">{truncate(node.label, 28)}</text>
                                {(node.materials?.length || 0) > 1 && <text y={node.radius + 30} textAnchor="middle" fill={isDark ? '#b0ada6' : '#696862'} fontSize="9" className="pointer-events-none">{node.materials!.length} материала</text>}
                              </>
                            )}
                          </g>
                        );
                      })}
                    </g>
                  </svg>

                  <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full border border-[var(--sf-line)] bg-[var(--sf-surface)] p-1 shadow-sm" role="group" aria-label="Масштаб карты">
                    <button type="button" onClick={() => zoomFromControl(1.2)} aria-label="Приблизить" className="grid h-9 w-9 place-items-center rounded-full text-[var(--sf-muted)] hover:bg-[var(--sf-surface-soft)] hover:text-[var(--sf-ink)]"><ZoomIn className="h-4 w-4" /></button>
                    <span className="w-10 text-center text-[11px] tabular-nums text-[var(--sf-muted)]">{Math.round(view.scale * 100)}%</span>
                    <button type="button" onClick={() => zoomFromControl(1 / 1.2)} aria-label="Отдалить" className="grid h-9 w-9 place-items-center rounded-full text-[var(--sf-muted)] hover:bg-[var(--sf-surface-soft)] hover:text-[var(--sf-ink)]"><ZoomOut className="h-4 w-4" /></button>
                    <span className="mx-0.5 h-5 w-px bg-[var(--sf-line)]" />
                    <button type="button" onClick={resetMap} aria-label="Показать всю карту" title="Показать всю карту" className="grid h-9 w-9 place-items-center rounded-full text-[var(--sf-muted)] hover:bg-[var(--sf-surface-soft)] hover:text-[var(--sf-ink)]"><Focus className="h-4 w-4" /></button>
                  </div>
                </div>
              ) : (
                <div className="max-h-[660px] space-y-1 overflow-y-auto p-3 sm:p-4">
                  {visibleNodes.map(node => (
                    <button key={node.id} type="button" onClick={() => selectNode(node)} className={`flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${selectedNodeId === node.id ? 'bg-[var(--sf-accent-soft)]' : 'hover:bg-[var(--sf-surface-soft)]'}`}>
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${node.type === 'material' ? 'border border-[var(--sf-line)] bg-[var(--sf-surface)]' : 'rounded-full border-2 bg-[var(--sf-surface)]'}`} style={{ color: node.type === 'material' ? node.color : STATUS_COLORS[node.status], borderColor: node.type === 'concept' ? STATUS_COLORS[node.status] : undefined }}>
                        {node.type === 'material' ? <FileText className="h-4 w-4" /> : node.status === 'weak' ? <AlertCircle className="h-4 w-4" /> : node.status === 'strong' ? <Check className="h-4 w-4" /> : <Network className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-[var(--sf-ink)]">{node.label}</span>
                        <span className="mt-0.5 block truncate text-xs text-[var(--sf-muted)]">{node.type === 'material' ? `${String(node.details?.subject || 'Общее')} · ${(neighborMap.get(node.id) || new Set()).size} понятий` : `${node.materials?.length || 0} материалов · ${statusLabel(node.status)}`}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--sf-muted)]" />
                    </button>
                  ))}
                </div>
              )}
              {viewMode === 'map' && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--sf-line)] px-4 py-3 text-[11px] text-[var(--sf-muted)]">
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] border border-[var(--sf-muted)]" /> Материал</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-[#557a96]" /> Понятие</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#b65342]" /> Нужна практика</span>
              </div>}
              <div className="border-t border-[var(--sf-line)] px-4 py-3 text-xs text-[var(--sf-muted)]">
                {viewMode === 'map' ? 'Перетаскивайте карту мышью или двумя пальцами. Масштаб — Ctrl и колесо мыши, щипок или кнопки «+» и «−». Нажмите на узел, чтобы открыть подробности.' : `${visibleNodes.length} элементов · список остаётся доступен при любом фильтре.`}
              </div>
            </section>

            <aside className="min-w-0 space-y-4">
              {selectedNode ? (
                <section className={`${surfaceClass} p-4 sm:p-5`} aria-live="polite">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--sf-muted)]">{selectedNode.type === 'material' ? 'Материал' : 'Понятие'}</p>
                      <h2 className="mt-1.5 break-words text-lg font-semibold leading-snug">{selectedNode.label}</h2>
                    </div>
                    <button type="button" onClick={() => setSelectedNodeId(null)} aria-label="Закрыть подробности" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--sf-muted)] hover:bg-[var(--sf-surface-soft)]"><X className="h-4 w-4" /></button>
                  </div>

                  {selectedNode.type === 'material' ? (
                    <>
                      <p className="mt-2 text-sm text-[var(--sf-muted)]">{String(selectedNode.details?.subject || 'Без предмета')}{formatDate(selectedNode.details?.created_at as string) ? ` · ${formatDate(selectedNode.details?.created_at as string)}` : ''}</p>
                      <div className="mt-4 border-t border-[var(--sf-line)] pt-3">
                        <p className="mb-2 text-xs font-medium text-[var(--sf-muted)]">Понятия в этом материале</p>
                          {conceptConnections.length ? <div className="flex flex-wrap gap-1.5">{conceptConnections.map(node => <button key={node.id} type="button" onClick={() => selectNode(node)} className="rounded-full border border-[var(--sf-line)] px-2.5 py-1.5 text-xs text-[var(--sf-ink)] hover:border-[var(--sf-accent)]">{node.label}</button>)}</div> : <p className="text-sm text-[var(--sf-muted)]">В конспекте пока не найдено понятий для карты.</p>}
                      </div>
                      <div className="mt-4 flex flex-col gap-2">
                        <button type="button" onClick={() => navigate(`/library/${selectedNode.id}`)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-[var(--sf-accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--sf-accent-hover)]"><BookOpen className="h-4 w-4" /> Открыть материал</button>
                        <button type="button" onClick={() => navigate('/exam')} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-[var(--sf-line)] px-4 text-sm font-medium text-[var(--sf-ink)] hover:bg-[var(--sf-surface-soft)]">Проверить себя <ArrowUpRight className="h-4 w-4" /></button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="mt-3 inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium" style={{ color: STATUS_COLORS[selectedNode.status], backgroundColor: isDark ? '#302f2c' : '#f3f2ef' }}>
                        {selectedNode.status === 'weak' ? <AlertCircle className="h-3.5 w-3.5" /> : selectedNode.status === 'strong' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Network className="h-3.5 w-3.5" />}
                        {statusLabel(selectedNode.status)}
                      </div>
                      {selectedNode.definition && <p className="mt-3 text-sm leading-relaxed text-[var(--sf-muted)]">{selectedNode.definition}</p>}
                      <div className="mt-4 border-t border-[var(--sf-line)] pt-3">
                        <p className="mb-2 text-xs font-medium text-[var(--sf-muted)]">Встречается в материалах</p>
                        <div className="space-y-1">
                          {(selectedNode.materials || []).map(material => <button key={material.id} type="button" onClick={() => setSelectedNodeId(material.id)} className="flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-2.5 text-left text-sm text-[var(--sf-ink)] hover:bg-[var(--sf-surface-soft)]"><span className="truncate">{material.title}</span><ChevronRight className="h-4 w-4 shrink-0 text-[var(--sf-muted)]" /></button>)}
                        </div>
                      </div>
                      {selectedNode.status === 'weak' && <button type="button" onClick={() => navigate('/mistakes')} className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full bg-[var(--sf-accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--sf-accent-hover)]"><RotateCcw className="h-4 w-4" /> Разобрать ошибки</button>}
                    </>
                  )}
                </section>
              ) : (
                <section className={`${surfaceClass} p-4 sm:p-5`}>
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--sf-muted)]">Как читать карту</p>
                  <h2 className="mt-1.5 text-base font-semibold">Материалы соединяются через понятия</h2>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--sf-muted)]">Если тема встречается в нескольких конспектах, она становится мостом между ними. Выберите такой узел, чтобы увидеть определение и исходные материалы.</p>
                </section>
              )}

              <section className={`${surfaceClass} p-4`}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold">Что связывает материалы</h2>
                    <p className="mt-0.5 text-xs text-[var(--sf-muted)]">Понятия, найденные в нескольких конспектах</p>
                  </div>
                  <span className="text-xs tabular-nums text-[var(--sf-muted)]">{graphStats.shared}</span>
                </div>
                {commonTopics.length ? <div className="space-y-1">{commonTopics.map(node => <button key={node.id} type="button" onClick={() => { setActiveFilter('all'); setSelectedNodeId(node.id); }} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-[var(--sf-surface-soft)]"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: STATUS_COLORS[node.status] }} /><span className="min-w-0 flex-1 truncate text-sm text-[var(--sf-ink)]">{node.label}</span><span className="shrink-0 text-xs text-[var(--sf-muted)]">×{node.materials?.length}</span></button>)}</div> : <p className="py-1 text-sm text-[var(--sf-muted)]">Общие понятия появятся, когда тема встретится в двух или более конспектах.</p>}
              </section>

              <section className={`${surfaceClass} p-4`}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold">Темы для повторения</h2>
                    <p className="mt-0.5 text-xs text-[var(--sf-muted)]">По открытым записям в дневнике ошибок</p>
                  </div>
                  <span className="text-xs tabular-nums text-[var(--sf-muted)]">{graphStats.weak}</span>
                </div>
                {weakTopics.length ? <div className="space-y-1">{weakTopics.map(node => <button key={node.id} type="button" onClick={() => { setActiveFilter('all'); setSelectedNodeId(node.id); }} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-[var(--sf-surface-soft)]"><AlertCircle className="h-4 w-4 shrink-0 text-[#b65342]" /><span className="min-w-0 flex-1 truncate text-sm text-[var(--sf-ink)]">{node.label}</span><ChevronRight className="h-4 w-4 shrink-0 text-[var(--sf-muted)]" /></button>)}</div> : <p className="py-1 text-sm text-[var(--sf-muted)]">Нет открытых ошибок по понятиям из этих конспектов.</p>}
              </section>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}
