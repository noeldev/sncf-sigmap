/**
 * markup.js — Markdown-like markup parser.
 *
 * Converts a limited subset of Markdown to HTML strings.
 * Used by translation.js to precompile string values at locale load time.
 *
 * Supported syntax:
 *   ## Heading             → <h2>…</h2>
 *   ### Heading            → <h3>…</h3>
 *   * item                 → <ul><li>…</li></ul>
 *     * sub-item           → nested <ul> inside parent <li>
 *   **bold**               → <strong>…</strong>
 *   *italic*               → <em>…</em>
 *   [label](url)           → external <a target="_blank" rel="noopener noreferrer">
 *   [label](#tab-id)       → internal tab link with data-switch-tab="tab-id"
 *   [label](#panel:id)     → scroll-to-panel link with data-scroll-panel="id"
 *   [label](style:diff-X)  → <span class="diff-X">label</span>  — used to inline
 *                            diff-mode visual samples in help strings.
 *   plain text line        → <p>…</p>  (multiline only)
 *   Two spaces at end of line → <br> (inside paragraphs or list items)
 *
 * Public API:
 *   isMarkup(str)   — true when the string contains any recognised markup pattern.
 *   toHtml(str)     — convert a markup string to an HTML string.
 */


// ===== Precompiled regular expressions =====

const RE_HEADING = /^(#{2,3}) (.+)/; // Combined H2 and H3 for single-pass evaluation
const RE_BOLD = /\*\*(.*?)\*\*/g;
const RE_ITALIC = /\*(.*?)\*/g;
const RE_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;
const RE_LIST_ITEM = /^( *)\* (.+)/;
const RE_TRAILING_SPACES = /  \n/g;
const RE_CLASS_SAFETY = /[^a-zA-Z0-9_\-\s]/g;

// Matches #, *, newline, or the link sequence ](
const RE_MARKUP = /[#*\n]|\]\(/;


// ===== Public API =====

/**
 * Check if a string contains Markdown-like markup or line breaks.
 * @param {any} str  The string to check.
 * @returns {boolean}
 */
export function isMarkup(str) {
    if (typeof str !== 'string') return false;
    return RE_MARKUP.test(str);
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
        return _inlineToHtml(processed);
    }

    // Multiline: block parsing with lists, headings, paragraphs
    return _parseMultiline(processed);
}


// ===== Multiline block parser =====

/**
 * Parse multiline markup into HTML.
 * Supports list items that span multiple lines (indented continuation lines)
 * and line breaks with two trailing spaces.
 * @param {string} str  String containing line breaks (already preprocessed
 *                      for trailing spaces).
 * @returns {string}
 */
function _parseMultiline(str) {
    const lines = str.split('\n');
    const output = [];
    const listStack = new ListStack(output);

    let inListItem = false;
    let currentIndent = 0;
    let pendingContent = [];

    const flushCurrentItem = () => {
        if (!inListItem) return;
        const html = _formatListItemContent(pendingContent.join('\n'));
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
            output.push(`<${tag}>${_inlineToHtml(headingMatch[2])}</${tag}>`);
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
            output.push(`<p>${_inlineToHtml(line)}</p>`);
        }
    }

    flushCurrentItem();
    listStack.flush();
    return output.join('');
}


// ===== Inline markup conversion =====

/**
 * Converts inline markup (bold, italic, links) to HTML.
 * @param {string} text  The raw text containing markup.
 * @returns {string} The parsed HTML string.
 */
function _inlineToHtml(text) {
    if (!text) return '';

    return text
        .replace(RE_BOLD, '<strong>$1</strong>')
        .replace(RE_ITALIC, '<em>$1</em>')
        .replace(RE_LINK, (_, label, url) => _parseCustomLink(label, url));
}

/**
 * Configuration table for [label](url) variants. Order matters — '#panel:'
 * must be tried before '#' so the more-specific prefix wins.
 */
const LINK_CONFIGS = [
    {
        // Apply CSS classes to the label.
        prefix: 'style:',
        transform: (label, val) => {
            const safeClass = val.replace(RE_CLASS_SAFETY, '').trim();
            return `<span class="${safeClass}">${label}</span>`;
        }
    },
    {
        // Scroll to a specific panel
        prefix: '#panel:',
        transform: (label, val) => `<a href="#" data-scroll-panel="${val}">${label}</a>`
    },
    {
        // Switch to a specific tab
        prefix: '#',
        transform: (label, val) => `<a href="#" data-switch-tab="${val}">${label}</a>`
    }
];

function _parseCustomLink(label, url) {
    // .find() stops on first match (watch out prefix order in array)
    const config = LINK_CONFIGS.find(c => url.startsWith(c.prefix));

    if (config) {
        const value = url.slice(config.prefix.length);
        return config.transform(label, value);
    }

    // Default: Standard external link
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}


// ===== List item content =====

/**
 * Convert raw multiline text inside a list item to HTML.
 * Replaces "  \n" with <br>, splits paragraphs on blank lines,
 * and converts single newlines to spaces.
 * @param {string} raw
 * @returns {string}
 */
function _formatListItemContent(raw) {
    if (!raw) return '';
    const withBr = raw.replace(RE_TRAILING_SPACES, '<br>\n');
    return withBr
        .split(/\n\s*\n/)
        .map(p => `<p>${_inlineToHtml(p.replace(/\n/g, ' '))}</p>`)
        .join('');
}


// ===== List stack =====

/**
 * Stateful helper for nested list construction. Private to this module.
 */
class ListStack {
    /** @type {string[]} Shared output buffer — lists are pushed here in document order */
    #output;

    constructor(output) {
        /** @type {Array<{ indent: number, items: string[] }>} */
        this.stack = [];
        this.#output = output;
    }

    /**
     * Add a list item at a given indentation level.
     * @param {number} indent   Number of spaces / 2 (level depth).
     * @param {string} content  Already processed HTML content (may contain <p> and <br>).
     */
    addItem(indent, content) {
        // Close levels that are deeper than this indent
        this.#closeDeeperThan(indent);
        // Ensure current level exists
        if (this.stack.length <= indent) {
            this.stack.push({ indent, items: [] });
        }
        this.stack[indent].items.push(`<li>${content}</li>`);
    }

    /** Close all open lists, flushing remaining items to output. */
    flush() {
        this.#closeDeeperThan(-1);
    }

    /**
     * Close list levels that are deeper than the given indent.
     * Levels with indent >= targetIndent are kept.
     * @param {number} targetIndent  Keep levels with stack index <= targetIndent.
     */
    #closeDeeperThan(targetIndent) {
        while (this.stack.length > targetIndent + 1) {
            const { items } = this.stack.pop();
            const ul = `<ul>${items.join('')}</ul>`;

            if (this.stack.length > 0) {
                // Inject the nested <ul> into the last <li> of the parent level
                const parent = this.stack[this.stack.length - 1];
                const lastIdx = parent.items.length - 1;
                parent.items[lastIdx] = parent.items[lastIdx].replace('</li>', `${ul}</li>`);
            } else {
                this.#output.push(ul);
            }
        }
    }
}
