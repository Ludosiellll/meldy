import { useState, useCallback, useId } from 'react';
import Cropper from 'react-easy-crop';
import { X, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import getCroppedImg from '../utils/cropImage';

interface ImageCropperProps {
  imageSrc: string;
  onCropComplete: (croppedFile: File) => void;
  onClose: () => void;
}

/** Обрезка фото профиля (Meldy 2026-10-04): белая карточка на затемнении, синяя пилюля «Применить». */
export default function ImageCropper({ imageSrc, onCropComplete, onClose }: ImageCropperProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const titleId = useId();
  const zoomId = useId();

  const handleCropComplete = useCallback((_croppedArea: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleSave = async () => {
    if (!croppedAreaPixels) return;
    setIsProcessing(true);
    try {
      const croppedFile = await getCroppedImg(imageSrc, croppedAreaPixels);
      if (croppedFile) {
        onCropComplete(croppedFile);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="ac-modal ac-modal--top">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="ac-modal-dim"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="ac-modal-card ac-crop"
        >
          <div className="ac-crop-head">
            <h3 id={titleId} className="ac-modal-h">Обрезка фото</h3>
            <button type="button" onClick={onClose} aria-label="Закрыть" className="ac-modal-x ac-crop-x">
              <X aria-hidden="true" />
            </button>
          </div>

          <div className="ac-crop-stage">
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onCropComplete={handleCropComplete}
              onZoomChange={setZoom}
            />
          </div>

          <div className="ac-crop-foot">
            <div className="ac-crop-zoom">
              <label htmlFor={zoomId} className="ac-crop-label">Масштаб</label>
              <input
                id={zoomId}
                type="range"
                value={zoom}
                min={1}
                max={3}
                step={0.1}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="ac-range"
              />
            </div>
            <button type="button" onClick={handleSave} disabled={isProcessing} className="ac-modal-ok ac-crop-ok">
              {isProcessing ? (
                <span className="ac-ring ac-ring--light" aria-hidden="true" />
              ) : (
                <>
                  <Check aria-hidden="true" />
                  Применить
                </>
              )}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
