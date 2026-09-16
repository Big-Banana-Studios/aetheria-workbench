# Aetheria Workbench

One browser app that is the family's everything-desk: research, writing, game
dev for *Paperless*, physics and coursework, and Aetheria frequency work, all
in front of the lab's Qwen on the Olares One behind LiteLLM, with an on-device
fallback when away from home. The third sibling of the [Aetheria Reader](https://github.com/big-banana-studios/aetheria-reader)
and [Mira](https://github.com/big-banana-studios/aetheria-companion): a static
site on GitHub Pages, no backend of its own, MIT.

- **Brains, in order:** the lab (any OpenAI-compatible endpoint; the Qwen
  instance on the Olares, LiteLLM, gpt-oss on the Khadas), then on-device
  Gemma 4 E2B on WebGPU (from Mira) when the LAN box cannot be reached.
  Auto-detected; the chip in the header says which is live.
- **Eight desks:** Research, Writing, Paperless, Physics & study, Aetheria,
  Mira, Open Mic and Suno. Each is a system prompt in `prompts/<desk>.md`, editable without
  touching code, with its own conversation, thinking-mode default, district
  colour and pinned voice.
- **Shared:** streaming markdown with code copy buttons and KaTeX, image drop
  for the vision model, thinking tokens folded away and never read aloud,
  read-aloud with Kokoro (the Reader's pipeline), voice input with Silero and
  Moonshine (Mira's), project files with in-browser RAG (pdf.js, mammoth,
  EmbeddingGemma), a memory jar, `/` commands, export to `.md`, handoff to
  Claude Code and to Hermes over a Discord webhook, the 432 Hz bed and rain
  behind one toggle, the district or paper theme, and a diagnostics panel.

## Run it

```
npm install
npm run dev          # http://localhost:5174 (and on the LAN)
npm run build        # static site in dist/
npm run check        # Node-only checks: cube data, think parser, splitter, sprite manifest
npm run serve        # serve dist/ over plain http on the LAN (see "Network setups")
```

On a Windows PC, `tools/launch_pc.cmd` is the build-and-serve pair as a
double-click: it runs the PC runtime host (`tools/pc_runtime.mjs`, also
`npm run pc`), which serves `dist/` on http://localhost:4173 (installing and
building first if it has to), opens the app in a Chrome or Edge app window,
and closing its console window stops the server and any local model with it.
A second double-click while it is running just opens another window. Point
a Desktop shortcut at it with `tools/workbench.ico` as the icon and "Run:
Minimized" so the console stays out of the way on the taskbar.

### The local runtime on the PC

The PC does what the Android app does: it runs llama.cpp's server for a GGUF
on this machine. A browser cannot start a process, so the runtime host (the
Node process that serves the page) does it, under `/runtime/<method>` on the
page's own origin, behind the same contract the phone's plugin speaks
(`src/native.js`). The app finds the host at boot and Settings → Local
runtime appears. There:

- **Builds.** One click installs llama.cpp's own Windows build: CUDA for an
  NVIDIA card (about 650 MB with the CUDA runtime), Vulkan for any other card
  (30 MB), CPU (20 MB); the latest numbered release on GitHub, unpacked into
  `%LOCALAPPDATA%\AetheriaWorkbench\llama\<backend>\`. A build already on
  the PC is found too (`Desktop\llama.cpp`, the PATH, or one you point at
  with "Use a llama-server.exe already here"). Auto tries CUDA, then Vulkan,
  then CPU, each with the first build that carries it; a build's `--help`
  says which flag spellings it takes (`--no-mmap` on an older build,
  `--load-mode none` on a newer one).
- **Models.** Downloads go to `%LOCALAPPDATA%\AetheriaWorkbench\models\`
  (the catalog, or any GGUF URL; an interrupted download resumes). A GGUF
  already on a disk is used where it is: "Use a GGUF already on this PC" (a
  file dialog), or its path pasted in the URL box. Delete only forgets such
  a file.
- **The plan.** Before a start the model's header is read and
  `src/launch.js` plans the launch as on the phone, plus the card: a model
  whose weights and cache fit the card's memory goes on it whole
  (`-ngl 99`); a bigger one gets `-ngl N` for the layers that fit and runs
  the rest on the CPU, slower; a MoE keeps its experts on the CPU
  (`--cpu-moe`). The verdict is the sentence under the model picker.
- **The server** listens at `http://127.0.0.1:8080/v1` with no key, as on
  the phone, so Mira in a browser tab on the PC uses it too. Start makes it
  the brain (the lab steps aside until Stop, which puts auto back); closing
  the launcher's window stops it.

The `/runtime` API answers loopback callers from this app's origin only; the
static files still go to the LAN, so a phone can open the PC's app. The
same host serves `tools/ui_check.mjs`, with the fake lab standing in for
`llama-server`, so the panel, the plan, Start, a turn and Stop are checked
without a model.

Deploy: push to `main` and `.github/workflows/deploy.yml` publishes `dist/` to
GitHub Pages under `/<repo>/`, the same as Mira. For a custom domain set
`BASE_PATH=/` when building.

Nothing is fetched from a CDN. The ONNX Runtime WASM files are copied from
`node_modules` into `public/ort/` on install and build (`tools/copy_ort.mjs`),
pdf.js and mammoth are vendored from the Reader, and the models come from
Hugging Face into the browser's cache the first time a feature is used.

## The four network setups

The app is served over **https** on GitHub Pages. An https page can call an
https endpoint, and plain http on loopback (the browser treats 127.0.0.1 as
secure: this phone's in-app runtime, a PC's llama-server); a plain http box
on the LAN is "mixed content" and the browser refuses the call silently,
unless Chrome is asked properly (setup 4). Diagnostics says which is
happening, and the Test button explains a failure in words. Four ways to run:

**1. The Olares, over https (the clean one).** The Qwen instance runs as a
*llama.cpp Engine Base* app managed by Model Console. Its URL comes from
Model Console → Status → Service status with **Connection source = "Devices on
your network"** and **API format = OpenAI-Compatible**: an https URL of the
form `https://<id>.laresprime.olares.com/v1`. Paste that as the endpoint,
copy the model name exactly as Model Console shows it (for example
`unsloth/Qwen3.8-27B-GGUF:Q4_K_M`), any non-empty key unless you set one, and
press **Test connection**. Off the home network, LarePass VPN on the client
gives the "Remote" source. If LiteLLM is installed on the Olares from Market
it gets a laresprime https URL of its own, which is the cleanest single
gateway for every app in this family.

Engine flags live in the instance's `ENGINE_ARGS` environment variable
(Settings → Applications → the app → Manage environment variables), not on a
command line. Recommended:

```
--jinja --reasoning-format deepseek -fa on -c 65536
```

`--reasoning-format deepseek` puts the model's thinking in a separate
`reasoning_content` field, which the workbench folds into a collapsible block;
`--jinja` is what makes `chat_template_kwargs: {enable_thinking}` work, which
is how a desk switches thinking on or off. Check Model Console →
Configuration → Advanced parameters, and that GPU residency shows **Full GPU**.

**2. A plain http box (the Khadas, the 3090 machine), from a local server.**
Serve the built app over http on the LAN and the browser is happy to call an
http endpoint:

```
npm run build
npm run serve            # npx serve dist -l 5180
# or: cd dist && python -m http.server 5180
```

then open `http://<this machine>:5180` on any device on the LAN.

**3. Any endpoint, behind https.** Put LiteLLM behind Caddy or Tailscale:

```
# Caddyfile
litellm.home.example {
    reverse_proxy 127.0.0.1:4000
}
```

or `tailscale serve --bg 4000` on the box running LiteLLM. Then the GitHub
Pages app can call it from anywhere. Installing the app (browser menu →
Install) also lets it open from cache, which is the third way round.

### LiteLLM model registration

A `config.yaml` that fronts the Olares Qwen and the Khadas gpt-oss through one
gateway, with CORS open to the app's origin:

```yaml
model_list:
  - model_name: qwen3.8-27b
    litellm_params:
      model: openai/unsloth/Qwen3.8-27B-GGUF:Q4_K_M
      api_base: https://<id>.laresprime.olares.com/v1
      api_key: anything
  - model_name: gpt-oss-20b
    litellm_params:
      model: openai/gpt-oss-20b
      api_base: http://khadas.local:8080/v1
      api_key: none
  - model_name: search
    litellm_params:
      model: perplexity/sonar
      api_key: os.environ/PERPLEXITYAI_API_KEY

litellm_settings:
  drop_params: false          # keep chat_template_kwargs on the way through

general_settings:
  master_key: sk-workbench
```

```
litellm --config config.yaml --port 4000
```

CORS: LiteLLM allows all origins by default. Give the workbench the base
`http://<host>:4000/v1` (or the https one) and the key. The model picker in
Settings is filled from `GET /v1/models`, so every model registered here is a
choice on every desk. The `search` model is what `/search` on the Research
desk uses if Settings names it.

**4. A plain http box on the LAN, from the https site, in Chrome.** Chrome
138 and later take the address space named on the request
(`targetAddressSpace: "local"`, which `src/lab.js` sets for a LAN box:
`fetchInit` / `labFetch`, taken back from Mira on 2026-09-09) as consent
to call a private http address from an https page, behind a one-time
prompt under the address bar asking whether the site may reach devices on
your network. Allow it and press Test again; if it never asked, look for
the site's permission in the address-bar controls. Loopback needs only the
permission, no address space. Measured on Chrome 152 from Mira for the
loopback case; treat the LAN case as "try it, and fall back to 2 or 3".
Other browsers still refuse, and the Test button says so.

### Big MoE models on the 64 GB Khadas

The Mind Pro has 64 GB of LPDDR5X shared with its Arc iGPU and no VRAM of
its own, so a mixture-of-experts model about the size of the RAM (gpt-oss-120b)
runs on one thing: llama.cpp memory-maps the weights (`--load-mode auto`, the
default; `--mmap` on older builds) and the OS pages the experts in from the
SSD as the tokens ask for them. Slow, but it runs. What breaks it is pinning:
never `--mlock` (`--load-mode mlock`) and never `--no-mmap` for a model that
does not fit. Keep the rest of the footprint small, the context and the KV
cache above all:

```
llama-server -m gpt-oss-120b.gguf --host 0.0.0.0 --port 8080   --jinja --reasoning-format deepseek -fa on -c 32768 -ctk q8_0 -ctv q8_0
```

With a real GPU on the Thunderbolt dock the flag is `--cpu-moe` (`-cmoe`):
the experts stay in system RAM and the attention and dense layers go to the
card, which is where the speed comes back; `--n-cpu-moe N` (`-ncmoe N`)
keeps only the first N layers' experts on the CPU, so lower N until the VRAM
is full. Every flag has an environment-variable twin (`LLAMA_ARG_CPU_MOE=1`,
`LLAMA_ARG_N_CPU_MOE=N`, `LLAMA_ARG_LOAD_MODE=mmap`), which is the toggle on
a box started from a service file, and on the Olares it goes in
`ENGINE_ARGS`. Names checked against the llama.cpp checkout in
`native/llama.cpp` (2026-09-08), where the old `--mlock`/`--mmap` spellings
still work with a deprecation warning.

The phone's in-app runtime makes the same call by itself: it reads the
model's GGUF header when you pick it and shows the plan under the picker
(loaded into memory when it fits with room, mapped from storage when tight or
too big, the experts on the CPU for a mixture of experts on the GPU), with two
settings to overrule it. See `docs/NATIVE.md`.

## Mira on the stage

Mira stands on her street across the top of every desk, drawn by the
companion's own renderer and scene (`src/sprite/renderer.js`,
`src/scene/scene.js`, the courier atlas, all copied from Mira unchanged) and
driven by the desk instead of a microphone: listening while you type or hold
the mic, thinking while the model works, speaking while Kokoro plays (her
mouth follows the output level, the aura pulses on each sentence), idle
otherwise, and a smoke break and a nap when it has been quiet a long while.
The district behind her follows the desk (Research and Physics in the Stack,
Writing in the Market, Paperless in the Undercity, Aetheria wherever the
selected frequency sits) and she walks there when you switch. On her own
desk the model opens each reply with a mood tag, stripped before it is shown
or spoken, and her stage plays the mood's gesture. Her street is Mira's own
as of 2026-09-09: the road is the bottom quarter of the stage with her feet
partway down it and the signs hanging at fist height, and after a quiet
spell she paces it edge to edge, stopping for a smoke on the way (generated
fresh each time by `renderer._strollSteps`, tuned in the manifest's
`gestures.stroll`); the smoke break and the nap wait for a stroll to end.

She speaks up herself after a quiet spell: with a brain live, a line the
model writes that picks up the thread of the last exchange on the desk
(the last message and its reply go in the prompt) from an angle that
rotates through a dozen (a second thought, the detail nobody noticed, what
the reply left out, where the subject ends up followed to the end, a
memory it dragged up, the money part, a confession it earns), told what
she already said tonight; a repeat or an echo, or no brain at all, falls
back to one of her own quiet-spell lines (`src/thoughts.js`: the fridge
hum, the one sock on the stairs; no game lore). Never a question; three
times at most until you answer, spoken if the voice is loaded.

**Who she is** (2026-09-11, `mira-core.md` one folder up, the source of
`prompts/mira-core.md`): the friend in the Workbench with Joe and Alisha,
modeled on Alisha's way: she asks the question everyone's avoiding, names
what a thing costs, cuts fluff without apology, wants jokes not vibes, and
is an honest mirror. Stoic (say "that sucks" once, then the plan); a
storyteller with swagger on a stage; a sailor's mouth used for rhythm and
never as the joke, never a slur, never at anyone's real wounds; Bob Ross
eyes (paint it specific: the orange parking-lot light, the fridge hum at
2 a.m.; the image is the punch); kitchen-at-midnight slang; no flattery, no
therapy-speak, no pretending to be sure. No Paperless lore in everyday talk
or on stage: she is the face on the box art, one dry wink and on; the
courier voice belongs to the Paperless desk. No comedian is named in any
persona file (describing the mechanics works; naming makes a small model do
impressions). Her desk's tagline and her quiet-spell lines follow.

**She saves to the memory jar herself.** On her desk the prompt carries a
small protocol (`JAR_PROTOCOL` in `src/memory.js`): a `[jar: the note]`
line at the very end of a reply, one note at most, two short lines at
most, for what keeps the flow alive (what you are working on, decisions,
names, running jokes, what you said you want next), never health or money.
`takeJar` strips the line as it streams, so it is never shown or spoken; a
repeat is dropped; the note lands in the jar marked as hers and the message
wears a small **jarred** chip (hover for the note). The jar goes into every
desk's prompt as before, and into her quiet-spell prompt, with a line
telling her to pick up where you were like a friend who remembers, not a
receptionist reading a file. The Memory tab deletes any line.

Her **quick reactions** are the short things a person says while reading
over your shoulder, "Sheesh.", "Get a load of this guy.", "Christ, that's
a lot. Give me a second." A message is classified by what it is (a wall of
paste, a shout, a swear, bad or good news, a link, a picture); a specific
kind gets a reaction about seven times in ten, a plain message about one
in seven. When a brain is live the **model riffs** a fresh one: a short
call with the small persona and the shelf's examples as "the kind of
thing", twenty-four tokens, two and a half seconds at most, thrown out if
it is long, a question, or a copy of the examples. The **bank** in
`src/barks.js` fills in when the riff is slow or there is no brain, and
alone for the "slow" shelf (the box has taken more than seven seconds to
start) and for a heckle on the open-mic stage, cycling so nothing repeats
soon. The line is a bubble over the stage with her mood's gesture, spoken
if the voice is already loaded. The same bank is quoted in the personas so
the model's own openers match. Settings → Mira switches it off. Settings → Mira has the
switches: the stage, every desk or only hers, the street, the storm, the
smoke breaks, the quiet-spell habit, her reply length (fuller on the home
lab by default, quips on a small model), and her **persona length**: which
of `prompts/mira-short.md` (about 480 tokens), `prompts/mira.md` (about
900), `prompts/mira-long.md` (about 1,200) and `prompts/mira-core.md`
(about 2,700, the whole core with the calibration samples) her desk is
told. Auto takes the core on the lab, the long one on an in-app model of
12B or more and the standard one otherwise; a prompt edited on this device
wins over the preset until it is reset. The four files began as copies of
Mira's `personas/` folder; since 0.3.18 the Workbench is the lead and its
copies are **rated M**, for mature: the mouth is her register, not
seasoning, sex and bodies said plainly, no disclaimers, no clean version
unless asked (the reason her plain-chat sets came out PG-13). Mira's own
app keeps its PG-13 copies, so the two no longer match on purpose; the
smoke test checks the rating here and only the premise line against her
copy. `/stage` and
`/quiet on|off` do the same from the composer.

