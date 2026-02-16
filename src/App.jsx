import { useEffect, useMemo, useRef, useState } from "react";

const MM_TO_PX = 3.7795275591;
const A4 = { width: 210, height: 297 };
const CROP_KEY = "multiPrinter.cropPositions.v1";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const toPx = (mm) => Math.round(mm * MM_TO_PX);
const byName = (a, b) => a.name.localeCompare(b.name, "pl", { numeric: true, sensitivity: "base" });
const defaultCrop = () => ({ x: 50, y: 50, zoom: 100, rotation: 0 });

const PRESETS = {
  none: { brightness: 100, contrast: 100, saturation: 100, sepia: 0, grayscale: 0, hue: 0, blur: 0 },
  auto: { brightness: 104, contrast: 108, saturation: 112, sepia: 0, grayscale: 0, hue: 0, blur: 0 },
  portrait: { brightness: 103, contrast: 104, saturation: 106, sepia: 16, grayscale: 0, hue: -8, blur: 0 },
  landscape: { brightness: 102, contrast: 114, saturation: 125, sepia: 0, grayscale: 0, hue: -3, blur: 0 },
  bw: { brightness: 102, contrast: 118, saturation: 40, sepia: 0, grayscale: 100, hue: 0, blur: 0 },
  vintage: { brightness: 96, contrast: 92, saturation: 86, sepia: 35, grayscale: 10, hue: -6, blur: 0.2 },
};

const FILTER_PRESET_LABELS = {
  none: "Brak",
  auto: "Auto poprawa",
  portrait: "Portret (cieplejszy)",
  landscape: "Krajobraz (zywszy)",
  bw: "Czarno-bialy",
  vintage: "Vintage",
  custom: "Wlasny (reczny)",
};

const filterCss = (f) => [
  `brightness(${f.brightness}%)`,
  `contrast(${f.contrast}%)`,
  `saturate(${f.saturation}%)`,
  `sepia(${f.sepia}%)`,
  `grayscale(${f.grayscale}%)`,
  `hue-rotate(${f.hue}deg)`,
  `blur(${f.blur}px)`,
].join(" ");

function chooseGrid(count, widthMm, heightMm) {
  let best = null;
  for (let cols = 1; cols <= count; cols += 1) {
    const rows = Math.ceil(count / cols);
    const cellW = widthMm / cols;
    const cellH = heightMm / rows;
    const score = Math.abs(Math.log((cellW / cellH) / (3 / 2))) + (rows * cols - count) * 0.08;
    if (!best || score < best.score) best = { cols, rows, score };
  }
  return { cols: best.cols, rows: best.rows };
}

function layoutFromTemplate(template, photosPerPage, contentW, contentH) {
  const grid = (cols, rows) => {
    const cells = [];
    for (let r = 1; r <= rows; r += 1) for (let c = 1; c <= cols; c += 1) cells.push({ col: c, row: r, colSpan: 1, rowSpan: 1 });
    return { cols, rows, cells };
  };
  if (template === "grid4") return { label: "2 x 2 (4)", photosPerPage: 4, ...grid(2, 2) };
  if (template === "grid6") return { label: "3 x 2 (6)", photosPerPage: 6, ...grid(3, 2) };
  if (template === "hero5") {
    return {
      label: "1 duze + 4 male (5)",
      photosPerPage: 5,
      cols: 3,
      rows: 4,
      cells: [
        { col: 1, row: 1, colSpan: 2, rowSpan: 4 },
        { col: 3, row: 1, colSpan: 1, rowSpan: 1 },
        { col: 3, row: 2, colSpan: 1, rowSpan: 1 },
        { col: 3, row: 3, colSpan: 1, rowSpan: 1 },
        { col: 3, row: 4, colSpan: 1, rowSpan: 1 },
      ],
    };
  }
  const auto = chooseGrid(photosPerPage, contentW, contentH);
  return { label: `Auto (${auto.cols} x ${auto.rows})`, photosPerPage, ...grid(auto.cols, auto.rows) };
}

function NumberField({ id, label, ...props }) {
  const className = "w-full rounded-[10px] border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-teal-700 focus:ring-2 focus:ring-emerald-200";
  return (
    <div className="mb-2.5">
      <label htmlFor={id} className="mb-1.5 block text-[0.88rem] font-semibold text-slate-800">{label}</label>
      <input id={id} type="number" className={className} {...props} />
    </div>
  );
}

