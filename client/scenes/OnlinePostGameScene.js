import GlobalAudio from '../utils/AudioManager.js';
import ErrorHandler from '../utils/ErrorManager.js';

export default class OnlinePostGameScene extends Phaser.Scene {
    constructor() {
        super('OnlinePostGameScene');
    }

    create() {
        // Data injected by OnlineGameScene via registry
        const stats = this.registry.get("onlinePostGame");

        if (!stats) {
            this.add.text(600, 500, "No Results Available", { fontSize: 32 });
            return;
        }

        this.add.text(600, 50, "Online Game — Results", {
            fontSize: 40
        }).setOrigin(0.5);

        // Check if teams are enabled
        const teamsEnabled = stats.teamsEnabled || false;

        // Buzzwords and colors
        const rankColors = {
            1: "#FFD700",
            2: "#C0C0C0",
            3: "#CD7F32"
        };

        const buzzwords = {
            1: ["Winner winner!", "Dicetastic!", "Dice-tacular!"],
            2: ["Excellent performance!", "In-deucible!", "Outstanding!"],
            3: ["Good game!", "You did well!", "You show no mercy!"],
            other: ["Better luck next time!", "Pray to RNGesus!", "You'll be later gifted..."]
        };

        if (teamsEnabled) {
            this.displayTeamsResults(stats, rankColors, buzzwords);
        } else {
            this.displayIndividualResults(stats, rankColors, buzzwords);
        }

        // -------- Back Button --------
        const back = this.add.text(600, 800, "Return to Menu", {
            fontSize: 26,
            color: "#ff6666"
        }).setOrigin(0.5).setInteractive();

        back.on("pointerdown", () => {
            GlobalAudio.playButton(this);
            this.scene.start('OnlineMenuScene');
        });
    }

    displayIndividualResults(stats, rankColors, buzzwords) {
        // --------------------------
        //   Determine Rankings
        // --------------------------
        const scoredPlayers = stats.scores
            .map((score, index) => ({
                index,
                score
            }))
            .sort((a, b) => b.score - a.score);  // highest first

        const placements = new Array(stats.players);
        scoredPlayers.forEach((p, i) => placements[p.index] = i + 1);

        // --------------------------
        //     UI Layout Logic
        // --------------------------
        const totalPlayers = stats.players;
        let startY = 140;
        let titleSize = 26;
        let statSize = 20;
        let buzzSize = 22;
        let colX = [];

        if (totalPlayers === 2) {
            titleSize *= 1.5;
            statSize *= 1.5;
            buzzSize *= 1.5;
            colX = [300, 700];
        } else if (totalPlayers === 4) {
            colX = [300, 700];
        } else {
            colX = [200, 500, 800];
        }

        // --------------------------
        //    Render Result Blocks
        // --------------------------
        for (let i = 0; i < stats.players; i++) {
            const c = stats.combos[i];
            const name = stats.names[i];
            const score = stats.scores[i];
            const placement = placements[i];

            let row, col, x, y;

            if (totalPlayers === 2) {
                row = 0;
                col = i;
                x = colX[col];
                y = startY;
            } else if (totalPlayers === 4) {
                row = Math.floor(i / 2);
                col = i % 2;
                x = colX[col];
                y = startY + row * 260;
            } else {
                row = Math.floor(i / 3);
                col = i % 3;
                x = colX[col];
                y = startY + row * 260;
            }

            const pool = buzzwords[placement] || buzzwords.other;
            const message = pool[Math.floor(Math.random() * pool.length)];

            const placeColor = rankColors[placement] || "#ffffff";

            const title = `${name} — #${placement}`;
            const combosText =
`Score: ${score}

Pairs: ${c.pair}
Two Pairs: ${c.twoPair}
Triples: ${c.triple}
Full Houses: ${c.fullHouse}
Four-of-a-Kinds: ${c.fourOfAKind}
Five-of-a-Kinds: ${c.fiveOfAKind}
Straights: ${c.straight}`;

            const spacing = {
                titleToStats: statSize * 5,
                statsToBuzz: buzzSize * 4.5,
            };

            // -- Title --
            this.add.text(x, y, title, {
                fontSize: titleSize,
                color: placeColor,
                align: "center"
            }).setOrigin(0.5);

            // -- Stats --
            this.add.text(x, y + spacing.titleToStats, combosText, {
                fontSize: statSize,
                color: "#ffffff",
                align: "center"
            }).setOrigin(0.5);

            // -- Buzzword --
            this.add.text(
                x,
                y + spacing.titleToStats + spacing.statsToBuzz,
                `"${message}"`,
                {
                    fontSize: buzzSize,
                    color: placeColor,
                    fontStyle: "italic",
                    align: "center"
                }
            ).setOrigin(0.5);
        }
    }

