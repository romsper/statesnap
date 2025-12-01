chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Inject recorder as early as possible: on 'loading' (before page scripts run)
    if (changeInfo.status === 'loading' || changeInfo.status === 'complete') {
        // Verify if recording is enabled for this tab
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            world: 'MAIN',
            func: () => sessionStorage.getItem('__STATESNAP_RECORDING')
        }).then((results) => {
            if (results && results[0] && results[0].result === 'true') {
                // If the flag is set, inject the recorder
                chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    world: 'MAIN',
                    files: ['recorder.js']
                });
            }
        }).catch(() => {});
    }
});