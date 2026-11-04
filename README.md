# Ajay AutoFlow

A Chrome extension that batch-runs prompts in **Google Flow**. Paste a whole storyboard once,
press **Start**, and AutoFlow generates each image or video in order and saves every file with a
clean, timecoded name, ready to drop into an editor.

Built by Ajay B J · YouTube: [@ExploreX-00](https://www.youtube.com/@ExploreX-00)

## Why I built it

Making one AI video in Flow can mean 30+ scenes. Each scene was the same routine: paste the
prompt, pick the character and voice, choose the model, click Generate, wait, download, rename
the file. AutoFlow does that loop for me so I can spend the time on the story instead.

## What it does

- **Prompt queue:** paste many prompts (one blank line between each) and run them one by one
- **Text to Video and Text to Image:** Veo 3.1 (Lite / Fast / Quality), Omni 1.1 Flash,
  Nano Banana (Pro / 2.1 / 2.1 Light); aspect ratio (16:9, 9:16, square…) and 1–4 outputs per prompt
- **Characters and voices:** picks `@Character` chips and voices by name, and can sync the
  voice library from your Flow account
- **Chains:** continue a video from the last frame, or keep editing the previous image
- **Run a range:** re-run prompts *n* to *m* only
- **Smart file names:** start a prompt with `#0:04` and the clip saves as `0-04.mp4`
  (two outputs → `0-04_1.mp4`, `0-04_2.mp4`), into a folder you choose
- **Download quality:** 720p / 1080p / 4K for videos, 1K / 2K / 4K for images
- **Per-prompt settings:** start a prompt with `voice: Puck`, `model: Veo 3.1 - Fast` or
  `ratio: 9:16` to change just that prompt
- **Scene import + templates:** paste a table from Google Sheets or a CSV (`tag`, `prompt`,
  `character`, `voice`, `model`, `ratio`, or any column) and optionally fill a template like
  `{character} {action}, cinematic, 9:16`
- **Pause, resume and crash recovery:** pause after the current prompt; if Chrome or Flow
  closes mid-batch, AutoFlow offers to continue from where it stopped
- **Run report:** done / failed / time for every prompt, **Retry failed only**, and a CSV shot
  list for your editor
- **Time left:** live estimate from how long your prompts actually take
- **Saved projects:** keep prompt sets with their settings; each project gets its own sub-folder
- **Caption files:** optional `.txt` next to each clip with the prompt that made it
- **Done alert:** desktop notification and a chime when a batch finishes
- **Self-check:** after a Flow update, see which controls AutoFlow can still find
- **English or Hinglish** panel
- **Survives Flow redesigns:** controls are found by text, labels and icons, with custom
  selectors and a Logs tab when something changes
- **Private:** no servers, no tracking. It only talks to Google Flow in your own browser

## Install (Chrome)

1. Download or clone this folder.
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and choose the folder that contains `manifest.json`.
4. Pin **Ajay AutoFlow** from the puzzle-piece menu.

## Use

1. Open [flow.google.com](https://flow.google.com) and sign in.
2. Click the AutoFlow icon to open the side panel.
3. Choose the mode, model and settings, then paste your prompts (blank line between each).
4. Press **Start AutoFlow** and keep the Flow tab open.

**Tips**

- In Chrome Settings → Downloads, turn **off** "Ask where to save each file".
- While it runs, Chrome shows "started debugging this browser". That's how the extension
  clicks and types for you; don't press Cancel.
- If a button isn't found after a Flow update, check the **Logs** tab, then
  Settings → Advanced → Custom selectors.

## Responsible use

AutoFlow only automates what you could do by hand in your own Flow account. Generated media
keeps Google's watermarks and SynthID. Follow Google Flow's terms and usage limits.

## Changelog

- **1.4.0:** Pause/resume with crash recovery, scene import from Sheets/CSV with templates,
  per-prompt voice/model/ratio, run report with retry-failed and CSV shot list, time-left
  estimate, saved projects with sub-folders, caption files, done notification, self-check,
  Hinglish panel.
- **1.3.0:** Cleaner build: removed the optional video corner editor; new README.
- **1.2.1:** Fixed a prompt-typing error after Flow redraws its editor; no longer picks an
  unrelated character when `@Name` isn't found.
- **1.1.0:** Updates for the new Flow UI: character auto-pick, voice selection, image chains,
  agent mode, new models, 30 built-in voices plus voice sync.
