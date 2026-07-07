# DOOM Node Setup Guide

## Auto-download (recommended)

The DOOM node **automatically downloads** the required files if they're missing.

1. Add the **DOOM** node to your ComfyUI workflow
2. Wait 30–60 seconds on first run for the download to complete
3. DOOM launches automatically — no manual setup needed

The node checks for `DOOM.EXE` and `DOOM1.WAD`. If either is missing, it downloads DOOM Shareware v1.9 from archive.org, extracts the files into this folder, and starts the game.

### Files downloaded

| File | Description |
|------|-------------|
| `DOOM.EXE` | DOS executable |
| `DOOM1.WAD` | Game data |

**Source:** [DOOM Shareware v1.9](https://archive.org/details/DoomsharewareEpisode) on Archive.org  
**Legal:** Official free shareware version from id Software

---

## Manual setup

Use this only if auto-download fails.

1. Download [DOOM Shareware v1.9](https://archive.org/details/DoomsharewareEpisode)
2. Extract the archive and locate `DOOM.EXE` and `DOOM1.WAD`
3. Copy both files to:
   ```
   ComfyUI/custom_nodes/CrasHUtils/doom/
   ```
4. Restart ComfyUI and refresh your browser

---

## Keyboard controls

- **Click the game canvas** to capture keyboard input
- **Click outside the node** to release keyboard control

This lets you switch between playing DOOM and using ComfyUI without the keyboard getting stuck.

---

## Included behaviour

- Automatic file download on first run
- Keyboard focus managed correctly (click outside to release)
- DOOM auto-starts when files are ready
- Cleanup when the node is removed
- Clear status messages and error handling

Have fun playing DOOM while your images generate!
