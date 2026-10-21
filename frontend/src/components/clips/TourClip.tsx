import { useLazyPart } from '../../lib/lazyPart';
import { stepClipPart } from './clipPart';
import StepClipPlaceholder from './Placeholder';
import './stepClip.css';

/**
 * The studio's first-visit tour (components/studio/Tour.tsx) opens with the clip «Свой тест» from the studio on
 * (scenes/studioTour.tsx; UX audit of 21.10: its first step, «Новый тест», is behind the author already): «Заголовок»
 * dragged onto the page, a question with its key, a colour in «Оформление», «Посмотреть как участник». The tour is the
 * first-use tip of the studio (once per user): no second card comes after it.
 * Its file comes with the tour; the frame keeps its size meanwhile, so the card is placed once.
 */
export default function TourClip() {
  const Clip = useLazyPart(stepClipPart, true, {
    onError: (error) => console.error('Ролик студии не загрузился:', error),
  });
  return <div className="st-tour-clip">{Clip ? <Clip id="studioTour" active /> : <StepClipPlaceholder />}</div>;
}
