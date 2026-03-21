import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Canvas, FabricImage, FabricText, Rect } from 'fabric';
import Header from '../components/Header';
import { saveFabricTemplate, getFabricTemplateById } from '../data/fabricTemplatesStorage';
import { ID_CARD_TEMPLATES } from '../data/idCardTemplates';

const CANVAS_WIDTH = 506;
const CANVAS_HEIGHT = 319;

export default function TemplateEditor() {
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const fabricCanvasRef = useRef(null);
  const [templateName, setTemplateName] = useState('My Template');
  const [backgroundUrl, setBackgroundUrl] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = new Canvas(canvasRef.current, {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
    });
    fabricCanvasRef.current = canvas;
    return () => {
      canvas.dispose();
      fabricCanvasRef.current = null;
    };
  }, []);

  const addTextField = (label, dataField, top = 120) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const text = new FabricText(label, {
      left: 180,
      top,
      fontSize: 22,
      fill: '#000000',
    });
    text.set('customType', 'text');
    text.set('dataField', dataField);
    canvas.add(text);
    canvas.requestRenderAll();
  };

  const addPhotoPlaceholder = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const rect = new Rect({
      left: 30,
      top: 80,
      width: 120,
      height: 150,
      fill: 'transparent',
      stroke: '#333',
      strokeDashArray: [8, 8],
    });
    rect.set('customType', 'photo');
    canvas.add(rect);
    canvas.requestRenderAll();
  };

  const addQRPlaceholder = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const rect = new Rect({
      left: 380,
      top: 220,
      width: 80,
      height: 80,
      fill: '#f0f0f0',
      stroke: '#666',
      strokeDashArray: [5, 5],
    });
    rect.set('customType', 'qr');
    canvas.add(rect);
    canvas.requestRenderAll();
  };

  const loadBackground = (url) => {
    if (!url) return;
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    FabricImage.fromURL(url).then((img) => {
      img.scaleToWidth(CANVAS_WIDTH);
      img.scaleToHeight(CANVAS_HEIGHT);
      canvas.backgroundImage = img;
      canvas.requestRenderAll();
    }).catch(() => {});
  };

  const handleBackgroundSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file?.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setBackgroundUrl(url);
    loadBackground(url);
  };

  const loadTemplateImage = (templateId) => {
    const t = ID_CARD_TEMPLATES.find((x) => x.id === templateId);
    if (t?.image) {
      setBackgroundUrl(t.image);
      loadBackground(t.image);
    }
  };

  const urlToDataURL = (url) => {
    if (!url || url.startsWith('data:')) return Promise.resolve(url);
    return fetch(url)
      .then((r) => r.blob())
      .then((blob) => new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(blob);
      }));
  };

  const handleSave = async () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const json = canvas.toJSON();
    const objects = canvas.getObjects();
    if (json.objects && objects.length === json.objects.length) {
      json.objects = json.objects.map((obj, i) => ({
        ...obj,
        customType: objects[i].customType,
        dataField: objects[i].dataField,
      }));
    }
    let backgroundDataUrl = backgroundUrl && backgroundUrl.startsWith('data:') ? backgroundUrl : null;
    if (!backgroundDataUrl && backgroundUrl) {
      try {
        backgroundDataUrl = await urlToDataURL(backgroundUrl);
      } catch (_) {}
    }
    saveFabricTemplate({
      name: templateName.trim() || 'Untitled Template',
      json,
      backgroundDataUrl,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <>
      <Header title="Template Editor" showBack backTo="/dashboard" />
      <p className="text-muted" style={{ marginBottom: 16 }}>
        Add text, photo placeholder, QR placeholder. Drag to move, resize as needed. Set background then Save.
      </p>

      <div className="template-editor-layout">
        <div className="template-editor-toolbar card">
          <div className="template-editor-toolrow">
            <label className="input-label">Template name</label>
            <input
              type="text"
              className="input-field"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Template name"
            />
          </div>
          <div className="template-editor-toolrow">
            <label className="input-label">Background</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <label className="btn btn-secondary" style={{ marginBottom: 0, cursor: 'pointer' }}>
                Upload image
                <input type="file" accept="image/*" onChange={handleBackgroundSelect} style={{ display: 'none' }} />
              </label>
              <select
                className="input-field"
                style={{ width: 'auto', minWidth: 160 }}
                onChange={(e) => loadTemplateImage(e.target.value)}
                value=""
              >
                <option value="">Or pick template image</option>
                {ID_CARD_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="template-editor-toolrow">
            <span className="input-label">Add elements</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" onClick={() => addTextField('Student Name', 'name', 100)}>Text (Name)</button>
              <button type="button" className="btn btn-secondary" onClick={() => addTextField('Student ID', 'studentId', 140)}>Text (ID)</button>
              <button type="button" className="btn btn-secondary" onClick={() => addTextField('Class', 'className', 180)}>Text (Class)</button>
              <button type="button" className="btn btn-secondary" onClick={() => addTextField('School', 'schoolName', 220)}>Text (School)</button>
              <button type="button" className="btn btn-secondary" onClick={addPhotoPlaceholder}>Photo placeholder</button>
              <button type="button" className="btn btn-secondary" onClick={addQRPlaceholder}>QR placeholder</button>
            </div>
          </div>
          <div className="template-editor-toolrow">
            <button type="button" className="btn btn-primary" onClick={handleSave}>
              {saved ? 'Saved!' : 'Save template'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/dashboard')}>
              Done
            </button>
          </div>
        </div>

        <div className="template-editor-canvas-wrap card">
          <div className="template-editor-canvas-inner">
            <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} />
          </div>
        </div>
      </div>
    </>
  );
}
