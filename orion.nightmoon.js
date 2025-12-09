$.getScript("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js")

/* --- .ori (Orion App Install) File System (ZIP based) --- */
function addOrionStart() {
const startMenuSection = `
<span id="StartLinkOrion" class="startLink"><span class="StringStartMenu3">Orion</span>
<div id="IconProgman" class="StartMenuMIcon IconSize32"></div>
<div class="StartMenuArrows">8</div>

<div id="OrionAppsMenu" class="submenu" style="margin-bottom: -135px;">

</div>
</span>
`
const $RimetApps = $('#RimetApps');
const targetElement = $RimetApps.children(':nth-child(3)');
targetElement.after(startMenuSection);
}

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
        createAppWindow(metadata, finalContent, false);
        loadInstalledApps();

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
const DB_NAME = "Nightmoon_Disk";
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
                $('#OrionAppsMenu').html("");
                $('.orionappsect').html("");
                const managerEntry = `<div id="openappOrionApp" class="startLink" onclick="openWindow('OrionApp');"><span class="StringStartMenu11">Orion App Manager</span><div class="StartMenuSIcon IconSize16" id="IconExecutable"></div></div>`
                $('#OrionAppsMenu').append(managerEntry);
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
                const appEntry = `<div id="openappOrion${app.metadata.title}" class="startLink" onclick="openWindow('Orion${app.metadata.title}');"><span class="StringStartMenu11">${app.metadata.title}</span><div class="StartMenuSIcon IconSize16" id="IconExecutable"></div></div>`
                $('#OrionAppsMenu').append(appEntry);

                // Display metadata and uninstall button in Orion App Section (with icon)
                const escapedTitle = (app.metadata.title).replace(/'/g, "\\'");
                const managerEntry = `
                    <div style="padding: 8px; border-bottom: 1px solid #ccc; display: flex; gap:8px; align-items: center;">
                        <img src="https://geocities.ws/nightmoon/assets/iconset/xp/IconExecutable32.png" alt="icon" width="40" height="40" style="flex:0 0 40px; object-fit:contain;">
                        <div style="flex:1;">
                            <strong>${app.metadata.title}</strong> <br>
                        </div>
                        <button onclick="uninstallApp('${escapedTitle}')">Uninstall</button>
                    </div>`;
                $('.orionappsect').append(managerEntry);

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

function createAppWindow(metadata, content, autoOpen) {
    // Extract data with defaults
    const title = metadata.title || "External App";
    const width = metadata.width || 400;
    const height = metadata.height || 300;
    const iconSrc = metadata && metadata.icon ? metadata.icon : 'YOUR PLACEHOLDER IMAGE'; // <--- Get icon

    // Create a Blob URL for the content to isolate it in an iframe
    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);


    // Create the DOM element with an iframe
    const newApp = $(`
    <div id="windowOrion${title}" class="window" onclick="focusWindow('Orion${title}')" style="top:10px;left:10px;">
       <div id="winOrion${title}-bar" class="window_bar noIcon">
	      <span class="StringOrion${title}">${title}</span>
	      <div id="close" title="" class="winBarButton" onclick="closeWindow('Orion${title}');"></div>
          <div id="maximize" class="winBarButton" onclick="maxiWindow('Orion${title}');"></div>
	      <div id="minimize" class="winBarButton" onclick="miniWindow('Orion${title}');"></div>
        </div>
        <div id="windowcontent" style="overflow-y: hidden; overflow-x: hidden;">
        <iframe src="${url}" style="width:100%; height:100%; border:none;"></iframe>
         </div>
    </div>`);
    
    // Set dimensions
    newApp.css({ width: width, height: height });

    // Append to desktop
    $('#Desktop').append(newApp);

$( newApp ).draggable({ 
cancel: "#windowcontent, #themePreview, .winBarButton"
});


    //setupWindow(newApp[0]); <-- replace this with a function that setups the window (draggable, title, buttons, etc...)
    //setupTaskbar(newApp[0]); <-- replace this with a function that setups the taskbar panel (icon, taskbar icon toggle)
    const newTaskband = `
    <div id="panelOrion${title}" onclick="focusWindow('Orion${title}');restoreWindow('Orion${title}');" class="taskband" style="display: none;">
    <div class="TaskbandIcon IconSize16" id="IconExecutable"></div>
    <span class="StringAboutName">${title}</span>
    </div>
`
    $('#taskbandContainer').append(newTaskband);

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
function createAppManagerWindow() {
    // This is the HTML from the middle of your original createAppWindow
    const managerApp = $(`
    <div id="windowOrionApp" class="window" onclick="focusWindow('OrionApp')" style="top:10px;left:10px;">
        <div id="winOrionApp-bar" class="window_bar noIcon">
            <span class="StringOrionApp">Orion App System</span>
            <div id="close" title="" class="winBarButton" onclick="closeWindow('OrionApp');"></div>
            <div id="maximize" class="winBarButton" onclick="maxiWindow('OrionApp');"></div>
            <div id="minimize" class="winBarButton" onclick="miniWindow('OrionApp');"></div>
        </div>
        <div id="windowcontent" style="overflow-y: hidden; overflow-x: hidden;">
            <div class="orioninstallersect" style="padding: 4px 0 4px 0;border-bottom: 2px solid;">
                <center>
                <input type="file" id="oriInput" accept=".ori" style="display: none;" onchange="handleOriFile(this)">
                <button onclick="document.getElementById('oriInput').click()">Install App (.ori)</button>
                </center>
            </div>

            <div class="orionappsect">
            </div>    
        </div>
    </div>`);

    // Append once
    $('#Desktop').append(managerApp);
        const managerTaskband = `
    <div id="panelOrionApp" onclick="focusWindow('OrionApp');restoreWindow('OrionApp')" class="taskband" style="display: none;">
    <div class="TaskbandIcon IconSize16" id="IconExecutable"></div>
    <span class="StringAboutName">Orion App System</span>
    </div>
`
    $('#taskbandContainer').append(managerTaskband);


    
    // Add drag functionality
    $( managerApp ).draggable({ 
        cancel: "#windowcontent, #themePreview, .winBarButton"
    });
    managerApp.resizable({
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
}
function orionInit() {
    addOrionStart();
    createAppManagerWindow();
    loadInstalledApps();
    console.log("Orion App System - Initialized")
}
