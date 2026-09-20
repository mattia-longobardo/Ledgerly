"use client";

import { Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, IconButton } from "./button";
import { cn } from "./cn";
import { PDF_ASSETS } from "./pdf-assets";

/** A box on a page to draw attention to: fractions of the page, origin top left (spec §7.8). */
export interface Highlight {
  page: number;
  bbox: [number, number, number, number];
}

const ZOOMS = [0.75, 1, 1.25, 1.5, 2, 3] as const;

type PdfDocument = {
  numPages: number;
  getPage(number: number): Promise<{
    getViewport(options: { scale: number }): { width: number; height: number };
    render(options: { canvas: HTMLCanvasElement; viewport: unknown }): {
      promise: Promise<void>;
      cancel(): void;
    };
  }>;
};

/**
 * The PDF viewer of spec §8.3: one page at a time drawn by pdf.js on a canvas (worker and fonts
 * from `/pdfjs/`, scripts from 'self' only), zoom, page stepping, and highlighted boxes placed in
 * fractions of the page so they sit on the same text at every zoom. Jumps to the page of the first
 * highlight when the highlights change.
 */
export function PdfViewer({
  url,
  fileName,
  highlights,
  labels,
}: {
  url: string;
  fileName: string;
  highlights: readonly Highlight[];
  labels: {
    page: (page: number, pages: number) => string;
    previous: string;
    next: string;
    zoomIn: string;
    zoomOut: string;
    open: string;
    loading: string;
    failed: string;
  };
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [aspect, setAspect] = useState(1.414);

  useEffect(() => {
    let cancelled = false;
    // What is closed on the way out is the loading task: pdf.js 6's document has no `destroy()`,
    // and calling it threw while the page unmounted, breaking the navigation away from it.
    let task: { destroy(): Promise<void> } | null = null;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = PDF_ASSETS.worker;
        const loading = pdfjs.getDocument({
          url,
          withCredentials: true,
          standardFontDataUrl: PDF_ASSETS.standardFonts,
          // Without it the JBIG2 and JPEG 2000 images of a document are dropped (spec §8.3).
          wasmUrl: PDF_ASSETS.wasm,
        });
        task = loading;
        if (cancelled) return void loading.destroy().catch(() => undefined);
        const loaded = (await loading.promise) as unknown as PdfDocument;
        if (cancelled) return;
        setPdf(loaded);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("failed");
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy().catch(() => undefined);
    };
  }, [url]);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A new selection turns to the page its first box is on (adjusted while rendering, not in an effect).
  const first = highlights[0]?.page;
  const [followed, setFollowed] = useState(first);
  if (first !== followed) {
    setFollowed(first);
    if (first !== undefined) setPage(first);
  }

  useEffect(() => {
    if (!pdf || !canvas.current || width === 0) return;
    let task: { promise: Promise<void>; cancel(): void } | null = null;
    let cancelled = false;
    (async () => {
      const current = await pdf.getPage(Math.min(page, pdf.numPages)).catch(() => null);
      if (cancelled || !current || !canvas.current) return;
      const base = current.getViewport({ scale: 1 });
      setAspect(base.height / base.width);
      const cssWidth = width * zoom;
      const ratio = window.devicePixelRatio || 1;
      const viewport = current.getViewport({ scale: (cssWidth / base.width) * ratio });
      canvas.current.width = Math.floor(viewport.width);
      canvas.current.height = Math.floor(viewport.height);
      canvas.current.style.width = `${cssWidth}px`;
      canvas.current.style.height = `${(cssWidth * base.height) / base.width}px`;
      task = current.render({ canvas: canvas.current, viewport });
      await task.promise.catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page, zoom, width]);

  const pages = pdf?.numPages ?? 1;
  const onPage = highlights.filter((highlight) => highlight.page === page);
  const zoomIndex = ZOOMS.indexOf(zoom as (typeof ZOOMS)[number]);

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-card border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 text-sm text-muted">
        <span className="min-w-0 truncate">
          {fileName} · {labels.page(page, pages)}
        </span>
        <div className="flex items-center gap-1">
          <Button size="xs" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>
            {labels.previous}
          </Button>
          <Button
            size="xs"
            onClick={() => setPage((value) => Math.min(pages, value + 1))}
            disabled={page >= pages}
          >
            {labels.next}
          </Button>
          <IconButton
            label={labels.zoomOut}
            onClick={() => setZoom(ZOOMS[Math.max(0, zoomIndex - 1)])}
            disabled={zoomIndex <= 0}
          >
            <Minus size={14} />
          </IconButton>
          <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)} %</span>
          <IconButton
            label={labels.zoomIn}
            onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomIndex + 1)])}
            disabled={zoomIndex >= ZOOMS.length - 1}
          >
            <Plus size={14} />
          </IconButton>
          <a
            href={url}
            target="_blank"
            rel="noopener"
            className="focus-ring ml-2 inline-flex h-6 items-center rounded-[5px] border border-border bg-card px-2 text-sm font-medium text-fg hover:bg-hover"
          >
            {labels.open}
          </a>
        </div>
      </div>
      <div ref={frame} className="overflow-auto bg-bg p-4 max-md:p-2">
        <div className="relative mx-auto" style={{ width: width ? width * zoom : undefined }}>
          <canvas
            ref={canvas}
            data-testid="pdf-canvas"
            className={cn("block bg-white shadow-sm", status !== "ready" && "invisible")}
            style={{ aspectRatio: `1 / ${aspect}` }}
          />
          {status !== "ready" && (
            <p className="absolute inset-0 grid place-items-center text-sm text-muted">
              {status === "loading" ? labels.loading : labels.failed}
            </p>
          )}
          {status === "ready" &&
            onPage.map((highlight, index) => (
              <span
                key={index}
                data-testid="pdf-highlight"
                aria-hidden
                className="pointer-events-none absolute rounded-[2px] bg-warn/25 ring-2 ring-warn"
                style={{
                  left: `${highlight.bbox[0] * 100}%`,
                  top: `${highlight.bbox[1] * 100}%`,
                  width: `${(highlight.bbox[2] - highlight.bbox[0]) * 100}%`,
                  height: `${(highlight.bbox[3] - highlight.bbox[1]) * 100}%`,
                  margin: "-2px",
                  padding: "2px",
                  boxSizing: "content-box",
                }}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
