import type { LayerDescriptor } from '@gev/shared';

type Spec = Omit<LayerDescriptor, 'status'>;

// Derived from the original app's layers, restricted to the KEEP list in PLAN.md.
const specs: Spec[] = [
  {
    id: 'flights',
    name: 'Flights',
    category: 'air',
    description: 'Live positions of aircraft that broadcast ADS-B, with altitude, speed and heading.',
    sources: ['OpenSky Network', 'adsb.lol'],
  },
  {
    id: 'military-flights',
    name: 'Military flights',
    category: 'air',
    description: 'Aircraft flagged as military in public ADS-B data, shown apart from civil traffic.',
    sources: ['adsb.lol'],
  },
  {
    id: 'vessels',
    name: 'Ships',
    category: 'sea',
    description: 'Live ship positions from AIS transponders, with vessel type, course and speed.',
    requiredKey: 'AISSTREAM_API_KEY',
    sources: ['AISStream'],
  },
  {
    id: 'satellites',
    name: 'Satellites',
    category: 'space',
    description: 'Orbiting satellites computed from public orbital elements, grouped by purpose.',
    sources: ['CelesTrak'],
  },
  {
    id: 'launches',
    name: 'Launches',
    category: 'space',
    description: 'Rocket launches from the last and next 30 days, with vehicle, payload and pad.',
    sources: ['Launch Library 2'],
  },
  {
    id: 'earthquakes',
    name: 'Earthquakes',
    category: 'hazards',
    description: 'Earthquakes from the last 24 hours, sized by magnitude.',
    sources: ['USGS'],
  },
  {
    id: 'fires',
    name: 'Active fires',
    category: 'hazards',
    description: 'Satellite fire detections from the last 24 hours.',
    requiredKey: 'FIRMS_MAP_KEY',
    sources: ['NASA FIRMS'],
  },
  {
    id: 'weather',
    name: 'Observed weather',
    category: 'weather',
    description: 'Rain radar, satellite clouds and lightning density, with a timeline to step back through.',
    sources: ['NOAA nowCOAST'],
  },
  {
    id: 'wind',
    name: 'Wind',
    category: 'weather',
    description: 'Animated forecast wind at 10 metres, with optional temperature or pressure shading.',
    sources: ['NOAA GFS', 'ECMWF IFS'],
  },
  {
    id: 'cyclones',
    name: 'Cyclones',
    category: 'weather',
    description: 'Current tropical storm positions, forecast tracks and uncertainty cones.',
    sources: ['NOAA NHC', 'NOAA CPHC'],
  },
  {
    id: 'submarine-cables',
    name: 'Submarine cables',
    category: 'infrastructure',
    description: 'Undersea internet cable routes and where they come ashore.',
    sources: ['TeleGeography Submarine Cable Map'],
  },
  {
    id: 'datacenters',
    name: 'Data centers',
    category: 'infrastructure',
    description: 'Data center buildings mapped by OpenStreetMap contributors.',
    sources: ['OpenStreetMap'],
  },
  {
    id: 'installations',
    name: 'Mapped installations',
    category: 'infrastructure',
    description: 'Military sites mapped by OpenStreetMap contributors. Coverage is incomplete.',
    sources: ['OpenStreetMap'],
  },
  {
    id: 'transit',
    name: 'Transit',
    category: 'ground',
    description: 'Live buses, trams, trains and ferries in cities that publish real-time vehicle feeds.',
    sources: ['Operator GTFS-Realtime feeds'],
  },
  {
    id: 'bikeshare',
    name: 'Bikeshare',
    category: 'ground',
    description: 'Bikeshare stations with the number of bikes and open docks right now.',
    sources: ['GBFS operator feeds'],
  },
  {
    id: 'traffic',
    name: 'Traffic',
    category: 'ground',
    description: 'Road congestion levels. Without a TomTom key, a simulation along mapped roads is shown.',
    sources: ['TomTom Traffic Flow (optional key)', 'OpenStreetMap'],
  },
  {
    id: 'alpr',
    name: 'Plate-reader cameras',
    category: 'ground',
    description: 'Locations of automatic license-plate readers mapped in OpenStreetMap. Locations only.',
    sources: ['OpenStreetMap', 'DeFlock'],
  },
  {
    id: 'cctv',
    name: 'Public cameras',
    category: 'ground',
    description: 'Public traffic and city cameras published by transport agencies, placed on the map.',
    sources: ['Austin Open Data', 'TxDOT', 'Caltrans', 'Transport for London', 'Ontario 511', 'Fintraffic'],
  },
  {
    id: 'radio',
    name: 'Radio stations',
    category: 'signals',
    description: 'Broadcast radio stations placed at their location, playable in the browser.',
    sources: ['Radio Browser'],
  },
];

/** Catalog for ClientConfig. A layer whose required key is not set reports 'needs-key'. */
export function buildLayers(env: Record<string, string | undefined> = {}): LayerDescriptor[] {
  return specs.map((spec) => {
    const missing = spec.requiredKey !== undefined && !env[spec.requiredKey]?.trim();
    return { ...spec, status: missing ? 'needs-key' : 'planned' };
  });
}
