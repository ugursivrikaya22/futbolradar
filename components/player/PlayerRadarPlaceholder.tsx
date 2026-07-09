import type { PlayerRadar } from "../../lib/providers/types";

export type PlayerRadarPlaceholderProps = {
  title?: string;
  leftLabel?: string;
  rightLabel?: string;
  leftRadar?: PlayerRadar;
  rightRadar?: PlayerRadar;
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderPlayerRadarPlaceholder({
  title = "Radar grafik yakinda",
  leftLabel = "Oyuncu 1",
  rightLabel = "Oyuncu 2"
}: PlayerRadarPlaceholderProps): string {
  return `
    <section class="radar-chart-placeholder" aria-label="${escapeHtml(title)}">
      <span>${escapeHtml(title)}</span>
      <strong>${escapeHtml(leftLabel)} / ${escapeHtml(rightLabel)}</strong>
      <p>API verisiyle radar chart aktif olacak.</p>
    </section>
  `;
}
