export const GlobalWorkerOptions: {
  workerSrc: string;
};

export function getDocument(src: string | {
  url: string;
  BinaryDataFactory?: new (options: unknown) => {
    fetch(options: { kind: string; filename: string }): Promise<Uint8Array>;
  };
}): PDFDocumentLoadingTask;

export interface PDFDocumentLoadingTask {
  promise: Promise<PDFDocumentProxy>;
  destroy(): Promise<void>;
}

export interface PDFDocumentProxy {
  numPages: number;
  getPage(pageNumber: number): Promise<PDFPageProxy>;
  destroy(): Promise<void>;
}

export interface PDFPageProxy {
  getViewport(options: { scale: number }): PageViewport;
  render(options: {
    canvas: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    viewport: PageViewport;
  }): RenderTask;
}

export interface PageViewport {
  width: number;
  height: number;
}

export interface RenderTask {
  promise: Promise<void>;
  cancel(): void;
}
