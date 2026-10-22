/**
 * The text a reader sees in rendered markup, one entry per run of text
 * between two tags, trimmed, empty runs left out.
 * @param html - what `renderToStaticMarkup` wrote
 * @returns the texts, in document order
 */
export function visibleTexts(html: string): string[] {
  const texts: string[] = [];
  for (const run of html.split(/<[^>]*>/)) {
    const text = decodeEntities(run).trim();
    if (text !== '') texts.push(text);
  }
  return texts;
}

/**
 * Markup text with the entities React writes turned back into characters.
 * @param text - the text, as written in the markup
 * @returns the text
 */
export function decodeEntities(text: string): string {
  return text
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}
