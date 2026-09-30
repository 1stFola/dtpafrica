/**
 * Re-export. The list itself lives in `@dtp/engines` because the web app needs it too.
 *
 * The timeline decides whether a label becomes a link to a profile, and it was linking
 * `Own Goal` — two words, letters in both, so every shape-based rule waved it through.
 * Meanwhile the API held a list that had known about `own goal` all along, alongside
 * `goalkeeper`, `opponent`, `substitute` and `trialist`, written when `Player` was found
 * sitting second in the Ex Internationals Cup with five goals.
 *
 * Two lists meant the browser and the server disagreed about who is a person. One list,
 * in the package they both already depend on, is what stops that.
 *
 * This file stays so the ten API modules importing it do not have to change, and so the
 * API keeps a name for the concept in its own vocabulary.
 */
export { isPlaceholderName, PlaceholderPlayerNameError } from "@dtp/engines";
