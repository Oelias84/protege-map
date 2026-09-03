/**
 * Lazy pdf.js loader for the browser. The worker file must be reachable at
 * `/pdf.worker.min.mjs` — copy it in postinstall:
 *
 *   cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/
 */

let mod: typeof import("pdfjs-dist") | undefined;

export async function loadPdfjs() {
  if (!mod) {
    mod = await import("pdfjs-dist");
    mod.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  }
  return mod;
}
