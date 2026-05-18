import ReactMarkdown from 'react-markdown';

function SectionBlock({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{icon}</span>
        <h3 className="font-semibold text-slate-900">{title}</h3>
      </div>
      <div className="pl-7 text-slate-700 text-[15px] leading-relaxed">{children}</div>
    </div>
  );
}

export default function SummaryView({ data }: { data: any }) {
  const content = data?.content || data?.raw || '';
  if (!content) return <p className="text-slate-400">Нет данных</p>;

  const sections = content.split(/(?=^## )/gm).filter(Boolean);

  const iconMap: Record<string, string> = {
    '📌': '📌', '🔑': '🔑', '📖': '📖', '📚': '📚', '💡': '💡',
  };

  return (
    <div className="space-y-1">
      {sections.map((sec: string, i: number) => {
        const match = sec.match(/^## (.+)/);
        if (!match) return (
          <div key={i} className="prose prose-slate max-w-none text-slate-700">
            <ReactMarkdown>{sec}</ReactMarkdown>
          </div>
        );
        const title = match[1].trim();
        const body = sec.replace(/^## .+\n?/, '');
        const icon = Object.keys(iconMap).find(k => title.includes(k)) || '📄';
        const cleanTitle = title.replace(/[📌🔑📖📚💡]/g, '').trim();

        return (
          <SectionBlock key={i} icon={icon} title={cleanTitle}>
            <div className="prose prose-slate prose-sm max-w-none">
              <ReactMarkdown>{body}</ReactMarkdown>
            </div>
          </SectionBlock>
        );
      })}
    </div>
  );
}
