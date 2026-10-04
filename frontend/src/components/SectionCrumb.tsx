import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import './sectionCrumb.css';

/**
 * «‹ Прогресс» above the title of a page that lives inside a section of the menu (the knowledge map
 * in «Прогресс», the mistakes diary in «Повторение»). On a computer only: below 1024 px the top line
 * shows the same link in place of the wordmark (Layout's backLinkFor), and the projector shows no
 * crumbs.
 */
export default function SectionCrumb({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="sf-crumb sc-crumb">
      <ArrowLeft aria-hidden="true" strokeWidth={2} />
      {label}
    </Link>
  );
}
