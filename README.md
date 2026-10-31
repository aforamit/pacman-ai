# Pac-Man

A recreation of the 1980 arcade Pac-Man in plain HTML5 Canvas and JavaScript. There's no build step, no dependencies and no server to run.

## Running

Open `index.html` in a browser by double-clicking it. Chrome on Windows and macOS is the main target; any current browser should work.

The arcade-style lettering uses the **Press Start 2P** font from Google Fonts. Offline, the game still works fully, but text falls back to a monospace font.

## Controls

| Action | Keys |
| --- | --- |
| Start game / skip cutscene | Enter, Space, click or tap |
| Move | Arrow keys or WASD; swipe on touch screens |
| Pause | P or Esc |
| Mute | M |
| Show game rules | R on the title screen |
| Toggle cheat mode | C during a game |
| Jump one level back / ahead | [ / ] during a game |

The game pauses itself when you switch to another tab.

## Game rules

Eat every dot to clear the maze and advance to the next level. Dots are worth 10 points and power pellets are worth 50; power pellets temporarily frighten the ghosts so they can be eaten for 200, 400, 800 and 1,600 points in sequence. Avoid ghosts while they are not frightened or you lose a life. You start with three lives, earn an extra life at 10,000 points, and can collect bonus fruit for extra points. Press **R** on the title screen to view the in-game rules.

## Cheat mode and level jumps

Press **C** during a run to toggle cheat mode. While it is on, collisions with non-frightened ghosts cannot hurt Pac-Man, so you cannot lose a life to them. Frightened ghosts can still be eaten and award points as usual. The game screen displays **CHEAT MODE** while the option is active. Cheat mode resets to off when starting a new game.

During a game, press **]** to jump forward one level or **[** to jump back one level (levels 1–256); repeat the key to skip multiple levels. The current level number appears above the maze. Jumping immediately starts the selected level with a fresh maze and resets its level-specific state, but keeps your current score and remaining lives. The fruit icons along the bottom mark the level progression; they are not extra lives or collected fruit. **1UP** is the player-one score label, not the level number. Level 256 is the arcade-style kill screen.

## Features

- **Arcade maze and look**: the original 28×31 layout with double-line walls, the ghost house and its pink door, and the side tunnels. Sprites are pixel art matching the arcade's shapes and colours.
- **Ghost behaviour**:
  - Each ghost targets Pac-Man its own way:
    - Blinky chases him directly.
    - Pinky aims ahead of him.
    - Inky works off Blinky's position.
    - Clyde backs off when he gets close.
  - Pinky and Inky copy the arcade's targeting bug when Pac-Man faces up.
  - Ghosts switch between scatter and chase on the arcade's timings, and reverse direction when the mode changes.
  - When Blinky speeds up late in a level ("Cruise Elroy"), he also keeps chasing during scatter.
  - Ghosts can't turn up at the four arcade no-up spots, and slow down in the tunnels.
  - Ghosts leave the house according to the arcade's dot counters and idle timer.
- **Pac-Man movement**: he can cut corners, pauses briefly on each dot (longer on power pellets), and keeps a buffered turn until it becomes possible.
- **Levels**: speeds, frightened time, Blinky's speed-up thresholds and bonus fruit change level by level, following the arcade's tables.
- **Intermissions**: cutscenes after levels 2, 5, 9, 13 and 17, plus the level-256 split-screen "kill screen".
- **Scoring**:
  - Dots 10, power pellets 50.
  - Ghosts 200 / 400 / 800 / 1600 for eating them in a row.
  - Bonus fruit worth 100 to 5000 appears after 70 and 170 dots.
  - Extra life at 10,000.
  - The high score is saved in the browser.
- **Sound**: synthesised with the Web Audio API, with no audio files:
  - the intro tune
  - the waka-waka
  - the siren, which rises in pitch as the dots run out
  - frightened and eyes-returning sounds
  - death, fruit and extra-life sounds
  - intermission music, which is a tune in the same style, not the arcade melody
- **Display**: scales by whole numbers to fit the window, taking high-DPI screens into account, so pixels stay sharp.

## How it works

Everything is in two files:

- `index.html`: the page and the canvas.
- `pacman.js`: the whole game.

**Display.** The game draws to a logical 224×288 screen (28×36 tiles of 8 px), the arcade's resolution. The canvas scales this up by a whole number, so the display stays sharp.

**Timing.** The game logic runs at a fixed 60 updates per second. Actors move one pixel at a time so they line up exactly with tile centres. Each frame is drawn once per update, and not at all when nothing has changed.

**Maze walls.** The rounded outline walls are drawn once each time the window size changes. They're traced from the tile map using distance transforms at the display's actual resolution, then reused as an image every frame.

**Rules.** Speed and timing tables follow Jamey Pittman's *The Pac-Man Dossier*.

## Not included

- Two-player mode
- The attract-mode demo game, where the computer plays a round on its own

The title screen does show the character roster and a short chase animation.

## Disclaimer

PAC-MAN is a trademark of Bandai Namco Entertainment Inc. This is a non-commercial fan recreation for personal and educational use.
