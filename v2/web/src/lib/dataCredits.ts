/** Credits that bundled datasets require while their layer is on (shown in the attribution popover). */
export interface DataCredit {
  layer: string;
  /** "Submarine cables: " */
  lead: string;
  /** The credit line, as the licence words it. */
  text: string;
  link: { href: string; label: string };
  licence: string;
}

export const DATA_CREDITS: readonly DataCredit[] = [
  {
    layer: 'submarine-cables',
    lead: 'Submarine cables',
    text: '© TeleGeography,',
    link: { href: 'https://www.submarinecablemap.com', label: 'submarinecablemap.com' },
    licence: 'CC BY-NC-SA 3.0, non-commercial use only',
  },
  {
    layer: 'datacenters',
    lead: 'Data centers',
    text: '© OpenStreetMap contributors,',
    link: { href: 'https://www.openstreetmap.org/copyright', label: 'ODbL 1.0' },
    licence: 'share-alike',
  },
  {
    layer: 'installations',
    lead: 'Mapped military areas',
    text: '© OpenStreetMap contributors via Overture Maps Foundation,',
    link: { href: 'https://www.openstreetmap.org/copyright', label: 'ODbL 1.0' },
    licence: 'share-alike',
  },
  {
    layer: 'bikeshare',
    lead: 'Bikeshare',
    text: 'Station data published by each operator over GBFS; systems listed by the',
    link: { href: 'https://github.com/MobilityData/gbfs/blob/master/systems.csv', label: 'MobilityData GBFS catalogue' },
    licence: 'CC BY 3.0; operator terms vary',
  },
  {
    layer: 'radio',
    lead: 'Radio stations',
    text: 'Directory from',
    link: { href: 'https://www.radio-browser.info', label: 'Radio Browser' },
    licence: 'community-maintained; streams belong to their stations',
  },
];

/** The credits for the layers that are switched on. */
export function creditsFor(enabled: Readonly<Record<string, boolean>>): DataCredit[] {
  return DATA_CREDITS.filter((c) => enabled[c.layer] === true);
}
