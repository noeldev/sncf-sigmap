/**
 * markup.js — Markdown-like markup parser.
 *
 * Converts a limited subset of Markdown to HTML strings.
 * Used by translation.js to precompile string values at locale load time.
 *
 * Supported syntax:
 *   ## Heading       → <h2>…</h2>
 *   ### Heading      → <h3>…</h3>
 *   * item           → <ul><li>…</li></ul>
 *     * sub-item     → nested <ul> inside parent <li>
 *   **bold**         → <strong>…</strong>
 *   *italic*         → <em>…</em>
 *   [label](url)     → external <a target="_blank" rel="noopener noreferrer">
 *   [label](#tab-id) → internal tab link with data-switch-tab="tab-id"
 *   [label](#panel:id) → scroll-to-panel link with data-scroll-panel="id"
 *   plain text line  → <p>…</p>  (multiline only)
 *   Two spaces at end of line → <br> (inside paragraphs or list items)
 *
 * Public API:
 *   isMarkup(str)   — true when the string contains any recognised markup pattern.
 *   toHtml(str)     — convert a markup string to an HTML string.
 */

/* ===== Precompiled regular expressions ===== */

const RE_BOLD = /\*\*([^*]+)\*\*/g;
const RE_ITALIC = /\*([^*]+)\*/g;
const RE_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;
const RE_HEADING = /^(#{2,3}) (.+)/; // Combined H2 and H3 for single-pass evaluation
const RE_LIST_ITEM = /^( *)\* (.+)/;
const RE_TRAILING_SPACES = /  \n/g;

/* ===== Inline markup conversion (pure function) ===== */

/**
 * Convert inline markup (bold, italic, links) to HTML.
 * @param {string} text
 * @returns {string}
 */
function inlineToHtml(text) {
    if (!text) return '';

    // Bold, Italic and Links (internal, panel scroll, or external)
    return text
        .replace(RE_BOLD, '<strong>$1</strong>')
        .replace(RE_ITALIC, '<em>$1</em>')
        .replace(RE_LINK, (_, label, url) => {
            if (url.startsWith('#panel:'))
                return `<a href="#" data-scroll-panel="${url.slice(7)}">${label}</a>`;
            if (url.startsWith('#'))
                return `<a href="#" data-switch-tab="${url.slice(1)}">${label}</a>`;
            return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        });
}

/* ===== Helper for list item content (supports <br> and paragraphs) ===== */

/**
 * Convert raw multiline text inside a list item to HTML.
 * Replaces "  \n" with <br>, splits paragraphs on blank lines,
 * and converts single newlines to spaces.
 * @param {string} raw
 * @returns {string}
 */
function formatListItemContent(raw) {
    if (!raw) return '';
    const withBr = raw.replace(RE_TRAILING_SPACES, '<br>\n');
    return withBr
        .split(/\n\s*\n/)
        .map(p => `<p>${inlineToHtml(p.replace(/\n/g, ' '))}</p>`)
        .join('');
}

/* ===== List handling (stateful, encapsulated) ===== */

class ListStack {
    constructor(output) {
        /** @type {Array<{ indent: number, items: string[] }>} */
        this.stack = [];
        /** @type {string[]} Shared output buffer — lists are pushed here in document order */
        this._output = output;
    }

    /**
     * Close list levels that are deeper than the given indent.
     * Levels with indent >= targetIndent are kept.
     * @param {number} targetIndent - Keep levels with stack index <= targetIndent
     */
    _closeDeeperThan(targetIndent) {
        while (this.stack.length > targetIndent + 1) {
            const { items } = this.stack.pop();
            const ul = `<ul>${items.join('')}</ul>`;

            if (this.stack.length > 0) {
                // Inject the nested <ul> into the last <li> of the parent level
                const parent = this.stack[this.stack.length - 1];
                const lastIdx = parent.items.length - 1;
                parent.items[lastIdx] = parent.items[lastIdx].replace('</li>', `${ul}</li>`);
            } else {
                this._output.push(ul);
            }
        }
    }

    /**
     * Add a list item at a given indentation level.
     * @param {number} indent - Number of spaces / 2 (level depth)
     * @param {string} content - Already processed HTML content (may contain <p> and <br>)
     */
    addItem(indent, content) {
        // Close levels that are deeper than this indent
        this._closeDeeperThan(indent);
        // Ensure current level exists
        if (this.stack.length <= indent) {
            this.stack.push({ indent, items: [] });
        }
        this.stack[indent].items.push(`<li>${content}</li>`);
    }

    /** Close all open lists, flushing remaining items to output. */
    flush() {
        this._closeDeeperThan(-1);
    }
}

/* ===== Multiline block parser ===== */

/**
 * Parse multiline markup into HTML.
 * Supports list items that span multiple lines (indented continuation lines)
 * and line breaks with two trailing spaces.
 * @param {string} str - String containing line breaks (already preprocessed for trailing spaces)
 * @returns {string}
 */
function parseMultiline(str) {
    const lines = str.split('\n');
    const output = [];
    const listStack = new ListStack(output);

    let inListItem = false;
    let currentIndent = 0;
    let pendingContent = [];

    const flushCurrentItem = () => {
        if (!inListItem) return;
        const html = formatListItemContent(pendingContent.join('\n'));
        listStack.addItem(currentIndent, html);
        inListItem = false;
        pendingContent = [];
    };

    for (const line of lines) {
        // Headings
        const headingMatch = line.match(RE_HEADING);
        if (headingMatch) {
            flushCurrentItem();
            listStack.flush(); // close any open list before heading
            const tag = headingMatch[1].length === 2 ? 'h2' : 'h3';
            output.push(`<${tag}>${inlineToHtml(headingMatch[2])}</${tag}>`);
            continue;
        }

        // List item start
        const liMatch = line.match(RE_LIST_ITEM);
        if (liMatch) {
            flushCurrentItem();
            currentIndent = Math.floor(liMatch[1].length / 2);
            inListItem = true;
            pendingContent = [liMatch[2]];
            continue;
        }

        // Inside a list item: check for continuation (indented or blank)
        if (inListItem) {
            const leadingSpaces = line.length - line.trimStart().length;
            const requiredIndent = currentIndent * 2 + 2;
            const isIndented = leadingSpaces >= requiredIndent;
            const isBlank = line.trim() === '';

            if (isIndented || isBlank) {
                const content = isIndented ? line.slice(requiredIndent) : line;
                pendingContent.push(content);
                continue;
            } else {
                // Not indented -> close current item AND the entire list
                flushCurrentItem();
                listStack.flush(); // close the list before adding paragraph
            }
        }

        // Normal paragraph or blank line (no active list)
        listStack.flush();
        if (line.trim()) {
            output.push(`<p>${inlineToHtml(line)}</p>`);
        }
    }

    flushCurrentItem();
    listStack.flush();
    return output.join('');
}

/* ===== Public API ===== */

/**
 * Return true when the string contains at least one recognised markup pattern.
 * @param {string} str
 * @returns {boolean}
 */
export function isMarkup(str) {
    if (typeof str !== 'string') return false;
    // Presence of bold, italic, link, or line break (triggers multiline parsing)
    return str.includes('*') || str.includes('](') || str.includes('\n');
}

/**
 * Convert a markup string to an HTML string.
 * @param {string} str
 * @returns {string}
 */
export function toHtml(str) {
    if (!str) return '';

    // Global preprocessing: replace "  \n" with "<br>\n"
    const processed = str.replace(RE_TRAILING_SPACES, '<br>\n');

    // Single line: only inline markup, no block wrapper
    if (!processed.includes('\n')) {
        return inlineToHtml(processed);
    }

    // Multiline: block parsing with lists, headings, paragraphs
    return parseMultiline(processed);
}