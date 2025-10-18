(function () {
    'use strict';

    if (typeof window.require === 'function' && !window.__electronRequireAvailable) {
        return;
    }

    window.require = function (module) {
        if (module === 'electron') {
            if (window.getElectronModule) {
                return window.getElectronModule();
            }
            throw new Error('Electron module not available');
        }
        throw new Error(`Module '${module}' is not available in renderer process`);
    };

    window.require.__electronHelper = true;

    logInfo('Electron Helper: require函数已设置');
})();