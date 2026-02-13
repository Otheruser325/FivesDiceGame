import GlobalAudio from '../utils/AudioManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';

const t = (key, fallback) => GlobalLocalization.t(key, fallback);
const tf = (key, fallback, ...args) => GlobalLocalization.format(key, fallback, ...args);
const list = (key, fallback) => t(key, fallback).split('|').map(s => s.trim()).filter(Boolean);
const teamLabel = (team) => (team === 'red' ? t('TEAM_RED', 'RED') : t('TEAM_BLUE', 'BLUE'));

export default class LocalPostGameScene extends Phaser.Scene {
    constructor() {
        super('LocalPostGameScene');
    }

    create() {
        const stats = this.registry.get("localPostGame");

        this.add.text(600, 50, t('LOCAL_POSTGAME_TITLE', 'Local Game - Results'), {
            fontSize: 40
        }).setOrigin(0.5);

        // Check if teams are enabled
        const teamsEnabled = stats.teamsEnabled || false;

        // Buzzwords and colors
        const rankColors = {
            1: "#FFD700", // Gold
            2: "#C0C0C0", // Silver
            3: "#CD7F32", // Bronze
        };

        const buzzwords = {
            1: list('POSTGAME_BUZZ_1', 'Winner winner!|Dicetastic!|Dice-tacular!'),
            2: list('POSTGAME_BUZZ_2', 'Excellent performance!|In-deucible!|Outstanding!'),
            3: list('POSTGAME_BUZZ_3', 'Good game!|You did well!|You show no mercy!'),
            other: list('POSTGAME_BUZZ_OTHER', 'Better luck next time!|Pray to RNGesus!|You will be gifted later...')
        };

        if (teamsEnabled) {
            this.displayTeamsResults(stats, rankColors, buzzwords);
        } else {
            this.displayIndividualResults(stats, rankColors, buzzwords);
        }

        // -------- Back Button --------
        const back = this.add.text(600, 800, t('POSTGAME_RETURN_MENU', 'Return to Menu'), {
            fontSize: 26,
            color: "#ff6666"
        }).setOrigin(0.5).setInteractive();

        back.on("pointerdown", () => {
            GlobalAudio.playButton(this);
            this.scene.start('MenuScene');
        });
    }

    displayIndividualResults(stats, rankColors, buzzwords) {
        // -------- Determine Rankings --------
        const scoredPlayers = stats.scores
            .map((score, index) => ({
                index,
                score
            }))
            .sort((a, b) => b.score - a.score);

        const placements = new Array(stats.players);
        scoredPlayers.forEach((p, i) => placements[p.index] = i + 1);

        // -------- Display Stats --------
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
        }
        else if (totalPlayers === 4) {
            colX = [300, 700];
        }
        else {
            colX = [200, 500, 800];
        }

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

            const title = tf('POSTGAME_PLACEMENT_TITLE', '{0} - #{1}', name, placement);
            const combosLines = [
                tf('STAT_SCORE_LINE', 'Score: {0}', score),
                '',
                tf('STAT_PAIRS_LINE', 'Pairs: {0}', c.pair),
                tf('STAT_TWO_PAIRS_LINE', 'Two Pairs: {0}', c.twoPair),
                tf('STAT_TRIPLES_LINE', 'Triples: {0}', c.triple),
                tf('STAT_FULL_HOUSES_LINE', 'Full Houses: {0}', c.fullHouse),
                tf('STAT_FOUR_KIND_LINE', 'Four-of-a-Kinds: {0}', c.fourOfAKind),
                tf('STAT_FIVE_KIND_LINE', 'Five-of-a-Kinds: {0}', c.fiveOfAKind),
                tf('STAT_STRAIGHTS_LINE', 'Straights: {0}', c.straight)
            ];
            const combosText = combosLines.join('\n');

            const spacing = {
                titleToStats: statSize * 5,
                statsToBuzz: buzzSize * 4.5,
            };

            // Title (larger + coloured)
            this.add.text(x, y, title, {
                fontSize: titleSize,
                color: placeColor,
                align: "center"
            }).setOrigin(0.5);

            // Stats block
            this.add.text(x, y + spacing.titleToStats, combosText, {
                fontSize: statSize,
                color: "#ffffff",
                align: "center"
            }).setOrigin(0.5);

            // Buzzword (highlighted slightly bigger)
            this.add.text(x, y + spacing.titleToStats + spacing.statsToBuzz, `"${message}"`, {
                fontSize: buzzSize,
                color: placeColor,
                fontStyle: "italic",
                align: "center"
            }).setOrigin(0.5);
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
        const teamName = tf('TEAM_LABEL', '{0} TEAM', teamColor === '#66aaff' ? teamLabel('blue') : teamLabel('red'));
        this.add.text(xPos, startY - 40, teamName, {
            fontSize: titleSize + 4,
            color: teamColor,
            fontStyle: "bold",
            align: "center"
        }).setOrigin(0.5);

        // Team total score
        this.add.text(xPos, startY - 10, tf('TEAM_TOTAL_LINE', 'Team Total: {0}', teamTotal), {
            fontSize: titleSize,
            color: "#ffffff",
            align: "center"
        }).setOrigin(0.5);

        // Draw each player in the team
        let yOffset = startY + 105;
        const playerTextColor = isWinner ? "#FFD700" : "#ffffff";
        
        team.forEach((player, idx) => {
            const combosLines = [
                player.name,
                tf('STAT_SCORE_LINE', 'Score: {0}', player.score),
                '',
                tf('STAT_PAIRS_LINE', 'Pairs: {0}', player.combos.pair),
                tf('STAT_TWO_PAIRS_LINE', 'Two Pairs: {0}', player.combos.twoPair),
                tf('STAT_TRIPLES_LINE', 'Triples: {0}', player.combos.triple),
                tf('STAT_FULL_HOUSES_LINE', 'Full Houses: {0}', player.combos.fullHouse),
                tf('STAT_FOUR_KIND_LINE', 'Four-of-a-Kinds: {0}', player.combos.fourOfAKind),
                tf('STAT_FIVE_KIND_LINE', 'Five-of-a-Kinds: {0}', player.combos.fiveOfAKind),
                tf('STAT_STRAIGHTS_LINE', 'Straights: {0}', player.combos.straight)
            ];
            const combosText = combosLines.join('\n');

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
