import {
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type ImagePreviewModalProps = {
  images: string[];
  initialIndex: number;
  onClose: () => void;
};

function normalizeIndex(index: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return ((index % total) + total) % total;
}

export function ImagePreviewModal({
  images,
  initialIndex,
  onClose,
}: ImagePreviewModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(() =>
    normalizeIndex(initialIndex, images.length),
  );

  useEffect(() => {
    setCurrentIndex(normalizeIndex(initialIndex, images.length));
  }, [images.length, initialIndex]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (images.length <= 1) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setCurrentIndex((index) => normalizeIndex(index - 1, images.length));
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setCurrentIndex((index) => normalizeIndex(index + 1, images.length));
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [images.length, onClose]);

  if (images.length === 0) {
    return null;
  }

  const showNavigation = images.length > 1;
  const currentImage = images[currentIndex] ?? images[0];
  const modalContent = (
    <div
      aria-label="图片预览"
      aria-modal="true"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-xl dark:bg-black/60"
      onClick={onClose}
      ref={dialogRef}
      role="dialog"
      tabIndex={-1}
    >
      <div
        className="relative flex h-full w-full items-center justify-center"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          aria-label="关闭图片预览"
          className="absolute top-6 right-6 z-50 cursor-pointer rounded-full bg-white/10 p-3 text-white backdrop-blur-md transition-all hover:bg-white/20"
          onClick={onClose}
          type="button"
        >
          <X className="h-7 w-7" />
        </button>

        {showNavigation ? (
          <button
            aria-label="上一张图片"
            className="absolute left-6 top-1/2 z-50 -translate-y-1/2 cursor-pointer rounded-full bg-white/10 p-4 text-white backdrop-blur-md transition-all hover:bg-white/20"
            onClick={() =>
              setCurrentIndex((index) => normalizeIndex(index - 1, images.length))
            }
            type="button"
          >
            <ChevronLeft className="h-7 w-7" />
          </button>
        ) : null}

        <img
          alt={`预览图片 ${currentIndex + 1}`}
          className="max-w-[90vw] max-h-[85vh] object-contain drop-shadow-2xl select-none"
          draggable={false}
          src={currentImage}
        />

        {showNavigation ? (
          <button
            aria-label="下一张图片"
            className="absolute right-6 top-1/2 z-50 -translate-y-1/2 cursor-pointer rounded-full bg-white/10 p-4 text-white backdrop-blur-md transition-all hover:bg-white/20"
            onClick={() =>
              setCurrentIndex((index) => normalizeIndex(index + 1, images.length))
            }
            type="button"
          >
            <ChevronRight className="h-7 w-7" />
          </button>
        ) : null}

        <div className="absolute bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-full bg-black/50 px-4 py-2 text-sm tracking-widest text-white/90 backdrop-blur-md">
          {currentIndex + 1} / {images.length}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