    displayTeamsResults(stats, rankColors, buzzwords) {
        // Organize players by team
        const blueTeam = [];
        const redTeam = [];

        for (let i = 0; i < stats.players; i++) {
            const playerTeam = stats.teams[i]; // Can be 'blue'|'red' or 0|1
            const playerData = {
                index: i,
                name: stats.names[i],
                score: stats.scores[i],
                combos: stats.combos[i]
            };

            // Handle both string ('blue'/'red') and numeric (0/1) formats
            const isBlueTeam = playerTeam === 'blue' || playerTeam === 0;
            
            if (isBlueTeam) {
                blueTeam.push(playerData);
            } else {
                redTeam.push(playerData);
            }
        }

        // Calculate team totals
        const blueTotal = blueTeam.reduce((sum, p) => sum + p.score, 0);
        const redTotal = redTeam.reduce((sum, p) => sum + p.score, 0);

        // Determine team winner
        const blueWins = blueTotal > redTotal;

        // Draw team columns
        this.drawTeamColumn(blueTeam, blueTotal, blueWins, "#66aaff", 320, stats, buzzwords);
        this.drawTeamColumn(redTeam, redTotal, !blueWins, "#ff6666", 880, stats, buzzwords);
    }

    drawTeamColumn(team, teamTotal, isWinner, teamColor, xPos, stats, buzzwords) {
        const startY = 140;
        const titleSize = 24;
        const statSize = 20;
        const buzzSize = 18;

        // Team header with background
        const headerBg = this.add.rectangle(xPos, startY - 30, 320, 70, teamColor === "#66aaff" ? 0x3366aa : 0xaa3333);
        headerBg.setAlpha(0.3);

        // Team name
        const teamName = teamColor === "#66aaff" ? "BLUE TEAM" : "RED TEAM";
        this.add.text(xPos, startY - 40, teamName, {
            fontSize: titleSize + 4,
            color: teamColor,
            fontStyle: "bold",
            align: "center"
        }).setOrigin(0.5);

        // Team total score
        this.add.text(xPos, startY - 10, `Team Total: ${teamTotal}`, {
            fontSize: titleSize,
            color: "#ffffff",
            align: "center"
        }).setOrigin(0.5);

        // Draw each player in the team
        let yOffset = startY + 105;
        const playerTextColor = isWinner ? "#FFD700" : "#ffffff";
        
        team.forEach((player, idx) => {
            const combosText = `${player.name}
Score: ${player.score}

Pairs: ${player.combos.pair}
Two Pairs: ${player.combos.twoPair}
Triples: ${player.combos.triple}
Full Houses: ${player.combos.fullHouse}
Four-of-a-Kinds: ${player.combos.fourOfAKind}
Five-of-a-Kinds: ${player.combos.fiveOfAKind}
Straights: ${player.combos.straight}`;

            // Player card background
            const cardBg = this.add.rectangle(xPos, yOffset + 45, 280, 210, isWinner ? 0xaaaa00 : 0x333333);
            cardBg.setAlpha(0.2);
            if (isWinner) {
                cardBg.setStrokeStyle(2, 0xffff00);
            }

            // Player stats with golden color if team won
            this.add.text(xPos, yOffset, combosText, {
                fontSize: statSize,
                color: playerTextColor,
                align: "center"
            }).setOrigin(0.5);

            yOffset += 235;
        });

        // Team buzzword at the bottom (after all players)
        const teamBuzzwords = isWinner ? buzzwords[1] : buzzwords[3] || buzzwords.other;
        const teamMessage = teamBuzzwords[Math.floor(Math.random() * teamBuzzwords.length)];
        const teamBuzzColor = isWinner ? "#FFD700" : "#ffffff";
        this.add.text(xPos, yOffset - 40, `"${teamMessage}"`, {
            fontSize: buzzSize,
            color: teamBuzzColor,
            fontStyle: "italic",
            align: "center"
        }).setOrigin(0.5);
    }
}