(function () {
    'use strict';

    const ICONS = {
        folder: `
            <svg class="ui-icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M1.5 4.5A1.5 1.5 0 0 1 3 3h3.2a1.5 1.5 0 0 1 1.06.44l.8.8c.28.28.66.44 1.06.44H13A1.5 1.5 0 0 1 14.5 6v6.5A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5V4.5z"/>
            </svg>
        `.trim(),
        file: `
            <svg class="ui-icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M4 1.5A1.5 1.5 0 0 1 5.5 0h4.2a1.5 1.5 0 0 1 1.06.44l2.8 2.8c.28.28.44.66.44 1.06V14.5A1.5 1.5 0 0 1 12.5 16h-7A1.5 1.5 0 0 1 4 14.5v-13zM10 1.6V4h2.4L10 1.6z"/>
            </svg>
        `.trim(),
        fileCode: `
            <svg class="ui-icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M4 1.5A1.5 1.5 0 0 1 5.5 0h4.2a1.5 1.5 0 0 1 1.06.44l2.8 2.8c.28.28.44.66.44 1.06V14.5A1.5 1.5 0 0 1 12.5 16h-7A1.5 1.5 0 0 1 4 14.5v-13zM10 1.6V4h2.4L10 1.6z"/>
                <path fill="#000" opacity="0.6" d="M6.2 7.2 4.5 8.9l1.7 1.7-.9.9L2.7 8.9l2.6-2.6.9.9zM9.8 7.2l.9-.9 2.6 2.6-2.6 2.6-.9-.9 1.7-1.7-1.7-1.7z"/>
            </svg>
        `.trim(),
        fileHeader: `
            <svg class="ui-icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M4 1.5A1.5 1.5 0 0 1 5.5 0h4.2a1.5 1.5 0 0 1 1.06.44l2.8 2.8c.28.28.44.66.44 1.06V14.5A1.5 1.5 0 0 1 12.5 16h-7A1.5 1.5 0 0 1 4 14.5v-13zM10 1.6V4h2.4L10 1.6z"/>
                <path fill="#000" opacity="0.6" d="M5.6 6.6h1.2v2.2h2.4V6.6h1.2v5H9.2v-1.7H6.8v1.7H5.6v-5z"/>
            </svg>
        `.trim(),
        fileText: `
            <svg class="ui-icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M4 1.5A1.5 1.5 0 0 1 5.5 0h4.2a1.5 1.5 0 0 1 1.06.44l2.8 2.8c.28.28.44.66.44 1.06V14.5A1.5 1.5 0 0 1 12.5 16h-7A1.5 1.5 0 0 1 4 14.5v-13zM10 1.6V4h2.4L10 1.6z"/>
                <path fill="#000" opacity="0.55" d="M5.7 6.6h6v1.1h-6V6.6zm0 2.1h6v1.1h-6V8.7zm0 2.1h4.2v1.1H5.7v-1.1z"/>
            </svg>
        `.trim(),
        fileMarkdown: `
            <svg class="ui-icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M4 1.5A1.5 1.5 0 0 1 5.5 0h4.2a1.5 1.5 0 0 1 1.06.44l2.8 2.8c.28.28.44.66.44 1.06V14.5A1.5 1.5 0 0 1 12.5 16h-7A1.5 1.5 0 0 1 4 14.5v-13zM10 1.6V4h2.4L10 1.6z"/>
                <path fill="#000" opacity="0.6" d="M5.5 11.2V7.1h1.2l1.3 1.8 1.3-1.8h1.2v4.1h-1.2V8.9L8 10.7 6.7 8.9v2.3H5.5zm6.4 0-1.6-1.8 1-.9.6.7V7.1h1.2v2.1l.6-.7 1 .9-1.6 1.8h-.6z"/>
            </svg>
        `.trim(),
        filePdf: `
            <svg class="ui-icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M4 1.5A1.5 1.5 0 0 1 5.5 0h4.2a1.5 1.5 0 0 1 1.06.44l2.8 2.8c.28.28.44.66.44 1.06V14.5A1.5 1.5 0 0 1 12.5 16h-7A1.5 1.5 0 0 1 4 14.5v-13zM10 1.6V4h2.4L10 1.6z"/>
                <path fill="#000" opacity="0.6" d="M5.6 12.1V6.2h2.2c1.1 0 1.8.7 1.8 1.7s-.7 1.7-1.8 1.7H6.8v2.5H5.6zm1.2-3.6h1c.4 0 .7-.3.7-.6 0-.4-.3-.6-.7-.6h-1v1.2z"/>
            </svg>
        `.trim(),
        fileJson: `
            <svg class="ui-icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M4 1.5A1.5 1.5 0 0 1 5.5 0h4.2a1.5 1.5 0 0 1 1.06.44l2.8 2.8c.28.28.44.66.44 1.06V14.5A1.5 1.5 0 0 1 12.5 16h-7A1.5 1.5 0 0 1 4 14.5v-13zM10 1.6V4h2.4L10 1.6z"/>
                <path fill="#000" opacity="0.6" d="M7.1 11.7c-1 0-1.6-.7-1.6-1.6V9.6c0-.3-.2-.5-.5-.5h-.5V8h.5c.3 0 .5-.2.5-.5V7c0-.9.6-1.6 1.6-1.6v1.1c-.3 0-.5.2-.5.5v.5c0 .4-.2.8-.6 1 .4.2.6.6.6 1v.5c0 .3.2.5.5.5v1.2zm1.8 0v-1.2c.3 0 .5-.2.5-.5v-.5c0-.4.2-.8.6-1-.4-.2-.6-.6-.6-1V7c0-.3-.2-.5-.5-.5V5.4c1 0 1.6.7 1.6 1.6v.5c0 .3.2.5.5.5h.5v1.1h-.5c-.3 0-.5.2-.5.5v.5c0 .9-.6 1.6-1.6 1.6z"/>
            </svg>
        `.trim(),
        fileIn: `
            <svg class="ui-icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M4 1.5A1.5 1.5 0 0 1 5.5 0h4.2a1.5 1.5 0 0 1 1.06.44l2.8 2.8c.28.28.44.66.44 1.06V14.5A1.5 1.5 0 0 1 12.5 16h-7A1.5 1.5 0 0 1 4 14.5v-13zM10 1.6V4h2.4L10 1.6z"/>
                <path fill="#000" opacity="0.6" d="M8 6.3v5.6H6.8V6.3H8zm-2.2 2.6 1.6 1.6-1 .9-2.5-2.5 2.5-2.5 1 .9-1.6 1.6z"/>
            </svg>
        `.trim(),
        fileOut: `
            <svg class="ui-icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M4 1.5A1.5 1.5 0 0 1 5.5 0h4.2a1.5 1.5 0 0 1 1.06.44l2.8 2.8c.28.28.44.66.44 1.06V14.5A1.5 1.5 0 0 1 12.5 16h-7A1.5 1.5 0 0 1 4 14.5v-13zM10 1.6V4h2.4L10 1.6z"/>
                <path fill="#000" opacity="0.6" d="M7.2 6.3v5.6H8.4V6.3H7.2zm3 2.6-1.6-1.6 1-.9 2.5 2.5-2.5 2.5-1-.9 1.6-1.6z"/>
            </svg>
        `.trim(),
        warning: `
            <svg class="ui-icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M7.1 1.4a1 1 0 0 1 1.8 0l6.4 12.7A1 1 0 0 1 14.4 15H1.6a1 1 0 0 1-.9-1.5L7.1 1.4z"/>
                <path fill="#000" opacity="0.65" d="M8 5.1c.4 0 .7.3.7.7v4.1a.7.7 0 0 1-1.4 0V5.8c0-.4.3-.7.7-.7zM8 11.8a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8z"/>
            </svg>
        `.trim(),
        gear: `
            <svg class="ui-icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M6.7 1.1h2.6l.3 1.6c.4.1.8.3 1.2.5l1.4-.9 1.8 1.8-.9 1.4c.2.4.4.8.5 1.2l1.6.3v2.6l-1.6.3c-.1.4-.3.8-.5 1.2l.9 1.4-1.8 1.8-1.4-.9c-.4.2-.8.4-1.2.5l-.3 1.6H6.7l-.3-1.6c-.4-.1-.8-.3-1.2-.5l-1.4.9-1.8-1.8.9-1.4c-.2-.4-.4-.8-.5-1.2L1.1 9.3V6.7l1.6-.3c.1-.4.3-.8.5-1.2l-.9-1.4L4.1 2l1.4.9c.4-.2.8-.4 1.2-.5l.3-1.6zM8 5.3A2.7 2.7 0 1 0 8 10.7 2.7 2.7 0 0 0 8 5.3z"/>
            </svg>
        `.trim(),
        sparkle: `
            <svg class="ui-icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M8 1l1.1 3.2L12.3 5.3 9.1 6.4 8 9.6 6.9 6.4 3.7 5.3 6.9 4.2 8 1z"/>
                <path fill="currentColor" opacity="0.8" d="M13.1 9.2l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6.6-1.7zM2.9 9.9l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5.5-1.2z"/>
            </svg>
        `.trim(),
        refresh: `
            <svg class="ui-icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M13.7 7.2A5.8 5.8 0 0 0 3.5 3.8L2.3 2.6v3.9h3.9L4.7 4.9a4.2 4.2 0 0 1 7.4 2.3h1.6z"/>
                <path fill="currentColor" d="M2.3 8.8a5.8 5.8 0 0 0 10.2 3.4l1.2 1.2V9.5H9.8l1.5 1.5a4.2 4.2 0 0 1-7.4-2.2H2.3z"/>
            </svg>
        `.trim(),
        check: `
            <svg class="ui-icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M6.4 11.2 3.3 8.1l1.1-1.1 2 2 5.2-5.2 1.1 1.1-6.3 6.3z"/>
            </svg>
        `.trim(),
        link: `
            <svg class="ui-icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M6.5 10.6 5.4 9.5l4.1-4.1 1.1 1.1-4.1 4.1z"/>
                <path fill="currentColor" d="M5.2 12.8a3 3 0 0 1 0-4.2l1.3-1.3 1.1 1.1-1.3 1.3a1.4 1.4 0 0 0 2 2l1.3-1.3 1.1 1.1-1.3 1.3a3 3 0 0 1-4.2 0z"/>
                <path fill="currentColor" d="M10.8 3.2a3 3 0 0 1 0 4.2L9.5 8.7 8.4 7.6l1.3-1.3a1.4 1.4 0 1 0-2-2L6.4 5.6 5.3 4.5l1.3-1.3a3 3 0 0 1 4.2 0z"/>
            </svg>
        `.trim(),
        image: `
            <svg class="ui-icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M2.5 3A1.5 1.5 0 0 0 1 4.5v7A1.5 1.5 0 0 0 2.5 13h11A1.5 1.5 0 0 0 15 11.5v-7A1.5 1.5 0 0 0 13.5 3h-11zM2.6 11.6l3.4-3.4 2.1 2.1 2.4-2.4 2.5 2.5v1.1H2.6z"/>
                <path fill="currentColor" opacity="0.75" d="M5.2 6.1a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/>
            </svg>
        `.trim(),
        undo: `
            <svg class="ui-icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M6.2 4.2 3 7.4l3.2 3.2 1.1-1.1-1.3-1.3h4.5a2.5 2.5 0 0 1 0 5H5.7v1.6h4.8a4.1 4.1 0 0 0 0-8.2H6l1.3-1.3-1.1-1.1z"/>
            </svg>
        `.trim(),
        redo: `
            <svg class="ui-icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M9.8 4.2 13 7.4l-3.2 3.2-1.1-1.1 1.3-1.3H5.5a2.5 2.5 0 0 0 0 5h4.8v1.6H5.5a4.1 4.1 0 0 1 0-8.2H10L8.7 5.3l1.1-1.1z"/>
            </svg>
        `.trim(),
        task: `
            <svg class="ui-icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M2.5 3A1.5 1.5 0 0 0 1 4.5v9A1.5 1.5 0 0 0 2.5 15h11A1.5 1.5 0 0 0 15 13.5v-9A1.5 1.5 0 0 0 13.5 3h-11zM2.6 4.6h10.8v8.8H2.6V4.6z"/>
                <path fill="currentColor" opacity="0.9" d="M4 7.2h6v1.2H4V7.2zM4 9.6h8v1.2H4V9.6z"/>
            </svg>
        `.trim(),
        dot: `
            <svg class="ui-icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
                <circle cx="8" cy="8" r="3" fill="currentColor"/>
            </svg>
        `.trim(),
        emptyBox: `
            <svg class="ui-icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
                <rect x="3" y="3" width="10" height="10" rx="1.5" ry="1.5" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.9"/>
            </svg>
        `.trim()
    };

    function svg(name) {
        return ICONS[name] || '';
    }

    function hydrate(root) {
        const host = root || document;
        if (!host || !host.querySelectorAll) return;
        host.querySelectorAll('[data-ui-icon]').forEach((el) => {
            const name = el.getAttribute('data-ui-icon');
            if (!name) return;
            const markup = svg(name);
            if (!markup) return;
            el.innerHTML = markup;
        });
    }

    window.uiIcons = {
        svg,
        hydrate
    };

    document.addEventListener('DOMContentLoaded', () => {
        hydrate(document);
    });
})();
