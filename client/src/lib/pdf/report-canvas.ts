/**
 * html2canvas 1.4 yalnızca rgb()/hsl() renkleri ayrıştırabiliyor. Uygulamanın
 * gövde rengi Tailwind v4 + BoardUI tokenlarından oklch() olarak geliyor;
 * ekran dışı kap bu rengi kalıtırsa html2canvas "unsupported color function
 * \u0022oklch\u0022" hatasıyla düşer. Kaba açık renk vererek kalıtımı kesiyoruz.
 */
const REPORT_TEXT_COLOR = "#111111";
const REPORT_BACKGROUND = "#ffffff";

export function createReportContainer(html: string, widthPx: number): HTMLDivElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  container.style.position = "absolute";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = `${widthPx}px`;
  container.style.background = REPORT_BACKGROUND;
  container.style.color = REPORT_TEXT_COLOR;
  document.body.appendChild(container);
  return container;
}

export const REPORT_CANVAS_OPTIONS = {
  scale: 2,
  useCORS: true,
  logging: false,
  backgroundColor: REPORT_BACKGROUND,
} as const;
