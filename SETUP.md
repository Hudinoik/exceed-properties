# Running Exceed Properties Locally

Step-by-step setup for getting the app running on your machine in VS Code.

---

## Quick note on naming

There are two different Microsoft products with similar names:

- **Visual Studio Code (VS Code)** — a free, lightweight code editor. This is what almost everyone uses for React/JavaScript.
- **Visual Studio** — Microsoft's heavyweight IDE, mainly for C#/.NET. Works for React but is overkill.

These instructions assume **VS Code**. If you have Visual Studio (the big one), it works too — just open the project folder and use its terminal the same way.

---

## What you need installed first

**1. Node.js** — this is the runtime that actually runs the React app.

Go to https://nodejs.org and download the **LTS** version (the green button on the left). Install it with all default options. After installing, restart your computer (Node updates your system PATH and Windows sometimes needs a restart to pick it up).

To check it worked, open a fresh Command Prompt or PowerShell and run:
```
node --version
npm --version
```
You should see version numbers like `v20.x.x` and `10.x.x`. If you get "not recognized as an internal or external command", Node didn't install correctly — try the installer again.

**2. VS Code** — https://code.visualstudio.com/. Install with defaults.

When you first open VS Code, it'll suggest some extensions. The useful ones for this project:
- **ES7+ React/Redux/React-Native snippets** by dsznajder
- **Tailwind CSS IntelliSense** by Tailwind Labs
- **Prettier - Code formatter** by Prettier

---

## Setting up the project

**Step 1: Pick a folder for the project.**

Somewhere easy to find — e.g. `C:\Projects\exceed-properties` on Windows, or `~/Projects/exceed-properties` on Mac.

**Step 2: Open VS Code, then open that folder.**

`File → Open Folder...` → pick the folder you just made.

**Step 3: Open the VS Code terminal.**

`Terminal → New Terminal` (or press `` Ctrl + ` `` — that's the backtick key, usually below Escape).

A panel opens at the bottom showing your folder path.

**Step 4: Bootstrap a Vite + React project.**

Paste this into the terminal and press Enter:

```
npm create vite@latest . -- --template react
```

The `.` means "create here, not in a subfolder". When it asks if you want to continue with an existing directory, say yes (`y`).

When it finishes, run:

```
npm install
```

This pulls down React itself. Takes about 30 seconds.

**Step 5: Install the libraries the app uses.**

```
npm install lucide-react recharts
```

These are the icon library and chart library used by Exceed Properties.

**Step 6: Set up Tailwind CSS.**

This is the styling system. Run:

```
npm install -D tailwindcss@3 postcss autoprefixer
npx tailwindcss init -p
```

This creates two new config files: `tailwind.config.js` and `postcss.config.js`.

Open `tailwind.config.js` in VS Code and replace its entire contents with:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

Then open `src/index.css` and replace its entire contents with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
}
```

**Step 7: Drop in the Exceed Properties code.**

In the `src` folder, you'll see a file called `App.jsx`. Delete its contents and paste in the full contents of `ExceedProperties.jsx` (the file I gave you).

You also need to make one small edit. Near the top, find this block (around line 99):

```js
const useStoredState = (key, initialValue) => {
```

The current code uses `window.storage`, which only exists inside the Claude artifact preview. To make it persist data on your machine instead, replace the whole `useStoredState` function with this version that uses `localStorage`:

```js
const useStoredState = (key, initialValue) => {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setStoredValue = useCallback((newValue) => {
    setValue((prev) => {
      const valueToStore = typeof newValue === 'function' ? newValue(prev) : newValue;
      try {
        localStorage.setItem(key, JSON.stringify(valueToStore));
      } catch {}
      return valueToStore;
    });
  }, [key]);

  return [value, setStoredValue, true];
};
```

That's the only code change you need.

**Step 8: Delete some files Vite created that you don't need.**

In the `src` folder you can delete `App.css` and `assets/react.svg`. Then open `src/main.jsx` and check it looks like this — it should already, but verify the imports:

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

If `App.css` is still imported here, delete that line.

**Step 9: Run it.**

In the terminal:

```
npm run dev
```

After a couple of seconds you'll see:

```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  press h + enter to show help
```

Open http://localhost:5173 in your browser. The app should load with the navy sidebar and gold accents.

To stop the server, click in the terminal and press `Ctrl + C`.

---

## Working with the code

Once it's running, any changes you make to the source files auto-refresh in the browser (this is called "hot module replacement"). You don't have to restart anything.

VS Code keyboard tips while you're editing:
- `Ctrl + P` (or `Cmd + P` on Mac) → quick file open by typing part of the name
- `Ctrl + F` → find in current file
- `Ctrl + Shift + F` → find across all files in the project
- `Ctrl + /` → toggle comment on the current line
- `Alt + Shift + F` → format the current file (if Prettier is installed)

---

## Things that will still not work locally

**Jibble integration** — same CORS problem as in the preview. The browser still can't call Jibble directly from `localhost:5173` because Jibble's servers don't allow it. To make it work, you'd deploy one of the backend proxies from `JIBBLE-PROXY.md` (Vercel, Cloudflare Workers, or Supabase Edge Functions) and point the API Base URL field at your proxy. Everything else in the app works fine locally.

**DocuSign integration** — same story. Currently mocked. Would need a backend to talk to DocuSign's API.

---

## Common problems

**"npm is not recognized"** — Node didn't install correctly, or you didn't restart after installing. Re-run the installer and restart your computer.

**"Cannot find module 'react'"** — you skipped `npm install` after creating the project. Run it now.

**Page loads but everything is unstyled / no Tailwind** — `tailwind.config.js` content paths are wrong, or you didn't replace `src/index.css` with the Tailwind directives. Double-check Step 6.

**Page is completely blank with errors in the browser console** — open dev tools (F12), look at the Console tab. Most likely an import error. Copy the error message and you can paste it back to me to debug.

**Port 5173 already in use** — another Vite project is running. Either stop it, or Vite will offer you a different port (just press Enter to accept).

---

## Deploying it (when you're ready)

The easiest path to put this on the internet is **Vercel**:

1. Push the project to a GitHub repo
2. Go to vercel.com, sign in with GitHub, click "Add New Project"
3. Pick the repo
4. Vercel auto-detects Vite and deploys it

Cost: free for personal projects. URL will be something like `exceed-properties.vercel.app`.

That's also where you'd deploy the Jibble proxy from `JIBBLE-PROXY.md`, so both pieces can live in the same Vercel account.
