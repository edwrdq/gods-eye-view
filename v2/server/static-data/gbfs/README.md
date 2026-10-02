# Bikeshare systems index

`systems.json` tells the bikeshare layer where each docked bike system is, so a map
view only contacts the operators it overlaps. It holds no station data and no
live counts.

- Source: the MobilityData GBFS systems catalogue
  (<https://github.com/MobilityData/gbfs/blob/master/systems.csv>, CC BY 3.0) for
  names, places and feed addresses. The bounding boxes come from each system's own
  `station_information` feed, measured once when the index is built.
- Content: 406 systems built 2026-10-02. Only systems without authentication that
  rent bicycles (no cars, no mixed fleets) from at least two docked stations are kept.
  Free-floating scooter and bike fleets have no stations and are not in it.
- Rebuild (a few times a year; it contacts every listed system once, 4 requests at a
  time and 2 per host, and takes about 8 minutes):

  ```
  cd v2/server && npm run bikeshare:index
  ```

  Behind an egress proxy, start it with `NODE_USE_ENV_PROXY=1`.
- At run time the server fetches the live catalogue daily and joins it to this file by
  system id. Systems added to the catalogue after the index was built are not shown
  until it is rebuilt; systems removed from the catalogue are dropped.
- The live station data is published by each operator under its own terms.