Mira, served from the same origin, reads this app's settings at boot when
she has none of her own: the lab endpoint (`workbench.settings.lab`) and an
edited Mira prompt (`workbench.settings.desks.mira.prompt`). Those two keys
stay as they are.

The header keeps only the desk name and the brain chip; everything else is
in the **desk menu** (☰): thinking, detect the brain again, read aloud, the
stage, this desk's prompt and settings, the model and brain pickers,
export, the handoffs, the voice companion (which opens in its own tab now),
ambience, the paper theme and clear.

The chip shows a short alias of the model (`unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL`
reads `Qwen3.8-27B · UD-Q4_K_XL`; a GGUF file name loses its extension the
same way) with the full name in its tooltip and, on a tap, opened to two
lines; the number at the end is the **ping**, the round trip to `GET
/models`, and never generation speed: Diagnostics has the first-token time
and the tokens per second of the last turn. The chip shrinks and
ellipsizes before it can ever widen the header or push ☰ off the screen.

## Mira's open mic

Two desks and a stage, from `updated-mira-open-mic-design-brief.md`
(2026-09-11). **Open Mic** is her stand-up: the persona in
`prompts/open-mic.md` (everyday Mira with the leash off, on a dive-bar
stage: a storyteller with swagger who tells stories in scenes, does the
voices, escalates until the room is gone and pays off a callback, with a
surgical second gear that takes one everyday word apart, the two
alternating through a set; adult, dark, crude; punching up or at herself,
never at anyone for what they are; real life only, sex, money, family,
work, the VA, the internet, never the game: she is not the courier up
here, and the Paperless desk's prompt is never loaded on this one) with
the structure baked in: every bit is premise, escalation in threes, turn,
tag;
punchlines shorter than setups; one target per bit; one unprompted aside
per bit (`{aside}`); the intensity curve, never starting at the shriek.
`/five` writes a tight five, `/lines` a one-liner pack you can star and
sort, `/heckle <text>` is crowd work in two lines, `/punchup` takes a pasted
draft and returns it as a set plus a card with the diff and one note per
change, `/clean on` swaps the profanity for her bar slang. Every set is
read by the **linter** (`src/openmic/set.js` for what a program can see:
repeated paragraphs by hash against earlier sets, two asides in a bit,
unknown tags, a punchline longer than its setups; then
`prompts/open-mic-linter.md`, a short JSON-only call with thinking off,
for the structure, the guardrail and the lore rule: anything from the game
is rewritten as real life) and rewritten once when it fails; the
card under the set says "linter: clean" or how many notes and that it was
rewritten, and keeps the draft before. The card also computes the runtime
(150 words a minute plus a beat per sentence) and offers Perform, Package
and Song.

The model emits **pose tags** inline (`{pace}`, `{lean}`, `{shriek}`,
`{deadpan}`, `{aside}`); the transcript shows them as small badges, the
voice never says them, and the **stage** reads them. `/perform` (or
Perform on the card) opens a full-screen overlay: a dive-bar back room
(the tiles are ours, the setting is any bar, not the game) drawn by Mira's
own renderer with a scene of its own (`src/openmic/mic-scene.js`:
brick wall, one hot light on a cord, a mic stand, silhouetted heads), her
sprite centre-stage with the stage-only poses as gestures over the
speaking state (`STAGE_SPRITES.md` lists the frames each borrows and the
ones AutoSprite should draw), the mouth on Kokoro's output as everywhere
else. A performance is a **timeline**: the set split per bit and per
sentence, one Kokoro clip per line, cached by text in IndexedDB so nothing
is ever synthesized twice. An aside dims the light and slows the voice;
the shriek flares the aura and the light; the deadpan freezes her for the
tag and the **room** (a few synthesized crowd reactions, `src/openmic/room.js`,
behind a slider that defaults low) laughs on the drop; the end is a bow.
**The room, since 2026-09-12,** is recorded people: laughs from a room of
eight hundred, a canned laugh, a small group, and one person in the corner
who laughs a beat early, picked by the size of the laugh (a chuckle on a
shriek, a real one on a deadpan tag, the room gone at the end of a bit)
with a little pitch and level variation; applause on the bow; and a café
murmuring behind her as a looped bed that ducks while she speaks (all from
Wikimedia Commons, public domain, CC0 and CC BY, credited in
`public/assets/room/CREDITS.md`; the murmur under a laugh and the swell are
still synthesized, and the old synthesized laugh fills in until the
samples load). One switch (the box beside the room slider on the stage, or
Settings → Open mic) turns the whole room off; the slider sets how much.
**Asides** carry their remark inside the braces now, `{aside: the remark}`
(one or two sentences count as one aside; the bare `{aside}` in front of a
sentence still works). On the stage the aside is a beat of its own: she
leans in, lands the quip, and then says her tag, "You can put that aside."
(`ASIDE_TAG` in `src/openmic/set.js`, added by the parser as its own line;
a tag the model wrote itself is not doubled; empty switches it off). The
asides are seeds: the prompt and the linter ask the closer, the last bit of
a set, to bring every one of them back and connect them into the final
punchline, which is also the callback to bit 1. **⤓ Audio** on the stage renders every line (the phone's
Qwen voice or Kokoro, cached) and lays them on the timeline as one WAV, the
voice alone; on the phone every export (the video, the audio, the package)
lands in Downloads/AetheriaWorkbench through the plugin, because the
WebView's own download does not deliver inside the app. The aura and its
rings sit under her feet now wherever she stands: her renderer reads each
frame's figure from the atlas once, so a lean, a cigarette or a mirrored
frame no longer leaves her beside the rings (Mira's copy has the same
change).

**The stage's audio panel** (🔊 audio under the transport) holds the room
switch and slider, the rain switch, **inside** (the rain heard from inside
the club: a lowpass on it, half the level, the thunder a low rumble; off,
the street as on her desk) and the 432 bed, the same settings as Settings
→ Open mic. **The video is the stage's own now** (`src/openmic/recorder.js`):
the canvas frames at 30 a second (scaled to at most 1080 on the short
side) and the audio graph go through WebCodecs, the platform's H.264 and
AAC encoders (hardware on the phone), and are muxed here into a standard
MP4 with the index at the front (mp4-muxer), so the clip no longer depends
on the browser's MediaRecorder, whose MP4 the phone's WebView did not
deliver playable. Where WebCodecs cannot encode H.264 (headless Chrome, an
old build) the recorder probe says so and MediaRecorder's WebM is the
fallback; the status line names the format while it records, and
Settings → Open mic (or "video" in the stage's audio panel) can force
WebM, which plays in Chrome and most players, if a phone's MP4 misbehaves.
**The mouth** on the stage is a rule now, not a flavour: the prompt says every
bit swears and a story about sex or a body says what happened, the linter's
rule 11 flags a clean bit (skipped when clean edit is on), and the `/five`
brief asks for it.

**The dumpster fire** (0.3.21, 2026-09-14). The sets were still coming out
beige and the reason was in the prompt, not the model. The two register
samples (the Derek bit, the "unlimited" riff) carried one "ass" in 440 words,
0.2 swears per hundred, and a joyful tone, while the rules above them asked
for the mouth in every bit; a model copies the samples, not the rules, so a
Qwen3.5 9B on the old prompt wrote 926 words about rent with no swear in
them. Samples are also a trap on a small model: asked about the VA, the same
9B returned the sample VA bit nearly word for word, and the phone's Gemma 4
E4B heretic, given twelve short sample lines instead, pasted them back as
the set, one line per bit, and cut every set to 400 words because the lines
were short. So the stage prompt now carries **no sample bits at all**. The
voice is rewritten in the user's words: "fuck it, gather round the dumpster
fire", dark observational comedy with a melancholic edge, the system
bringing her down and her funnier for it, the badass bitch who does not say
please and does not bend the knee, sassy, quick, the filth with no off
switch and tasteful the way a knife is; the mouth's floor is three a bit;
one bit a set is about sex or her body, said plainly; a (beat) is two a bit
at most (the stage turns each into a full pause, and a 4B was writing one
after every sentence); the closer never recaps; and a "register, checked"
paragraph replaces the samples (if it could air on network television, if it
describes instead of turning, if the last line is a hug, it is not
finished). Measured on the Gemma heretic through llama-server with the
bench, five-minute briefs: old prompt 750 to 950 words at 1.3 to 2.3 swears
per hundred with hug endings ("the best goddamn view"); the new prompt 590
to 810 words at 1.7 to 2.0, original names and targets, the tired systemic
register ("It was about who held the pen", "you're a quarterly payment
plan"), and the desk's linter-and-rewrite pass keeps the mouth (2.0 before,
2.1 after). The register lines live in `mira-core.md` (the lab's persona,
a big model, no pasting) as her stage samples, and the smoke test measures
them with the bench so they cannot go beige unnoticed; the four persona
copies say "a melancholy edge, no self-pity" where they said "joyful, never
bitter". The earlier default survives as the **gloves off** dial. The model
still sets the ceiling: a 4B writes the register but not many real
punchlines, and a stock Qwen sands the mouth down whatever the prompt says.

**The asides on a small model** (0.3.22, 2026-09-14). The Gemma heretic
writes the register now but mishandles the aside in four ways, and the
parser (`src/openmic/set.js`) takes each of them in its stride rather than
hoping the prompt lands: she writes "You can put that aside." herself after
the braces (the stage added its own, so she said it twice; now her line is
the tag, and a "(You can put that aside.)" written as a direction is
dropped); she drops the tag into the middle of a sentence ("…look up at
that bulb, {aside: it's blinking again}", so the lead-in was leaned-in and
read slow; `splitLines` now cuts the paragraph at a mid-sentence tag and the
lead-in stays a plain line in her voice); the closer brings the earlier
asides back as new `{aside: …}` tags (she leaned in and tagged each again;
an aside whose remark an earlier bit already made, by six-word overlap, is
now a callback: plain line, no lean, no tag); and she appends a notes list
under a `***` rule without a heading ("*   **Bit 2:** Added: {aside: …}"),
which became an extra bit performed with four asides in it (a list line
that starts "Bit N", "aside N", "closer", "cut", "added", "moved" or "kept",
or a bare "Notes:", ends the set). She also skipped the aside in about half
her bits, so the local linter now flags a bit with none (in a set of three
or more) and the rewrite pass adds it. The prompt's aside rule says the
same things in words (between two sentences, never the tag yourself, the
closer's payoffs as plain lines). Smoke fixtures cover all five.

**Dialling the voice in** (2026-09-12). The stage prompt's voice, the two
paragraphs "Who you are up here" and "The mouth on you", sits between two
markers in `prompts/open-mic.md`. The file's voice from 0.3.15 to 0.3.20 was
**gloves off** (the **gloves** dial now): the raw storyteller meets the
filthy, sassy, stoic one. Sexually charged and
unbothered about it, adult rated, the observation messenger who takes the
topic and finds the ugly true thing under it, shines the light on the dark
however pissed off it makes her, calls out lil dick energy wherever it
lives and the corpos selling everyday people out, and never softens: no
apology, no disclaimer, no "just kidding", no moral, no hug at the end.
The one rule of the mouth stays: never a slur, never at anyone for what
they are, and everybody in the sex material is grown. The rules of a bit
carry "Nothing soft" now, the model linter's rule 12 (`soft`) and the
local "no softening" check catch the wink, the apology and the moral, and
a set that has one is rewritten. `src/openmic/voices.js` holds four
dials to compare against, each swapping into the marked region and
leaving the rules, the shape and the register samples alone: **gloves
off** (the 0.3.15 default), **stoic
filth** (the earlier default: calm, deadpan, the filth in the picture, a
thought under every joke), **two gears** (the flat weather report and the
incredulous run) and **raw storyteller** (the arena special). `/dialin
[about]` writes one two-minute brief through the file's voice and every
dial with the brain in front of you, each set on its own card (Perform
works on each), then a table side by side: `src/openmic/bench.js` counts
words, runtime, swears per hundred words and distinct ones, explicit
words, similes and sense words, softeners, sentence length and the local
linter's notes. Rough numbers, a critic they are not, but over one brief
they show what each dial moves. **use** under the table makes a voice the
desk's prompt (`settings.desks.openmic.prompt`, undone by the prompt
editor's Reset to the file), `/voice` lists and switches, and the model
matters as much as the words: an abliterated Gemma will swear where a
stock Qwen sands it down. Before 0.3.14 none of this reached the model:
the desk's id is `openmic`, its file is `open-mic.md`, and the loader
matched by id, so every stage set ran on a one-line fallback prompt. The
desk names its file now and both test suites check the prompt loads.

**Spoken spellings** (2026-09-12). A synthesizer runs "goddamn" together
into one flat word, so it is written and said "god-damn", the two beats
she means: `src/spelling.js` hyphenates it (goddamned, goddammit too, case
kept), the stage's lint pass spells every set that way before the linter
reads it, the prompt's word list uses it, and the speech cleaner applies
it to anything read aloud, a reply or an older set, so the text and the
delivery agree. The bench counts it either way.

**Anything performs.** Every reply that has a couple of spoken lines
carries a ◈ Perform tool beside copy and read-aloud, on any desk: it is
parsed as a set (no headings is one bit) and put on the stage. On the Open
Mic desk a set written in plain chat ("write me a bit about landlords")
gets the full set card, Perform, Package and Song, as a `/five` would; the
linter runs only for the commands. **Minutes are a rule.** `/five [minutes]
[about]` (five unless a number says otherwise) and `/monologue [minutes]
[about]` (ten; one subject followed the whole way, the bits its scenes,
eight to fourteen of them, the asides seeding the closer) tell the model
the words they take (165 a minute of stage time) and the card shows the
runtime against the target; a set under 80 percent of it, or over 135, is
a linter note and gets the one rewrite with the minutes restated. The
stage prompt carries the same arithmetic, because short was the common
failure (a five came out at three and a half).

**The voice renders ahead** (2026-09-12). A voice slower than real time
(the phone's Qwen) used to leave a gap before every line. Now the player
renders clips in order ahead of the playhead, from the moment Play is
pressed: the set starts once about twelve seconds are in, and whenever the
playhead catches the renderer it waits for eight more; both waits are
"buffering", and she takes a drag through them (a lean with smoking off)
while the status line counts the lines ready and the room shifts now and
then. With Kokoro the lead is in within a second or two and nothing is
seen. A clip is never rendered twice, however many ask for it, and a
paused set keeps filling.

She **smokes on the stage** (Settings → Open mic, on by default): between
bits she takes a drag, three-quarter to the room, and the gap between bits
stretches from 1.2 to 4.4 seconds to fit it (the package's timeline
follows), and while she waits for Play, or after the bow, a drag comes
round with her other fidgets. Her smoke clips run at 5 frames a second
now, down from 7, on the street too, and in Mira's own copy of the
manifest.
Play, Pause, Skip bit, a heckle box (crowd work performed on the spot),
9:16 or 16:9, rain low behind it, the 432 Hz bed off by default.

**Record** starts both exports and plays the set from the top. When it
ends you get a video clip (`canvas.captureStream(30)` plus the stage's
audio graph, the voice and the room, into `MediaRecorder`: one file with
video and audio, **MP4** (H.264 and AAC) wherever the browser's recorder
can mux it, which recent Chrome on Android and the desktop and Safari can,
and `.webm` VP9/Opus where it cannot; a WebM converts on the PC with
`ffmpeg -i clip.webm -c:v libx264 -pix_fmt yuv420p -c:a aac clip.mp4`) and
the **cutscene package**, a zip of
`performance-<slug>/manifest.json` (the per-line timeline: `t`, `pose`,
`aside`, `audio`, `duration`), `set.md` and `audio/l001.wav…` (16-bit PCM
mono 24 kHz), built in the browser (`src/openmic/zip.js`, store only).
The game's `cutscene/` player (in the Paperless repo) replays a package
with the game's own tiles and courier sprite, subtitles on, skippable.
`node tools/make_package.mjs <set.md>` builds the same package on the PC
with Kokoro in Node. `sets/` holds the first draft and its punch-up.

**Suno** writes lyrics with metatags and a two-part style prompt as three
fenced blocks, each with a labelled copy button: `lyrics` (every section
tag with a descriptor, `[Verse 1: half-spoken, tense]`, so the lyrics and
the spec agree), `style` (the short line, 120 characters or fewer, for the
basic field) and `spec` (the production spec, 400 to 900 characters, for
the expanded field: genre and era, BPM and groove, key and harmony, the
vocals, instrumentation by section, production, the structure arc
matching the lyrics, a three-word mood arc, exclusions; a delivery clause
for a song built from a bit). **Three verses minimum, always**: Verse 1
the scene, Verse 2 the turn, Verse 3 the payoff, the bridge a separate
beat; `/longform on` (or the button) allows four or five for a story song.
The song linter (`src/openmic/song.js`) rejects a song under three verses
or without its two style blocks and has the desk rewrite it once (the
draft before is kept on the card); the softer checks (the hook verbatim in
every chorus, the two lengths, the spec's clauses, descriptors, six to ten
syllables a line, no artist names) show as notes under the song. `/song
<hook or idea>`, `/frombit` (the last set from the Open Mic desk as the
material), then buttons under the song: chorus only, darker, lighter,
duet, Aetheria mode (a frequency's regime and stone lore woven into the
imagery), **same sound** (the spec word for word under a new brief;
`/same <brief>`), long form, versions (a per-song history in localStorage
with the latest two lyrics diffed) and **library**: every spec a song was
written with is kept (`workbench.suno.specs`, one entry per distinct spec)
and `/specs` lists them with a same-sound button and a copy button each.
The set's package carries the style line and the spec when a song was
written from it.

## The desks

| Desk | Thinking | District | What it does |
|---|---|---|---|
| **Research** | on | HEAD | summaries, critiques, `/claims` (claim / evidence / confidence), `/sources`, `/search`, `/url`, PDFs and notes as project files |
| **Writing** | off | HEART | style-locked drafting for the Lewis catalog, `/outline`, `/continuity` against a pasted bible, `/proof` reads back with Kokoro |
| **Paperless** | off | GUT | loads `public/data/paperless-bible.md`; `/dialogue` in the game's pool JSON, `/contract` for the sealed correspondence, `/npc` cards, `/sprite` inspector |
| **Physics & study** | on | HEAD | Socratic by default, `/worked` for full solutions, KaTeX, `/flashcards` and `/flashcards export` (tab-separated, for Anki) |
| **Aetheria** | off | follows the frequency | loads `public/data/aetheria-cube.json`; `/walk`, `/freq`, `/stone`, `/cube`; the aura follows the selected frequency |
| **Mira** | off | HEART | text chat with her core persona (the friend in the Workbench, not the courier); she saves to the memory jar herself; a button opens the companion inline for voice |
| **Open Mic** | off | GUT | her stand-up on a dive-bar stage, real life only: `/five [minutes]` (a tight set, checked against its minutes), `/monologue [minutes]` (one subject, the bits its scenes), `/lines` (twenty one-liners, star the keepers), `/heckle` (crowd work), `/punchup` (a draft back as a diff with notes), `/clean`, `/perform` (the stage), `/song`; every commanded set goes through the linter, and any reply performs |
| **Suno** | off | HEART | lyrics with descriptor tags, the short style line and the full spec in three copyable blocks, three verses minimum; `/song`, `/frombit`, `/chorus`, `/darker`, `/lighter`, `/duet`, `/aetheria`, `/same`, `/longform`, `/versions`, `/specs` |

Everywhere: `/remember`, `/export`, `/read`, `/think on|off`, `/paper`,
`/ambience`, `/handoff`, `/hermes`, `/mira`, `/brain`, `/model`, `/grep`,
`/help`. `Ctrl+Enter` sends, `Esc` stops, `Ctrl+1…8` switches desks, `/` at
the start of the composer opens the palette.

The prompts are in `prompts/*.md`. Edit them there (the build inlines them),
or override one per device in Settings → This desk. `paperless-bible.md` and
`aetheria-cube.json` are fetched at runtime from `public/data/`, so they can
be edited in the deployed site without a rebuild. `python tools/build_cube.py`
regenerates the cube from the canonical sources (the formulas are in the
script; the keywords and hexagrams come from `aetheria-rct`, the stones from
the game's data).

## What is inherited, and from where

| Piece | From |
|---|---|
| streaming chat client, SSE parsing | Mira `src/lab.js`, extended with `/v1/models`, vision content, the thinking switch, usage and timings |
| Kokoro TTS worker, sentence splitter, worklet player | Mira `src/workers/tts.worker.js`, `src/splitter.js`, `src/audio/player.js` |
| Silero VAD and Moonshine workers, mic capture | Mira `src/workers/vad.worker.js`, `stt.worker.js`, `src/audio/mic.js` |
| the 432 Hz synth bed and the rain | Mira `src/audio/music.js` |
| on-device Gemma 4 E2B worker | Mira `src/workers/llm.worker.js`, cut down to text and image |
| ONNX Runtime path fix, `copy_ort.mjs` | Mira |
| district and aura palette, settings shape, persona | Mira `src/style.css`, `src/settings.js`, `persona.md` |
| pdf.js extraction and the OCR cleaner | the Reader `js/extract.js`, `js/textclean.js`, `vendor/pdfjs` |
| Word documents through mammoth | the Reader `js/docx.js`, `vendor/mammoth` |
| the service worker's shape | the Reader `sw.js` |
| the cube: frequencies, walks, Ouroboros | `aetheria-rct` |
| stones, letters, recipients, dialogue format, the bible | the Paperless repo's `data/` and `docs/` |
| desk icons | cut from the Paperless SakPix tileset (`tools/cut_icons.py`); Mira's portrait for her desk |

## Thinking mode

Each desk has a default (Research and Physics on, the rest off) and a switch
in the header. On the wire the app sends `chat_template_kwargs:
{enable_thinking: true|false}` (llama.cpp with `--jinja`, vLLM, and LiteLLM
pass-through) and, for Qwen-named models, the `/think` or `/no_think` soft
switch on the last user message. Settings → Thinking switch chooses one or
the other if a server objects. Reasoning arrives either as
`reasoning_content` deltas or inline `<think>` tags; both are split off,
shown collapsed above the reply, kept in the export, and never spoken.

## Sprite-sheet inspector

`/sprite` on any desk (the Paperless desk suggests it). Drop a PNG: the grid
is measured in the browser (frame size from the gutters or a common size,
columns and rows, each frame's bounding box, the character's height and the
feet line), drawn as an overlay you can correct by hand, and then the vision
model is asked to name the clips. The result is a draft manifest in the
format Mira reads (`public/assets/sprites/courier/courier.json`): `meta
{frame, character_height, feet_y, atlas, columns, rows}`, `clips {name: {fps,
loop, facing, frames: [{x, y}]}}`, and a first `states` map. Download it,
check every clip against the sheet, then add the `mouth` and `visor` anchors
Mira's renderer wants. It is a draft; the tool says so in `meta.generated_by`.

## Project files and the memory jar

Drop a folder of `.md`, `.txt`, `.pdf` or `.docx` on the transcript or the
Files tab. Text is extracted in the browser (pdf.js with the Reader's OCR
cleaner; mammoth for Word), chunked at about 900 characters, embedded with
`onnx-community/embeddinggemma-300m-ONNX` in a worker, and stored in
IndexedDB per desk. Every turn retrieves the best passages by cosine
similarity and hands them to the desk under a "Project files" heading, with
the file names, so the model can cite them. If the embedding model cannot
load (no WebGPU, offline before its first download) the search falls back to
a keyword score and Diagnostics says so.

The memory jar is a list of notes you asked to keep (`/remember`, or the
Memory tab) and, on her own desk, the ones Mira jars herself (see "She
saves to the memory jar herself" above: a `[jar: …]` line at the end of a
reply, stripped before it shows, a "jarred" chip on the message, never
health or money). Every desk sees it at the top of its prompt, and Mira's
companion reads it too on a network brain. Nothing else is saved into it
on its own, and any line can be deleted.

**Delete everything** (Settings → Storage) removes conversations, the jar,
the files, the settings and the cached models from this browser.

## Voice

**Mira's voice engine** (2026-09-12). Her voice is Bella, and since the
audition (`../voice-audition/`) it can be Bella through **Qwen3-TTS**: the
Base model cloning Kokoro's Bella from a twelve-second clip
(`public/assets/voices/bella-ref.wav`) in timbre-only mode, the row Alisha
picked as the more natural one. It runs in two places. On the PC,
`tools/qwen_tts_server.py` (Python 3.11 venv on D:, the 1.7B model on the
GPU) serves an OpenAI-shaped `POST /v1/audio/speech` on port 8123 with a
disk cache and a frame cap; the page reaches it the way it reaches the lab.
Inside the app on the phone, the runtime's `llama-tts` binary (built and
packed beside `llama-server`) reads a Qwen3-TTS GGUF pair from Models (the
1.7B from the catalog, or the 0.6B pair converted on the PC and pushed;
`../voice-model/README.md`) one clip at a time, on the CPU, with the clip
shipped in the app. Settings → Voice → engine: **Auto** uses Qwen for the
stage and packages, which render ahead and cache, and Kokoro for live
replies; **Qwen everywhere** reads replies with it too, sentence by
sentence into the same player, ahead of the player so it does not gap (the
next paragraph; the phone is unmeasured); **Kokoro only** never
asks. Kokoro is the fallback whenever the engine is not up or a clip fails,
and the Node package tool takes `--engine qwen`.

**The 1.7B flows like Kokoro** (2026-09-12). Kokoro never gaps because its
worker runs ahead of the player. The Qwen path now does the same, and
the server makes it possible: one at a time the 1.7B renders at half real
time on the 4090 (25.8 s of audio in 49.9 s), but the model takes a batch,
and the same GPU pass renders six sentences at 1.8 times real time (27.4 s
in 15.2 s; four at 1.08, three at 0.93, two at 0.63). So
`tools/qwen_tts_server.py` keeps one generate call on the GPU at a time
but takes everything waiting into it, up to `--batch` (six by default; one
turns it off), and answers each request with `X-Audio-Seconds`,
`X-Compute-Seconds` and `X-Batch`; `/health` reports the running `rtf`.
The Workbench keeps six sentences in flight to the server (the phone's
runtime still takes one at a time), hands the clips to the player in order
however they come back, and holds the player until the lead covers the
shortfall: from the throughput so far and the words still to render it
knows how many seconds of audio it needs in hand before the rest can keep
up, waits for that (the status line says "voice: buffering"), and never
more than ten seconds. At batch throughput the wait is nil after the first
sentence. The stage prefetch runs the same window (`synthAhead`), so a set
renders ahead six lines at a time and her smoke break before a set is
short. `speech.qwenStats` says what a reply did (the window, the order the
player got, the lead it waited, the rate), for the diagnostics and the
checks. The one lever left is starting the voice while the brain is still
streaming the reply, which would hide the first sentence's render too.

Read-aloud is Kokoro-82M, one pinned voice per desk: `bf_emma` (the Reader's
best British voice) for reading, `af_bella` for Mira (Alisha's pick from the
2026-09-12 audition; `af_nicole` before, and an install still on that old
default is moved over once), both changeable in
Settings. Sentences are split as they go and scheduled through the worklet
player, so a long reply starts speaking after its first sentence. Code
blocks, markdown and the thinking block never reach the voice, and no
asterisk does: emphasis keeps its words, a starred action beat standing on
its own (`*sighs*`, which the persona forbids but small models write
anyway) is dropped from speech, and underscores inside names become spaces
(`stripEmphasis` in `src/speech.js`).

Voice input is Silero VAD plus Moonshine. Hold the mic to talk, or switch to
hands-free in Settings and tap it. The words land in the composer for you to
send or edit.

## Diagnostics and hardware

Diagnostics shows which brain is live, the endpoint's latency (from `GET
/v1/models`), the last turn's first-token time and tokens per second, the
last error, WebGPU, the embedder, the voices, storage and the service worker,
and explains mixed content with its three ways round.

Settings → Hardware → **Probe this device** reads the platform, cores,
memory (Chrome caps the number it reports at 8 GB, so a 24 GB phone says "8
or more"), the WebGPU adapter (vendor, fp16 shaders, buffer limits), storage
quota and whether the lab answered, and proposes a profile: which brain,
which dtype for the on-device model, whether the voice runs on the GPU or the
CPU, a reply cap, and a model picked from the lab's list (Qwen 3.8 first,
then anything vision-capable, then the largest). **Apply** sets it.

## The phone

Below 768 px the layout changes shape (`src/style.css`, `src/panels.js`,
checked at 360×740 by `tools/ui_check.mjs`): the left rail is icons only
with the label shown on a tap; the right drawer (files, jar, settings,
diag) is a **bottom sheet**; the desk menu drops to the bottom of the
screen; every dialog fills the screen with a ✕; the stage overlay is
portrait 9:16. Every panel is sized to the *visual* viewport (`--vvh`,
mirrored from `visualViewport` on resize) rather than `100vh`, which is
what kept a settings window half under the keyboard on Android, and the
focused field is scrolled back into view when the keyboard opens. Opening
any panel pushes a history entry, so the **back gesture** (or the hardware
back button) closes the panel instead of leaving the app; Escape and a
tap outside do the same. The header never overflows: the brain chip
shrinks and ellipsizes, the ping stays at its end, and ☰ stays on screen.

Chrome on Android: **Install** from the browser menu gives a full-screen app
with the same code. The on-device model runs in Chrome's WebGPU sandbox and
is limited by Android's GPU watchdog and Chrome's per-tab memory, not by the
phone's RAM; the profile above already turns thinking off and moves the voice
to the CPU on a phone for that reason (Mira's README has the detail).

To use a big phone's RAM properly today, without waiting for the native
runtime below, run llama.cpp on the phone itself and treat it as the lab:

```
# in Termux
pkg install cmake git clang python
git clone https://github.com/ggml-org/llama.cpp && cd llama.cpp
cmake -B build -DGGML_OPENCL=ON      # the Adreno backend; plain CPU also works
cmake --build build --config Release -j
./build/bin/llama-server -m ~/models/Qwen3-14B-Q4_K_M.gguf -c 32768 --jinja --reasoning-format deepseek --port 8080 --host 127.0.0.1
# and serve the workbench beside it
cd ~/aetheria-workbench/dist && python -m http.server 5180
```

Open `http://127.0.0.1:5180` in Chrome, set the endpoint to
`http://127.0.0.1:8080/v1`, Test connection. Both ends are plain http on the
same phone, so nothing is blocked.

## The in-app runtime (phase two)

Agreed on 2026-09-08 and under way: a runtime baked into the app so no
browser is needed on Android. `docs/NATIVE.md` is the plan, the build
recipe and the status. In short:

1. **A Capacitor Android shell** (`android/`) around this same `dist/`, with
   the WebView's scheme set to `http` so a localhost server is never mixed
   content. Built: `android/app/build/outputs/apk/debug/app-debug.apk`.
2. **`LlamaServer`, a native plugin** (`LlamaServerPlugin.java`): llama.cpp's
   `llama-server` cross-compiled for arm64 with the OpenCL backend (Adreno),
   shipped inside the APK as `libllamaserver_<backend>.so` and run as a
   subprocess bound to 127.0.0.1, with a resumable GGUF downloader, a picker
   for a GGUF already on the phone (copied into the app's storage), a model
   list, start/stop/status and a log. The brain has the third backend,
   `native`, and Settings → Native runtime appears inside the app. Since
   0.2.6 a **foreground service** (`LlamaServerService`: one notification
   with the model, the port and a Stop button) holds the server up while
   the app is in the background, so Mira in Chrome, which talks to it at
   `http://127.0.0.1:8080/v1` (no key; llama-server allows any origin),
   keeps her brain when you switch apps. Settings → Native runtime has the
   switch (on by default); Android 13 and later ask once for the
   notification permission.
3. **Voice through sherpa-onnx** (Kokoro, Moonshine and Silero VAD in one
   Android library) so speech no longer depends on WebGPU in a WebView.
4. **A PC app** the same way: done in 0.3.20 with no Tauri or Electron.
   `tools/pc_runtime.mjs`, the launcher's host, runs llama.cpp's Windows
   build as the sidecar; see "The local runtime on the PC" above.

```
bash native/build_android.sh        # llama-server for arm64: opencl, vulkan (best effort), cpu
npm run apk                         # web build, pack the servers, sync, signed release APK
bash tools/phone_check.sh           # adb install, launch, filtered logcat
```

`npm run apk` needs `JAVA_HOME` pointing at a JDK 17+ (Android Studio's
`jbr` works) and writes `android/app/build/outputs/apk/release/app-release.apk`,
signed with `android/keystore/workbench.jks` (passwords in
`android/keystore.properties`, both git-ignored). **Back those two files
up**: an APK signed with a different key cannot update an installed one.

### Getting the APK onto a phone

Gmail refuses `.apk` attachments (it is on Google's blocked list, and the
file is over the 25 MB attachment limit anyway), so send a link instead:

- **Google Drive.** Upload the APK to Drive, share the link, open it in the
  Drive app on the phone and tap Install. Android asks once to allow
  installs from that app. This is the way to send it by mail.
- **Over the LAN.** `npm run apk:serve` and open the printed address on the
  phone; `serve` sends the right content type, which chat apps do not.
- **Over USB.** `bash tools/phone_check.sh`.

First launch on a phone with no lab endpoint opens Settings at **Native
runtime** with the model list: Qwen3 4B (2.5 GB) is the one to start with;
Qwen3 8B is the daily driver on a 24 GB phone; the Gemma 3 and Qwen2.5-VL
entries come with their vision projector so image drops and the sprite
inspector work. One tap downloads (resumable; keep the app open) and starts
the server, and the chip in the header turns to **in-app · model**.

Expected on the ROG Phone (to be measured, not promised): an 8B model at Q4
around 10 to 15 tokens a second, a 14B around 5 to 8, a 27B fitting in RAM
and running at 2 to 3. The first thing the phone has to answer is whether a
subprocess may load the vendor's OpenCL library; the plugin falls back to
Vulkan and then CPU if not, and `docs/NATIVE.md` has plan B.

## Layout

```
index.html                 the shell: rail, transcript, composer, drawer, dialogs
prompts/*.md               the desks' system prompts, and Mira's four persona lengths (copies of her personas/ folder)
public/data/               aetheria-cube.json, paperless-bible.md (fetched at runtime)
public/assets/desk-icons/  cut from the Paperless tileset; mira.png from her portrait
public/vendor/             pdf.js and mammoth, from the Reader
public/sw.js               app shell cache
src/main.js                boot, desks, transcript, composer, drawer, settings, sprite dialog, the open-mic and Suno pipelines
src/panels.js              panels on a phone: the back gesture closes the open one; the keyboard's viewport mirrored into --vvh
src/openmic/set.js         a set as text and as a timeline: parser, pose tags, the local linter, the diff, the runtime
src/openmic/song.js        a song in the Suno shape and its checks
src/openmic/stage.js       the full-screen stage: Mira's renderer with the open-mic scene, the poses, the exports
src/openmic/mic-scene.js   the dive-bar back room (wall, hot light, mic stand, heads)
src/openmic/performance.js the timeline player: one Kokoro clip per line, the cache, the package, the recorder
src/openmic/room.js  wav.js  zip.js   crowd reactions; WAV in and out; a store-only zip writer
src/brain.js               lab / on-device selection, streaming, stats
src/lab.js                 OpenAI-compatible client (models, chat, thinking switch)
src/think.js               <think> splitting for streamed text
src/desks.js               the desk registry and prompt loading
src/chat.js                conversations (localStorage, text only) and markdown rendering
src/files.js  store.js  extract.js  textclean.js   project files and RAG
src/speech.js  voice.js  ambience.js               Kokoro, Silero + Moonshine, the 432 Hz bed
src/tools/commands.js      the slash commands
src/tools/cube.js          the cube data and the walk / frequency / stone tools
src/tools/sprites.js       the sprite-sheet inspector
src/hardware.js            the probe and the recommended profile
src/handoff.js  export.js  memory.js  theme.js  diagnostics.js  mira-panel.js  ui.js
src/workers/               llm (Gemma 4), embed (EmbeddingGemma), tts (Kokoro), stt (Moonshine), vad (Silero)
src/audio/                 mic, worklets, player, music (all Mira's)
tools/build_cube.py        regenerates the cube JSON
tools/cut_icons.py         regenerates the icons
tools/smoke.mjs            npm run check
tools/ui_check.mjs         headless Chrome against tools/fake_lab.mjs, desktop and a 360 px phone
tools/make_package.mjs     a cutscene package from a set, Kokoro in Node
tools/draw_icons.py        the mic and cassette icons
tools/copy_ort.mjs         ONNX Runtime WASM into public/ort/
prompts/open-mic.md  open-mic-linter.md  suno.md   the two new desks and the linter
sets/                      the first draft and its punch-up
STAGE_SPRITES.md           the stage poses and the frames AutoSprite should draw
```

## Credits

Gemma 4 (Google DeepMind, Apache-2.0 via the ONNX community export),
EmbeddingGemma (Google DeepMind, via the ONNX community export), Kokoro-82M
(hexgrad, Apache-2.0), Silero VAD (MIT), Moonshine (Useful Sensors, MIT),
Transformers.js (Hugging Face), pdf.js (Apache-2.0), mammoth (BSD-2), marked,
DOMPurify, KaTeX. Courier art and the SakPix tiles from *Paperless, The
Forgotten Courier*. The comedy stage's crowd is recorded people from
Wikimedia Commons: laughter by lonemonk (CC BY 3.0) and Ch0cchi (CC BY
3.0), Jens Kraglund, ezwa and stephan (public domain), sagetyrtle (CC0),
and a café by Marble Toast (CC0); the list is in
`public/assets/room/CREDITS.md`. Qwen3-TTS (Alibaba, Apache-2.0) and
llama.cpp (MIT) for Mira's cloned voice. MIT.
