import React, { useEffect, useRef, useState } from 'react';
import { Canvas, FabricImage } from 'fabric';
import QRCode from 'qrcode';

const CANVAS_WIDTH = 506;
const CANVAS_HEIGHT = 319;

export default function FabricIdCardGenerator({
  templateJson,
  backgroundDataUrl,
  studentData = {},
  onReady,
}) {
  const canvasRef = useRef(null);
  const fabricCanvasRef = useRef(null);
  const [ready, setReady] = useState(false);

  const { name, studentId, className, schoolName, studentImage } = studentData;

  useEffect(() => {
    if (!canvasRef.current || !templateJson) return;
    const canvas = new Canvas(canvasRef.current, {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
    });
    fabricCanvasRef.current = canvas;
    setReady(false);

    const run = async () => {
      if (backgroundDataUrl) {
        try {
          const bgImg = await FabricImage.fromURL(backgroundDataUrl);
          bgImg.scaleToWidth(CANVAS_WIDTH);
          bgImg.scaleToHeight(CANVAS_HEIGHT);
          canvas.backgroundImage = bgImg;
        } catch (_) {}
      }
      await canvas.loadFromJSON(templateJson, (obj, fabricObj) => {
        if (obj.customType) fabricObj.set('customType', obj.customType);
        if (obj.dataField) fabricObj.set('dataField', obj.dataField);
      });
      canvas.requestRenderAll();

      const objects = canvas.getObjects();
      const toRemove = [];
      for (let i = 0; i < objects.length; i++) {
        const obj = objects[i];
        const customType = obj.customType;
        const dataField = obj.dataField;

        if (obj.type === 'text' && dataField && studentData[dataField] != null) {
          obj.set('text', String(studentData[dataField]));
        }

        if (customType === 'photo') {
          toRemove.push(obj);
          if (studentImage) {
            try {
              const img = await FabricImage.fromURL(studentImage);
              const w = obj.width * (obj.scaleX || 1);
              const h = obj.height * (obj.scaleY || 1);
              img.set({ left: obj.left, top: obj.top });
              img.scaleToWidth(w);
              if (img.height * img.scaleY > h) img.scaleToHeight(h);
              canvas.add(img);
            } catch (_) {}
          }
        }

        if (customType === 'qr') {
          toRemove.push(obj);
          const qrText = studentId || name || 'ID';
          try {
            const qrDataUrl = await QRCode.toDataURL(qrText, { width: 200, margin: 1 });
            const img = await FabricImage.fromURL(qrDataUrl);
            const w = obj.width * (obj.scaleX || 1);
            const h = obj.height * (obj.scaleY || 1);
            img.set({ left: obj.left, top: obj.top });
            img.scaleToWidth(w);
            if (img.height * img.scaleY > h) img.scaleToHeight(h);
            canvas.add(img);
          } catch (_) {}
        }
      }
      toRemove.forEach((o) => canvas.remove(o));
      canvas.requestRenderAll();
      setReady(true);
      onReady?.(canvas);
    };

    run();
    return () => {
      canvas.dispose();
      fabricCanvasRef.current = null;
    };
  }, [templateJson, backgroundDataUrl]);

  useEffect(() => {
    if (!ready || !fabricCanvasRef.current) return;
    const canvas = fabricCanvasRef.current;
    const objects = canvas.getObjects();
    objects.forEach((obj) => {
      if (obj.type === 'text' && obj.dataField && studentData[obj.dataField] != null) {
        obj.set('text', String(studentData[obj.dataField]));
      }
    });
    canvas.requestRenderAll();
  }, [ready, name, studentId, className, schoolName]);

  return (
    <div className="fabric-idcard-generator">
      <div className="fabric-idcard-canvas-wrap">
        <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} />
      </div>
    </div>
  );
}

export function exportFabricCanvasToPNG(canvas) {
  if (!canvas) return null;
  return canvas.toDataURL({ format: 'png', quality: 1 });
}
