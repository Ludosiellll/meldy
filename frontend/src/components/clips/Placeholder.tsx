import './stepClip.css';

/** A how-to clip's frame and the room of its line, while the clip's file is on its way: nothing moves when it arrives. */
export default function StepClipPlaceholder({ compact = false }: { compact?: boolean }) {
  return (
    <div className="sc" data-playing="false" data-compact={compact ? '' : undefined} aria-hidden="true">
      <div className="sc-frame" />
      <div className="sc-bar" />
    </div>
  );
}
