/**
 * Single swap point for Steve's identity on the Owner Dashboard surfaces.
 *
 * The founder wants to be able to change Steve's mark — and his name — later
 * without hunting through components. This is that one place:
 *
 *   • `name`     — rename Steve everywhere the owner dashboard addresses him.
 *   • `markSrc`  — set to a hosted/imported image URL to replace his face with
 *                  custom art. While it's null we fall back to the canonical
 *                  in-app <SteveAvatar/> (whose glyph itself lives in the
 *                  single file components/steve/SteveMark.tsx).
 *
 * Changing either value here re-skins every Steve touchpoint in the dashboard
 * with no component edits — see components/owner/OwnerSteveMark.tsx.
 */
export const STEVE_BRAND = {
  name: 'Steve',
  /** When set, rendered as an <img src> instead of the built-in glyph. */
  markSrc: null as string | null,
}
