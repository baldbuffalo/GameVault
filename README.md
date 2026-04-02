# 🎮 GameVault

Browser-based Wii game launcher for LG webOS TVs. No console needed — runs entirely in the TV browser via EmulatorJS (Dolphin core). Navigate with a Wii Remote over Bluetooth.

---

## How It Works

1. `index.html` (GitHub Pages) calls the GitHub API to find all `.rvz` files in your `games` release
2. Game covers appear automatically — click one to play
3. `emulator.html` loads EmulatorJS with the Dolphin WASM core and streams the game file
4. Wii Remote connects to the TV via Bluetooth and is read as a standard gamepad

---

## Setup (one time)

### 1. Edit `config.json`
```json
{
  "username": "your-github-username",
  "repo": "gamevault"
}
```

### 2. Dump your Wii discs to `.rvz`
Use **Dolphin** on PC: `Tools → Convert Files → RVZ`

> Only dump discs you physically own.

### 3. Upload `.rvz` files to GitHub Releases
1. Go to your repo → **Releases** → **Draft a new release**
2. Tag: type `games` → click **Create new tag: games**
3. Drag and drop your `.rvz` files
4. Click **Publish release**

That's it — the launcher auto-detects every `.rvz` file in that release. Upload a new file and it appears automatically next time the page loads.

### 4. Add cover images (optional)
Create a `covers/` folder. Name images to match your `.rvz` filenames:
- `wii-sports.rvz` → `covers/wii-sports.jpg`
- Size: `400×533px` (3:4 ratio)

If no cover is found the launcher shows a coloured placeholder with an emoji.

### 5. Enable GitHub Pages
Repo **Settings** → **Pages** → Source: `main` branch, `/ (root)` → **Save**

Your URL: `https://your-username.github.io/gamevault`

---

## File Structure

```
gamevault/
├── index.html       ← Launcher UI (auto-scans releases)
├── emulator.html    ← EmulatorJS player
├── config.json      ← Your username + repo name (edit this)
├── covers/          ← Optional cover images
│   └── wii-sports.jpg
└── README.md
```

Game `.rvz` files live in **GitHub Releases**, not the repo folder.

---

## Wii Remote Setup

1. Hold **1 + 2** on the Wii Remote (or press the red sync button inside the battery cover)
2. Pair via **LG TV Settings → Bluetooth**
3. Open the launcher — the green dot in the corner confirms it's detected
4. **D-pad** navigates, **A** launches, **Home** goes back

---

## Adding More Games

Just upload more `.rvz` files to the same `games` release on GitHub. Refresh the launcher and they appear automatically.

---

## Notes

- **First load** downloads the Dolphin WASM core (~50 MB) and caches it — subsequent loads are instant
- `.rvz` is preferred over `.iso` — same quality, much smaller file size
- Wii U emulation is not yet available in WebAssembly — when a WASM core is released, just add `"core": "wiiu-core-name"` support
- Repo must be **public** for GitHub Releases to be accessible from the browser
