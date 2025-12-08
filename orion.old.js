/* --- .ori (Orion App Install) File System (ZIP based) --- */

async function handleOriFile(input) {
    const file = input.files[0];
    if (!file) return;

    try {
        const zip = await JSZip.loadAsync(file);
        
        // 1. Read metadata.json
        const metaStr = await zip.file("metadata.json").async("string");
        const metadata = JSON.parse(metaStr);
        
        // 2. Get the run command (entry file path)
        const runPath = metadata.run; 
        if (!runPath || !zip.file(runPath)) {
            throw new Error(`Entry file '${runPath}' not found in archive.`);
        }

        // 3. Read the entry file (HTML)
        let appContent = await zip.file(runPath).async("string");

        // 4. Inline Resources (Images, CSS, JS)
        const parser = new DOMParser();
        const doc = parser.parseFromString(appContent, "text/html");

        // Helper to resolve relative paths
        const resolvePath = (currentFile, targetLink) => {
            const parts = currentFile.split('/');
            parts.pop(); 
            const targetParts = targetLink.split('/');
            
            for (let part of targetParts) {
                if (part === '..') parts.pop();
                else if (part !== '.') parts.push(part);
            }
            return parts.join('/');
        };

        // Find all elements with src or href attributes
        const elements = doc.querySelectorAll('[src], [href]');
        const promises = [];

        elements.forEach(el => {
            const attr = el.hasAttribute('src') ? 'src' : 'href';
            const val = el.getAttribute(attr);
            
            // Skip absolute URLs or existing data URIs
            if (!val || val.startsWith('http') || val.startsWith('//') || val.startsWith('data:')) return;

            const zipPath = resolvePath(runPath, val);
            const zipFile = zip.file(zipPath);
            
            if (zipFile) {
                const p = zipFile.async("base64").then(b64 => {
                    const mime = getMimeType(zipPath);
                    el.setAttribute(attr, `data:${mime};base64,${b64}`);
                });
                promises.push(p);
            }
        });

        // Wait for all resources to be converted
        await Promise.all(promises);

        // Get the final HTML with inlined resources
        // FIX: Use outerHTML to capture the full document (<html>...</html>)
        // This ensures we keep the DOCTYPE, head, body, and all attributes.
        const finalContent = doc.documentElement.outerHTML;

        // Inline metadata.icon (if specified and present inside the .ori) as a data URI
        if (metadata.icon && !metadata.icon.startsWith('data:')) {
            try {
                const iconPath = resolvePath(runPath, metadata.icon);
                // try both resolved path and raw path (some packs may use absolute inside zip)
                const iconFile = zip.file(iconPath) || zip.file(metadata.icon);
                if (iconFile) {
                    const b64icon = await iconFile.async("base64");
                    metadata.icon = `data:${getMimeType(iconPath)};base64,${b64icon}`;
                } else {
                    // File not found, clear icon to use placeholder
                    metadata.icon = null;
                }
            } catch (e) {
                console.warn("Failed to inline icon:", e);
                // Clear icon on error to use placeholder
                metadata.icon = null;
            }
        }

        saveAppToStorage(metadata, finalContent);
        createAppWindow(metadata, finalContent, true);

    } catch (err) {
        if (err.message && err.message.includes("compression")) {
            alert("Error: The .ori file uses unsupported compression (likely LZMA). Please re-zip using standard 'Deflate' compression.");
        } else {
            alert("Error loading .ori app: " + err.message);
        }
        console.error(err);
    }

    input.value = ''; // Reset input
}

function getMimeType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'svg': 'image/svg+xml',
        'ico': 'image/x-icon',
        'webp': 'image/webp',
        'bmp': 'image/bmp',
        'css': 'text/css',
        'js': 'application/javascript',
        'json': 'application/json',
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav'
    };
    return map[ext] || 'application/octet-stream';
}

