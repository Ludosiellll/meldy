import { useLazyPart } from '../../lib/lazyPart';
import { stepClipPart } from './clipPart';
import StepClipPlaceholder from './Placeholder';
import './stepClip.css';

/**
 * The studio's first-visit tour (components/studio/Tour.tsx) opens with the clip «Свой тест» in its first step: «Новый
 * тест», «Заголовок» dragged onto the page, a question with its key, a colour in «Оформление», «Посмотреть как
 * участник». The tour is the first-use tip of the studio (once per user on the device): no second card comes after it.
 * Its file comes with the tour; the frame keeps its size meanwhile, so the card is placed once.
 */
export default function TourClip() {
  const Clip = useLazyPart(stepClipPart, true, {
    onError: (error) => console.error('Ролик студии не загрузился:', error),
  });
  return <div className="st-tour-clip">{Clip ? <Clip id="studio" active /> : <StepClipPlaceholder />}</div>;
}
