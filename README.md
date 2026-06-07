# Banania AI — AI Plays the Original Game in the Browser

The original Banania game (`game.js`, images, sounds, levels, and original MD5 assets) enhanced with an AI layer.

## Original Game Source

This project is based on the Banania JavaScript port created by Benjamin Ri:

- https://github.com/BenjaminRi/Banania

## Launch

Open **banania-ai.html** in your browser (double-click). No installation required.

## Usage

1. Choose a **Mode**: Hybrid (AI), A* (AI), MCTS (AI), or Human (arrow keys).
2. For AI modes, click **▶ Start AI** (the green button). Click it again to stop.
3. Use **Level** + **Load** (or ◀ ▶) to change levels. Adjust **Speed** from ×1 to ×12.
4. **Campaign 1→51**: the AI automatically progresses through all levels.
5. In **Human** mode, play using the arrow keys (normal speed).

The top status bar displays the current level, bananas collected, steps taken, and AI status.

## How It Works

The AI controls the original game engine exactly like a human player. Whenever Berti is idle, the AI writes commands to `input.keys_down`; the game's original `register_input` and `start_move` functions then execute the move.

The speed setting adjusts `game.move_speed`, which controls the original engine's movement tweening.

## License

This project is provided strictly for **educational and research purposes only**.

You may use, study, and modify the code for learning purposes.

Commercial use is not permitted.