function saveAppToStorage(metadata, content) {
    try {
        let apps = JSON.parse(localStorage.getItem('orion_apps') || "[]");
        // Remove existing app with same title to update it
        apps = apps.filter(app => app.metadata.title !== metadata.title);
        apps.push({ metadata, content });
        localStorage.setItem('orion_apps', JSON.stringify(apps));
    } catch (e) {
        console.error("Storage full", e);
        alert("App installed for this session only (Browser storage full)");
    }
}

function loadInstalledApps() {
    try {
        const apps = JSON.parse(localStorage.getItem('orion_apps') || "[]");

        apps.forEach(app => {
            // Load app but do not auto-open (false)
            const win = createAppWindow(app.metadata, app.content, false);
            
            // Choose icon (inlined data URI if present) or fallback placeholder
            const iconSrc = app.metadata && app.metadata.icon ? app.metadata.icon : 'YOUR PLACEHOLDER IMAGE';
            const appTitle = app.metadata && app.metadata.title ? app.metadata.title : "External App";
            const appVersion = (app.metadata && app.metadata.version) ? app.metadata.version : '1.0';
            const escapedTitle = (appTitle).replace(/'/g, "\\'");

            // Display metadata and uninstall button in Orion App Section (with icon)
            const appEntry = `
                <div style="padding: 8px; border-bottom: 1px solid #ccc; display: flex; gap:8px; align-items: center;">
                    <img src="${iconSrc}" alt="icon" width="40" height="40" style="flex:0 0 40px; object-fit:contain;">
                    <div style="flex:1;">
                        <strong>${appTitle}</strong> <br>
                        <!--<small style="color:#666;">v${appVersion}</small>-->
                    </div>
                    <button onclick="uninstallApp('${escapedTitle}')">Uninstall</button>
                </div>`;
        });
    } catch (e) {
        console.error("Error loading apps", e);
    }
}

function createAppWindow(metadata, content, autoOpen = true) {
    // Extract data with defaults
    const title = metadata.title || "External App";
    const width = metadata.width || 400;
    const height = metadata.height || 300;
    const iconSrc = metadata && metadata.icon ? metadata.icon : 'YOUR PLACEHOLDER IMAGE'; // <--- Get icon

    // Create a Blob URL for the content to isolate it in an iframe
    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);

    // Create the DOM element with an iframe
    // REMOVED .appcont wrapper to fix layout issues
    const newApp = $(`<app data-title="${title}" appicon="<img src='${iconSrc}'  width='28' height='28'>">
        <iframe src="${url}" style="width:100%; height:100%; border:none;"></iframe>
    </app>`);
    
    // Set dimensions
    newApp.css({ width: width, height: height });

    // Append to desktop
    $('desktop').append(newApp);

    //setupWindow(newApp[0]); replace thoses lines with your own function to create a window.
    //setupTaskbar(newApp[0]); replace thoses lines with your own function to create a taskbar entry.
    
    // FIX: Apply resizable to the main window element, NOT .wincontent
    // FIX: Add pointer-events handling so iframe doesn't steal mouse during resize
    newApp.resizable({
        handles: 'n, e, s, w, ne, se, sw, nw',
        minWidth: 200,
        minHeight: 150,
        start: function(event, ui) {
            // Disable iframe interaction during resize
            $(this).find("iframe").css("pointer-events", "none");
        },
        stop: function(event, ui) {
            // Re-enable iframe interaction
            $(this).find("iframe").css("pointer-events", "auto");
        }
    });

    // Open the new app immediately only if requested
    if (autoOpen) {
        const id = newApp.attr('data-id');
        openWindow(id);
    }

    return newApp;
}

function uninstallApp(title) {
    try {
        let apps = JSON.parse(localStorage.getItem('orion_apps') || "[]");
        const initialLength = apps.length;
        
        // Filter out the app with the matching title
        apps = apps.filter(app => app.metadata.title !== title);
        
        // If an app was actually removed, update storage and reload
        if (apps.length < initialLength) {
            localStorage.setItem('orion_apps', JSON.stringify(apps));
            location.reload(); // Refresh to clear icons and windows
        }
    } catch (e) {
        console.error("Error uninstalling app", e);
    }
}
