import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const DEFAULT_SCALE = 2.5;

export interface PdfConvertProgress {
  /** Biten sayfa sayısı. */
  page: number;
  totalPages: number;
}

export interface PdfRenderOptions {
  scale?: number;
  onProgress?: (progress: PdfConvertProgress) => void;
}

export async function pdfToJpegFiles(file: File, options: PdfRenderOptions = {}): Promise<File[]> {
  const { scale = DEFAULT_SCALE, onProgress } = options;
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const files: File[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.92));
    const baseName = file.name.replace(/\.pdf$/i, "");
    files.push(new File([blob], `${baseName}_sayfa${pageNum}.jpg`, { type: "image/jpeg" }));
    onProgress?.({ page: pageNum, totalPages: pdf.numPages });
  }

  return files;
}
