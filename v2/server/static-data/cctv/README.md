# Public camera data bundled with the server

`tallinn.json` is the list of the City of Tallinn intersection cameras
(`ristmikud.tallinn.ee`, pictures at `/last/camNNN.jpg`). The city publishes no
machine-readable catalogue, so the list is bundled: camera number, name,
position, and, for 230 of 255 cameras, a heading set by hand from imagery by
the maintainers of the original God's Eye View app (its `config/cctv_sources.tallinn.json`,
reduced to these fields). A camera without `heading` gets the placeholder bearing
(estimated). The picture is fetched live from the city's host when a camera's
panel is open; nothing from it is stored or redistributed.

Every other source is fetched live from its agency (see
`src/feeds/cctv/sources/`) and cached under `DATA_DIR/cache/cctv/`.
