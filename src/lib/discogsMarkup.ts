// Discogs free-text fields (release notes, artist profiles) use a small
// BBCode-like markup. Strip it down to plain text for display.
export function stripDiscogsMarkup(text: string): string {
  return text
    .replace(/\[url=[^\]]*\]([^[]*)\[\/url\]/gi, "$1")
    .replace(/\[\/?(b|i|u|url)\]/gi, "");
}
