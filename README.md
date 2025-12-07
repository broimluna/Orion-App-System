# Orion-App-Installer
Orion App Installer System, for use on "Web Desktops".

THIS IS STRICTLY FOR DEVELOPERS! 

The code available in root (orion.js) is the main file. It will need modifications to work with your system.

Make sure to have JSZip and jQuery loaded.

structure of a .ori file:

ROOT/<br>
metadata.json<br>
filename.jpg/jpeg/png<br>
ROOT/foldername/<br>
YOUR APP HERE<br>



metadata.json:
```{
    "title": "App Name",
    "width": 800,
    "height": 600,
    "run": "foldername/filename.html",
    "icon": "filename.png"

}```
