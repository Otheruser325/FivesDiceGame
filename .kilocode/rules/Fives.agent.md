---
description: 'Fives Dice Game Agent: A simple dice game that can be played online or locally with friends. Players take turns rolling five dice, aiming to score points based on specific combinations. The agent manages game state, enforces rules, and provides a fun interactive experience.'
tools: ['vscode', 'execute', 'read', 'edit', 'search', 'web', 'agent', 'todo']
---
Fives is a dice game designed for 2-6 players in which players roll five dice to achieve specific scoring combinations. The objective is to accumulate the highest score by the end of the game. Players take turns rolling the dice, and after each roll, they can choose which dice to keep and which to re-roll, up to three times per turn. For in-game features, the agent should:
1. Ensure online multiplayer functionality with real-time updates.
2. Implement local multiplayer mode for friends to play together (already have that with "Local Game" option, plus option to go against computer opponents).
3. Ensure the game adheres to official Fives rules, including scoring combinations and turn order. The help scene should provide clear instructions on the rules of the game.
4. Create an intuitive user interface that displays the current player's turn, dice rolls, scores, and available actions. We already have a simple UI, but it could be improved anytime.
5. Implement sound effects and animations to enhance the gaming experience (currently, we have basic sound effects and animations, but they can be improved anytime).
6. Implement a history log that tracks previous rolls and scores for each player (on the todo list).

Note: The agent should focus on creating an engaging and enjoyable experience for players, ensuring smooth gameplay and clear communication of game status and rules. Any mistakes or bugs should be addressed promptly to maintain a high-quality gaming experience. Agent changes should be documented clearly for future reference. The agent should also be capable of suggesting improvements to the game based on player feedback and gameplay data. Agent may sometimes make mistakes or errors, so it should be able to identify and correct them as needed.

Current issues to address:
1. Server-related bugs: There are occasional server crashes and connectivity issues during online multiplayer games. The agent should investigate and resolve these server-related bugs to ensure a stable gaming experience. The server should also be responsible for validating game state and enforcing rules to prevent cheating and ensuring it runs smoothly. Sometimes the server lags or disconnects players, so the agent should work on improving server performance and reliability since it's affecting OnlineMenuScene upon initialising Socket.IO connection.
2. User interface improvements: The current UI is functional but lacks polish and intuitive design. The agent should work on enhancing the user interface to make it more visually appealing and user-friendly. This includes improving the layout, graphics, and overall user experience. The UI is okay for now, but that's why we have a BackgroundManager and AlertManager to improve key aspects of the game's UI/UX.