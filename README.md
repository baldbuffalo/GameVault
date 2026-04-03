# 🎮 GameVault

Browser-based Wii game launcher. Runs entirely in the browser using a custom Dolphin WASM build. Navigate with a Wii Remote over Bluetooth.

---

## How It Works

1. `index.html` (GitHub Pages) calls the GitHub API to find all `.rvz` files in your `games` release
2. Game covers appear automatically — click one to play
3. `emulator.html` loads the custom Dolphin WASM core from `dolphin-wasm/` and streams the game
4. Wii Remote connects via Bluetooth and is read as a standard gamepad

---

## Setup

### 1. Build the Dolphin WASM core

Go to your repo → **Actions** → **Build Dolphin WASM** → **Run workflow**

This compiles Dolphin to WebAssembly and commits the output to `dolphin-wasm/`.
The first build takes ~60 minutes. Subsequent builds use caching.

### 2. Edit `config.json`
```json
{
  "username": "your-github-username",
  "repo": "gamevault"
}
```

### 3. Dump your Wii discs to `.rvz`
Use **Dolphin** on PC: `Tools → Convert Files → RVZ`

> Only dump discs you physically own.

### 4. Upload `.rvz` files to GitHub Releases
1. Go to your repo → **Releases** → **Draft a new release**
2. Tag: `games` → click **Create new tag: games**
3. Drag and drop your `.rvz` files
4. Click **Publish release**

### 5. Add cover images (optional)
Create a `covers/` folder. Name images to match your `.rvz` filenames:
- `wii-sports.rvz` → `covers/wii-sports.jpg`
- Size: `400×533px` (3:4 ratio)

### 6. Enable GitHub Pages
Repo **Settings** → **Pages** → Source: `main` branch, `/ (root)` → **Save**

Your URL: `https://your-username.github.io/gamevault`

---

## File Structure

```
GameVault/
├── index.html                        ← Launcher UI
├── emulator.html                     ← Custom Dolphin WASM player
├── config.json                       ← Your username + repo name
├── covers/                           ← Optional cover images
├── dolphin-wasm/                     ← Built automatically by GitHub Actions
│   ├── dolphin.js
│   ├── dolphin.wasm
│   └── dolphin.data
└── .github/
    └── workflows/
        └── build-dolphin.yml         ← WASM build workflow
```

Game `.rvz` files live in **GitHub Releases**, not the repo folder.

---

## Wii Remote Setup

1. Hold **1 + 2** on the Wii Remote (or press the red sync button)
2. Pair via **TV Settings → Bluetooth**
3. Open the launcher — the green dot confirms it's detected
4. **D-pad** navigates, **A** launches, **Home** goes back

---

## Notes

- The Dolphin WASM core is built from source — this is experimental
- `.rvz` is preferred over `.iso` — same quality, much smaller file size
- Repo must be **public** for GitHub Releases to be accessible from the browser
- If the build fails, check the Actions logs and open an issue
