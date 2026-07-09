export type PlayerLandingKind = "position" | "league" | "team" | "nationality" | "collection";

export type PlayerLandingMetadataInput = {
  kind: PlayerLandingKind;
  slug: string;
  label: string;
};

export function generatePlayerLandingMetadata(input: PlayerLandingMetadataInput) {
  const titleMap: Record<PlayerLandingKind, string> = {
    position: `${input.label} Oyuncuları | FutbolRadar`,
    league: `${input.label} Oyuncu Radarları | FutbolRadar`,
    team: `${input.label} Oyuncu Performans Radarları | FutbolRadar`,
    nationality: `${input.label} Uyruklu Oyuncular | FutbolRadar`,
    collection: `${input.label} | FutbolRadar`
  };

  return {
    title: titleMap[input.kind],
    description: `${input.label} filtresindeki oyuncuları AI rating, gol tehdidi, yaratıcılık, pres gücü ve form trendlerine göre analiz et.`,
    canonical: `https://www.futbolradar.com/players/${input.kind}/${input.slug}.html`
  };
}
