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
    layer: 'cctv',
    lead: 'Public cameras',
    text: 'Pictures belong to the agencies that publish them: City of Austin, Caltrans, TxDOT, DelDOT, City of Tallinn, Transpordiamet, Stadt Warendorf. Powered by TfL Open Data; contains OS data © Crown copyright and database rights.',
    link: { href: 'https://tfl.gov.uk/info-for/open-data-users/', label: 'TfL Open Data' },
    licence: 'TfL Open Data terms',
  },
  {
    layer: 'cctv',
    lead: 'Public cameras',
    text: 'Fintraffic / digitraffic.fi and Live Traffic NSW (Transport for NSW),',
    link: { href: 'https://creativecommons.org/licenses/by/4.0/', label: 'CC BY 4.0' },
    licence: 'attribution required',
  },
  {
    layer: 'cctv',
    lead: 'Public cameras',
    text: 'DriveBC (Government of British Columbia) and The City of Calgary, containing information licensed under the',
    link: { href: 'https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc', label: 'Open Government Licence' },
    licence: 'BC and Calgary versions',
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