function SelectField({ id, label, children, ...props }) {
  const className = "w-full rounded-[10px] border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-teal-700 focus:ring-2 focus:ring-emerald-200";
  return (
    <div className="mb-2.5">
      <label htmlFor={id} className="mb-1.5 block text-[0.88rem] font-semibold text-slate-800">{label}</label>
      <select id={id} className={className} {...props}>
        {children}
      </select>
    </div>
  );
}

export default function App() {
  const inputClass = "w-full rounded-[10px] border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-teal-700 focus:ring-2 focus:ring-emerald-200";
  const btnClass = "rounded-[10px] border border-slate-300 bg-white px-3 py-2 text-sm transition hover:-translate-y-px hover:shadow";
  const sectionClass = "mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3";

  const [images, setImages] = useState([]);
  const [folderStatus, setFolderStatus] = useState("Nie wybrano folderu");
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState("");
  const [previewW, setPreviewW] = useState(0);

  const [cropMap, setCropMap] = useState(() => {
    try { return JSON.parse(localStorage.getItem(CROP_KEY) || "{}"); } catch { return {}; }
  });

  const [opt, setOpt] = useState({
    photosPerPage: 6,
    orientation: "portrait",
    marginMm: 8,
    gapMm: 3,
    layoutTemplate: "auto",
    fitMode: "cover",
    barFillMode: "white",
    showLabels: "no",
    showSeparators: "yes",
    filterPreset: "none",
    brightness: 100,
    contrast: 100,
    saturation: 100,
    sepia: 0,
    grayscale: 0,
    hue: 0,
    blur: 0,
    nudgeStep: 2,
  });

  const urlsRef = useRef([]);
  const pagesRef = useRef(null);
  const dragRef = useRef(null);

  const forcedPerPage = opt.layoutTemplate === "grid4" ? 4 : opt.layoutTemplate === "grid6" ? 6 : opt.layoutTemplate === "hero5" ? 5 : null;
  const perPage = clamp(forcedPerPage ?? Number(opt.photosPerPage || 1), 1, 64);
  const marginMm = clamp(Number(opt.marginMm || 0), 0, 40);
  const gapMm = clamp(Number(opt.gapMm || 0), 0, 20);
  const nudgeStep = clamp(Number(opt.nudgeStep || 2), 0.5, 20);
  const filters = {
    brightness: clamp(Number(opt.brightness || 100), 50, 170),
    contrast: clamp(Number(opt.contrast || 100), 50, 170),
    saturation: clamp(Number(opt.saturation || 100), 0, 220),
    sepia: clamp(Number(opt.sepia || 0), 0, 100),
    grayscale: clamp(Number(opt.grayscale || 0), 0, 100),
    hue: clamp(Number(opt.hue || 0), -180, 180),
    blur: clamp(Number(opt.blur || 0), 0, 4),
  };

  const pageMm = opt.orientation === "landscape" ? { width: A4.height, height: A4.width } : { width: A4.width, height: A4.height };
  const contentW = Math.max(10, pageMm.width - marginMm * 2);
  const contentH = Math.max(10, pageMm.height - marginMm * 2);
  const tooBigMargin = marginMm * 2 >= Math.min(pageMm.width, pageMm.height);
  const layout = useMemo(() => layoutFromTemplate(opt.layoutTemplate, perPage, contentW, contentH), [contentH, contentW, opt.layoutTemplate, perPage]);
  const chunks = useMemo(() => {
    const out = [];
    for (let i = 0; i < images.length; i += layout.photosPerPage) out.push(images.slice(i, i + layout.photosPerPage));
    return out;
  }, [images, layout.photosPerPage]);

  const pageWpx = toPx(pageMm.width);
  const pageHpx = toPx(pageMm.height);
  const scale = clamp(previewW > 0 ? Math.min(1, (previewW - 8) / pageWpx) : 1, 0.35, 1);

  useEffect(() => {
    setError(tooBigMargin ? "Margines jest zbyt duzy dla formatu A4. Zmniejsz wartosc." : "");
  }, [tooBigMargin]);

  useEffect(() => {
    const el = pagesRef.current;
    if (!el) return;
    const update = () => setPreviewW(el.clientWidth || 0);
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(CROP_KEY, JSON.stringify(cropMap)); } catch { /* noop */ }
    }, 120);
    return () => clearTimeout(t);
  }, [cropMap]);

  useEffect(() => () => {
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const selectedCrop = selectedId ? (cropMap[selectedId] || defaultCrop()) : null;
  const selectedName = images.find((x) => x.id === selectedId)?.name || "";
  const selectedText = selectedCrop
    ? `${selectedName} | X: ${selectedCrop.x.toFixed(1)}% | Y: ${selectedCrop.y.toFixed(1)}% | Zoom: ${Math.round(selectedCrop.zoom)}% | Rot: ${selectedCrop.rotation}deg`
    : "Kliknij zdjecie w podgladzie, aby je wybrac.";

  const setCrop = (id, patch) => {
    setCropMap((prev) => {
      const cur = prev[id] || defaultCrop();
      return {
        ...prev,
        [id]: {
          x: clamp(patch.x ?? cur.x, 0, 100),
          y: clamp(patch.y ?? cur.y, 0, 100),
          zoom: clamp(patch.zoom ?? cur.zoom, 50, 250),
          rotation: ((patch.rotation ?? cur.rotation) % 360 + 360) % 360,
        },
      };
    });
  };

  const nudge = (dx, dy) => {
    if (!selectedId) return;
    const cur = cropMap[selectedId] || defaultCrop();
    setCrop(selectedId, { x: cur.x + dx * nudgeStep, y: cur.y + dy * nudgeStep });
  };

  const handleFiles = (e) => {
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current = [];
    const files = Array.from(e.target.files || []);
    if (!files.length) {
      setImages([]);
      setFolderStatus("Nie wybrano folderu");
      setSelectedId(null);
      return;
    }
    const list = files.filter((f) => f.type.startsWith("image/")).sort(byName).map((file, i) => {
      const url = URL.createObjectURL(file);
      urlsRef.current.push(url);
      return { id: file.webkitRelativePath || `${file.name}-${i}`, name: file.name, url };
    });
    setImages(list);
    const folderName = (files[0].webkitRelativePath || files[0].name || "").split("/")[0] || "Folder";
    setFolderStatus(`${folderName} • zdjec: ${list.length}`);
    if (selectedId && !list.some((x) => x.id === selectedId)) setSelectedId(null);
  };

  const resetFilters = () => {
    const p = PRESETS.none;
    setOpt((prev) => ({ ...prev, filterPreset: "none", ...p }));
  };

  const applyPreset = (preset) => {
    const p = PRESETS[preset];
    setOpt((prev) => ({ ...prev, filterPreset: preset, ...(p || {}) }));
  };

  const handlePrint = async () => {
    const styleId = "dynamic-print-page-size";
    document.getElementById(styleId)?.remove();
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `@media print { @page { size: A4 ${opt.orientation}; margin: 0; } }`;
    document.head.appendChild(style);

    const imgs = Array.from(pagesRef.current?.querySelectorAll("img") || []);
    await Promise.all(imgs.map((img) => (img.decode ? img.decode().catch(() => undefined) : Promise.resolve())));
    window.print();
  };

  const barClass = opt.barFillMode === "black" ? "bg-zinc-900" : opt.barFillMode === "blur" ? "bg-slate-800" : "bg-white";

  return (
    <div className="mx-auto grid max-w-[1600px] gap-5 p-5 xl:grid-cols-[360px_minmax(0,1fr)] print:block print:p-0">
      <aside className="sticky top-3 h-fit max-h-[calc(100vh-28px)] overflow-y-auto rounded-[14px] border border-slate-300 bg-white p-4 print:hidden">
        <h1 className="mb-1 text-xl">Edycja zdjecia</h1>
        <p className="mb-3 text-sm text-slate-500">Zaznacz zdjecie i dopasuj kadr, zoom oraz obrot.</p>
        <section className={sectionClass}>
          <p className="mb-2 text-sm font-bold">Precyzyjne kadrowanie</p>
          <p className="mb-2 min-h-[2.5em] text-xs text-slate-500">{selectedText}</p>
          <div className="mb-2 grid grid-cols-3 gap-2">
            <button className={`${btnClass} col-start-2`} disabled={!selectedCrop} onClick={() => nudge(0, 1)}>↑</button>
            <button className={btnClass} disabled={!selectedCrop} onClick={() => nudge(-1, 0)}>←</button>
            <button className={btnClass} disabled={!selectedCrop} onClick={() => nudge(0, -1)}>↓</button>
            <button className={btnClass} disabled={!selectedCrop} onClick={() => nudge(1, 0)}>→</button>
          </div>
          <label className="mb-1 block text-xs">Krok przesuniecia (%)</label>
          <input className={inputClass} type="number" min="0.5" max="20" step="0.5" value={opt.nudgeStep} onChange={(e) => setOpt((p) => ({ ...p, nudgeStep: e.target.value }))} />
          <div className="mt-2 grid grid-cols-[1fr_90px] gap-2">
            <label className="self-center text-xs">Zoom (%)</label>
            <input className={inputClass} type="number" min="50" max="250" value={selectedCrop ? Math.round(selectedCrop.zoom) : 100} disabled={!selectedCrop} onChange={(e) => selectedId && setCrop(selectedId, { zoom: Number(e.target.value) })} />
          </div>
          <input className="mt-2 w-full" type="range" min="50" max="250" value={selectedCrop ? Math.round(selectedCrop.zoom) : 100} disabled={!selectedCrop} onChange={(e) => selectedId && setCrop(selectedId, { zoom: Number(e.target.value) })} />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button className={btnClass} disabled={!selectedCrop} onClick={() => selectedId && setCrop(selectedId, { rotation: (selectedCrop.rotation || 0) - 90 })}>Obroc -90deg</button>
            <button className={btnClass} disabled={!selectedCrop} onClick={() => selectedId && setCrop(selectedId, { rotation: (selectedCrop.rotation || 0) + 90 })}>Obroc +90deg</button>
          </div>
        </section>
      </aside>

      <main className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_340px] print:block">
        <section className="rounded-[14px] border border-slate-300 bg-white p-4 print:border-0 print:p-0">
          <div className="mb-3 flex items-baseline justify-between print:hidden">
            <h2 className="text-lg">Podglad stron A4</h2>
            <p className="text-sm text-slate-500">Sprawdz uklad i uzyj "Drukuj / PDF".</p>
          </div>
          <section ref={pagesRef} className="grid justify-center gap-4 overflow-x-auto print:block print:overflow-visible">
            {!images.length && <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">Brak zaladowanych zdjec.</div>}
            {!tooBigMargin && chunks.map((group, pageIndex) => (
              <div key={`page-${pageIndex}`} className="sheet-frame relative overflow-hidden" style={{ width: Math.round(pageWpx * scale), height: Math.round(pageHpx * scale) }}>
                <article className="sheet relative border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.12)] print:border-0 print:shadow-none" style={{ width: pageWpx, height: pageHpx, transform: scale < 0.999 ? `scale(${scale})` : "none", transformOrigin: "top left" }}>
                  <div className="absolute left-2 top-1 rounded-full border border-slate-200 bg-white/90 px-2 py-0.5 text-xs text-slate-500 print:hidden">Strona {pageIndex + 1}</div>
                  <div className="absolute inset-0 grid bg-white" style={{ padding: toPx(marginMm), gap: toPx(gapMm), gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))` }}>
                    {layout.cells.map((cell, i) => {
                      const item = group[i];
                      const crop = item ? (cropMap[item.id] || defaultCrop()) : null;
                      return (
                        <div
                          key={`${pageIndex}-${i}`}
                          className={`relative min-h-0 min-w-0 overflow-hidden ${barClass} ${item ? "cursor-grab" : ""} ${selectedId === item?.id ? "shadow-[inset_0_0_0_3px_#0f766e]" : ""}`}
                          style={{ gridColumn: `${cell.col} / span ${cell.colSpan}`, gridRow: `${cell.row} / span ${cell.rowSpan}`, border: opt.showSeparators === "yes" ? "1px solid #000" : "0" }}
                          onClick={() => item && setSelectedId(item.id)}
                          onPointerDown={(e) => {
                            if (!item || e.button !== 0) return;
                            setSelectedId(item.id);
                            dragRef.current = { id: item.id, x: e.clientX, y: e.clientY, sx: crop.x, sy: crop.y };
                            e.currentTarget.setPointerCapture(e.pointerId);
                          }}
                          onPointerMove={(e) => {
                            const d = dragRef.current;
                            if (!item || !d || d.id !== item.id) return;
                            const rect = e.currentTarget.getBoundingClientRect();
                            setCrop(item.id, { x: d.sx + ((e.clientX - d.x) / rect.width) * 100, y: d.sy + ((e.clientY - d.y) / rect.height) * 100 });
                          }}
                          onPointerUp={(e) => {
                            if (dragRef.current?.id === item?.id) {
                              dragRef.current = null;
                              if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                            }
                          }}
                          onDoubleClick={() => item && setCrop(item.id, defaultCrop())}
                        >
                          {item && opt.fitMode === "contain" && opt.barFillMode === "blur" && (
                            <div className="photo-bg absolute inset-0 overflow-hidden">
                              <img src={item.url} alt="" aria-hidden="true" className="h-full w-full object-cover opacity-80 blur-[12px]" style={{ transform: "scale(1.15)" }} />
                              <div className="absolute inset-0 bg-slate-900/20" />
                            </div>
                          )}
                          {item && (
                            <img
                              src={item.url}
                              alt={item.name}
                              draggable={false}
                              className={`absolute inset-0 h-full w-full ${opt.fitMode === "contain" ? "object-contain bg-slate-50" : "object-cover"}`}
                              style={{
                                filter: filterCss(filters),
                                objectPosition: `${crop.x}% ${crop.y}%`,
                                transform: `translate(${(50 - crop.x) / 2}%, ${(50 - crop.y) / 2}%) scale(${crop.zoom / 100}) rotate(${crop.rotation}deg)`,
                                transformOrigin: "center center",
                              }}
                            />
                          )}
                          {item && opt.showLabels === "yes" && <span className="absolute bottom-1 right-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-[11px] text-white print:hidden">{pageIndex * layout.photosPerPage + i + 1}</span>}
                        </div>
                      );
                    })}
                  </div>
                </article>
              </div>
            ))}
          </section>
        </section>

        <aside className="sticky top-3 max-h-[calc(100vh-28px)] overflow-y-auto rounded-[14px] border border-slate-300 bg-white p-4 print:hidden">
          <h1 className="mb-1 text-xl">Ustawienia ukladu</h1>
          <p className="mb-3 text-sm text-slate-500">Wybierz folder, uklad i parametry wydruku.</p>

          <section className={sectionClass}>
            <label className="mb-1.5 block text-[0.88rem] font-semibold text-slate-800">Folder ze zdjeciami</label>
            <div className="flex min-h-[52px] items-center gap-2 rounded-[10px] border border-slate-300 bg-white px-2 py-2">
              <input
                id="folderInput"
                type="file"
                className="sr-only"
                multiple
                accept="image/*"
                ref={(el) => {
                  if (!el) return;
                  el.setAttribute("webkitdirectory", "");
                  el.setAttribute("directory", "");
                }}
                onChange={handleFiles}
              />
              <label htmlFor="folderInput" className="cursor-pointer rounded-lg border border-slate-300 bg-sky-50 px-3 py-2 text-sm font-semibold">Wybierz folder</label>
              <span className="truncate text-sm text-slate-500">{folderStatus}</span>
            </div>
          </section>

          <section className={sectionClass}>
            <div className="grid grid-cols-2 gap-2">
              <NumberField id="photosPerPage" label="Zdjec na strone" min="1" max="64" disabled={Boolean(forcedPerPage)} value={forcedPerPage || opt.photosPerPage} onChange={(e) => setOpt((p) => ({ ...p, photosPerPage: e.target.value }))} />
              <SelectField id="orientation" label="Orientacja A4" value={opt.orientation} onChange={(e) => setOpt((p) => ({ ...p, orientation: e.target.value }))}>
                <option value="portrait">Pionowa</option>
                <option value="landscape">Pozioma</option>
              </SelectField>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberField id="marginMm" label="Margines (mm)" min="0" max="40" value={opt.marginMm} onChange={(e) => setOpt((p) => ({ ...p, marginMm: e.target.value }))} />
              <NumberField id="gapMm" label="Odstep (mm)" min="0" max="20" value={opt.gapMm} onChange={(e) => setOpt((p) => ({ ...p, gapMm: e.target.value }))} />
            </div>
            <SelectField id="layoutTemplate" label="Szablon ukladu" value={opt.layoutTemplate} onChange={(e) => setOpt((p) => ({ ...p, layoutTemplate: e.target.value }))}>
              <option value="auto">Auto (siatka)</option>
              <option value="grid4">2 x 2 (4 zdjecia)</option>
              <option value="grid6">3 x 2 (6 zdjec)</option>
              <option value="hero5">1 duze + 4 male (5 zdjec)</option>
            </SelectField>
            <SelectField id="fitMode" label="Dopasowanie zdjecia" value={opt.fitMode} onChange={(e) => setOpt((p) => ({ ...p, fitMode: e.target.value }))}>
              <option value="cover">Wypelnij (przytnij)</option>
              <option value="contain">Cale zdjecie (paski)</option>
            </SelectField>
            <SelectField id="barFillMode" label="Wypelnienie paskow" value={opt.barFillMode} onChange={(e) => setOpt((p) => ({ ...p, barFillMode: e.target.value }))}>
              <option value="white">Biale</option>
              <option value="blur">Rozmyte tlo</option>
              <option value="black">Czarne</option>
            </SelectField>
            <SelectField id="preset" label="Filtr zdjec (preset)" value={opt.filterPreset} onChange={(e) => applyPreset(e.target.value)}>
              <option value="none">Brak</option>
              <option value="auto">Auto poprawa</option>
              <option value="portrait">Portret (cieplejszy)</option>
              <option value="landscape">Krajobraz (zywszy)</option>
              <option value="bw">Czarno-bialy</option>
              <option value="vintage">Vintage</option>
            </SelectField>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["brightness", "Jasnosc", 50, 170, 1],
                ["contrast", "Kontrast", 50, 170, 1],
                ["saturation", "Nasycenie", 0, 220, 1],
                ["sepia", "Sepia", 0, 100, 1],
                ["grayscale", "Czarno-bialy", 0, 100, 1],
                ["hue", "Barwa", -180, 180, 1],
                ["blur", "Rozmycie", 0, 4, 0.1],
              ].map(([k, label, min, max, step]) => (
                <NumberField key={k} id={`f-${k}`} label={label} min={min} max={max} step={step} value={opt[k]} onChange={(e) => setOpt((p) => ({ ...p, filterPreset: "custom", [k]: e.target.value }))} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button className={btnClass} onClick={resetFilters}>Reset filtrow</button>
              <button className={btnClass} onClick={() => images.forEach((img) => setCrop(img.id, defaultCrop()))}>Reset kadrowania</button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <SelectField id="showLabels" label="Numeracja komorek" value={opt.showLabels} onChange={(e) => setOpt((p) => ({ ...p, showLabels: e.target.value }))}>
                <option value="no">Nie</option>
                <option value="yes">Tak</option>
              </SelectField>
              <SelectField id="showSeparators" label="Linie miedzy zdjeciami" value={opt.showSeparators} onChange={(e) => setOpt((p) => ({ ...p, showSeparators: e.target.value }))}>
                <option value="yes">Tak</option>
                <option value="no">Nie</option>
              </SelectField>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button className={btnClass} onClick={() => setOpt((p) => ({ ...p }))}>Odswiez uklad</button>
              <button className="rounded-[10px] border border-teal-700 bg-teal-700 px-3 py-2 text-sm text-white disabled:opacity-50" disabled={!images.length || Boolean(error)} onClick={handlePrint}>Drukuj / PDF</button>
            </div>
          </section>

          <section className={sectionClass}>
            <p className="mb-2 text-sm font-bold uppercase text-slate-600">Podsumowanie</p>
            <div className="rounded-[10px] border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {!images.length && "Brak zaladowanych zdjec. Wybierz folder, aby rozpoczac."}
              {!!images.length && (
                <>
                  <div><strong>Zdjecia:</strong> {images.length}</div>
                  <div><strong>Kartek A4:</strong> {chunks.length}</div>
                  <div><strong>Uklad:</strong> {layout.label}</div>
                  <div><strong>Orientacja:</strong> {opt.orientation === "portrait" ? "pionowa" : "pozioma"}</div>
                  <div><strong>Filtr:</strong> {FILTER_PRESET_LABELS[opt.filterPreset] || "Wlasny"}</div>
                </>
              )}
            </div>
          </section>

          <div className="min-h-[1.2em] text-sm text-red-700">{error}</div>
        </aside>
      </main>
    </div>
  );
}
