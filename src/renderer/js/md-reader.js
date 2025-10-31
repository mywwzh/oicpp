// md-reader.js

const markdownContent = document.getElementById('markdown-content');

// Function to render markdown content
async function renderMarkdown(filePath) {
    try {
        const markdownText = await window.electronAPI.readFileContent(filePath);
        // In a real application, you would use a library like 'marked' or 'markdown-it'
        // For now, we'll just display the raw text
        const { marked } = require('marked');
        markdownContent.innerHTML = marked(markdownText);
    } catch (error) {
        console.error('Failed to load markdown content:', error);
        markdownContent.innerHTML = `<p style="color: red;">Error loading markdown: ${error.message}</p>`;
    }
}

// Listen for markdown content to be loaded
window.electronAPI.onLoadMarkdown(async (filePath) => {
    await renderMarkdown(filePath);
});

// Initial load if a file path is passed on startup (e.g., via command line)
// This part might need adjustment based on how the main process passes initial file paths
// For now, we assume the main process will send 'load-markdown-content' event.

