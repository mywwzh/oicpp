function activate(oicpp) {
    oicpp.commands.registerCommand('oicpp.code-stats.count', () => {
        const text = oicpp.workspace.getText();
        if (!oicpp.workspace.getActiveFilePath() && !text) {
            oicpp.window.showMessage('Open a text file before running Code Statistics.', 'warning');
            return;
        }

        const lines = text ? text.split(/\r?\n/).length : 0;
        const words = (text.trim().match(/\S+/g) || []).length;
        const characters = text.length;
        oicpp.window.showMessage(`Lines: ${lines}  Words: ${words}  Characters: ${characters}`, 'info');
    });
}

module.exports = { activate };
