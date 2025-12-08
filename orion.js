/* --- .ori (Orion App Install) File System (ZIP based) --- */

async function handleOriFile(input) {
    const file = input.files[0];
    if (!file) return;

    try {
        const zip = await JSZip.loadAsync(file);
        
        // 1. Read metadata.json
        const metaStr = await zip.file("metadata.json").async("string");
        const metadata = JSON.parse(metaStr);
        
        // 2. Get the run command
        const runPath = metadata.run; 
        if (!runPath || !zip.file(runPath)) {
            throw new Error(`Entry file '${runPath}' not found in archive.`);
        }

        // 3. Read the HTML file
        let appContent = await zip.file(runPath).async("string");

        // 4. Inline Resources (images, CSS, JS)
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


        const finalContent = doc.documentElement.outerHTML;

        if (metadata.icon && !metadata.icon.startsWith('data:')) {
            try {
                const iconPath = resolvePath(runPath, metadata.icon);
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

// --- IndexedDB Helper ---
const DB_NAME = "DB Name";
const STORE_NAME = "installed_apps";
const DB_VERSION = 1;

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                // Use 'title' as the unique key
                db.createObjectStore(STORE_NAME, { keyPath: "title" });
            }
        };

        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject("DB Error: " + event.target.error);
    });
}

async function saveAppToStorage(metadata, content) {
    try {
        const db = await openDB();
        const rw = db.transaction(STORE_NAME, "readwrite");
        const store = rw.objectStore(STORE_NAME);

        const appData = {
            title: metadata.title,
            metadata: metadata,
            content: content,
            installedAt: new Date()
        };

        store.put(appData);

        rw.oncomplete = () => {
            console.log(`App "${metadata.title}" saved to Disk.`);
        };
        
        rw.onerror = (e) => {
            console.error("Save failed", e);
            alert("Failed to install app to disk.");
        };

    } catch (e) {
        console.error("Database error", e);
    }
}

async function loadInstalledApps() {
    try {
        const db = await openDB();
        const ro = db.transaction(STORE_NAME, "readonly");
        const store = ro.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
            const apps = request.result;
            if (!apps) return;

            apps.forEach(app => {
                // Load app but do not auto-open (false)
                createAppWindow(app.metadata, app.content, false);
                
                // --- UI Logic for "My Apps" list (if you have one) ---
                // You can add your list generation code here if needed
            });
        };

    } catch (e) {
        console.error("Error loading apps from disk", e);
    }
}

async function uninstallApp(title) {
    try {
        const db = await openDB();
        const rw = db.transaction(STORE_NAME, "readwrite");
        const store = rw.objectStore(STORE_NAME);
        
        const request = store.delete(title);

        request.onsuccess = () => {
            console.log(`App "${title}" uninstalled.`);
            location.reload(); // Refresh to clear icons and windows
        };
        
    } catch (e) {
        console.error("Error uninstalling app", e);
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
    const newApp = $(`<window data-title="${title}" appicon="<img src='${iconSrc}'  width='28' height='28'>">
        <iframe src="${url}" style="width:100%; height:100%; border:none;"></iframe>
    </window>`);
    
    // Set dimensions
    newApp.css({ width: width, height: height });

    // Append to desktop
    $('YOURTAG/ID/CLASS').append(newApp);

    //setupWindow(newApp[0]); <-- replace this with a function that setups the window (draggable, title, buttons, etc...)
    //setupTaskbar(newApp[0]); <-- replace this with a function that setups the taskbar panel (icon, taskbar icon toggle)
    

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
