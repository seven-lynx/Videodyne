# Videodyne Desktop (Windows and Linux)

A window around your Videodyne server's web UI, for a PC. Enter the server address once (for example `192.168.1.110:8420`, or `192.168.1.110:8420?key=YOURKEY` if it has a password) and it opens straight to the guide next time.

- **F11** fullscreen, **Ctrl+Shift+S** change server, **Ctrl+R** reload.
- Links to other sites open in your normal browser.
- Windows: `Videodyne-Desktop-<version>-win.exe` (portable) or the installer. Linux: the AppImage (`chmod +x` and run) or the `.deb`.

Download from the [releases](https://github.com/seven-lynx/Videodyne/releases) (tags starting `desktop-v`). The Windows build is not code-signed, so SmartScreen may ask you to click "More info, Run anyway".

This is a separate application from the pre-rename `WBTV` desktop client: installing it does not upgrade that one, which stays where it is until you remove it. Your remembered server address is carried over on the first start, from the old profile directory.

## Build it yourself

```sh
cd desktop
npm install
npm start               # run it
npm run dist:win        # on Windows
npm run dist:linux      # on Linux
```
