const fs = require('fs');
let content = fs.readFileSync('src/pages/KnowledgeMap.tsx', 'utf8');

// Replace backgrounds
content = content.replace(/bg-\[\#0d1117\]/g, 'bg-slate-50');
content = content.replace(/bg-\[\#161b22\]/g, 'bg-white');
content = content.replace(/bg-\[\#21262d\]/g, 'bg-slate-100');
content = content.replace(/bg-\[\#30363d\]/g, 'bg-slate-200');
content = content.replace(/bg-\[\#090d13\]/g, 'bg-slate-50');

content = content.replace(/hover:bg-\[\#30363d\]/g, 'hover:bg-slate-200');
content = content.replace(/hover:bg-\[\#21262d\]/g, 'hover:bg-slate-100');

// Borders
content = content.replace(/border-\[\#30363d\]/g, 'border-slate-300');
content = content.replace(/border-slate-800\/80/g, 'border-slate-200/80');
content = content.replace(/border-slate-800/g, 'border-slate-200');

// Text colors
content = content.replace(/text-slate-100/g, 'text-slate-900');
content = content.replace(/text-slate-200/g, 'text-slate-800');
content = content.replace(/text-slate-300/g, 'text-slate-700');
content = content.replace(/text-slate-400/g, 'text-slate-500');

// SVG Colors
content = content.replace(/stroke=\{isHighlight \? '#a78bfa' : '#334155'\}/g, "stroke={isHighlight ? '#6366f1' : '#cbd5e1'}");
content = content.replace(/fill=\{isMaterial \? '#090d13' : node\.color\}/g, "fill={isMaterial ? '#ffffff' : node.color}");
content = content.replace(/stroke=\{isMaterial \? '#7c3aed' : '#090d13'\}/g, "stroke={isMaterial ? '#6366f1' : '#ffffff'}");
content = content.replace(/fill=\{isSelected \? '#ffffff' : isMaterial \? '#f1f5f9' : '#94a3b8'\}/g, "fill={isSelected ? '#1e293b' : isMaterial ? '#334155' : '#64748b'}");
content = content.replace(/textShadow: '0px 2px 4px rgba\\(0, 0, 0, 0\\.95\\), 0px 0px 2px rgba\\(0, 0, 0, 0\\.8\\)'/g, "textShadow: '0px 1px 2px rgba(255, 255, 255, 0.9), 0px 0px 2px rgba(255, 255, 255, 0.9)'");

// Tooltip background
content = content.replace(/bg-\[\#161b22\]\/90/g, 'bg-white/90');

// Placeholder
content = content.replace(/placeholder-slate-500/g, 'placeholder-slate-400');

fs.writeFileSync('src/pages/KnowledgeMap.tsx', content);
console.log('Theme converted to light mode.');
