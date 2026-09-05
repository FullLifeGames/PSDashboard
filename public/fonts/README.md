# fontawesome-webfont.woff2

Font Awesome 4.7.0 by Dave Gandy (https://fontawesome.com), font files
licensed under the SIL Open Font License 1.1
(https://scripts.sil.org/OFL).

This copy is the file the Showdown replay embed loads from
play.pokemonshowdown.com, re-saved with fonttools so every glyph's stored
bounding box matches its outline. The original disagrees on 114 glyphs,
and Firefox's font sanitizer logs a console warning for each one. The
replay iframe overrides the embed's @font-face to use this copy (see
src/lib/replay-compat.ts). No glyphs, names, or mappings were changed.
