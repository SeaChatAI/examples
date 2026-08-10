/**
 * Novel-style + light-markdown display formatter for immersive chat.
 *
 * Aligns with SillyTavern messageFormatting semantics (not a full Showdown port):
 *  - *text* / _text_  → italic (ST: em/i → --SmartThemeEmColor)
 *  - "…" / 「…」 / 『…』 / “…” → quote (ST: <q> → --SmartThemeQuoteColor)
 *  - **text** / __text__ → strong
 *  - italics nested in quotes inherit quote color (ST: q em { color: inherit })
 *
 * Pipeline on plain text:
 *  1. escape HTML
 *  2. dialogue quotes → <q>
 *  3. light markdown + *action*
 *  4. multi-paragraph → <p class="message-paragraph">
 *  5. sanitize allowlist
 */

/** Tags/classes the formatter and display-regex panels may emit. */
const ALLOWED_TAG_RE =
  /^<\/?(?:p|br|em|strong|span|i|b|q|u)(?:\s+class=(?:"[a-zA-Z0-9 _-]+"|'[a-zA-Z0-9 _-]+'))?\s*\/?>$/i;

/** Escape HTML special characters. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Strip dangerous attributes from a single HTML tag string (not free text).
 * Only runs on substrings that are already matched as tags.
 */
function scrubTagAttributes(tag: string): string {
  let cleaned = tag.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  cleaned = cleaned.replace(/\s+(href|src)\s*=\s*(['"]?)\s*javascript:[^'">\s]*/gi, '');
  return cleaned;
}

/**
 * Strip dangerous HTML. Allows only a small tag set used by this formatter
 * (and optional display-regex spans). Event handlers and script are removed
 * only inside real tags — plain prose like "onerror=handler" is preserved.
 */
export function sanitizeDisplayHtml(html: string): string {
  if (!html) return '';
  let out = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?(?:script|iframe|object|embed|link|meta|form|input|button|img|svg|math)[^>]*>/gi, '');

  out = out.replace(/<\/?[a-zA-Z][^>]*>/g, (tag) => {
    const scrubbed = scrubTagAttributes(tag);
    if (ALLOWED_TAG_RE.test(scrubbed)) return scrubbed;
    return escapeHtml(scrubbed);
  });

  return out;
}

/** Apply light markdown on already-escaped text. Attributes use single quotes. */
function applyLightMarkdown(escaped: string): string {
  // **bold** (before single-asterisk action/italic)
  let s = escaped.replace(/\*\*([^*\n]+)\*\*/g, "<strong class='fmt-strong'>$1</strong>");
  // __bold__
  s = s.replace(/__([^_\n]+)__/g, "<strong class='fmt-strong'>$1</strong>");
  // _italic_ (underscore only — single * reserved for *action* / ST italic)
  s = s.replace(
    /(^|[\s([（【「『]|&#39;|&quot;)_([^_\n]+)_(?=$|[\s)\]）】」』]|&#39;|&quot;|[.,!?;:…])/g,
    "$1<em class='fmt-em'>$2</em>",
  );
  return s;
}

/**
 * *action / italic* → <em class="fmt-action"> (ST markdown *…* → em).
 * Runs after **bold** so ** does not collide.
 */
function applyActionMarkers(escaped: string): string {
  return escaped.replace(
    /\*(?!\s)([^*\n]+?)(?<!\s)\*/g,
    "<em class='fmt-action'>$1</em>",
  );
}

/**
 * Quoted dialogue → <q class="fmt-quote"> (SillyTavern messageFormatting).
 * Input is HTML-escaped, so English quotes are &quot;.
 * Chinese corner quotes are not escaped by escapeHtml.
 */
function applyDialogueQuotes(escaped: string): string {
  let s = escaped;
  // Skip code-ish regions is out of scope (ST protects ``` / `); rare in RP bubbles.
  s = s.replace(/「([^」\n]+)」/g, "<q class='fmt-quote'>「$1」</q>");
  s = s.replace(/『([^』\n]+)』/g, "<q class='fmt-quote'>『$1』</q>");
  // Straight double quotes → &quot; after escapeHtml
  s = s.replace(
    /&quot;((?:(?!&quot;).)+?)&quot;/g,
    "<q class='fmt-quote'>&quot;$1&quot;</q>",
  );
  // Curly quotes (not escaped by escapeHtml)
  s = s.replace(/[“]([^”\n]+)[”]/g, "<q class='fmt-quote'>“$1”</q>");
  // Guillemets « »
  s = s.replace(/[«]([^»\n]+)[»]/g, "<q class='fmt-quote'>«$1»</q>");
  // Fullwidth quotes ＂ ＂
  s = s.replace(/\uFF02([^\uFF02\n]+)\uFF02/g, "<q class='fmt-quote'>\uFF02$1\uFF02</q>");
  return s;
}

/** Split on blank lines into paragraph blocks. */
function wrapParagraphs(html: string): string {
  const blocks = html
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (blocks.length === 0) return '';
  if (blocks.length === 1) {
    return `<p class="message-paragraph">${blocks[0]!.replaceAll('\n', '<br />')}</p>`;
  }
  return blocks
    .map((b) => `<p class="message-paragraph">${b.replaceAll('\n', '<br />')}</p>`)
    .join('');
}

/**
 * Format plain narrative text into safe HTML with ST-aligned novel/light-md styling.
 * Input must be plain text (not pre-escaped). Output is sanitized HTML.
 */
export function formatNovelHtml(plain: string): string {
  if (!plain) return '';
  const escaped = escapeHtml(plain);
  // Dialogue first (needs &quot; intact; must not run after class='...' is added).
  const withDialogue = applyDialogueQuotes(escaped);
  const withMd = applyLightMarkdown(withDialogue);
  const withAction = applyActionMarkers(withMd);
  const withParas = wrapParagraphs(withAction);
  return sanitizeDisplayHtml(withParas);
}

/**
 * If text already contains HTML tags (e.g. from display regex), sanitize and
 * lightly wrap paragraphs for bare multi-line runs without block tags.
 */
export function polishExistingHtml(html: string): string {
  const cleaned = sanitizeDisplayHtml(html);
  if (!cleaned) return '';
  if (/<(?:p|div|br)\b/i.test(cleaned)) return cleaned;
  return wrapParagraphs(cleaned);
}
